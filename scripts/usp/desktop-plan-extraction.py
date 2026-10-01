#!/usr/bin/env python3
"""Local cited PDF pages from the existing isolated native reader; no admission."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys
import time

REPO = Path(__file__).resolve().parents[2]
MAX_SOURCE = 10 * 1024**2
MAX_RESULT = 4 * 1024**2
MAX_TEXT = 250_000


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pin(path: Path) -> dict:
    data = path.read_bytes()
    return {'path': str(path.resolve()), 'bytes': len(data), 'sha256': sha(data)}


def write_new(path: Path, value: dict) -> dict:
    data = (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + '\n').encode()
    if len(data) > MAX_RESULT:
        raise ValueError('LOCAL_EXTRACTION_RESULT_LIMIT')
    with path.open('xb') as target:
        target.write(data)
    return pin(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', nargs=2, action='append', required=True, metavar=('PATH', 'SHA256'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not 1 <= len(args.source) <= 3:
        parser.error('select one to three explicitly pinned unchanged PDFs')
    output = args.output.resolve()
    if not args.output.is_absolute() or output.is_relative_to(REPO) or output.exists():
        parser.error('output must be a fresh absolute private directory outside the checkout')
    sources = []
    for path_value, expected in args.source:
        path = Path(path_value)
        if not path.is_absolute() or not path.is_file() or not 0 < path.stat().st_size <= MAX_SOURCE:
            parser.error('source must be an existing bounded absolute local file')
        data = path.read_bytes()
        if sha(data) != expected or not data.startswith(b'%PDF-'):
            parser.error('original hash/format mismatch')
        sources.append((path, data, expected))
    if len({p.name for p, _, _ in sources}) != len(sources):
        parser.error('source basenames must be distinct in this local output')
    output.mkdir(mode=0o700, parents=False)
    env = {key: os.environ[key] for key in ('SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA') if key in os.environ}
    env.update(PYTHONPATH=str(REPO / 'services/geo'), PYTHONNOUSERSITE='1',
               HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', CUDA_VISIBLE_DEVICES='',
               OMP_NUM_THREADS='2', MKL_NUM_THREADS='2', OPENBLAS_NUM_THREADS='2')
    command = [sys.executable, '-m', 'geo.native_pdf', '--worker', '100', str(8*1024**2), str(MAX_TEXT)]
    observed = []
    for path, data, expected in sources:
        started = time.monotonic()
        child = subprocess.Popen(command, cwd=REPO/'services/geo', env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        timed_out = False
        try:
            raw, _ = child.communicate(input=data, timeout=45)
        except subprocess.TimeoutExpired:
            timed_out = True
            child.kill(); raw, _ = child.communicate(timeout=3)
        if len(raw) > MAX_RESULT:
            raise ValueError('NATIVE_REPLY_LIMIT')
        with (output/(path.stem+'.worker.json')).open('xb') as target:
            target.write(raw)
        try:
            result = json.loads(raw)
        except (ValueError, UnicodeError):
            result = {'error': 'invalid_worker_reply'}
        if not isinstance(result, dict):
            result = {'error': 'invalid_worker_reply'}
        if timed_out or child.returncode != 0:
            result = {'error': 'resource'}
        pages = result.get('pages')
        valid = isinstance(pages, list) and len(pages) <= 100 and all(isinstance(t,str) for t in pages)
        if valid and sum(len(t) for t in pages) > MAX_TEXT:
            valid = False
        parts = []
        if valid:
            for number, text in enumerate(pages, 1):
                if text.strip():
                    parts.append({'sourceSha256': expected, 'method': 'native_text', 'text': text,
                                  'textSha256': sha(text.encode()), 'locator': {'page': number}})
        status = 'unavailable' if not valid else 'native_text_available' if parts else 'needs_ocr'
        projection = {'version': 'local-plan-native-pages/1', 'source': pin(path),
            'reader': 'geo.native_pdf --worker; unchanged existing isolated parser', 'status': status,
            'code': result.get('error') if not valid else None,
            'pages': [{'page': i+1, 'nativeText': t, 'textSha256': sha(t.encode())} for i,t in enumerate(pages)] if valid else [],
            'parts': parts, 'textCharacters': sum(len(t) for t in pages) if valid else None,
            'execution': {'pid': child.pid, 'exitCode': child.returncode, 'timedOut': timed_out,
                          'elapsedSeconds': round(time.monotonic()-started,3), 'command': command,
                          'limits': {'seconds':45,'processMemoryBytes':384*1024**2,'sourceBytes':MAX_SOURCE,
                                     'pages':100,'pageContentBytes':8*1024**2,'textCharacters':MAX_TEXT,'replyBytes':MAX_RESULT}},
            'qualification': 'Local raw native page projection only; no redacted/canonical accepted document parts, API/job, association or learning claim.'}
        artifact = write_new(output/(path.stem+'.native.json'), projection)
        assert pin(path)['sha256'] == expected
        observed.append({'source': projection['source'], 'status':status, 'pageCount':len(pages) if valid else None,
                         'parts':len(parts), 'textCharacters':projection['textCharacters'],'code':projection['code'],
                         'artifact':artifact,'workerReply':pin(output/(path.stem+'.worker.json')),'execution':projection['execution']})
    receipt = {'version':'local-plan-extraction/1','at':datetime.now(timezone.utc).isoformat(),
        'interpreter':pin(Path(sys.executable)), 'python':sys.version.split()[0],
        'pypdfVersion':importlib.metadata.version('pypdf'), 'productionRequirementsPypdf':'5.5.0',
        'dependencyQualification':'Bundled local pypdf differs from production lock; local observed output only, not production runtime qualification.',
        'readerPins':[pin(REPO/'services/geo/geo/native_pdf.py'),pin(REPO/'services/geo/requirements.txt'),pin(Path(__file__))],
        'observed':observed,'originalsUnchanged':True,'allChildProcessesReturned':True,
        'qualification':'No source admission, accepted API artifacts, canonical records, reviewed labels or model/ML readiness.'}
    saved = write_new(output/'native-receipt.json', receipt)
    print(json.dumps({'receipt':saved,'observed':[{'source':o['source']['path'],'status':o['status'],
                                                'parts':o['parts'],'textCharacters':o['textCharacters'],'code':o['code']} for o in observed]}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
