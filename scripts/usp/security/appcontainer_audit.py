"""NET-01 scoped Windows AppContainer launcher; no model data in control probes.

Run from an ordinary user token. This only creates/deletes its unique profile and
never changes firewall or source ACLs. A zero-capability process must be verified
before any development replay is considered.
"""

from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes as w
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import uuid


if os.name != "nt":
    raise SystemExit("Windows only")

k32 = ctypes.WinDLL("kernel32", use_last_error=True)
uenv = ctypes.WinDLL("userenv", use_last_error=True)
adv = ctypes.WinDLL("advapi32", use_last_error=True)


class SECURITY_ATTRIBUTES(ctypes.Structure):
    _fields_ = [("nLength", w.DWORD), ("lpSecurityDescriptor", w.LPVOID), ("bInheritHandle", w.BOOL)]


class SID_AND_ATTRIBUTES(ctypes.Structure):
    _fields_ = [("Sid", w.LPVOID), ("Attributes", w.DWORD)]


class SECURITY_CAPABILITIES(ctypes.Structure):
    _fields_ = [("AppContainerSid", w.LPVOID), ("Capabilities", ctypes.POINTER(SID_AND_ATTRIBUTES)),
                ("CapabilityCount", w.DWORD), ("Reserved", w.DWORD)]


class STARTUPINFOW(ctypes.Structure):
    _fields_ = [("cb", w.DWORD), ("lpReserved", w.LPWSTR), ("lpDesktop", w.LPWSTR),
                ("lpTitle", w.LPWSTR), ("dwX", w.DWORD), ("dwY", w.DWORD),
                ("dwXSize", w.DWORD), ("dwYSize", w.DWORD), ("dwXCountChars", w.DWORD),
                ("dwYCountChars", w.DWORD), ("dwFillAttribute", w.DWORD), ("dwFlags", w.DWORD),
                ("wShowWindow", w.WORD), ("cbReserved2", w.WORD), ("lpReserved2", w.LPVOID),
                ("hStdInput", w.HANDLE), ("hStdOutput", w.HANDLE), ("hStdError", w.HANDLE)]


class STARTUPINFOEXW(ctypes.Structure):
    _fields_ = [("StartupInfo", STARTUPINFOW), ("lpAttributeList", w.LPVOID)]


class PROCESS_INFORMATION(ctypes.Structure):
    _fields_ = [("hProcess", w.HANDLE), ("hThread", w.HANDLE), ("dwProcessId", w.DWORD),
                ("dwThreadId", w.DWORD)]


class BASIC_JOB_LIMITS(ctypes.Structure):
    _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong),
                ("LimitFlags", w.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", w.DWORD),
                ("Affinity", ctypes.c_size_t), ("PriorityClass", w.DWORD), ("SchedulingClass", w.DWORD)]


class IO_COUNTERS(ctypes.Structure):
    _fields_ = [("ReadOperationCount", ctypes.c_ulonglong), ("WriteOperationCount", ctypes.c_ulonglong),
                ("OtherOperationCount", ctypes.c_ulonglong), ("ReadTransferCount", ctypes.c_ulonglong),
                ("WriteTransferCount", ctypes.c_ulonglong), ("OtherTransferCount", ctypes.c_ulonglong)]


class EXTENDED_JOB_LIMITS(ctypes.Structure):
    _fields_ = [("BasicLimitInformation", BASIC_JOB_LIMITS), ("IoInfo", IO_COUNTERS),
                ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]


uenv.CreateAppContainerProfile.argtypes = [w.LPCWSTR, w.LPCWSTR, w.LPCWSTR,
                                            ctypes.POINTER(SID_AND_ATTRIBUTES), w.DWORD,
                                            ctypes.POINTER(w.LPVOID)]
uenv.CreateAppContainerProfile.restype = w.LONG
uenv.DeleteAppContainerProfile.argtypes = [w.LPCWSTR]
uenv.DeleteAppContainerProfile.restype = w.LONG
k32.InitializeProcThreadAttributeList.argtypes = [w.LPVOID, w.DWORD, w.DWORD, ctypes.POINTER(ctypes.c_size_t)]
k32.UpdateProcThreadAttribute.argtypes = [w.LPVOID, w.DWORD, ctypes.c_size_t, w.LPVOID,
                                          ctypes.c_size_t, w.LPVOID, w.LPVOID]
k32.DeleteProcThreadAttributeList.argtypes = [w.LPVOID]
k32.CreateProcessW.argtypes = [w.LPCWSTR, w.LPWSTR, w.LPVOID, w.LPVOID, w.BOOL,
                              w.DWORD, w.LPVOID, w.LPCWSTR,
                              ctypes.POINTER(STARTUPINFOEXW), ctypes.POINTER(PROCESS_INFORMATION)]
k32.CreatePipe.argtypes = [ctypes.POINTER(w.HANDLE), ctypes.POINTER(w.HANDLE),
                           ctypes.POINTER(SECURITY_ATTRIBUTES), w.DWORD]
k32.ReadFile.argtypes = [w.HANDLE, w.LPVOID, w.DWORD, ctypes.POINTER(w.DWORD), w.LPVOID]
k32.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]
k32.GetExitCodeProcess.argtypes = [w.HANDLE, ctypes.POINTER(w.DWORD)]
k32.SetHandleInformation.argtypes = [w.HANDLE, w.DWORD, w.DWORD]
k32.GetStdHandle.argtypes = [w.DWORD]
k32.GetStdHandle.restype = w.HANDLE
k32.CreateFileW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, ctypes.POINTER(SECURITY_ATTRIBUTES),
                          w.DWORD, w.DWORD, w.HANDLE]
k32.CreateFileW.restype = w.HANDLE
k32.TerminateProcess.argtypes = [w.HANDLE, w.UINT]
k32.CloseHandle.argtypes = [w.HANDLE]
k32.LocalFree.argtypes = [w.LPVOID]
k32.CreateJobObjectW.argtypes = [w.LPVOID, w.LPCWSTR]
k32.CreateJobObjectW.restype = w.HANDLE
k32.SetInformationJobObject.argtypes = [w.HANDLE, w.INT, w.LPVOID, w.DWORD]
k32.QueryInformationJobObject.argtypes = [w.HANDLE, w.INT, w.LPVOID, w.DWORD, ctypes.POINTER(w.DWORD)]
k32.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
k32.ResumeThread.argtypes = [w.HANDLE]
adv.OpenProcessToken.argtypes = [w.HANDLE, w.DWORD, ctypes.POINTER(w.HANDLE)]
adv.GetTokenInformation.argtypes = [w.HANDLE, w.DWORD, w.LPVOID, w.DWORD, ctypes.POINTER(w.DWORD)]
adv.ConvertSidToStringSidW.argtypes = [w.LPVOID, ctypes.POINTER(w.LPWSTR)]
adv.FreeSid.argtypes = [w.LPVOID]
adv.FreeSid.restype = w.LPVOID


def win_error(where: str) -> OSError:
    code = ctypes.get_last_error()
    return OSError(code, f"{where}: {ctypes.FormatError(code).strip()}")


def sid_string(sid: w.LPVOID) -> str:
    string = w.LPWSTR()
    if not adv.ConvertSidToStringSidW(sid, ctypes.byref(string)):
        raise win_error("ConvertSidToStringSidW")
    try:
        return string.value
    finally:
        k32.LocalFree(string)


def token_data(process: w.HANDLE) -> dict:
    token = w.HANDLE()
    if not adv.OpenProcessToken(process, 0x0008, ctypes.byref(token)):
        raise win_error("OpenProcessToken")
    try:
        def info(kind: int) -> ctypes.Array:
            size = w.DWORD()
            adv.GetTokenInformation(token, kind, None, 0, ctypes.byref(size))
            if not size.value:
                raise win_error(f"GetTokenInformation size {kind}")
            buf = ctypes.create_string_buffer(size.value)
            if not adv.GetTokenInformation(token, kind, buf, size, ctypes.byref(size)):
                raise win_error(f"GetTokenInformation {kind}")
            return buf

        is_container = int.from_bytes(info(29).raw[:4], "little")
        sid_blob = info(31)
        sid_ptr = ctypes.c_void_p.from_buffer(sid_blob).value
        capabilities = info(30)
        return {"isAppContainer": bool(is_container), "appContainerSid": sid_string(sid_ptr),
                "capabilityCount": int.from_bytes(capabilities.raw[:4], "little")}
    finally:
        k32.CloseHandle(token)


def require_container_token(observed: dict, expected_sid: str) -> None:
    if (observed.get("isAppContainer") is not True or
            observed.get("appContainerSid") != expected_sid or
            type(observed.get("capabilityCount")) is not int or observed["capabilityCount"] != 0):
        raise RuntimeError(f"AppContainer token rejected before resume: {observed}")


def validate_descendant(observation: dict, expected_sid: str) -> dict:
    require_container_token(observation["token"], expected_sid)
    if observation["exitCode"] != 0 or observation["outputTruncated"]:
        raise RuntimeError("descendant probe failed or output was truncated")
    records = [json.loads(line) for line in observation["output"].splitlines() if line.strip()]
    tokens = [row for row in records if row.get("kind") == "token"]
    if len(tokens) != 3 or {row.get("role") for row in tokens} != {"parent", "descendantBeforeResume", "descendant"}:
        raise RuntimeError("descendant probe did not report all three actual tokens")
    for token in tokens:
        require_container_token(token, expected_sid)
    results = [row for row in records if row.get("kind") == "childResult"]
    if len(results) != 1 or results[0] != {"kind": "childResult", "created": True,
                                         "preResumeValidated": True, "resumeSucceeded": True, "exitCode": 0}:
        raise RuntimeError("descendant create/validation/resume/exit result failed")
    return {"tokens": tokens, "childResult": results[0]}


class CleanupError(RuntimeError):
    def __init__(self, outcomes: list[dict]):
        self.outcomes = outcomes
        super().__init__("owned audit cleanup failed: " + json.dumps(outcomes))


def cleanup_scope(granted: list[Path], expected_sid: str | None, name: str, sid: w.LPVOID) -> None:
    """Attempt every owned cleanup action; any error makes the audit fail."""
    outcomes = []
    for path in reversed(granted):
        outcome = {"aclRevokePath": str(path)}
        try:
            revoke = subprocess.run(["icacls", str(path), "/remove:g", "*" + expected_sid],
                                    capture_output=True, text=True, timeout=30)
            outcome.update(exitCode=revoke.returncode, failed=revoke.returncode != 0)
        except Exception as error:
            outcome.update(errorType=type(error).__name__, failed=True)
        outcomes.append(outcome)
    try:
        freed = adv.FreeSid(sid)
        outcomes.append({"sidFreeFailed": bool(freed), "failed": bool(freed)})
    except Exception as error:
        outcomes.append({"sidFreeErrorType": type(error).__name__, "failed": True})
    try:
        deleted = uenv.DeleteAppContainerProfile(name)
        outcomes.append({"profileDeleteHresult": f"0x{deleted & 0xffffffff:08x}", "failed": deleted != 0})
    except Exception as error:
        outcomes.append({"profileDeleteErrorType": type(error).__name__, "failed": True})
    for outcome in outcomes:
        print(json.dumps(outcome), file=sys.stderr)
    if any(outcome["failed"] for outcome in outcomes):
        raise CleanupError(outcomes)


def launch(exe: Path, args: list[str], sid: w.LPVOID, timeout_ms: int,
           job_memory_bytes: int | None = None) -> dict:
    size = ctypes.c_size_t()
    k32.InitializeProcThreadAttributeList(None, 2, 0, ctypes.byref(size))
    if ctypes.get_last_error() != 122 or not size.value:
        raise win_error("InitializeProcThreadAttributeList size")
    attrs = ctypes.create_string_buffer(size.value)
    if not k32.InitializeProcThreadAttributeList(attrs, 2, 0, ctypes.byref(size)):
        raise win_error("InitializeProcThreadAttributeList")
    read = w.HANDLE()
    write = w.HANDLE()
    safe_input = w.HANDLE()
    sa = SECURITY_ATTRIBUTES(ctypes.sizeof(SECURITY_ATTRIBUTES), None, True)
    try:
        caps = SECURITY_CAPABILITIES(sid, None, 0, 0)
        if not k32.UpdateProcThreadAttribute(attrs, 0, 0x20009, ctypes.byref(caps),
                                             ctypes.sizeof(caps), None, None):
            raise win_error("UpdateProcThreadAttribute")
        if not k32.CreatePipe(ctypes.byref(read), ctypes.byref(write), ctypes.byref(sa), 0):
            raise win_error("CreatePipe")
        if not k32.SetHandleInformation(read, 1, 0):
            raise win_error("SetHandleInformation")
        safe_input = k32.CreateFileW("NUL", 0x80000000, 0x3, ctypes.byref(sa), 3, 0, None)
        if safe_input == ctypes.c_void_p(-1).value:
            safe_input = w.HANDLE()
            raise win_error("CreateFileW NUL input")
        inherited_handles = (w.HANDLE * 2)(safe_input, write)
        if not k32.UpdateProcThreadAttribute(attrs, 0, 0x20002, inherited_handles,
                                             ctypes.sizeof(inherited_handles), None, None):
            raise win_error("UpdateProcThreadAttribute handle allowlist")
        si = STARTUPINFOEXW()
        si.StartupInfo.cb = ctypes.sizeof(si)
        si.StartupInfo.dwFlags = 0x100
        si.StartupInfo.hStdInput = safe_input
        si.StartupInfo.hStdOutput = write
        si.StartupInfo.hStdError = write
        si.lpAttributeList = ctypes.cast(attrs, w.LPVOID)
        pi = PROCESS_INFORMATION()
        command = ctypes.create_unicode_buffer(__import__("subprocess").list2cmdline([str(exe), *args]))
        safe_env = {
            "SystemRoot": os.environ.get("SystemRoot", r"C:\Windows"),
            "WINDIR": os.environ.get("WINDIR", r"C:\Windows"),
            "SystemDrive": os.environ.get("SystemDrive", "C:"),
            "ComSpec": r"C:\Windows\System32\cmd.exe",
            "PATH": r"C:\Windows\System32;C:\Windows",
            "TEMP": os.environ.get("TEMP", r"C:\Windows\Temp"),
            "TMP": os.environ.get("TMP", r"C:\Windows\Temp"),
            "LOCALAPPDATA": os.environ.get("LOCALAPPDATA", ""),
            "USERPROFILE": os.environ.get("USERPROFILE", ""),
            "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
            "HF_HUB_DISABLE_TELEMETRY": "1", "TOKENIZERS_PARALLELISM": "false",
            "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2",
            "CUBLAS_WORKSPACE_CONFIG": ":4096:8",
        }
        environment = ctypes.create_unicode_buffer("\0".join(f"{key}={value}" for key, value in sorted(safe_env.items())) + "\0\0")
        flags = 0x00080000 | 0x00000400 | 0x4
        if not k32.CreateProcessW(str(exe), command, None, None, True, flags,
                                  ctypes.cast(environment, w.LPVOID), "C:\\Windows\\System32",
                                  ctypes.byref(si), ctypes.byref(pi)):
            raise win_error("CreateProcessW AppContainer")
        job = w.HANDLE()
        completed = False
        try:
            observed_token = token_data(pi.hProcess)
            require_container_token(observed_token, sid_string(sid))
            if job_memory_bytes:
                job = k32.CreateJobObjectW(None, None)
                if not job:
                    raise win_error("CreateJobObjectW")
                limits = EXTENDED_JOB_LIMITS()
                limits.BasicLimitInformation.LimitFlags = 0x200 | 0x2000
                limits.JobMemoryLimit = job_memory_bytes
                if not k32.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
                    raise win_error("SetInformationJobObject")
                if not k32.AssignProcessToJobObject(job, pi.hProcess):
                    raise win_error("AssignProcessToJobObject")
            if k32.ResumeThread(pi.hThread) != 1:
                raise win_error("ResumeThread")
            k32.CloseHandle(write)
            write = w.HANDLE()
            chunks: list[bytes] = []
            state = {"truncated": False, "error": None}

            def drain() -> None:
                saved = 0
                while True:
                    buf = ctypes.create_string_buffer(4096)
                    count = w.DWORD()
                    if not k32.ReadFile(read, buf, 4096, ctypes.byref(count), None):
                        if ctypes.get_last_error() != 109:
                            state["error"] = str(win_error("ReadFile"))
                        break
                    if count.value == 0:
                        break
                    if saved + count.value <= 256 * 1024:
                        chunks.append(buf.raw[:count.value])
                        saved += count.value
                    else:
                        state["truncated"] = True

            reader = threading.Thread(target=drain, daemon=True)
            reader.start()
            wait = k32.WaitForSingleObject(pi.hProcess, timeout_ms)
            if wait == 0x102:
                if job:
                    k32.CloseHandle(job)
                    job = w.HANDLE()
                else:
                    k32.TerminateProcess(pi.hProcess, 1)
                raise TimeoutError(f"probe timed out after {timeout_ms} ms")
            if wait != 0:
                raise win_error("WaitForSingleObject")
            exit_code = w.DWORD()
            if not k32.GetExitCodeProcess(pi.hProcess, ctypes.byref(exit_code)):
                raise win_error("GetExitCodeProcess")
            peak_job_memory = None
            if job:
                measured = EXTENDED_JOB_LIMITS()
                returned = w.DWORD()
                if not k32.QueryInformationJobObject(job, 9, ctypes.byref(measured),
                                                     ctypes.sizeof(measured), ctypes.byref(returned)):
                    raise win_error("QueryInformationJobObject")
                peak_job_memory = measured.PeakJobMemoryUsed
            reader.join(5)
            if reader.is_alive() or state["error"]:
                raise RuntimeError(f"output reader did not complete: {state}")
            completed = True
        finally:
            try:
                if job:
                    k32.CloseHandle(job)
                if not completed:
                    if k32.WaitForSingleObject(pi.hProcess, 0) == 0x102 and not k32.TerminateProcess(pi.hProcess, 1):
                        raise win_error("TerminateProcess rejected/failed child")
                    if k32.WaitForSingleObject(pi.hProcess, 5000) != 0:
                        raise RuntimeError("owned child did not exit during cleanup")
            finally:
                k32.CloseHandle(pi.hThread)
                k32.CloseHandle(pi.hProcess)
        return {"token": observed_token, "pid": pi.dwProcessId, "exitCode": exit_code.value,
                "output": b"".join(chunks).decode(errors="replace"),
                "outputTruncated": state["truncated"], "peakJobMemoryBytes": peak_job_memory,
                "inheritedHandleCount": 2, "stdinSource": "NUL", "tokenValidatedBeforeResume": True}
    finally:
        if read.value:
            k32.CloseHandle(read)
        if write.value:
            k32.CloseHandle(write)
        if safe_input:
            k32.CloseHandle(safe_input)
        k32.DeleteProcThreadAttributeList(attrs)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--control", action="store_true", help="bounded local TCP/UDP and external TCP controls")
    parser.add_argument("--native-control", type=Path, help="owned compiled probe in a dedicated audit directory")
    parser.add_argument("--python-control", type=Path, help="owned Python 3.11 clone startup probe")
    parser.add_argument("--venv-control", type=Path, help="owned Python 3.11 LoRA venv import probe")
    parser.add_argument("--replay-root", type=Path, help="owned verified clone for one-field replay")
    parser.add_argument("--inspect-missing", action="store_true", help="with --replay-root, inspect only missing config path")
    parser.add_argument("--exe", type=Path, default=Path(r"C:\Windows\System32\whoami.exe"))
    parser.add_argument("--timeout-ms", type=int, default=15000)
    parser.add_argument("arg", nargs="*")
    args = parser.parse_args()
    name = "CodexNet01_" + uuid.uuid4().hex
    sid = w.LPVOID()
    result = uenv.CreateAppContainerProfile(name, name, "NET-01 owned audit", None, 0, ctypes.byref(sid))
    if result != 0:
        raise OSError(result, f"CreateAppContainerProfile HRESULT 0x{result & 0xffffffff:08x}")
    granted = []
    expected_sid = None
    try:
        expected_sid = sid_string(sid)
        if args.replay_root:
            audit = args.replay_root.resolve(strict=True)
            if audit.name != "net01-audit-20260930":
                raise ValueError("replay must use the dedicated owned audit directory")
            receipt = audit / "stage-verification.json"
            script = audit / "replay_net01.py"
            exe = audit / "runtime/lora-venv/Scripts/python.exe"
            if not receipt.is_file() or not script.is_file() or not exe.is_file():
                raise ValueError("verified stage, script and interpreter are required")
            for path, rights in ((audit, "(RX)"), (audit / "runtime", "(RX)"),
                                 (audit / "runtime/base", "(OI)(CI)(RX)"),
                                 (audit / "runtime/retained-site-packages", "(OI)(CI)(RX)"),
                                 (audit / "runtime/lora-venv", "(OI)(CI)(RX)"),
                                 (audit / "model", "(OI)(CI)(RX)"),
                                 (audit / "development", "(OI)(CI)(RX)"), (script, "(RX)"),
                                 (audit / "net01_probe.exe", "(RX)")):
                granted.append(path)  # Also revoke a grant that reports partial failure.
                grant = subprocess.run(["icacls", str(path), "/grant", f"*{expected_sid}:{rights}"],
                                       capture_output=True, text=True)
                if grant.returncode != 0:
                    raise OSError(f"scoped ACL grant failed: {path}: {grant.stdout} {grant.stderr}")
            os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1",
                              TOKENIZERS_PARALLELISM="false", OMP_NUM_THREADS="2", MKL_NUM_THREADS="2",
                              CUBLAS_WORKSPACE_CONFIG=":4096:8")
            preflight = launch(audit / "net01_probe.exe", ["child"], sid, 5000,
                               job_memory_bytes=6 * 1024**3)
            validate_descendant(preflight, expected_sid)
            tcp = launch(Path(r"C:\Windows\System32\curl.exe"),
                         ["--noproxy", "*", "--verbose", "--max-time", "2",
                          "http://203.0.113.1:9/net01"], sid, 5000)
            if (tcp["token"]["appContainerSid"] != expected_sid or "Bad access" not in tcp["output"]):
                raise RuntimeError("external TCP denial not observed in replay profile")
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as listener:
                listener.bind(("127.0.0.1", 0))
                listener.settimeout(0.2)
                udp = launch(audit / "net01_probe.exe", ["udp", "127.0.0.1",
                                                         str(listener.getsockname()[1])], sid, 5000)
                try:
                    packet, _ = listener.recvfrom(256)
                    raise RuntimeError(f"UDP control reached local listener: {len(packet)} bytes")
                except socket.timeout:
                    pass
            print(json.dumps({"preflightToken": preflight, "externalTcpDenial": tcp,
                              "localUdpNoDelivery": udp}), flush=True)
            observations = {}
            modes = (("missing-config", 30000),) if args.inspect_missing else (("missing-config", 30000), ("score", 600000))
            for mode, timeout in modes:
                observations[mode] = launch(exe, ["-B", "-I", str(script), mode, "--root", str(audit)],
                                            sid, timeout, job_memory_bytes=6 * 1024**3)
                print(json.dumps({"mode": mode, "observation": observations[mode]}), flush=True)
                if observations[mode]["exitCode"] != 0:
                    raise RuntimeError(f"{mode} child failed: {observations[mode]['exitCode']}")
            print(json.dumps({"profile": name, "expectedSid": expected_sid,
                              "scriptSha256": hashlib.sha256(script.read_bytes()).hexdigest(),
                              "stageVerificationSha256": hashlib.sha256(receipt.read_bytes()).hexdigest(),
                              "observations": observations}, indent=2), flush=True)
        elif args.venv_control:
            exe = args.venv_control.resolve(strict=True)
            if exe.name != "python.exe" or exe.parent.name != "Scripts" or exe.parent.parent.name != "lora-venv" or exe.parent.parent.parent.name != "runtime" or exe.parent.parent.parent.parent.name != "net01-audit-20260930":
                raise ValueError("venv clone must live in the dedicated owned audit directory")
            audit = exe.parent.parent.parent.parent
            for path, rights in ((audit, "(RX)"), (audit / "runtime", "(RX)"),
                                 (audit / "runtime/base", "(OI)(CI)(RX)"),
                                 (audit / "runtime/retained-site-packages", "(OI)(CI)(RX)"),
                                 (audit / "runtime/lora-venv", "(OI)(CI)(RX)")):
                granted.append(path)
                grant = subprocess.run(["icacls", str(path), "/grant", f"*{expected_sid}:{rights}"],
                                       capture_output=True, text=True)
                if grant.returncode != 0:
                    raise OSError(f"scoped ACL grant failed: {path}: {grant.stdout} {grant.stderr}")
            os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")
            observed = launch(exe, ["-B", "-I", "-c", "import torch,transformers,peft; print(torch.__version__,transformers.__version__,peft.__version__)"], sid, 20000)
            print(json.dumps({"profile": name, "expectedSid": expected_sid,
                              "venvExeSha256": hashlib.sha256(exe.read_bytes()).hexdigest(),
                              "startup": observed}, indent=2))
        elif args.python_control:
            exe = args.python_control.resolve(strict=True)
            if exe.name != "python.exe" or exe.parent.name != "base" or exe.parent.parent.name != "runtime" or exe.parent.parent.parent.name != "net01-audit-20260930":
                raise ValueError("Python clone must live in the dedicated owned audit directory")
            for path, rights in ((exe.parent.parent.parent, "(RX)"),
                                 (exe.parent.parent, "(RX)"),
                                 (exe.parent, "(OI)(CI)(RX)")):
                granted.append(path)
                grant = subprocess.run(["icacls", str(path), "/grant", f"*{expected_sid}:{rights}"],
                                       capture_output=True, text=True)
                if grant.returncode != 0:
                    raise OSError(f"scoped ACL grant failed: {path}: {grant.stdout} {grant.stderr}")
            observed = launch(exe, ["-I", "-S", "-c", "print('python-clone-started')"], sid, 5000)
            print(json.dumps({"profile": name, "expectedSid": expected_sid,
                              "pythonExeSha256": hashlib.sha256(exe.read_bytes()).hexdigest(),
                              "startup": observed}, indent=2))
        elif args.native_control:
            exe = args.native_control.resolve(strict=True)
            if exe.name != "net01_probe.exe" or exe.parent.name != "net01-audit-20260930":
                raise ValueError("native probe must live in the dedicated owned audit directory")
            for path in (exe.parent, exe):
                granted.append(path)
                grant = subprocess.run(["icacls", str(path), "/grant", f"*{expected_sid}:(RX)"],
                                       capture_output=True, text=True)
                if grant.returncode != 0:
                    raise OSError(f"scoped ACL grant failed: {path}: {grant.stdout} {grant.stderr}")
            results = [{"protocol": "token", **launch(exe, ["child"], sid, 5000,
                                                       job_memory_bytes=6 * 1024**3)}]
            validate_descendant(results[0], expected_sid)
            for protocol in ("tcp", "udp"):
                kind = socket.SOCK_STREAM if protocol == "tcp" else socket.SOCK_DGRAM
                with socket.socket(socket.AF_INET, kind) as listener:
                    listener.bind(("127.0.0.1", 0))
                    if protocol == "tcp":
                        listener.listen(1)
                    listener.settimeout(0.2)
                    port = listener.getsockname()[1]
                    observed = launch(exe, [protocol, "127.0.0.1", str(port)], sid, 5000)
                    try:
                        if protocol == "tcp":
                            peer, _ = listener.accept()
                            with peer:
                                peer.settimeout(0.2)
                                received = peer.recv(256)
                        else:
                            received, _ = listener.recvfrom(256)
                        observed["localListenerReceivedBytes"] = len(received)
                    except socket.timeout:
                        observed["localListenerReceivedBytes"] = 0
                    results.append({"protocol": "local-" + protocol, **observed})
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as dns_listener:
                dns_listener.bind(("127.0.0.1", 53))
                dns_listener.settimeout(0.2)
                try:
                    observed = launch(Path(r"C:\Windows\System32\nslookup.exe"),
                                      ["-timeout=1", "-retry=1", "net01-control.invalid", "127.0.0.1"],
                                      sid, 8000)
                except TimeoutError:
                    observed = {"timedOutAfterMs": 8000}
                try:
                    packet, _ = dns_listener.recvfrom(256)
                    observed["localDnsListenerReceivedBytes"] = len(packet)
                except socket.timeout:
                    observed["localDnsListenerReceivedBytes"] = 0
                results.append({"protocol": "local-dns", **observed})
            for protocol in ("tcp", "udp"):
                results.append({"protocol": "external-" + protocol, **launch(
                    exe, [protocol, "203.0.113.1", "9"], sid, 5000)})
            results.append({"protocol": "dns", **launch(exe, ["dns", "net01-control.invalid"], sid, 5000)})
            print(json.dumps({"profile": name, "expectedSid": expected_sid,
                              "probeSha256": hashlib.sha256(exe.read_bytes()).hexdigest(),
                              "controls": results}, indent=2))
        elif args.control:
            results = []
            for protocol in ("tcp", "udp"):
                kind = socket.SOCK_STREAM if protocol == "tcp" else socket.SOCK_DGRAM
                with socket.socket(socket.AF_INET, kind) as listener:
                    listener.bind(("127.0.0.1", 0))
                    if protocol == "tcp":
                        listener.listen(1)
                    listener.settimeout(0.2)
                    port = listener.getsockname()[1]
                    url = (f"http://127.0.0.1:{port}/net01" if protocol == "tcp"
                           else f"tftp://127.0.0.1:{port}/net01")
                    observed = launch(Path(r"C:\Windows\System32\curl.exe"),
                                      ["--noproxy", "*", "--verbose", "--max-time", "2", url], sid, 5000)
                    try:
                        if protocol == "tcp":
                            peer, _ = listener.accept()
                            with peer:
                                peer.settimeout(0.2)
                                received = peer.recv(256)
                        else:
                            received, _ = listener.recvfrom(256)
                        observed["localListenerReceivedBytes"] = len(received)
                    except socket.timeout:
                        observed["localListenerReceivedBytes"] = 0
                    results.append({"protocol": protocol, **observed})
            results.append({"protocol": "external-tcp", **launch(
                Path(r"C:\Windows\System32\curl.exe"),
                ["--noproxy", "*", "--verbose", "--max-time", "2", "http://203.0.113.1:9/net01"], sid, 5000)})
            print(json.dumps({"profile": name, "expectedSid": expected_sid, "controls": results}, indent=2))
        else:
            observed = launch(args.exe, args.arg or ["/user"], sid, args.timeout_ms)
            observed["expectedSid"] = expected_sid
            observed["profile"] = name
            print(json.dumps(observed, indent=2))
    finally:
        cleanup_scope(granted, expected_sid, name, sid)


if __name__ == "__main__":
    main()
