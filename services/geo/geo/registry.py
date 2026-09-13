"""Bounded registry queries use the same polygon/interval model as builds."""
from shapely.geometry import Point
from .geometry import build_model, _polygon_parts
from .validation import InputError, EPSILON, frame, number, polygon


def check_registry(data):
    reference = frame(data.get('frame'))
    records = data.get('records', [])
    if not isinstance(records, list) or len(records) > 150:
        raise InputError('A registry check supports at most 150 records.')
    spaces = [r for r in records if r.get('kind') == 'space']
    if len(spaces) > 100:
        raise InputError('A site supports at most 100 current volumetric spaces.')
    ids = {r['id'] for r in records}
    for r in records:
        polygon(r['footprint'], 'record footprint')
        if any(link['targetId'] not in ids for link in r.get('links', [])):
            raise InputError('Record relationship points outside this site snapshot.')
    # Parcels/buildings/floors are context, not competing exclusive volumes.
    # Shared use has one spatial record and multiple rights/relationships.
    if not spaces:
        return {'frame': reference, 'units': [], 'context': [], 'findings': [], 'inputFingerprint': data['inputFingerprint'], 'method': 'registry-context-v1'}
    result = build_model({'frame': reference, 'units': [r['geometry'] for r in spaces],
                          'context': [], 'inputFingerprint': data['inputFingerprint']})
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
