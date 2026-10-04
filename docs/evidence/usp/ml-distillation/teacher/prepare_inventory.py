"""Inventory retained originals without copying, interpreting, or changing them.

This script has no model/network dependency. Only the coordinator freeze selects
train families; this inventory never selects or changes a split.
"""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
OUT = Path(__file__).resolve().parent
PRIVATE = Path('E:/BhuAayam-data/task-data/ml-distillation/teacher')
COORDINATOR_COMMIT = '3073365b193872362c44e9e74e2811d4be783855'
SCHEMA_PATH = 'scripts/usp/learning/association/schema-v1.json'
FREEZE_PATH = 'docs/evidence/usp/ml-distillation/family-freeze.json'


def load_contracts():
    """Use immutable coordinator Git blobs; only metadata from sealed splits."""
    blobs = {name: subprocess.check_output(
        ['git', 'show', f'{COORDINATOR_COMMIT}:{relative}'], cwd=ROOT)
        for name, relative in [('schema', SCHEMA_PATH), ('freeze', FREEZE_PATH)]}
    schema, freeze = (json.loads(blobs[name]) for name in ('schema', 'freeze'))
    if hashlib.sha256(blobs['schema']).hexdigest() != freeze['schemaSha256']:
        raise ValueError('Frozen canonical-LF schema pin mismatch')
    for name, data in blobs.items():
        destination = PRIVATE / 'contracts' / f'{name}-v1.json'
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    return schema, freeze, {name: hashlib.sha256(data).hexdigest()
                            for name, data in blobs.items()}


def read(relative):
    return json.loads((ROOT / relative).read_text(encoding='utf-8'))


def pin(path):
    path = Path(path)
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return {'bytes': path.stat().st_size, 'sha256': digest.hexdigest()}


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')


def main():
    _, freeze, contract_pins = load_contracts()
    train_sources = {s['sourceId']: s for s in freeze['sources'] if s['split'] == 'train'}
    sources = []
    original = read('docs/evidence/usp/association-sources/manifest.json')
    for asset in original['sources']:
        sources.append({
            'assetId': asset['id'],
            'family': 'bihar-magnolia' if asset['id'].startswith('bihar') else 'haryana-2831',
            'path': str(Path(original['privateRoot']) / asset['privateCopy']),
            'expected': {'bytes': asset['bytes'], 'sha256': asset['sha256']},
            'issuer': asset['issuer'], 'originalUrl': asset['url'],
            'acquiredAt': asset['firstAcquiredAt'], 'sourceVersion': asset['sourceVersion'],
            'geography': asset['geography'], 'permissions': asset['permissions'],
            'originManifest': 'docs/evidence/usp/association-sources/manifest.json',
        })
    crosswalk = read('docs/evidence/usp/association-crosswalk/manifest.json')
    for asset in crosswalk['assets']:
        sources.append({
            'assetId': asset['id'],
            'family': 'bihar-magnolia' if asset['id'].startswith('bihar') else 'haryana-2831',
            'path': asset['content']['externalPath'],
            'expected': {k: asset['content'][k] for k in ('bytes', 'sha256')},
            'issuer': asset['issuer'], 'originalUrl': asset['originalUrl'],
            'acquiredAt': asset['acquiredAt'], 'sourceVersion': asset['sourceVersion'],
            'geography': asset['geography'], 'permissions': asset['permission'],
            'originManifest': 'docs/evidence/usp/association-crosswalk/manifest.json',
        })
    for source in sources:
        authority = train_sources[source['assetId']]
        if authority['sourceSha256'] != source['expected']['sha256']:
            raise ValueError('Inventory/freeze source mismatch')
        source['family'] = authority['familyId']
        source['observed'] = pin(source['path'])
        if source['observed'] != source['expected']:
            raise ValueError(f"Original pin mismatch: {source['assetId']}")
        source['canonicalMatchState'] = 'not_assessed'
        source['trainingSelection'] = 'train'
    inventory = {
        'version': 'ml-distill-teacher-inventory/1', 'createdDate': '2026-10-02',
        'assignmentBase': 'e3e986c60ebaeb3edb101768ac88098717ccda74',
        'stagingObservedReadOnly': '523c85b17c4f37a0e0343877ce67c50cbd418b4f',
        'scope': 'Frozen training-family source inventory; no evaluation access.',
        'coordinatorCommit': COORDINATOR_COMMIT, 'contractPins': contract_pins,
        'sources': sources,
        'familyGrouping': 'All project drawings, portal pages, land/licence context and byte-identical URLs stay together.',
        'sourceIntegrity': 'Original bytes unchanged; no new acquisition or canonical identifiers.',
        'teacher': {'role': 'ML-DISTILL-01 teacher', 'requestedModel': 'gpt-6.1-sol',
                    'requestedEffort': 'max', 'requestedSpeed': 'default/standard',
                    'observedModelEffortTier': 'unexposed',
                    'suppliedPermissions': 'never/danger-full-access'},
        'limits': [
            'Haryana planned T3 context only; G+41/G+42 and current approved revision unresolved.',
            'Bihar blank villa number and Jamabandi 333/330 conflict; grouped Khata context is not a crosswalk.',
            'Public local development authorized; source-specific training/redistribution launch clearance unconfirmed.',
            'No Sarvam-derived material, operational records, fit, GPU, or qualified learning truth.',
        ],
    }
    write(OUT / 'inventory.json', inventory)
    write(PRIVATE / 'inventory.json', inventory)
    print(json.dumps({'originalsMatched': len(sources),
                      'uniqueOriginalHashes': len({s['expected']['sha256'] for s in sources}),
                      'families': sorted({s['family'] for s in sources}),
                      'selection': 'train'}))


if __name__ == '__main__':
    main()
