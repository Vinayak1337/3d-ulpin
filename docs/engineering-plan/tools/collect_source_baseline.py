#!/usr/bin/env python3
"""Collect committed-source metadata only; never run app scripts or touch its data.

Python 3.10+ and Git are required. This is not an application test or T001 sign-off.
The output must be a new file outside the checkout. No network calls are made.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import subprocess
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

MAX_BLOB = 2 * 1024 * 1024
MAX_TREE_ENTRIES = 100_000
MAX_METADATA = 24 * 1024 * 1024
EXACT_FILES = {
    "AGENTS.md", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
    "compose.yaml", "playwright.config.ts", "apps/web/package.json",
    "packages/contracts/package.json", "apps/web/components/AreaViewer.tsx",
    "services/geo/pyproject.toml", "services/geo/requirements.txt",
    "services/worker/pyproject.toml", "services/worker/requirements.txt",
}
SOURCE_PREFIXES = (
    "packages/contracts/src/", "apps/web/lib/server/",
    "apps/web/features/officer/shared/", "apps/web/features/officer/scene/",
    "apps/web/features/spatial/",
    "services/geo/geo/",
)
SOURCE_EXTENSIONS = {".ts", ".tsx", ".py"}
SAFE_PATH = re.compile(r"^[A-Za-z0-9_./@() +\-]+$")
SAFE_SCRIPT = re.compile(r"^[A-Za-z0-9:_\-]{1,100}$")


class BaselineError(Exception):
    """An unsafe, ambiguous or unsupported collection request."""


def git(repo: Path, *args: str, allow_one: bool = False) -> bytes:
    """Run only explicitly supplied Git operations; never echo command stderr."""
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0"}
    try:
        result = subprocess.run(
            ["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false",
             "-C", str(repo), *args],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=25, env=env,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise BaselineError("Git is unavailable or a metadata operation timed out.") from exc
    if result.returncode != 0 and not (allow_one and result.returncode == 1):
        raise BaselineError("Git metadata operation failed; verify the checkout and committed HEAD.")
    if len(result.stdout) > MAX_METADATA:
        raise BaselineError("Git metadata exceeds the supported bound.")
    return result.stdout


def repository_name(remote: str) -> str | None:
    """Return owner/repo only. Never expose username/password/query parameters."""
    scp = re.fullmatch(r"(?:[^@:/]+@)?github\.com:([^?#]+)", remote)
    if scp:
        path = scp.group(1)
    else:
        try:
            url = urlsplit(remote)
        except ValueError:
            return None
        if url.scheme not in {"https", "ssh"} or url.hostname != "github.com" or url.query or url.fragment:
            return None
        path = url.path.lstrip("/")
    path = path.rstrip("/").removesuffix(".git")
    return path if re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", path) else None


def selected_path(path: str) -> bool:
    p = PurePosixPath(path)
    if not SAFE_PATH.fullmatch(path) or p.is_absolute() or ".." in p.parts:
        return False
    if any(part.startswith(".env") for part in p.parts):
        return False
    return path in EXACT_FILES or (path.startswith(SOURCE_PREFIXES) and p.suffix in SOURCE_EXTENSIONS)


def collect(repo: Path, *, expected_repository: str | None = None,
            require_clean: bool = True) -> tuple[Path, dict]:
    supplied = repo.resolve(strict=True)
    root = Path(git(supplied, "rev-parse", "--show-toplevel").decode().strip()).resolve(strict=True)
    head = git(root, "rev-parse", "--verify", "HEAD").decode().strip()
    if not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", head):
        raise BaselineError("HEAD is not a supported committed object ID.")
    branch = git(root, "symbolic-ref", "--quiet", "--short", "HEAD", allow_one=True).decode().strip()
    before = git(root, "status", "--porcelain=v1", "-z", "--untracked-files=normal")
    if require_clean and before:
        raise BaselineError("Checkout has changes. Preserve them; use a clean isolated checkout.")
    matched_repository = None
    if expected_repository:
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", expected_repository):
            raise BaselineError("Expected repository must use owner/name syntax.")
        remote = git(root, "remote", "get-url", "origin").decode().strip()
        matched_repository = repository_name(remote)
        if matched_repository is None or matched_repository.lower() != expected_repository.lower():
            raise BaselineError("Origin does not match the expected GitHub repository.")
    tree = git(root, "ls-tree", "-r", "-z", "--long", head)
    entries = [entry for entry in tree.split(b"\x00") if entry]
    if len(entries) > MAX_TREE_ENTRIES:
        raise BaselineError("Committed tree exceeds the supported entry count.")
    files, tests, workflows, notices, packages = [], [], [], [], []
    seen = set()
    for entry in entries:
        try:
            metadata, path_bytes = entry.split(b"\t", 1)
            mode, kind, oid, size = metadata.decode("ascii").split()
            path = path_bytes.decode("utf-8")
        except (ValueError, UnicodeError) as exc:
            raise BaselineError("Unsupported Git tree encoding.") from exc
        # Inventory of test/workflow names is explicitly bounded and contains no source bytes.
        if SAFE_PATH.fullmatch(path):
            p = PurePosixPath(path)
            if ("tests" in p.parts or "__tests__" in p.parts or
                    re.search(r"(?:\.test\.|\.spec\.|^test_)", p.name)):
                if p.suffix in {".py", ".js", ".mjs", ".ts", ".tsx"}:
                    tests.append(path)
            if path.startswith(".github/workflows/") and p.suffix in {".yml", ".yaml"}:
                workflows.append(path)
        if not selected_path(path):
            continue
        seen.add(path)
        if mode not in {"100644", "100755"} or kind != "blob":
            raise BaselineError("Selected source path is not a regular committed file; links are unsupported.")
        if not size.isdigit() or int(size) > MAX_BLOB:
            notices.append({"path": path, "status": "not_read", "reason": "blob_size_limit"})
            continue
        content = git(root, "cat-file", "blob", oid)
        if len(content) != int(size):
            raise BaselineError("Committed blob length changed unexpectedly.")
        files.append({"path": path, "git_blob": oid, "bytes": len(content),
                      "sha256": hashlib.sha256(content).hexdigest()})
        if path.endswith("package.json"):
            try:
                package = json.loads(content)
                if not isinstance(package, dict):
                    raise ValueError()
                scripts = package.get("scripts", {})
                if not isinstance(scripts, dict):
                    raise ValueError()
            except (ValueError, UnicodeError):
                notices.append({"path": path, "status": "invalid_package_manifest"})
                continue
            packages.append({"path": path,
                             "script_names": sorted(k for k in scripts if SAFE_SCRIPT.fullmatch(k)),
                             "other_script_names_omitted": sum(not bool(SAFE_SCRIPT.fullmatch(k)) for k in scripts),
                             "commands_included": False, "commands_executed": False})
    for path in ["AGENTS.md", "package.json", "packages/contracts/src/area.ts"]:
        if path not in seen:
            notices.append({"path": path, "status": "not_present_in_this_snapshot"})
    after_head = git(root, "rev-parse", "--verify", "HEAD").decode().strip()
    after = git(root, "status", "--porcelain=v1", "-z", "--untracked-files=normal")
    if before != after or head != after_head:
        raise BaselineError("Checkout changed during collection; rerun against a stable checkout.")
    return root, {
        "schema_version": "ulpin-source-baseline/1",
        "kind": "committed_source_inventory_only",
        "repository": matched_repository,
        "origin_identity_verified": expected_repository is not None,
        "remote_freshness_verified": False,
        "head": head, "branch": branch or None, "detached_head": not bool(branch),
        "checkout_clean": not bool(before),
        "basis": "committed HEAD blobs, not uncommitted working files",
        "git_tree_listing_sha256": hashlib.sha256(tree).hexdigest(),
        "tracked_entry_count": len(entries),
        "collector_runtime": {"python": platform.python_version(), "platform": platform.system()},
        "source_files": sorted(files, key=lambda x: x["path"]),
        "package_script_inventory": sorted(packages, key=lambda x: x["path"]),
        "test_paths": sorted(tests), "workflow_paths": sorted(workflows), "notices": notices,
        "application_tests_run": False, "database_verified": False,
        "original_objects_verified": False, "t001_accepted": False,
        "not_verified": ["Application code semantics and behavior", "Installed application dependencies",
                         "Live or isolated database contents", "Original object bytes",
                         "Source/identity/frame preservation", "Renderer or physical-device performance"],
    }


def write_report(path: Path, root: Path, report: dict) -> None:
    """Create a report without overwriting any file or writing into the checkout."""
    if path.is_symlink():
        raise BaselineError("Output may not be a symlink.")
    destination = path.resolve()
    if destination.is_relative_to(root):
        raise BaselineError("Output must be outside the checkout.")
    if not destination.parent.is_dir():
        raise BaselineError("Create a dedicated external output directory first.")
    try:
        with destination.open("x", encoding="utf-8") as stream:
            json.dump(report, stream, indent=2)
            stream.write("\n")
    except FileExistsError as exc:
        raise BaselineError("Output already exists; choose a new report path.") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expected-repository", help="Optional owner/name check against origin; no network request.")
    parser.add_argument("--allow-dirty", action="store_true", help="Inventory committed HEAD only; never claim the working changes were verified.")
    args = parser.parse_args()
    try:
        root, report = collect(args.repo, expected_repository=args.expected_repository,
                               require_clean=not args.allow_dirty)
        write_report(args.output, root, report)
    except (BaselineError, OSError) as exc:
        # OSError text may contain private absolute paths. Do not print those.
        message = str(exc) if isinstance(exc, BaselineError) else "File operation failed; check the supplied paths and permissions."
        print(json.dumps({"status": "ERROR", "kind": "committed_source_inventory_only", "error": message}))
        return 1
    print(json.dumps({"status": "COLLECTED", "kind": report["kind"], "head": report["head"],
                      "source_files": len(report["source_files"]), "application_tests_run": False,
                      "t001_accepted": False}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
