import hashlib, json
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

SRC = Path("recovery-input")
HEADS = {"h80": "a3011aec9bbcf1e27721cdb7980120d04206932a", "h81": "c965dab0e44516615d4cc094b811734392e52f4c"}
def manifest(version, phase):
    with ZipFile(SRC / f"{version}-{phase}-manifest.zip") as z:
        assert z.testzip() is None
        d = json.loads(z.read("manifest.json"))
    assert d["head_sha"] == HEADS[version] and d["phase"] == phase
    assert len(d["images"]) == (469 if phase == "online" else 175)
    result = {x["path"]: x for x in d["images"]}
    assert len(result) == len(d["images"])
    if version == "h81":
        assert d["base_sha"] == HEADS["h80"] and not d["missing_from_current"]
    return result

for phase, expected_changed, expected_missing in [("online", 172, 39), ("offline", 37, 6)]:
    parent, current = manifest("h80", phase), manifest("h81", phase)
    assert parent.keys() == current.keys()
    changed = sorted(p for p in current if parent[p]["sha256"] != current[p]["sha256"])
    assert len(changed) == expected_changed
    missing = [p for p in changed if not parent[p].get("batch")]
    assert len(missing) == expected_missing
    with ZipFile(SRC / f"h80-{phase}-raw.zip") as z:
        names = z.namelist()
        for i, p in enumerate(missing):
            assert PurePosixPath(p).name == p
            matches = [n for n in names if n == p or n.endswith("/" + p)]
            assert len(matches) == 1, (p, matches)
            b = z.read(matches[0])
            assert hashlib.sha256(b).hexdigest() == parent[p]["sha256"]
            assert len(b) == parent[p]["bytes"]
            dest = Path("recovery") / f"{phase}-{i // 10 + 1}"
            dest.mkdir(parents=True, exist_ok=True)
            (dest / p).write_bytes(b)
    for i in range(1, (len(missing)+9)//10 + 1):
        files = list((Path("recovery") / f"{phase}-{i}").glob("*.png"))
        assert 0 < len(files) <= 10
        assert sum(p.stat().st_size for p in files) <= 10 * 1024 * 1024
        print(phase, i, len(files), sum(p.stat().st_size for p in files))
    print(phase, "EXACT RECOVERED", len(missing))
