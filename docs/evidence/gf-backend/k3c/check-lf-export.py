"""Strict API pin check on a fresh genuine LF archive; diagnose all failures without re-pinning receipts."""
from __future__ import annotations

import json
import runpy
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]


def export_head(parent: Path) -> Path:
    export = Path(tempfile.mkdtemp(prefix="true-lf-", dir=parent))
    archive = subprocess.Popen(
        ["git", "-c", "core.autocrlf=false", "archive", "HEAD"], cwd=ROOT, stdout=subprocess.PIPE,
    )
    subprocess.run(["tar", "-x", "-C", str(export)], stdin=archive.stdout, check=True)
    assert archive.wait() == 0
    return export


def main() -> None:
    receipt = ROOT / "docs/evidence/gf-backend/k3c/api-check.json"
    if receipt.exists():
        raise FileExistsError("Preserve each strict checker receipt; do not rerun this capture.")
    export = export_head(Path("E:/BhuAayam-data/task-data/k3c"))
    checked = subprocess.run(["python", "scripts/api/check.py"], cwd=export, capture_output=True, text=True)
    with export.with_suffix(".log").open("x", encoding="utf-8") as output:
        output.write(checked.stdout + checked.stderr)
    helpers = runpy.run_path(str(ROOT / "docs/evidence/gf-t16/k3b/check-lf-export.py"))
    failures = helpers["diagnose"](export)
    result = {"strictExitCode": checked.returncode, "export": export.as_posix(),
              "checkedCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "method": "git -c core.autocrlf=false archive HEAD | tar -x; no post-export normalization",
              "diagnosticFailures": failures, "onlyRemainingFailure": bool(failures)
              and set(failures) == {"runtime receipt changed"}, "checkerChanged": False,
              "runtimeReceiptsOrPinsChanged": False, "diagnosticIsNotAPassingChecker": True,
              "receiptMismatches": helpers["receipt_mismatches"](export)}
    with receipt.open("x", encoding="utf-8") as output:
        output.write(json.dumps(result) + "\n")
    print(json.dumps(result))
    raise SystemExit(checked.returncode)


if __name__ == "__main__":
    main()
