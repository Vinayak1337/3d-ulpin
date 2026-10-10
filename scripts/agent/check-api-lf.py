"""Run the existing API checker on a task-local LF export without modifying checkout producers."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from uuid import uuid4

REPO = Path(__file__).resolve().parents[2]
OUTPUT_ROOT = Path("E:/BhuAayam-data/task-data/a4")


def export_paths() -> set[str]:
    pins = json.loads((REPO / "docs/api/source-pins.json").read_text(encoding="utf-8"))
    runtime = json.loads((REPO / "docs/api/runtime-qualification.json").read_text(encoding="utf-8"))
    paths = {"scripts/api/check.py", "docs/api/openapi.json", "docs/api/source-pins.json",
             "docs/api/runtime-qualification.json", "docs/orchestration/nestjs-operation-ledger.json"}
    paths.update(pins["sourceSha256"])
    paths.update(path.relative_to(REPO).as_posix() for path in (REPO / "docs/api").glob("*.md"))
    paths.update(path.relative_to(REPO).as_posix()
                 for path in (REPO / "apps/api/src/modules").glob("*/operation-manifest.json"))
    for run in [runtime, *runtime.get("additionalRuns", [])]:
        paths.add(run["receipt"])
    return paths


def main() -> None:
    out = OUTPUT_ROOT / f"api-lf-{uuid4().hex}"
    out.mkdir(parents=True, exist_ok=False)
    raw_paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=REPO)
    tracked = raw_paths.decode("utf-8").strip("\0").split("\0")
    required = export_paths()
    for name in required:
        if Path(name).name.startswith(".env"):
            raise ValueError("API_LF_CREDENTIAL_PATH_DENIED")
        destination = out / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("xb") as handle:
            handle.write((REPO / name).read_bytes().replace(b"\r\n", b"\n"))
    # Empty placeholders support repository-relative link existence checks, not content qualification.
    for name in tracked:
        if name in required or Path(name).name.startswith(".env"):
            continue
        path = out / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb"):
            pass
    result = subprocess.run(["python", "scripts/api/check.py"], cwd=out, check=False)
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
