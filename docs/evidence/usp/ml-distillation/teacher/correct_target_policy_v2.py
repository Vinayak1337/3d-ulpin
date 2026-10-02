"""Append the mandatory contract-policy abstention; preserve the v1 teacher seed.

Reads only immutable teacher artifacts and schema. No source, dev/eval, model,
inventory or historical assembler execution is involved.
"""
import copy
import hashlib
import json
from pathlib import Path

from assemble_batch import compact, immutable_artifact, schema_check
from prepare_inventory import OUT, PRIVATE, pin

PARENT_SHA = '71e218b2a13ad26938f0b4ab5f4111125af8530dfbd0a01c0c3b9680f3bfefec'
POLICY = {'code': 'no_canonical_targets', 'citations': []}


def section_hash(value):
    return hashlib.sha256(compact(value)).hexdigest()


def emit_json(path, value):
    immutable_artifact(path, (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8'))


def main():
    parent_manifest_path = OUT / 'batch-v1.manifest.json'
    parent_manifest = json.loads(parent_manifest_path.read_text(encoding='utf-8'))
    parent_path = PRIVATE / 'train-teacher-v1.jsonl'
    parent_bytes = parent_path.read_bytes()
    if hashlib.sha256(parent_bytes).hexdigest() != PARENT_SHA:
        raise ValueError('Immutable v1 parent hash mismatch')
    retained_pins = {}
    for artifact in parent_manifest['artifacts']:
        observed = pin(artifact['path'])
        if observed != {key: artifact[key] for key in ('bytes', 'sha256')}:
            raise ValueError('Existing v1 artifact pin mismatch')
        retained_pins[artifact['path']] = observed
    schema_path = PRIVATE / 'contracts' / 'schema-v1.json'
    if pin(schema_path)['sha256'] != parent_manifest['contractPins']['schema']:
        raise ValueError('Existing coordinator schema pin mismatch')
    schema = json.loads(schema_path.read_text(encoding='utf-8'))
    parents = [json.loads(line) for line in parent_bytes.splitlines()]
    if len(parents) != 11 or any(compact(row) != line for row, line in zip(parents, parent_bytes.splitlines())):
        raise ValueError('Expected the 11 canonical compact-UTF8 v1 records')
    records, preservation, added = [], [], 0
    for parent in parents:
        record = copy.deepcopy(parent)
        old_abstentions = parent['output']['abstentions']
        if not any(item['code'] == POLICY['code'] for item in old_abstentions):
            record['output']['abstentions'].append(copy.deepcopy(POLICY))
            added += 1
        if sum(item == POLICY for item in record['output']['abstentions']) != 1:
            raise ValueError('Expected exactly one empty-citation no-target policy per output')
        correction = {'version': 'ml-distill-target-policy-correction/2',
                      'parentDataSha256': PARENT_SHA, 'policy': POLICY,
                      'authority': 'ML coordinator TEACHER-02 training-target feedback',
                      'method': 'deterministic_contract_policy',
                      'scope': 'No canonical targets/crosswalk in this frozen seed; not a new sourced fact.'}
        record['supervision']['targetPolicyCorrection'] = correction
        schema_check(record['input'], schema['$defs']['input'], schema)
        schema_check(record['output'], schema['$defs']['output'], schema)
        preserved_sections = {
            'input': (parent['input'], record['input']),
            'claims': (parent['output']['claims'], record['output']['claims']),
            'conflicts': (parent['output']['conflicts'], record['output']['conflicts']),
            'existingAbstentions': (old_abstentions, record['output']['abstentions'][:len(old_abstentions)]),
            'sourceLineage': (parent['supervision']['sourceLineage'], record['supervision']['sourceLineage']),
        }
        hashes = {}
        for name, (before, after) in preserved_sections.items():
            if before != after or compact(before) != compact(after):
                raise ValueError(f'Unexpected changed section: {name}')
            hashes[name] = section_hash(before)
        if record['output']['canonicalLinks'] != parent['output']['canonicalLinks'] or record['output']['canonicalLinks'] != []:
            raise ValueError('Canonical links changed')
        original_supervision = copy.deepcopy(record['supervision'])
        del original_supervision['targetPolicyCorrection']
        if original_supervision != parent['supervision']:
            raise ValueError('Original supervision changed')
        expected_output = copy.deepcopy(parent['output'])
        if not any(item['code'] == POLICY['code'] for item in old_abstentions):
            expected_output['abstentions'].append(copy.deepcopy(POLICY))
        if record['output'] != expected_output:
            raise ValueError('Output changed beyond the policy append')
        preservation.append({'exampleId': parent['input']['exampleId'],
                             'unchangedSectionSha256': hashes,
                             'inputClaimsConflictsExistingAbstentionsLineageUnchanged': True,
                             'canonicalLinksEmpty': True})
        records.append(record)
    data_path = PRIVATE / 'train-teacher-v2.jsonl'
    immutable_artifact(data_path, b''.join(compact(record) + b'\n' for record in records))
    for path, expected in retained_pins.items():
        if pin(path) != expected:
            raise ValueError('Historical artifact changed during correction')
    code_pins = {name: hashlib.sha256((OUT / name).read_bytes().replace(b'\r\n', b'\n')).hexdigest()
                 for name in ['correct_target_policy_v2.py', 'assemble_batch.py', 'prepare_inventory.py']}
    for name in ('assemble_batch.py', 'prepare_inventory.py'):
        if code_pins[name] != parent_manifest['codePins'][name]:
            raise ValueError('Historical checker/assembler code changed')
    receipt = {'version': 'ml-teacher-target-policy-validation/2', 'parentDataSha256': PARENT_SHA,
               'targetPolicy': POLICY, 'addedPolicyAbstentions': added,
               'mandatoryPolicyPresent': sum(POLICY in r['output']['abstentions'] for r in records),
               'examples': len(records), 'claims': sum(len(r['output']['claims']) for r in records),
               'conflicts': sum(len(r['output']['conflicts']) for r in records),
               'existingAbstentions': sum(len(r['output']['abstentions']) for r in parents),
               'abstentions': sum(len(r['output']['abstentions']) for r in records),
               'preservation': preservation, 'historicalArtifactPinsUnchanged': retained_pins,
               'dataArtifact': {'path': str(data_path), **pin(data_path)}, 'codePins': code_pins,
               'schemaSha256': parent_manifest['contractPins']['schema'],
               'comparisonConvention': 'Both semantic equality and canonical compact-UTF8 section bytes; v1 lines are verified canonical.',
               'sourceInventoryOrInterpretationRun': False, 'developmentEvaluationAccess': False,
               'qualification': 'deterministic training-target policy correction; provisional supervision remains unqualified'}
    receipt_path = PRIVATE / 'target-policy-v2.receipt.json'
    emit_json(receipt_path, receipt)
    manifest = {'version': 'ml-distill-teacher-batch/2', 'createdDate': '2026-10-02',
                'status': parent_manifest['status'], 'split': 'train',
                'familyIds': parent_manifest['familyIds'], 'contractPins': parent_manifest['contractPins'],
                'parent': {'dataPath': str(parent_path), 'dataSha256': PARENT_SHA,
                           'manifestPath': str(parent_manifest_path), **pin(parent_manifest_path)},
                'targetPolicyCorrection': correction, 'examples': len(records), 'claims': receipt['claims'],
                'conflicts': receipt['conflicts'], 'abstentions': receipt['abstentions'],
                'mandatoryPolicyPresent': receipt['mandatoryPolicyPresent'], 'rejects': parent_manifest['rejects'],
                'codePins': code_pins, 'codeHashConvention': 'canonical LF; data/original artifacts remain raw',
                'artifacts': [{'path': str(path), **pin(path)} for path in (data_path, receipt_path)],
                'reusedUnchangedV1Artifacts': parent_manifest['artifacts'][1:],
                'reviewState': parent_manifest['reviewState'], 'teacher': parent_manifest['teacher'],
                'qualification': parent_manifest['qualification'], 'evaluationAccess': False,
                'devRawAccess': False, 'sourceSpecificLaunchClearance': parent_manifest['sourceSpecificLaunchClearance']}
    emit_json(OUT / 'batch-v2.manifest.json', manifest)
    print(json.dumps({'examples': len(records), 'claims': receipt['claims'], 'conflicts': receipt['conflicts'],
                      'mandatoryPolicyPresent': receipt['mandatoryPolicyPresent'], 'added': added,
                      'dataSha256': pin(data_path)['sha256'], 'codeSha256': code_pins['correct_target_policy_v2.py'],
                      'receiptSha256': pin(receipt_path)['sha256']}))


if __name__ == '__main__':
    main()
