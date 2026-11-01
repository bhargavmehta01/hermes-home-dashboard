"""Panels route: read-only, size-capped, path-safe, strict schema v1.

Run: python3 -m unittest test.test_plugin_api_panels
"""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from dashboard import plugin_api

NOW = "2026-11-01T20:00:00Z"


def stat(pid, **kw):
    return {"id": pid, "title": pid.title(), "kind": "stat", "value": 1.5, "updated_at": NOW, **kw}


class PanelsApiTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.env = patch.dict(os.environ, {"HERMES_HOME": str(self.home)})
        self.env.start()
        (self.home / "panels").mkdir()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def write(self, rel, doc):
        p = self.home / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(doc if isinstance(doc, str) else json.dumps(doc), "utf-8")
        return p

    async def test_lists_valid_panels_from_root_and_profiles(self):
        self.write("panels/daily-cost.json", stat("daily-cost", unit="USD", delta="+4%", stale_after_minutes=1500))
        self.write("profiles/ops/panels/bgroute.json", {
            "id": "bgroute", "title": "bgroute", "kind": "list", "updated_at": NOW,
            "items": [{"label": "flex", "value": "on", "url": "https://openrouter.ai"}, {"value": 1}],
        })
        out = await plugin_api.get_panels()
        self.assertEqual(out["version"], 1)
        self.assertEqual(out["skipped"], 0)
        keys = [p["key"] for p in out["panels"]]
        self.assertEqual(keys, ["daily-cost", "ops/bgroute"])
        root, ops = out["panels"]
        self.assertEqual(root["profile"], None)
        self.assertEqual(root["unit"], "USD")
        self.assertEqual(root["stale_after_minutes"], 1500)
        self.assertEqual(ops["items"], [{"label": "flex", "value": "on", "url": "https://openrouter.ai"}])

    async def test_bad_files_are_skipped_not_fatal(self):
        self.write("panels/ok.json", stat("ok"))
        self.write("panels/broken.json", "{not json")
        self.write("panels/mismatch.json", stat("other"))
        self.write("panels/nokind.json", {"id": "nokind", "title": "x", "updated_at": NOW})
        self.write("panels/badtime.json", stat("badtime", updated_at="yesterday"))
        self.write("panels/novalue.json", {"id": "novalue", "title": "x", "kind": "stat", "updated_at": NOW})
        self.write("panels/Bad Name.json", stat("bad name"))
        self.write("panels/big.json", stat("big", subtitle="x" * (plugin_api.PANEL_MAX_BYTES + 10)))
        self.write("panels/list.json", [1, 2, 3])
        self.write("panels/notes.txt", "ignored, not json")
        out = plugin_api.list_panels()
        self.assertEqual([p["id"] for p in out["panels"]], ["ok"])
        self.assertEqual(out["skipped"], 8)

    async def test_symlinks_are_never_followed(self):
        secret = self.write("outside/secret.json", stat("secret"))
        os.symlink(secret, self.home / "panels" / "secret.json")
        (self.home / "profiles").mkdir()
        os.symlink(self.home / "outside", self.home / "profiles" / "evil")
        out = plugin_api.list_panels()
        self.assertEqual(out["panels"], [])
        self.assertEqual(out["skipped"], 1)

    async def test_urls_kinds_and_clipping(self):
        self.write("panels/t.json", {
            "id": "t", "title": "T" * 500, "kind": "table", "updated_at": "2026-11-01T15:00:00-05:00",
            "link": "javascript:alert(1)", "columns": ["a", "b"], "rows": [[1, "x", "extra"], ["only"], "bad"],
        })
        self.write("panels/w.json", {"id": "w", "title": "W", "kind": "text", "updated_at": NOW,
                                     "text": "hello\nworld", "link": "https://example.com/w"})
        self.write("panels/n.json", stat("n", value=True))
        out = {p["id"]: p for p in plugin_api.list_panels()["panels"]}
        self.assertNotIn("n", out)  # bool value is not a display value
        t = out["t"]
        self.assertEqual(len(t["title"]), 80)
        self.assertNotIn("link", t)
        self.assertEqual(t["rows"], [[1, "x"], ["only", None]])
        self.assertEqual(out["w"]["text"], "hello\nworld")
        self.assertEqual(out["w"]["link"], "https://example.com/w")

    async def test_missing_dir_is_empty(self):
        os.rmdir(self.home / "panels")
        self.assertEqual(plugin_api.list_panels(), {"version": 1, "panels": [], "skipped": 0})


if __name__ == "__main__":
    unittest.main()
