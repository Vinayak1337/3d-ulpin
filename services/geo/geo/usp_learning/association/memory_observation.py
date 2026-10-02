"""Read-only native self/Job and CUDA phase observations inside the existing boundary."""
from __future__ import annotations

import ctypes
from ctypes import wintypes as w
import json
import time


class LimitViolation(ctypes.Structure):
    # WinSDK winnt.h JOBOBJECT_LIMIT_VIOLATION_INFORMATION (query class 13).
    # microsoft/win32metadata main observed source SHA256:
    # 404019933323ca25f5db8ce14437483e1054398ce454d5c75df2e187cec2ae40
    _fields_ = [("LimitFlags", w.DWORD), ("ViolationLimitFlags", w.DWORD),
                *[(name, ctypes.c_ulonglong) for name in ("IoReadBytes", "IoReadBytesLimit", "IoWriteBytes", "IoWriteBytesLimit")],
                ("PerJobUserTime", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong),
                ("JobMemory", ctypes.c_ulonglong), ("JobMemoryLimit", ctypes.c_ulonglong),
                ("RateControlTolerance", w.DWORD), ("RateControlToleranceLimit", w.DWORD)]


class ProcessMemory(ctypes.Structure):
    _fields_ = [("cb", w.DWORD), ("PageFaultCount", w.DWORD),
                *[(name, ctypes.c_size_t) for name in ("PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                  "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage", "PrivateUsage")]]


class PhaseRecorder:
    def __init__(self, output_dir, require_boundary):
        root, profile, _ = require_boundary()
        from model_isolation import audit_module, HARNESS
        self.api = audit_module(root / "code" / HARNESS, profile["files"]["code/" + HARNESS])
        self.path = output_dir / "memory-phases.jsonl"
        self.path.touch(exist_ok=False)
        self.started = time.perf_counter()
        self.psapi = ctypes.WinDLL("psapi", use_last_error=True)
        self.psapi.GetProcessMemoryInfo.argtypes = [w.HANDLE, ctypes.POINTER(ProcessMemory), w.DWORD]
        self.psapi.GetProcessMemoryInfo.restype = w.BOOL

    def native(self):
        api = self.api
        limits = api.job_limits(None, w.HANDLE(-1), 6 * 1024**3)
        current, returned = LimitViolation(), w.DWORD()
        if not api.k32.QueryInformationJobObject(None, 13, ctypes.byref(current), ctypes.sizeof(current), ctypes.byref(returned)):
            raise ctypes.WinError(ctypes.get_last_error())
        if returned.value != ctypes.sizeof(current):
            raise RuntimeError("native Job current-memory structure unreadable")
        process = ProcessMemory(); process.cb = ctypes.sizeof(process)
        if not self.psapi.GetProcessMemoryInfo(w.HANDLE(-1), ctypes.byref(process), process.cb):
            raise ctypes.WinError(ctypes.get_last_error())
        if current.JobMemory <= 0 or limits["peakJobMemoryBytes"] <= 0:
            raise RuntimeError("native Job current/peak memory is missing")
        return {"jobCurrentCommittedBytes": current.JobMemory, "jobPeakCommittedBytes": limits["peakJobMemoryBytes"],
                "jobCapBytes": limits["jobMemoryLimitBytes"], "processRssBytes": process.WorkingSetSize,
                "processPeakRssBytes": process.PeakWorkingSetSize, "processPrivateCommittedBytes": process.PrivateUsage,
                "jobCurrentMethod": "QueryInformationJobObject JobObjectLimitViolationInformation.JobMemory"}

    def sample(self, phase, torch=None, *, failure=False, **facts):
        row = {"phase": phase, "elapsedSeconds": time.perf_counter() - self.started, **facts}
        errors = []
        try:
            row["native"] = self.native()
        except Exception as error:
            row["nativeObservationError"] = str(error); errors.append(error)
        try:
            if torch is None or not torch.cuda.is_initialized():
                row["gpu"] = {"initialized": False, "measured": False}
            else:
                free, total = torch.cuda.mem_get_info()
                row["gpu"] = {"initialized": True, "measured": True, "allocatedBytes": torch.cuda.memory_allocated(),
                    "reservedBytes": torch.cuda.memory_reserved(), "peakAllocatedBytes": torch.cuda.max_memory_allocated(),
                    "peakReservedBytes": torch.cuda.max_memory_reserved(), "freeBytes": free, "totalBytes": total}
        except Exception as error:
            row["gpuObservationError"] = str(error); errors.append(error)
        with self.path.open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(json.dumps(row, sort_keys=True, allow_nan=False) + "\n")
        if failure:
            return row  # Observation failures never replace the original exception.
        if errors:
            raise errors[0]
        native, gpu = row["native"], row["gpu"]
        if max(native["jobCurrentCommittedBytes"], native["jobPeakCommittedBytes"], native["processPeakRssBytes"]) > 6 * 1024**3:
            raise RuntimeError("native phase Job committed/RSS memory bound exceeded")
        if gpu["measured"] and (max(gpu["peakAllocatedBytes"], gpu["peakReservedBytes"]) > 6 * 1024**3 or gpu["freeBytes"] < 1536 * 1024**2):
            raise RuntimeError("phase GPU memory/headroom bound exceeded")
        return row
