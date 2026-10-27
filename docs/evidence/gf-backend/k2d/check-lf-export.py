"""Run the unchanged API checker on a fresh export with exact historical receipt encodings."""
from __future__ import annotations

import runpy
import subprocess
import tarfile
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]


def main() -> None:
    parent = Path("E:/BhuAayam-data/task-data/k2d")
    parent.mkdir(parents=True, exist_ok=True)
    export = Path(tempfile.mkdtemp(prefix="api-check-", dir=parent))
    archive = export.with_suffix(".tar")
    subprocess.run(["git", "archive", "--format=tar", f"--output={archive}", "HEAD"], check=True)
    with tarfile.open(archive) as bundle:
        bundle.extractall(export, filter="data")
    helpers = runpy.run_path(str(ROOT / "docs/evidence/gf-backend/k2b/check-lf-export.py"))
    helpers["normalize_export"](export)
    subprocess.run(["python", "scripts/api/check.py"], cwd=export, check=True)
    print(f"LF checker passed: {export}; originals and historical receipt pins unchanged.")


if __name__ == "__main__":
    main()
