"""Lossless, bounded review artifacts; raw visual artifacts remain authoritative."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
import subprocess
import sys
from urllib.parse import urlencode
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


def exact_parent_runs(args):
    """Search independent indexes; accept only exact parent SHA and audit workflow."""
    root = f"repos/{args.repo}/actions"
    primary = root + "/workflows/v31-polish-audit.yml/runs?" + urlencode(
        {"head_sha": args.head, "status": "completed", "per_page": 10})
    queries = [primary]
    if args.base_branch:
        # The SHA-filtered index can omit a completed visual run. The branch
        # index is discovery only: every candidate is still SHA/path checked.
        queries.append(root + "/runs?" + urlencode(
            {"branch": args.base_branch, "per_page": 100}))
    seen = set()
    for query in queries:
        try:
            runs = gh_json(query)["workflow_runs"]
        except (subprocess.SubprocessError, OSError, ValueError, KeyError) as exc:
            print("Baseline index unavailable:", str(exc), file=sys.stderr)
            continue
        print("Baseline index candidates:", len(runs))
        for run in runs:
            if (run.get("head_sha") != args.head
                    or run.get("status") != "completed"
                    or run.get("conclusion") not in ("success", "failure")
                    or run.get("path", "").split("@", 1)[0] != ".github/workflows/v31-polish-audit.yml"
                    or run.get("id") in seen or not run.get("id")):
                continue
            seen.add(run["id"])
            yield run


BASELINE_MISSING = "required exact parent comparison unavailable"


def unique_artifact(arts, name, run):
    """Bind raw bytes to the exact run and immutable artifact ID."""
    matches = [a for a in arts if not a.get("expired") and a.get("name") == name]
    if len(matches) != 1:
        raise ValueError("nonunique or missing artifact: " + name)
    a = matches[0]
    origin = a.get("workflow_run") or {}
    if (origin.get("id") != run["id"] or origin.get("head_sha") != run["head_sha"]
            or not isinstance(a.get("id"), int) or a["id"] <= 0
            or not re.fullmatch(r"sha256:[0-9a-f]{64}", a.get("digest") or "")
            or not isinstance(a.get("size_in_bytes"), int) or a["size_in_bytes"] <= 0):
        raise ValueError("unverified artifact provenance: " + name)
    return a


def gh_verified_extract(repo, artifact, dest):
    """Download the declared ZIP by ID, verify outer SHA/size/CRC, then extract."""
    dest.mkdir(parents=True, exist_ok=False)
    archive = dest.parent / (dest.name + ".zip")
    try:
        with archive.open("wb") as output:
            subprocess.run(["gh", "api", f"repos/{repo}/actions/artifacts/{artifact['id']}/zip"],
                           check=True, stdout=output, timeout=120)
        if (archive.stat().st_size != artifact["size_in_bytes"]
                or digest(archive) != artifact["digest"].removeprefix("sha256:")):
            raise ValueError("raw artifact ZIP size or SHA-256 mismatch")
        with zipfile.ZipFile(archive) as z:
            infos = z.infolist()
            names = [i.filename for i in infos]
            if len(set(names)) != len(names) or z.testzip() is not None:
                raise ValueError("artifact ZIP contains duplicate names or bad CRC")
            for info in infos:
                p = PurePosixPath(info.filename)
                if (p.is_absolute() or ".." in p.parts or "\\" in info.filename
                        or not p.parts or (info.external_attr >> 16) & 0o170000 == 0o120000):
                    raise ValueError("unsafe artifact member")
                if info.is_dir():
                    continue
                # Only retain evidence PNGs and the review manifest.
                if p.suffix.lower() == ".png" or p.as_posix() == "manifest.json":
                    z.extract(info, dest)
    finally:
        archive.unlink(missing_ok=True)


def failed_capture_proof(repo, run):
    """A failed run is not green; admit only independently successful capture jobs.
    Restrict recovery to first-attempt PR runs with downstream review-only failures.
    """
    if run.get("event") != "pull_request" or run.get("run_attempt") != 1:
        raise ValueError("failed source run attempt/event not proven")
    data = gh_json(f"repos/{repo}/actions/runs/{run['id']}/jobs?filter=latest&per_page=100")
    jobs = data["jobs"]
    if data.get("total_count") != len(jobs):
        raise ValueError("incomplete job listing")
    phases = {}
    names = {f"Lossless bounded screenshot review ({p})" for p in ("online", "offline")}
    failed = [j for j in jobs if j.get("conclusion") not in ("success", "skipped")]
    if not failed or any(j.get("name") not in names or j.get("conclusion") != "failure"
                         or j.get("status") != "completed" for j in failed):
        raise ValueError("source contains non-review failures")
    for phase in ("online", "offline"):
        matches = [j for j in jobs if j.get("name") == f"visual ({phase})"]
        if len(matches) != 1:
            raise ValueError("nonunique capture job")
        job = matches[0]
        if (job.get("status") != "completed" or job.get("conclusion") != "success"
                or job.get("head_sha") != run["head_sha"] or job.get("run_id") != run["id"]
                or job.get("run_attempt") != 1 or not isinstance(job.get("id"), int)):
            raise ValueError("capture job not successful for exact source")
        required = ["Run actions/checkout@v4", "Run pnpm build", "Run pnpm audit:visual",
                    "Run actions/upload-artifact@v4"]
        if phase == "offline":
            required.append("Run pnpm export:release --v3-audit")
        for step in required:
            found = [s for s in job.get("steps", []) if s.get("name") == step]
            if len(found) != 1 or found[0].get("status") != "completed" or found[0].get("conclusion") != "success":
                raise ValueError("capture step not successful: " + step)
        phases[phase] = job["id"]
    return phases


def validate_failed_review(data, run, phase):
    rows = data.get("images", [])
    if (data.get("schema") != SCHEMA or data.get("head_sha") != run["head_sha"]
            or data.get("phase") != phase or str(data.get("source", {}).get("run_id")) != str(run["id"])
            or data.get("baseline_status") != "NOT_RUN"
            or data.get("errors") != [BASELINE_MISSING] or data.get("targets_only")
            or not rows or data.get("count") != len(rows) or data.get("selected_count") != len(rows)
            or any(r.get("error") or r.get("change") != "NOT_RUN"
                   or not isinstance(r.get("path"), str)
                   or not re.fullmatch(r"[0-9a-f]{64}", r.get("sha256") or "")
                   or not isinstance(r.get("bytes"), int) or r["bytes"] <= 0
                   or not isinstance(r.get("size"), list) or len(r["size"]) != 2
                   or any(not isinstance(v, int) or v <= 0 for v in r["size"]) for r in rows)
            or len({r["path"] for r in rows}) != len(rows)
            or not re.fullmatch(r"[0-9a-f]{40}", data.get("checkout_sha") or "")):
        raise ValueError("review did not fail exclusively for the missing baseline")
    return rows


def recover_failed_capture(args, run, arts):
    """Rebuild only a raw reference, not a passed review or release decision."""
    proof = failed_capture_proof(args.repo, run)
    review = unique_artifact(arts, f"v31-polish-review-manifest-{args.phase}", run)
    raw = unique_artifact(arts, f"v31-polish-visual-{args.phase}", run)
    dest = args.out / "_failed_capture" / str(run["id"])
    manifest_dir = dest / "review"
    gh_verified_extract(args.repo, review, manifest_dir)
    data = json.loads((manifest_dir / "manifest.json").read_text(encoding="utf-8"))
    rows = validate_failed_review(data, run, args.phase)
    # A PR run normally checks out a synthetic merge. Prove that its tree is
    # exactly the head's tree; a moving base must not silently alter evidence.
    def tree(sha):
        commit = gh_json(f"repos/{args.repo}/git/commits/{sha}")
        if commit.get("sha") != sha:
            raise ValueError("commit lookup returned wrong SHA")
        return commit["tree"]["sha"]
    if tree(data["checkout_sha"]) != tree(run["head_sha"]):
        raise ValueError("capture checkout tree differs from exact head")
    raw_dir = dest / "raw"
    gh_verified_extract(args.repo, raw, raw_dir)
    fields = ("path", "bytes", "sha256", "size")
    identity = lambda rs: sorted(tuple(r[k] if k != "size" else tuple(r[k]) for k in fields) for r in rs)
    actual = scan(raw_dir)
    if any("error" in r for r in actual) or identity(actual) != identity(rows):
        raise ValueError("raw PNG set/bytes/size differs from original review index")
    return pack(raw_dir, args.out, args.head, args.phase, args.prefixes, targets_only=True,
                source={"kind": "verified_raw_capture_from_failed_review",
                        "run_id": run["id"], "run_conclusion": run["conclusion"],
                        "capture_job_id": proof[args.phase], "artifact_id": raw["id"],
                        "github_declared_digest": raw["digest"], "review_artifact_id": review["id"],
                        "review_digest": review["digest"], "verified_checkout_sha": data["checkout_sha"]})


def resolve_base(args):
    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    # The base is the exact PR parent SHA, never a latest-run guess.
    try:
        for run in exact_parent_runs(args):
            arts = gh_json(f"repos/{args.repo}/actions/runs/{run['id']}/artifacts?per_page=100")["artifacts"]
            if run["conclusion"] == "failure":
                try:
                    m = recover_failed_capture(args, run, arts)
                    if not m["errors"]:
                        print("Exact raw parent recovered; original review remains failed:", run["id"])
                        return 0
                    print("Recovered parent pack invalid:", m["errors"], file=sys.stderr)
                except (subprocess.SubprocessError, OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as exc:
                    print("Failed-review capture rejected:", str(exc), file=sys.stderr)
                continue
            small = next((a for a in arts if not a["expired"] and
                          a["name"] == f"v31-polish-review-manifest-{args.phase}"), None)
            if small:
                dest = out / "_previous_manifest" / str(run["id"])
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
                dest = out / "_legacy_raw" / str(run["id"])
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
    p.add_argument("--base-branch", default="")
    p.add_argument("--repo")
    p.add_argument("--resolve-base", action="store_true")
    p.add_argument("--require-baseline", action="store_true",
                   help="For a stacked candidate, retry an unavailable exact parent and fail closed.")
    a = p.parse_args()
    a.prefixes = [x.strip() for x in a.prefixes.split(",") if x.strip()]
    if a.resolve_base:
        return resolve_base(a)
    if not a.raw:
        p.error("--raw required")
    baseline = read_baseline(a.baseline, a.base_sha, a.phase)
    # The eager base-review job may run before its parent finishes uploading
    # the visual evidence. Retry only at review time, against the same SHA.
    if baseline is None and a.require_baseline and a.repo and a.base_sha:
        retry = a.out.parent / "exact-parent-retry"
        result = resolve_base(argparse.Namespace(
            out=retry, head=a.base_sha, repo=a.repo, phase=a.phase,
            base_branch=a.base_branch, prefixes=a.prefixes))
        if result == 0:
            baseline = read_baseline(retry / "manifest.json", a.base_sha, a.phase)
    m = pack(a.raw, a.out, a.head, a.phase, a.prefixes, baseline, a.base_sha,
             source={"run_id": os.environ.get("GITHUB_RUN_ID")})
    if a.require_baseline and baseline is None:
        # Keep all current PNGs and a useful manifest even on failure, but
        # never allow a required comparison that did not run to turn green.
        m["errors"].append(BASELINE_MISSING)
        dump(a.out / "manifest.json", m)
        print(m["errors"][-1], file=sys.stderr)
    return int(bool(m["errors"]))


if __name__ == "__main__":
    sys.exit(main())
