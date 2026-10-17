"""Local embedding transport regression checks; never downloads model weights."""

from __future__ import annotations

import json
import os
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from hy_memory_local_embeddings import (
    MODEL_DIMENSIONS,
    MODEL_ID,
    LocalEmbeddingService,
)


class FakeModel:
    embedding_size = MODEL_DIMENSIONS

    def embed(self, texts, batch_size=32):
        for text in texts:
            yield [float(len(text))] * MODEL_DIMENSIONS


class LocalEmbeddingServiceTests(unittest.TestCase):
    def setUp(self):
        self.server = LocalEmbeddingService(FakeModel())
        self.server.start()

    def tearDown(self):
        self.server.close()

    def post(self, body, token=None):
        request = Request(
            self.server.base_url + "/embeddings",
            json.dumps(body).encode("utf-8"),
            {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + (token or "not-the-token"),
            },
        )
        with urlopen(request, timeout=3) as response:
            return response.status, json.load(response)

    def test_local_only_and_authentication(self):
        self.assertTrue(self.server.base_url.startswith("http://127.0.0.1:"))
        with self.assertRaises(HTTPError) as error:
            self.post({"model": MODEL_ID, "input": ["日本語"]})
        self.assertEqual(error.exception.code, 401)

    def test_dimensions_order_and_model_identity(self):
        status, result = self.post(
            {
                "model": MODEL_ID,
                "dimensions": MODEL_DIMENSIONS,
                "input": ["数学", "英語の目標"],
            },
            token=self.server.token,
        )
        self.assertEqual(status, 200)
        self.assertEqual([item["index"] for item in result["data"]], [0, 1])
        self.assertEqual(len(result["data"][0]["embedding"]), MODEL_DIMENSIONS)
        self.assertNotEqual(result["data"][0]["embedding"], result["data"][1]["embedding"])

    def test_unexpected_model_and_dimension_are_rejected(self):
        for model, dimensions in [("text-embedding-3-small", 384), (MODEL_ID, 1536)]:
            with self.assertRaises(HTTPError) as error:
                self.post(
                    {"model": model, "dimensions": dimensions, "input": ["日本語"]},
                    token=self.server.token,
                )
            self.assertEqual(error.exception.code, 400)

    def test_configuration_forces_offline_sdk_inference(self):
        previous = dict(os.environ)
        try:
            os.environ["MEMORY_EMBEDDER_BASE_URL"] = "https://external-embedding.invalid/v1"
            os.environ["MEMORY_LLM_BASE_URL"] = "https://external-chat.invalid/v1"
            os.environ["HTTP_PROXY"] = "https://untrusted-proxy.invalid"
            os.environ["MEMORY_VECTOR_HOST"] = "untrusted-storage.invalid"
            self.server.configure_hy_memory("/tmp/laplance-test-memory")
            self.assertNotIn("HTTP_PROXY", os.environ)
            self.assertNotIn("MEMORY_VECTOR_HOST", os.environ)
            self.assertEqual(os.environ["NO_PROXY"], "127.0.0.1,localhost,::1")
            self.assertEqual(os.environ["MEMORY_MODE"], "lite")
            self.assertEqual(os.environ["MEMORY_EMBEDDER_BASE_URL"], self.server.base_url)
            self.assertEqual(os.environ["MEMORY_EMBEDDER_API_KEY"], self.server.token)
            self.assertEqual(os.environ["MEMORY_EMBEDDING_DIMS"], "384")
            self.assertEqual(os.environ["MEMORY_LLM_BASE_URL"], self.server.base_url)
            self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")
            self.assertEqual(os.environ["MEMORY_VECTOR_STORE"], "chroma")
        finally:
            os.environ.clear()
            os.environ.update(previous)


if __name__ == "__main__":
    unittest.main()
