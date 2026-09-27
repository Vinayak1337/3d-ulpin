"""Illustrative area-wide plan comparison. Never an official approval or registry write."""
import json
import sys
from shapely.geometry import shape, box, mapping


def polygons(g):
    if g.is_empty: return []
    if g.geom_type == 'Polygon': return [mapping(g)['coordinates']]
    if g.geom_type == 'MultiPolygon': return mapping(g)['coordinates']
    return [p for part in g.geoms for p in polygons(part)]


def compare(features, scenario):
    if scenario not in ('conflicts', 'match'):
        raise ValueError('Unknown simulation scenario')
    plans, findings, skipped = [], [], []
    observed_area = plan_area = outside_area = 0
    checked = 0
    bounds = []
    buildings = sorted((f for f in features if f['kind'] == 'building'), key=lambda f: f['id'])
    for index, feature in enumerate(buildings):
        observed = shape(feature['geometry'])
        height = (feature.get('height') or {}).get('value')
        if observed.geom_type not in ('Polygon', 'MultiPolygon') or observed.is_empty or not observed.is_valid or not isinstance(height, (float, int)) or height <= 0:
            skipped.append(dict(buildingId=feature['id'], reason='Valid footprint and source height required'))
            continue
        x0, y0, x1, y1 = observed.bounds
        # Separate illustrative area plan: most footprints match. Every 40th has a
        # simulated setback (eastmost 20% of its envelope). Original features stay unchanged.
        plan = observed.intersection(box(x0 - 1, y0 - 1, x0 + .8 * (x1 - x0), y1 + 1)) if scenario == 'conflicts' and index % 40 == 0 else observed
        outside = observed.difference(plan)
        checked += 1
        observed_area += observed.area
        plan_area += plan.area
        outside_area += outside.area
        plans.extend(polygons(plan))
        bounds.append(observed.bounds)
        if outside.area > 0.000001:
            findings.append(dict(buildingId=feature['id'], name=feature['name'], outside=polygons(outside),
                                 outsideAreaM2=outside.area, heightM=height, sourceFeatureId=feature.get('sourceKey')))
    if not checked: raise ValueError('No comparable buildings')
    return dict(plan=plans, findings=findings, skipped=skipped, checked=checked, total=len(buildings),
                observedAreaM2=observed_area, planAreaM2=plan_area, outsideAreaM2=outside_area,
                bounds=[min(b[0] for b in bounds), min(b[1] for b in bounds), max(b[2] for b in bounds), max(b[3] for b in bounds)])


if __name__ == '__main__':
    payload = json.load(sys.stdin)
    print(json.dumps(compare(payload['features'], payload['scenario']), allow_nan=False))
