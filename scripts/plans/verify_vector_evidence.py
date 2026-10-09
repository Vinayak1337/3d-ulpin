#!/usr/bin/env python
"""Lean offline contract, citation, geometry and input-immutability checks."""
import argparse
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/geo"))
import fitz
from shapely.geometry import shape
from geo.vector_plan import METHOD, digest, sha256_file, text_lines

REQUIRED = {"task", "taskVersion", "sourceParts", "inputManifest", "methodNameAndVersion",
            "parameterHash", "outputRef", "confidenceOrError", "coverage", "limitations", "state"}


def signed_area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2


def check_geometry(geometry):
    poly = shape(geometry)
    assert poly.is_valid and poly.area > 0, "invalid/nonpositive polygon"
    rings = geometry['coordinates']
    for index, ring in enumerate(rings):
        assert ring[0] == ring[-1], "ring not closed"
        assert (signed_area(ring) > 0) == (index == 0), "ring orientation"
    return poly


def verify(directory):
    payload = json.loads((directory / 'candidates.json').read_text(encoding='utf-8'))
    receipt = json.loads((directory / 'result.json').read_text(encoding='utf-8'))
    report = json.loads((directory / 'consistency.json').read_text(encoding='utf-8'))
    assert payload['version'] == 'vector-plan-candidates/1'
    assert payload['method'] == METHOD and payload['state'] == 'candidate'
    assert payload['parameterHash'] == digest(payload['parameters'])
    source = Path(payload['inputManifest']['path'])
    assert receipt['sourceHashUnchanged'] and receipt['registryWrites'] == 0 and not receipt['apiRouteWired']
    assert sha256_file(source) == receipt['inputSha256After'] == payload['inputManifest']['sha256'] == report['sourceSha256']
    rooms = labels = dims = 0
    with fitz.open(source) as doc:
        for number, page in payload['pages'].items():
            native = text_lines(doc[int(number) - 1])
            by_locator = {(t['locator']['block'], t['locator']['line']): t for t in native}
            for t in [*page['unattachedText'], *(t for c in page['candidates'] for t in c['output']['textLines'])]:
                original = by_locator[(t['locator']['block'], t['locator']['line'])]
                assert t['literal'] == original['literal'] and t['bbox'] == original['bbox'], 'non-source text/citation'
                assert t['spans'] == original['spans'], 'span literal changed'
            if page['classification']['kind'] != 'vector_plan':
                assert not page['candidates'] and page['scale']['metresPerPdfPoint'] is None
            for index, candidate in enumerate(page['candidates']):
                assert REQUIRED <= candidate.keys(), 'DomainCandidate fields missing'
                assert candidate['task'] == 'plan_rooms' and candidate['state'] == 'candidate'
                assert candidate['methodNameAndVersion'] == candidate['method'] == METHOD
                assert candidate['parameterHash'] == payload['parameterHash']
                assert candidate['outputRef'] == f'candidates.json#/pages/{number}/candidates/{index}'
                assert candidate['inputManifest'] == payload['inputManifest']
                value = candidate['output']
                polygon = check_geometry(value['polygonPdf'])
                assert list(polygon.bounds) == value['citation']['bbox']
                assert candidate['sourceParts'] == [value['citation']]
                assert value['citation']['sourceSha256'] == payload['inputManifest']['sha256']
                assert value['citation']['page'] == int(number)
                for t in value['textLines']:
                    from shapely.geometry import box
                    assert polygon.covers(box(*t['bbox'])), 'text not fully inside region'
                if value['labelState'] == 'unknown':
                    assert value['label'] == 'unknown'
                else:
                    assert len(value['labelLiterals']) == 1 and value['label'] == value['labelLiterals'][0]['literal']
                    labels += 1
                dims += any(d['parsed'] for d in value['statedDimensions'])
                for stated in value['statedDimensions']:
                    assert any(t['literal'] == stated['literal'] and t['bbox'] == stated['bbox'] for t in value['textLines'])
                    for length in stated['dimensions']:
                        assert length['metres'] is None or length['metres'] > 0
                factor = page['scale']['metresPerPdfPoint']
                if factor is None:
                    assert value['polygonMetres'] is None and value['metricFrame'] is None
                    assert value['computedArea']['unit'] == 'pdf_point2' and 'no_scale' in value['gaps']
                else:
                    metric = check_geometry(value['polygonMetres'])
                    assert value['metricFrame']['georeferenced'] is False
                    assert value['computedArea']['unit'] == 'm2'
                    assert math.isclose(metric.area, polygon.area * factor ** 2, rel_tol=1e-9)
                assert math.isclose(value['computedArea']['value'], polygon.area * (factor ** 2 if factor else 1), rel_tol=1e-9)
                assert value['computedArea']['state'] == 'candidate'
                assert report['pages'][number]['rooms'][index]['status'] == value['consistency']['status']
                rooms += 1
            assert receipt['pageResults'][number]['roomsFound'] == len(page['candidates']) == page['summary']['roomsFound']
            assert (directory / page['overlay']['file']).stat().st_size == page['overlay']['bytes']
    return {'run': str(directory), 'pages': len(payload['pages']), 'closedFaceCandidates': rooms,
            'singleLiteralLabels': labels, 'parsedDimensionPairs': dims, 'checks': 'passed'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('runs', nargs='+', type=Path)
    args = parser.parse_args()
    print(json.dumps([verify(run) for run in args.runs], indent=2))
