"""Contract tests for the private Laplance <-> Hy Memory HTTP bridge."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hy_memory_bridge import AGENT_ID, SOURCE, HyMemoryIndex, _source_ids, make_handler


class FakeHyMemory:
    def __init__(self):
        self.entries = {}
        self.fail_next_add = False

    def delete_all(self, user_id):
        self.entries[user_id] = []
        return {"success": True}

    def add(self, content, *, user_id, agent_id, source, meta, **_options):
        if self.fail_next_add:
            self.fail_next_add = False
            return {"success": False}
        self.entries.setdefault(user_id, []).append({
            "user_id": user_id, "agent_id": agent_id, "source": source,
            "content": content, "meta": [meta],
        })
        return {"success": True}

    def search(self, query, *, user_ids, **_options):
        # Deterministic mock ranking; the real SDK is exercised by hy_memory_probe.py.
        return {
            "rewrite": {"used": False},
            "memories": {"normal": list(self.entries.get(user_ids[0], []))},
        }

    def close(self):
        pass


class BridgeContractTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.sdk = FakeHyMemory()
        self.index = HyMemoryIndex(self.sdk, str(Path(self.temp_dir.name) / "index.sqlite"))

    def tearDown(self):
        self.index.close()
        self.temp_dir.cleanup()

    def test_index_then_recall_and_forget_with_revision_fence(self):
        stored = self.index.rebuild("user-a", 5, [
            {"id": "math", "text": "数学は夕方に勉強したい"},
            {"id": "goal", "text": "英語の目標は800点"},
        ])
        self.assertEqual(stored["status"], "ready")
        self.assertEqual(
            self.index.search("user-a", 5, "数学")["recordIds"], ["math", "goal"]
        )
        self.assertEqual(self.index.search("user-a", 4, "数学"), {"status": "unavailable"})
        self.assertEqual(self.index.search("user-b", 5, "数学"), {"status": "unavailable"})
        self.assertEqual(self.index.forget("user-a", 6)["status"], "ready")
        self.assertEqual(self.index.search("user-a", 6, "数学")["recordIds"], [])
        self.assertEqual(self.index.rebuild("user-a", 5, [{"id": "old", "text": "復活"}])["status"], "stale")
        self.assertEqual(self.index.search("user-a", 6, "数学")["recordIds"], [])

    def test_index_failure_is_not_exposed_as_success(self):
        self.sdk.fail_next_add = True
        with self.assertRaises(RuntimeError):
            self.index.rebuild("user-a", 1, [{"id": "a", "text": "内容"}])
        self.assertEqual(self.index.search("user-a", 1, "内容"), {"status": "unavailable"})
        self.assertEqual(self.index.rebuild("user-a", 1, [{"id": "a", "text": "内容"}])["status"], "ready")

    def test_ambiguous_and_wrong_owner_evidence_is_rejected(self):
        base = {"user_id": "user-a", "agent_id": AGENT_ID, "source": SOURCE}
        response = {"rewrite": {}, "memories": {"normal": [
            {**base, "meta": [{"laplance_source_id": "valid", "laplance_source_revision": 4}]},
            {**base, "meta": [{"laplance_source_id": "old", "laplance_source_revision": 3}]},
            {**base, "meta": [
                {"laplance_source_id": "merged1", "laplance_source_revision": 4},
                {"laplance_source_id": "merged2", "laplance_source_revision": 4},
            ]},
            {**base, "user_id": "user-b", "meta": [{"laplance_source_id": "leak", "laplance_source_revision": 4}]},
        ]}}
        self.assertEqual(_source_ids(response, "user-a", 4), ["valid"])
        with self.assertRaises(RuntimeError):
            _source_ids({"memories": {"normal": []}}, "user-a", 4)

    def test_http_auth_and_no_content_in_search_response(self):
        self.index.rebuild("user-a", 1, [{"id": "item", "text": "private content"}])
        token = "s" * 40
        http = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.index, token))
        thread = Thread(target=http.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{http.server_port}/v1/search"
        try:
            body = json.dumps({"ownerId": "user-a", "sourceRevision": 1, "query": "content"}).encode()
            with self.assertRaises(HTTPError) as caught:
                urlopen(Request(url, body, {"Content-Type": "application/json"}))
            self.assertEqual(caught.exception.code, 401)
            request = Request(url, body, {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token,
            })
            with urlopen(request) as reply:
                result = json.load(reply)
            self.assertEqual(result["recordIds"], ["item"])
            self.assertNotIn("private content", json.dumps(result))
        finally:
            http.shutdown()
            http.server_close()
            thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
