"""Bounded registry queries use the same polygon/interval model as builds."""
import uuid
from shapely.geometry import Point
from .geometry import build_model, _polygon_parts
from .validation import InputError, EPSILON, frame, number, polygon


def check_registry(data):
    reference = frame(data.get('frame'))
    records = data.get('records', [])
    if not isinstance(records, list) or len(records) > 2000:
        raise InputError('A registry check supports at most 2000 total context and spatial records.')
    spaces = [r for r in records if r.get('kind') == 'space']
    if len(spaces) > 100:
        raise InputError('A site supports at most 100 current volumetric spaces.')
    by_id = {r['id']: r for r in records}
    ids = set(by_id)
    if len(ids) != len(records):
        raise InputError('Registry record IDs must be unique.')
    shapes = {}
    for r in records:
        _, shapes[r['id']] = polygon(r['footprint'], 'record footprint')
        if any(link['targetId'] not in ids for link in r.get('links', [])):
            raise InputError('Record relationship points outside this site snapshot.')
    # Parcels/buildings/floors are context, not competing exclusive volumes.
    # Shared use has one spatial record and multiple rights/relationships.
    if not spaces:
        result = {'frame': reference, 'units': [], 'context': [], 'findings': [], 'inputFingerprint': data['inputFingerprint'], 'method': 'registry-context-v1'}
    else:
        result = build_model({'frame': reference, 'units': [r['geometry'] for r in spaces],
                              'context': [], 'inputFingerprint': data['inputFingerprint']}, allow_duplicate_aliases=True)
    def relation_finding(code, record, target, description):
        result['findings'].append({
            'id': str(uuid.uuid5(uuid.NAMESPACE_URL, f"{data['inputFingerprint']}:{code}:{record['id']}:{target['id']}")),
            'code': code, 'severity': 'error',
            'title': f"{record.get('alias', record['id'])}: inconsistent {target.get('alias', target['id'])} relationship",
            'description': description,
            'unitIds': [record['id'], target['id']],
            'sourceIds': sorted({b['sourceId'] for r in (record, target) for b in r.get('evidence', [])}),
        })
    for record in records:
        building_ids = {l['targetId'] for l in record.get('links', [])
                        if l['type'] == 'within' and by_id[l['targetId']]['kind'] == 'building'}
        for link in record.get('links', []):
            target = by_id[link['targetId']]
            if link['type'] in ('within', 'floor') and shapes[record['id']].difference(shapes[target['id']]).area > EPSILON:
                relation_finding('OUTSIDE_RELATED_CONTEXT', record, target,
                                 'The footprint extends outside its explicitly linked context. Correct the footprint or relationship before recording. Context containment itself is not an ownership conflict.')
            if link['type'] == 'crosses' and shapes[record['id']].intersection(shapes[target['id']]).area <= EPSILON:
                relation_finding('INVALID_PARCEL_CROSSING', record, target,
                                 'A crossing relationship requires positive footprint area in the linked parcel; boundary-only contact is not a crossing.')
            if link['type'] == 'floor' and building_ids:
                floor_buildings = {l['targetId'] for l in target.get('links', []) if l['type'] == 'within'}
                if floor_buildings and not floor_buildings.issubset(building_ids):
                    relation_finding('FLOOR_BUILDING_MISMATCH', record, target,
                                     'The linked floor belongs to a different building from the spatial unit. Review both memberships together.')
    for finding in result['findings']:
        if finding['code'] == 'OVERLAP':
            finding['description'] += ' This geometric intersection requires review; it does not determine ownership.'
    return result


def query_registry(data):
    reference = frame(data.get('frame'))
    if frame(data.get('queryFrame')) != reference:
        raise InputError('The query frame and benchmark must match the site.')
    mode = data.get('mode')
    if mode == 'point':
        point = data.get('point')
        if not isinstance(point, list) or len(point) != 2:
            raise InputError('Point requires local x and y.')
        shape = Point(number(point[0], 'x'), number(point[1], 'y'))
    elif mode == 'volume':
        _, shape = polygon(data.get('footprint'), 'proposal footprint')
        lower, upper = number(data.get('lower'), 'lower'), number(data.get('upper'), 'upper')
        if upper - lower <= EPSILON:
            raise InputError('Upper elevation must exceed lower elevation.')
    else:
        raise InputError('Query mode must be point or volume.')
    records = data.get('records', [])
    if len(records) > 100:
        raise InputError('Query supports at most 100 spaces.')
    results = []
    for record in records:
        g = record['geometry']
        _, footprint = polygon(g['footprint'], 'record footprint')
        if not footprint.intersects(shape):
            continue
        overlaps = []
        contact = footprint.boundary.intersects(shape) if mode == 'point' else False
        if mode == 'volume':
            low, high = max(lower, g['lower']), min(upper, g['upper'])
            if high < low - EPSILON:
                continue
            intersection = footprint.intersection(shape)
            if high - low > EPSILON:
                for part in _polygon_parts(intersection):
                    if part.interiors:
                        raise InputError('Intersection contains unsupported holes.')
                    overlaps.append({'footprint': [list(p) for p in list(part.exterior.coords)[:-1]],
                                     'lower': low, 'upper': high, 'volume': part.area * (high-low)})
            contact = not overlaps
        results.append({'record': record, 'contact': contact,
                        'volume': sum(p['volume'] for p in overlaps), 'overlaps': overlaps})
    results.sort(key=lambda r: (r['record']['geometry']['lower'], r['record']['identifier']))
    return {'results': results}
