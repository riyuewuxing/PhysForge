"""Read-only extraction from the already executed previous exact candidate.
No rebuild, model change, or new simulated screenshot. Fail closed on source mismatch.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil

from visual_review_pack import gh_json, gh_download, pack, digest, dump

repo = os.environ["SOURCE_REPO"]
head = os.environ["SOURCE_HEAD"]
run_id = int(os.environ["SOURCE_RUN"])
phase = os.environ["PHASE"]
assert phase in ("online", "offline")
api = f"repos/{repo}/actions/runs/{run_id}"
run = gh_json(api)
assert run["head_sha"] == head, "source head mismatch"
assert run["path"].split("@", 1)[0] == ".github/workflows/v31-polish-audit.yml"
jobs = gh_json(api + "/jobs?per_page=100")["jobs"]
job = [j for j in jobs if j["name"] == f"visual ({phase})"]
assert len(job) == 1 and job[0]["status"] == "completed" and job[0]["conclusion"] == "success", "source phase not successful"
arts = gh_json(api + "/artifacts?per_page=100")["artifacts"]
name = f"v31-polish-visual-{phase}"
raws = [a for a in arts if a["name"] == name and not a["expired"]]
assert len(raws) == 1, "exact source artifact unavailable"
raw = raws[0]
root = Path("source-raw")
gh_download(repo, run_id, name, root)
report = root / f"summary-{phase}.json"
assert report.is_file(), "source summary missing"
data = json.loads(report.read_text())
assert data["phase"] == phase
assert ("f12Report" if phase == "online" else "f12OfflineReport") in data, "missing F12 report"
out = Path("evidence")
prefixes = (
    ["E04_02_running.png", "H2_B3_below_critical.png", "H3_B2_nominal.png", "E10_04_fullscreen_3d.png"]
    if phase == "online"
    else ["H63_F12_", "H2_B3_", "H3_B2_", "H1_E04_", "H39_E10_"]
)
source = {"run_id": run_id, "job_id": job[0]["id"], "artifact_id": raw["id"],
          "github_declared_digest": raw.get("digest"), "artifact_bytes": raw["size_in_bytes"],
          "source_report_sha256": digest(report)}
m = pack(root, out, head, phase, prefixes, targets_only=True, source=source, max_batches=6)
assert not m["errors"], m["errors"]
required = (["E04_02_running.png", "H2_B3_below_critical.png", "H3_B2_nominal.png", "E10_04_fullscreen_3d.png"]
            if phase == "online" else ["H63_F12_offline_tdse_initial.png", "H63_F12_offline_lorentz_negative.png"])
byname = {Path(row["path"]).name: row for row in m["images"]}
assert all(n in byname and byname[n]["batch"] is not None for n in required), "missing requested exact screenshot"
report_out = out / "report"
report_out.mkdir()
shutil.copyfile(report, report_out / report.name)
if phase == "online":
    # Include original immutable reference assets, with Git blob hash and SHA256 for independent comparison.
    benchmarks = {
        "01_workbench_em.png": "88929efd294aa0e1029951b4d933190dc79b36ff",
        "02_optics_clean.png": "165aea1b156c3b2503caedbeba6192811f5b4fa9",
        "03_circuit_mna.png": "3ed31b497816feabd18167bdcc444fdabb7ba962",
        "04_fullscreen_3d.png": "9968a3629d443faaa2f5a221fd12370a5cb17bcb",
    }
    rows = []
    for name, expected in benchmarks.items():
        p = Path("docs/ui-benchmark") / name
        blob = p.read_bytes()
        assert hashlib.sha1(b"blob " + str(len(blob)).encode() + b"\0" + blob).hexdigest() == expected
        shutil.copyfile(p, report_out / name)
        rows.append({"path": name, "git_blob_sha": expected, "sha256": digest(p), "bytes": len(blob)})
    dump(report_out / "benchmark-integrity.json", rows)
dump(report_out / "source.json", source)
print("H64_SOURCE_EXTRACTION_PASS", phase, head, run_id, m["selected_count"])
