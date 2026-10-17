"""Run the unchanged API checker on a new LF export, preserving pinned receipts."""
from __future__ import annotations

import hashlib
import json
import subprocess
import tarfile
import tempfile
from pathlib import Path


TEXT_SUFFIXES = {".ts", ".js", ".mjs", ".py", ".md", ".json"}


def exact_receipt(data: bytes, digest: str) -> bytes:
    lf = data.replace(b"\r\n", b"\n")
    for candidate in (data, lf, lf.replace(b"\n", b"\r\n")):
        if hashlib.sha256(candidate).hexdigest() == digest:
            return candidate
    raise ValueError("Archive receipt encoding does not recover its unchanged recorded hash")


def normalize_export(export: Path) -> None:
    qualification = json.loads((export / "docs/api/runtime-qualification.json").read_text(encoding="utf-8"))
    receipts = {entry["receipt"]: entry["receiptSha256"]
                for entry in [qualification, *qualification.get("additionalRuns", [])]}
    for path in export.rglob("*"):
        if not path.is_file() or path.name.startswith(".env"):
            continue
        relative = path.relative_to(export).as_posix()
        if relative.startswith("fixtures/"):
            continue
        if relative not in receipts and path.suffix not in TEXT_SUFFIXES:
            continue
        data = path.read_bytes()
        if relative in receipts:
            normalized = exact_receipt(data, receipts[relative])
        else:
            normalized = data if b"\x00" in data else data.replace(b"\r\n", b"\n")
        if data != normalized:
            path.write_bytes(normalized)


def main() -> None:
    parent = Path("E:/BhuAayam-data/task-data/k2")
    export = Path(tempfile.mkdtemp(prefix="api-check-k2b-", dir=parent))
    archive = export.with_suffix(".tar")
    subprocess.run(["git", "archive", "--format=tar", f"--output={archive}", "HEAD"], check=True)
    with tarfile.open(archive) as bundle:
        bundle.extractall(export, filter="data")
    normalize_export(export)
    subprocess.run(["python", "scripts/api/check.py"], cwd=export, check=True)
    print(f"Checker passed in fresh LF archive: {export}; checkout and prior exports unchanged")


if __name__ == "__main__":
    main()
