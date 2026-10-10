"""Reuse the existing Job supervisor, retaining an explicit worker exception trace."""
from __future__ import annotations

import json
import runpy
import sys
import traceback
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
OUTPUT = Path("E:/BhuAayam-data/task-data/k2/ocr-debug/capture-k2b")


def worker() -> int:
    trace = OUTPUT / "traceback.txt"
    with trace.open("x", encoding="utf-8", buffering=1) as stream:
        sys.stderr = stream
        print(f"Supervised Python: {sys.executable}", file=stream, flush=True)
        runner = ROOT / "scripts/usp/document-models/run_source_ocr.py"
        sys.argv = [str(runner), "--worker", *sys.argv[2:]]
        try:
            runpy.run_path(str(runner), run_name="__main__")
        except SystemExit as exc:
            print(f"Runner exit: {exc.code}", file=stream, flush=True)
            return int(exc.code or 0)
        except BaseException:
            traceback.print_exc(file=stream)
            return 1
    return 0


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "worker":
        return worker()
    sys.path.insert(0, str(ROOT / "scripts/usp/document-models"))
    sys.path.insert(0, str(ROOT / "services/geo"))
    from run_trial import _run_worker

    OUTPUT.mkdir(exist_ok=False)
    command = [sys.executable, str(Path(__file__).resolve()), "worker", *sys.argv[1:]]
    receipt = _run_worker(command, OUTPUT / "worker.log", 90, 6 * 1024**3, max_log_bytes=2 * 1024**2)
    (OUTPUT / "supervision.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return int(receipt["exitCode"] or 0)


if __name__ == "__main__":
    raise SystemExit(main())
