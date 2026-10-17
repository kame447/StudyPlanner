"""Private Hy Memory 2.0 bridge for Laplance's canonical user context.

This process must be called by a trusted backend, never from browsers.
It owns a disposable Hy Memory search index, not the source-of-truth records.
"""

from __future__ import annotations

import argparse
import hmac
import json
import os
import sqlite3
from collections.abc import Mapping
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import RLock
from typing import Any

AGENT_ID = "laplance-user-context"
SOURCE = "laplance"
MAX_RECORDS = 200
MAX_CANDIDATES = 16
MAX_TEXT_LENGTH = 2000
MAX_QUERY_LENGTH = 1000
MAX_BODY_BYTES = 1_048_576


def _valid_owner(owner: Any) -> bool:
    return isinstance(owner, str) and 1 <= len(owner) <= 128 and all(
        character.isascii() and (character.isalnum() or character in "-_:")
        for character in owner
    )


def _valid_revision(value: Any) -> bool:
    return type(value) is int and 0 <= value <= 2**53 - 1


def _source_ids(response: Mapping[str, Any], owner_id: str, revision: int) -> list[str]:
    """Reject ambiguous merged sources and vendor errors disguised as no-match."""
    if not isinstance(response.get("rewrite"), Mapping):
        raise RuntimeError("SDK did not produce a complete search response")
    buckets = response.get("memories")
    if not isinstance(buckets, Mapping) or not isinstance(buckets.get("normal"), list):
        raise RuntimeError("SDK search channel missing")
    selected: list[str] = []
    seen: set[str] = set()
    for item in buckets["normal"][:MAX_CANDIDATES]:
        if not isinstance(item, Mapping):
            continue
        if (item.get("user_id") != owner_id or item.get("agent_id") != AGENT_ID
                or item.get("source") != SOURCE):
            continue
        meta = item.get("meta")
        if not isinstance(meta, list) or len(meta) != 1 or not isinstance(meta[0], Mapping):
            continue
        origin = meta[0]
        value = origin.get("laplance_source_id")
        if (
            isinstance(value, str) and value and len(value) <= 128
            and origin.get("laplance_source_revision") == revision
            and type(origin.get("laplance_source_revision")) is int
            and value not in seen
        ):
            seen.add(value)
            selected.append(value)
    return selected[:10]


class HyMemoryIndex:
    """Serialized per-process index maintenance with a persistent revision fence."""

    def __init__(self, sdk: Any, state_path: str):
        self.sdk = sdk
        self.lock = RLock()
        path = Path(state_path)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS owner_index "
            "(owner_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL)"
        )
        self.db.commit()

    def _state(self, owner_id: str) -> tuple[int, str] | None:
        row = self.db.execute(
            "SELECT revision, state FROM owner_index WHERE owner_id = ?", (owner_id,)
        ).fetchone()
        return (int(row[0]), str(row[1])) if row else None

    def _set_state(self, owner_id: str, revision: int, state: str) -> None:
        self.db.execute(
            "INSERT INTO owner_index (owner_id, revision, state) VALUES (?, ?, ?) "
            "ON CONFLICT(owner_id) DO UPDATE SET revision=excluded.revision, state=excluded.state",
            (owner_id, revision, state),
        )
        self.db.commit()

    def rebuild(self, owner_id: str, revision: int, records: Any) -> dict[str, Any]:
        if not _valid_owner(owner_id) or not _valid_revision(revision):
            raise ValueError("Invalid owner/revision")
        if not isinstance(records, list) or len(records) > MAX_RECORDS:
            raise ValueError("Invalid bounded record collection")
        valid: list[tuple[str, str]] = []
        seen: set[str] = set()
        for record in records:
            if not isinstance(record, dict) or set(record) != {"id", "text"}:
                raise ValueError("Invalid canonical record")
            record_id, content = record["id"], record["text"]
            if (
                not isinstance(record_id, str) or not 1 <= len(record_id) <= 128
                or record_id in seen or not isinstance(content, str)
                or not 1 <= len(content) <= MAX_TEXT_LENGTH
            ):
                raise ValueError("Invalid canonical record identity/content")
            seen.add(record_id)
            valid.append((record_id, content))
        with self.lock:
            old = self._state(owner_id)
            if old and old[0] > revision:
                return {"status": "stale", "revision": old[0]}
            if old == (revision, "ready"):
                return {"status": "ready", "revision": revision, "unchanged": True}
            # A crash or partial failure leaves a durable non-ready fence.
            self._set_state(owner_id, revision, "building")
            try:
                deleted = self.sdk.delete_all(user_id=owner_id)
                if isinstance(deleted, Mapping) and deleted.get("success") is False:
                    raise RuntimeError("SDK delete_all unsuccessful")
                for record_id, content in valid:
                    result = self.sdk.add(
                        content,
                        user_id=owner_id,
                        agent_id=AGENT_ID,
                        session_id=f"revision-{revision}",
                        source=SOURCE,
                        scene="chat",
                        meta={
                            "laplance_source_id": record_id,
                            "laplance_source_revision": revision,
                        },
                    )
                    if not isinstance(result, Mapping) or result.get("success") is not True:
                        raise RuntimeError("SDK add unsuccessful")
                self._set_state(owner_id, revision, "ready")
            except Exception:
                self._set_state(owner_id, revision, "unavailable")
                raise
            return {"status": "ready", "revision": revision, "indexed": len(valid)}

    def search(self, owner_id: str, revision: int, query: str) -> dict[str, Any]:
        if not _valid_owner(owner_id) or not _valid_revision(revision):
            raise ValueError("Invalid owner/revision")
        if not isinstance(query, str) or not 1 <= len(query) <= MAX_QUERY_LENGTH:
            raise ValueError("Invalid search query")
        with self.lock:
            if self._state(owner_id) != (revision, "ready"):
                return {"status": "unavailable"}
            try:
                result = self.sdk.search(
                    query,
                    user_ids=[owner_id],
                    agent_ids=[AGENT_ID],
                    include_sources=[SOURCE],
                    scene="chat",
                    limit=MAX_CANDIDATES,
                    schema_limit=0,
                    intention_limit=0,
                )
                return {
                    "status": "ready",
                    "ownerId": owner_id,
                    "sourceRevision": revision,
                    "recordIds": _source_ids(result, owner_id, revision),
                }
            except Exception:
                # Do not expose provider errors or content to the caller.
                return {"status": "unavailable"}

    def forget(self, owner_id: str, revision: int) -> dict[str, Any]:
        if not _valid_owner(owner_id) or not _valid_revision(revision):
            raise ValueError("Invalid owner/revision")
        with self.lock:
            old = self._state(owner_id)
            if old and old[0] > revision:
                return {"status": "stale", "revision": old[0]}
            self._set_state(owner_id, revision, "building")
            try:
                deleted = self.sdk.delete_all(user_id=owner_id)
                if isinstance(deleted, Mapping) and deleted.get("success") is False:
                    raise RuntimeError("SDK delete_all unsuccessful")
                self._set_state(owner_id, revision, "ready")
            except Exception:
                self._set_state(owner_id, revision, "unavailable")
                raise
            return {"status": "ready", "revision": revision}

    def close(self) -> None:
        self.db.close()
        self.sdk.close()


def make_handler(index: HyMemoryIndex, token: str) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args: Any) -> None:
            return

        def _reply(self, status: int, value: dict[str, Any]) -> None:
            data = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:
            if self.path == "/healthz":
                self._reply(200, {"ok": True})
            else:
                self._reply(404, {"error": "not_found"})

        def do_POST(self) -> None:
            received = self.headers.get("Authorization", "")
            if not hmac.compare_digest(received, f"Bearer {token}"):
                self._reply(401, {"error": "unauthorized"})
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if size <= 0 or size > MAX_BODY_BYTES:
                    raise ValueError("Invalid body size")
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict):
                    raise ValueError("Invalid JSON payload")
                if self.path == "/v1/index":
                    response = index.rebuild(
                        body.get("ownerId"), body.get("sourceRevision"), body.get("records")
                    )
                elif self.path == "/v1/search":
                    response = index.search(
                        body.get("ownerId"), body.get("sourceRevision"), body.get("query")
                    )
                elif self.path == "/v1/forget":
                    response = index.forget(body.get("ownerId"), body.get("sourceRevision"))
                else:
                    self._reply(404, {"error": "not_found"})
                    return
            except (ValueError, TypeError, json.JSONDecodeError):
                self._reply(400, {"error": "invalid_request"})
                return
            except Exception:
                self._reply(503, {"status": "unavailable"})
                return
            self._reply(200, response)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=19528)
    args = parser.parse_args()
    token = os.environ.get("HY_MEMORY_BRIDGE_TOKEN", "")
    if len(token) < 32:
        parser.error("HY_MEMORY_BRIDGE_TOKEN must have at least 32 characters")
    if args.host not in ("127.0.0.1", "::1"):
        parser.error("Only local loopback is supported; put a private proxy in front")
    data_dir = os.environ.get("MEMORY_DATA_DIR")
    if not data_dir:
        parser.error("MEMORY_DATA_DIR must be an explicit persistent private path")
    os.umask(0o077)
    model_cache = os.environ.get("HY_MEMORY_MODEL_CACHE_DIR", "")
    if not model_cache or not Path(model_cache).is_absolute():
        parser.error("HY_MEMORY_MODEL_CACHE_DIR must be an absolute local cache path")

    from hy_memory_local_embeddings import LocalEmbeddingService, load_local_model

    # A missing cached model is a startup error, never a reason to call a
    # remote embedding service (including the SDK's OpenAI default).
    local_model = load_local_model(model_cache, download=False)
    local_embeddings = LocalEmbeddingService(local_model)
    local_embeddings.start()
    local_embeddings.configure_hy_memory(data_dir)
    index = None
    server = None
    try:
        from hy_memory import HyMemoryClient

        index = HyMemoryIndex(
            HyMemoryClient(mode="lite"),
            str(Path(data_dir) / "laplance-index-state.sqlite3"),
        )
        server = ThreadingHTTPServer((args.host, args.port), make_handler(index, token))
        server.serve_forever()
    finally:
        if server is not None:
            server.server_close()
        if index is not None:
            index.close()
        local_embeddings.close()


if __name__ == "__main__":
    main()
