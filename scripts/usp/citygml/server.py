"""CityGML-only host wrapper: fixed mutex, parent-kill tree ownership, accepted CLI."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import ctypes
from ctypes import wintypes
import hashlib
import importlib.util
import json
import os
import subprocess
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import profile as dependency_profile

class Busy(OSError):
    pass

class VerifiedCacheSubprocess:
    """Keep accepted gated supervision; refuse bytecode writes in its one child."""
    def __init__(self,python):self.python=Path(python).resolve()
    def __getattr__(self,name):return getattr(subprocess,name)
    def Popen(self,command,*args,**kwargs):
        if not isinstance(command,list) or Path(command[0]).resolve()!=self.python or command[1:4]!=['-I','-S','-c']:
            raise ValueError('unexpected_child_command')
        return subprocess.Popen([command[0],'-I','-S','-B',*command[3:]],*args,**kwargs)

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
    mutex = kernel.CreateMutexW(None, False, 'Global\\ULPIN-CityGML-Native-v1')
    if not mutex:
        raise OSError('host_mutex_unavailable')
    owned = False
    try:
        result = kernel.WaitForSingleObject(mutex, 0)
        if result == 0x102:  # WAIT_TIMEOUT: useful explicit retry, never a busy wait.
            raise Busy('citygml_host_occupied')
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
    handle = kernel.CreateJobObjectW(None, 'Global\\ULPIN-CityGML-Processing-Tree-v1')
    info = Extended()
    info.BasicLimitInformation.LimitFlags = 0x2000 | 0x0008 | 0x0200 | 0x0100
    info.BasicLimitInformation.ActiveProcessLimit = 2  # this supervisor plus one parser
    info.JobMemoryLimit = info.ProcessMemoryLimit = 2 * 1024**3
    if not handle or not kernel.SetInformationJobObject(handle, 9, ctypes.byref(info), ctypes.sizeof(info)) \
            or not kernel.AssignProcessToJobObject(handle, kernel.GetCurrentProcess()):
        if handle:
            kernel.CloseHandle(handle)
        raise OSError('process_tree_unavailable')
    # Intentionally retain the non-inheritable handle until process exit. Closing it kills this tree.
    return handle


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
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request',type=Path)
    parser.add_argument('--reap-pid',type=int)
    args=parser.parse_args()
    if os.name!='nt':
        print('{"code":"CITYGML_UNSUPPORTED_PLATFORM"}')
        return 2
    if args.reap_pid is not None:
        try:
            reap(args.reap_pid)
            print('{"state":"available"}')
            return 0
        except OSError:
            print('{"code":"CITYGML_REAP_UNAVAILABLE"}')
            return 2
    if args.request is None:parser.error('--request required')
    request=json.loads(bounded(args.request,32768))
    root=Path(__file__).resolve().parents[3]
    try:
        with host_lock():
            tree=own_process_tree()
            # The named Job has a shared two-process ceiling. After an abandoned
            # mutex, a predecessor parser still exiting occupies the old slot;
            # a second parser cannot start until that process is gone.
            pins=request['tools']
            profile_bytes=bounded(request['profilePath'],2*1024**2)
            if digest(profile_bytes)!=pins['profileSha256']:
                raise ValueError('profile_changed')
            profile=json.loads(profile_bytes)
            dependency_profile.verify(profile)
            cli_path=root/'scripts/usp/desktop-citygml-read.py'
            reader_path=root/'services/geo/geo/native_citygml.py'
            reader_hash=digest(b'services/geo/geo/native_citygml.py\0'+bounded(reader_path,1024**2)+
                               b'scripts/usp/desktop-citygml-read.py\0'+bounded(cli_path,1024**2))
            if reader_hash!=pins['readerSha256'] or digest(bounded(Path(__file__),1024**2)+bounded(Path(dependency_profile.__file__),1024**2))!=pins['supervisorSha256'] \
                or digest(bounded(root/'scripts/usp/citygml/runtime-lock.json',65536))!=pins['dependencyLockSha256'] \
                or digest(bounded(profile['python'],32*1024**2))!=pins['pythonSha256']:
                raise ValueError('profile_changed')
            source=Path(request['source'])
            raw=bounded(source,32*1024**2)
            if digest(raw)!=request['sourceSha256']:
                raise ValueError('source_changed')
            environment=Path(profile['environmentRoot'])
            sys.prefix=sys.exec_prefix=str(environment)
            sys.path.insert(0,str(environment/'Lib/site-packages'))
            sys.path.insert(0,str(root/'services/geo'))
            spec=importlib.util.spec_from_file_location('_canonical_citygml_supervisor',cli_path)
            cli=importlib.util.module_from_spec(spec);spec.loader.exec_module(cli)
            cli.subprocess=VerifiedCacheSubprocess(profile['python'])
            encoded,supervision=cli.supervise(source,Path(request['output']))
            dependency_profile.verify(profile)
            if digest(bounded(request['profilePath'],2*1024**2))!=pins['profileSha256'] or digest(bounded(source,32*1024**2))!=request['sourceSha256']:
                raise ValueError('profile_changed')
            if digest(bounded(request['output'],16*1024**2))!=digest(encoded):
                raise ValueError('output_changed')
            print(json.dumps({'state':'available','supervision':supervision}))
            return 0
    except Busy:
        print('{"code":"CITYGML_BUSY"}')
        return 2
    except ValueError:
        # Expose controlled codes only, never parser messages or private paths.
        error=sys.exc_info()[1]
        code=getattr(error,'code',None)
        allowed={'TIME_LIMIT','THREAD_LIMIT','MEMORY_LIMIT','PROCESS_LIMIT','OUTPUT_EXISTS', 'COORDINATE_NUMBER', 'OUTPUT_LIMIT', 'INPUT_LIMIT', 'SOURCE_DRIFT', 'SUPERVISOR_UNAVAILABLE', 'REFERENCE_DEPTH_LIMIT', 'INPUT_TYPE', 'VERSION_PROFILE', 'ENCODING', 'XML_MALFORMED', 'PARSER_VERSION', 'COORDINATE_LIMIT', 'END_TAG', 'STRING_LIMIT', 'XML_RESOURCE_DENIED', 'PUBLICATION_UNAVAILABLE', 'WORKER_EXIT', 'LOCAL_ONLY', 'SUPERVISOR_VERSION', 'STRUCTURE_LIMIT', 'BOUNDS_UNAVAILABLE', 'ATTRIBUTE_LOCATOR', 'OUTPUT_DIRECTORY', 'NAMESPACE_LIMIT', 'FORMAT'}
        print(json.dumps({'code':'CITYGML_'+code if code in allowed else 'CITYGML_TOOL_CHANGED'}))
        return 2
    except (OSError,KeyError,TypeError):
        print('{"code":"CITYGML_UNAVAILABLE"}')
        return 2

if __name__=='__main__':
    raise SystemExit(main())
