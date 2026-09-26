#!/usr/bin/env python3
"""Check native controller inventory, pinned producers and local schema references."""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
METHODS = {'get', 'post', 'patch', 'put', 'delete', 'options', 'head'}


def require(condition, message):
    if not condition:
        raise SystemExit('API-DOC: ' + message)


def main():
    spec = json.loads((ROOT / 'docs/api/openapi.json').read_text())
    pins = json.loads((ROOT / 'docs/api/source-pins.json').read_text())
    ledger = json.loads((ROOT / 'docs/orchestration/nestjs-operation-ledger.json').read_text())
    require(spec['openapi'] == '3.0.3', 'expected native Swagger OpenAPI 3.0.3')
    require(pins['schemaVersion'] == 'ulpin-native-openapi-pins/1', 'obsolete source pins')
    for path, digest in pins['sourceSha256'].items():
        file = ROOT / path
        require(file.is_file() and hashlib.sha256(file.read_bytes()).hexdigest() == digest,
                f'producer changed; regenerate/review contract: {path}')
    operations, ids = set(), set()
    for path, item in spec['paths'].items():
        for method, op in item.items():
            if method not in METHODS:
                continue
            operations.add(method.upper() + ' ' + path)
            require(op['operationId'] not in ids, f'duplicate operation ID: {path}')
            ids.add(op['operationId'])
            require(op['x-source-file'] in pins['sourceSha256'], f'unpinned controller: {path}')
            require(op['x-source-file'].startswith('apps/api/'), f'legacy producer: {path}')
            require(op['x-code-status'] in ['implemented-native', 'retired-410'], f'unknown code state: {path}')
            require(isinstance(op['x-runtime-verified'], bool), f'missing runtime distinction: {path}')
            require(op.get('responses'), f'no response: {path}')
            if op['x-disposition'] == 'retired':
                require('410' in op['responses'], f'retired operation without 410: {path}')
            for name in re.findall(r'\{([^}]+)\}', path):
                require(any(p.get('in') == 'path' and p.get('name') == name and p.get('required') and p.get('schema')
                            for p in op.get('parameters', [])), f'incomplete path parameter {name}: {path}')
    expected = {o['method'] + ' ' + o['path'] for o in ledger['operations']}
    require(operations == expected == set(pins['operations']), 'native operations differ from reconciled baseline')
    require('UnresolvedJson' not in json.dumps(spec), 'avoidable unresolved model placeholder remains')

    def refs(value):
        if isinstance(value, list):
            for child in value:
                refs(child)
        elif isinstance(value, dict):
            for key, child in value.items():
                if key == '$ref':
                    require(isinstance(child, str) and child.startswith('#/'), f'external/malformed ref {child}')
                    node = spec
                    for token in child[2:].split('/'):
                        token = token.replace('~1', '/').replace('~0', '~')
                        require(isinstance(node, dict) and token in node, f'broken ref {child}')
                        node = node[token]
                else:
                    refs(child)
    refs(spec)
    require(spec['x-dataset-catalogue']['repository'] == 'docs/api/datasets.json', 'missing dataset catalogue')
    for document in (ROOT / 'docs/api').glob('*.md'):
        for target in re.findall(r'\[[^]]+\]\(([^)]+)\)', document.read_text()):
            if '://' in target or target.startswith('#'):
                continue
            require((document.parent / target.split('#', 1)[0]).resolve().exists(), f'broken link {document.name}: {target}')
    print(f"API-DOC: {len(operations)} native operations, {len(spec['components']['schemas'])} named schemas; pins, models, dataset link valid")


if __name__ == '__main__':
    main()
