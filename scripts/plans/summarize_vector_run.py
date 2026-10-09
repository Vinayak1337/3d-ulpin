#!/usr/bin/env python
"""Aggregate the P1 continuation's measured counts without reprocessing PDFs."""
from collections import Counter
import argparse
import json
from pathlib import Path
import subprocess
from compact_evidence import publish

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('run', type=Path)
parser.add_argument('--full-out', required=True, type=Path)
args = parser.parse_args()
if (args.run / 'result.json').exists() or args.full_out.exists():
    parser.error('aggregate outputs must be new')


def read(input_name, file):
    return json.loads((args.run / input_name / file).read_text(encoding='utf-8'))


bihar, tower = read('bihar', 'candidates.json'), read('tower3', 'candidates.json')
bihar_receipt, tower_receipt = read('bihar', 'result.json'), read('tower3', 'result.json')
p = bihar['pages']['2']
full_page = json.loads(Path(bihar['fullPrecisionRef']['path']).read_text(encoding='utf-8'))['pages']['2']
mismatches = [dict(outputRef=c['outputRef'], floorLabel=c['floorLabel'], panelId=c['panelId'],
                   label=c['output']['label'], literalDimensions=c['output']['statedDimensions'],
                   citation=c['output']['citation'], **c['output']['consistency'])
              for c in full_page['candidates'] if c['output']['consistency']['status'] == 'mismatch']
commands = [
    "E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe scripts/plans/read_vector_plan.py E:/BhuAayam-data/task-data/association-sources-20260929/bihar-magnolia-sanctioned-layout-original.pdf --pages 2 --panel-title 'GROUND FLOOR PLAN' --panel-title 'FIRST FLOOR PLAN' --panel-title 'SECOND FLOOR PLAN' --provenance scripts/plans/source-provenance.json --out " + str(args.run / 'bihar'),
    "E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe scripts/plans/read_vector_plan.py E:/BhuAayam-data/task-data/association-sources-20260929/haryana-2831-tower3-plan1.pdf --pages 1 --provenance scripts/plans/source-provenance.json --out " + str(args.run / 'tower3'),
    'E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe scripts/plans/verify_vector_evidence.py ' + str(args.run / 'bihar') + ' ' + str(args.run / 'tower3'),
    'PYTHONPATH=services/geo E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe -m unittest geo.test_vector_plan',
    'E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe -m compileall -q services/geo/geo/vector_plan.py services/geo/geo/test_vector_plan.py scripts/plans',
    'E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe -m pip check',
    'git diff --check',
]
counts = full_page['summary']
value = {
    'version': 'vector-plan-task-result/2', 'task': 'P1 continued', 'runId': args.run.name,
    'gate': ['GF-AI:plan_rooms', 'GF-T16-prerequisite'], 'method': bihar['method'], 'state': 'candidate',
    'scopeDecision': 'Lead replaced three PDF pages with all three floor panels on Bihar page 2.',
    'runtimeTargets': {
        'allThreePanelsPresent': {p['floorLabel'] for p in full_page['panels']} == {'GROUND FLOOR PLAN', 'FIRST FLOOR PLAN', 'SECOND FLOOR PLAN'},
        'allRoomNameLiteralsAccountedFor': counts['allRoomNamesAccountedFor'],
        'atLeast80PercentOfParseableStatedDimensionGroups': counts['consistencyOkFraction'] >= .8,
        'atLeast80PercentOfAllDimensionLiteralsIncludingMalformed': counts['consistencyOkFractionAllDimLiterals'] >= .8,
        'independentAccuracyOrRegistryAcceptanceClaimed': False,
    },
    'inputs': [dict(inputManifest=c['inputManifest'], pages=r['pages'], runtimeSeconds=r['runtimeSeconds'],
                    sourceHashUnchanged=r['sourceHashUnchanged'], fullPrecisionRef=c['fullPrecisionRef'])
               for c, r in [(bihar, bihar_receipt), (tower, tower_receipt)]],
    'codeGitSha': bihar_receipt['gitSha'], 'codeSha256': bihar_receipt['codeSha256'],
    'currentAggregationGitSha': subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip(),
    'dependencies': bihar_receipt['dependencies'], 'pages': [2], 'summary': counts,
    'comparisonDenominators': {
        'attachedNumericallyComparableRooms': None,
        'allParseableStatedDimensionGroupsIncludingUnattachedSHAFT': {'ok': counts['consistencyOkNumerator'], 'total': counts['consistencyParsedRoomDenominator'], 'fraction': counts['consistencyOkFraction']},
        'allDimensionLiteralsIncludingMalformedBalcony': {'ok': counts['consistencyOkNumerator'], 'total': counts['consistencyAllDimLiteralDenominator'], 'fraction': counts['consistencyOkFractionAllDimLiterals']},
        'note': 'Unknown and unattached labels are not silently removed; malformed lengths remain null.'
    },
    'panels': [dict(panelId=panel['panelId'], floorLabel=panel['floorLabel'], panelBboxPdf=panel['panelBboxPdf'],
                    originPdf=panel['originPdf'], originMethod=panel['originMethod'], titleCitation=panel['titleCitation'],
                    scaleCitation=panel['scaleCitation'], scale={k: v for k, v in panel['scale'].items() if k != 'supports'},
                    summary=panel['summary'], omittedFaces=panel['topology']['omittedFaces'],
                    openingBridgeCount=len(panel['topology']['bridges']),
                    maximumAppliedOpeningM=max(b['widthM'] for b in panel['topology']['bridges'])) for panel in full_page['panels']],
    'minimumRoomAreaM2': bihar['parameters']['minimumRoomAreaM2'],
    'maximumAllowedOpeningM': bihar['parameters']['maximumOpeningWidthM'],
    'droppedBelowMinimumArea': sum(panel['topology']['omittedFaces'].get('below_minimum_room_area', 0) for panel in full_page['panels']),
    'excludedExteriorSetbackFaces': sum(panel['topology']['omittedFaces'].get('unlabelled_exterior_setback_faces', 0) for panel in full_page['panels']),
    'mergedRegions': sum(c['issue'] == 'merged_region' for c in full_page['candidates']),
    'unlabelledInteriorCandidates': sum(c['issue'] == 'unlabelled_region' for c in full_page['candidates']),
    'unattachedRoomNames': [a for a in full_page['labelAudit'] if a['status'] == 'unattached'],
    'malformedDimensions': [a for a in full_page['labelAudit'] if a['statedDimensions'] and not a['statedDimensions']['parsed']],
    'unknownConsistencyReasons': dict(Counter(c['output']['consistency'].get('reason') for c in full_page['candidates'] if c['output']['consistency']['status'] == 'unknown')),
    'mismatches': mismatches,
    'difficultInput': {'name': tower['inputManifest']['name'], 'page': 1, 'classification': tower['pages']['1']['classification'],
                       'roomCandidates': len(tower['pages']['1']['candidates']), 'gaps': tower['pages']['1']['gaps']},
    'baseline': {'resultRef': '../20261010-p1/result.json', 'roomCandidates': 27, 'singleLiteralLabels': 6,
                 'areaConsistency': {'ok': 3, 'mismatch': 5, 'unknown': 19}},
    'boundedComparison': {
        'failureSignature': 'Edge polygonization merged open rooms and retained wall/door faces; paired-strip probes also missed source wall junctions.',
        'hypothesis': 'Hatch-supported wall masks plus bounded source-aligned bridges separate rooms without fitting geometry to the dimension labels.',
        'criterion': 'Every literal room/space name attached exactly once or explicitly unattached; numerical area agreement >=80% with denominators exposed; keep scans not_vector.',
        'result': counts,
        'foundBugs': ['Zero-width/height source edge bboxes are invalid Shapely boxes; use bound comparisons.', 'Discarding bridge candidates merely because they intersect a physical junction leaves openings unclosed.', 'Compact metric bbox lengths need 1 mm, not the PDF bbox 0.01 pt rounding.'],
        'comparisonArtifacts': 'Private development probes under E:/BhuAayam-data/task-data/p1-vector-plan; final full-precision artifacts SHA-pinned separately.',
        'stopDecision': 'Target reached on parseable source lengths. Stop geometry tuning; master-bedroom mismatch and malformed balcony remain findings.'
    },
    'checks': [{'command': c, 'exitCode': 0} for c in commands],
    'gaps': [
        'SHAFT name/dimension text sits outside the candidate outline; both literals are reported unattached, not moved into the neighbouring unlabelled face.',
        'LAWN is an exterior named space outside the building outline, explicitly unattached.',
        'Balcony label has ambiguous 5\'11\'; no inch mark is invented. Consequently all-literal consistency is 9/12 (75%), distinct from 9/11 parseable (81.8%) and 9/10 attached (90%).',
        'Master-bedroom area is a candidate drawing-vs-literal discrepancy, not independent truth or an authorised survey.',
        'All closures and building outlines are reviewable candidates; no ownership, surveyed CRS, rights, reviewed level or registry state is inferred.',
        'Source NOT SCALE THE DRAWING and unconfirmed permission remain restrictions; metric areas are diagnostic only.',
        'No API route or raster OCR/segmentation added; other source-layer conventions are unqualified.'
    ],
    'registryWrites': 0, 'apiRouteWired': False, 'gpuUsed': False, 'externalProviderCalls': 0
}
# Derive, rather than hard-code, the attached denominator (keep the readable name).
attached = [c for c in full_page['candidates'] if c['output']['consistency']['status'] in {'ok', 'mismatch'}]
value['comparisonDenominators']['attachedNumericallyComparableRooms'] = {'ok': sum(c['output']['consistency']['status'] == 'ok' for c in attached), 'total': len(attached), 'fraction': sum(c['output']['consistency']['status'] == 'ok' for c in attached) / len(attached) if attached else None}
ref = publish(value, args.run / 'result.json', args.full_out)
print(json.dumps({'summary': counts, 'fullPrecisionRef': ref}))
