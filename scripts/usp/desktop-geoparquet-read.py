#!/usr/bin/env python3
"""Bounded local GeoParquet 1.1.0 row reader. No API, services or original edits."""
from __future__ import annotations

import argparse
import ctypes
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import sysconfig
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/geo"))
from geo.native_geoparquet import DEFAULT_LIMITS, GeoParquetError, Limits, encode_result, extract, fail

# Stdlib only, before any site initialization or native library import. The
# parent attaches a Job / affinity limits, then releases this same process.
GATE = """import sys
if sys.stdin.buffer.read(1) != b'1': raise SystemExit(3)
sys.path.insert(0,sys.argv[1])
import runpy
sys.argv=sys.argv[2:]
runpy.run_path(sys.argv[0],run_name='__main__')
"""


class WindowsJob:
    """Adapted from the existing document-model supervisor, without ML imports."""
    def __init__(self, process, limits):
        from ctypes import wintypes

        class Basic(ctypes.Structure):
            _fields_ = [("processTime", ctypes.c_int64), ("jobTime", ctypes.c_int64),
                        ("flags", wintypes.DWORD), ("minimumWorkingSet", ctypes.c_size_t),
                        ("maximumWorkingSet", ctypes.c_size_t), ("activeProcessLimit", wintypes.DWORD),
                        ("affinity", ctypes.c_size_t), ("priorityClass", wintypes.DWORD),
                        ("schedulingClass", wintypes.DWORD)]

        class IO(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in (
                "readOperations", "writeOperations", "otherOperations", "readBytes", "writeBytes", "otherBytes")]

        class Extended(ctypes.Structure):
            _fields_ = [("basic", Basic), ("io", IO), ("processMemory", ctypes.c_size_t),
                        ("jobMemory", ctypes.c_size_t), ("peakProcessMemory", ctypes.c_size_t),
                        ("peakJobMemory", ctypes.c_size_t)]

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        kernel.SetInformationJobObject.restype = wintypes.BOOL
        kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel.AssignProcessToJobObject.restype = wintypes.BOOL
        kernel.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
        kernel.QueryInformationJobObject.restype = wintypes.BOOL
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL
        self.kernel, self.structure = kernel, Extended
        self.handle = kernel.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            config = Extended()
            config.basic.flags = 0x2000 | 0x0200 | 0x0100 | 0x0008
            config.basic.activeProcessLimit = 1
            config.processMemory = config.jobMemory = limits.memory_bytes
            if not kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(config), ctypes.sizeof(config)):
                raise ctypes.WinError(ctypes.get_last_error())
            if not kernel.AssignProcessToJobObject(self.handle, wintypes.HANDLE(int(process._handle))):
                raise ctypes.WinError(ctypes.get_last_error())
        except BaseException:
            self.close()
            raise

    def peak_bytes(self):
        value = self.structure()
        if not self.kernel.QueryInformationJobObject(self.handle, 9, ctypes.byref(value), ctypes.sizeof(value), None):
            raise ctypes.WinError(ctypes.get_last_error())
        return int(value.peakJobMemory)

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)  # kill-on-close also covers failed starts
            self.handle = None


def worker(source: Path, destination: Path, limits: Limits, start_row, row_count):
    if os.name == "posix":
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (limits.memory_bytes, limits.memory_bytes))
        resource.setrlimit(resource.RLIMIT_CPU, (math_ceil(limits.seconds), math_ceil(limits.seconds)+1))
        resource.setrlimit(resource.RLIMIT_FSIZE, (limits.output_bytes, limits.output_bytes))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    try:
        with source.open("rb") as stream:
            raw = stream.read(limits.input_bytes+1)
        result = extract(raw, start_row, row_count, limits)
        data = encode_result(result, limits)
    except GeoParquetError as exc:
        data = json.dumps({"error": exc.as_dict()}, separators=(",", ":")).encode("utf-8")
    except MemoryError:
        data = b'{"error":{"status":"limit","code":"MEMORY_LIMIT","message":"GeoParquet worker memory allocation failed."}}'
    except Exception:
        data = b'{"error":{"status":"failed","code":"WORKER_FAILED","message":"GeoParquet worker failed without publishing a projection."}}'
    with destination.open("xb") as stream:
        stream.write(data)


def math_ceil(value):
    import math
    return math.ceil(value)


def supervise(snapshot: Path, result_path: Path, limits=DEFAULT_LIMITS, start_row=0, row_count=100):
    try:
        import psutil
    except ImportError:
        fail("SUPERVISOR_UNAVAILABLE", "Install the lane's pinned psutil dependency.", "unavailable")
    if psutil.__version__ != "7.0.0":
        fail("SUPERVISOR_VERSION", "Use pinned psutil 7.0.0.", "unavailable")
    if os.name not in ("nt", "posix") or (os.name == "posix" and not hasattr(os, "sched_setaffinity")):
        fail("BOUNDS_UNAVAILABLE", "This OS cannot enforce this reader's process bounds.", "unavailable")
    # No credentials, PYTHONPATH, GPU or provider environment reaches the parser.
    env = {k: os.environ[k] for k in ("SystemRoot", "WINDIR", "LANG") if k in os.environ}
    # Parser-created temporary copies remain under the supervisor-owned directory,
    # including after a hard kill where worker finally blocks cannot run.
    env.update({k: str(snapshot.parent.resolve()) for k in ("TEMP", "TMP", "TMPDIR")})
    env.update({k: "1" for k in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS")})
    # Windows venv python.exe is a redirector that spawns the base interpreter;
    # launch the actual interpreter directly to retain one processing process.
    command = [sys._base_executable, "-I", "-S", "-c", GATE, sysconfig.get_path("purelib"),
               str(Path(__file__).resolve()), "--worker", str(snapshot), str(result_path), json.dumps(asdict(limits)),
               str(start_row), str(row_count)]
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               env=env, start_new_session=os.name == "posix",
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    started, job, peak_rss, peak_threads, reason = time.monotonic(), None, 0, 0, None
    try:
        if os.name == "nt":
            job = WindowsJob(process, limits)
        observed = psutil.Process(process.pid)
        observed.cpu_affinity(observed.cpu_affinity()[:limits.threads])
        attached_affinity = observed.cpu_affinity()
        baseline_threads = observed.num_threads()
        helper_allowance = 4 if os.name == "nt" else 0
        total_thread_ceiling = limits.threads + helper_allowance
        process.stdin.write(b"1")
        process.stdin.close()
        while process.poll() is None:
            if time.monotonic() - started >= limits.seconds:
                reason = "TIME_LIMIT"
                break
            try:
                peak_threads = max(peak_threads, observed.num_threads())
                peak_rss = max(peak_rss, observed.memory_info().rss)
                # Windows creates idle loader/helper threads before Python runs.
                # CPU affinity and compute-pool variables bound processing;
                # additionally reject thread growth beyond a fixed helper allowance.
                if peak_threads > total_thread_ceiling:
                    reason = "THREAD_LIMIT"
                elif peak_rss > limits.memory_bytes:
                    reason = "MEMORY_LIMIT"
                elif os.name != "nt" and observed.children():
                    reason = "PROCESS_LIMIT"
            except psutil.NoSuchProcess:
                break
            if reason:
                break
            time.sleep(0.02)
        if reason:
            fail(reason, f"GeoParquet worker exceeded its isolated resource limit (sampled threads {peak_threads}, RSS {peak_rss}).", "limit")
        process.wait(timeout=2)
        execution = {"platform": sys.platform, "exitCode": process.returncode, "seconds": round(time.monotonic()-started, 3),
                     "peakSampledRssBytes": peak_rss, "peakSampledThreads": peak_threads,
                     "peakJobPrivateBytes": job.peak_bytes() if job else None,
                     "memoryEnforcement": "Windows Job private-byte ceiling" if job else "RLIMIT_AS",
                     "processLimit": 1, "processingCpuLimit": limits.threads, "observedCpuAffinity": attached_affinity,
                     "computePoolThreads": 1, "baselineOsThreads": baseline_threads,
                     "osHelperAllowance": helper_allowance, "totalOsThreadCeiling": total_thread_ceiling,
                     "literalTwoOsThreadsEnforced": False, "gatedStart": True,
                     "osEgressDenied": False, "arrowInput": "BufferReader of pinned bytes; no filesystem dispatch"}
        if process.returncode != 0 or not result_path.is_file():
            fail("WORKER_EXIT", "GeoParquet parser exited without a result; input is preserved.", "failed")
        with result_path.open("rb") as stream:
            data = stream.read(limits.output_bytes+1)
        if len(data) > limits.output_bytes:
            fail("OUTPUT_LIMIT", "GeoParquet worker result exceeded its byte limit.", "limit")
        result = json.loads(data)
        if "error" in result:
            error = result["error"]
            raise GeoParquetError(error["code"], error["message"], error["status"], error.get("locator"))
        return data, execution
    finally:
        if job:
            job.close()
        elif os.name == "posix" and process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if process.poll() is None:
            process.kill()
        process.wait(timeout=3)
        if process.stdin and not process.stdin.closed:
            process.stdin.close()


def local_path(value):
    """Reject URLs, UNC/mapped drives, ADS and reparse/symlink traversal.

    Arrow never sees this path. OS network denial is not claimed; local fixed
    disk admission plus a byte snapshot removes URI/extension dispatch here.
    """
    text = os.fspath(value)
    if text.startswith(("\\\\", "//")) or "\x00" in text:
        fail("LOCAL_ONLY", "Only ordinary local disk paths are accepted.", "denied")
    if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", text) and not re.match(r"^[A-Za-z]:[\\/]", text):
        fail("LOCAL_ONLY", "URL/resource schemes are not accepted.", "denied")
    path = Path(os.path.abspath(text))
    if os.name == "nt":
        if ":" in str(path)[2:]:
            fail("LOCAL_ONLY", "Alternate streams are not accepted.", "denied")
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.GetDriveTypeW.argtypes = [ctypes.c_wchar_p]
        kernel.GetDriveTypeW.restype = ctypes.c_uint
        if kernel.GetDriveTypeW(path.anchor) != 3:
            fail("LOCAL_ONLY", "Select an ordinary fixed local disk.", "denied")
    for component in reversed((path, *path.parents)):
        try:
            info = component.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or (getattr(info, "st_file_attributes", 0) & 0x400):
            fail("LOCAL_ONLY", "Symlink/reparse paths are not accepted.", "denied")
    return path


def read_file(source, output_dir, limits=DEFAULT_LIMITS, start_row=0, row_count=100):
    source, output_dir = local_path(source), local_path(output_dir)
    if type(start_row) is not int or start_row < 0 or type(row_count) is not int or not 1 <= row_count <= limits.rows:
        fail("ROW_RANGE", "Select a nonnegative start and 1..1000 rows within configured limits.", "denied")
    if output_dir.exists():
        fail("OUTPUT_EXISTS", "Choose a fresh private output directory; prior data is preserved.", "denied")
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    with os.fdopen(os.open(source, flags), "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            fail("INPUT_TYPE", "Select an ordinary local Parquet file.", "unsupported")
        raw = stream.read(limits.input_bytes+1)
    if len(raw) > limits.input_bytes:
        fail("INPUT_LIMIT", "GeoParquet input exceeds the byte limit.", "limit")
    # Admission by exclusive directory creation; Python 3.13 handles Windows
    # mode 0700 with a restricted DACL. POSIX receives the same owner-only mode.
    try:
        output_dir.mkdir(mode=0o700)
    except FileExistsError:
        fail("OUTPUT_EXISTS", "Output directory appeared; prior data is preserved.", "denied")
    output = output_dir/"projection.json"
    with tempfile.TemporaryDirectory(prefix=".work-", dir=output_dir) as directory:
        snapshot, result_path = Path(directory)/"original.parquet", Path(directory)/"projection.json"
        snapshot.write_bytes(raw)
        data, execution = supervise(snapshot, result_path, limits, start_row, row_count)
        parsed = json.loads(data)
        if parsed["source"]["sha256"] != hashlib.sha256(raw).hexdigest():
            fail("SOURCE_DRIFT", "Worker result differs from the pinned original bytes.", "failed")
        # Hard link is an atomic exclusive publication of complete flushed bytes.
        with result_path.open("rb+") as stream:
            os.fsync(stream.fileno())
        try:
            os.link(result_path, output)
        except FileExistsError:
            fail("OUTPUT_EXISTS", "Output appeared during extraction; prior result preserved.", "denied")
    return {"status": parsed["window"]["status"], "output": str(output), "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(), "sourceSha256": parsed["source"]["sha256"],
            "profile": {k: parsed["profile"][k] for k in ("status", "reasons")},
            "window": parsed["window"], "execution": execution}


def main():
    if len(sys.argv) == 7 and sys.argv[1] == "--worker":
        worker(Path(sys.argv[2]), Path(sys.argv[3]), Limits(**json.loads(sys.argv[4])), int(sys.argv[5]), int(sys.argv[6]))
        return 0
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--start-row", type=int, default=0)
    parser.add_argument("--rows", type=int, default=100)
    args = parser.parse_args()
    try:
        receipt = read_file(args.source, args.output_dir, start_row=args.start_row, row_count=args.rows)
        code = 0
    except GeoParquetError as exc:
        receipt, code = {"error": exc.as_dict()}, 2
    except OSError:
        receipt, code = {"error": {"status": "unavailable", "code": "LOCAL_IO", "message": "Check local source/output paths and the isolated environment."}}, 2
    print(json.dumps(receipt, sort_keys=True))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
