"""Run the strict checker on a true Git export, then diagnose all remaining checks without changing files."""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import runpy
import subprocess
import tempfile
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[4]


def diagnose(export: Path) -> list[str]:
    loaded = runpy.run_path(str(export / "scripts/api/check.py"))
    failures: list[str] = []

    def observe(condition: Any, message: str) -> None:
        if not condition:
            failures.append(message)

    loaded["main"].__globals__["require"] = observe
    with contextlib.redirect_stdout(io.StringIO()):
        loaded["main"]()
    return failures


def receipt_mismatches(export: Path) -> list[dict[str, str]]:
    qualification = json.loads((export / 'docs/api/runtime-qualification.json').read_bytes())
    mismatches = []
    for run in [qualification, *qualification.get('additionalRuns', [])]:
        actual = hashlib.sha256((export / run['receipt']).read_bytes()).hexdigest()
        if actual != run['receiptSha256']:
            mismatches.append({'receipt': run['receipt'], 'expected': run['receiptSha256'], 'actual': actual})
    return mismatches


def main() -> None:
    parent = Path("E:/BhuAayam-data/task-data/k3b")
    parent.mkdir(parents=True, exist_ok=True)
    export = Path(tempfile.mkdtemp(prefix="true-lf-", dir=parent))
    archive = subprocess.Popen(["git", "-c", "core.autocrlf=false", "archive", "HEAD"], stdout=subprocess.PIPE)
    subprocess.run(["tar", "-x", "-C", str(export)], stdin=archive.stdout, check=True)
    assert archive.wait() == 0
    checked = subprocess.run(["python", "scripts/api/check.py"], cwd=export, capture_output=True, text=True)
    (export.parent / f"{export.name}.log").write_text(checked.stdout + checked.stderr, encoding="utf-8")
    failures = diagnose(export)
    result = {"strictExitCode": checked.returncode, "export": export.as_posix(),
              "method": "git -c core.autocrlf=false archive HEAD | tar -x; no post-export normalization",
              "diagnosticFailures": failures, "onlyRemainingFailure": bool(failures)
              and set(failures) == {"runtime receipt changed"}, "checkerChanged": False,
              "runtimeReceiptsOrPinsChanged": False, "diagnosticIsNotAPassingChecker": True,
              "receiptMismatches": receipt_mismatches(export)}
    with (ROOT / "docs/evidence/gf-t16/k3b/api-check.json").open("x", encoding="utf-8") as output:
        output.write(json.dumps(result) + "\n")
    print(json.dumps(result))
    raise SystemExit(checked.returncode)


if __name__ == "__main__":
    main()
