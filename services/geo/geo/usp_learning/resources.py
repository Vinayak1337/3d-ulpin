"""Supervise only an owned learner process, including blocked native kernels on Windows."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


def write_json_once(path: Path, value: Any) -> None:
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, indent=2, sort_keys=True, allow_nan=False)
        stream.write("\n")


def guarded_run(command: list[str], output_dir: Path, limits: dict[str, Any], *,
                containment_profile: Path | None = None, containment_sha256: str | None = None) -> dict[str, Any]:
    """A separate parent enforces elapsed time/RSS even if the model's GIL is blocked.

    RSS is checked every 50 ms, including Windows Python redirector children.
    CUDA allocator limits are set in the worker.
    """
    if containment_profile is not None or containment_sha256 is not None:
        import hashlib
        import types
        if containment_profile is None or not isinstance(containment_sha256, str):
            raise RuntimeError("Qwen containment: explicit profile and SHA256 required")
        profile_source = Path(containment_profile).read_bytes()
        if hashlib.sha256(profile_source).hexdigest() != containment_sha256:
            raise RuntimeError("Qwen containment: profile SHA256 drift")
        profile = json.loads(profile_source)
        helper = Path(__file__).resolve().parents[4] / "scripts/usp/learning/model_isolation.py"
        source = helper.read_bytes()
        expected = profile["files"]["code/scripts/usp/learning/model_isolation.py"]
        if hashlib.sha256(source).hexdigest() != expected:
            raise RuntimeError("Qwen containment: helper source SHA256 drift before execution")
        # Compile the same verified bytes; no cache-aware loader or second read.
        module = types.ModuleType("qwen_model_isolation")
        module.__file__ = str(helper)
        exec(compile(source, str(helper), "exec"), module.__dict__)
        return module.launch_model(command, output_dir, limits, containment_profile, containment_sha256)
    # The separate E5 caller keeps its existing explicit, uncontained behavior.
    import psutil
    started = time.monotonic()
    peak_rss = 0
    fit_started = None
    fit_complete = False
    reason = None
    measured_fit = None
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    environment = {**os.environ, "USP_LEARNING_SUPERVISOR_PID": str(os.getpid())}
    child = subprocess.Popen(command, creationflags=flags, env=environment)
    owned: dict[int, psutil.Process] = {}

    def stop_owned() -> None:
        for proc in reversed(list(owned.values())):
            try:
                proc.kill()  # psutil verifies process identity against PID reuse.
            except psutil.NoSuchProcess:
                pass
        if child.poll() is None:
            child.kill()

    try:
        process = psutil.Process(child.pid)
        owned[process.pid] = process
        while child.poll() is None:
            now = time.monotonic()
            try:
                for proc in process.children(recursive=True):
                    owned[proc.pid] = proc
                rss = 0
                for proc in list(owned.values()):
                    try:
                        memory = proc.memory_info()
                        rss += max(memory.rss, getattr(memory, "peak_wset", 0))
                    except psutil.NoSuchProcess:
                        pass
                peak_rss = max(peak_rss, rss)
                if fit_started is None and (output_dir / "fit-started.json").exists():
                    try:
                        fit_started = json.loads((output_dir / "fit-started.json").read_text(encoding="utf-8"))["monotonic"]
                    except json.JSONDecodeError:
                        pass  # Child is completing this small, exclusively created marker.
                if not fit_complete and (output_dir / "fit-completed.json").exists():
                    try:
                        completion = json.loads((output_dir / "fit-completed.json").read_text(encoding="utf-8"))
                        measured_fit = completion["monotonic"] - fit_started if fit_started is not None else None
                        fit_complete = measured_fit is not None
                    except json.JSONDecodeError:
                        pass
                if peak_rss > limits["maxPeakProcessRssBytes"]:
                    reason = "process_rss_limit"
                elif now - started > limits["maxRunSeconds"]:
                    reason = "run_time_limit"
                elif (measured_fit is not None and measured_fit > limits["maxFitSeconds"]) or (
                        fit_started is not None and not fit_complete and now - fit_started > limits["maxFitSeconds"]):
                    reason = "fit_time_limit"
                if reason:
                    stop_owned()
                    break
            except psutil.NoSuchProcess:
                break
            time.sleep(0.05)
        child.wait(timeout=10)
        if reason:
            _, alive = psutil.wait_procs(list(owned.values()), timeout=10)
            if alive:
                raise RuntimeError("owned learner process did not stop after limit termination")
    except BaseException:
        stop_owned()
        child.wait(timeout=10)
        raise
    report = {
        "childPid": child.pid, "childExitCode": child.returncode,
        "observedOwnedPids": list(owned),
        "exitCode": (137 if reason == "process_rss_limit" else 124) if reason else child.returncode,
        "limitExceeded": reason, "elapsedSeconds": round(time.monotonic() - started, 3),
        "peakProcessRssBytes": peak_rss,
        "rssMethod": "Windows peak working set plus 50ms RSS sampling" if sys.platform == "win32" else "50ms RSS sampling",
        "scope": "owned process tree including Python launcher; excludes supervisor; allocation may briefly exceed limit before termination",
        "limits": limits,
    }
    write_json_once(output_dir / "resource-guard.json", report)
    return report
