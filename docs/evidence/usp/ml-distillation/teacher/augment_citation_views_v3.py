"""Append deterministic citation views to the immutable accepted v2 train seed.

CPU only. Reads pinned teacher artifacts, contract/freeze metadata and the one
authorized training-feedback hash. Does not instantiate Batch, rerun acquisition,
open held-out content, fit a model, or change any original artifact or label.
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

POLICY_VERSION = 'opaque_keys_reverse_evidence/1'
SUFFIX = '-citation-view01'
PARENT_SHA = '7510a7040afb7bec2bba9422eb5e14bbf0664c927bd0c2b24989c1af6dc7674c'
PARENT_MANIFEST_SHA = '980849555c6f79466a7590fabfb053725981d25f45b34acc763cbcac900696fe'
ASSIGNMENT_COMMIT = '334467e30cd648a83aec3bec84140bf974b0a5f4'
ASSIGNMENT_SHA = 'e5cfa3cadb6b547ec14d03b24513963e28259f9c3b8efa1a3caa0aa9d1232244'
COORDINATOR_ROOT = Path('C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin')
ASSIGNMENT_RELATIVE = 'docs/evidence/usp/ml-distillation/teacher-03.citation-view.assignment.json'
EXPECTED_FAMILIES = {'in-haryana-rera-2831', 'in-bihar-magnolia-residency'}
NO_TARGETS = {'code': 'no_canonical_targets', 'citations': []}
SECTIONS = ('claims', 'conflicts', 'abstentions')
ROW_HASH_CONVENTION = 'raw UTF-8 JSONL row payload, excluding its LF terminator'


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def canonical_lf(path):
    return Path(path).read_bytes().replace(b'\r\n', b'\n')


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8')


def verify_pins():
    """Hash historical artifacts; do not reopen their sources or predictions."""
    manifest_path = OUT / 'batch-v2.manifest.json'
    if sha256(canonical_lf(manifest_path)) != PARENT_MANIFEST_SHA:
        raise ValueError('Pinned v2 manifest changed')
    manifest = json.loads(manifest_path.read_bytes())
    assignment_path = COORDINATOR_ROOT / ASSIGNMENT_RELATIVE
    assignment_bytes = canonical_lf(assignment_path)
    assignment_blob = subprocess.check_output(
        ['git', 'show', f'{ASSIGNMENT_COMMIT}:{ASSIGNMENT_RELATIVE}'],
        cwd=COORDINATOR_ROOT)
    if assignment_bytes != assignment_blob or sha256(assignment_bytes) != ASSIGNMENT_SHA:
        raise ValueError('Pinned TEACHER-03 assignment changed')
    assignment = json.loads(assignment_bytes)
    if (assignment['task'] != 'TEACHER-03'
            or assignment['augmentationPolicy']['version'] != POLICY_VERSION
            or assignment['augmentationPolicy']['parentRows'] != 11
            or assignment['augmentationPolicy']['variantRows'] != 11
            or assignment['augmentationPolicy']['outputRows'] != 22
            or assignment['parentSha256'] != PARENT_SHA
            or Path(assignment['workerWorktree']).resolve() != ROOT.resolve()
            or Path(assignment['parentDataset']).resolve() != (PRIVATE / 'train-teacher-v2.jsonl').resolve()
            or Path(assignment['outputDataset']).resolve() != (PRIVATE / 'train-teacher-v3.jsonl').resolve()):
        raise ValueError('Assignment does not match this pinned transformation/worktree')
    branch = subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT).decode().strip()
    if branch != assignment['branch']:
        raise ValueError('Teacher worktree branch changed')
    subprocess.run(['git', 'merge-base', '--is-ancestor', assignment['workerCodeBase'], 'HEAD'],
                   cwd=ROOT, check=True)
    old_manifest_path = Path(manifest['parent']['manifestPath'])
    old_manifest_pin = pin(old_manifest_path)
    if old_manifest_pin != {key: manifest['parent'][key] for key in ('bytes', 'sha256')}:
        raise ValueError('Historical v1 manifest pin mismatch')
    old_manifest = json.loads(old_manifest_path.read_bytes())
    artifacts = old_manifest['artifacts'] + manifest['artifacts'] + manifest['reusedUnchangedV1Artifacts']
    retained = {}
    for artifact in artifacts:
        path = Path(artifact['path'])
        if not path.resolve().is_relative_to(PRIVATE.resolve()):
            raise ValueError('Historical artifact is outside the private teacher root')
        observed = pin(path)
        if observed != {key: artifact[key] for key in ('bytes', 'sha256')}:
            raise ValueError(f'Historical teacher artifact pin mismatch: {path}')
        retained[path.as_posix()] = observed
    if retained[(PRIVATE / 'train-teacher-v2.jsonl').as_posix()] != {
            'bytes': 70333, 'sha256': PARENT_SHA}:
        raise ValueError('Expected immutable 70,333-byte v2 parent')
    code_pins = {}
    for name, expected in manifest['codePins'].items():
        if Path(name).name != name:
            raise ValueError('Historical code pin escapes teacher directory')
        observed = sha256(canonical_lf(OUT / name))
        if observed != expected:
            raise ValueError(f'Historical teacher code changed: {name}')
        code_pins[name] = observed
    schema_path = PRIVATE / 'contracts' / 'schema-v1.json'
    freeze_path = PRIVATE / 'contracts' / 'freeze-v1.json'
    for name, path in [('schema', schema_path), ('freeze', freeze_path)]:
        observed = pin(path)
        if observed['sha256'] != manifest['contractPins'][name]:
            raise ValueError(f'Frozen {name} pin mismatch')
        retained[path.as_posix()] = observed
    schema, freeze = (json.loads(path.read_bytes()) for path in (schema_path, freeze_path))
    if freeze['schemaSha256'] != manifest['contractPins']['schema']:
        raise ValueError('Freeze/schema linkage mismatch')
    train_families = {family['familyId'] for family in freeze['families'] if family['split'] == 'train'}
    if train_families != EXPECTED_FAMILIES or set(manifest['familyIds']) != train_families:
        raise ValueError('Training family freeze changed')
    train_sources = {source['sourceId']: source for source in freeze['sources'] if source['split'] == 'train'}
    feedback_path = Path(assignment['trainOnlyFeedback']['rawOutputs'])
    feedback_pin = pin(feedback_path)
    if feedback_pin['sha256'] != assignment['trainOnlyFeedback']['rawOutputsSha256']:
        raise ValueError('Authorized train feedback hash changed')
    retained[feedback_path.as_posix()] = feedback_pin
    provenance = {'task': assignment['task'], 'assignmentVersion': assignment['version'],
                  'path': assignment_path.as_posix(), 'gitCommit': ASSIGNMENT_COMMIT,
                  'canonicalLfSha256': ASSIGNMENT_SHA, 'workerBaseCommit': assignment['workerCodeBase']}
    return manifest, schema, train_sources, retained, code_pins, provenance


def require_bijection(old_keys, mapping):
    if len(set(old_keys)) != len(old_keys):
        raise ValueError('Duplicate parent fragment key')
    if set(mapping) != set(old_keys) or len(set(mapping.values())) != len(old_keys):
        raise ValueError('Citation-view mapping is not a collision-free bijection')


def key_mapping(parent):
    old_keys = [fragment['key'] for fragment in parent['input']['evidence']]
    example_id = parent['input']['exampleId']
    mapping = {key: 'view01:k-' + sha256((example_id + '\0' + key).encode('utf-8'))[:16]
               for key in old_keys}
    require_bijection(old_keys, mapping)
    return mapping


def augmentation_metadata(parent, parent_line, mapping, provenance):
    old_order = [fragment['key'] for fragment in parent['input']['evidence']]
    return {'version': POLICY_VERSION, 'parentDatasetPath': (PRIVATE / 'train-teacher-v2.jsonl').as_posix(),
            'parentDatasetSha256': PARENT_SHA, 'parentExampleId': parent['input']['exampleId'],
            'parentRowSha256': sha256(parent_line), 'parentRowHashConvention': ROW_HASH_CONVENTION,
            'keyBijection': [{'oldKey': key, 'newKey': mapping[key]} for key in old_order],
            'oldEvidenceOrder': old_order, 'newEvidenceOrder': [mapping[key] for key in reversed(old_order)],
            'assignment': provenance}


def rewrite_citations(output, mapping):
    for section in SECTIONS:
        for decision in output[section]:
            for citation in decision['citations']:
                if citation['key'] not in mapping:
                    raise ValueError('Citation key is outside the transformation bijection')
                citation['key'] = mapping[citation['key']]


def make_variant(parent, parent_line, provenance):
    mapping = key_mapping(parent)
    variant = copy.deepcopy(parent)
    variant['input']['exampleId'] += SUFFIX
    variant['input']['evidence'].reverse()
    for fragment in variant['input']['evidence']:
        fragment['key'] = mapping[fragment['key']]
    rewrite_citations(variant['output'], mapping)
    if 'citationViewAugmentation' in parent['supervision']:
        raise ValueError('Parent already contains citation-view augmentation metadata')
    variant['supervision']['augmentation'] = True
    variant['supervision']['citationViewAugmentation'] = augmentation_metadata(
        parent, parent_line, mapping, provenance)
    return variant


def validate_row(row, schema, train_sources, contract_pins):
    if set(row) != {'input', 'output', 'supervision'}:
        raise ValueError('Unexpected teacher row fields')
    schema_check(row['input'], schema['$defs']['input'], schema)
    schema_check(row['output'], schema['$defs']['output'], schema)
    supervision = row['supervision']
    if (supervision['split'] != 'train'
            or supervision['state'] != 'provisional_synthetic_supervision'
            or supervision['sarvamDerived'] is not False
            or supervision['schemaSha256'] != contract_pins['schema']
            or supervision['freezeSha256'] != contract_pins['freeze']):
        raise ValueError('Training supervision/frozen contract boundary changed')
    family_id = row['input']['familyId']
    if family_id not in EXPECTED_FAMILIES:
        raise ValueError('Row is outside frozen train families')
    lineage = supervision['sourceLineage']
    if not lineage:
        raise ValueError('Missing retained source lineage')
    for source in lineage:
        if (source != train_sources.get(source['sourceId']) or source['familyId'] != family_id):
            raise ValueError('Source lineage is outside pinned train sources')
    lineage_pairs = {(source['familyId'], source['sourceSha256']) for source in lineage}
    by_key = {}
    for fragment in row['input']['evidence']:
        if fragment['key'] in by_key:
            raise ValueError('Duplicate evidence fragment key')
        by_key[fragment['key']] = fragment
        if (fragment['familyId'] != family_id
                or (fragment['familyId'], fragment['sourceSha256']) not in lineage_pairs):
            raise ValueError('Evidence fragment lacks frozen training source lineage')
    citations = 0
    for section in SECTIONS:
        for decision in row['output'][section]:
            for citation in decision['citations']:
                fragment = by_key.get(citation['key'])
                if fragment is None or citation['quote'] not in fragment['text']:
                    raise ValueError('Unsupported citation key/quote')
                citations += 1
            if section == 'claims':
                quotes = [citation['quote'] for citation in decision['citations']]
                for field in ('literal', 'unit'):
                    if decision[field] is not None and not any(decision[field] in quote for quote in quotes):
                        raise ValueError(f'Unsupported exact {field}')
                if decision['state'] in ('unknown', 'absent', 'null', 'withheld') and decision['literal'] is not None:
                    raise ValueError('Missing-state claim invents a value')
    policies = [decision for decision in row['output']['abstentions'] if decision['code'] == NO_TARGETS['code']]
    if policies != [NO_TARGETS] or row['output']['canonicalLinks'] != []:
        raise ValueError('Mandatory empty-citation no-target policy changed')
    return citations


def verify_recovery(parent, parent_line, variant, provenance):
    mapping = key_mapping(parent)
    metadata = augmentation_metadata(parent, parent_line, mapping, provenance)
    if variant['supervision'].get('citationViewAugmentation') != metadata:
        raise ValueError('Augmentation metadata differs from the pinned parent/assignment')
    if variant['supervision']['augmentation'] is not True:
        raise ValueError('Variant must be explicitly marked augmentation=true')
    if variant['input']['exampleId'] != parent['input']['exampleId'] + SUFFIX:
        raise ValueError('Variant exampleId changed')
    if [fragment['key'] for fragment in variant['input']['evidence']] != metadata['newEvidenceOrder']:
        raise ValueError('Variant evidence order/keys changed')
    restored = copy.deepcopy(variant)
    restored['input']['exampleId'] = parent['input']['exampleId']
    inverse = {new: old for old, new in mapping.items()}
    restored['input']['evidence'].reverse()
    for fragment in restored['input']['evidence']:
        fragment['key'] = inverse[fragment['key']]
    rewrite_citations(restored['output'], inverse)
    restored['supervision']['augmentation'] = parent['supervision']['augmentation']
    del restored['supervision']['citationViewAugmentation']
    if compact(restored) != parent_line or restored != parent:
        raise ValueError('Exact parent recovery failed: input/output/supervision changed')
    return {'parentExampleId': parent['input']['exampleId'], 'variantExampleId': variant['input']['exampleId'],
            'parentRowSha256': sha256(parent_line), 'recoveredRowSha256': sha256(compact(restored)),
            'parentInputSha256': sha256(compact(parent['input'])),
            'parentOutputSha256': sha256(compact(parent['output'])),
            'parentSupervisionSha256': sha256(compact(parent['supervision'])),
            'sourceLocatorTextFragmentsPreserved': len(parent['input']['evidence']),
            'exactRecovery': True}


def corruption_guards(parents, parent_lines, variants, provenance, validator):
    """Five scoped failures protect citation binding and immutable source bytes."""
    results = []

    def rejected(name, operation, expected):
        try:
            operation()
        except ValueError as error:
            if expected not in str(error):
                raise ValueError(f'{name} failed for an unexpected reason: {error}') from error
            results.append({'guard': name, 'rejected': True, 'reason': str(error)})
        else:
            raise ValueError(f'Corruption accepted: {name}')

    duplicate = copy.deepcopy(parents[0])
    duplicate['input']['evidence'][1]['key'] = duplicate['input']['evidence'][0]['key']
    rejected('duplicate_fragment_key', lambda: validator(duplicate), 'Duplicate evidence fragment key')
    old_keys = [fragment['key'] for fragment in parents[0]['input']['evidence']]
    collision = key_mapping(parents[0])
    collision[old_keys[1]] = collision[old_keys[0]]
    rejected('forced_opaque_key_collision', lambda: require_bijection(old_keys, collision), 'bijection')
    floor_index = next(i for i, row in enumerate(parents) if row['input']['exampleId'] == 'teacher-haryana-floor02')
    wrong_binding = copy.deepcopy(variants[floor_index])
    tower_key = next(claim for claim in wrong_binding['output']['claims'] if claim['role'] == 'building')['citations'][0]['key']
    next(claim for claim in wrong_binding['output']['claims'] if claim['role'] == 'drawing')['citations'][0]['key'] = tower_key
    rejected('floor02_caption_bound_to_tower_fragment', lambda: validator(wrong_binding), 'Unsupported citation')
    quote = copy.deepcopy(variants[0])
    quote['output']['claims'][0]['citations'][0]['quote'] += '\n[corruption guard]'
    rejected('changed_citation_quote', lambda: validator(quote), 'Unsupported citation')
    locator = copy.deepcopy(variants[0])
    locator['input']['evidence'][0]['locator']['corruptionGuard'] = True
    rejected('changed_source_locator', lambda: verify_recovery(parents[0], parent_lines[0], locator, provenance),
             'Exact parent recovery failed')
    return results


def counts(rows):
    return {'rows': len(rows), 'claimAppearances': sum(len(row['output']['claims']) for row in rows),
            'conflictAppearances': sum(len(row['output']['conflicts']) for row in rows),
            'abstentionAppearances': sum(len(row['output']['abstentions']) for row in rows),
            'noCanonicalTargets': sum(decision['code'] == NO_TARGETS['code'] for row in rows
                                      for decision in row['output']['abstentions']),
            'evidenceFragmentAppearances': sum(len(row['input']['evidence']) for row in rows),
            'claimStates': dict(sorted(Counter(claim['state'] for row in rows for claim in row['output']['claims']).items()))}


def main():
    if not sys.dont_write_bytecode:
        raise ValueError('Run with python -B to avoid teacher bytecode artifacts')
    manifest, schema, train_sources, retained, code_pins, provenance = verify_pins()
    parent_path = PRIVATE / 'train-teacher-v2.jsonl'
    parent_bytes = parent_path.read_bytes()
    if sha256(parent_bytes) != PARENT_SHA or not parent_bytes.endswith(b'\n'):
        raise ValueError('Immutable v2 prefix hash/LF boundary mismatch')
    parent_lines = parent_bytes.split(b'\n')[:-1]
    parents = [json.loads(line) for line in parent_lines]
    if len(parents) != 11 or any(compact(row) != line for row, line in zip(parents, parent_lines)):
        raise ValueError('Expected exactly 11 canonical compact-UTF8 parent rows')
    if any(row['supervision']['augmentation'] is not False for row in parents):
        raise ValueError('Parent v2 rows must remain original, unaugmented supervision')
    variants = [make_variant(row, line, provenance) for row, line in zip(parents, parent_lines)]
    data = parent_bytes + b''.join(compact(row) + b'\n' for row in variants)
    parsed = [json.loads(line) for line in data.split(b'\n')[:-1]]
    if data[:len(parent_bytes)] != parent_bytes or parsed[:11] != parents or parsed[11:] != variants:
        raise ValueError('Original-prefix/variant serialization changed')
    example_ids = [row['input']['exampleId'] for row in parsed]
    if len(set(example_ids)) != 22:
        raise ValueError('Duplicate experimental exampleId')
    validator = lambda row: validate_row(row, schema, train_sources, manifest['contractPins'])
    citation_checks = sum(validator(row) for row in parsed)
    recovery = [verify_recovery(parent, line, variant, provenance)
                for parent, line, variant in zip(parents, parent_lines, parsed[11:])]
    guards = corruption_guards(parents, parent_lines, variants, provenance, validator)
    parent_counts, output_counts = counts(parents), counts(parsed)
    if {key: parent_counts[key] for key in ('rows', 'claimAppearances', 'conflictAppearances', 'abstentionAppearances', 'noCanonicalTargets')} != {
            'rows': 11, 'claimAppearances': 62, 'conflictAppearances': 2, 'abstentionAppearances': 22, 'noCanonicalTargets': 11}:
        raise ValueError('Accepted parent denominators changed')
    for key, value in parent_counts.items():
        expected = {state: count * 2 for state, count in value.items()} if isinstance(value, dict) else value * 2
        if output_counts[key] != expected:
            raise ValueError(f'Augmentation changed the denominator for {key}')
    if output_counts['claimStates'].get('absent', 0) != 0 or output_counts['claimStates'].get('null', 0) != 0:
        raise ValueError('No new absent/null-state examples are authorized')
    data_path = PRIVATE / 'train-teacher-v3.jsonl'
    mapping_path = PRIVATE / 'citation-view-v3.mapping.json'
    receipt_path = PRIVATE / 'citation-view-v3.receipt.json'
    mapping = {'version': 'ml-distill-citation-view-mapping/3', 'policyVersion': POLICY_VERSION,
               'parentDatasetSha256': PARENT_SHA, 'datasetSha256': sha256(data),
               'rowHashConvention': ROW_HASH_CONVENTION,
               'rows': [dict(row['supervision']['citationViewAugmentation'],
                             variantExampleId=row['input']['exampleId'], variantRowSha256=sha256(compact(row)))
                        for row in parsed[11:]]}
    mapping_bytes = json_bytes(mapping)
    code_pins[Path(__file__).name] = sha256(canonical_lf(__file__))
    historical_metadata = {'v1Manifest': {'path': (OUT / 'batch-v1.manifest.json').as_posix(), **pin(OUT / 'batch-v1.manifest.json')},
                           'v2Manifest': {'path': (OUT / 'batch-v2.manifest.json').as_posix(), **pin(OUT / 'batch-v2.manifest.json')}}
    # Recheck original artifacts after transformation and guards, before publication.
    for path, expected in retained.items():
        if pin(path) != expected:
            raise ValueError(f'Retained original/artifact changed during assembly: {path}')
    receipt = {'version': 'ml-distill-citation-view-receipt/3', 'createdDate': '2026-10-02',
               'status': 'passed_local_consistency', 'qualification': 'provisional train augmentation; no new facts or measured quality improvement',
               'policyVersion': POLICY_VERSION, 'assignment': provenance, 'contractPins': manifest['contractPins'],
               'parentCounts': parent_counts, 'variantCounts': counts(parsed[11:]), 'outputCounts': output_counts,
               'prefix': {'bytes': len(parent_bytes), 'sha256': sha256(data[:len(parent_bytes)]), 'exact': True},
               'dataset': {'path': data_path.as_posix(), 'bytes': len(data), 'sha256': sha256(data)},
               'mapping': {'path': mapping_path.as_posix(), 'bytes': len(mapping_bytes), 'sha256': sha256(mapping_bytes)},
               'validation': {'schemaRows': len(parsed), 'supportedCitationAppearances': citation_checks,
                              'sourceFamilyRows': len(parsed), 'inverseRecoveredVariants': len(recovery),
                              'supervisionDelta': ['augmentation=true', 'citationViewAugmentation'],
                              'preserved': ['source hashes/families/methods/locators/text', 'quotes/literals/units',
                                            'roles/states/nulls', 'conflicts/abstentions/order', 'canonicalLinks', 'parent supervision'],
                              'corruptionGuards': guards},
               'recovery': recovery, 'retainedRawPinsBeforeAndAfter': retained, 'historicalManifests': historical_metadata,
               'codePins': code_pins, 'codeHashConvention': 'canonical LF; datasets/artifacts remain raw',
               'execution': {'command': f'& "{Path(sys.executable).as_posix()}" -B "{Path(__file__).as_posix()}"',
                             'workingDirectory': ROOT.as_posix(), 'python': sys.version.split()[0],
                             'mode': 'cpu_only', 'bytecodeDisabled': sys.dont_write_bytecode,
                             'validationCompleted': True, 'historicalMainExecuted': False, 'sourceInventoryRepeated': False},
               'access': {'devContent': False, 'evaluationContent': False, 'oldMappingHoldouts': False,
                          'feedback': 'authorized two-row train-family feedback hash only in this assembly'},
               'limitations': ['62 parent-row claims appear twice; variants are not independent truth',
                               'positional/key shortcutting remains a hypothesis', 'no fitting or quality/performance evaluation',
                               'no added source facts, state-class examples or native IFC examples',
                               'existing source/label/launch qualification remains unchanged']}
    receipt_bytes = json_bytes(receipt)
    v3_manifest = {'version': 'ml-distill-teacher-batch/3', 'createdDate': '2026-10-02',
                   'status': manifest['status'], 'split': 'train', 'familyIds': manifest['familyIds'],
                   'contractPins': manifest['contractPins'], 'parent': {'path': parent_path.as_posix(), **pin(parent_path),
                                                                     'manifestPath': (OUT / 'batch-v2.manifest.json').as_posix(),
                                                                     'manifestCanonicalLfSha256': PARENT_MANIFEST_SHA},
                   'augmentationPolicy': POLICY_VERSION, 'assignment': provenance,
                   'originalRows': len(parents), 'variantRows': len(variants), 'counts': output_counts,
                   'originalPrefixBytes': len(parent_bytes), 'originalPrefixExact': True,
                   'claimsIndependentOfAugmentation': parent_counts['claimAppearances'],
                   'inverseRecoveryChecked': len(recovery), 'rejectsRetained': manifest['rejects'],
                   'codePins': code_pins, 'codeHashConvention': receipt['codeHashConvention'],
                   'artifacts': [receipt['dataset'], receipt['mapping'],
                                 {'path': receipt_path.as_posix(), 'bytes': len(receipt_bytes), 'sha256': sha256(receipt_bytes)}],
                   'reviewState': manifest['reviewState'], 'teacher': manifest['teacher'],
                   'qualification': receipt['qualification'], 'evaluationAccess': False, 'devRawAccess': False,
                   'sourceSpecificLaunchClearance': manifest['sourceSpecificLaunchClearance']}
    outputs = [(data_path, data), (mapping_path, mapping_bytes), (receipt_path, receipt_bytes),
               (OUT / 'batch-v3.manifest.json', json_bytes(v3_manifest))]
    for path, payload in outputs:
        if path.exists() and path.read_bytes() != payload:
            raise ValueError(f'Existing v3 artifact differs; retain it and use a new version: {path}')
    for path, payload in outputs:
        immutable_artifact(path, payload)
        if pin(path) != {'bytes': len(payload), 'sha256': sha256(payload)}:
            raise ValueError(f'Published v3 artifact readback mismatch: {path}')
    print(json.dumps({'status': receipt['status'], 'counts': output_counts, 'citationChecks': citation_checks,
                      'inverseRecoveredVariants': len(recovery), 'corruptionGuardsRejected': len(guards),
                      'dataSha256': sha256(data), 'codeSha256': code_pins[Path(__file__).name],
                      'mappingSha256': sha256(mapping_bytes), 'receiptSha256': sha256(receipt_bytes)}))


if __name__ == '__main__':
    main()
