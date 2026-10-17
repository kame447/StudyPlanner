"""Local-only multilingual vector embeddings for Laplance's Hy Memory bridge.

Model weights are downloaded separately at setup time. The running memory
service requires cached weights and never contacts a model or embedding API.
"""

from __future__ import annotations

import argparse
import hmac
import json
import math
import os
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock, Thread
from typing import Any, Iterable

MODEL_REPOSITORY = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
MODEL_ID = "laplance-multilingual-minilm-l12-v2"
MODEL_DIMENSIONS = 384
COLLECTION_NAME = "laplance_multilingual_minilm_l12_v2_384"
MAX_BODY_BYTES = 512 * 1024
MAX_ITEMS = 128
MAX_TEXT_CHARS = 4096


def load_local_model(model_cache: str, *, download: bool = False) -> Any:
    if not model_cache or not Path(model_cache).is_absolute():
        raise ValueError("An absolute model cache directory is required.")
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    if not download:
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
    from fastembed import TextEmbedding

    model = TextEmbedding(
        model_name=MODEL_REPOSITORY,
        cache_dir=model_cache,
        local_files_only=not download,
        threads=2,
    )
    if model.embedding_size != MODEL_DIMENSIONS:
        raise ValueError("Unexpected local embedding model dimension")
    return model


class LocalEmbeddingService:
    """OpenAI-compatible embedding endpoint bound to 127.0.0.1 only."""

    def __init__(self, model: Any):
        self.model = model
        self.lock = Lock()
        self.token = secrets.token_urlsafe(48)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self.thread = Thread(target=self.server.serve_forever, daemon=True)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}/v1"

    def _handler(self) -> type[BaseHTTPRequestHandler]:
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args: Any) -> None:
                return

            def reply(self, code: int, value: dict[str, Any]) -> None:
                data = json.dumps(value, ensure_ascii=False).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self) -> None:
                if self.path != "/v1/embeddings":
                    self.reply(404, {"error": "not_found"})
                    return
                if not hmac.compare_digest(
                    self.headers.get("Authorization", ""), f"Bearer {owner.token}"
                ):
                    self.reply(401, {"error": "unauthorized"})
                    return
                try:
                    size = int(self.headers.get("Content-Length", "0"))
                    if not 0 < size <= MAX_BODY_BYTES:
                        raise ValueError("size")
                    payload = json.loads(self.rfile.read(size))
                    if not isinstance(payload, dict) or payload.get("model") != MODEL_ID:
                        raise ValueError("model")
                    dims = payload.get("dimensions")
                    if dims is not None and (
                        type(dims) is not int or dims != MODEL_DIMENSIONS
                    ):
                        raise ValueError("dimensions")
                    texts = payload.get("input")
                    if isinstance(texts, str):
                        texts = [texts]
                    if (
                        not isinstance(texts, list)
                        or not 1 <= len(texts) <= MAX_ITEMS
                        or not all(
                            isinstance(item, str)
                            and 0 < len(item) <= MAX_TEXT_CHARS
                            for item in texts
                        )
                    ):
                        raise ValueError("texts")
                    with owner.lock:
                        vectors = list(owner.model.embed(texts, batch_size=32))
                    if len(vectors) != len(texts):
                        raise RuntimeError("Incomplete local embeddings")
                    data = []
                    for i, vector in enumerate(vectors):
                        values = [float(v) for v in vector]
                        if len(values) != MODEL_DIMENSIONS or not all(
                            math.isfinite(v) for v in values
                        ):
                            raise RuntimeError("Invalid local embedding output")
                        data.append({
                            "object": "embedding",
                            "index": i,
                            "embedding": values,
                        })
                    response = {
                        "object": "list",
                        "model": MODEL_ID,
                        "data": data,
                        "usage": {"prompt_tokens": 0, "total_tokens": 0},
                    }
                except (ValueError, TypeError, json.JSONDecodeError):
                    self.reply(400, {"error": "invalid_embedding_request"})
                    return
                except Exception:
                    self.reply(503, {"error": "local_embedding_unavailable"})
                    return
                self.reply(200, response)

        return Handler

    def start(self) -> None:
        self.thread.start()

    def configure_hy_memory(self, data_dir: str) -> None:
        """Pin every inference endpoint to loopback; fail closed, never fallback."""
        if not data_dir or not Path(data_dir).is_absolute():
            raise ValueError("Explicit absolute MEMORY_DATA_DIR is required")
        overrides = {
            "MEMORY_DATA_DIR": data_dir,
            "MEMORY_MODE": "lite",
            "MEMORY_EMBEDDER_PROVIDER": "openai",
            "MEMORY_EMBEDDER_BASE_URL": self.base_url,
            "MEMORY_EMBEDDER_API_KEY": self.token,
            "MEMORY_EMBEDDER_MODEL": MODEL_ID,
            "MEMORY_EMBEDDING_DIMS": str(MODEL_DIMENSIONS),
            "MEMORY_VECTOR_STORE": "chroma",
            "MEMORY_COLLECTION_NAME": COLLECTION_NAME,
            "MEMORY_PERSIST_DIR": str(Path(data_dir) / "data" / "vector_db"),
            "MEMORY_CACHE_BACKEND": "sqlite",
            "MEMORY_CACHE_DB_PATH": str(Path(data_dir) / "data" / "cache.db"),
            "MEMORY_HISTORY_DB_PATH": str(Path(data_dir) / "data" / "history.db"),
            "MEMORY_ENABLE_GRAPH": "false",
            "MEMORY_ENABLE_INTENTION": "false",
            "MEMORY_CODING_ENABLED": "false",
            "MEMORY_ENABLE_QUERY_REWRITE": "false",
            "MEMORY_LOCAL_RERANK_ENABLED": "false",
            "MEMORY_LLM_BASE_URL": self.base_url,
            "MEMORY_LLM_API_KEY": self.token,
            "MEMORY_LLM_MODEL": "disabled",
            "MEMORY_LOG_LEVEL": "WARNING",
            "MEMORY_LOG_LLM_CONTENT": "false",
            "MEMORY_HISTORY_ENABLE": "false",
            "MEMORY_PIPELINE_TRACE_ENABLED": "false",
        }
        # This dedicated process must not inherit proxy/remote-store settings.
        # The existing Laplance conversational AI runs in a different Worker.
        for key in (
            "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
            "http_proxy", "https_proxy", "all_proxy",
            "MEMORY_VECTOR_HOST", "MEMORY_VECTOR_PORT", "MEMORY_VECTOR_API_KEY",
            "MEMORY_LLM_EXTRA_HEADERS", "MEMORY_LLM_EXTRA_BODY",
            "MEMORY_EMBEDDER_EXTRA_HEADERS", "MEMORY_EMBEDDER_EXTRA_BODY",
        ):
            os.environ.pop(key, None)
        os.environ.update(overrides)
        os.environ["NO_PROXY"] = "127.0.0.1,localhost,::1"
        os.environ["no_proxy"] = "127.0.0.1,localhost,::1"
        # Missing model files fail startup; inference never downloads weights.
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["ANONYMIZED_TELEMETRY"] = "FALSE"
        os.environ["DO_NOT_TRACK"] = "1"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download-model", action="store_true")
    parser.add_argument("--model-cache-dir", required=True)
    args = parser.parse_args()
    model = load_local_model(args.model_cache_dir, download=args.download_model)
    result = list(model.embed(["数学の勉強を夕方に進めたい"]))
    if len(result) != 1 or len(result[0]) != MODEL_DIMENSIONS:
        raise RuntimeError("Local embedding model self-check failed")
    print(json.dumps({
        "model": MODEL_REPOSITORY,
        "dimensions": MODEL_DIMENSIONS,
        "download_enabled": args.download_model,
        "ready": True,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
