import json
import sys
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

from PIL import Image

from visual_review_pack import exact_parent_runs, main, pack, read_baseline, resolve_base


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

    def test_branch_index_recovers_exact_parent_without_guessing(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "out"
            args = SimpleNamespace(repo="owner/repo", head="parent",
                                   base_branch="polish/parent", phase="online",
                                   prefixes=[], out=out)
            path = ".github/workflows/v31-polish-audit.yml"
            def run(i, sha="parent", workflow=path, conclusion="success"):
                return dict(id=i, head_sha=sha, path=workflow, conclusion=conclusion)
            def index(query):
                if "head_sha=" in query:
                    return {"workflow_runs": []}
                if "branch=" in query:
                    self.assertIn("polish%2Fparent", query)
                    return {"workflow_runs": [run(1, "newer"), run(2, workflow=".github/workflows/ci.yml"),
                                              run(3, conclusion="failure"), run(4)]}
                self.assertIn("/runs/4/artifacts", query)
                return {"artifacts": [{"id": 7, "expired": False,
                                       "name": "v31-polish-review-manifest-online"}]}
            def download(repo, run_id, name, dest):
                self.assertEqual((repo, run_id, name),
                                 ("owner/repo", 4, "v31-polish-review-manifest-online"))
                dest.mkdir(parents=True, exist_ok=True)
                (dest / "manifest.json").write_text(json.dumps(dict(
                    schema=1, head_sha="parent", phase="online",
                    images=[dict(path="a.png", sha256="a"*64)], errors=[])))
            with patch("visual_review_pack.gh_json", side_effect=index), \
                    patch("visual_review_pack.gh_download", side_effect=download) as dl:
                self.assertEqual(resolve_base(args), 0)
                self.assertIsNotNone(read_baseline(out / "manifest.json", "parent", "online"))
                self.assertEqual(dl.call_count, 1)

    def test_no_exact_parent_does_not_use_branch_latest(self):
        args = SimpleNamespace(repo="owner/repo", head="parent", base_branch="polish/parent")
        with patch("visual_review_pack.gh_json", return_value={"workflow_runs": [
            dict(id=7, head_sha="newer", conclusion="success",
                 path=".github/workflows/v31-polish-audit.yml")]}):
            self.assertEqual(list(exact_parent_runs(args)), [])

    def test_required_parent_retries_exact_sha_after_early_lookup_miss(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            raw = root / "raw"
            raw.mkdir()
            Image.new("RGB", (12, 12), "blue").save(raw / "actual.png")
            early = root / "early.json"
            early.write_text(json.dumps(dict(schema=1, head_sha="parent", phase="online",
                images=[], errors=["exact parent visual evidence unavailable"])))
            args = ["visual_review_pack.py", "--raw", str(raw), "--out", str(root / "out"),
                    "--head", "child", "--base-sha", "parent", "--phase", "online",
                    "--baseline", str(early), "--require-baseline", "--repo", "owner/repo",
                    "--base-branch", "polish/v31-parent"]
            def late_lookup(a):
                self.assertEqual((a.head, a.phase, a.base_branch),
                                 ("parent", "online", "polish/v31-parent"))
                pack(raw, a.out, a.head, a.phase, [], targets_only=True)
                return 0
            with patch.object(sys, "argv", args), patch("visual_review_pack.resolve_base",
                    side_effect=late_lookup) as retry:
                self.assertEqual(main(), 0)
                self.assertEqual(retry.call_count, 1)
            manifest = json.loads((root / "out/manifest.json").read_text())
            self.assertEqual(manifest["baseline_status"], "COMPARED")
            self.assertEqual(manifest["images"][0]["change"], "UNCHANGED")

    def test_required_parent_missing_or_wrong_sha_fails_but_preserves_evidence(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            raw = root / "raw"
            raw.mkdir()
            Image.new("RGB", (12, 12), "blue").save(raw / "actual.png")
            wrong = root / "wrong"
            pack(raw, wrong, "different-sha", "offline", [])
            args = ["visual_review_pack.py", "--raw", str(raw), "--out", str(root / "out"),
                    "--head", "child", "--base-sha", "parent", "--phase", "offline",
                    "--baseline", str(wrong / "manifest.json"), "--require-baseline",
                    "--repo", "owner/repo"]
            def wrong_retry(a):
                pack(raw, a.out, "different-sha", "offline", [])
                return 0
            with patch.object(sys, "argv", args), patch("visual_review_pack.resolve_base",
                    side_effect=wrong_retry):
                self.assertEqual(main(), 1)
            manifest = json.loads((root / "out/manifest.json").read_text())
            self.assertEqual(manifest["baseline_status"], "NOT_RUN")
            self.assertIn("required exact parent comparison unavailable", manifest["errors"])
            self.assertEqual(manifest["selected_count"], 1)
            with zipfile.ZipFile(root / "out/review-01.zip") as z:
                self.assertEqual(z.read("actual.png"), (raw / "actual.png").read_bytes())

    def test_first_unstacked_baseline_remains_optional(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            raw = root / "raw"
            raw.mkdir()
            Image.new("RGB", (12, 12), "blue").save(raw / "actual.png")
            args = ["visual_review_pack.py", "--raw", str(raw), "--out", str(root / "out"),
                    "--head", "child", "--base-sha", "main", "--phase", "offline"]
            with patch.object(sys, "argv", args), patch("visual_review_pack.resolve_base") as retry:
                self.assertEqual(main(), 0)
                retry.assert_not_called()
            self.assertEqual(json.loads((root / "out/manifest.json").read_text())["baseline_status"], "NOT_RUN")

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
