"""OBJ-only host wrapper: fixed mutex, parent-kill tree ownership, accepted CLI."""
from __future__ import annotations
import argparse
from contextlib import redirect_stdout, redirect_stderr
from contextlib import contextmanager
import ctypes
from ctypes import wintypes
import hashlib
import importlib.util
import io
import json
import os
import subprocess
from pathlib import Path
import sys
import time
sys.dont_write_bytecode = True

class Busy(OSError):
    pass

def bounded(path, limit):
    with Path(path).open('rb') as stream:
        value=stream.read(limit+1)
    if len(value)>limit: raise ValueError('byte_limit')
    return value

def digest(value):
    return hashlib.sha256(value).hexdigest()
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
    mutex = kernel.CreateMutexW(None, False, 'Global\\ULPIN-OBJ-Native-v1')
    if not mutex:
        raise OSError('host_mutex_unavailable')
    owned = False
    try:
        result = kernel.WaitForSingleObject(mutex, 0)
        if result == 0x102:  # WAIT_TIMEOUT: useful explicit retry, never a busy wait.
            raise Busy('obj_host_occupied')
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
    handle = kernel.CreateJobObjectW(None, 'Global\\ULPIN-OBJ-Processing-Tree-v1')
    info = Extended()
    info.BasicLimitInformation.LimitFlags = 0x2000 | 0x0008 | 0x0200 | 0x0100
    info.BasicLimitInformation.ActiveProcessLimit = 2  # this supervisor plus one parser
    info.JobMemoryLimit = info.ProcessMemoryLimit = 1024**3
    if not handle or not kernel.SetInformationJobObject(handle, 9, ctypes.byref(info), ctypes.sizeof(info)) \
            or not kernel.AssignProcessToJobObject(handle, kernel.GetCurrentProcess()):
        if handle:
            kernel.CloseHandle(handle)
        raise OSError('process_tree_unavailable')
    # Intentionally retain the non-inheritable handle until process exit. Closing it kills this tree.
    kernel.QueryInformationJobObject.argtypes=[wintypes.HANDLE,ctypes.c_int,ctypes.c_void_p,wintypes.DWORD,ctypes.c_void_p]
    def observation():
        observed=Extended()
        if not kernel.QueryInformationJobObject(handle,9,ctypes.byref(observed),ctypes.sizeof(observed),None):
            raise OSError('host_observation_unavailable')
        return {'flags':info.BasicLimitInformation.LimitFlags,'activeProcessLimit':2,'processMemoryLimitBytes':1024**3,
                'jobMemoryLimitBytes':1024**3,'peakJobPrivateBytes':observed.PeakJobMemoryUsed,
                'deadlineSeconds':75,'attachment':'before_profile_and_cli_import'}
    return observation


def reap(parent_pid):
    """Wait for the one owned parser after hard supervisor termination, before scratch cleanup."""
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    class Entry(ctypes.Structure):
        _fields_=[('size',wintypes.DWORD),('usage',wintypes.DWORD),('pid',wintypes.DWORD),
                  ('heap',ctypes.c_size_t),('module',wintypes.DWORD),('threads',wintypes.DWORD),
                  ('parent',wintypes.DWORD),('priority',wintypes.LONG),('flags',wintypes.DWORD),('exe',wintypes.WCHAR*260)]
    kernel.CreateToolhelp32Snapshot.argtypes=[wintypes.DWORD,wintypes.DWORD]
    kernel.CreateToolhelp32Snapshot.restype=wintypes.HANDLE
    kernel.Process32FirstW.argtypes=kernel.Process32NextW.argtypes=[wintypes.HANDLE,ctypes.POINTER(Entry)]
    kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
    kernel.OpenProcess.restype=wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD]
    kernel.CloseHandle.argtypes=[wintypes.HANDLE]
    snapshot=kernel.CreateToolhelp32Snapshot(2,0)
    if snapshot==ctypes.c_void_p(-1).value:raise OSError('reap_unavailable')
    entry=Entry();entry.size=ctypes.sizeof(entry);pids=[]
    try:
        more=kernel.Process32FirstW(snapshot,ctypes.byref(entry))
        while more:
            if entry.parent==parent_pid:pids.append(entry.pid)
            more=kernel.Process32NextW(snapshot,ctypes.byref(entry))
    finally:kernel.CloseHandle(snapshot)
    for pid in pids:
        handle=kernel.OpenProcess(0x100000,False,pid)  # SYNCHRONIZE; no termination authority
        if not handle:
            if ctypes.get_last_error()==87:continue  # process already exited
            raise OSError('reap_unavailable')
        try:
            if kernel.WaitForSingleObject(handle,3000)!=0:raise OSError('reap_timeout')
        finally:kernel.CloseHandle(handle)


def main():
    started=time.monotonic()
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request',type=Path)
    parser.add_argument('--reap-pid',type=int)
    args=parser.parse_args()
    if os.name!='nt':
        print('{"code":"OBJ_UNSUPPORTED_PLATFORM"}')
        return 2
    if args.reap_pid is not None:
        try:
            reap(args.reap_pid)
            print('{"state":"available"}')
            return 0
        except OSError:
            print('{"code":"OBJ_REAP_UNAVAILABLE"}')
            return 2
    if args.request is None:parser.error('--request required')
    request=json.loads(bounded(args.request,32768))
    root=Path(__file__).resolve().parents[3]
    try:
        with host_lock():
            host_observation=own_process_tree()
            spec=importlib.util.spec_from_file_location('_obj_profile',root/'scripts/usp/obj/profile.py')
            dependency_profile=importlib.util.module_from_spec(spec);spec.loader.exec_module(dependency_profile)
            # The named Job has a shared two-process ceiling. After an abandoned
            # mutex, a predecessor parser still exiting occupies the old slot;
            # a second parser cannot start until that process is gone.
            pins=request['tools']
            profile_bytes=bounded(request['profilePath'],2*1024**2)
            if digest(profile_bytes)!=pins['profileSha256']:
                raise ValueError('profile_changed')
            profile=json.loads(profile_bytes)
            dependency_profile.verify(profile)
            cli_path=root/'scripts/usp/desktop-obj-read.py'
            reader_path=root/'services/geo/geo/native_obj.py'
            reader_hash=digest(b'services/geo/geo/native_obj.py\0'+bounded(reader_path,1024**2)+
                               b'scripts/usp/desktop-obj-read.py\0'+bounded(cli_path,1024**2))
            if reader_hash!=pins['readerSha256'] or digest(bounded(Path(__file__),1024**2)+bounded(Path(dependency_profile.__file__),1024**2))!=pins['supervisorSha256'] \
                or digest(bounded(root/'scripts/usp/obj/runtime-lock.json',65536))!=pins['dependencyLockSha256'] \
                or digest(bounded(profile['python'],32*1024**2))!=pins['pythonSha256'] \
                or profile['nativeRuntimeLockSha256']!=pins['nativeRuntimeLockSha256'] \
                or Path(profile['python']).resolve()!=Path(sys._base_executable).resolve():
                raise ValueError('profile_changed')
            source=Path(request['source'])
            raw=bounded(source,16*1024**2)
            if digest(raw)!=request['sourceSha256']:
                raise ValueError('source_changed')
            code_files=['packages/contracts/src/usp/obj-ingestion.ts',
                        *[f'packages/server/src/modules/usp/ingestion/{name}.ts' for name in ('obj','obj-config','obj-processor','obj-worker')],
                        'packages/server/src/modules/usp/jobs.ts','packages/server/src/infrastructure/storage.ts','packages/server/src/infrastructure/db.ts']
            code=[{'path':p,'sha256':digest(bounded(root/p,1024**2))} for p in code_files]
            if digest(json.dumps(code,sort_keys=True,separators=(',',':')).encode())!=pins['codeSha256']:
                raise ValueError('code_changed')
            scratch=Path(profile['scratchRoot']).resolve(strict=True);source=source.resolve(strict=True)
            output_directory=Path(request['outputDirectory']).resolve()
            if not source.parent.is_relative_to(scratch) or source.parent==scratch or output_directory.parent!=source.parent \
                    or args.request.resolve().parent!=source.parent:
                raise ValueError('scratch_scope')
            spec=importlib.util.spec_from_file_location('_canonical_obj_supervisor',cli_path)
            cli=importlib.util.module_from_spec(spec);spec.loader.exec_module(cli)
            # Reuse the complete accepted CLI: lock unchanged source, gate its
            # one native process, preserve raw artifact and publication receipt.
            output_directory=Path(request['outputDirectory'])
            arguments=[str(source),'--expected-sha256',request['sourceSha256'],
                       '--output-dir',str(output_directory),'--runtime-lock',profile['nativeRuntimeLockPath'],
                       '--runtime-lock-sha256',pins['nativeRuntimeLockSha256']]
            stdout,stderr=io.StringIO(),io.StringIO()
            with redirect_stdout(stdout),redirect_stderr(stderr):
                exit_code=cli.main(arguments)
            if exit_code:
                # Native error JSON provides a stable controlled reason only.
                # CLI filesystem/parser prose and private paths stay private.
                try:
                    error=json.loads(stderr.getvalue())['error']
                    code=error['code']
                    if not isinstance(code,str) or not code or len(code)>60 or any(c not in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_' for c in code):
                        raise ValueError('invalid_code')
                except (ValueError,KeyError,TypeError):
                    code='PROCESSING_FAILED'
                print(json.dumps({'code':'OBJ_'+code}))
                return 2
            receipt=json.loads(bounded(output_directory/'receipt.json',65536))
            encoded=bounded(output_directory/'obj.json',16*1024**2)
            if receipt['schemaVersion']!='obj-local-receipt/1' or receipt['sourceSha256']!=request['sourceSha256'] \
                    or receipt['artifact']['sha256']!=digest(encoded) or receipt['artifact']['bytes']!=len(encoded) \
                    or receipt['workerInterpreter']['sha256']!=pins['pythonSha256'] or receipt['runtimeLockSha256']!=pins['nativeRuntimeLockSha256'] \
                    or receipt['sourceWriteDeniedThroughPublication'] is not True:
                raise ValueError('receipt_changed')
            supervision=receipt['supervision']
            dependency_profile.verify(profile)
            if digest(bounded(request['profilePath'],2*1024**2))!=pins['profileSha256'] or digest(bounded(source,16*1024**2))!=request['sourceSha256']:
                raise ValueError('profile_changed')
            if digest(bounded(output_directory/'obj.json',16*1024**2))!=digest(encoded):
                raise ValueError('output_changed')
            host=host_observation();host['observedSeconds']=time.monotonic()-started
            if host['observedSeconds']>75:raise ValueError('host_deadline')
            print(json.dumps({'state':'available','supervision':supervision,'hostSupervision':host}))
            return 0
    except Busy:
        print('{"code":"OBJ_BUSY"}')
        return 2
    except ValueError:
        # Profile/source/publication integrity failures never expose private paths.
        print('{"code":"OBJ_TOOL_CHANGED"}')
        return 2
    except (OSError,KeyError,TypeError):
        print('{"code":"OBJ_UNAVAILABLE"}')
        return 2

if __name__=='__main__':
    raise SystemExit(main())
