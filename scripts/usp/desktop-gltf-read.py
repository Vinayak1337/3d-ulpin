"""Inspect one hash-pinned local glTF/GLB into a fresh private directory.

Windows-only supervised profile: one active Job process, 2 GiB process/job
memory, kill-on-close and 45 seconds including reader import/read/encode.
No services, external dependencies, network resolution or in-process fallback.
"""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
MAX_INPUT_BYTES = MAX_OUTPUT_BYTES = 16 * 1024**2
MEMORY_BYTES = 2 * 1024**3
DEADLINE_SECONDS = 45
MAX_LOG_BYTES = 64 * 1024
READER = ROOT / "services/geo/geo/native_gltf.py"
PACKAGE_INIT = ROOT / "services/geo/geo/__init__.py"

# -I -S prevents site/user imports. The gate reads exactly one byte before
# importing even our reader; the parent releases it only after Job attachment.
GATE = """import sys
if sys.stdin.buffer.read(1) != b'1': raise SystemExit(3)
sys.path.insert(0, sys.argv[1])
from geo.native_gltf import _worker
raise SystemExit(_worker(sys.argv[2], sys.argv[3], sys.argv[4],
                        None if sys.argv[5] == 'absent' else int(sys.argv[5])))
"""


class _WindowsJob:
    """Lane-local adaptation of the repository's Windows Job supervision."""
    def __init__(self, process, memory_bytes=MEMORY_BYTES):
        from ctypes import wintypes
        class Basic(ctypes.Structure):
            _fields_ = [("processTime", ctypes.c_int64), ("jobTime", ctypes.c_int64),
                        ("flags", wintypes.DWORD), ("minimumWorkingSet", ctypes.c_size_t),
                        ("maximumWorkingSet", ctypes.c_size_t), ("activeProcessLimit", wintypes.DWORD),
                        ("affinity", ctypes.c_size_t), ("priorityClass", wintypes.DWORD),
                        ("schedulingClass", wintypes.DWORD)]
        class Io(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in ("readOperations", "writeOperations", "otherOperations",
                                                          "readBytes", "writeBytes", "otherBytes")]
        class Extended(ctypes.Structure):
            _fields_ = [("basic", Basic), ("io", Io), ("processMemory", ctypes.c_size_t),
                        ("jobMemory", ctypes.c_size_t), ("peakProcess", ctypes.c_size_t),
                        ("peakJob", ctypes.c_size_t)]
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        for name, args, result in (
            ("CreateJobObjectW", [ctypes.c_void_p, wintypes.LPCWSTR], wintypes.HANDLE),
            ("SetInformationJobObject", [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD], wintypes.BOOL),
            ("AssignProcessToJobObject", [wintypes.HANDLE, wintypes.HANDLE], wintypes.BOOL),
            ("QueryInformationJobObject", [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p], wintypes.BOOL),
            ("TerminateJobObject", [wintypes.HANDLE, wintypes.UINT], wintypes.BOOL),
            ("CloseHandle", [wintypes.HANDLE], wintypes.BOOL),
        ):
            getattr(kernel, name).argtypes = args
            getattr(kernel, name).restype = result
        self.kernel, self.extended = kernel, Extended
        self.handle = kernel.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            limits = Extended()
            limits.basic.flags = 0x2000 | 0x100 | 0x200 | 0x8
            limits.basic.activeProcessLimit = 1
            limits.processMemory = limits.jobMemory = memory_bytes
            if not kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
                raise ctypes.WinError(ctypes.get_last_error())
            if not kernel.AssignProcessToJobObject(self.handle, int(process._handle)):
                raise ctypes.WinError(ctypes.get_last_error())
        except BaseException:
            self.close()
            raise

    def observation(self):
        limits = self.extended()
        if not self.kernel.QueryInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits), None):
            raise ctypes.WinError(ctypes.get_last_error())
        return {"flags": int(limits.basic.flags), "activeProcessLimit": int(limits.basic.activeProcessLimit),
                "processMemoryLimitBytes": int(limits.processMemory), "jobMemoryLimitBytes": int(limits.jobMemory),
                "peakJobPrivateBytes": int(limits.peakJob)}

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


def _supervise(command, *, timeout=DEADLINE_SECONDS, memory_bytes=MEMORY_BYTES):
    if sys.platform != "win32":
        raise ValueError("This CLI has only a qualified Windows Job profile; unsupported host refused.")
    env = os.environ.copy()
    env.update(OMP_NUM_THREADS="1", MKL_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1",
               NUMEXPR_NUM_THREADS="1", VECLIB_MAXIMUM_THREADS="1", CUDA_VISIBLE_DEVICES="")
    started = time.monotonic()
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               cwd=ROOT / "services/geo", env=env, creationflags=subprocess.CREATE_NO_WINDOW)
    job, threads, output, errors = None, [], [], []
    overflow, drain_failure = threading.Event(), threading.Event()
    def drain(stream, parts):
        total = 0
        try:
            while block := stream.read1(4096):
                remaining = MAX_LOG_BYTES - total
                if remaining > 0:
                    parts.append(block[:remaining])
                total += len(block)
                if total > MAX_LOG_BYTES:
                    overflow.set()
        except OSError:
            drain_failure.set()
    try:
        job = _WindowsJob(process, memory_bytes)
        for stream, parts in ((process.stdout, output), (process.stderr, errors)):
            thread = threading.Thread(target=drain, args=(stream, parts), daemon=True)
            thread.start()
            threads.append(thread)
        process.stdin.write(b"1")
        process.stdin.close()
        while process.poll() is None:
            if time.monotonic() - started > timeout:
                raise ValueError("Supervised reader exceeded its deadline; no result published.")
            if overflow.is_set() or drain_failure.is_set():
                raise ValueError("Supervised reader exceeded its log bound or capture failed.")
            time.sleep(0.01)
        for thread in threads:
            thread.join(timeout=max(0.01, timeout - (time.monotonic() - started)))
        if any(t.is_alive() for t in threads) or overflow.is_set() or drain_failure.is_set():
            raise ValueError("Bounded child capture was not completed.")
        if time.monotonic() - started > timeout:
            raise ValueError("Supervised reader exceeded its deadline.")
        observation = job.observation()
        observation.update(deadlineSeconds=timeout, observedSeconds=round(time.monotonic() - started, 6),
                           computePoolThreads=1, osThreadCeiling=None,
                           importAfterJobAttachment=True, workerPid=process.pid,
                           stdoutBytes=sum(map(len, output)), stderrBytes=sum(map(len, errors)))
        return process.returncode, b"".join(output), b"".join(errors), observation
    finally:
        if process.stdin and not process.stdin.closed:
            process.stdin.close()
        if job:
            job.close()  # Kills the whole owned tree, including on timeout.
        elif process.poll() is None:
            process.kill()  # Gate is still closed if Job attachment failed.
        process.wait(timeout=3)
        for thread in threads:
            thread.join(timeout=1)
        for stream in (process.stdout, process.stderr):
            if stream:
                stream.close()


def _locked_source(path):
    """Hold a Windows read handle denying writes/deletion through publication."""
    from ctypes import wintypes
    import msvcrt
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
                                  wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    handle = kernel.CreateFileW(str(path), 0x80000000, 1, None, 3, 0x08000000, None)
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        descriptor = msvcrt.open_osfhandle(int(handle), os.O_RDONLY | os.O_BINARY)
    except BaseException:
        kernel.CloseHandle(handle)
        raise
    return os.fdopen(descriptor, "rb")


def _read_original(handle):
    handle.seek(0)
    raw = handle.read(MAX_INPUT_BYTES + 1)
    if not raw or len(raw) > MAX_INPUT_BYTES:
        raise ValueError("Original must be nonempty and at most 16 MiB.")
    return raw


def _hash_file(path, limit):
    total, digest = 0, hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(65536):
            total += len(block)
            if total > limit:
                raise ValueError("Artifact exceeds the output limit.")
            digest.update(block)
    return {"bytes": total, "sha256": digest.hexdigest()}


def _outside_git(path):
    if any(parent.name.casefold() == ".git" or (parent / ".git").exists() for parent in (path, *path.parents)):
        raise ValueError("Output must be outside Git checkouts and storage.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--scene", type=int, help="Explicit scene index; absent source scene is never guessed.")
    args = parser.parse_args(argv)
    owned = []
    output_dir, created = None, False
    try:
        if sys.platform != "win32":
            raise ValueError("Only the Windows Job supervision profile is implemented.")
        if not re.fullmatch(r"[0-9a-f]{64}", args.expected_sha256):
            raise ValueError("Expected SHA-256 must be lowercase hexadecimal.")
        source = args.source.resolve(strict=True)
        if not source.is_file():
            raise ValueError("Source must be a regular local file.")
        output_dir = args.output_dir.resolve()
        _outside_git(output_dir)
        if output_dir.exists() or not output_dir.parent.is_dir():
            raise ValueError("Output requires a fresh directory and an existing parent.")
        with _locked_source(source) as original, tempfile.TemporaryDirectory(prefix="gltf-owned-", dir=output_dir.parent) as temp:
            raw = _read_original(original)
            source_sha = hashlib.sha256(raw).hexdigest()
            if source_sha != args.expected_sha256:
                raise ValueError("Original differs from expected SHA-256; worker was not started.")
            snapshot, artifact = Path(temp) / "source.bin", Path(temp) / "gltf.json"
            with snapshot.open("xb") as handle:
                handle.write(raw)
            code_hashes = {"reader": hashlib.sha256(READER.read_bytes()).hexdigest(),
                           "cli": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                           "packageInit": hashlib.sha256(PACKAGE_INIT.read_bytes()).hexdigest()}
            # Windows venv executables are redirectors which can spawn another
            # process before the gate. Use the pinned base interpreter directly
            # so the one-active-process Job contains the actual worker.
            command = [sys._base_executable, "-I", "-S", "-c", GATE, str(ROOT / "services/geo"),
                       str(snapshot), str(artifact), source_sha, "absent" if args.scene is None else str(args.scene)]
            exit_code, stdout, stderr, supervision = _supervise(command)
            if stderr:
                raise ValueError("Reader emitted an unexpected diagnostic; no result published.")
            summary = json.loads(stdout)
            if exit_code == 2 and "error" in summary:
                print(json.dumps(summary), file=sys.stderr)
                return 2
            if exit_code or summary.get("sourceSha256") != source_sha:
                raise ValueError("Reader failed or returned inconsistent source lineage.")
            observed_artifact = _hash_file(artifact, MAX_OUTPUT_BYTES)
            if observed_artifact != summary["artifact"]:
                raise ValueError("Reader artifact hash/length differs from its summary.")
            if code_hashes != {"reader": hashlib.sha256(READER.read_bytes()).hexdigest(),
                               "cli": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                               "packageInit": hashlib.sha256(PACKAGE_INIT.read_bytes()).hexdigest()}:
                raise ValueError("Reader code changed during inspection; no result published.")
            if hashlib.sha256(_read_original(original)).hexdigest() != source_sha:
                raise ValueError("Original changed during inspection; no result published.")
            receipt = {"schemaVersion": "gltf-local-receipt/1", "sourcePath": str(source),
                       "sourceSha256": source_sha, "sourceBytes": len(raw), "status": summary["status"],
                       "counts": summary["counts"], "artifact": {"name": "gltf.json", **observed_artifact},
                       "codeSha256": code_hashes, "pythonVersion": sys.version,
                       "pythonSha256": hashlib.sha256(Path(sys.executable).read_bytes()).hexdigest(),
                       "workerPythonPath": sys._base_executable,
                       "workerPythonSha256": hashlib.sha256(Path(sys._base_executable).read_bytes()).hexdigest(),
                       "supervision": supervision, "sourceWriteDeniedThroughPublication": True,
                       "qualification": "test_only local inspection; no API, accuracy, scale or release gate"}
            output_dir.mkdir(exist_ok=False)
            created = True
            for name, content in (("gltf.json", None), ("receipt.json", json.dumps(receipt, indent=2).encode("utf-8"))):
                target = output_dir / name
                with target.open("xb") as handle:
                    owned.append(target)
                    if content is None:
                        with artifact.open("rb") as input_handle:
                            shutil.copyfileobj(input_handle, handle, 65536)
                    else:
                        handle.write(content)
            if _hash_file(output_dir / "gltf.json", MAX_OUTPUT_BYTES) != observed_artifact:
                raise ValueError("Published bytes differ from supervised output.")
            if hashlib.sha256(_read_original(original)).hexdigest() != source_sha:
                raise ValueError("Original changed before publication completed.")
        print(json.dumps({"status": summary["status"], "sourceSha256": source_sha,
                          "outputDirectory": str(output_dir), "counts": summary["counts"]}))
        return 0
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        if created:
            for path in owned:
                path.unlink(missing_ok=True)
            output_dir.rmdir()
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
