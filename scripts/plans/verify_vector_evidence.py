#!/usr/bin/env python
"""Lean offline contract, literal-accounting, frames and immutable-input checks."""
import argparse
from collections import Counter
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'services/geo'))
import fitz
from shapely import affinity
from shapely.geometry import Point, box, shape
from geo.vector_plan import METHOD, digest, group_room_labels, in_scope, sha256_file, text_lines
from compact_evidence import compact

REQUIRED = {'task', 'taskVersion', 'sourceParts', 'inputManifest', 'methodNameAndVersion',
            'parameterHash', 'outputRef', 'confidenceOrError', 'coverage', 'limitations', 'state'}


def check_geometry(geometry):
    poly = shape(geometry)
    assert poly.is_valid and poly.area > 0, 'invalid/nonpositive polygon'
    for index, ring in enumerate(geometry['coordinates']):
        assert ring[0] == ring[-1], 'ring not closed'
        signed_area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2
        assert (signed_area > 0) == (index == 0), 'ring orientation'
    return poly


def load(directory, name):
    derivative = json.loads((directory / name).read_text(encoding='utf-8'))
    if 'fullPrecisionRef' not in derivative:
        return derivative, derivative
    ref = derivative['fullPrecisionRef']
    raw = Path(ref['path'])
    assert raw.stat().st_size == ref['bytes'] and sha256_file(raw) == ref['sha256'], 'full precision lineage'
    full = json.loads(raw.read_text(encoding='utf-8'))
    assert {k: v for k, v in derivative.items() if k not in {'fullPrecisionRef', 'precision'}} == compact(full), 'rounded derivative differs from full precision'
    return full, derivative


def locator(t):
    return t['locator']['block'], t['locator']['line']


def verify(directory):
    payload, derivative = load(directory, 'candidates.json')
    receipt, _ = load(directory, 'result.json')
    report, _ = load(directory, 'consistency.json')
    assert payload['version'] in {'vector-plan-candidates/1', 'vector-plan-candidates/2'}
    assert payload['method'] == METHOD and payload['state'] == 'candidate'
    assert payload['parameterHash'] == digest(payload['parameters'])
    assert receipt['sourceHashUnchanged'] and receipt['registryWrites'] == 0 and not receipt['apiRouteWired']
    assert sha256_file(Path(payload['inputManifest']['path'])) == receipt['inputSha256After'] == payload['inputManifest']['sha256'] == report['sourceSha256']
    rooms = labels = dims = 0
    with fitz.open(payload['inputManifest']['path']) as doc:
        for number, page in payload['pages'].items():
            native_page = doc[int(number) - 1]
            native = text_lines(native_page)
            by_locator = {locator(t): t for t in native}
            source_seqnos = {d['seqno'] for d in native_page.get_drawings()} if page.get('panels') else set()
            panels = {p['panelId']: p for p in page.get('panels', [])}
            expected_groups = [g for p in panels.values() for g in group_room_labels([t for t in native if in_scope(t['bbox'], [p['panelBboxPdf']])])]
            audit = page.get('labelAudit', [])
            if panels:
                assert Counter(locator(g['name']) for g in expected_groups) == Counter(locator(g['name']) for g in audit), 'room name dropped or duplicated'
                assert all(n == 1 for n in Counter(locator(g['name']) for g in audit).values())
                for panel in panels.values():
                    origin = panel['originPdf']
                    if origin:
                        outline = check_geometry(panel['topology']['buildingOutlinePdf'])
                        assert origin == [outline.bounds[0], outline.bounds[3]], 'not outline lower-left origin'
                    for bridge in panel['topology']['bridges']:
                        assert bridge['state'] == 'candidate' and 0 < bridge['widthM'] <= payload['parameters']['maximumOpeningWidthM']
                        assert all(seqno in source_seqnos for seqno in bridge['sourceSeqnos']), 'non-source wall reference'
            exported_lines = [*page['unattachedText'], *(t for c in page['candidates'] for t in c['output']['textLines']),
                              *(g['name'] for g in audit), *(g['dimensionLine'] for g in audit if g['dimensionLine'])]
            for t in exported_lines:
                original = by_locator[locator(t)]
                assert t['literal'] == original['literal'] and t['bbox'] == original['bbox'] and t['spans'] == original['spans'], 'non-source literal/span/bbox'
            if page['classification']['kind'] != 'vector_plan':
                assert not page['candidates'] and not panels and page['scale']['metresPerPdfPoint'] is None
            refs = {}
            for index, candidate in enumerate(page['candidates']):
                assert REQUIRED <= candidate.keys()
                assert candidate['task'] == 'plan_rooms' and candidate['state'] == 'candidate'
                assert candidate['methodNameAndVersion'] == candidate['method'] == METHOD
                assert candidate['parameterHash'] == payload['parameterHash'] and candidate['inputManifest'] == payload['inputManifest']
                assert candidate['outputRef'] == f'candidates.json#/pages/{number}/candidates/{index}'
                refs[candidate['outputRef']] = candidate
                value = candidate['output']
                poly = check_geometry(value['polygonPdf'])
                assert list(poly.bounds) == value['citation']['bbox'] and candidate['sourceParts'] == [value['citation']]
                assert value['citation']['sourceSha256'] == payload['inputManifest']['sha256'] and value['citation']['page'] == int(number)
                for group in value.get('labelGroups', []):
                    assert poly.covers(Point(*group['anchorPdf'])), 'group anchor outside room'
                if not panels:
                    assert all(poly.covers(box(*t['bbox'])) for t in value['textLines'])
                if value['labelState'] == 'unknown':
                    assert value['label'] == 'unknown'
                    if len(value['labelLiterals']) > 1 and panels:
                        assert value['issue'] == 'merged_region'
                else:
                    assert len(value['labelLiterals']) == 1 and value['label'] == value['labelLiterals'][0]['literal']
                    labels += 1
                dims += any(d['parsed'] for d in value['statedDimensions'])
                for stated in value['statedDimensions']:
                    assert any(t['literal'] == stated['literal'] and t['bbox'] == stated['bbox'] for t in value['textLines'])
                    assert all(d['metres'] is None or d['metres'] > 0 for d in stated['dimensions'])
                panel = panels.get(value.get('panelId'))
                factor = panel['scale']['metresPerPdfPoint'] if panel else page['scale']['metresPerPdfPoint']
                if factor is None:
                    assert value['polygonMetres'] is None and value['metricFrame'] is None and 'no_scale' in value['gaps']
                    assert value['computedArea']['unit'] == 'pdf_point2'
                else:
                    metric = check_geometry(value['polygonMetres'])
                    assert value['computedArea']['unit'] == 'm2' and value['metricFrame']['georeferenced'] is False
                    assert math.isclose(metric.area, poly.area * factor ** 2, rel_tol=1e-9)
                    if panel:
                        assert candidate['floorLabel'] == value['floorLabel'] == panel['floorLabel']
                        assert candidate['panelId'] == panel['panelId'] and value['metricFrame']['originPdf'] == panel['originPdf']
                        transformed = affinity.scale(affinity.translate(poly, xoff=-panel['originPdf'][0], yoff=-panel['originPdf'][1]), xfact=factor, yfact=-factor, origin=(0, 0))
                        assert metric.hausdorff_distance(transformed) < 1e-8
                assert math.isclose(value['computedArea']['value'], poly.area * (factor ** 2 if factor else 1), rel_tol=1e-9)
                assert value['computedArea']['state'] == 'candidate'
                assert report['pages'][number]['rooms'][index]['status'] == value['consistency']['status']
                compact_value = derivative['pages'][number]['candidates'][index]['output']
                check_geometry(compact_value['polygonPdf'])
                if compact_value['polygonMetres']:
                    check_geometry(compact_value['polygonMetres'])
                rooms += 1
            for group in audit:
                if group['status'] == 'attached':
                    candidate = refs[group['candidateRef']]
                    assert sum(locator(t) == locator(group['name']) for t in candidate['output']['textLines']) == 1
                    assert sum(shape(c['output']['polygonPdf']).covers(Point(*group['anchorPdf'])) for c in page['candidates'] if c['panelId'] == group['panelId']) == 1
                else:
                    assert group['reason'] and group['candidateRef'] is None
            assert receipt['pageResults'][number]['roomsFound'] == len(page['candidates']) == page['summary']['roomsFound']
            assert (directory / page['overlay']['file']).stat().st_size == page['overlay']['bytes']
    return {'run': str(directory), 'pages': len(payload['pages']), 'roomCandidates': rooms,
            'singleLiteralLabels': labels, 'parsedDimensionPairs': dims, 'checks': 'passed'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('runs', nargs='+', type=Path)
    args = parser.parse_args()
    print(json.dumps([verify(run) for run in args.runs], indent=2))
