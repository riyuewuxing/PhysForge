import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from PIL import Image

from visual_review_pack import pack, read_baseline


class ReviewPackTests(unittest.TestCase):
    def test_exact_baseline_priority_and_coverage(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            raw = root / "raw"
            raw.mkdir()
            for n in ("other.png", "H53_F07_a.png", "failure.png", "same.png"):
                Image.new("RGB", (20, 20), "red").save(raw / n)
            base = pack(raw, root / "base", "parent", "online", [], targets_only=True)
            self.assertEqual(base["count"], 4)
            self.assertEqual(base["selected_count"], 1)
            self.assertIsNone(read_baseline(root / "base/manifest.json", "wrong", "online"))
            self.assertIsNone(read_baseline(root / "base/manifest.json", "parent", "offline"))
            old = read_baseline(root / "base/manifest.json", "parent", "online")
            self.assertIsNotNone(old)
            Image.new("RGB", (20, 20), "blue").save(raw / "other.png")
            Image.new("RGB", (20, 20), "green").save(raw / "new.png")
            out = root / "new"
            m = pack(raw, out, "head", "online", ["H53_F07"], old, "parent",
                     target=500, hard=1000)
            self.assertFalse(m["errors"])
            self.assertEqual(m["count"], 5)
            self.assertEqual(m["selected_count"], 4)
            mapping = {r["path"]: r for r in m["images"]}
            self.assertEqual(mapping["same.png"]["change"], "UNCHANGED")
            self.assertIsNone(mapping["same.png"]["batch"])
            self.assertEqual(mapping["other.png"]["change"], "CHANGED")
            self.assertEqual(mapping["new.png"]["change"], "NEW")
            self.assertEqual(mapping["failure.png"]["batch"], 1)
            seen = set()
            for b in m["batches"]:
                self.assertLessEqual(b["bytes"], 1000)
                with zipfile.ZipFile(out / b["name"]) as z:
                    self.assertIsNone(z.testzip())
                    for n in z.namelist():
                        self.assertEqual(z.read(n), (raw / n).read_bytes())
                        self.assertNotIn(n, seen)
                        seen.add(n)
            self.assertEqual(seen, set(mapping) - {"same.png"})

    def test_no_baseline_and_corrupt_input(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            raw = root / "raw"
            raw.mkdir()
            Image.new("RGB", (10, 10)).save(raw / "ok.png")
            (raw / "corrupt.png").write_bytes(b"not a png")
            m = pack(raw, root / "out", "head", "offline", [])
            self.assertEqual(m["baseline_status"], "NOT_RUN")
            self.assertEqual(m["count"], 2)
            self.assertEqual(m["selected_count"], 1)
            self.assertTrue(m["errors"])
            self.assertIsNone(read_baseline(root / "out/manifest.json", "head", "offline"))

    def test_slot_and_size_overflow_not_silent(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            raw = root / "raw"
            raw.mkdir()
            for n in ("a.png", "b.png"):
                Image.new("RGB", (20, 20)).save(raw / n)
            m = pack(raw, root / "out", "head", "online", [],
                     target=400, hard=1000, max_batches=1)
            self.assertTrue(m["errors"])
            self.assertEqual(m["selected_count"], 2)
            self.assertEqual(len(m["batches"]), 1)
            m2 = pack(raw, root / "oversize", "head", "online", [], target=10, hard=20)
            self.assertTrue(m2["errors"])
            self.assertEqual(m2["batches"], [])


if __name__ == "__main__":
    unittest.main()
