"""K9d copy of K2's LF export check, with its own folder. Never edits checkout receipts or check.py."""
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile

root = Path('E:/BhuAayam-data/task-data/k9d')
archive = root / 'contract-check.tar'
export = root / 'lf-check'
export.mkdir(parents=True, exist_ok=True)
subprocess.run(['git', 'archive', '--format=tar', f'--output={archive}', 'HEAD'], check=True)
with tarfile.open(archive) as bundle:
    bundle.extractall(export, filter='data')
runtime = json.loads((export / 'docs/api/runtime-qualification.json').read_text(encoding='utf-8'))
receipts = {run['receipt']: run['receiptSha256'] for run in [runtime, *runtime.get('additionalRuns', [])]}
normalized = 0
for path in export.rglob('*'):
    if not path.is_file() or path.name.startswith('.env'):
        continue
    relative = path.relative_to(export).as_posix()
    data = path.read_bytes()
    if relative in receipts:
        # Git history contains both pinned LF and pinned CRLF receipts. Recover
        # their exact recorded encoding in this export only; no repinning/content edits.
        lf = data.replace(b'\r\n', b'\n')
        candidates = [data, lf, lf.replace(b'\n', b'\r\n')]
        pinned = receipts[relative]
        match = next((value for value in candidates if hashlib.sha256(value).hexdigest() == pinned), None)
        if match is None:
            raise SystemExit(f'Unrecoverable archive receipt pin: {relative}')
        if match != data:
            path.write_bytes(match)
        continue
    # Source originals retain exact bytes. Only code/documentation text is exported as LF.
    if relative.startswith('fixtures/') or path.suffix not in {'.ts', '.js', '.mjs', '.py', '.md', '.json'}:
        continue
    if b'\x00' not in data and b'\r\n' in data:
        path.write_bytes(data.replace(b'\r\n', b'\n'))
        normalized += 1
print(f'LF archive exported: {normalized} source/doc files normalized; exact historical receipt pins preserved')
subprocess.run(['python', '-B', 'scripts/api/check.py'], cwd=export, check=True)
