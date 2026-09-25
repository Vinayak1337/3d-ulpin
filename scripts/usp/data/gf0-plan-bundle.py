"""Bounded, offline DATA-05 source preparation and inspection.

External RERA originals and the Zenodo byte range stay outside Git. This script
never fetches sources, writes to a database, or qualifies a runtime workflow.
"""

import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import sys

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[3]
PUBLIC = Path('fixtures/usp/D5/gf0-public-plans-v1')
SWISS = Path('fixtures/usp/D5/gf0-multiunit-v1')
RANGE_SHA256 = '81a0e70c3a09a580b57d16d6eddfb70f451b102918184d3a0d008fdd246b4581'
RANGE_BYTES = 2097152
SWISS_KEY = ('127', '164', '717')
SWISS_COLUMNS = ['apartment_id', 'area_id', 'building_id', 'entity_subtype', 'entity_type',
                 'floor_id', 'geometry', 'site_id', 'unit_id']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def contained_asset(folder, asset):
    content = asset['content']
    if content['state'] != 'available':
        return None
    path = Path(content['path'])
    if path.is_absolute() or len(path.parts) != 1 or path.name != content['path']:
        raise ValueError(f'Asset path escapes pack: {asset["id"]}')
    target = folder / path
    if target.is_symlink() or not target.is_file():
        raise ValueError(f'Asset missing/symlinked: {asset["id"]}')
    data = target.read_bytes()
    if len(data) != content['bytes'] or sha(data) != content['sha256']:
        raise ValueError(f'Asset bytes/hash changed: {asset["id"]}')
    return data


def manifest_bytes(folder):
    manifest = load_json(folder / 'manifest.json')
    if manifest['schemaVersion'] != 'usp-data-pack/1' or manifest['packId'] != 'D5':
        raise ValueError('Unexpected D5 manifest')
    checked = {}
    for asset in manifest['assets']:
        data = contained_asset(folder, asset)
        if data is not None:
            checked[asset['id']] = {'bytes': len(data), 'sha256': sha(data)}
    if manifest['expectedPath'] not in [a['content'].get('path') for a in manifest['assets']]:
        raise ValueError('Expected file is not a manifest asset')
    return manifest, checked


def sample_manifest_rows(folder):
    reader = csv.DictReader(io.StringIO((folder / 'sample-manifest.csv').read_text(encoding='utf-8')))
    rows = list(reader)
    if not rows or any(None in row or None in row.values() for row in rows):
        raise ValueError('Malformed sample manifest CSV')
    return rows


def complete_csv_rows(range_bytes):
    if len(range_bytes) != RANGE_BYTES or sha(range_bytes) != RANGE_SHA256:
        raise ValueError('Zenodo source byte range changed')
    cut = range_bytes.rfind(b'\n')
    if cut < 0:
        raise ValueError('Zenodo range contains no complete CSV record')
    reader = csv.DictReader(io.StringIO(range_bytes[:cut+1].decode('utf-8')))
    rows = list(reader)
    if reader.fieldnames != SWISS_COLUMNS or any(None in row or None in row.values() for row in rows):
        raise ValueError('Unexpected Zenodo CSV structure')
    return rows


def derive_swiss_sample(range_bytes):
    rows = complete_csv_rows(range_bytes)
    selected = [row for row in rows if (row['site_id'], row['building_id'], row['floor_id']) == SWISS_KEY]
    if len(selected) != 81 or {row['unit_id'] for row in selected} != {'23024', '23025'}:
        raise ValueError('Selected multi-unit sample changed')
    output = io.StringIO(newline='')
    writer = csv.DictWriter(output, fieldnames=SWISS_COLUMNS, lineterminator='\n')
    writer.writeheader()
    writer.writerows(selected)
    return output.getvalue().encode('utf-8')


def check_polygon(wkt):
    if not wkt.startswith('POLYGON ((') or not wkt.endswith('))') or '), (' in wkt:
        raise ValueError('Unsupported or absent vector polygon')
    pairs = []
    for token in wkt[len('POLYGON (('):-2].split(', '):
        values = token.split()
        if len(values) != 2:
            raise ValueError('Invalid WKT coordinate pair')
        point = tuple(float(value) for value in values)
        if not all(math.isfinite(value) for value in point):
            raise ValueError('Non-finite WKT coordinate')
        pairs.append(point)
    if len(pairs) < 4 or pairs[0] != pairs[-1]:
        raise ValueError('Open or too-small polygon ring')
    area2 = sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(pairs,pairs[1:]))
    if abs(area2) < 1e-9:
        raise ValueError('Degenerate polygon ring')


def check_swiss(root=ROOT, private_root=None):
    folder = root / SWISS
    manifest, checked = manifest_bytes(folder)
    expected = load_json(folder / 'expected.json')
    data = (folder / 'swiss-floor-127-164-717.csv').read_bytes()
    rows = list(csv.DictReader(io.StringIO(data.decode('utf-8'))))
    if len(rows) != expected['rowCount'] or set(rows[0]) != set(SWISS_COLUMNS):
        raise ValueError('Swiss sample CSV shape changed')
    if {row['unit_id'] for row in rows} != set(expected['unitIds']):
        raise ValueError('Swiss unit identifiers changed')
    if any((row['site_id'],row['building_id'],row['floor_id']) != SWISS_KEY for row in rows):
        raise ValueError('Swiss site/building/floor lineage changed')
    counts = {name: sum(row['entity_type'] == name for row in rows) for name in expected['entityTypeCounts']}
    if counts != expected['entityTypeCounts']:
        raise ValueError('Swiss vector class counts changed')
    for row in rows:
        check_polygon(row['geometry'])
    if private_root is not None:
        raw = (private_root / 'swiss-dwellings-geometries-range-0-2097151.bin').read_bytes()
        if derive_swiss_sample(raw) != data:
            raise ValueError('Swiss sample differs from preserved range')
    source = next(a for a in manifest['assets'] if a['id'] == 'swiss-floor-127-164-717.csv')
    if source['provenance']['purpose'] != 'test_only' or source['provenance']['trainingPermission']['state'] != 'unconfirmed':
        raise ValueError('Swiss purpose or training boundary changed')
    sample_rows = sample_manifest_rows(folder)
    if {row['asset_id'] for row in sample_rows} != {'swiss-dwellings-geometries-range-0-2097151', 'swiss-floor-127-164-717.csv'} or any(
        row['geography'] != 'Switzerland' or row['purpose'] != 'test_only' or row['permission'] != 'CC BY 4.0'
        for row in sample_rows
    ):
        raise ValueError('Swiss sample manifest geography or permission changed')
    return {'profile': manifest['profile'], 'sampleRows': len(rows), 'unitIds': sorted(set(row['unit_id'] for row in rows)),
            'entityTypeCounts': counts, 'geometryType': 'POLYGON', 'sampleSha256': sha(data),
            'rangeLineageVerified': private_root is not None, 'checkedAssets': checked}


def check_public(root=ROOT, private_root=None):
    folder = root / PUBLIC
    manifest, checked = manifest_bytes(folder)
    expected = load_json(folder / 'expected.json')
    sample_rows = sample_manifest_rows(folder)
    if {row['asset_id'] for row in sample_rows} != {item['assetId'] for item in expected['externalSources']} or any(
        row['permission'] != 'unconfirmed' or row['purpose'] != 'test_only' or row['local_fixture_bytes'] != 'unavailable'
        for row in sample_rows
    ):
        raise ValueError('Public-plan sample manifest permission boundary changed')
    observations = []
    for source in expected['externalSources']:
        asset = next(a for a in manifest['assets'] if a['id'] == source['assetId'])
        if asset['content']['state'] != 'unavailable' or asset['permission']['state'] != 'unconfirmed':
            raise ValueError('RERA external/permission boundary changed')
        if asset['provenance']['original'] != {'sha256': source['sha256'], 'bytes': source['bytes']}:
            raise ValueError('RERA original pin changed')
        result = {'assetId': source['assetId'], 'sourceSha256': source['sha256'], 'bytes': source['bytes']}
        if private_root is not None:
            path = private_root / source['privateFile']
            if path.is_symlink() or not path.is_file():
                raise ValueError(f'Private original missing: {source["assetId"]}')
            data = path.read_bytes()
            if len(data) != source['bytes'] or sha(data) != source['sha256'] or not data.startswith(b'%PDF-'):
                raise ValueError(f'Private PDF bytes changed: {source["assetId"]}')
            pdf = PdfReader(path)
            if len(pdf.pages) != source['pageCount']:
                raise ValueError(f'Private PDF page count changed: {source["assetId"]}')
            result['pageCount'] = len(pdf.pages)
            result['privateOriginalVerified'] = True
            if source['assetId'] == 'bihar-magnolia-sanctioned-layout.pdf':
                first = pdf.pages[0].extract_text() or ''
                second = pdf.pages[1].extract_text() or ''
                if not all(value in first for value in ('V5-01','08.06.21','VILLA TYPE 5')):
                    raise ValueError('Bihar layout identifiers changed')
                if not all(value in second for value in ('V5-02','FFL +1\'6"','FFL +11\'6"','FFL +22\'1"','FFL +32\'6"')):
                    raise ValueError('Bihar level schedule changed')
                result['drawingNumbers'] = ['V5-01','V5-02']
                result['levelStrings'] = ['FFL +1\'6"','FFL +11\'6"','FFL +22\'1"','FFL +32\'6"']
        observations.append(result)
    return {'profile': manifest['profile'], 'externalSources': observations, 'checkedAssets': checked,
            'sourcePermission': 'unconfirmed', 'qualification': 'acquired_and_bounded_inspection_only'}


def check(root=ROOT, private_root=None):
    return {'schemaVersion': 'gf0-plan-source-check/1', 'status': 'candidate_for_review',
            'publicPlans': check_public(root, private_root), 'foreignVector': check_swiss(root, private_root),
            'limitations': ['RERA reuse permission and source-to-parcel/unit matching are unconfirmed.',
                            'Swiss byte range is only a bounded subset of the published CSV, not the full release.',
                            'No source proves as-built interiors, Indian multi-unit rights or ML accuracy.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--prepare-swiss', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--private-root', type=Path)
    args = parser.parse_args()
    try:
        if args.prepare_swiss:
            if not args.output:
                parser.error('--prepare-swiss requires --output')
            args.output.write_bytes(derive_swiss_sample(args.prepare_swiss.read_bytes()))
            print(json.dumps({'output': str(args.output), 'sha256': sha(args.output.read_bytes()), 'bytes': args.output.stat().st_size}))
        elif args.check:
            print(json.dumps(check(private_root=args.private_root), indent=2))
        else:
            parser.error('choose --check or --prepare-swiss')
    except (OSError, ValueError, KeyError, IndexError) as exc:
        print(f'DATA-05 check failed: {exc}', file=sys.stderr)
        raise SystemExit(1)
