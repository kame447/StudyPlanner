"""Actual Hy Memory SDK, local multilingual model and private HTTP bridge.

No user data, no external embedding/LLM requests, no persistent user index.
Model weights must have been cached in a separate bootstrap command.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import tempfile
from contextlib import contextmanager
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.request import Request, urlopen

from hy_memory_bridge import HyMemoryIndex, make_handler
from hy_memory_local_embeddings import LocalEmbeddingService, load_local_model


@contextmanager
def no_external_sockets():
    """Audit actual socket connects while the SDK executes, including httpx."""
    original = socket.socket.connect
    attempts = []

    def guarded(sock, address):
        if isinstance(address, tuple) and address[0] not in ("127.0.0.1", "::1"):
            attempts.append(str(address[0]))
            raise OSError("External network access forbidden during memory processing")
        return original(sock, address)

    socket.socket.connect = guarded
    try:
        yield attempts
    finally:
        socket.socket.connect = original


def smoke(model_cache: str) -> dict:
    model = load_local_model(model_cache, download=False)
    with tempfile.TemporaryDirectory(prefix="laplance-offline-hy-") as data_dir:
        local_embeddings = LocalEmbeddingService(model)
        local_embeddings.start()
        local_embeddings.configure_hy_memory(data_dir)
        os.environ["NO_PROXY"] = "127.0.0.1,localhost,::1"
        sdk = None
        index = None
        server = None
        thread = None
        try:
            with no_external_sockets() as attempted:
                from hy_memory import HyMemoryClient

                sdk = HyMemoryClient(mode="lite")
                index = HyMemoryIndex(sdk, str(Path(data_dir) / "index.sqlite"))
                token = "local-e2e-" + "x" * 48
                server = ThreadingHTTPServer(
                    ("127.0.0.1", 0), make_handler(index, token)
                )
                thread = Thread(target=server.serve_forever, daemon=True)
                thread.start()

                def post(route: str, body: dict) -> dict:
                    request = Request(
                        f"http://127.0.0.1:{server.server_port}{route}",
                        json.dumps(body, ensure_ascii=False).encode(),
                        {
                            "Content-Type": "application/json",
                            "Authorization": "Bearer " + token,
                        },
                    )
                    with urlopen(request, timeout=90) as response:
                        return json.load(response)

                owner = "synthetic-offline-owner"
                index_result = post("/v1/index", {
                    "ownerId": owner,
                    "sourceRevision": 1,
                    "records": [
                        {"id": "math", "text": "数学は夕方に学習したい"},
                        {"id": "english", "text": "TOEICの目標点数は800点"},
                        {"id": "music", "text": "土曜日にピアノの練習をする"},
                    ],
                })
                assert index_result.get("indexed") == 3, index_result
                queries = {
                    "math": "数学の勉強は何時ごろ進めたい？",
                    "english": "TOEICで狙っている点数は何点？",
                    "music": "楽器の練習は何曜日？",
                }
                results = {
                    key: post("/v1/search", {
                        "ownerId": owner,
                        "sourceRevision": 1,
                        "query": query,
                    }).get("recordIds", [])
                    for key, query in queries.items()
                }
                if not all(key in ids for key, ids in results.items()):
                    raise AssertionError(f"Japanese semantic retrieval missed: {results}")

                old_revision = post("/v1/search", {
                    "ownerId": owner, "sourceRevision": 0, "query": "数学",
                })
                assert old_revision["status"] == "unavailable", old_revision
                forget = post("/v1/forget", {"ownerId": owner, "sourceRevision": 2})
                after = post("/v1/search", {
                    "ownerId": owner, "sourceRevision": 2, "query": "数学",
                })
                assert forget["status"] == "ready", forget
                assert after == {
                    "status": "ready",
                    "ownerId": owner,
                    "sourceRevision": 2,
                    "recordIds": [],
                }, after
                if attempted:
                    raise AssertionError("External sockets attempted: " + ",".join(attempted))
                return {
                    "sdk": "hy-memory==2.0.2",
                    "embedding": "local multilingual MiniLM (384 dimensions)",
                    "japanese_synthetic_retrieval": {key: key in ids for key, ids in results.items()},
                    "revision_guard": "passed",
                    "forget": "passed",
                    "external_socket_attempts": 0,
                }
        finally:
            if server:
                server.shutdown()
                server.server_close()
            if thread:
                thread.join(timeout=5)
            if index:
                index.close()
            elif sdk:
                sdk.close()
            local_embeddings.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-cache-dir", required=True)
    args = parser.parse_args()
    print(json.dumps(smoke(args.model_cache_dir), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
