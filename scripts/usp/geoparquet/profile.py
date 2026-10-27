"""Pin or verify an existing isolated Windows GeoParquet interpreter, never install it."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path

RUNTIME_NAMES = ('python.exe', 'python313.dll', 'python3.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'DLLs', 'Lib')
ROOT=Path(__file__).resolve().parents[3]
REPOSITORY_SOURCES=('scripts/usp/geoparquet/server.py','scripts/usp/geoparquet/profile.py','scripts/usp/desktop-geoparquet-read.py',
                    'services/geo/geo/__init__.py','services/geo/geo/native_geoparquet.py')
REPOSITORY_CACHE_DIRECTORIES=('scripts/usp/geoparquet','scripts/usp','services/geo/geo')


def inventory(python: Path, environment: Path, repository: Path=ROOT):
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
    walk(environment, environment/'Lib/site-packages', 'environment')
    for path in REPOSITORY_SOURCES:
        walk(repository,repository/path,'repository')
    for directory in REPOSITORY_CACHE_DIRECTORIES:
        for path in (repository/directory).iterdir():
            if path.name.lower()=='__pycache__' or path.suffix.lower()=='.pyc':
                walk(repository,path,'repository')
    return sorted(files, key=lambda f: (f['root'], f['path']))


def verify(profile):
    if profile.get('schemaVersion')!='geoparquet-python-profile/1' or profile.get('cachePolicy')!='verified_bytecode_read_no_write' \
            or Path(profile['repositoryRoot']).resolve()!=ROOT:
        raise ValueError('profile_changed')
    actual = inventory(Path(profile['python']), Path(profile['environmentRoot']))
    if actual != profile['files']:
        raise ValueError('profile_changed')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--python', type=Path, required=True)
    p.add_argument('--environment', type=Path, required=True)
    p.add_argument('--scratch', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    profile = {'schemaVersion': 'geoparquet-python-profile/1', 'platform': 'windows-x86_64',
               'cachePolicy':'verified_bytecode_read_no_write','repositoryRoot':str(ROOT),
               'python': str(a.python.resolve()), 'environmentRoot': str(a.environment.resolve()),
               'scratchRoot': str(a.scratch.resolve()), 'files': inventory(a.python.resolve(), a.environment.resolve())}
    data = (json.dumps(profile, indent=2)+'\n').encode('utf-8')
    with a.output.open('xb') as stream:
        stream.write(data)
    print(json.dumps({'sha256': hashlib.sha256(data).hexdigest(), 'files': len(profile['files']), 'bytes': len(data)}))


if __name__ == '__main__':
    main()
