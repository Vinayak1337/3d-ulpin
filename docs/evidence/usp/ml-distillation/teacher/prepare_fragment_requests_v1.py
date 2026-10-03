"""Assemble six provisional train-only requests over unchanged v2 fragments.

No parent targets influence context construction. Pools copy complete named
parent inputs in their fixed order before the separate support labels are read.
Uses stdlib and pinned teacher helpers; no discovery, model or student access.
"""
import copy
import hashlib
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

from assemble_batch import compact, immutable_artifact, schema_check
from prepare_inventory import OUT, PRIVATE, ROOT, pin

BASE = 'fdaaa81a56c1b633d0cd8d5ce10d0908d795fd82'
COORDINATOR = Path('C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin')
ASSIGNMENT = COORDINATOR / 'docs/evidence/usp/ml-distillation/teacher-05.fragment-requests.assignment.json'
ASSIGNMENT_SHA = '501979901e9f71a114e6fc685caad387ab7876c45e66ea6a3ffc46d78ade34fd'
CONTRACT = COORDINATOR / 'scripts/usp/learning/association/fragment-selection-schema-v1.json'
CONTRACT_SHA = 'a7f289ea272e933b20cd9b5e06fae53c6f0d77daeaf878bb8a2aad65ee7d9082'
PARENT = PRIVATE / 'train-teacher-v2.jsonl'
PARENT_SHA = '7510a7040afb7bec2bba9422eb5e14bbf0664c927bd0c2b24989c1af6dc7674c'
FREEZE = COORDINATOR / 'docs/evidence/usp/ml-distillation/family-freeze.json'
FREEZE_SHA = '387fdc7ecf3758cd25989109a8d0bb987a90a34ddd00ac3d1362e3bfa10a8fe8'
DATA = PRIVATE / 'train-teacher-fragments-v1.jsonl'
RECEIPT = PRIVATE / 'fragment-requests-v1.receipt.json'
SUPPORT = PRIVATE / 'fragment-requests-v1.support.json'
MANIFEST = OUT / 'fragment-requests-v1.manifest.json'

# Source-derived requests and complete parent pools, independent of expected IDs.
CONTEXT_CASES = (
    ('teacher-fragments-v1-01', 'Retrieve the caption naming TYPICAL FLOOR - 02 and its stated floor scope.',
     ('teacher-haryana-floor01', 'teacher-haryana-floor02')),
    ('teacher-fragments-v1-02', 'Retrieve the typical refuge-floor caption and the fragment giving its sheet identifier.',
     ('teacher-haryana-refuge-multifloor', 'teacher-haryana-floor01', 'teacher-haryana-floor02')),
    ('teacher-fragments-v1-03', 'Retrieve every supplied site-plan statement of the G+ floor count for Tower 3/T-3. Keep differing statements together without choosing a winner.',
     ('teacher-haryana-site-conflict', 'teacher-haryana-floor02')),
    ('teacher-fragments-v1-04', 'Retrieve every fragment explicitly mentioning Khesra or survey plot 1659, including grouped identifier lists. Do not infer a one-to-one parcel mapping.',
     ('teacher-bihar-identifier-conflict', 'teacher-bihar-type5-multilevel')),
    ('teacher-fragments-v1-05', 'Retrieve the supplied table cell under Carpet Area, preserving its printed value without assuming a unit.',
     ('teacher-bihar-table-units-missing',)),
    ('teacher-fragments-v1-06', 'Retrieve any supplied fragment that explicitly states an official parcel ULPIN.',
     ('teacher-bihar-identifier-conflict', 'teacher-bihar-type5-multilevel')),
)

# These labels/support judgments never enter a context, prompt or model input.
# Tuple fields: original key, exact source quote, short observable support reason.
SUPPORT_LABELS = {
    'teacher-fragments-v1-01': (
        ('t3-2-floor02-reused:item-0', 'TYPICAL FLOOR - 02 (13rd , 21st , 30th & 38th FLOOR)',
         'The exact caption names FLOOR - 02 and prints its floor scope; the competing caption names FLOOR - 01.'),),
    'teacher-fragments-v1-02': (
        ('t3-1:review-1', 'TYPICAL REFUGE FLOOR-02 (17th, 26th & 35th FLOOR)',
         'The retained annotation directly prints the refuge-floor caption and scope.'),
        ('t3-1:review-2', 'SHEET NO. T3-1',
         'The title annotation directly prints the sheet identifier; no approved-revision claim follows.'),),
    'teacher-fragments-v1-03': (
        ('site:review-0', 'T-3 G+41', 'The central tower graphic annotation states G+41.'),
        ('site:review-1', 'UNIT DETAIL: TOWER 3 G+42', 'The unit-detail annotation states G+42.'),
        ('site:review-2', 'TOWER AREA DETAIL: TOWER 3 G+42', 'The separate area-detail annotation also states G+42; it is retained rather than collapsed.'),),
    'teacher-fragments-v1-04': (
        ('bihar:land-html', 'Part of survey plot no 1659', 'The retained HTML span explicitly mentions survey plot 1659.'),
        ('bihar:title-land-identifiers', 'KHESRA NO. 1659', 'The layout-title annotation explicitly mentions Khesra 1659.'),
        ('bihar:grouped-land', 'Khesra 1641, 1659, 1660', 'The land-document annotation includes 1659 in a group; no one-to-one crosswalk is asserted.'),),
    'teacher-fragments-v1-05': (
        ('bihar:building-cell-4', '1557.20', 'The exact table locator columnLabel is Carpet Area; the text supplies only its printed value, with no unit.'),),
    'teacher-fragments-v1-06': (),
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8')


def pinned_json(path, expected):
    data = path.read_bytes()
    if digest(data) != expected:
        raise ValueError(f'Physical pin mismatch: {path}')
    return json.loads(data)


def normalized_path(value):
    # JSON path strings in this assignment contain doubled Windows separators.
    return Path(value.replace('\\', '/')).resolve()


def context_from_inputs(case, parents, row_hashes):
    example_id, request, pool_parents = case
    candidates, lineage = [], {}
    family = parents[pool_parents[0]]['input']['familyId']
    by_key = {}
    for parent_id in pool_parents:
        model_input = parents[parent_id]['input']
        if model_input['familyId'] != family:
            raise ValueError('Candidate pool crosses source families')
        for ordinal, fragment in enumerate(model_input['evidence']):
            key = fragment['key']
            pointer = {'parentExampleId': parent_id, 'parentRawRowSha256': row_hashes[parent_id],
                       'inputPointer': f'/input/evidence/{ordinal}', 'fragmentCompactSha256': digest(compact(fragment))}
            if key in by_key:
                if compact(by_key[key]['fragment']) != compact(fragment):
                    raise ValueError('One key has conflicting content; no deduplication is allowed')
                lineage[by_key[key]['id']].append(pointer)
            else:
                candidate = {'id': f'c{len(candidates)}', 'fragment': copy.deepcopy(fragment)}
                candidates.append(candidate)
                by_key[key] = candidate
                lineage[candidate['id']] = [pointer]
    if not 4 <= len(candidates) <= 12:
        raise ValueError('Expected a bounded, nontrivial pool of 4-12 exact fragments')
    context = {'version': 'association-fragment-context/1', 'exampleId': example_id,
               'familyId': family, 'split': 'train', 'request': request, 'candidates': candidates}
    return context, lineage


def main():
    if not sys.dont_write_bytecode:
        raise ValueError('Run python -B; historical imports must not write bytecode')
    assignment = pinned_json(ASSIGNMENT, ASSIGNMENT_SHA)
    contract = pinned_json(CONTRACT, CONTRACT_SHA)
    freeze = pinned_json(FREEZE, FREEZE_SHA)
    if (assignment['task'] != 'TEACHER-05-REQUESTED-FRAGMENTS' or assignment['baseCommit'] != BASE
            or normalized_path(assignment['worktree']) != ROOT.resolve()
            or normalized_path(assignment['parent']['path']) != PARENT.resolve()
            or assignment['parent']['physicalSha256'] != PARENT_SHA
            or normalized_path(assignment['contract']['path']) != CONTRACT.resolve()
            or assignment['contract']['physicalSha256'] != CONTRACT_SHA
            or normalized_path(assignment['familyFreeze']['path']) != FREEZE.resolve()
            or assignment['familyFreeze']['physicalSha256'] != FREEZE_SHA):
        raise ValueError('Assignment does not match this exact worktree/source contract')
    if set(assignment['ownedFiles']) != {
            (OUT / name).relative_to(ROOT).as_posix() for name in
            ('prepare_fragment_requests_v1.py', 'fragment-requests-v1.manifest.json', 'fragment-requests-v1.md')}:
        raise ValueError('Owned repository-file allowlist changed')
    if {normalized_path(path) for path in assignment['ownedPrivateOutputs']} != {path.resolve() for path in (DATA, RECEIPT, SUPPORT)}:
        raise ValueError('Owned private-output allowlist changed')
    branch = subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT).decode().strip()
    if branch != assignment['branch']:
        raise ValueError('Teacher branch changed')
    subprocess.run(['git', 'merge-base', '--is-ancestor', BASE, 'HEAD'], cwd=ROOT, check=True)
    prompt_sha = digest(assignment['systemPrompt'].encode('utf-8'))
    if prompt_sha != assignment['systemPromptSha256']:
        raise ValueError('Frozen static system prompt hash mismatch')
    manifest_v2 = json.loads((OUT / 'batch-v2.manifest.json').read_bytes())
    for name in ('assemble_batch.py', 'prepare_inventory.py'):
        code = (OUT / name).read_bytes().replace(b'\r\n', b'\n')
        if digest(code) != manifest_v2['codePins'][name]:
            raise ValueError('Historical imported helper changed')
    if digest((PRIVATE / 'contracts' / 'freeze-v1.json').read_bytes()) != FREEZE_SHA:
        raise ValueError('Retained private freeze changed')
    if freeze['schemaSha256'] != manifest_v2['contractPins']['schema']:
        raise ValueError('Family freeze/original schema linkage changed')
    train_sources = {source['sourceId']: source for source in freeze['sources'] if source['split'] == 'train'}
    train_families = {family['familyId'] for family in freeze['families'] if family['split'] == 'train'}
    if train_families != {'in-haryana-rera-2831', 'in-bihar-magnolia-residency'}:
        raise ValueError('Train-family freeze changed')
    parent_bytes = PARENT.read_bytes()
    if digest(parent_bytes) != PARENT_SHA or not parent_bytes.endswith(b'\n'):
        raise ValueError('Accepted v2 parent hash/LF mismatch')
    parents, row_hashes = {}, {}
    for line in parent_bytes.split(b'\n')[:-1]:
        parent = json.loads(line)
        parent_id = parent['input']['exampleId']
        if parent_id in parents or compact(parent) != line:
            raise ValueError('Duplicate/noncanonical parent row')
        if parent['supervision']['split'] != 'train' or parent['input']['familyId'] not in train_families:
            raise ValueError('Parent is outside the frozen training split')
        for source in parent['supervision']['sourceLineage']:
            if source != train_sources.get(source['sourceId']):
                raise ValueError('Parent source lineage differs from the accepted train freeze')
        allowed_hashes = {source['sourceSha256'] for source in parent['supervision']['sourceLineage']}
        for fragment in parent['input']['evidence']:
            if fragment['familyId'] != parent['input']['familyId'] or fragment['sourceSha256'] not in allowed_hashes:
                raise ValueError('Parent fragment has unsupported family/source provenance')
        parents[parent_id], row_hashes[parent_id] = parent, digest(line)
    if len(parents) != 11:
        raise ValueError('Expected exactly 11 accepted v2 rows')

    # Build all contexts before reading any selection/support labels.
    contexts = [context_from_inputs(case, parents, row_hashes) for case in CONTEXT_CASES]
    schema = copy.deepcopy(contract)
    # Existing pinned checker lacks uniqueItems; enforce this frozen keyword explicitly.
    selection_rule = schema['$defs']['selection']['properties']['selected']
    if selection_rule.pop('uniqueItems') is not True:
        raise ValueError('Selection uniqueness contract changed')
    code_sha = digest(Path(__file__).read_bytes().replace(b'\r\n', b'\n'))
    provenance = {'task': assignment['task'], 'assignmentPath': ASSIGNMENT.as_posix(),
                  'assignmentPhysicalSha256': ASSIGNMENT_SHA, 'contractPath': CONTRACT.as_posix(),
                  'contractPhysicalSha256': CONTRACT_SHA, 'baseCommit': BASE,
                  'parentDatasetSha256': PARENT_SHA, 'familyFreezeSha256': FREEZE_SHA,
                  'assemblerCanonicalLfSha256': code_sha}
    records, support_rows, counts = [], [], Counter()
    for (context, lineage), case in zip(contexts, CONTEXT_CASES):
        example_id = context['exampleId']
        identity = digest(compact(context))
        model_input = {'version': 'evidence-association-fragment-input/1', 'candidateSetSha256': identity,
                       'request': context['request'], 'candidates': copy.deepcopy(context['candidates'])}
        schema_check(context, schema['$defs']['context'], schema)
        schema_check(model_input, schema['$defs']['modelInput'], schema)
        by_key = {candidate['fragment']['key']: candidate for candidate in context['candidates']}
        proofs = {}
        for key, quote, reason in SUPPORT_LABELS[example_id]:
            if key not in by_key or quote not in by_key[key]['fragment']['text'] or not quote:
                raise ValueError('Supporting quote is not an exact subset of a current candidate')
            candidate = by_key[key]
            if candidate['id'] in proofs:
                raise ValueError('Duplicate support label')
            proofs[candidate['id']] = {'candidateId': candidate['id'], 'quote': quote, 'reason': reason,
                                      'sourceSha256': candidate['fragment']['sourceSha256'],
                                      'parentPointers': lineage[candidate['id']]}
            if example_id == 'teacher-fragments-v1-05':
                if candidate['fragment']['locator'].get('columnLabel') != 'Carpet Area':
                    raise ValueError('Carpet-area support requires the retained column label')
                proofs[candidate['id']]['locatorEvidence'] = {'pointer': '/locator/columnLabel', 'value': 'Carpet Area'}
        selected = [candidate['id'] for candidate in context['candidates'] if candidate['id'] in proofs]
        target = {'version': 'evidence-association-fragment-selection/1',
                  'candidateSetSha256': identity, 'selected': selected}
        schema_check(target, schema['$defs']['selection'], schema)
        if len(set(selected)) != len(selected) or not set(selected) <= {candidate['id'] for candidate in context['candidates']}:
            raise ValueError('Target IDs are not distinct/current')
        if [candidate['id'] for candidate in context['candidates']] != [f'c{i}' for i in range(len(context['candidates']))]:
            raise ValueError('Candidate IDs must be contiguous in source-pool order')
        # Check every current candidate directly against its unchanged parent pointer.
        for candidate in context['candidates']:
            for pointer in lineage[candidate['id']]:
                parent_id = pointer['parentExampleId']
                ordinal = int(pointer['inputPointer'].rsplit('/', 1)[1])
                if compact(candidate['fragment']) != compact(parents[parent_id]['input']['evidence'][ordinal]):
                    raise ValueError('Candidate fragment changed from its exact parent')
        is_conflict = example_id == 'teacher-fragments-v1-03'
        if is_conflict and set(proofs) != {by_key[key]['id'] for key in ('site:review-0', 'site:review-1', 'site:review-2')}:
            raise ValueError('Conflict selection must retain every supplied statement of both sides')
        source_count = len({proof['sourceSha256'] for proof in proofs.values()})
        support_row = {'exampleId': example_id, 'candidateSetSha256': identity,
                       'candidateParentPointers': lineage, 'support': [proofs[key] for key in selected],
                       'selectedOriginalHashes': sorted({proof['sourceSha256'] for proof in proofs.values()}),
                       'scope': 'Direct support in supplied context only; no factual correction or canonical association',
                       'emptyReason': ('No supplied text or locator states an official parcel ULPIN; '
                                       'plot/Khata/Jamabandi identifiers and villa captions do not establish one.') if not selected else None}
        supervisor = {'version': 'ml-distill-fragment-request-supervision/1', 'split': 'train',
                      'state': 'provisional_synthetic_supervision', 'reviewState': 'needs_independent_review',
                      'teacher': {'role': 'dedicated_ML_teacher', **assignment['worker'],
                                  'observedModelReasoningTier': 'unexposed', 'requiredSpeed': 'default/standard',
                                  'method': 'task_teacher_requested_fragments/1'},
                      'provenance': provenance, 'systemPromptSha256': prompt_sha,
                      'requestDerivation': 'Teacher-authored request over retained source fragments; not official truth',
                      'poolParentIds': list(case[2]), 'candidateParentPointers': lineage,
                      'supportPath': SUPPORT.as_posix(), 'supportRowCompactSha256': digest(compact(support_row)),
                      'conflictRetention': is_conflict, 'sarvamDerived': False,
                      'sourceQualification': 'Retained native/OCR/annotation methods and uncertainty unchanged',
                      'canonicalMatchState': 'not_assessed'}
        records.append({'context': context, 'input': model_input, 'output': target, 'supervision': supervisor})
        support_rows.append(support_row)
        counts.update({'examples': 1, 'candidateAppearances': len(context['candidates']),
                       'selectedAppearances': len(selected), 'supportQuotes': len(proofs),
                       'supportLocatorChecks': sum('locatorEvidence' in proof for proof in proofs.values()),
                       'nonemptyProperSubsets': int(0 < len(selected) < len(context['candidates'])),
                       'emptySelections': int(not selected), 'multiFragmentSelections': int(len(selected) > 1),
                       'multiOriginalSelections': int(source_count > 1), 'conflictRequests': int(is_conflict)})
    expected = {'examples': 6, 'candidateAppearances': 35, 'selectedAppearances': 10, 'supportQuotes': 10,
                'supportLocatorChecks': 1,
                'nonemptyProperSubsets': 5, 'emptySelections': 1, 'multiFragmentSelections': 3,
                'multiOriginalSelections': 1, 'conflictRequests': 1}
    if dict(counts) != expected or {row['context']['familyId'] for row in records} != train_families:
        raise ValueError('Declared six-case/support denominators changed')
    if len(set(row['context']['exampleId'] for row in records)) != 6:
        raise ValueError('Repeated example ID')
    dataset = b''.join(compact(row) + b'\n' for row in records)
    support_bytes = json_bytes({'version': 'ml-distill-fragment-request-support/1',
                                'provenance': provenance, 'rows': support_rows})
    # Only parent/assignment/contract/freeze are rehashed; no source inventory or old campaign is repeated.
    for path, expected_sha in ((PARENT, PARENT_SHA), (ASSIGNMENT, ASSIGNMENT_SHA), (CONTRACT, CONTRACT_SHA), (FREEZE, FREEZE_SHA)):
        if pin(path)['sha256'] != expected_sha:
            raise ValueError('Read-only input changed during preparation')
    artifacts = [{'path': DATA.as_posix(), 'bytes': len(dataset), 'sha256': digest(dataset)},
                 {'path': SUPPORT.as_posix(), 'bytes': len(support_bytes), 'sha256': digest(support_bytes)}]
    receipt = {'version': 'ml-distill-fragment-request-receipt/1', 'recordedAt': '2026-10-03',
               'status': 'passed_local_source_support_consistency', 'provenance': provenance, 'counts': expected,
               'families': sorted(train_families), 'parent': {'path': PARENT.as_posix(), **pin(PARENT)},
               'systemPromptSha256': prompt_sha, 'artifacts': artifacts,
               'validation': ['Frozen physical input pins', 'train-family/source-lineage membership',
                              'exact parent-fragment dictionary equality', 'complete-context identity and contiguous/current distinct IDs',
                              'context/modelInput/selection schema including explicit uniqueItems', 'selected supporting quote subsets'],
               'execution': {'command': f'& "{Path(sys.executable).as_posix()}" -B "{Path(__file__).as_posix()}"',
                             'workingDirectory': ROOT.as_posix(), 'python': sys.version.split()[0],
                             'mode': 'stdlib_cpu_only', 'bytecodeDisabled': True, 'assemblyValidationCompleted': True},
               'qualification': 'New provisional query/selection supervision, not official records or independent evaluation truth',
               'gaps': ['Empty selection concerns this supplied context only, not property-wide absence',
                        'OCR completeness and annotation-origin limitations are inherited',
                        'No units, ownership, canonical crosswalk, current approval or conflict resolution established',
                        'No model/student interface/performance/generalization qualification'],
               'historicalPreservation': 'Write allowlist contains only new assigned paths; earlier code/data/rejects/originals were not rewritten or reinventoried',
               'access': {'developmentOrEvaluation': False, 'retiredOrHeldOut': False, 'studentPredictions': False,
                          'coordinatorResultsOrStatus': False, 'sourceAcquisitionOrReparse': False, 'modelOrRuntime': False}}
    receipt_bytes = json_bytes(receipt)
    new_manifest = {'version': 'ml-distill-teacher-fragment-requests/1', 'recordedAt': '2026-10-03',
                    'status': 'provisional_synthetic_supervision', 'reviewState': 'needs_independent_review',
                    'split': 'train', 'familyIds': sorted(train_families), 'provenance': provenance,
                    'systemPrompt': assignment['systemPrompt'], 'systemPromptSha256': prompt_sha,
                    'counts': expected, 'artifacts': artifacts + [
                        {'path': RECEIPT.as_posix(), 'bytes': len(receipt_bytes), 'sha256': digest(receipt_bytes)}],
                    'worker': {'requestedModel': assignment['worker']['requestedModel'],
                               'requestedReasoning': assignment['worker']['requestedReasoning'],
                               'requiredSpeed': 'default/standard', 'observedModelReasoningTier': 'unexposed',
                               'suppliedApprovalPolicy': 'never', 'suppliedSandboxMode': 'danger-full-access'},
                    'qualification': receipt['qualification'], 'gaps': receipt['gaps']}
    outputs = ((DATA, dataset), (SUPPORT, support_bytes), (RECEIPT, receipt_bytes), (MANIFEST, json_bytes(new_manifest)))
    for path, data in outputs:
        if path.exists() and path.read_bytes() != data:
            raise ValueError(f'Existing artifact differs; preserve it and use a new version: {path}')
    for path, data in outputs:
        immutable_artifact(path, data)
        if pin(path) != {'bytes': len(data), 'sha256': digest(data)}:
            raise ValueError('Published artifact readback mismatch')
    print(json.dumps({'status': receipt['status'], 'counts': expected, 'artifacts': new_manifest['artifacts'],
                      'codeCanonicalLfSha256': code_sha}))


if __name__ == '__main__':
    main()
