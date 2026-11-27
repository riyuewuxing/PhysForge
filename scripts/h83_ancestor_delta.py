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
# Only a bounded original-image S02 sample in this artifact; manifest covers ALL images.
# Remaining changes remain explicitly pending for human review.
selected=[]; size=0
for k in changes:
    if "S02_" not in k: continue
    pair=a[k][2]+b[k][2]
    if size+pair>8*1024*1024: continue
    selected.append(k);size+=pair
if selected:
    with zipfile.ZipFile(out/"s02-original-pairs.zip","w",compression=zipfile.ZIP_STORED) as z:
        for k in selected:
            z.writestr("H81/"+k,old[1].read(a[k][3]))
            z.writestr("H83/"+k,new[1].read(b[k][3]))
report["s02_original_pairs"]=selected
report["pending_human_review"]=changes
(out/"manifest.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in report.items() if k not in ("images","pending_human_review")},indent=2))
