"""Synthetic Hy Memory SDK connectivity probe.

The --local-embedding mode uses an isolated in-process OpenAI-compatible mock
and temp Chroma storage. It exercises the actual SDK with no user data/keys.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
import uuid
from collections.abc import Mapping
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from typing import Any

FIXTURES = (
    ("math-time", "私は数学の復習を夕方に行いたい。"),
    ("english-goal", "TOEICの目標は800点です。"),
)


def recover_source_ids(search_response: Mapping[str, Any], revision: int, user_id: str) -> list[str]:
    """Return only individually attributable canonical IDs from a valid response."""
    if not isinstance(search_response.get("rewrite"), Mapping):
        raise ValueError("Hy Memory search lacks the normal success envelope")
    bucket = search_response.get("memories")
    if not isinstance(bucket, Mapping) or not isinstance(bucket.get("normal"), list):
        raise ValueError("Hy Memory returned no normal memory list")
    found: list[str] = []
    seen: set[str] = set()
    for memory in bucket["normal"][:64]:
        if not isinstance(memory, Mapping) or memory.get("user_id") != user_id:
            continue
        meta = memory.get("meta")
        if not isinstance(meta, list) or len(meta) != 1 or not isinstance(meta[0], Mapping):
            continue
        source = meta[0]
        source_id = source.get("laplance_source_id")
        source_revision = source.get("laplance_source_revision")
        if (
            isinstance(source_id, str) and source_id
            and type(source_revision) is int and source_revision == revision
            and source_id not in seen
        ):
            seen.add(source_id)
            found.append(source_id)
    return found


def mock_embedding(text: str) -> list[float]:
    """Deterministic 32-dimensional test vector, not a semantic model."""
    values = [0.001] * 32
    # The byte-level pseudo embedding intentionally has no semantic validity.
    for idx in range(max(len(text) - 1, 1)):
        token = text[idx : idx + 2]
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        values[digest[0] % 32] += 1.0
    magnitude = sum(x * x for x in values) ** 0.5
    return [x / magnitude for x in values]


class MockEmbeddingHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args: Any) -> None:
        return

    def do_POST(self) -> None:
        if self.path != "/v1/embeddings":
            self.send_error(404)
            return
        try:
            size = int(self.headers.get("content-length", "0"))
            if size < 1 or size > 65536:
                raise ValueError("invalid request size")
            request = json.loads(self.rfile.read(size).decode("utf-8"))
            inputs = request.get("input")
            texts = inputs if isinstance(inputs, list) else [inputs]
            if not texts or not all(isinstance(item, str) for item in texts):
                raise ValueError("bad embedding input")
            response = {
                "object": "list",
                "model": request.get("model", "test-embedding"),
                "data": [
                    {"object": "embedding", "index": i, "embedding": mock_embedding(item)}
                    for i, item in enumerate(texts)
                ],
                "usage": {"prompt_tokens": 1, "total_tokens": 1},
            }
        except (ValueError, TypeError, json.JSONDecodeError):
            self.send_error(400)
            return
        body = json.dumps(response).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@contextmanager
def local_embedder():
    with tempfile.TemporaryDirectory(prefix="laplance-hymemory-probe-") as directory:
        server = ThreadingHTTPServer(("127.0.0.1", 0), MockEmbeddingHandler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        previous = {}
        overrides = {
            "MEMORY_DATA_DIR": directory,
            "MEMORY_MODE": "lite",
            "MEMORY_EMBEDDER_BASE_URL": f"http://127.0.0.1:{server.server_port}/v1",
            "MEMORY_EMBEDDER_API_KEY": "synthetic-only",
            "MEMORY_EMBEDDER_MODEL": "test-embedding",
            "MEMORY_EMBEDDING_DIMS": "32",
            "MEMORY_VECTOR_STORE": "chroma",
            "MEMORY_LLM_API_KEY": "unused",
            "MEMORY_ENABLE_GRAPH": "false",
            "MEMORY_LOG_LEVEL": "WARNING",
            "MEMORY_HISTORY_ENABLE": "false",
            "MEMORY_PIPELINE_TRACE_ENABLED": "false",
        }
        for key, value in overrides.items():
            previous[key] = os.environ.get(key)
            os.environ[key] = value
        try:
            yield
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


def run_probe(mode: str) -> dict[str, Any]:
    try:
        from hy_memory import HyMemoryClient
    except ImportError as exc:
        raise RuntimeError("Install the isolated SDK: pip install hy-memory==2.0.2") from exc

    user_id = f"laplance-synthetic-{uuid.uuid4().hex}"
    revision = 1
    client = HyMemoryClient(mode=mode)
    try:
        for source_id, text in FIXTURES:
            saved = client.add(
                text,
                user_id=user_id,
                agent_id="laplance-probe",
                session_id="synthetic",
                source="laplance-probe",
                scene="chat",
                meta={"laplance_source_id": source_id, "laplance_source_revision": revision},
            )
            if not saved.get("success"):
                raise RuntimeError(f"SDK add failed for {source_id}: {saved.get('error_code')}")
        result = client.search(
            FIXTURES[0][1],
            user_ids=[user_id],
            agent_ids=["laplance-probe"],
            scene="chat",
            min_score=-1,
            limit=10,
        )
        source_ids = recover_source_ids(result, revision, user_id)
        if "math-time" not in source_ids:
            raise AssertionError("Real SDK search did not preserve synthetic source attribution")
        deletion = client.delete_all(user_id=user_id)
        after = client.search(FIXTURES[0][1], user_ids=[user_id], scene="chat", min_score=-1)
        if after.get("memories", {}).get("normal"):
            raise AssertionError("Deleted user remains retrievable")
        return {
            "mode": mode,
            "sdk_add": "ok",
            "sdk_search": "ok",
            "attributed_source_ids": source_ids,
            "sdk_delete": "ok",
            "deleted_result_count": 0,
            "delete_status": deletion.get("success"),
        }
    finally:
        try:
            client.delete_all(user_id=user_id)
        finally:
            client.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("lite", "pro"), default="lite")
    parser.add_argument("--local-embedding", action="store_true")
    args = parser.parse_args()
    if args.local_embedding and args.mode != "lite":
        parser.error("mock embedding mode only supports lite (pro requires a real extraction model)")
    if args.local_embedding:
        with local_embedder():
            outcome = run_probe("lite")
    else:
        outcome = run_probe(args.mode)
    print(json.dumps(outcome, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
