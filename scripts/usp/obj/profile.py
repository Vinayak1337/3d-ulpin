"""Pin or verify an existing isolated Windows OBJ interpreter, never install it."""
from __future__ import annotations
import argparse
import datetime
import importlib.util
import sys
import hashlib
import json
from pathlib import Path

RUNTIME_NAMES = ('python.exe', 'python313.dll', 'python3.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'DLLs', 'Lib')
ROOT=Path(__file__).resolve().parents[3]
REPOSITORY_SOURCES=('scripts/usp/obj/server.py','scripts/usp/obj/profile.py','scripts/usp/desktop-obj-read.py',
                    'services/geo/geo/__init__.py','services/geo/geo/native_obj.py','scripts/usp/desktop-gltf-read.py','scripts/usp/obj/runtime-lock.json')
REPOSITORY_CACHE_DIRECTORIES=('scripts/usp/obj','scripts/usp','services/geo/geo')


def inventory(python: Path, repository: Path=ROOT):
    files, total = [], 0
    allowed=set(RUNTIME_NAMES)|{'LICENSE.txt','NEWS.txt','pythonw.exe'}
    for path in python.parent.iterdir():
        if not path.is_dir() and path.name not in allowed:
            raise ValueError('profile_loader_override')

    def walk(root, path, kind):
        nonlocal total
        if path.is_symlink():
            raise ValueError('profile_symlink')
        if path.is_dir():
            if kind == 'runtime' and path.name == 'site-packages':
                return
            for child in sorted(path.iterdir()):
                walk(root, child, kind)
            return
        size = path.stat().st_size
        total += size
        if not path.is_file() or size > 64*1024**2 or total > 256*1024**2 or len(files) >= 10000:
            raise ValueError('profile_bounds')
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            while chunk := stream.read(1024*1024):
                digest.update(chunk)
        files.append({'root': kind, 'path': path.relative_to(root).as_posix(), 'bytes': size, 'sha256': digest.hexdigest()})

    for name in RUNTIME_NAMES:
        walk(python.parent, python.parent/name, 'runtime')
    for path in REPOSITORY_SOURCES:
        walk(repository,repository/path,'repository')
    for directory in REPOSITORY_CACHE_DIRECTORIES:
        for path in (repository/directory).iterdir():
            if path.name.lower()=='__pycache__' or path.suffix.lower()=='.pyc':
                walk(repository,path,'repository')
    return sorted(files, key=lambda f: (f['root'], f['path']))


def verify(profile):
    if profile.get('schemaVersion')!='obj-python-profile/1' or profile.get('cachePolicy')!='verified_bytecode_read_no_write' \
            or Path(profile['repositoryRoot']).resolve()!=ROOT:
        raise ValueError('profile_changed')
    actual = inventory(Path(profile['python']))
    lock=Path(profile['nativeRuntimeLockPath'])
    if lock.stat().st_size>65536 or hashlib.sha256(lock.read_bytes()).hexdigest()!=profile['nativeRuntimeLockSha256']:
        raise ValueError('native_lock_changed')
    if actual != profile['files']:
        raise ValueError('profile_changed')


def pin(path):
    path=path.resolve(strict=True)
    if not path.is_file() or path.stat().st_size>32*1024**2:
        raise ValueError('native_constituent_bounds')
    raw=path.read_bytes()
    return {'path':str(path),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}


def native_lock(python):
    # Fresh current-checkout recipe; the historical OBJ-01 lock stays unchanged.
    if python.resolve()!=Path(sys._base_executable).resolve():
        raise ValueError('use_current_base_interpreter')
    stdlib=('Lib/json/__init__.py','Lib/json/decoder.py','Lib/json/encoder.py','Lib/base64.py','Lib/struct.py',
            'Lib/ctypes/__init__.py','Lib/subprocess.py','Lib/tempfile.py','Lib/threading.py',
            'Lib/pathlib/__init__.py','Lib/hashlib.py','Lib/re/__init__.py','DLLs/_hashlib.pyd')
    code={'reader':'services/geo/geo/native_obj.py','cli':'scripts/usp/desktop-obj-read.py',
          'supervisor':'scripts/usp/desktop-gltf-read.py','packageInit':'services/geo/geo/__init__.py'}
    return {'schemaVersion':'obj-local-runtime-lock/1','frozenAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'pythonVersion':sys.version,'workerInterpreter':pin(python),'pythonDll':pin(python.parent/'python313.dll'),
            'stdlib':[pin(python.parent/p) for p in stdlib],
            'builtinModules':{name:importlib.util.find_spec(name).origin for name in ('math','_json')},
            'code':{name:pin(ROOT/p) for name,p in code.items()}}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--python',type=Path,required=True)
    p.add_argument('--scratch',type=Path,required=True)
    p.add_argument('--native-lock',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();python=a.python.resolve(strict=True);scratch=a.scratch.resolve(strict=True)
    targets=[a.native_lock.resolve(),a.output.resolve()]
    if not scratch.is_dir() or any(path.is_relative_to(ROOT) or path.is_relative_to(python.parent) for path in [scratch,*targets]) \
            or any(path.exists() or not path.parent.is_dir() for path in targets) or targets[0]==targets[1]:
        raise ValueError('use_fresh_private_profile_paths')
    lock=(json.dumps(native_lock(python),indent=2)+'\n').encode()
    with targets[0].open('xb') as stream:stream.write(lock)
    profile={'schemaVersion':'obj-python-profile/1','platform':'windows-x86_64','cachePolicy':'verified_bytecode_read_no_write',
             'repositoryRoot':str(ROOT),'python':str(python),'scratchRoot':str(scratch),
             'nativeRuntimeLockPath':str(targets[0]),'nativeRuntimeLockSha256':hashlib.sha256(lock).hexdigest(),'files':inventory(python)}
    verify(profile)
    data=(json.dumps(profile,indent=2)+'\n').encode()
    with targets[1].open('xb') as stream:stream.write(data)
    print(json.dumps({'sha256':hashlib.sha256(data).hexdigest(),'files':len(profile['files']),'bytes':len(data),
                      'nativeRuntimeLockSha256':profile['nativeRuntimeLockSha256']}))


if __name__=='__main__':
    main()
