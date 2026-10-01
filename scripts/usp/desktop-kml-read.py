"""Inspect unchanged local KML/KMZ in one gated Windows process; publish fresh artifacts."""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import sysconfig
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/geo"))
from geo.native_kml import (KMLError, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, MAX_SECONDS,
                            MEMORY_BYTES, _read_kml, encode_kml_result)

# Only this stdlib gate runs before Job assignment; no site/.pth or parser import.
GATE = ("import sys\n"
        "if sys.stdin.buffer.read(1)!=b'1': raise SystemExit(3)\n"
        "sys.path.insert(0,sys.argv[1])\n"
        "import runpy\n"
        "sys.argv=sys.argv[2:]\n"
        "runpy.run_path(sys.argv[0],run_name='__main__')\n")


class _WindowsJob:
    """Adapted from the existing run_trial Job pattern, with one active process."""
    def __init__(self, process):
        from ctypes import wintypes as w

        class Basic(ctypes.Structure):
            _fields_ = [("processTime", ctypes.c_int64), ("jobTime", ctypes.c_int64),
                        ("flags", w.DWORD), ("minimum", ctypes.c_size_t), ("maximum", ctypes.c_size_t),
                        ("activeProcesses", w.DWORD), ("affinity", ctypes.c_size_t),
                        ("priority", w.DWORD), ("scheduling", w.DWORD)]

        class Io(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in ("readOps", "writeOps", "otherOps", "readBytes", "writeBytes", "otherBytes")]

        class Extended(ctypes.Structure):
            _fields_ = [("basic", Basic), ("io", Io), ("processMemory", ctypes.c_size_t),
                        ("jobMemory", ctypes.c_size_t), ("peakProcessMemory", ctypes.c_size_t),
                        ("peakJobMemory", ctypes.c_size_t)]

        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.CreateJobObjectW.argtypes, k.CreateJobObjectW.restype = [ctypes.c_void_p, w.LPCWSTR], w.HANDLE
        k.SetInformationJobObject.argtypes, k.SetInformationJobObject.restype = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD], w.BOOL
        k.AssignProcessToJobObject.argtypes, k.AssignProcessToJobObject.restype = [w.HANDLE, w.HANDLE], w.BOOL
        k.QueryInformationJobObject.argtypes, k.QueryInformationJobObject.restype = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD, ctypes.c_void_p], w.BOOL
        k.TerminateJobObject.argtypes, k.TerminateJobObject.restype = [w.HANDLE, w.UINT], w.BOOL
        k.CloseHandle.argtypes, k.CloseHandle.restype = [w.HANDLE], w.BOOL
        k.GetProcessAffinityMask.argtypes, k.GetProcessAffinityMask.restype = [w.HANDLE, ctypes.c_void_p, ctypes.c_void_p], w.BOOL
        handle = k.CreateJobObjectW(None, None)
        if not handle:
            raise ctypes.WinError(ctypes.get_last_error())
        self.kernel, self.handle, self.limits = k, handle, Extended
        try:
            process_mask, system_mask = ctypes.c_size_t(), ctypes.c_size_t()
            if not k.GetProcessAffinityMask(w.HANDLE(int(process._handle)), ctypes.byref(process_mask), ctypes.byref(system_mask)):
                raise ctypes.WinError(ctypes.get_last_error())
            cores = [1 << bit for bit in range(ctypes.sizeof(ctypes.c_size_t) * 8) if process_mask.value & (1 << bit)]
            self.affinity = sum(cores[:2])
            if not self.affinity:
                raise OSError("No allowed processor affinity.")
            limits = Extended()
            # KILL_ON_JOB_CLOSE | JOB_MEMORY | PROCESS_MEMORY | ACTIVE_PROCESS | AFFINITY
            limits.basic.flags = 0x2000 | 0x0200 | 0x0100 | 0x0008 | 0x0010
            limits.basic.activeProcesses, limits.basic.affinity = 1, self.affinity
            limits.processMemory = limits.jobMemory = MEMORY_BYTES
            if not k.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
                raise ctypes.WinError(ctypes.get_last_error())
            if not k.AssignProcessToJobObject(handle, w.HANDLE(int(process._handle))):
                raise ctypes.WinError(ctypes.get_last_error())
        except BaseException:
            self.close()
            raise

    def peak(self):
        limits = self.limits()
        if not self.kernel.QueryInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits), None):
            raise ctypes.WinError(ctypes.get_last_error())
        return int(limits.peakJobMemory)

    def terminate(self):
        if not self.kernel.TerminateJobObject(self.handle, 1):
            raise ctypes.WinError(ctypes.get_last_error())

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


def _original(source, expected):
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise ValueError("Expected SHA-256 must be 64 lowercase hexadecimal characters.")
    source = source.resolve(strict=True)
    if not source.is_file() or str(source).startswith("\\\\"):
        raise ValueError("Source must be a regular local file.")
    with source.open("rb") as handle:
        raw = handle.read(MAX_INPUT_BYTES + 1)
    if not raw or len(raw) > MAX_INPUT_BYTES:
        raise ValueError("Original must be nonempty and at most 16 MiB.")
    if hashlib.sha256(raw).hexdigest() != expected:
        raise ValueError("Original SHA-256 differs from the expected input.")
    return source, raw


def _supervise(command, purelib):
    if os.name != "nt":
        raise KMLError("ISOLATION_UNAVAILABLE", "This local supervisor currently supports Windows Job Objects only.", "unsupported")
    env = os.environ.copy()
    env.update({name: "1" for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS", "VECLIB_MAXIMUM_THREADS")})
    env["CUDA_VISIBLE_DEVICES"] = ""
    started = time.monotonic()
    process = subprocess.Popen([sys._base_executable, "-I", "-S", "-c", GATE, purelib, *command],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               env=env, creationflags=subprocess.CREATE_NO_WINDOW)
    output, overflow, read_error = bytearray(), threading.Event(), threading.Event()

    def drain():
        try:
            while chunk := process.stdout.read1(8192):
                available = MAX_OUTPUT_BYTES + 1 - len(output)
                if available > 0:
                    output.extend(chunk[:available])
                if len(chunk) > available or len(output) > MAX_OUTPUT_BYTES:
                    overflow.set()
        except OSError:
            read_error.set()

    reader = threading.Thread(target=drain, daemon=True, name="kml-bounded-output")
    reader.start()
    job, reason, peak, affinity = None, None, None, None
    try:
        job = _WindowsJob(process)
        affinity = job.affinity
        process.stdin.write(b"1")
        process.stdin.close()
        while process.poll() is None:
            if time.monotonic() - started >= MAX_SECONDS:
                reason = "TIME_LIMIT"
                break
            if overflow.is_set() or read_error.is_set():
                reason = "OUTPUT_LIMIT" if overflow.is_set() else "OUTPUT_CAPTURE"
                break
            time.sleep(0.02)
    finally:
        if not process.stdin.closed:
            process.stdin.close()
        if process.poll() is None:
            if job:
                job.terminate()
            else:
                process.kill()  # Gate never released if Job attachment failed.
        try:
            process.wait(timeout=3)
            if job:
                peak = job.peak()
        finally:
            if job:
                job.close()
            reader.join(timeout=3)
            process.stdout.close()
    if reader.is_alive():
        raise KMLError("OUTPUT_CAPTURE", "Owned output reader did not finish.", "failed")
    if reason or overflow.is_set() or read_error.is_set():
        raise KMLError(reason or "OUTPUT_LIMIT", "Child exceeded its finite resource/output profile.", "limit")
    if process.returncode:
        try:
            error = json.loads(output)["error"]
            code, message, status = error["code"], error["message"], error["status"]
        except (ValueError, KeyError, TypeError):
            error = None
        if error:
            raise KMLError(code, message, status, error.get("locator"))
        raise KMLError("CHILD_FAILED", "Reader child failed; no result was published.", "failed")
    return bytes(output), {"gatedStart": True, "memoryBytes": MEMORY_BYTES, "activeProcessLimit": 1,
                          "deadlineSeconds": MAX_SECONDS, "affinityMask": affinity,
                          "computePoolThreads": 1, "osThreadCeiling": None,
                          "peakJobPrivateBytes": peak, "exitCode": process.returncode,
                          "elapsedSeconds": round(time.monotonic() - started, 6)}


def run_supervised(source, expected, *, member=None):
    source, _ = _original(source, expected)
    if importlib.metadata.version("defusedxml") != "0.7.1":
        raise ValueError("Use the lane's hash-locked defusedxml 0.7.1 environment.")
    command = [str(Path(__file__).resolve()), "--worker", str(source), expected]
    if member is not None:
        command.append(member)
    output, supervision = _supervise(command, sysconfig.get_paths()["purelib"])
    parsed = json.loads(output)
    if parsed.get("sourceSha256") != expected or parsed.get("schemaVersion") != "kml-native-inspection/1":
        raise ValueError("Child result has inconsistent source/schema lineage.")
    _original(source, expected)
    return output, supervision


def _worker():
    try:
        _, raw = _original(Path(sys.argv[2]), sys.argv[3])
        result = _read_kml(raw, member=sys.argv[4] if len(sys.argv) > 4 else None)
        sys.stdout.buffer.write(encode_kml_result(result))
        return 0
    except KMLError as error:
        sys.stdout.buffer.write(json.dumps({"error": error.as_dict()}).encode("utf-8"))
    except (OSError, ValueError, MemoryError):
        sys.stdout.buffer.write(b'{"error":{"code":"WORKER_INPUT_OR_RESOURCE","status":"failed","message":"Child input or resources failed."}}')
    return 2


def _fresh_output(path):
    path = path.resolve()
    if path.exists() or not path.parent.is_dir():
        raise ValueError("Output directory must be fresh with an existing parent.")
    if any((ancestor / ".git").exists() or ancestor.name.casefold() == ".git" for ancestor in (path, *path.parents)):
        raise ValueError("Output must be outside Git checkouts/storage.")
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--member", help="Exact KMZ KML member; required when multiple KML entries exist.")
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    temporary, owned = None, []
    try:
        out = _fresh_output(args.output_dir)
        source, raw = _original(args.source, args.expected_sha256)
        output, supervision = run_supervised(source, args.expected_sha256, member=args.member)
        parsed = json.loads(output)
        dependencies = {}
        distribution = importlib.metadata.distribution("defusedxml")
        for entry in distribution.files or []:
            if str(entry).startswith("defusedxml/") and str(entry).endswith(".py"):
                dependencies[str(entry)] = hashlib.sha256(distribution.locate_file(entry).read_bytes()).hexdigest()
        receipt = {"schemaVersion": "kml-local-receipt/1", "sourceSha256": args.expected_sha256,
                   "sourcePath": str(source), "sourceBytes": len(raw), "member": parsed["member"],
                   "status": parsed["status"], "featureCount": len(parsed["features"]),
                   "coordinateCount": parsed["coordinateCount"], "unsupportedCount": len(parsed["unsupported"]),
                   "referenceCount": len(parsed["references"]), "qualification": parsed["qualification"],
                   "supervision": supervision, "pythonVersion": sys.version, "pythonExecutable": sys._base_executable,
                   "code": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                            for path in (Path(__file__).resolve(), ROOT / "services/geo/geo/native_kml.py",
                                         ROOT / "docs/evidence/usp/native-kml/requirements.lock")},
                   "dependencyVersion": "defusedxml 0.7.1", "dependencyFiles": dependencies,
                   "artifact": {"name": "kml.json", "bytes": len(output), "sha256": hashlib.sha256(output).hexdigest()}}
        temporary = Path(tempfile.mkdtemp(prefix=".kml-pending-", dir=out.parent))
        for name, data in (("kml.json", output), ("receipt.json", json.dumps(receipt, indent=2, ensure_ascii=False).encode("utf-8"))):
            path = temporary / name
            with path.open("xb") as handle:
                owned.append(path)
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
        _original(source, args.expected_sha256)  # Before atomic directory publication.
        temporary.rename(out)  # Windows refuses an existing target directory.
        temporary = None
        print(json.dumps({"status": parsed["status"], "features": len(parsed["features"]),
                          "coordinateTuples": parsed["coordinateCount"], "outputDirectory": str(out)}))
        return 0
    except (KMLError, OSError, ValueError, KeyError, importlib.metadata.PackageNotFoundError) as error:
        print(json.dumps({"error": error.as_dict() if isinstance(error, KMLError) else {"code": "LOCAL_INPUT_OR_PUBLICATION", "message": str(error)}}), file=sys.stderr)
        return 2
    finally:
        if temporary is not None:
            for path in owned:
                path.unlink(missing_ok=True)
            temporary.rmdir()


if __name__ == "__main__":
    raise SystemExit(_worker() if sys.argv[1:2] == ["--worker"] else main())
