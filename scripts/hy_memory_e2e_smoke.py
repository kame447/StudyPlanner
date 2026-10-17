"""Loopback HTTP smoke: real Hy Memory SDK, private bridge, mock embeddings.

No cloud provider calls, real account data, or persistent production storage.
"""

from __future__ import annotations

import json
import tempfile
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.request import Request, urlopen

from hy_memory_probe import local_embedder
from hy_memory_bridge import HyMemoryIndex, make_handler


def main() -> None:
    # Env must be set before the SDK config is imported.
    with local_embedder():
        from hy_memory import HyMemoryClient

        with tempfile.TemporaryDirectory(prefix="laplance-bridge-e2e-") as state_dir:
            engine = HyMemoryIndex(
                HyMemoryClient(mode="lite"),
                str(Path(state_dir) / "state.sqlite"),
            )
            token = "laplance-synthetic-e2e-" + "a" * 40
            server = ThreadingHTTPServer(
                ("127.0.0.1", 0), make_handler(engine, token)
            )
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()

            def post(path: str, payload: dict) -> dict:
                request = Request(
                    f"http://127.0.0.1:{server.server_port}{path}",
                    json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                    {
                        "Content-Type": "application/json",
                        "Authorization": "Bearer " + token,
                    },
                    method="POST",
                )
                with urlopen(request, timeout=40) as response:
                    return json.load(response)

            try:
                result = post("/v1/index", {
                    "ownerId": "synthetic-user-1",
                    "sourceRevision": 7,
                    "records": [
                        {"id": "math-evening", "text": "数学の勉強は夕方にしたい"},
                        {"id": "english-goal", "text": "TOEICの目標は800点"},
                    ],
                })
                if result.get("status") != "ready" or result.get("indexed") != 2:
                    raise RuntimeError("Index response did not confirm the synthetic records")
                search = post("/v1/search", {
                    "ownerId": "synthetic-user-1",
                    "sourceRevision": 7,
                    "query": "数学の勉強は夕方にしたい",
                })
                if search.get("status") != "ready" or "math-evening" not in search.get("recordIds", []):
                    raise RuntimeError("Actual SDK search did not resolve a canonical record ID")
                stale = post("/v1/search", {
                    "ownerId": "synthetic-user-1",
                    "sourceRevision": 6,
                    "query": "数学",
                })
                if stale.get("status") != "unavailable":
                    raise RuntimeError("Index returned stale revision")
                forget = post("/v1/forget", {
                    "ownerId": "synthetic-user-1",
                    "sourceRevision": 8,
                })
                after = post("/v1/search", {
                    "ownerId": "synthetic-user-1",
                    "sourceRevision": 8,
                    "query": "数学",
                })
                if forget.get("status") != "ready" or after.get("recordIds") != []:
                    raise RuntimeError("Forgotten memory remained retrievable")
                print(json.dumps({
                    "sdk": "hy-memory==2.0.2",
                    "transport": "authenticated loopback HTTP",
                    "index": "ok",
                    "search_attribution": "ok",
                    "stale_revision": "rejected",
                    "forget": "ok",
                    "network": "local embedding mock only",
                }, ensure_ascii=False, indent=2))
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)
                engine.close()


if __name__ == "__main__":
    main()
