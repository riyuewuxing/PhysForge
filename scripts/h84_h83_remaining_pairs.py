import hashlib, json, os, pathlib, zipfile, io
from PIL import Image
phase=os.environ["PHASE"]
runs=("46015253705","46022936408")
data=[]
for run in runs:
    meta=json.loads(pathlib.Path(f"inputs/{run}.json").read_text())
    path=pathlib.Path(f"inputs/{run}.zip")
    assert hashlib.file_digest(path.open("rb"),"sha256").hexdigest()==meta["digest"].removeprefix("sha256:")
    archive=zipfile.ZipFile(path)
    assert archive.testzip() is None
    by_name={}
    for name in archive.namelist():
        if not name.lower().endswith(".png"): continue
        key=pathlib.PurePosixPath(name).name
        assert key not in by_name, key
        raw=archive.read(name)
        im=Image.open(io.BytesIO(raw))
        assert im.format=="PNG", name
        size=im.size
        im.verify()
        by_name[key]=(hashlib.sha256(raw).hexdigest(),size,len(raw),name)
    data.append((meta,archive,by_name))
old,new=data
a,b=old[2],new[2]
expected={"online":469,"offline":175}[phase]
assert len(a)==len(b)==expected,(len(a),len(b),expected)
assert set(a)==set(b),sorted(set(a)^set(b))
changes=[k for k in sorted(b) if a[k][0]!=b[k][0]]
out=pathlib.Path("review")
out.mkdir(exist_ok=True)
report={"phase":phase,"base_sha":"c965dab0e44516615d4cc094b811734392e52f4c","head_sha":"54859b12382bcacdc471a586f086b2e89685781c","baseline_kind":"reviewed ancestor (not immediate parent)","artifacts":[{"id":d[0]["id"],"digest":d[0]["digest"]} for d in data],"count":len(b),"changed":len(changes),"unchanged":len(b)-len(changes),"images":[{"path":k,"base_sha256":a[k][0],"head_sha256":b[k][0],"base_size":a[k][1],"head_size":b[k][1],"changed":k in changes} for k in sorted(b)]}
# Recover remaining original changed pairs losslessly, using the same exact raw artifacts.
# H83's first 13 S02 pairs are preserved in the earlier bounded artifact.
expected_changes={"online":209,"offline":37}[phase]
assert len(changes)==expected_changes,(len(changes),expected_changes)
previous=[]; size=0
for k in changes:
    if "S02_" not in k: continue
    pair=a[k][2]+b[k][2]
    if size+pair>8*1024*1024: continue
    previous.append(k);size+=pair
assert len(previous)==({"online":13,"offline":0}[phase])
remaining=[k for k in changes if k not in previous]
def priority(k):
    if "S02_" in k: return 0
    if "E02_" in k or "E10_" in k: return 1
    if any(token in k for token in ("B2_","B3_","E04_")): return 2
    return 3
remaining.sort(key=lambda k:(priority(k),k))
packs=[]; batch=[]; rawsize=0; limit=8*1024*1024
def write_batch():
    global batch,rawsize
    if not batch: return
    dest=out/f"pair-pack-{len(packs)+1:02d}.zip"
    with zipfile.ZipFile(dest,"w",compression=zipfile.ZIP_STORED) as z:
        for k in batch:
            x=old[1].read(a[k][3]);y=new[1].read(b[k][3])
            assert hashlib.sha256(x).hexdigest()==a[k][0]
            assert hashlib.sha256(y).hexdigest()==b[k][0]
            z.writestr("H81/"+k,x);z.writestr("H83/"+k,y)
    assert dest.stat().st_size<limit,dest
    with zipfile.ZipFile(dest) as z: assert z.testzip() is None
    packs.append({"file":dest.name,"bytes":dest.stat().st_size,"sha256":hashlib.file_digest(dest.open("rb"),"sha256").hexdigest(),"pairs":batch})
    batch=[];rawsize=0
for k in remaining:
    pair=a[k][2]+b[k][2]+1024
    assert pair<limit,k
    if rawsize+pair>=limit: write_batch()
    batch.append(k);rawsize+=pair
write_batch()
assert len(packs)<=40,len(packs)
assert sorted(k for p in packs for k in p["pairs"])==sorted(remaining)
report["previous_pairs"]=previous
report["remaining_pairs"]=remaining
report["packs"]=packs
report["pending_human_review"]=changes
(out/"manifest.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({"phase":phase,"changed":len(changes),"previous":len(previous),"remaining":len(remaining),"pack_count":len(packs),"packs":[{"file":p["file"],"pairs":len(p["pairs"]),"bytes":p["bytes"]} for p in packs]},indent=2))
