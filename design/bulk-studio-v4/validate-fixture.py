#!/usr/bin/env python3
"""Validate the isolated fictional fixture; never accesses app services."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def validate(data):
    errors = []

    def check(condition, message):
        if not condition:
            errors.append(message)

    collections = ['objects', 'geometries', 'relations', 'sources', 'sourceRecords',
                   'observations', 'lineage', 'identifierAssertions', 'batches', 'issues', 'rights', 'frames']
    indexes = {}
    for name in collections:
        indexes[name] = {item['id']: item for item in data[name]}
        check(len(indexes[name]) == len(data[name]), f'{name}: duplicate ID')
    ids = [item['id'] for name in collections for item in data[name]]
    check(len(set(ids)) == len(ids), 'IDs must be unique across collections')

    def refs(values, collection, context):
        for value in values:
            check(value in indexes[collection], f'{context}: missing {collection} reference {value}')

    # Validate links before dereferencing, so corrupt input reports useful errors.
    reference_fields = {
        'objects': {'geometryId': 'geometries', 'sourceRecordIds': 'sourceRecords'},
        'geometries': {'objectId': 'objects', 'frameId': 'frames', 'lineageId': 'lineage',
                       'sourceRecordIds': 'sourceRecords', 'supersedesId': 'geometries'},
        'sourceRecords': {'sourceId': 'sources'},
        'lineage': {'inputSourceRecordIds': 'sourceRecords', 'inputGeometryIds': 'geometries',
                    'outputGeometryId': 'geometries'},
        'relations': {'fromId': 'objects', 'toId': 'objects', 'sourceRecordIds': 'sourceRecords'},
        'observations': {'objectId': 'objects', 'sourceRecordIds': 'sourceRecords'},
        'rights': {'subjectObjectIds': 'objects', 'evidenceSourceRecordIds': 'sourceRecords'},
        'identifierAssertions': {'objectId': 'objects', 'sourceRecordIds': 'sourceRecords'},
        'issues': {'objectIds': 'objects', 'sourceRecordIds': 'sourceRecords'},
        'batches': {'sourceIds': 'sources', 'objectIds': 'objects', 'issueIds': 'issues'},
        'sources': {'frameId': 'frames'},
    }
    for collection, fields in reference_fields.items():
        for item in data[collection]:
            for field, target in fields.items():
                value = item[field]
                refs(value if isinstance(value, list) else ([] if value is None else [value]), target, item['id'])
    if errors:
        return errors

    def signed_area(ring):
        return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2

    def inside(point, ring):
        x, y = point[:2]
        result = False
        for a, b in zip(ring, ring[1:]):
            if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
                result = not result
        return result

    for item in data['objects']:
        refs(item['sourceRecordIds'], 'sourceRecords', item['id'])
        if item['geometryId']:
            refs([item['geometryId']], 'geometries', item['id'])
            check(indexes['geometries'][item['geometryId']]['objectId'] == item['id'], f"{item['id']}: wrong geometry owner")
    check(len({o['systemId'] for o in data['objects']}) == len(data['objects']), 'Duplicate systemId')
    for geometry in data['geometries']:
        gid = geometry['id']
        refs([geometry['objectId']], 'objects', gid)
        refs([geometry['frameId']], 'frames', gid)
        refs([geometry['lineageId']], 'lineage', gid)
        refs(geometry['sourceRecordIds'], 'sourceRecords', gid)
        if geometry['supersedesId']:
            refs([geometry['supersedesId']], 'geometries', gid)
            previous = indexes['geometries'][geometry['supersedesId']]
            check(previous['objectId'] == geometry['objectId'] and previous['version'] < geometry['version'], f'{gid}: invalid predecessor')
        check(indexes['frames'][geometry['frameId']]['horizontalUnit'] == 'metre', f'{gid}: unsupported measurement unit')
        if geometry['type'] == 'Polygon':
            for ring in geometry['coordinates']:
                check(ring[0] == ring[-1], f'{gid}: unclosed ring')
                check(abs(signed_area(ring)) > 0, f'{gid}: zero area ring')
            actual = abs(signed_area(geometry['coordinates'][0])) - sum(abs(signed_area(r)) for r in geometry['coordinates'][1:])
            check(abs(actual - geometry['areaM2']) < 1e-8, f'{gid}: inaccurate area')
    for record in data['sourceRecords']:
        refs([record['sourceId']], 'sources', record['id'])
        check(record['sourceRevision'] == indexes['sources'][record['sourceId']]['revision'], f"{record['id']}: revision mismatch")
    for lineage in data['lineage']:
        refs(lineage['inputSourceRecordIds'], 'sourceRecords', lineage['id'])
        refs(lineage['inputGeometryIds'], 'geometries', lineage['id'])
        refs([lineage['outputGeometryId']], 'geometries', lineage['id'])
        check(indexes['geometries'][lineage['outputGeometryId']]['lineageId'] == lineage['id'], 'Lineage ownership mismatch')
        if lineage['operation'] == 'synthetic_design_mapping':
            raw = indexes['sourceRecords'][lineage['inputSourceRecordIds'][0]]['attributes']
            digest = hashlib.sha256(json.dumps(raw, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            check(digest == lineage['inputFingerprint'], f"{lineage['id']}: fingerprint mismatch")
    for relation in data['relations']:
        refs([relation['fromId'], relation['toId']], 'objects', relation['id'])
        refs(relation['sourceRecordIds'], 'sourceRecords', relation['id'])
    for observation in data['observations']:
        refs([observation['objectId']], 'objects', observation['id'])
        refs(observation['sourceRecordIds'], 'sourceRecords', observation['id'])
    for right in data['rights']:
        refs(right['subjectObjectIds'], 'objects', right['id'])
        refs(right['evidenceSourceRecordIds'], 'sourceRecords', right['id'])
    for assertion in data['identifierAssertions']:
        refs([assertion['objectId']], 'objects', assertion['id'])
        refs(assertion['sourceRecordIds'], 'sourceRecords', assertion['id'])
        check(assertion['value'] is None, 'Fictional fixture must not claim official identifiers')
    for issue in data['issues']:
        refs(issue['objectIds'], 'objects', issue['id'])
        refs(issue['sourceRecordIds'], 'sourceRecords', issue['id'])
    for batch in data['batches']:
        refs(batch['sourceIds'], 'sources', batch['id'])
        refs(batch['objectIds'], 'objects', batch['id'])
        refs(batch['issueIds'], 'issues', batch['id'])
        for oid in batch['objectIds']:
            check(any(indexes['sourceRecords'][rid]['sourceId'] in batch['sourceIds'] for rid in indexes['objects'][oid]['sourceRecordIds']), f'{oid}: source outside batch')
    check(len({b['idempotencyKey'] for b in data['batches']}) == len(data['batches']), 'Duplicate idempotency key')
    for source in data['sources']:
        if source['representation'] == 'descriptor_only':
            check(all(source[k] is None for k in ['originalUri', 'originalSha256', 'byteSize']), f"{source['id']}: descriptor claims original bytes")
            check(not any(r['sourceId'] == source['id'] for r in data['sourceRecords']), 'Descriptor cannot supply geometry evidence')
    # Fixture-specific correctness: honest uncertainty and units inside the focal building.
    check(sum(o['type'] == 'building' for o in data['objects']) == 12, 'Expected 12 buildings')
    check(indexes['objects']['B12']['status'] == 'needs_review', 'Missing-height building must need review')
    check(indexes['geometries']['G-B12-v1']['heightM'] is None, 'Do not manufacture missing height')
    check(len(data['issues']) == 1 and data['issues'][0]['status'] == 'open', 'Expected one honest open exception')
    check('confirm' not in data['issues'][0]['allowedActions'], 'Confirmation cannot resolve absent evidence')
    building = indexes['geometries']['G-B01-v1']
    for space in (o for o in data['objects'] if o['type'] == 'space'):
        geometry = indexes['geometries'][space['geometryId']]
        check(all(inside(pt, building['coordinates'][0]) for pt in geometry['coordinates'][0]), f"{space['id']}: outside building")
        check(geometry['baseElevationM'] >= 0 and geometry['baseElevationM'] + geometry['heightM'] <= building['heightM'], 'Space vertical interval outside building')
    check(all(p[2] < 0 for p in indexes['geometries']['G-UT01-v1']['coordinates']), 'Utility must be underground')
    return errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--require-jsonschema', action='store_true')
    args = parser.parse_args()
    data = json.loads((ROOT / 'demo-data.json').read_text())
    schema = json.loads((ROOT / 'schema.json').read_text())
    errors = validate(data)
    try:
        from jsonschema import Draft202012Validator
        Draft202012Validator.check_schema(schema)
        errors += [f"schema {'/'.join(map(str, e.absolute_path))}: {e.message}" for e in Draft202012Validator(schema).iter_errors(data)]
        schema_status = 'passed'
    except ImportError:
        schema_status = 'unavailable (install jsonschema or use --require-jsonschema)'
        if args.require_jsonschema:
            errors.append('jsonschema unavailable')
    if errors:
        print('\n'.join(errors[:20]))
        raise SystemExit(1)
    print(json.dumps({'status': 'passed', 'jsonSchema': schema_status, 'objects': len(data['objects']), 'geometries': len(data['geometries']), 'relations': len(data['relations']), 'sources': len(data['sources']), 'sourceRecords': len(data['sourceRecords']), 'openIssues': sum(i['status'] == 'open' for i in data['issues'])}))


if __name__ == '__main__':
    main()
