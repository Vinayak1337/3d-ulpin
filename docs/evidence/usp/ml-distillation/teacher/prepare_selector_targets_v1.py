"""TEACHER-04: losslessly re-encode the 11 accepted v2 train targets, CPU only.

Preserves source input and provisional supervision; only output representation
and explicit selectorProjection provenance change in a new immutable dataset.
The independent decoder consumes raw selectors and re-lexes source text itself.
"""
import copy
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

from assemble_batch import compact, immutable_artifact
from augment_citation_views_v3 import counts, validate_row
from decode_selector_targets_v1 import MISSING_STATES, SelectorFailure, decode_output
from prepare_inventory import OUT, PRIVATE, ROOT, pin

CHECKPOINT = '1b877bada13447f88727be50803707366625b340'
WORKER_BASE = '89f28e129a92065831b4c751faeccdd45a49fffd'
COORDINATOR = Path('C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin')
ASSIGNMENT_REL = 'docs/evidence/usp/ml-distillation/teacher-04.selector-targets.assignment.json'
ASSIGNMENT_SHA = '85891272c8083094c22356815d701e45326d11a203a595decebea75472d06f04'
SELECTOR_SCHEMA_REL = 'scripts/usp/learning/association/selector-schema-v1.json'
SELECTOR_SCHEMA_SHA = 'dcc129e1c1600e583f6b7792a6ad5f1cf5e14ba206cde5a53df81bdfa14e07f4'
PARENT_SHA = '7510a7040afb7bec2bba9422eb5e14bbf0664c927bd0c2b24989c1af6dc7674c'
POLICY_VERSION = 'lossless_lexical_spans/1'
PATTERN = r'\w+|\s+|[^\w\s]'
FAMILIES = {'in-haryana-rera-2831', 'in-bihar-magnolia-residency'}
DATA_PATH = PRIVATE / 'train-teacher-selectors-v1.jsonl'
MAPPING_PATH = PRIVATE / 'selector-targets-v1.mapping.json'
RECEIPT_PATH = PRIVATE / 'selector-targets-v1.receipt.json'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def lf_bytes(path):
    return Path(path).read_bytes().replace(b'\r\n', b'\n')


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8')


def git_blob(root, commit, relative):
    return subprocess.check_output(['git', 'show', f'{commit}:{relative}'], cwd=root)


def load_pinned_inputs():
    assignment_bytes = git_blob(COORDINATOR, CHECKPOINT, ASSIGNMENT_REL)
    if digest(assignment_bytes) != ASSIGNMENT_SHA or lf_bytes(COORDINATOR / ASSIGNMENT_REL) != assignment_bytes:
        raise ValueError('Pinned TEACHER-04 assignment changed')
    assignment = json.loads(assignment_bytes)
    if (assignment['task'] != 'TEACHER-04' or assignment['workerCodeBase'] != WORKER_BASE
            or assignment['parentSha256'] != PARENT_SHA
            or Path(assignment['workerWorktree']).resolve() != ROOT.resolve()
            or Path(assignment['parentDataset']).resolve() != (PRIVATE / 'train-teacher-v2.jsonl').resolve()
            or Path(assignment['outputDataset']).resolve() != DATA_PATH.resolve()
            or assignment['selectorPolicy']['version'] != POLICY_VERSION
            or assignment['selectorPolicy']['pattern'] != PATTERN):
        raise ValueError('Assignment/lexer/worktree does not match the pinned task')
    branch = subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT).decode().strip()
    if branch != assignment['branch']:
        raise ValueError('Teacher branch changed')
    subprocess.run(['git', 'merge-base', '--is-ancestor', WORKER_BASE, 'HEAD'], cwd=ROOT, check=True)
    selector_bytes = git_blob(COORDINATOR, CHECKPOINT, SELECTOR_SCHEMA_REL)
    if (digest(selector_bytes) != SELECTOR_SCHEMA_SHA
            or assignment['selectorSchemaCanonicalLfSha256'] != SELECTOR_SCHEMA_SHA
            or lf_bytes(assignment['selectorSchema']) != selector_bytes):
        raise ValueError('Frozen selector schema mismatch')
    selector_schema = json.loads(selector_bytes)
    # Every historical teacher file must still match the clean assigned checkpoint.
    historical_files = {}
    owned = 'docs/evidence/usp/ml-distillation/teacher'
    names = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', WORKER_BASE, owned], cwd=ROOT).decode().splitlines()
    for name in names:
        expected = git_blob(ROOT, WORKER_BASE, name)
        if lf_bytes(ROOT / name) != expected:
            raise ValueError(f'Historical teacher file changed: {name}')
        historical_files[name] = digest(expected)
    manifests = [json.loads((OUT / f'batch-v{i}.manifest.json').read_bytes()) for i in (1, 2, 3)]
    manifest = manifests[1]
    retained = {}
    for old_manifest in manifests:
        for artifact in old_manifest['artifacts'] + old_manifest.get('reusedUnchangedV1Artifacts', []):
            path = Path(artifact['path'])
            if not path.resolve().is_relative_to(PRIVATE.resolve()):
                raise ValueError('Historical artifact escapes the private teacher root')
            expected = {key: artifact[key] for key in ('bytes', 'sha256')}
            if pin(path) != expected:
                raise ValueError(f'Historical teacher artifact changed: {path}')
            retained[path.as_posix()] = expected
    if retained[(PRIVATE / 'train-teacher-v2.jsonl').as_posix()] != {'bytes': 70333, 'sha256': PARENT_SHA}:
        raise ValueError('Accepted v2 parent pin mismatch')
    for name, sha in manifests[2]['codePins'].items():
        if Path(name).name != name or digest(lf_bytes(OUT / name)) != sha:
            raise ValueError('Historical assembler/checker code pin mismatch')
    contracts = {}
    for name, relative, public_path in [
            ('schema', 'scripts/usp/learning/association/schema-v1.json', assignment['originalSchema']),
            ('freeze', 'docs/evidence/usp/ml-distillation/family-freeze.json', assignment['familyFreeze'])]:
        blob = git_blob(COORDINATOR, CHECKPOINT, relative)
        path = PRIVATE / 'contracts' / f'{name}-v1.json'
        if (digest(blob) != manifest['contractPins'][name] or lf_bytes(public_path) != blob
                or path.read_bytes() != blob):
            raise ValueError(f'Original frozen {name} changed')
        retained[path.as_posix()] = pin(path)
        contracts[name] = json.loads(blob)
    freeze = contracts['freeze']
    if ({item['familyId'] for item in freeze['families'] if item['split'] == 'train'} != FAMILIES
            or freeze['schemaSha256'] != manifest['contractPins']['schema']):
        raise ValueError('Source-family/schema freeze changed')
    train_sources = {source['sourceId']: source for source in freeze['sources'] if source['split'] == 'train'}
    provenance = {'task': 'TEACHER-04', 'version': assignment['version'],
                  'assignmentPath': (COORDINATOR / ASSIGNMENT_REL).as_posix(),
                  'assignmentCommit': CHECKPOINT, 'assignmentCanonicalLfSha256': ASSIGNMENT_SHA,
                  'workerBaseCommit': WORKER_BASE}
    return assignment, manifest, contracts['schema'], selector_schema, selector_bytes, train_sources, retained, historical_files, provenance


class UnrepresentableTarget(ValueError):
    def __init__(self, example_id, pointer):
        super().__init__(f'No unchanged lexical span for {example_id} {pointer}')
        self.detail = {'exampleId': example_id, 'outputPointer': pointer,
                       'reason': 'No exact aligned span under the fixed lexer; no target dropped or lexer changed'}


def encoder_lex(model_input, pattern):
    """Build encoder-only token strings, offsets and boundary maps."""
    fragments = []
    for index, fragment in enumerate(model_input['evidence']):
        matches = list(re.compile(pattern, re.UNICODE).finditer(fragment['text']))
        if (''.join(match.group() for match in matches) != fragment['text']
                or any(match.start() != (matches[i - 1].end() if i else 0)
                       for i, match in enumerate(matches))):
            raise ValueError('Encoder lexer does not partition the exact source string')
        offsets = [[match.start(), match.end()] for match in matches]
        fragments.append({'ordinal': index, 'tokens': [match.group() for match in matches],
                          'offsets': offsets, 'starts': {start: i for i, (start, _) in enumerate(offsets)},
                          'ends': {end: i + 1 for i, (_, end) in enumerate(offsets)}})
    return fragments


def first_aligned(fragment, text, value, lower=0, upper=None):
    """Earliest exact occurrence aligned to both token boundaries, no repair."""
    upper = len(text) if upper is None else upper
    cursor = lower
    while cursor <= upper:
        start = text.find(value, cursor, upper)
        if start == -1:
            return None
        end = start + len(value)
        if start in fragment['starts'] and end in fragment['ends']:
            return [fragment['ordinal'], fragment['starts'][start], fragment['ends'][end]], [start, end]
        cursor = start + 1
    return None


def encode_parent(parent, pattern):
    model_input, original = parent['input'], parent['output']
    lexed = encoder_lex(model_input, pattern)
    by_key = {fragment['key']: i for i, fragment in enumerate(model_input['evidence'])}
    if len(by_key) != len(lexed):
        raise ValueError('Duplicate original fragment keys')
    encoded = copy.deepcopy(original)
    encoded['version'] = 'evidence-association-selectors/1'
    pointers = []

    def remember(path, span, value, support=None):
        selector, offsets = span
        entry = {'outputPointer': path, 'selector': selector, 'codepointOffsets': offsets,
                 'exactSliceSha256': digest(value.encode('utf-8'))}
        if support is not None:
            entry['supportedByCitationPointer'] = support
        pointers.append(entry)
        return selector

    for section in ('claims', 'conflicts', 'abstentions'):
        for i, old in enumerate(original[section]):
            path = f'/{section}/{i}'
            quote_spans = []
            encoded[section][i]['citations'] = []
            for j, citation in enumerate(old['citations']):
                ordinal = by_key[citation['key']]
                span = first_aligned(lexed[ordinal], model_input['evidence'][ordinal]['text'], citation['quote'])
                if span is None:
                    raise UnrepresentableTarget(model_input['exampleId'], path + '/citations/' + str(j))
                quote_spans.append(span)
                encoded[section][i]['citations'].append(remember(path + '/citations/' + str(j), span, citation['quote']))
            if section == 'claims':
                for field in ('literal', 'unit'):
                    value = old[field]
                    if value is None:
                        continue
                    if old['state'] in MISSING_STATES:
                        raise ValueError('Missing-state literal/unit cannot be represented as a value')
                    for j, (quote_selector, quote_offsets) in enumerate(quote_spans):
                        ordinal = quote_selector[0]
                        span = first_aligned(lexed[ordinal], model_input['evidence'][ordinal]['text'], value,
                                             quote_offsets[0], quote_offsets[1])
                        if span is not None:
                            encoded[section][i][field] = remember(path + '/' + field, span, value,
                                                                 path + '/citations/' + str(j))
                            break
                    else:
                        raise UnrepresentableTarget(model_input['exampleId'], path + '/' + field)
    fragments = []
    for fragment, tokens in zip(model_input['evidence'], lexed):
        fragments.append({'fragmentOrdinal': tokens['ordinal'],
                          **{key: copy.deepcopy(fragment[key]) for key in ('key', 'familyId', 'sourceSha256', 'method', 'locator')},
                          'textUtf8Sha256': digest(fragment['text'].encode('utf-8')),
                          'lexicalTokens': tokens['tokens'], 'codepointOffsets': tokens['offsets']})
    return encoded, {'exampleId': model_input['exampleId'], 'fragments': fragments, 'pointers': pointers}


def strict_recovery(parent, raw_parent, record, expanded):
    restored = copy.deepcopy(record)
    restored['output'] = expanded
    del restored['supervision']['selectorProjection']
    if compact(restored) != raw_parent:
        raise ValueError('Type-sensitive exact parent row recovery failed')
    if record['supervision']['augmentation'] is not parent['supervision']['augmentation']:
        raise ValueError('Representation projection changed augmentation state')
    return {'exampleId': parent['input']['exampleId'], 'rawParentRowSha256': digest(raw_parent),
            'recoveredRowSha256': digest(compact(restored)), 'inputSha256': digest(compact(parent['input'])),
            'outputSha256': digest(compact(expanded)),
            'supervisionWithoutProjectionSha256': digest(compact(restored['supervision'])), 'exact': True}


def corruption_controls(parents, records, decoder):
    results = []

    def reject(name, parent, raw, expected_stage, changed_input=None):
        try:
            decoder(parent, raw, changed_input)
        except SelectorFailure as error:
            if error.detail['stage'] != expected_stage:
                raise ValueError(f'{name} rejected for an unexpected stage') from error
            results.append({'control': name, 'rawOutputSha256': digest(raw), 'rejectedEntireResponse': True,
                            'error': error.detail})
        else:
            raise ValueError(f'Corruption accepted: {name}')

    first = records[0]['output']
    out_of_bounds = copy.deepcopy(first)
    out_of_bounds['claims'][0]['citations'][0][0] = len(parents[0]['input']['evidence'])
    reject('fragment_pointer_out_of_bounds', parents[0], compact(out_of_bounds), 'selector_range')
    token_end = copy.deepcopy(first)
    quote = token_end['claims'][0]['citations'][0]
    quote[2] = len(encoder_lex(parents[0]['input'], PATTERN)[quote[0]]['tokens']) + 1
    reject('exclusive_token_end_out_of_bounds', parents[0], compact(token_end), 'selector_range')
    boolean = copy.deepcopy(first)
    boolean['claims'][0]['citations'][0][0] = False
    reject('bool_is_not_an_int_ordinal', parents[0], compact(boolean), 'selector_schema')
    duplicate = b'{"version":"evidence-association-selectors/1",' + compact(first)[1:]
    reject('duplicate_raw_json_member', parents[0], duplicate, 'raw_json')
    floor = next(i for i, row in enumerate(parents) if row['input']['exampleId'] == 'teacher-haryana-floor02')
    binding = copy.deepcopy(records[floor]['output'])
    building_quote = next(claim for claim in binding['claims'] if claim['role'] == 'building')['citations'][0]
    next(claim for claim in binding['claims'] if claim['role'] == 'drawing')['citations'][0] = building_quote[:]
    reject('caption_literal_with_tower_only_citation', parents[floor], compact(binding), 'expanded_validation')
    drift = copy.deepcopy(parents[0]['input'])
    drift['evidence'][0]['text'] += ' '
    reject('source_text_drift', parents[0], compact(first), 'source_drift', drift)
    return results


def main():
    if not sys.dont_write_bytecode:
        raise ValueError('Use python -B; no new bytecode files are allowed')
    (assignment, manifest, original_schema, selector_schema, selector_bytes,
     train_sources, retained, historical_files, provenance) = load_pinned_inputs()
    parent_bytes = (PRIVATE / 'train-teacher-v2.jsonl').read_bytes()
    if digest(parent_bytes) != PARENT_SHA or not parent_bytes.endswith(b'\n'):
        raise ValueError('Pinned v2 parent hash/LF mismatch')
    raw_rows = parent_bytes.split(b'\n')[:-1]
    parents = [json.loads(raw) for raw in raw_rows]
    if len(parents) != 11 or any(compact(row) != raw for row, raw in zip(parents, raw_rows)):
        raise ValueError('Expected 11 exact canonical compact-UTF8 parent rows')
    code_pins = {name: digest(lf_bytes(OUT / name)) for name in
                 ('prepare_selector_targets_v1.py', 'decode_selector_targets_v1.py')}
    for parent in parents:
        validate_row(parent, original_schema, train_sources, manifest['contractPins'])
        # Source bytes are hashed only for integrity; no extraction or inventory runs.
        for source in parent['supervision']['sourceLineage']:
            path = Path(source['originalPath'])
            if path.as_posix() not in retained:
                observed = pin(path)
                if observed['sha256'] != source['sourceSha256']:
                    raise ValueError('Pinned original source hash mismatch')
                retained[path.as_posix()] = observed

    def decode(parent, raw, changed_input=None):
        model_input = parent['input'] if changed_input is None else changed_input

        def original_validation(output):
            row = {'input': model_input, 'output': output, 'supervision': parent['supervision']}
            validate_row(row, original_schema, train_sources, manifest['contractPins'])

        return decode_output(raw, model_input, assignment['selectorPolicy']['pattern'], selector_schema,
                             original_schema, digest(compact(parent['input'])), original_validation)

    records, mappings, recoveries = [], [], []
    for parent, raw_parent in zip(parents, raw_rows):
        encoded, mapping = encode_parent(parent, assignment['selectorPolicy']['pattern'])
        mapping_sha = digest(compact(mapping))
        projection = {'version': 'ml-distill-selector-projection/1', 'policyVersion': POLICY_VERSION,
                      'parentDatasetPath': (PRIVATE / 'train-teacher-v2.jsonl').as_posix(),
                      'parentDatasetSha256': PARENT_SHA, 'parentRawRowSha256': digest(raw_parent),
                      'rowHashConvention': 'raw UTF-8 JSONL payload excluding LF terminator',
                      'originalSchemaSha256': manifest['contractPins']['schema'],
                      'selectorSchemaSha256': SELECTOR_SCHEMA_SHA, 'codecCanonicalLfSha256': code_pins,
                      'mappingPath': MAPPING_PATH.as_posix(), 'mappingExampleId': parent['input']['exampleId'],
                      'mappingRowCompactSha256': mapping_sha, 'assignment': provenance}
        record = copy.deepcopy(parent)
        if 'selectorProjection' in record['supervision']:
            raise ValueError('Parent already contains selectorProjection provenance')
        record['output'] = encoded
        record['supervision']['selectorProjection'] = projection
        expanded = decode(parent, compact(encoded))
        recoveries.append(strict_recovery(parent, raw_parent, record, expanded))
        mappings.append(mapping)
        records.append(record)
    controls = corruption_controls(parents, records, decode)
    dataset = b''.join(compact(row) + b'\n' for row in records)
    roundtrip_rows = [json.loads(raw) for raw in dataset.split(b'\n')[:-1]]
    if compact(roundtrip_rows) != compact(records):
        raise ValueError('Selector dataset serialization changed exact JSON types')
    for parent, raw_parent, record in zip(parents, raw_rows, roundtrip_rows):
        strict_recovery(parent, raw_parent, record, decode(parent, compact(record['output'])))
    denominators = counts(parents)
    if {key: denominators[key] for key in ('rows', 'claimAppearances', 'conflictAppearances', 'abstentionAppearances', 'noCanonicalTargets')} != {
            'rows': 11, 'claimAppearances': 62, 'conflictAppearances': 2, 'abstentionAppearances': 22, 'noCanonicalTargets': 11}:
        raise ValueError('Accepted parent denominators changed')
    pointers = [pointer for row in mappings for pointer in row['pointers']]
    quote_count = sum('/citations/' in pointer['outputPointer'] for pointer in pointers)
    value_count = len(pointers) - quote_count
    if (quote_count, value_count) != (84, 58):
        raise ValueError('Accepted quote/literal/unit denominators changed')
    for path, expected in retained.items():
        if pin(path) != expected:
            raise ValueError('Historical/source artifact changed during projection')
    for name, expected in historical_files.items():
        if digest(lf_bytes(ROOT / name)) != expected:
            raise ValueError('Historical teacher file changed during projection')
    mapping_value = {'version': 'ml-distill-selector-mapping/1', 'policy': assignment['selectorPolicy'],
                     'parentDatasetSha256': PARENT_SHA, 'datasetSha256': digest(dataset), 'rows': mappings}
    mapping_bytes = json_bytes(mapping_value)
    artifacts = [{'path': DATA_PATH.as_posix(), 'bytes': len(dataset), 'sha256': digest(dataset)},
                 {'path': MAPPING_PATH.as_posix(), 'bytes': len(mapping_bytes), 'sha256': digest(mapping_bytes)},
                 {'path': (PRIVATE / 'contracts' / 'selector-schema-v1.json').as_posix(),
                  'bytes': len(selector_bytes), 'sha256': digest(selector_bytes)}]
    receipt = {'version': 'ml-distill-selector-target-receipt/1', 'recordedAt': '2026-10-03',
               'status': 'passed_lossless_train_projection', 'assignment': provenance, 'policyVersion': POLICY_VERSION,
               'originalContractPins': manifest['contractPins'], 'selectorSchemaSha256': SELECTOR_SCHEMA_SHA,
               'codePinsCanonicalLf': code_pins, 'counts': denominators, 'quoteSelectors': quote_count,
               'nonNullLiteralUnitSelectors': value_count, 'syntaxValidRows': 11, 'expandedOutputValidRows': 11,
               'exactParentRecoveryRows': 11, 'claimCredit': 'not_scored; no model responses',
               'recovery': recoveries, 'corruptionControls': controls, 'artifacts': artifacts,
               'retainedRawPinsBeforeAndAfter': retained, 'historicalTeacherFilesCanonicalLfBeforeAndAfter': historical_files,
               'execution': {'command': f'& "{Path(sys.executable).as_posix()}" -B "{Path(__file__).as_posix()}"',
                             'workingDirectory': ROOT.as_posix(), 'python': sys.version.split()[0], 'mode': 'cpu_only',
                             'validationCompleted': True, 'bytecodeDisabled': True},
               'qualification': 'Lossless representation of the same provisional training labels; no new facts or measured quality gain',
               'modelInputBoundaryContract': 'Student must expose only fragment ordinals and ordered source lexical strings; teacher does not implement or verify its prompt',
               'preserved': ['original input/sample IDs/source lineage', 'roles/states/nulls/decision codes/array order',
                             'original supervision including augmentation=false', 'empty canonicalLinks'],
               'scope': {'developmentContent': False, 'evaluationContent': False, 'oldMappingHoldouts': False,
                         'newStudentRawOutputs': False, 'sourceDiscovery': False, 'fitOrInference': False},
               'limits': ['Exact source spans do not prove roles, states, truth, ownership or canonical identity',
                          'No new absent/null-state examples or native IFC inputs', 'No student codec/prompt/interface edits']}
    receipt_bytes = json_bytes(receipt)
    new_manifest = {'version': 'ml-distill-teacher-selectors/1', 'recordedAt': '2026-10-03',
                    'status': manifest['status'], 'split': 'train', 'familyIds': manifest['familyIds'],
                    'parent': {'path': (PRIVATE / 'train-teacher-v2.jsonl').as_posix(), 'bytes': len(parent_bytes), 'sha256': PARENT_SHA},
                    'assignment': provenance, 'policyVersion': POLICY_VERSION,
                    'originalContractPins': manifest['contractPins'], 'selectorSchemaCanonicalLfSha256': SELECTOR_SCHEMA_SHA,
                    'codePinsCanonicalLf': code_pins, 'counts': denominators,
                    'quoteSelectors': quote_count, 'nonNullLiteralUnitSelectors': value_count,
                    'exactParentRecoveryRows': len(recoveries), 'supervisionDelta': ['selectorProjection'],
                    'augmentationUnchanged': True, 'rejectsRetained': manifest['rejects'],
                    'artifacts': artifacts + [{'path': RECEIPT_PATH.as_posix(), 'bytes': len(receipt_bytes), 'sha256': digest(receipt_bytes)}],
                    'reviewState': manifest['reviewState'], 'teacher': manifest['teacher'],
                    'qualification': receipt['qualification'], 'evaluationAccess': False, 'devRawAccess': False,
                    'sourceSpecificLaunchClearance': manifest['sourceSpecificLaunchClearance']}
    outputs = [(DATA_PATH, dataset), (MAPPING_PATH, mapping_bytes), (RECEIPT_PATH, receipt_bytes),
               (PRIVATE / 'contracts' / 'selector-schema-v1.json', selector_bytes),
               (OUT / 'selectors-v1.manifest.json', json_bytes(new_manifest))]
    for path, data in outputs:
        if path.exists() and path.read_bytes() != data:
            raise ValueError(f'Existing selector artifact differs; preserve it and use a new version: {path}')
    for path, data in outputs:
        immutable_artifact(path, data)
        if pin(path) != {'bytes': len(data), 'sha256': digest(data)}:
            raise ValueError('Selector artifact readback mismatch')
    print(json.dumps({'status': receipt['status'], 'counts': denominators, 'quoteSelectors': quote_count,
                      'nonNullLiteralUnitSelectors': value_count, 'exactParentRecoveryRows': len(recoveries),
                      'corruptionControlsRejected': len(controls), 'dataSha256': digest(dataset),
                      'mappingSha256': digest(mapping_bytes), 'receiptSha256': digest(receipt_bytes),
                      'codePinsCanonicalLf': code_pins}))


if __name__ == '__main__':
    try:
        main()
    except UnrepresentableTarget as gap:
        immutable_artifact(PRIVATE / 'selector-targets-v1.gap.json', json_bytes(
            {'task': 'TEACHER-04', 'parentDatasetSha256': PARENT_SHA, 'policyVersion': POLICY_VERSION,
             'gap': gap.detail, 'datasetPublished': False, 'originalsUnchanged': True}))
        raise
