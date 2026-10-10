"""Check a fresh committed LF export with the retained K2b receipt normalizer."""
from __future__ import annotations

import runpy
import subprocess
import tarfile
import tempfile
from pathlib import Path
from typing import Callable, cast


ROOT = Path(__file__).resolve().parents[4]


def main() -> None:
    parent = Path("E:/BhuAayam-data/task-data/k2c")
    parent.mkdir(exist_ok=True)
    export = Path(tempfile.mkdtemp(prefix="api-check-", dir=parent))
    archive = export.with_suffix(".tar")
    subprocess.run(["git", "archive", "--format=tar", f"--output={archive}", "HEAD"], check=True)
    with tarfile.open(archive) as bundle:
        bundle.extractall(export, filter="data")
    helpers = runpy.run_path(str(ROOT / "docs/evidence/gf-backend/k2b/check-lf-export.py"))
    normalize = cast(Callable[[Path], None], helpers["normalize_export"])
    normalize(export)
    subprocess.run(["python", "scripts/api/check.py"], cwd=export, check=True)
    print(f"LF contract checker passed: {export}")


if __name__ == "__main__":
    main()
