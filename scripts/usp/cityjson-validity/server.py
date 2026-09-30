"""Server-only supervisor. No executable/path or report is accepted from an API caller."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))  # Explicit sibling under isolated Python (-I).
import validate as adapter


class Busy(OSError):
    pass


@contextmanager
def host_lock():
    # Fixed host-wide name, independent of tooling/scratch roots and dispatcher
    # sessions. Windows abandons a mutex on crash; no PID reclaim or file reset.
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
    kernel.CreateMutexW.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.WaitForSingleObject.restype = wintypes.DWORD
    kernel.ReleaseMutex.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    mutex = kernel.CreateMutexW(None, False, 'Global\\ULPIN-CityJSON-Validation-v1')
    if not mutex:
        raise OSError('host_mutex_unavailable')
    owned = False
    try:
        result = kernel.WaitForSingleObject(mutex, 0)
        if result == 0x102:  # WAIT_TIMEOUT: useful explicit retry, never a busy wait.
            raise Busy('validator_host_occupied')
        if result not in (0, 0x80):  # WAIT_OBJECT_0 or WAIT_ABANDONED after a crash.
            raise OSError('host_mutex_unavailable')
        owned = True
        yield
    finally:
        if owned:
            kernel.ReleaseMutex(mutex)
        kernel.CloseHandle(mutex)


def own_process_tree():
    """A Windows job kills all owned descendants if this supervisor exits or is killed."""
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    class Basic(ctypes.Structure):
        _fields_ = [('PerProcessUserTimeLimit', ctypes.c_int64), ('PerJobUserTimeLimit', ctypes.c_int64),
                    ('LimitFlags', wintypes.DWORD), ('MinimumWorkingSetSize', ctypes.c_size_t),
                    ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', wintypes.DWORD),
                    ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD), ('SchedulingClass', wintypes.DWORD)]
    class IO(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ['ReadOperationCount', 'WriteOperationCount',
                    'OtherOperationCount', 'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount']]
    class Extended(ctypes.Structure):
        _fields_ = [('BasicLimitInformation', Basic), ('IoInfo', IO), ('ProcessMemoryLimit', ctypes.c_size_t),
                    ('JobMemoryLimit', ctypes.c_size_t), ('PeakProcessMemoryUsed', ctypes.c_size_t), ('PeakJobMemoryUsed', ctypes.c_size_t)]
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.CreateJobObjectW(None, None)
    info = Extended()
    info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not handle or not kernel.SetInformationJobObject(handle, 9, ctypes.byref(info), ctypes.sizeof(info)) \
            or not kernel.AssignProcessToJobObject(handle, kernel.GetCurrentProcess()):
        if handle:
            kernel.CloseHandle(handle)
        raise OSError('process_tree_unavailable')
    # Intentionally retain the non-inheritable handle until process exit. Closing it kills this tree.
    return handle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', required=True, type=Path)
    args = parser.parse_args()
    if os.name != 'nt':
        print('{"code":"CITYJSON_VALIDATION_UNSUPPORTED_PLATFORM"}')
        return 2
    request = adapter.strict_json(adapter.bounded(args.request, 32768))
    root = Path(request['toolsRoot']).resolve()
    try:
        tree = own_process_tree()
        # Same configured tooling host, all dispatcher processes. OS releases on crash; no PID reclaim.
        with host_lock():
            pins = request['pins']
            if adapter.sha(adapter.bounded(Path(adapter.__file__))) != pins['adapterSha256'] \
                    or adapter.sha(adapter.bounded(Path(__file__))) != pins['supervisorSha256'] \
                    or adapter.sha(adapter.bounded(adapter.ROOT / 'tools.json')) != pins['toolLockSha256']:
                print('{"code":"CITYJSON_VALIDATION_TOOL_CHANGED"}')
                return 2
            receipt = adapter.validate(Path(request['source']), request['sourceSha256'], root,
                                       Path(request['output']), [(v['objectId'], v['geometryIndex']) for v in request['selections']], 120)
            print(json.dumps({'state': receipt['state']}))
            # Do not manually close the tree handle. Native children have already exited; OS closes it on exit.
            return 0
    except Busy:
        print('{"code":"CITYJSON_VALIDATION_BUSY"}')
        return 2
    except (OSError, ValueError, KeyError, TypeError):
        print('{"code":"CITYJSON_VALIDATION_UNAVAILABLE"}')
        return 2


if __name__ == '__main__':
    sys.exit(main())
