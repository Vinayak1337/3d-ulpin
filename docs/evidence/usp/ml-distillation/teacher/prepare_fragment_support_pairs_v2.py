"""Append two provisional literal/qualified-support pairs, preserving v1 bytes.

Only listed train/common authorities are read. Shared helpers are imported, not
executed. No source extraction, learner codec, model or historical campaign runs.
One invocation explicitly compiles this file and performs one compact CPU check.
"""
import argparse
import copy
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from assemble_batch import compact, immutable_artifact, schema_check
from prepare_inventory import OUT, PRIVATE, ROOT, pin

ASSIGNMENT = Path('C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin/docs/evidence/usp/ml-distillation/teacher-06.support-pairs.assignment.json')
ASSIGNMENT_SHA = '524e3408972c4ab2820dd408d51c4a59004094d5289e00c23fe120374ef3111f'
ASSIGNMENT_COMMIT = '67793c1a8354b8d2cb3d08d87aa8e057e3a7e9a0'
BASE = '2dc90d376343430f9c71d7e3ac614a08ba9e122e'
PARENT_SHA = '32c7fc4071754431f87756d0ebd121539a5357187ef0efb139083f5b86e4d742'
REPORT = OUT / 'fragment-support-pairs-v2.json'
PAIRS = (
    {'pairId': 'teacher-pair-v2-01', 'parentId': 'teacher-fragments-v1-05', 'fieldType': 'area',
     'qualifier': 'explicit square-metre unit', 'literalId': 'c4', 'literalQuote': '1557.20',
     'guardLabel': 'Carpet Area',
     'requests': ('Retrieve the table cell printing the Carpet Area value as written.',
                  'Retrieve a supplied Carpet Area value explicitly stated in square metres.')},
    {'pairId': 'teacher-pair-v2-02', 'parentId': 'teacher-fragments-v1-01', 'fieldType': 'drawing floor scope',
     'qualifier': 'explicit currently approved status', 'literalId': 'c3',
     'literalQuote': 'TYPICAL FLOOR - 02 (13rd , 21st , 30th & 38th FLOOR)',
     'guardLabel': None,
     'requests': ('Retrieve the fragment that prints the floor scope for TYPICAL FLOOR - 02.',
                  'Retrieve a supplied fragment explicitly confirming the currently approved floor scope for TYPICAL FLOOR - 02.')},
)


def now():
    return datetime.now(timezone.utc).isoformat()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def payload(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8')


def path_of(value):
    return Path(value.replace('\\', '/')).resolve()


def pin_bytes(path, expected_sha, expected_bytes=None):
    data = path.read_bytes()
    if sha(data) != expected_sha or (expected_bytes is not None and len(data) != expected_bytes):
        raise ValueError(f'Physical authority pin changed: {path}')
    return data


def verify_format(row, schema, legacy, allowed_pairs):
    context, model_input, target = row['context'], row['input'], row['output']
    for value, definition in ((context, 'context'), (model_input, 'modelInput'), (target, 'selection')):
        schema_check(value, schema['$defs'][definition], schema)
    identity = sha(compact(context))
    expected_input = {'version': 'evidence-association-fragment-input/1', 'candidateSetSha256': identity,
                      'request': context['request'], 'candidates': context['candidates']}
    if compact(model_input) != compact(expected_input) or target['candidateSetSha256'] != identity:
        raise ValueError('Whole model input/output does not bind to the complete current context')
    ids = [candidate['id'] for candidate in context['candidates']]
    if ids != [f'c{i}' for i in range(len(ids))]:
        raise ValueError('Neutral candidate IDs/order changed')
    if len(target['selected']) != len(set(target['selected'])) or not set(target['selected']) <= set(ids):
        raise ValueError('Selection IDs are duplicate or stale; uniqueItems must hold')
    if context['split'] != 'train':
        raise ValueError('Non-train context')
    for candidate in context['candidates']:
        fragment = candidate['fragment']
        schema_check(fragment, legacy['$defs']['fragment'], legacy)
        if (fragment['familyId'] != context['familyId']
                or (fragment['familyId'], fragment['sourceSha256']) not in allowed_pairs):
            raise ValueError('Fragment family/source is outside frozen train metadata')


def source_decisions(pair, context, qualified):
    """Observable, context-limited reasons; no property-wide missing-state label."""
    decisions = []
    for candidate in context['candidates']:
        fragment, candidate_id = candidate['fragment'], candidate['id']
        selected = not qualified and candidate_id == pair['literalId']
        if candidate_id == pair['literalId']:
            if pair['literalQuote'] not in fragment['text']:
                raise ValueError('Literal-support quote changed')
            if pair['guardLabel'] is not None and fragment['locator'].get('columnLabel') != pair['guardLabel']:
                raise ValueError('Area quote lost its retained column label')
            if pair['guardLabel'] is not None:
                reason = ('Carpet Area is the retained column label and 1557.20 is printed. '
                          'Neither this value nor its supplied locator states a square-metre unit.'
                          if qualified else 'Carpet Area labels this exact printed numeric value; no unit is inferred.')
            else:
                reason = ('This caption prints Floor-02 scope, including 13rd, but provides no explicit currently approved status.'
                          if qualified else 'This exact caption prints the requested Floor-02 scope; approval is not asserted.')
        else:
            label = fragment['locator'].get('columnLabel')
            reason = (f'The retained column is {label}; its value is not a Carpet Area statement'
                      if label is not None else 'The supplied tower/Floor-01 fragment does not state the requested Floor-02 scope')
            if qualified:
                reason += f' and does not establish the requested {pair["qualifier"]}'
            reason += '.'
        decisions.append({'candidateId': candidate_id, 'decision': 'selected' if selected else 'excluded',
                          'observableQuote': fragment['text'], 'quoteUtf8Sha256': sha(fragment['text'].encode('utf-8')),
                          'sourceSha256': fragment['sourceSha256'], 'fragmentCompactSha256': sha(compact(fragment)),
                          'locator': copy.deepcopy(fragment['locator']), 'reason': reason})
    return decisions


def main():
    started = now()
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', required=True)
    args = parser.parse_args()
    if not sys.dont_write_bytecode:
        raise ValueError('Use -B to protect historical helper imports')
    compile_started = now()
    source = Path(__file__).read_bytes()
    compile(source, str(Path(__file__).resolve()), 'exec')
    compiled = now()
    code_sha = sha(source.replace(b'\r\n', b'\n'))
    assignment_bytes = pin_bytes(ASSIGNMENT, ASSIGNMENT_SHA)
    assignment = json.loads(assignment_bytes)
    run_dir = path_of(args.output_dir)
    if (run_dir.parent != PRIVATE.resolve() or not run_dir.name.startswith('fragment-support-pairs-v2-')
            or run_dir.exists()):
        raise ValueError('Output must be one fresh uniquely named fragment-support-pairs-v2 directory')
    if (assignment['task'] != 'TEACHER-06-QUALIFIED-SUPPORT-PAIRS' or assignment['baseCommit'] != BASE
            or path_of(assignment['worktree']) != ROOT.resolve()
            or set(assignment['ownedPaths']) != {(OUT / name).relative_to(ROOT).as_posix() for name in
                ('prepare_fragment_support_pairs_v2.py', 'fragment-support-pairs-v2.json', 'fragment-support-pairs-v2.md')}):
        raise ValueError('Task/worktree/write allowlist changed')
    branch = subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT).decode().strip()
    if branch != assignment['branch']:
        raise ValueError('Teacher branch changed')
    subprocess.run(['git', 'merge-base', '--is-ancestor', BASE, 'HEAD'], cwd=ROOT, check=True)
    authorities, authority_pins = {}, {}
    for name, info in assignment['authorities'].items():
        path = path_of(info['path'])
        raw = pin_bytes(path, info['physicalSha256'], info['bytes'])
        authorities[name] = raw
        authority_pins[name] = {'path': path.as_posix(), 'bytes': len(raw), 'physicalSha256': sha(raw)}
    parent_bytes = authorities['originalTrainingData']
    if sha(parent_bytes) != PARENT_SHA or not parent_bytes.endswith(b'\n'):
        raise ValueError('Original six-row train pin/LF boundary changed')
    parent_lines = parent_bytes.split(b'\n')[:-1]
    originals = [json.loads(line) for line in parent_lines]
    if len(originals) != 6 or any(compact(row) != line for row, line in zip(originals, parent_lines)):
        raise ValueError('Expected the unchanged six canonical parent rows')
    parents = {row['context']['exampleId']: (row, line) for row, line in zip(originals, parent_lines)}
    if len(parents) != 6:
        raise ValueError('Duplicate parent ID')
    accepted = json.loads(authorities['originalTeacherAcceptance'])
    if (accepted['status'] != 'accepted_provisional_train_only_requested_fragment_supervision'
            or accepted['ownerCommit'] != BASE or accepted['data']['sha256'] != PARENT_SHA):
        raise ValueError('Original teacher train acceptance does not match the parent')
    manifest = json.loads(authorities['originalTrainManifest'])
    if authorities['fragmentPrompt'].decode('utf-8') != manifest['systemPrompt']:
        raise ValueError('Common prompt differs from the accepted static teacher prompt')
    for name in ('assemble_batch.py', 'prepare_inventory.py'):
        expected = json.loads((OUT / 'batch-v2.manifest.json').read_bytes())['codePins'][name]
        if sha((OUT / name).read_bytes().replace(b'\r\n', b'\n')) != expected:
            raise ValueError('Historical producer/checker helper changed')
    schema = json.loads(authorities['fragmentSchema'])
    if schema['$defs']['selection']['properties']['selected'].pop('uniqueItems') is not True:
        raise ValueError('Selection uniqueness contract changed')
    legacy = json.loads(authorities['legacyContract'])
    freeze = json.loads(authorities['familyFreeze'])
    allowed_pairs = {(item['familyId'], item['sourceSha256']) for item in freeze['sources'] if item['split'] == 'train'}
    families = {item['familyId'] for item in freeze['families'] if item['split'] == 'train'}
    if families != {'in-haryana-rera-2831', 'in-bihar-magnolia-residency'}:
        raise ValueError('Frozen train families changed')
    provenance = {'task': assignment['task'], 'assignmentPath': ASSIGNMENT.as_posix(),
                  'assignmentPhysicalSha256': ASSIGNMENT_SHA, 'assignmentCommit': ASSIGNMENT_COMMIT,
                  'workerBaseCommit': BASE, 'assemblerCanonicalLfSha256': code_sha,
                  'parentDatasetSha256': PARENT_SHA}
    appended, row_receipts, support_rows = [], [], []
    for pair_index, pair in enumerate(PAIRS, 1):
        parent, parent_line = parents[pair['parentId']]
        verify_format(parent, schema, legacy, allowed_pairs)
        parent_context_sha = sha(compact(parent['context']))
        parent_ref = {'exampleId': pair['parentId'], 'rawRowSha256': sha(parent_line),
                      'contextSha256': parent_context_sha,
                      'candidatesCompactSha256': sha(compact(parent['context']['candidates'])),
                      'inputCompactSha256': sha(compact(parent['input'])),
                      'supervisionCompactSha256': sha(compact(parent['supervision']))}
        for qualified, request in enumerate(pair['requests']):
            context = copy.deepcopy(parent['context'])
            context['exampleId'] = f'teacher-fragments-v2-pair{pair_index:02d}-{chr(97 + qualified)}'
            context['request'] = request
            identity = sha(compact(context))
            model_input = {'version': parent['input']['version'], 'candidateSetSha256': identity,
                           'request': request, 'candidates': copy.deepcopy(context['candidates'])}
            selected = [] if qualified else [pair['literalId']]
            target = {'version': parent['output']['version'], 'candidateSetSha256': identity, 'selected': selected}
            support = {'annotationId': context['exampleId'], 'pairId': pair['pairId'], 'parent': parent_ref,
                       'requestIntent': 'qualified_request' if qualified else 'literal_request',
                       'requestedQualifier': pair['qualifier'] if qualified else None,
                       'decisions': source_decisions(pair, context, bool(qualified)),
                       'retrievalScope': 'no_support_in_supplied_context' if qualified else 'literal_support_in_supplied_context'}
            supervision = {'version': 'ml-distill-qualified-support-supervision/1', 'split': 'train',
                           'state': 'provisional_synthetic_supervision', 'reviewState': 'needs_independent_review',
                           'sarvamDerived': False, 'teacher': {'role': 'dedicated_ML_teacher',
                               'requestedModel': assignment['workerSettings']['requestedModel'],
                               'requestedReasoning': assignment['workerSettings']['requestedReasoning'],
                               'requiredSpeed': assignment['workerSettings']['requiredSpeed'],
                               'observedModel': None, 'observedReasoning': None, 'observedServiceTier': None,
                               'method': 'task_teacher_qualified_support_pair/1'},
                           'provenance': provenance, 'parent': parent_ref, 'pairId': pair['pairId'],
                           'annotationId': context['exampleId'], 'annotationKind': 'teacher_request_pair',
                           'requestIntent': support['requestIntent'], 'retrievalScope': support['retrievalScope'],
                           'originalTeacherProvenance': {'teacher': copy.deepcopy(parent['supervision']['teacher']),
                                                        'provenance': copy.deepcopy(parent['supervision']['provenance'])},
                           'candidateParentPointers': copy.deepcopy(parent['supervision']['candidateParentPointers']),
                           'sourceQualification': parent['supervision']['sourceQualification'],
                           'sourceReceiptPath': (run_dir / 'source-support-v2.receipt.json').as_posix(),
                           'sourceReceiptRowCompactSha256': sha(compact(support)),
                           'systemPromptSha256': authority_pins['fragmentPrompt']['physicalSha256'],
                           'canonicalMatchState': 'not_assessed'}
            row = {'context': context, 'input': model_input, 'output': target, 'supervision': supervision}
            verify_format(row, schema, legacy, allowed_pairs)
            if (compact(context['candidates']) != compact(parent['context']['candidates'])
                    or compact(model_input['candidates']) != compact(parent['input']['candidates'])
                    or context['familyId'] != parent['context']['familyId'] or context['split'] != 'train'):
                raise ValueError('Appended annotation changed the original candidate input/family/split')
            if len(support['decisions']) != len(context['candidates']):
                raise ValueError('Every candidate requires a selected/excluded justification')
            if [decision['candidateId'] for decision in support['decisions'] if decision['decision'] == 'selected'] != selected:
                raise ValueError('Source justification does not bind the complete selection')
            raw_row = compact(row)
            row_receipts.append({'annotationId': context['exampleId'], 'pairId': pair['pairId'],
                                 'rawRowSha256': sha(raw_row), 'contextSha256': identity, 'parent': parent_ref,
                                 'selected': selected, 'quoteSourceHashes': sorted({d['sourceSha256'] for d in support['decisions']})})
            support_rows.append(support)
            appended.append(row)
        if compact(appended[-2]['input']['candidates']) != compact(appended[-1]['input']['candidates']):
            raise ValueError('Pair candidates/order/provenance/neutral IDs differ')
    new_ids = [row['context']['exampleId'] for row in appended]
    if len(set(new_ids)) != 4 or set(new_ids) & parents.keys():
        raise ValueError('Distinct appended annotation IDs required')
    dataset = parent_bytes + b''.join(compact(row) + b'\n' for row in appended)
    parsed = [json.loads(line) for line in dataset.split(b'\n')[:-1]]
    if dataset[:len(parent_bytes)] != parent_bytes or compact(parsed[:6]) != compact(originals):
        raise ValueError('Exact original-byte prefix failed')
    for before, after in zip(appended, parsed[6:]):
        if compact(before) != compact(after):
            raise ValueError('Appended row serialization changed')
        verify_format(after, schema, legacy, allowed_pairs)
    # Integrity recheck only the explicitly listed input authorities, not source inventories.
    if sha(ASSIGNMENT.read_bytes()) != ASSIGNMENT_SHA:
        raise ValueError('Assignment changed during preparation')
    for name, info in authority_pins.items():
        pin_bytes(Path(info['path']), info['physicalSha256'], info['bytes'])
    counts = {'originalRows': 6, 'appendedRows': 4, 'outputRows': 10, 'pairs': 2,
              'newSupportedSelections': 2, 'newQualifiedEmptySelections': 2,
              'newCandidateAppearances': 22, 'newSelectedAppearances': 2,
              'selectedJustifications': 2, 'excludedJustifications': 20,
              'uniqueChosenCandidates': 11, 'chosenOriginalSourceHashes': 2,
              'totalCandidateAppearances': sum(len(row['context']['candidates']) for row in parsed),
              'totalSelectedAppearances': sum(len(row['output']['selected']) for row in parsed),
              'totalEmptySelections': sum(not row['output']['selected'] for row in parsed)}
    rows_value = {'version': 'ml-distill-support-pair-rows/2', 'rowHashConvention': 'raw JSONL UTF-8 payload excluding LF',
                  'rows': row_receipts}
    source_value = {'version': 'ml-distill-support-pair-source-receipt/2', 'rows': support_rows,
                    'qualification': 'Supplied accepted fragments only; originals were neither re-extracted nor requalified'}
    data_path = run_dir / 'train-teacher-fragments-v2.jsonl'
    writes = ((data_path, dataset), (run_dir / 'rows-v2.receipt.json', payload(rows_value)),
              (run_dir / 'source-support-v2.receipt.json', payload(source_value)))
    if REPORT.exists():
        raise ValueError('Existing v2 repository report must be retained; do not replace a completed run')
    run_dir.mkdir()
    for path, data in writes:
        immutable_artifact(path, data)
        if pin(path) != {'bytes': len(data), 'sha256': sha(data)}:
            raise ValueError('Private artifact readback mismatch')
    artifacts = [{'path': path.as_posix(), 'bytes': len(data), 'physicalSha256': sha(data)} for path, data in writes]
    finished = now()
    execution = {'argv': [Path(sys.executable).as_posix(), *sys.orig_argv[1:]],
                 'cwd': Path.cwd().as_posix(), 'startedAtUtc': started, 'endedAtUtc': finished, 'exitCode': 0,
                 'python': sys.version.split()[0], 'mode': 'stdlib_cpu_data_only',
                 'explicitCompile': {'method': 'built-in compile() of changed producer only',
                                     'startedAtUtc': compile_started, 'endedAtUtc': compiled, 'exitCode': 0},
                 'bytecodeDisabled': True}
    gaps = ['No new missing/absent/null/withheld state labels are warranted by these chosen fragments',
            'No square-metre unit or explicit current approval is established in the respective supplied contexts',
            'Empty selection is context-limited; unobserved original/property contents are not classified',
            'OCR/native provenance and uncertainty remain; no independent truth, source requalification or model result']
    check = {'version': 'ml-distill-support-pair-check/2', 'status': 'passed_compact_cpu_check',
             'provenance': provenance, 'authorities': authority_pins, 'counts': counts, 'artifacts': artifacts,
             'prefix': {'bytes': len(parent_bytes), 'physicalSha256': sha(dataset[:len(parent_bytes)]), 'exact': True},
             'verification': {'newRowsChecked': 4, 'pairsInputIdentical': 2, 'chosenParentContextsChecked': 2,
                              'allOriginalRowBytesPreserved': 6, 'allNewTargetsCurrentContextBound': True,
                              'sourceDecisionRows': 22, 'acceptedCodecApplied': False},
             'execution': execution, 'gaps': gaps}
    check_path = run_dir / 'check-v2.receipt.json'
    check_bytes = payload(check)
    immutable_artifact(check_path, check_bytes)
    if pin(check_path) != {'bytes': len(check_bytes), 'sha256': sha(check_bytes)}:
        raise ValueError('Final check receipt readback mismatch')
    result = {'version': 'ml-distill-teacher-support-pairs/2', 'recordedAtUtc': now(),
              'status': 'provisional_synthetic_supervision', 'reviewState': 'needs_independent_review',
              'sarvamDerived': False, 'provenance': provenance, 'parent': authority_pins['originalTrainingData'],
              'counts': counts, 'newRows': row_receipts, 'artifacts': artifacts + [
                  {'path': check_path.as_posix(), 'bytes': len(check_bytes), 'physicalSha256': sha(check_bytes)}],
              'execution': execution, 'gaps': gaps, 'suppliedPermissions': {'approvalPolicy': 'never', 'sandboxMode': 'danger-full-access'},
              'workerSettings': assignment['workerSettings'], 'dataReviewRequiredBeforeLearnerAdmissionOrFit': True}
    immutable_artifact(REPORT, payload(result))
    print(json.dumps(result))


if __name__ == '__main__':
    main()
