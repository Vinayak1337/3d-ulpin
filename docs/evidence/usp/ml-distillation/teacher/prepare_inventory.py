"""Inventory retained originals without copying, interpreting, or changing them.

This script has no model/network dependency. Inventory is not a train split.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
OUT = Path(__file__).resolve().parent
PRIVATE = Path('E:/BhuAayam-data/task-data/ml-distillation/teacher')


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
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def main():
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
        source['observed'] = pin(source['path'])
        if source['observed'] != source['expected']:
            raise ValueError(f"Original pin mismatch: {source['assetId']}")
        source['canonicalMatchState'] = 'not_assessed'
        source['trainingSelection'] = 'awaiting_orchestrator_freeze'
    inventory = {
        'version': 'ml-distill-teacher-inventory/1', 'createdDate': '2026-10-02',
        'assignmentBase': 'e3e986c60ebaeb3edb101768ac88098717ccda74',
        'stagingObservedReadOnly': '523c85b17c4f37a0e0343877ce67c50cbd418b4f',
        'scope': 'Retained public-source inventory; no demonstrations or evaluation access.',
        'sources': sources,
        'familyGrouping': 'All project drawings, portal pages, land/licence context and byte-identical URLs stay together.',
        'sourceIntegrity': 'Original bytes unchanged; no new acquisition or canonical identifiers.',
        'teacher': {'role': 'ML-DISTILL-01 teacher', 'requestedModel': 'gpt-6.1-sol',
                    'requestedEffort': 'high', 'requestedSpeed': 'default/standard',
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
                      'selection': 'awaiting_orchestrator_freeze'}))


if __name__ == '__main__':
    main()
