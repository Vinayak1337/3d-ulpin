"""Inspect one pinned OBJ using the retained Windows supervisor and frozen lock.

One child, 512 MiB process/Job memory, 45 seconds including import and encode;
16 MiB input/output. The native reader imports only after Job attachment.
"""
from __future__ import annotations

import sys
sys.dont_write_bytecode = True
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
READER = ROOT / 'services/geo/geo/native_obj.py'
SUPERVISOR = ROOT / 'scripts/usp/desktop-gltf-read.py'
PACKAGE_INIT = ROOT / 'services/geo/geo/__init__.py'
MAX_INPUT_BYTES = MAX_OUTPUT_BYTES = 16 * 1024**2
MEMORY_BYTES = 512 * 1024**2
DEADLINE_SECONDS = 45
GATE = """import sys
if sys.stdin.buffer.read(1) != b'1': raise SystemExit(3)
sys.path.insert(0, sys.argv[1])
from geo.native_obj import _worker
raise SystemExit(_worker(sys.argv[2], sys.argv[3], sys.argv[4]))
"""


def _pin(path):
    total, digest = 0, hashlib.sha256()
    with path.open('rb') as handle:
        while block := handle.read(65536):
            total += len(block)
            if total > 32 * 1024**2:
                raise ValueError('Runtime/code constituent exceeds its inspection bound.')
            digest.update(block)
    return {'path': str(path), 'bytes': total, 'sha256': digest.hexdigest()}


def _verify_lock(path, expected):
    with path.open('rb') as handle:
        raw = handle.read(64 * 1024 + 1)
    if len(raw) > 64 * 1024 or hashlib.sha256(raw).hexdigest() != expected:
        raise ValueError('Runtime lock differs from its bounded expected hash.')
    lock = json.loads(raw)
    if lock['schemaVersion'] != 'obj-local-runtime-lock/1':
        raise ValueError('Unsupported runtime lock.')
    if not isinstance(lock['stdlib'], list) or not 1 <= len(lock['stdlib']) <= 32:
        raise ValueError('Runtime lock requires a bounded standard-library inventory.')
    if lock['builtinModules'] != {name: importlib.util.find_spec(name).origin for name in ('math', '_json')}:
        raise ValueError('Pinned built-in module origins changed.')
    required = {'reader': READER, 'cli': Path(__file__).resolve(), 'supervisor': SUPERVISOR, 'packageInit': PACKAGE_INIT}
    if set(lock['code']) != set(required):
        raise ValueError('Runtime lock must pin the exact reader, CLI, supervisor and package initializer.')
    for name, current in required.items():
        if lock['code'][name] != _pin(current):
            raise ValueError(f'Pinned {name} code changed.')
    # Base interpreter prevents venv redirectors from spawning a second process.
    if Path(lock['workerInterpreter']['path']).resolve() != Path(sys._base_executable).resolve() or lock['workerInterpreter'] != _pin(Path(sys._base_executable)):
        raise ValueError('The current base interpreter differs from the runtime lock.')
    for item in [lock['pythonDll'], *lock['stdlib']]:
        if not Path(item['path']).resolve(strict=True).is_relative_to(Path(sys._base_executable).resolve().parent):
            raise ValueError('Runtime constituents must belong to the pinned base interpreter.')
        if item != _pin(Path(item['path'])):
            raise ValueError('A pinned runtime constituent changed.')
    return lock


def _supervisor():
    spec = importlib.util.spec_from_file_location('obj_readonly_supervisor', SUPERVISOR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main(argv=None):
    started = time.monotonic()
    def remaining():
        value = DEADLINE_SECONDS - (time.monotonic() - started)
        if value <= 0:
            raise ValueError('Total inspection deadline exceeded; no result published.')
        return value
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--runtime-lock', required=True, type=Path)
    parser.add_argument('--runtime-lock-sha256', required=True)
    args = parser.parse_args(argv)
    owned, output_dir, created = [], None, False
    try:
        if sys.platform != 'win32':
            raise ValueError('This profile requires the accepted Windows Job supervisor.')
        if not all(re.fullmatch(r'[a-f0-9]{64}', value) for value in (args.expected_sha256, args.runtime_lock_sha256)):
            raise ValueError('Expected hashes must be lowercase SHA-256.')
        lock = _verify_lock(args.runtime_lock, args.runtime_lock_sha256)
        remaining()
        supervisor = _supervisor()
        source = args.source.resolve(strict=True)
        if source.drive.startswith('\\\\'):
            raise ValueError('Remote source shares are outside this local profile.')
        output_dir = args.output_dir.resolve()
        supervisor._outside_git(output_dir)
        if not source.is_file() or output_dir.exists() or not output_dir.parent.is_dir():
            raise ValueError('Use one local original, an existing private parent and a fresh output directory.')
        with supervisor._locked_source(source) as original, tempfile.TemporaryDirectory(prefix='obj-owned-', dir=output_dir.parent) as temp:
            raw = supervisor._read_original(original)
            source_sha = hashlib.sha256(raw).hexdigest()
            if source_sha != args.expected_sha256:
                raise ValueError('Original differs from expected SHA-256; worker was not started.')
            snapshot, artifact = Path(temp) / 'source.obj', Path(temp) / 'obj.json'
            with snapshot.open('xb') as handle:
                handle.write(raw)
            command = [sys._base_executable, '-I', '-S', '-B', '-c', GATE, str(ROOT / 'services/geo'), str(snapshot), str(artifact), source_sha]
            exit_code, stdout, stderr, observation = supervisor._supervise(command, timeout=remaining(), memory_bytes=MEMORY_BYTES)
            if stderr:
                raise ValueError('Unexpected child diagnostics; result was not published.')
            summary = json.loads(stdout)
            if exit_code == 2 and 'error' in summary:
                print(json.dumps(summary), file=sys.stderr)
                return 2
            if exit_code or summary.get('sourceSha256') != source_sha or summary.get('status') not in {'inspected_local', 'inspected_partial'}:
                raise ValueError('Child result does not match the expected source/status.')
            observed_artifact = supervisor._hash_file(artifact, MAX_OUTPUT_BYTES)
            remaining()
            if observed_artifact != summary['artifact']:
                raise ValueError('Artifact differs from its complete bounded hash/size receipt.')
            if _verify_lock(args.runtime_lock, args.runtime_lock_sha256) != lock or hashlib.sha256(supervisor._read_original(original)).hexdigest() != source_sha:
                raise ValueError('Runtime or original drifted during inspection.')
            receipt = {'schemaVersion': 'obj-local-receipt/1', 'sourcePath': str(source), 'sourceSha256': source_sha, 'sourceBytes': len(raw),
                       'status': summary['status'], 'counts': summary['counts'], 'artifact': {'name': 'obj.json', **observed_artifact},
                       'runtimeLockSha256': args.runtime_lock_sha256, 'code': lock['code'], 'workerInterpreter': lock['workerInterpreter'],
                       'pythonVersion': sys.version, 'supervision': observation, 'sourceWriteDeniedThroughPublication': True,
                       'limits': {'inputBytes': MAX_INPUT_BYTES, 'outputBytes': MAX_OUTPUT_BYTES, 'totalDeadlineSeconds': DEADLINE_SECONDS,
                                  'jobMemoryBytes': MEMORY_BYTES, 'activeProcesses': 1, 'childLogBytesPerStream': supervisor.MAX_LOG_BYTES},
                       'qualification': 'test_only source-native context; no canonical persistence, property identity, measurements or learning truth'}
            output_dir.mkdir(exist_ok=False)
            created = True
            for name, content in (('obj.json', None), ('receipt.json', json.dumps(receipt, indent=2).encode('utf-8'))):
                target = output_dir / name
                with target.open('xb') as handle:
                    owned.append(target)
                    if content is None:
                        with artifact.open('rb') as input_handle:
                            shutil.copyfileobj(input_handle, handle, 65536)
                    else:
                        handle.write(content)
            if supervisor._hash_file(output_dir / 'obj.json', MAX_OUTPUT_BYTES) != observed_artifact:
                raise ValueError('Published output differs from supervised bytes.')
            _verify_lock(args.runtime_lock, args.runtime_lock_sha256)
            if hashlib.sha256(supervisor._read_original(original)).hexdigest() != source_sha:
                raise ValueError('Original changed before publication completed.')
            remaining()
        print(json.dumps({'status': summary['status'], 'sourceSha256': source_sha, 'outputDirectory': str(output_dir), 'counts': summary['counts']}))
        return 0
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        if created:
            for path in owned:
                path.unlink(missing_ok=True)
            output_dir.rmdir()
        print(str(error), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
