#!/usr/bin/env python3
"""Pinned dispatch coverage and local OpenAPI reference check; no service access."""
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / 'docs/api/openapi.json'
PINS = ROOT / 'docs/api/source-pins.json'
METHODS = ('get', 'post', 'patch', 'put', 'delete', 'options', 'head')


def fail(message):
    print(f'API-DOC-01: {message}', file=sys.stderr)
    raise SystemExit(1)


def direct_path(route):
    parts = route.relative_to(ROOT / 'apps/web/app/api').parts[:-1]
    if any(part.startswith('[...') or part.startswith('[[...') for part in parts):
        return None
    return '/api' + (('/' + '/'.join(re.sub(r'^\[([^]]+)\]$', r'{\1}', p) for p in parts)) if parts else '')


def main():
    spec = json.loads(SPEC.read_text())
    pin_document = json.loads(PINS.read_text())
    pins = pin_document['dispatchSha256']
    contract_pins = pin_document.get('contractSha256', {})
    if spec.get('openapi') != '3.1.0': fail('expected OpenAPI 3.1.0')
    for rel, wanted in pins.items():
        file = ROOT / rel
        if not file.is_file(): fail(f'missing dispatch source {rel}')
        actual = hashlib.sha256(file.read_bytes()).hexdigest()
        if actual != wanted: fail(f'dispatch changed; review operation inventory: {rel}')
    for rel, wanted in contract_pins.items():
        file = ROOT / rel
        if not file.is_file(): fail(f'missing contract helper {rel}')
        if hashlib.sha256(file.read_bytes()).hexdigest() != wanted:
            fail(f'contract helper changed; review published shape: {rel}')
    all_routes = set((ROOT / 'apps/web/app/api').rglob('route.ts'))
    pinned_direct = {ROOT / rel for rel in pins if rel.startswith('apps/web/app/api/')}
    if all_routes != pinned_direct:
        names = sorted(str(p.relative_to(ROOT)) for p in all_routes ^ pinned_direct)
        fail(f'direct route file coverage changed: {names}')
    operations = set()
    expected_operations = set(pin_document['operations'])
    for path, path_item in spec['paths'].items():
        for method, op in path_item.items():
            if method not in METHODS: continue
            operations.add((method, path))
            source = op.get('x-source-file')
            if source not in pins: fail(f'{method.upper()} {path} has no pinned producer')
            if op.get('x-code-status') != 'implemented-in-code': fail(f'{method.upper()} {path} has unsupported status')
            if 'x-runtime-verified' not in op: fail(f'{method.upper()} {path} omits runtime state')
            if not op.get('responses'): fail(f'{method.upper()} {path} has no response')
            for name in re.findall(r'\{([^}]+)\}', path):
                if not any(p.get('in') == 'path' and p.get('name') == name for p in op.get('parameters', [])):
                    fail(f'{method.upper()} {path} omits parameter {name}')
    if {method.upper() + ' ' + path for method, path in operations} != expected_operations:
        fail('spec operations differ from pinned dispatch inventory')
    for route in all_routes:
        path = direct_path(route)
        if path is None: continue
        code = route.read_text()
        exports = {m.lower() for m in re.findall(r'export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE)|export\s+const\s+(GET|POST|PATCH|PUT|DELETE)\s*=', code) for m in m if m}
        for method in exports:
            if (method, path) not in operations:
                # Query or catchall variants can be represented by one path operation.
                fail(f'direct route missing: {method.upper()} {path}')
    def refs(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key == '$ref':
                    if not isinstance(child, str) or not child.startswith('#/'):
                        fail(f'external or malformed ref {child}')
                    node = spec
                    for token in child[2:].split('/'):
                        token = token.replace('~1', '/').replace('~0', '~')
                        if not isinstance(node, dict) or token not in node: fail(f'broken ref {child}')
                        node = node[token]
                else: refs(child)
        elif isinstance(value, list):
            for child in value: refs(child)
    refs(spec)
    for document in (ROOT / 'docs/api').glob('*.md'):
        for target in re.findall(r'\[[^]]+\]\(([^)]+)\)', document.read_text()):
            if '://' in target or target.startswith('#'): continue
            local = (document.parent / target.split('#', 1)[0]).resolve()
            if not local.exists(): fail(f'broken local link in {document.name}: {target}')
    print(f'API-DOC-01: {len(operations)} operations, {len(pins)} pinned dispatch files, {len(contract_pins)} contract helpers, refs valid')

if __name__ == '__main__': main()
