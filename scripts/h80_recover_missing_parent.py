import hashlib
import json
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

src = Path("recovery-input")
def manifest(name, head):
    with ZipFile(src / name) as z:
        assert z.testzip() is None
        data = json.loads(z.read("manifest.json"))
    assert data["head_sha"] == head and data["phase"] == "online"
    assert len(data["images"]) == 469
    return {x["path"]: x for x in data["images"]}

parent = manifest("h79-manifest.zip", "941804a2ef378a8d059460d9a4bf785fa360c306")
current = manifest("h80-manifest.zip", "a3011aec9bbcf1e27721cdb7980120d04206932a")
assert parent.keys() == current.keys()
changed = sorted(p for p in current if current[p]["sha256"] != parent[p]["sha256"])
assert len(changed) == 193
missing = [p for p in changed if not parent[p].get("batch")]
assert len(missing) == 47
with ZipFile(src / "h79-raw.zip") as z:
    names = z.namelist()
    for i, p in enumerate(missing):
        assert PurePosixPath(p).name == p, p
        hits = [n for n in names if n == p or n.endswith("/" + p)]
        assert len(hits) == 1, (p, hits)
        b = z.read(hits[0])
        assert hashlib.sha256(b).hexdigest() == parent[p]["sha256"], p
        assert len(b) == parent[p]["bytes"], p
        dest = Path("recovery") / f"part-{i // 10 + 1}"
        dest.mkdir(parents=True, exist_ok=True)
        (dest / p).write_bytes(b)
for i in range(1, 6):
    files = list((Path("recovery") / f"part-{i}").glob("*.png"))
    assert 0 < len(files) <= 10
    assert sum(p.stat().st_size for p in files) < 12 * 1024 * 1024
    print(i, len(files), sum(p.stat().st_size for p in files))
print("RECOVERED EXACT MISSING PARENTS:", len(missing))
