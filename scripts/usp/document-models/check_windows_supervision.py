"""Focused offline check: no worker code before attachment; timeout kills descendants."""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import sys
import time
from pathlib import Path

import psutil

import run_trial


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    if os.name != "nt":
        parser.error("this check exercises Windows Job Objects only")
    args.output_dir.mkdir(parents=True, exist_ok=False)
    marker = args.output_dir / "worker-started.txt"
    child_pid = args.output_dir / "child.pid"
    script = args.output_dir / "early-worker.py"
    script.write_text(
        "import subprocess,sys,time\n"
        "from pathlib import Path\n"
        "marker,pid=map(Path,sys.argv[1:3])\n"
        "marker.write_text('started')\n"
        "child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'])\n"
        "pid.write_text(str(child.pid))\n"
        "time.sleep(30)\n"
    )
    original = run_trial._WindowsJob
    checked_before_attachment = False
    descendant_in_job = False

    class DelayedJob(original):
        def __init__(self, process, memory_cap_bytes):
            nonlocal checked_before_attachment
            time.sleep(0.5)
            checked_before_attachment = not marker.exists()
            assert checked_before_attachment, "worker ran before Job attachment"
            super().__init__(process, memory_cap_bytes)

        def terminate(self):
            nonlocal descendant_in_job
            if child_pid.exists():
                from ctypes import wintypes
                kernel = ctypes.WinDLL("kernel32", use_last_error=True)
                kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
                kernel.OpenProcess.restype = wintypes.HANDLE
                kernel.IsProcessInJob.argtypes = [wintypes.HANDLE, wintypes.HANDLE,
                                                  ctypes.POINTER(wintypes.BOOL)]
                kernel.IsProcessInJob.restype = wintypes.BOOL
                child = kernel.OpenProcess(0x1000, False, int(child_pid.read_text()))
                if child:
                    answer = wintypes.BOOL()
                    if not kernel.IsProcessInJob(child, self.handle, ctypes.byref(answer)):
                        raise ctypes.WinError(ctypes.get_last_error())
                    descendant_in_job = bool(answer.value)
                    (args.output_dir / "job-membership.txt").write_text(str(descendant_in_job))
                    kernel.CloseHandle(child)
            super().terminate()

    run_trial._WindowsJob = DelayedJob
    try:
        timed = run_trial._run_worker(
            [sys.executable, str(script), str(marker), str(child_pid)],
            args.output_dir / "timeout.log", 2, 100 * 1024**2)
    finally:
        run_trial._WindowsJob = original
    assert checked_before_attachment and marker.exists() and child_pid.exists()
    pid = int(child_pid.read_text())
    assert timed["gatedStart"] and timed["stopReason"] == "runtime_cap_exceeded"
    assert not psutil.pid_exists(pid), "owned early descendant survived timeout"

    marker.unlink()
    rejected_pid = None

    class RejectedJob:
        def __init__(self, process, memory_cap_bytes):
            nonlocal rejected_pid
            rejected_pid = process.pid
            time.sleep(0.5)
            assert not marker.exists(), "worker ran before rejected attachment"
            raise RuntimeError("probe_attachment_rejected")

    run_trial._WindowsJob = RejectedJob
    try:
        try:
            run_trial._run_worker([sys.executable, str(script), str(marker), str(child_pid)],
                                  args.output_dir / "rejected.log", 2, 100 * 1024**2)
        except RuntimeError as exc:
            assert str(exc) == "probe_attachment_rejected"
        else:
            raise AssertionError("rejected attachment unexpectedly launched worker")
    finally:
        run_trial._WindowsJob = original
    assert rejected_pid is not None and not psutil.pid_exists(rejected_pid)
    assert not marker.exists(), "rejected attachment executed worker code"
    result = {"gatedBeforeAttachment": checked_before_attachment,
              "descendantInJob": descendant_in_job,
              "timeoutStoppedDescendant": True, "rejectedAttachmentStoppedBootstrap": True,
              "timeout": timed}
    (args.output_dir / "probe.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"status": "passed", "receipt": str(args.output_dir / "probe.json")}))


if __name__ == "__main__":
    main()
