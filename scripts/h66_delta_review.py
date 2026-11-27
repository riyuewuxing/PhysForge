"""Recover only changed original screenshots, exact #97/#98, runner-side."""
import os
from pathlib import Path
from visual_review_pack import gh_json,gh_download,read_baseline,pack
repo=os.environ["GITHUB_REPOSITORY"]; phase=os.environ["PHASE"]
base="aba0089096b290245af9da1914740e78494b4b43"; head="684e382682770a4a30664c437de92143ece77269"
ids=[45953958947,45955085098]
for rid,sha in zip(ids,[base,head]):
    run=gh_json(f"repos/{repo}/actions/runs/{rid}")
    assert run["head_sha"]==sha and run["path"].split("@")[0]==".github/workflows/v31-polish-audit.yml"
    jobs=gh_json(f"repos/{repo}/actions/runs/{rid}/jobs?per_page=100")["jobs"]
    match=[j for j in jobs if j["name"]==f"visual ({phase})"]
    assert len(match)==1 and match[0]["conclusion"]=="success"
parent=Path("h66-parent-manifest"); raw=Path("h66-current-raw")
gh_download(repo,ids[0],f"v31-polish-review-manifest-{phase}",parent)
baseline=read_baseline(parent/"manifest.json",base,phase)
assert baseline is not None
gh_download(repo,ids[1],f"v31-polish-visual-{phase}",raw)
out=Path("evidence/h66-delta")
manifest=pack(raw,out,head,phase,[],baseline,base,source={"parent_run":ids[0],"current_run":ids[1]})
assert manifest["baseline_status"]=="COMPARED" and not manifest["missing_from_current"] and not manifest["errors"]
