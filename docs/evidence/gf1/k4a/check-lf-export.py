"""Check an untouched genuine LF archive; preserve historical runtime receipt failures."""
from __future__ import annotations

import json
import runpy
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]


def main() -> None:
    receipt = ROOT / "docs/evidence/gf1/k4a/api-check.json"
    if receipt.exists():
        raise FileExistsError("Preserve the strict archive checker receipt.")
    export = Path(tempfile.mkdtemp(prefix="true-lf-", dir="E:/BhuAayam-data/task-data/k4a"))
    archive = subprocess.Popen(
        ["git", "-c", "core.autocrlf=false", "archive", "HEAD"], cwd=ROOT, stdout=subprocess.PIPE,
    )
    subprocess.run(["tar", "-x", "-C", str(export)], stdin=archive.stdout, check=True)
    assert archive.wait() == 0
    checked = subprocess.run(["python", "scripts/api/check.py"], cwd=export, capture_output=True, text=True)
    export.with_suffix(".log").write_text(checked.stdout + checked.stderr, encoding="utf-8")
    helpers = runpy.run_path(str(ROOT / "docs/evidence/gf-t16/k3b/check-lf-export.py"))
    failures = helpers["diagnose"](export)
    result = {"strictExitCode": checked.returncode, "export": export.as_posix(),
              "checkedCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "method": "git -c core.autocrlf=false archive HEAD | tar -x; no normalization",
              "diagnosticFailures": failures, "onlyRuntimeReceiptChanged": bool(failures)
              and set(failures) == {"runtime receipt changed"}, "diagnosticIsNotPassingChecker": True,
              "receiptMismatches": helpers["receipt_mismatches"](export), "historicalReceiptsRepinned": False}
    receipt.write_text(json.dumps(result) + "\n", encoding="utf-8")
    print(json.dumps(result))
    raise SystemExit(checked.returncode)


if __name__ == "__main__":
    main()
