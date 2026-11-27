"""Rebuild exact parent comparison for H65 #98, preserving originals.
Run exclusively on the public GitHub Actions runner."""
import os, json, time, shutil, subprocess
from pathlib import Path
from visual_review_pack import scan, digest, dump, read_baseline, gh_json, gh_download

repo=os.environ["GITHUB_REPOSITORY"]
phase=os.environ["PHASE"]
head="684e382682770a4a30664c437de92143ece77269"
base="aba0089096b290245af9da1914740e78494b4b43"
runs={base:45953958947, head:45955085098}
out=Path("evidence/h66-parent")
out.mkdir(parents=True,exist_ok=True)
report=dict(head_sha=head,base_sha=base,phase=phase,sources={},errors=[])
def require(condition,msg):
    if not condition: raise RuntimeError(msg)
def verified_run(sha):
    rid=runs[sha]
    deadline=time.monotonic()+360
    while True:
        run=gh_json(f"repos/{repo}/actions/runs/{rid}")
        require(run["head_sha"]==sha and run["path"].split("@",1)[0]==".github/workflows/v31-polish-audit.yml","wrong source run identity")
        jobs=gh_json(f"repos/{repo}/actions/runs/{rid}/jobs?per_page=100")["jobs"]
        match=[j for j in jobs if j["name"]==f"visual ({phase})"]
        require(len(match)==1,"unexpected visual phase job count")
        job=match[0]
        if job["status"]=="completed":
            require(job["conclusion"]=="success",f"source visual job {job['id']} failed")
            return rid,job["id"]
        require(time.monotonic()<deadline,"source visual job timed out")
        print(f"watchdog run={rid} phase={phase} status={job['status']}",flush=True)
        time.sleep(15)
def load(sha,need_raw):
    rid,jid=verified_run(sha)
    arts=gh_json(f"repos/{repo}/actions/runs/{rid}/artifacts?per_page=100")["artifacts"]
    name=f"v31-polish-visual-{phase}"
    raw=next((a for a in arts if a["name"]==name and not a["expired"]),None)
    require(raw is not None,"source raw artifact missing")
    dest=Path("h66-raw")/sha
    manifest=None
    if not need_raw:
        small=next((a for a in arts if a["name"]==f"v31-polish-review-manifest-{phase}" and not a["expired"]),None)
        if small:
            mdest=dest/"manifest"
            gh_download(repo,rid,small["name"],mdest)
            manifest=read_baseline(mdest/"manifest.json",sha,phase)
    if manifest is None:
        gh_download(repo,rid,name,dest)
        rows=scan(dest)
        require(bool(rows) and all("error" not in r for r in rows),"invalid raw PNGs")
    else:
        rows=manifest["images"]
    report["sources"][sha]=dict(run=rid,job=jid,artifact=raw["id"],digest=raw.get("digest"),count=len(rows),manifest_reused=manifest is not None)
    return {r["path"]:r for r in rows},dest
try:
    old,_=load(base,False)
    now,raw=load(head,True)
    report["missing"]=sorted(set(old)-set(now))
    report["new"]=sorted(set(now)-set(old))
    report["changed"]=sorted(k for k in now.keys()&old.keys() if now[k]["sha256"]!=old[k]["sha256"])
    report["unchanged"]=sorted(k for k in now.keys()&old.keys() if now[k]["sha256"]==old[k]["sha256"])
    report["baseline_status"]="COMPARED"
    require(not report["missing"],"screenshots disappeared")
    # Copy only exact original images, never re-encode originals. The raw artifacts remain authoritative.
    if phase=="online":
        names=["E04_00_default.png","E04_02_running.png","H1_E04_compact.png","H1_E04_projector.png",
               "B3_01_init.png","H2_B3_total_reflection.png","B2_01_init.png","B2_02_running.png",
               "E10_01_init.png","E10_04_fullscreen_3d.png"]
        for p in sorted(Path("docs/ui-benchmark").glob("*.png")):
            (out/"reference").mkdir(exist_ok=True)
            shutil.copyfile(p,out/"reference"/p.name)
        require(len(list((out/"reference").glob("*.png")))==4,"gold reference missing")
    else:
        names=[k for k in sorted(now) if "H59_F09" in k or any(x in k.lower() for x in ("legacy","tokamak","double_rod","em_devices","orbital","bounded_magnetic"))]
        # Include X02 specific output; the exact filenames are in the manifest.
        require(any("H59_F09" in k for k in names),"X02 target originals missing")
    copied=[]
    for k in names:
        require(k in now,"target screenshot missing: "+k)
        p=out/"actual"/k
        p.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(raw/k,p)
        require(digest(p)==now[k]["sha256"],"original hash mismatch")
        copied.append(dict(path=k,sha256=now[k]["sha256"],size=now[k]["size"]))
    report["selected_originals"]=copied
    report["references"]=[dict(path=p.name,sha256=digest(p)) for p in sorted((out/"reference").glob("*.png"))]
    report["status"]="PASS"
except Exception as e:
    report["status"]="FAIL";report["errors"].append(str(e));raise
finally:
    dump(out/"report.json",report)
    print(json.dumps({k:v for k,v in report.items() if k not in ("changed","unchanged","new","selected_originals")},ensure_ascii=False))
    print("counts",{k:len(report.get(k,[])) for k in ("changed","unchanged","new","missing","selected_originals")})
