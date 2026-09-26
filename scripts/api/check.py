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


def operation_inventory(ledger, pins):
    baseline = {o['method'] + ' ' + o['path']: o for o in ledger['operations']}
    require(len(baseline) == len(ledger['operations']), 'duplicate baseline operation')
    inventory = {key: {**entry, 'disposition': 'retained', 'manifest': None}
                 for key, entry in baseline.items() if entry['batch'] == 'NEST-00'}
    for file in sorted((ROOT / 'apps/api/src/modules').glob('*/operation-manifest.json')):
        path = file.relative_to(ROOT).as_posix()
        require(path in pins['sourceSha256'], f'unpinned operation manifest: {path}')
        manifest = json.loads(file.read_text())
        for entry in manifest['operations']:
            key = entry['method'] + ' ' + entry['path']
            require(entry['method'].lower() in METHODS and entry['method'].isupper(),
                    f'invalid manifest method: {key}')
            require(key not in inventory, f'duplicate operation manifest: {key}')
            if key in baseline:
                require(entry['operationId'] == baseline[key]['operationId'],
                        f'baseline operation ID changed: {key}')
                require(entry['disposition'] in {'retained', 'replaced', 'retired'},
                        f'invalid baseline disposition: {key}')
            else:
                require(entry['disposition'] == 'added', f'undeclared additive operation: {key}')
            batch = entry.get('batch', manifest['batch'])
            require(isinstance(batch, str) and bool(batch) and batch.strip() == batch,
                    f'invalid owner batch: {key}')
            inventory[key] = {**entry, 'batch': batch, 'manifest': path}
    require(set(baseline) <= set(inventory), 'baseline operations missing from manifests')
    return inventory, set(baseline)


def main():
    spec = json.loads((ROOT / 'docs/api/openapi.json').read_text())
    pins = json.loads((ROOT / 'docs/api/source-pins.json').read_text())
    ledger = json.loads((ROOT / 'docs/orchestration/nestjs-operation-ledger.json').read_text())
    runtime = json.loads((ROOT / 'docs/api/runtime-qualification.json').read_text())
    runtime_operations = set()
    for run in [runtime, *runtime.get('additionalRuns', [])]:
        receipt_bytes = (ROOT / run['receipt']).read_bytes()
        require(hashlib.sha256(receipt_bytes).hexdigest() == run['receiptSha256'], 'runtime receipt changed')
        receipt = json.loads(receipt_bytes)
        require(receipt['servedCodeCommit'] == run['servedCodeCommit'], 'runtime code pin differs')
        runtime_operations.update(run['operations'])
        for operation, evidence in run['operations'].items():
            for pointer in evidence['evidencePointers']:
                node = receipt
                for token in pointer.strip('/').split('/'):
                    require(isinstance(node, dict) and token in node, f'missing runtime evidence: {operation} {pointer}')
                    node = node[token]
            for source in evidence['sourceManifests']:
                require((ROOT / source).is_file(), f'missing runtime source manifest: {source}')
    require(spec['openapi'] == '3.0.3', 'expected native Swagger OpenAPI 3.0.3')
    require(pins['schemaVersion'] == 'ulpin-native-openapi-pins/1', 'obsolete source pins')
    for path, digest in pins['sourceSha256'].items():
        file = ROOT / path
        require(file.is_file() and hashlib.sha256(file.read_bytes()).hexdigest() == digest,
                f'producer changed; regenerate/review contract: {path}')
    inventory, baseline = operation_inventory(ledger, pins)
    operations, ids = set(), set()
    for path, item in spec['paths'].items():
        for method, op in item.items():
            if method not in METHODS:
                continue
            key = method.upper() + ' ' + path
            operations.add(key)
            require(key in inventory, f'operation absent from declared inventory: {key}')
            entry = inventory[key]
            require(op['operationId'] == entry['operationId'], f'operation ID differs from manifest: {key}')
            require(op['x-disposition'] == entry['disposition'], f'disposition differs from manifest: {key}')
            require(op['x-batch'] == entry['batch'], f'owner batch differs from manifest: {key}')
            require(op.get('x-operation-manifest') == entry['manifest'], f'manifest reference differs: {key}')
            require(op['operationId'] not in ids, f'duplicate operation ID: {path}')
            ids.add(op['operationId'])
            require(op['x-source-file'] in pins['sourceSha256'], f'unpinned controller: {path}')
            require(op['x-source-file'].startswith('apps/api/'), f'legacy producer: {path}')
            require(op['x-code-status'] in ['implemented-native', 'retired-410'], f'unknown code state: {path}')
            require(op['x-code-status'] == ('retired-410' if entry['disposition'] == 'retired' else 'implemented-native'),
                    f'code status differs from disposition: {key}')
            require(isinstance(op['x-runtime-verified'], bool), f'missing runtime distinction: {path}')
            require(op['x-runtime-verified'] == (method.upper() + ' ' + path in runtime_operations),
                    f'runtime status differs from observed scope: {path}')
            require(op.get('responses'), f'no response: {path}')
            if op['x-disposition'] == 'retired':
                require('410' in op['responses'], f'retired operation without 410: {path}')
            for name in re.findall(r'\{([^}]+)\}', path):
                require(any(p.get('in') == 'path' and p.get('name') == name and p.get('required') and p.get('schema')
                            for p in op.get('parameters', [])), f'incomplete path parameter {name}: {path}')
    require(operations == set(inventory) == set(pins['operations']),
            'native operations differ from baseline plus declared additions')
    require('UnresolvedJson' not in json.dumps(spec), 'avoidable unresolved model placeholder remains')

    def refs(value):
        if isinstance(value, list):
            for child in value:
                refs(child)
        elif isinstance(value, dict):
            require(value.get('type') != 'array' or 'items' in value,
                    'OpenAPI 3.0 array schema is missing items')
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
    print(f"API-DOC: {len(operations)} native operations ({len(baseline)} baseline + "
          f"{len(operations - baseline)} added), {len(spec['components']['schemas'])} named schemas; "
          "pins, manifests, models, dataset link valid")


if __name__ == '__main__':
    main()
