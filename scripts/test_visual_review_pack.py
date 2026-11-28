import json
import hashlib
import subprocess
import sys
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

from PIL import Image

from visual_review_pack import (BASELINE_MISSING, exact_parent_runs, failed_capture_proof,
    gh_verified_extract, main, pack, read_baseline, recover_failed_capture,
    resolve_base, scan, unique_artifact, validate_failed_review)


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
                return dict(id=i, head_sha=sha, path=workflow, status='completed', conclusion=conclusion)
            def index(query):
                if "head_sha=" in query:
                    return {"workflow_runs": []}
                if "branch=" in query:
                    self.assertIn("polish%2Fparent", query)
                    return {"workflow_runs": [run(1, "newer"), run(2, workflow=".github/workflows/ci.yml"),
                                              run(3, conclusion="cancelled"), run(4)]}
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
            dict(id=7, head_sha="newer", status="completed", conclusion="success",
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



class FailedReviewRecoveryTests(unittest.TestCase):
    HEAD = "a" * 40
    CHECKOUT = "b" * 40
    TREE = "c" * 40
    RUN = 23

    def run_meta(self):
        return dict(id=self.RUN, head_sha=self.HEAD, status="completed",
                    conclusion="failure", event="pull_request", run_attempt=1,
                    path=".github/workflows/v31-polish-audit.yml")

    def jobs(self):
        rows = []
        for i, phase in enumerate(("online", "offline")):
            steps = ["Run actions/checkout@v4", "Run pnpm build",
                     "Run pnpm audit:visual", "Run actions/upload-artifact@v4"]
            if phase == "offline":
                steps.append("Run pnpm export:release --v3-audit")
            rows.append(dict(id=100+i, name=f"visual ({phase})", status="completed",
                conclusion="success", head_sha=self.HEAD, run_id=self.RUN, run_attempt=1,
                steps=[dict(name=n, status="completed", conclusion="success") for n in steps]))
            rows.append(dict(id=200+i, name=f"Lossless bounded screenshot review ({phase})",
                             status="completed", conclusion="failure"))
        return dict(total_count=len(rows), jobs=rows)

    def artifact(self, path, name, id):
        raw = path.read_bytes()
        return dict(id=id, name=name, expired=False, size_in_bytes=len(raw),
                    digest="sha256:"+hashlib.sha256(raw).hexdigest(),
                    workflow_run=dict(id=self.RUN, head_sha=self.HEAD))

    def fixture(self, root):
        raw = root / "fixture"
        raw.mkdir()
        Image.new("RGB", (30, 24), "red").save(raw / "one.png")
        (raw/"nested").mkdir()
        Image.new("RGB", (20, 15), "blue").save(raw / "nested/two.png")
        manifest = dict(schema=1, head_sha=self.HEAD, checkout_sha=self.CHECKOUT,
                        phase="online", source=dict(run_id=str(self.RUN)), targets_only=False,
                        baseline_status="NOT_RUN", errors=[BASELINE_MISSING], count=2,
                        selected_count=2, images=[dict(r, change="NOT_RUN") for r in scan(raw)])
        rz = root / "raw.zip"
        mz = root / "manifest.zip"
        with zipfile.ZipFile(rz,"w") as z:
            for p in raw.rglob("*.png"):
                z.write(p, p.relative_to(raw).as_posix())
        with zipfile.ZipFile(mz,"w") as z:
            z.writestr("manifest.json", json.dumps(manifest))
        arts = [self.artifact(rz, "v31-polish-visual-online", 1),
                self.artifact(mz, "v31-polish-review-manifest-online", 2)]
        args = SimpleNamespace(repo="owner/repo",head=self.HEAD,phase="online",
                               prefixes=[],out=root/"out",base_branch="polish/v31-parent")
        return args, arts, {1:rz, 2:mz}

    def fake_subprocess(self, archives):
        def run(command, **kwargs):
            self.assertEqual(command[:2], ["gh", "api"])
            artifact_id = int(command[-1].split("/")[-2])
            kwargs["stdout"].write(archives[artifact_id].read_bytes())
            return subprocess.CompletedProcess(command,0)
        return run

    def fake_gh_json(self, query, jobs=None, mismatched_tree=False, arts=None):
        if "/jobs?" in query:
            return jobs if jobs is not None else self.jobs()
        if "/git/commits/" in query:
            sha = query.rsplit("/",1)[-1]
            return dict(sha=sha, tree=dict(sha="d"*40 if mismatched_tree and sha==self.CHECKOUT else self.TREE))
        if query.endswith("/artifacts?per_page=100"):
            return dict(artifacts=arts or [])
        if "/runs?" in query:
            self.assertTrue("status=completed" in query or "branch=" in query)
            return dict(workflow_runs=[self.run_meta()])
        raise AssertionError(query)

    def test_verified_failed_parent_recovers_full_original_png_index_not_release(self):
        with tempfile.TemporaryDirectory() as td:
            args, arts, archives = self.fixture(Path(td))
            with patch("visual_review_pack.gh_json",side_effect=lambda q:self.fake_gh_json(q,arts=arts)), \
                 patch("visual_review_pack.subprocess.run",side_effect=self.fake_subprocess(archives)):
                self.assertEqual(resolve_base(args),0)
            data=read_baseline(args.out/"manifest.json",self.HEAD,"online")
            self.assertIsNotNone(data)
            self.assertEqual(data["count"],2)
            self.assertEqual(data["baseline_status"],"NOT_RUN")
            self.assertEqual(data["source"]["run_conclusion"],"failure")
            self.assertEqual(data["source"]["capture_job_id"],100)
            self.assertEqual(data["source"]["artifact_id"],1)
            self.assertEqual(data["source"]["verified_checkout_sha"],self.CHECKOUT)
            self.assertEqual({r["path"] for r in data["images"]},{"one.png","nested/two.png"})

    def test_wrong_run_or_sha_or_ambiguous_artifact_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            args, arts, _ = self.fixture(Path(td))
            name=arts[0]["name"]
            for other in (dict(id=99,head_sha=self.HEAD),dict(id=self.RUN,head_sha="f"*40)):
                a=dict(arts[0],workflow_run=other)
                with self.assertRaises(ValueError):
                    unique_artifact([a],name,self.run_meta())
            with self.assertRaises(ValueError):
                unique_artifact([arts[0],arts[0]],name,self.run_meta())

    def test_failed_capture_or_non_review_failure_rejected(self):
        for case in ("raw_failure","wrong_sha","missing_export","non_review_failure","duplicate_job","incomplete"):
            jobs=self.jobs()
            if case=="raw_failure":
                jobs["jobs"][0]["conclusion"]="failure"
            elif case=="wrong_sha":
                jobs["jobs"][0]["head_sha"]="f"*40
            elif case=="missing_export":
                jobs["jobs"][2]["steps"][-1]["conclusion"]="skipped"
            elif case=="non_review_failure":
                jobs["jobs"].append(dict(name="other",status="completed",conclusion="failure"))
                jobs["total_count"]+=1
            elif case=="duplicate_job":
                jobs["jobs"].append(jobs["jobs"][0])
                jobs["total_count"]+=1
            elif case=="incomplete":
                jobs["total_count"]+=1
            with self.subTest(case=case),patch("visual_review_pack.gh_json",return_value=jobs):
                with self.assertRaises(ValueError):
                    failed_capture_proof("owner/repo",self.run_meta())
        with self.assertRaises(ValueError):
            failed_capture_proof("owner/repo",dict(self.run_meta(),run_attempt=2))

    def test_review_manifest_must_be_baseline_only_failure(self):
        with tempfile.TemporaryDirectory() as td:
            args, arts, archives = self.fixture(Path(td))
            with zipfile.ZipFile(archives[2]) as z:
                manifest=json.loads(z.read("manifest.json"))
            for changes in (dict(errors=[BASELINE_MISSING,"PNG corrupt"]),
                            dict(phase="offline"),dict(head_sha="f"*40),
                            dict(source=dict(run_id="other")),dict(count=3),
                            dict(selected_count=1),dict(baseline_status="COMPARED"),
                            dict(checkout_sha="bad")):
                with self.subTest(changes=changes),self.assertRaises(ValueError):
                    validate_failed_review(dict(manifest,**changes),self.run_meta(),"online")

    def test_bad_digest_and_unsafe_member_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            args, arts, archives = self.fixture(root)
            with patch("visual_review_pack.subprocess.run",side_effect=self.fake_subprocess(archives)):
                with self.assertRaises(ValueError):
                    gh_verified_extract(args.repo,dict(arts[0],digest="sha256:"+"0"*64),root/"bad-digest")
                with self.assertRaises(ValueError):
                    gh_verified_extract(args.repo,dict(arts[0],size_in_bytes=1),root/"bad-size")
            unsafe=root/"unsafe.zip"
            with zipfile.ZipFile(unsafe,"w") as z:
                z.writestr("../escape.png",b"bad")
            a=self.artifact(unsafe,"unsafe",3)
            with patch("visual_review_pack.subprocess.run",side_effect=self.fake_subprocess({3:unsafe})):
                with self.assertRaises(ValueError):
                    gh_verified_extract(args.repo,a,root/"unsafe-extract")
            self.assertFalse((root/"escape.png").exists())

    def test_wrong_checkout_tree_and_raw_manifest_mismatch_fail_closed(self):
        for case in ("tree","raw"):
            with self.subTest(case=case),tempfile.TemporaryDirectory() as td:
                args, arts, archives=self.fixture(Path(td))
                if case=="raw":
                    with zipfile.ZipFile(archives[1],"a") as z:
                        z.writestr("unexpected.png",b"not a PNG")
                    arts[0]=self.artifact(archives[1],arts[0]["name"],1)
                with patch("visual_review_pack.gh_json",side_effect=lambda q:self.fake_gh_json(q,mismatched_tree=case=="tree",arts=arts)), \
                     patch("visual_review_pack.subprocess.run",side_effect=self.fake_subprocess(archives)):
                    self.assertEqual(resolve_base(args),0)
                self.assertIsNone(read_baseline(args.out/"manifest.json",self.HEAD,"online"))

if __name__ == "__main__":
    unittest.main()
