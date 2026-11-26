"""Lossless, bounded review artifacts; raw visual artifacts remain authoritative."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import zipfile

from PIL import Image

MIB = 1024 * 1024
TARGET = 10 * MIB
HARD = 19 * MIB  # room for the outer GitHub artifact ZIP
MAX_BATCHES = 40
SCHEMA = 1


def dump(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def digest(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def scan(root):
    rows = []
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.suffix.lower() != ".png":
            continue
        name = p.relative_to(root).as_posix()
        try:
            with Image.open(p) as im:
                if im.format != "PNG":
                    raise ValueError("not a PNG")
                size = list(im.size)
                im.verify()
            with Image.open(p) as im:
                im.load()
            rows.append(dict(path=name, bytes=p.stat().st_size, sha256=digest(p), size=size))
        except Exception as exc:
            rows.append(dict(path=name, error=str(exc)))
    return rows


def read_baseline(path, head, phase):
    if not path or not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        rows = data.get("images", [])
        if (data.get("schema") != SCHEMA or data.get("head_sha") != head
                or data.get("phase") != phase or not rows or data.get("errors")
                or any("sha256" not in r or "path" not in r for r in rows)
                or len({r["path"] for r in rows}) != len(rows)):
            return None
        return data
    except (ValueError, OSError, TypeError, KeyError):
        return None


def priority(row, prefixes):
    name = Path(row["path"]).name.casefold()
    if any(x in name for x in ("failure", "failed", "error", "timeout")):
        return 0
    if any(name.startswith(p.casefold()) for p in prefixes):
        return 1
    return 2


def pack(root, out, head, phase, prefixes, baseline=None, base_sha=None,
         targets_only=False, source=None, target=TARGET, hard=HARD, max_batches=MAX_BATCHES):
    out.mkdir(parents=True, exist_ok=True)
    rows = scan(root)
    errors = [r["path"] + ": " + r["error"] for r in rows if "error" in r]
    if not rows:
        errors.append("no PNG images found")
    old = {r["path"]: r for r in baseline["images"]} if baseline else {}
    selected = []
    for row in rows:
        if "error" in row:
            continue
        name = row["path"]
        row["change"] = ("NOT_RUN" if baseline is None else "NEW" if name not in old
                         else "UNCHANGED" if row["sha256"] == old[name]["sha256"] else "CHANGED")
        row["priority"] = priority(row, prefixes)
        row["batch"] = None
        if row["priority"] < 2 or (not targets_only and row["change"] != "UNCHANGED"):
            selected.append(row)
    selected.sort(key=lambda r: (r["priority"], r["path"]))
    batches = []
    pending = []
    estimated = 22

    def finish():
        nonlocal pending, estimated
        if not pending:
            return
        if len(batches) >= max_batches:
            errors.append("review batch slot limit exceeded; remaining images retained in raw artifact")
            pending = []
            estimated = 22
            return
        number = len(batches) + 1
        name = f"review-{number:02d}.zip"
        file = out / name
        with zipfile.ZipFile(file, "w", compression=zipfile.ZIP_STORED) as z:
            for row in pending:
                z.write(root / row["path"], arcname=row["path"])
        size = file.stat().st_size
        if size > hard:
            errors.append(f"{name} exceeds safe byte limit: {size}")
            file.unlink()
        else:
            with zipfile.ZipFile(file) as z:
                if z.testzip() is not None:
                    errors.append(f"{name} CRC verification failed")
                    file.unlink()
                else:
                    for row in pending:
                        row["batch"] = number
                    batches.append(dict(name=name, bytes=size, sha256=digest(file),
                                        count=len(pending)))
        pending = []
        estimated = 22

    for row in selected:
        # Bound the complete ZIP, not just PNG payloads; leave margin for headers.
        cost = row["bytes"] + 2 * len(row["path"].encode("utf-8")) + 256
        if cost + 22 > hard:
            errors.append(f"oversize original, not transferred automatically: {row['path']}")
            continue
        if pending and estimated + cost > target:
            finish()
        pending.append(row)
        estimated += cost
    finish()
    if any(r["batch"] is None for r in selected):
        errors.append("selected images not covered by bounded batches; inspect raw artifact")
    manifest = dict(schema=SCHEMA, head_sha=head, phase=phase,
                    checkout_sha=os.environ.get("GITHUB_SHA") if not targets_only else None,
                    source=source or {}, base_sha=base_sha,
                    baseline_status="COMPARED" if baseline is not None else "NOT_RUN",
                    missing_from_current=sorted(set(old) - {r["path"] for r in rows}),
                    target_prefixes=prefixes, targets_only=targets_only,
                    count=len(rows), selected_count=len(selected), images=rows,
                    batches=batches, errors=errors)
    dump(out / "manifest.json", manifest)
    print(json.dumps({k: manifest[k] for k in ("head_sha", "phase", "baseline_status",
                     "count", "selected_count", "batches", "errors")}, ensure_ascii=False))
    return manifest


def gh_json(*args):
    result = subprocess.run(["gh", "api", *args], check=True, capture_output=True,
                            text=True, timeout=25)
    return json.loads(result.stdout)


def gh_download(repo, run, name, dest):
    dest.mkdir(parents=True, exist_ok=True)
    subprocess.run(["gh", "run", "download", str(run), "--repo", repo,
                    "--name", name, "--dir", str(dest)], check=True, timeout=120)


def resolve_base(args):
    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    # The base is the exact PR parent SHA, never a latest-run guess.
    try:
        runs = gh_json(f"repos/{args.repo}/actions/workflows/v31-polish-audit.yml/runs"
                       f"?head_sha={args.head}&status=success&per_page=10")["workflow_runs"]
        for run in runs:
            if run.get("head_sha") != args.head or run.get("conclusion") != "success":
                continue
            arts = gh_json(f"repos/{args.repo}/actions/runs/{run['id']}/artifacts?per_page=100")["artifacts"]
            small = next((a for a in arts if not a["expired"] and
                          a["name"] == f"v31-polish-review-manifest-{args.phase}"), None)
            if small:
                dest = out / "_previous_manifest"
                gh_download(args.repo, run["id"], small["name"], dest)
                existing = read_baseline(dest / "manifest.json", args.head, args.phase)
                if existing:
                    dump(out / "manifest.json", existing)
                    print("Exact parent manifest reused:", run["id"])
                    return 0
            raw = next((a for a in arts if not a["expired"] and
                        a["name"] == f"v31-polish-visual-{args.phase}"), None)
            if raw:
                # Legacy recovery is runner-only; the Chat receives only target originals.
                dest = out / "_legacy_raw"
                gh_download(args.repo, run["id"], raw["name"], dest)
                m = pack(dest, out, args.head, args.phase, args.prefixes, targets_only=True,
                         source={"run_id": run["id"], "artifact_id": raw["id"],
                                 "github_declared_digest": raw.get("digest")})
                return int(bool(m["errors"]))
    except (subprocess.SubprocessError, OSError, ValueError, KeyError) as exc:
        print("Baseline lookup unavailable:", str(exc), file=sys.stderr)
    dump(out / "manifest.json", dict(schema=SCHEMA, head_sha=args.head, phase=args.phase,
         images=[], errors=["exact parent visual evidence unavailable"], baseline_status="NOT_RUN"))
    return 0


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--raw", type=Path)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--head", required=True)
    p.add_argument("--phase", choices=("online", "offline"), required=True)
    p.add_argument("--prefixes", default="")
    p.add_argument("--baseline", type=Path)
    p.add_argument("--base-sha")
    p.add_argument("--repo")
    p.add_argument("--resolve-base", action="store_true")
    a = p.parse_args()
    a.prefixes = [x.strip() for x in a.prefixes.split(",") if x.strip()]
    if a.resolve_base:
        return resolve_base(a)
    if not a.raw:
        p.error("--raw required")
    baseline = read_baseline(a.baseline, a.base_sha, a.phase)
    m = pack(a.raw, a.out, a.head, a.phase, a.prefixes, baseline, a.base_sha,
             source={"run_id": os.environ.get("GITHUB_RUN_ID")})
    return int(bool(m["errors"]))


if __name__ == "__main__":
    sys.exit(main())
