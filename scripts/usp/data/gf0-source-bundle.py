"""Offline DATA-01 checks for the retained Indian context and LGD CSV packs.

This never fetches, changes source bytes, writes to a database, or promotes a gate.
The usp-data-pack/1 verifier remains the manifest/byte contract authority.
"""

import csv
import hashlib
import io
import json
import math
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[3]
CONTEXT = Path('fixtures/usp/D4/gf0-context-v1')
CODES = Path('fixtures/usp/D4/gf0-structured-codes-v1')
D7 = Path('fixtures/usp/D7/gf0-access-status/status.json')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def verify_asset(path, expected_sha, expected_bytes):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f'Asset missing or symlinked: {path.name}')
    data = path.read_bytes()
    if len(data) != expected_bytes or digest(data) != expected_sha:
        raise ValueError(f'Asset bytes/hash changed: {path.name}')
    return data


def verify_manifest_bytes(root, relative):
    folder = root / relative
    manifest = read_json(folder / 'manifest.json')
    if manifest['schemaVersion'] != 'usp-data-pack/1' or manifest['packId'] != 'D4':
        raise ValueError('Unexpected pack profile')
    checked = {}
    for asset in manifest['assets']:
        content = asset['content']
        if content['state'] != 'available':
            raise ValueError(f'Unexpected unavailable asset: {asset["id"]}')
        path = Path(content['path'])
        if path.is_absolute() or len(path.parts) != 1 or path.name != content['path']:
            raise ValueError('Asset path is not contained')
        data = verify_asset(folder / path, content['sha256'], content['bytes'])
        checked[asset['id']] = {'sha256': digest(data), 'bytes': len(data)}
    if manifest['expectedPath'] not in {a['content']['path'] for a in manifest['assets']}:
        raise ValueError('Expected evidence is not in the manifest')
    return manifest, checked


def csv_rows(data):
    text = data.decode('utf-8-sig')
    reader = csv.DictReader(io.StringIO(text, newline=''), restkey='_extra', restval=None)
    rows = list(reader)
    if not reader.fieldnames or any('_extra' in row or None in row.values() for row in rows):
        raise ValueError('Malformed CSV header or row width')
    return reader.fieldnames, rows


def inspect_context(root):
    manifest, checked = verify_manifest_bytes(root, CONTEXT)
    folder = root / CONTEXT
    expected, provenance = read_json(folder / 'expected.json'), read_json(folder / 'provenance.json')
    source = folder / 'osm-road-centrelines.geojson'
    source_bytes = source.read_bytes()
    if digest(source_bytes) != expected['sourceSha256']:
        raise ValueError('Context source does not match independent expected hash')
    retained = root / 'fixtures/uttam-nagar/uttam-nagar-road-centrelines.geojson'
    if digest(retained.read_bytes()) != digest(source_bytes):
        raise ValueError('Context differs from retained fixture')
    collection = json.loads(source_bytes)
    if collection.get('type') != 'FeatureCollection':
        raise ValueError('Context is not a FeatureCollection')
    features = collection.get('features', [])
    if len(features) != expected['featureCount']:
        raise ValueError('Context feature count changed')
    ids, points = [], []
    for feature in features:
        props, geometry = feature.get('properties', {}), feature.get('geometry', {})
        if geometry.get('type') != expected['geometryType'] or props.get('license') != expected['sourceLicence']:
            raise ValueError('Context geometry or source licence changed')
        if props.get('width') is not None or 'unknown' not in props.get('geometry_meaning', '').lower():
            raise ValueError('Road width was silently asserted')
        ids.append(props.get('osm_id'))
        for point in geometry.get('coordinates', []):
            if len(point) != 2 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in point):
                raise ValueError('Invalid context coordinate')
            lon, lat = point
            if not (68 <= lon <= 98 and 6 <= lat <= 38):
                raise ValueError('Context point is outside the supported Indian extent')
            points.append(point)
    bounds = [min(p[0] for p in points), min(p[1] for p in points),
              max(p[0] for p in points), max(p[1] for p in points)]
    if ids != expected['osmWayIds'] or any(abs(a-b) > 1e-9 for a, b in zip(bounds, expected['boundsLonLat'])):
        raise ValueError('Context IDs or bounds changed')
    validate_provenance(provenance, manifest, 'osm-road-centrelines.geojson', 'ODbL-1.0')
    return {'pack': manifest['profile'], 'featureCount': len(features), 'sourceSha256': digest(source_bytes),
            'retainedSourceSha256': digest(retained.read_bytes()),
            'boundsLonLat': bounds, 'checkedAssets': checked}


def validate_provenance(provenance, manifest, source_id, licence):
    if provenance.get('licenceFamily') != licence or provenance.get('licenceFamilyByAsset', {}).get(source_id) != licence:
        raise ValueError('Missing per-asset licence family')
    if provenance.get('trainingPermission') != 'not assessed':
        raise ValueError('Training permission must remain unqualified')
    if provenance.get('stages', {}).get('tested') not in ('pending_execution', 'passed_bounded_parser'):
        raise ValueError('Missing bounded tested stage')
    if source_id not in {asset['id'] for asset in manifest['assets']}:
        raise ValueError('Provenance source is not a manifest asset')
    if not provenance.get('missingCapabilities') or not provenance.get('purpose'):
        raise ValueError('Missing purpose or capability limits')


def inspect_codes(root):
    manifest, checked = verify_manifest_bytes(root, CODES)
    folder = root / CODES
    expected, provenance = read_json(folder / 'expected.json'), read_json(folder / 'provenance.json')
    source_bytes = (folder / 'lgd-districts.csv').read_bytes()
    if digest(source_bytes) != expected['sourceSha256']:
        raise ValueError('LGD source does not match independent expected hash')
    headers, rows = csv_rows(source_bytes)
    if headers != expected['headers'] or len(rows) != expected['rowCount']:
        raise ValueError('LGD CSV shape changed')
    states = {row['state_code'] for row in rows}
    districts = {row['district_code'] for row in rows}
    empty_local = sum(row['district_name_local'] == '' for row in rows)
    spaces_local = sum(bool(row['district_name_local']) and not row['district_name_local'].strip() for row in rows)
    if (len(states) != expected['stateCount'] or len(districts) != expected['uniqueDistrictCodes']
            or empty_local != expected['exactEmptyLocalNames']
            or spaces_local != expected['whitespaceOnlyLocalNames']):
        raise ValueError('LGD code/cardinality or empty-cell semantics changed')
    sample = next((row for row in rows if row['district_code'] == expected['literalSample']['district_code']), None)
    if not sample or any(sample.get(key) != value for key, value in expected['literalSample'].items()):
        raise ValueError('LGD literal code with leading zero changed')
    if expected['spatialGeometry'] != 'absent' or any('geometry' in name.lower() for name in headers):
        raise ValueError('A code table was mislabelled as spatial geometry')
    validate_provenance(provenance, manifest, 'lgd-districts.csv', 'GODL-India')
    return {'pack': manifest['profile'], 'rowCount': len(rows), 'stateCount': len(states),
            'exactEmptyLocalNames': empty_local, 'whitespaceOnlyLocalNames': spaces_local,
            'leadingZeroSample': sample['state_census2011_code'],
            'sourceSha256': digest(source_bytes), 'checkedAssets': checked}


def inspect_d7(root):
    status = read_json(root / D7)
    evidence = root / status['evidencePath']
    if status['state'] != 'failed' or status['reason'] != 'permission_required' or status['acquiredSourceBytes'] != 0:
        raise ValueError('D7 access boundary changed')
    if digest(evidence.read_bytes()) != status['evidenceSha256']:
        raise ValueError('D7 source-access evidence changed')
    return {'state': status['state'], 'reason': status['reason'], 'evidenceSha256': status['evidenceSha256']}


def check(root=ROOT):
    return {'schemaVersion': 'gf0-source-check/1', 'status': 'candidate_for_review',
            'context': inspect_context(root), 'structuredCodes': inspect_codes(root), 'd7': inspect_d7(root),
            'limitations': ['Parser/source suitability only; no cadastral, ownership, spatial-code or model-training qualification.',
                            'Independent review remains pending.']}


if __name__ == '__main__':
    if sys.argv[1:] != ['--check']:
        print('Usage: python3 scripts/usp/data/gf0-source-bundle.py --check', file=sys.stderr)
        raise SystemExit(2)
    try:
        print(json.dumps(check(), indent=2, ensure_ascii=False))
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(f'GF0 source check failed: {exc}', file=sys.stderr)
        raise SystemExit(1)
