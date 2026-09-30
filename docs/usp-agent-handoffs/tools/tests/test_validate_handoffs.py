"""Mutation tests: prove that the active-plan guard rejects meaningful planning drift."""
import copy
import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[1] / 'validate_handoffs.py'
spec = importlib.util.spec_from_file_location('validate_handoffs', MODULE)
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class PlanGuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True, capture_output=True)
        # Only this disposable repository: technical source bytes must survive
        # inherited Git text settings unchanged, just like receipt hashes.
        (self.root / '.gitattributes').write_bytes(b'*.py -text\n')
        (self.root / 'check.py').write_bytes(b'# validator\n')
        subprocess.run(['git', '-C', str(self.root), 'add', '.gitattributes', 'check.py'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(self.root), '-c', 'user.name=Receipt test', '-c',
                        'user.email=receipt@example.invalid', '-c', 'commit.gpgsign=false',
                        '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'fixture'],
                       check=True, capture_output=True)
        self.commit = subprocess.check_output(['git', '-C', str(self.root), 'rev-parse', 'HEAD'], text=True).strip()
        self.h = self.root / 'docs/usp-agent-handoffs'
        self.h.mkdir(parents=True)
        (self.h / '00.md').write_text('# Start\n\n[Other](other.md#part)\n')
        (self.h / 'other.md').write_text('# Part\n\n# Part\n')
        (self.root / 'receipt.md').write_text('Recorded baseline only.\n')
        (self.root / 'check.py').write_bytes(b'# validator\n')
        self.plan = {
            'schemaVersion':'ulpin-release-plan/1', 'currentRelease':'finale_v1', 'nextGate':'GF0',
            'baseline':{'commit':'a'*40, 'receipt':'receipt.md'},
            'releases':{'finale_v1':{'requires':['GF0','GF1']},
                        'full_product':{'requires':['GF0','GF1','FP-LEARN']}},
            'owners':{'FND':'Shared'},
            'gates':[
                {'id':'GF0','release':'finale_v1','dependsOn':[],'tests':['GF-T0'],'status':'pending','evidence':[]},
                {'id':'GF1','release':'finale_v1','dependsOn':['GF0'],'tests':['GF-T0'],'status':'pending','evidence':[]},
                {'id':'FP-LEARN','release':'full_product','dependsOn':['GF1'],'tests':['GF-T0'],'status':'pending','evidence':[]}],
            'requirements':[{'id':'R0','owner':'FND','gate':'GF0','docs':['docs/usp-agent-handoffs/00.md'],'tests':['GF-T0']}],
            'tests':{'GF-T0':{'kind':'runtime','owner':'FND','specs':['docs/usp-agent-handoffs/other.md'],'status':'planned','receipts':[]}},
            'entryPoints':[], 'activeDocDirectory':'docs/usp-agent-handoffs',
            'receiptContract': {'requiredFields': ['testId', 'status', 'codeCommit', 'manifestHash',
                'sourceHashes', 'modelHashes', 'runAt', 'environment', 'command', 'exitCode',
                'expectedActual', 'artifacts', 'agent', 'review', 'limitations', 'unqualifiedClaims']},
            'planValidation':{'validator':'check.py','tests':'check.py','status':'pending','receipt':None}}

        for gate in self.plan['gates']:
            gate.update(scheduleStatus='unscheduled', targetDate=None, fallbackDecisionDate=None,
                        completedAt=None, approvedBy=None, blockedBy=[])
        self.plan.update(waivers=[], projectOwner=None, releaseCandidate={'status':'pending','commit':None},
                         humanDependencies=[{'id':f'H90-{i}', 'neededFor':['GF1'] if i < 4 else [],
                             'status':'open' if i < 4 else 'not_required', 'owner':None,
                             'fallback':'Keep the affected human activity pending.'} for i in range(1,6)])
        self.plan['tests']['GF-T0']['attempts'] = []

    def pin_attempt(self, path, status='passed', attempt_id='attempt-1'):
        attempt = {'id':attempt_id, 'receipt':path.relative_to(self.root).as_posix(), 'status':status,
                   'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
        attempts = self.plan['tests']['GF-T0']['attempts']
        attempts[:] = [a for a in attempts if a['id'] != attempt_id] + [attempt]
        return attempt

    def errors(self):
        (self.root / validator.PLAN).write_text(json.dumps(self.plan))
        return validator.validate(self.root)

    def rejects(self, fragment):
        result = self.errors()
        self.assertTrue(any(fragment in x for x in result), result)

    def test_valid_pending_plan(self):
        self.assertEqual(self.errors(), [])

    def test_broken_file(self):
        (self.h / 'other.md').unlink()
        self.rejects('broken local link')

    def test_broken_anchor_on_existing_file(self):
        (self.h / '00.md').write_text('[bad](other.md#removed-section)')
        self.rejects('broken heading anchor')

    def test_encoded_filename_duplicate_heading_and_fenced_code(self):
        (self.h / '[route].md').write_text('# Route')
        (self.h / '00.md').write_text('[ok](%5Broute%5D.md#route)\n[dup](other.md#part-1)\n```md\n[example](missing.md)\n```\n')
        self.assertEqual(self.errors(), [])

    def test_unknown_requirement_owner(self):
        self.plan['requirements'][0]['owner']='NOBODY'
        self.rejects('unknown owner')

    def test_missing_required_test(self):
        self.plan['requirements'][0]['tests']=['MISSING']
        self.rejects('unknown test')

    def test_test_removed_from_owning_gate(self):
        self.plan['gates'][0]['tests']=[]
        self.rejects('missing from owning gate')

    def test_release_cycle(self):
        self.plan['gates'][0]['dependsOn']=['GF1']
        self.rejects('dependency cycle')

    def test_finale_cannot_depend_on_learner(self):
        self.plan['gates'][1]['dependsOn'].append('FP-LEARN')
        self.rejects('finale depends on deferred')

    def test_release_must_include_prerequisites(self):
        self.plan['releases']['full_product']['requires'].remove('GF1')
        self.rejects('missing prerequisite')

    def test_no_fake_test_pass(self):
        self.plan['tests']['GF-T0']['status']='passed'
        self.rejects('passed without receipt')

    def test_no_fake_gate_completion(self):
        self.plan['gates'][1]['status']='complete'
        self.rejects('complete without evidence')
        self.rejects('complete without passed tests')
        self.rejects('complete before dependencies')

    def test_document_status_never_advances_runtime(self):
        self.plan_validation_receipt()
        self.assertEqual(self.errors(), [])
        self.assertEqual(self.plan['nextGate'],'GF0')
        self.assertEqual(self.plan['gates'][0]['status'],'pending')

    def test_stale_next_gate(self):
        self.plan['nextGate']='GF1'
        self.rejects('nextGate does not match')

    def test_stale_current_work(self):
        p=self.root/'docs/engineering-plan/CURRENT_WORK.md';p.parent.mkdir(parents=True)
        p.write_text('Next gate: OLD\n'+'a'*40)
        self.plan['entryPoints'].append(p.relative_to(self.root).as_posix())
        self.rejects('CURRENT_WORK next gate disagrees')

    def test_stale_baseline(self):
        (self.root/'AGENTS.md').write_text('Old baseline')
        self.plan['entryPoints'].append('AGENTS.md')
        self.rejects('consolidated baseline missing or stale')

    def test_retired_reference_in_copy_paste_prompt(self):
        (self.h/'00.md').write_text('```text\nFollow H00 section 4.\n```\n')
        self.rejects('retired instruction/reference')

    def test_no_external_requirement_path(self):
        self.plan['requirements'][0]['docs']=['../outside.md']
        self.rejects('outside-repository path')

    def test_duplicate_requirement(self):
        self.plan['requirements'].append(copy.deepcopy(self.plan['requirements'][0]))
        self.rejects('duplicate or missing requirement')

    def test_orphan_test(self):
        self.plan['tests']['UNOWNED']=copy.deepcopy(self.plan['tests']['GF-T0'])
        self.rejects('orphan test')

    def test_missing_plan_validation_receipt(self):
        self.plan['planValidation']['status']='passed'
        self.rejects('planValidation passed receipt')

    def passing_runtime_receipt(self):
        path=self.root/'docs/evidence/usp/finale/GF-T0/receipt.json'
        path.parent.mkdir(parents=True)
        artifact=path.parent/'execution.txt';artifact.write_text('expected 20; actual 20; passed')
        data={'schemaVersion':'ulpin-test-receipt/1','testId':'GF-T0','status':'passed',
              'codeCommit':self.commit,'manifestHash':'b'*64,'sourceHashes':['c'*64],
              'modelHashes':[],'runAt':'2026-09-24T10:00:00Z',
              'agent':{'id':'producer-1','product':'Codex','model':'gpt-6-sol','effort':'high'},
              'review':{'reviewer':'reviewer-1','kind':'agent','modelFamily':'other-family',
                        'independence':'cross_family','reviewedAt':'2026-09-24T10:01:00Z','verdict':'accepted'},
              'limitations':[], 'unqualifiedClaims':[],
              'environment':{'runtime':'isolated fixture'},'command':'fixture-check','exitCode':0,
              'expectedActual':[{'caseId':'volume','expected':20,'actual':20,'result':'passed'}],
              'artifacts':[{'path':artifact.relative_to(self.root).as_posix(),
                            'sha256':hashlib.sha256(artifact.read_bytes()).hexdigest()}]}
        path.write_text(json.dumps(data))
        self.plan['tests']['GF-T0'].update(status='passed',receipts=[path.relative_to(self.root).as_posix()])
        self.pin_attempt(path)
        return path,data

    def test_valid_runtime_receipt_and_complete_gate(self):
        path,_=self.passing_runtime_receipt()
        self.plan['gates'][0].update(status='complete',evidence=[path.relative_to(self.root).as_posix()])
        self.plan['nextGate']='GF1'
        self.approve_gate(self.plan['gates'][0])
        self.assertEqual(self.errors(), [])

    def test_old_baseline_cannot_pass_new_runtime_test(self):
        self.plan['tests']['GF-T0'].update(status='passed',receipts=['receipt.md'])
        self.rejects('runtime receipt outside its test namespace')

    def test_wrong_test_in_receipt(self):
        path,data=self.passing_runtime_receipt();data['testId']='GF-OTHER'
        path.write_text(json.dumps(data))
        self.rejects('wrong runtime receipt schema/test ID')

    def test_receipt_requires_source_provenance(self):
        path,data=self.passing_runtime_receipt();del data['sourceHashes']
        path.write_text(json.dumps(data))
        self.rejects('invalid sourceHashes')

    def test_artifact_tampering(self):
        path,_=self.passing_runtime_receipt();(path.parent/'execution.txt').write_text('changed')
        self.rejects('artifact hash mismatch')

    def test_gate_cannot_reuse_unrelated_evidence(self):
        self.passing_runtime_receipt()
        self.plan['gates'][0].update(status='complete',evidence=['receipt.md'])
        self.plan['nextGate']='GF1'
        self.rejects('gate evidence must equal its exact test receipts')

    def test_stale_gate_in_every_entrypoint(self):
        for entry in ('AGENTS.md','README.md','docs/usp-agent-handoffs/00-README.md',
                      'docs/usp-agent-handoffs/02-lead-agent-execution.md'):
            with self.subTest(entry=entry):
                p=self.root/entry;p.parent.mkdir(parents=True,exist_ok=True)
                p.write_text('<!-- plan-next-gate: GF1 -->\n'+'a'*40)
                self.plan['entryPoints']=[entry]
                self.rejects('next-gate declaration disagrees')
                p.write_text('<!-- plan-next-gate: GF0 -->\n'+'a'*40)
                self.assertEqual(self.errors(), [])
                p.unlink()

    def test_visible_gate_cannot_conflict_with_declaration(self):
        p=self.root/'README.md'
        p.write_text('<!-- plan-next-gate: GF0 -->\nNext gate: **GF1**')
        self.plan['entryPoints']=['README.md']
        self.rejects('visible next gate disagrees')

    def test_receipt_contract_additional_required_field_is_enforced(self):
        path, data = self.passing_runtime_receipt()
        self.plan['receiptContract']['requiredFields'].append('executionId')
        self.rejects('missing required receipt field executionId')
        data['executionId'] = 'run-1'; path.write_text(json.dumps(data)); self.pin_attempt(path)
        self.assertEqual(self.errors(), [])

    def test_receipt_contract_cannot_drop_provenance_fields(self):
        self.plan['receiptContract']['requiredFields'].remove('review')
        self.rejects('must include the runtime provenance contract')

    def test_receipt_rejects_nonexistent_and_unmerged_commits(self):
        path, data = self.passing_runtime_receipt()
        data['codeCommit'] = '0' * 40; path.write_text(json.dumps(data))
        self.rejects('not a verified ancestor')
        subprocess.run(['git', '-C', str(self.root), 'checkout', '-qb', 'other'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(self.root), '-c', 'user.name=Receipt test', '-c',
                        'user.email=receipt@example.invalid', '-c', 'commit.gpgsign=false',
                        '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'other'],
                       check=True, capture_output=True)
        data['codeCommit'] = subprocess.check_output(['git', '-C', str(self.root), 'rev-parse', 'HEAD'], text=True).strip()
        subprocess.run(['git', '-C', str(self.root), 'checkout', '-q', self.commit], check=True, capture_output=True)
        path.write_text(json.dumps(data)); self.rejects('not a verified ancestor')
        data['codeCommit'] = self.commit; path.write_text(json.dumps(data)); self.pin_attempt(path)
        self.assertEqual(self.errors(), [])

    def test_receipt_rejects_future_execution_or_review(self):
        path, data = self.passing_runtime_receipt()
        for field in ('runAt', 'reviewedAt'):
            target = data if field == 'runAt' else data['review']
            old = target[field]; target[field] = '2999-01-01T00:00:00Z'
            path.write_text(json.dumps(data)); self.rejects('timestamp is in the future')
            target[field] = old
        path.write_text(json.dumps(data)); self.pin_attempt(path); self.assertEqual(self.errors(), [])

    def test_receipt_requires_distinct_reviewer_and_observed_agent(self):
        path, data = self.passing_runtime_receipt()
        original = copy.deepcopy(data)
        for mutation, error in [
            (lambda d: d.pop('review'), 'missing receipt review'),
            (lambda d: d['review'].update(reviewer='producer-1'), 'reviewer must differ'),
            (lambda d: d['review'].update(verdict='pending'), 'review is not accepted'),
            (lambda d: d['review'].update(reviewedAt='2026-09-23T10:00:00Z'), 'review predates'),
            (lambda d: d['agent'].pop('effort'), 'missing producer agent identity/settings'),
            (lambda d: d['review'].pop('modelFamily'), 'missing reviewer model family'),
            (lambda d: d.update(limitations=None), 'invalid limitations'),
            (lambda d: d.update(unqualifiedClaims=[None]), 'invalid unqualifiedClaims'),
        ]:
            with self.subTest(error=error):
                data = copy.deepcopy(original); mutation(data)
                path.write_text(json.dumps(data)); self.rejects(error)
        path.write_text(json.dumps(original)); self.pin_attempt(path); self.assertEqual(self.errors(), [])

    def test_receipt_artifacts_stay_inside_test_namespace(self):
        path, data = self.passing_runtime_receipt()
        outside = self.root/'elsewhere.txt'; outside.write_text('same hash is insufficient')
        data['artifacts'] = [{'path':'elsewhere.txt','sha256':hashlib.sha256(outside.read_bytes()).hexdigest()}]
        path.write_text(json.dumps(data)); self.rejects('artifact outside its test namespace')

    def test_not_applicable_case_requires_reason(self):
        path, data = self.passing_runtime_receipt()
        data['expectedActual'].append({'caseId':'optional','expected':None,'actual':None,'result':'not_applicable'})
        path.write_text(json.dumps(data)); self.rejects('failed or duplicate expected/actual case')
        data['expectedActual'][-1]['reason'] = 'No optional solid profile in this test'
        path.write_text(json.dumps(data)); self.pin_attempt(path); self.assertEqual(self.errors(), [])
        data['expectedActual'] = data['expectedActual'][1:]
        path.write_text(json.dumps(data)); self.rejects('no executed passing case')

    def test_nested_markdown_and_gate_declarations(self):
        nested = self.h/'nested'; nested.mkdir()
        p = nested/'detail.md'; p.write_text('[bad](missing.md)')
        self.rejects('broken local link')
        for content in ('<!-- plan-next-gate: GF0 -->', 'Next gate: **GF0**'):
            p.write_text(content); self.rejects('gate declarations are allowed only in entry points')
        p.write_text('# Detail\n'); self.assertEqual(self.errors(), [])

    def test_non_utf8_markdown_is_a_named_error(self):
        p = self.h/'bad.md'; p.write_bytes(b'\xff\xfe')
        self.rejects('bad.md: unreadable UTF-8 Markdown')
        p.write_text('Valid UTF-8'); self.assertEqual(self.errors(), [])

    def plan_validation_receipt(self):
        self.plan['planValidation'].update(status='passed', receipt='plan-receipt.json')
        (self.root/validator.PLAN).write_text(json.dumps(self.plan))
        paths = [validator.PLAN, 'check.py'] + [p.relative_to(self.root).as_posix() for p in self.h.rglob('*.md')]
        code_commit = subprocess.check_output(['git','-C',str(self.root),'rev-parse','HEAD'],text=True).strip()
        data = {'codeCommit':code_commit, 'checkedAt':'2026-09-24T11:00:00Z',
                'filesSha256':{p:hashlib.sha256((self.root/p).read_bytes()).hexdigest() for p in paths}}
        path = self.root/'plan-receipt.json'; path.write_text(json.dumps(data))
        return path, data

    def test_plan_validation_hashes_expire_and_require_coverage(self):
        path, data = self.plan_validation_receipt()
        self.assertEqual(self.errors(), [])
        (self.h/'other.md').write_text('# Part\nChanged')
        self.rejects('stale filesSha256')
        path, data = self.plan_validation_receipt(); self.assertEqual(self.errors(), [])
        del data['filesSha256']['check.py']; path.write_text(json.dumps(data))
        self.rejects('filesSha256 omits active plan inputs')

    def test_plan_validation_cannot_use_plain_text_as_hash_receipt(self):
        self.plan['planValidation'].update(status='passed', receipt='receipt.md')
        self.rejects('unreadable hash receipt')

    def test_plan_validation_keeps_exact_source_bytes(self):
        self.plan_validation_receipt()
        self.assertEqual(self.errors(), [])
        (self.root/'check.py').write_bytes(b'# validator\r\n')
        self.rejects('stale filesSha256 for check.py')
        # Repinning changed working bytes still cannot match the original blob.
        self.plan_validation_receipt()
        self.rejects('codeCommit does not contain checked source check.py')

    def pin_file(self, path):
        return {'path':path.relative_to(self.root).as_posix(),
                'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}

    def write_record(self, name, data):
        path = self.root / 'governance-evidence' / name
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps(data))
        return self.pin_file(path)

    def designate_owner(self):
        self.plan['projectOwner'] = {'id':'test-owner', 'evidence':self.write_record('owner.json', {
            'schemaVersion':'ulpin-owner-designation/1', 'ownerId':'test-owner', 'role':'owner',
            'recordedAt':'2026-09-24T09:00:00Z', 'statement':'Test-only owner designation',
            'sourceReference':'metadata-test:owner-designation'})}

    def approval_record(self, subject, name, identity=None, at='2026-09-24T10:03:00Z'):
        identity = identity or {'id':'independent-reviewer','kind':'agent','product':'Claude Code',
                                'model':'claude-opus-5-5','modelFamily':'anthropic','effort':'high'}
        evidence = self.write_record(name + '.json', {'schemaVersion':'ulpin-approval-source/1',
            'identity':identity, 'decision':'approved', 'subjectSha256':validator.governance.digest(subject),
            'recordedAt':at, 'statement':'Test metadata: explicitly approve this subject.',
            'sourceReference':'metadata-test:' + name})
        return {'identity':identity, 'approvedAt':at, 'evidence':evidence}

    def approve_gate(self, gate, identity=None, at='2026-09-24T10:03:00Z', completed='2026-09-24T10:04:00Z'):
        gate['completedAt'] = completed
        subject = {'gate':gate['id'], 'tests':gate['tests'],
                   'evidence':[self.pin_file(self.root / p) for p in gate['evidence']],
                   'waivers':[w for w in self.plan['waivers'] if w['gate'] == gate['id']],
                   'completedAt':completed,
                   'releaseCandidate':self.plan['releaseCandidate']['commit'] if gate['id'] == 'GF5' else None}
        gate['approvedBy'] = self.approval_record(subject, gate['id'] + '-approval', identity, at)

    def complete_first_gate(self):
        path, data = self.passing_runtime_receipt()
        gate = self.plan['gates'][0]
        gate.update(status='complete', evidence=[path.relative_to(self.root).as_posix()])
        self.plan['nextGate'] = 'GF1'
        self.approve_gate(gate)
        return gate, path, data

    def owner_identity(self):
        return {'id':'test-owner','kind':'human','role':'owner'}

    def add_waiver(self):
        self.designate_owner()
        before = self.root/'claims-before.txt'; before.write_text('Qualified claim X\nOther claims')
        after = self.root/'claims-current.txt'; after.write_text('Other claims')
        waiver = {'test':'GF-T0','gate':'GF0','reason':'Coverage remains unavailable.',
                  'claimRemovedFrom':[{'claim':'Qualified claim X','before':self.pin_file(before),
                                       'after':self.pin_file(after)}]}
        waiver['approvedBy'] = self.approval_record(waiver.copy(), 'waiver', self.owner_identity())
        self.plan['waivers'] = [waiver]
        return waiver

    def commit_plan(self):
        (self.root / validator.PLAN).write_text(json.dumps(self.plan))
        subprocess.run(['git','-C',str(self.root),'add','.'], check=True, capture_output=True)
        subprocess.run(['git','-C',str(self.root),'-c','user.name=Receipt test','-c',
                        'user.email=receipt@example.invalid','-c','commit.gpgsign=false',
                        '-c','core.hooksPath=/dev/null','commit','-qm','Retain metadata attempts'],
                       check=True,capture_output=True)

    def test_approval_requires_bound_evidence(self):
        gate, _, _ = self.complete_first_gate()
        self.assertEqual(self.errors(), [])
        gate['approvedBy']['evidence']['sha256'] = '0'*64
        self.rejects('approval: evidence hash mismatch')

    def test_approval_rejects_wrong_subject_identity_or_decision(self):
        gate, _, _ = self.complete_first_gate()
        pin = gate['approvedBy']['evidence']; path = self.root/pin['path']
        original = json.loads(path.read_text())
        for key, value in [('subjectSha256','0'*64), ('identity',self.owner_identity()),
                           ('decision','pending'), ('sourceReference',''), ('statement','')]:
            with self.subTest(key=key):
                data = copy.deepcopy(original); data[key] = value; path.write_text(json.dumps(data))
                gate['approvedBy']['evidence'] = self.pin_file(path)
                self.rejects('approval evidence does not bind')
        path.write_text(json.dumps(original)); gate['approvedBy']['evidence'] = self.pin_file(path)
        self.assertEqual(self.errors(), [])

    def test_approval_rejects_same_family_even_when_labelled_cross_family(self):
        gate, _, _ = self.complete_first_gate()
        identity = {'id':'another-codex','kind':'agent','product':'Codex','model':'gpt-6-astra',
                    'effort':'high','modelFamily':'anthropic'}
        self.approve_gate(gate, identity)
        self.rejects('invalid observed approver model/settings')
        identity['modelFamily'] = 'openai'; self.approve_gate(gate, identity)
        self.rejects('approval is not verified cross-family')

    def test_approval_rejects_producer_and_unknown_model(self):
        gate, _, _ = self.complete_first_gate()
        identity = copy.deepcopy(gate['approvedBy']['identity']); identity['id'] = 'producer-1'
        self.approve_gate(gate, identity); self.rejects('approver must differ from every producer')
        identity.update(id='new-reviewer', model='unverified-model')
        self.approve_gate(gate, identity); self.rejects('invalid observed approver model/settings')

    def test_human_can_approve_early_gate(self):
        gate, _, _ = self.complete_first_gate()
        self.approve_gate(gate, {'id':'human-reviewer','kind':'human','role':'reviewer'})
        self.assertEqual(self.errors(), [])

    def test_approval_and_completion_freshness(self):
        gate, _, _ = self.complete_first_gate()
        self.approve_gate(gate, at='2026-09-24T09:00:00Z')
        self.rejects('approval predates reviewed evidence')
        self.approve_gate(gate, completed='2026-09-24T10:02:00Z')
        self.rejects('completion predates approval')
        self.approve_gate(gate, at='2999-01-01T00:00:00Z', completed='2999-01-01T00:01:00Z')
        self.rejects('timestamp is in the future')

    def test_pending_gate_cannot_carry_fictitious_approval(self):
        gate, _, _ = self.complete_first_gate()
        gate['status'] = 'pending'; self.plan['nextGate'] = 'GF0'
        self.rejects('incomplete gate cannot claim approval/completion')

    def test_valid_waiver_advances_gate_without_passing_test(self):
        self.add_waiver()
        gate = self.plan['gates'][0]; gate['status'] = 'complete'; self.plan['nextGate'] = 'GF1'
        # A human reviews an all-waived gate because there are no runtime producers.
        self.approve_gate(gate, self.owner_identity())
        self.assertEqual(self.errors(), [])
        self.assertEqual(self.plan['tests']['GF-T0']['status'], 'planned')
        self.assertEqual(self.plan['tests']['GF-T0']['receipts'], [])

    def test_waiver_requires_designated_owner_and_real_decision_source(self):
        waiver = self.add_waiver(); self.assertEqual(self.errors(), [])
        self.plan['projectOwner'] = None; self.rejects('requires designated human owner approval')
        self.designate_owner(); waiver['approvedBy']['identity']['kind'] = 'agent'
        self.rejects('requires designated human owner approval')

    def test_waiver_requires_claim_removal_and_reason(self):
        waiver = self.add_waiver()
        waiver['reason'] = ''; self.rejects('explicit reason required')
        waiver['reason'] = 'Coverage unavailable'; waiver['claimRemovedFrom'] = []
        self.rejects('explicit removed claim evidence required')
        waiver = self.add_waiver(); after = self.root/waiver['claimRemovedFrom'][0]['after']['path']
        after.write_text('Qualified claim X')
        waiver['claimRemovedFrom'][0]['after'] = self.pin_file(after)
        self.rejects('named claim must exist before and be absent')

    def test_waiver_cannot_be_counted_as_a_pass_or_reused_for_another_gate(self):
        self.add_waiver(); self.passing_runtime_receipt()
        self.rejects('waived test must remain honestly open')
        self.plan['waivers'][0]['gate'] = 'NO-GATE'
        self.rejects('duplicate or unrelated test/gate')

    def test_human_dependency_block_must_link_open_needed_entry(self):
        gate = self.plan['gates'][0]; gate['status'] = 'blocked'
        self.rejects('blocked gate must cite an open human dependency')
        gate['blockedBy'] = ['H90-3']; self.rejects('blockedBy must link an open human dependency')
        self.plan['humanDependencies'][2]['neededFor'] = ['GF0']
        self.assertEqual(self.errors(), [])
        self.plan['humanDependencies'][2]['status'] = 'resolved'
        self.rejects('blockedBy must link an open human dependency')

    def test_human_dependency_short_list_and_trigger(self):
        self.plan['humanDependencies'].append({'id':'H10'})
        self.rejects('ID must uniquely name the H90 short list')
        self.plan['humanDependencies'].pop()
        dep = self.plan['humanDependencies'][3]; dep.update(status='open',neededFor=['GF0'])
        self.rejects('optional dependency requires explicit H90 trigger')
        dep['trigger'] = 'Live stage model call explicitly requested.'
        self.assertEqual(self.errors(), [])
        del dep['fallback']; self.rejects('missing owner/fallback')

    def test_human_dependency_resolution_requires_bound_evidence(self):
        dep = self.plan['humanDependencies'][1]; dep.update(status='resolved',owner='test-team-leader')
        self.rejects('missing bound resolution evidence')
        dep['evidence'] = self.write_record('submission.json', {
            'schemaVersion':'ulpin-human-dependency/1','id':dep['id'],'neededFor':dep['neededFor'],
            'owner':dep['owner'],'status':'resolved','recordedAt':'2026-09-24T09:00:00Z',
            'sourceReference':'metadata-test:portal-receipt','statement':'Test submission acknowledged.'})
        self.assertEqual(self.errors(), [])

    def test_scheduled_dates_shape_and_dependency_order(self):
        g0, g1 = self.plan['gates'][:2]
        g0.update(scheduleStatus='scheduled',fallbackDecisionDate='2026-10-01',targetDate='2026-10-02')
        g1.update(scheduleStatus='scheduled',fallbackDecisionDate='2026-10-03',targetDate='2026-10-04')
        self.assertEqual(self.errors(), [])
        g1['fallbackDecisionDate'] = '2026-10-01'; self.rejects('schedule dates must increase')
        g1['fallbackDecisionDate'] = '2026-10-05'; self.rejects('must not follow targetDate')
        g1['targetDate'] = '2026-02-30'; self.rejects('valid ISO dates')
        g1['targetDate'] = '2026-1-2'; self.rejects('valid ISO dates')

    def test_unscheduled_nulls_and_missing_dependency_schedule(self):
        g0, g1 = self.plan['gates'][:2]
        del g0['targetDate']; self.rejects('unscheduled dates must be explicit null')
        g0['targetDate'] = None
        g1.update(scheduleStatus='scheduled',fallbackDecisionDate='2026-10-03',targetDate='2026-10-04')
        self.rejects('schedule dates must increase after dependencies')

    def failed_attempt(self):
        path, data = self.passing_runtime_receipt()
        data.update(status='failed', exitCode=1)
        data['expectedActual'][0]['result'] = 'failed'
        path.write_text(json.dumps(data)); self.pin_attempt(path, 'failed')
        self.plan['tests']['GF-T0']['status'] = 'failed'
        return path, data

    def test_failure_attempt_is_retained_and_cannot_pass_gate(self):
        self.failed_attempt(); self.assertEqual(self.errors(), [])
        gate = self.plan['gates'][0]
        gate.update(status='complete', evidence=self.plan['tests']['GF-T0']['receipts'])
        self.approve_gate(gate); self.plan['nextGate'] = 'GF1'
        self.rejects('complete without passed tests')

    def test_attempt_pins_and_false_failure(self):
        path, data = self.failed_attempt()
        data['exitCode'] = 0; data['expectedActual'][0]['result'] = 'passed'
        path.write_text(json.dumps(data)); self.rejects('attempt: evidence hash mismatch')
        self.pin_attempt(path, 'failed'); self.rejects('failed attempt has no command or case failure')

    def test_attempt_history_survives_commit_and_rejects_removal_and_rewrite(self):
        path, data = self.failed_attempt(); self.commit_plan()
        original = copy.deepcopy(self.plan['tests']['GF-T0']['attempts'])
        self.plan['tests']['GF-T0'].update(attempts=[],receipts=[],status='planned')
        self.commit_plan()  # Still reject a removal after it is committed.
        self.rejects('immutable attempt history')
        self.plan['tests']['GF-T0'].update(attempts=original,receipts=[path.relative_to(self.root).as_posix()],status='failed')
        self.assertEqual(self.errors(), [])
        data['limitations'] = ['Changed after capture']; path.write_text(json.dumps(data)); self.pin_attempt(path,'failed')
        self.rejects('immutable attempt history')

    def test_failed_attempt_can_be_followed_by_new_pass_without_erasing_failure(self):
        path, data = self.failed_attempt(); self.commit_plan()
        new_path = path.with_name('retry.json'); data['status'] = 'passed'; data['exitCode'] = 0
        data['expectedActual'][0]['result'] = 'passed'; new_path.write_text(json.dumps(data))
        self.pin_attempt(new_path, 'passed', 'attempt-2')
        self.plan['tests']['GF-T0'].update(status='passed',receipts=[new_path.relative_to(self.root).as_posix()])
        self.assertEqual(self.errors(), [])
        self.plan['tests']['GF-T0']['attempts'].reverse(); self.rejects('immutable attempt history')

    def rc_chain(self):
        gate0, path, data = self.complete_first_gate()
        gate4 = self.plan['gates'][1]; gate4['id'] = 'GF4'; gate4.update(status='complete',evidence=gate0['evidence'][:])
        self.approve_gate(gate4)
        gate5 = copy.deepcopy(gate4); gate5.update(id='GF5',dependsOn=['GF4'])
        self.plan['gates'].insert(2,gate5); self.plan['gates'][3]['dependsOn'] = ['GF5']
        self.plan['releases']['finale_v1']['requires'] = ['GF0','GF4','GF5']
        self.plan['releases']['full_product']['requires'] = ['GF0','GF4','GF5','FP-LEARN']
        for dep in self.plan['humanDependencies'][:3]: dep['neededFor'] = ['GF5']
        self.plan['releaseCandidate'] = {'status':'pinned','commit':self.commit}; self.plan['nextGate'] = None
        data['runAt'] = '2026-09-24T10:05:00Z'; data['review']['reviewedAt'] = '2026-09-24T10:06:00Z'
        new_path = path.with_name('rc.json'); new_path.write_text(json.dumps(data))
        self.pin_attempt(new_path, 'passed', 'rc-attempt')
        self.plan['tests']['GF-T0']['receipts'] = [new_path.relative_to(self.root).as_posix()]
        gate5['evidence'] = [new_path.relative_to(self.root).as_posix()]
        self.designate_owner()
        self.approve_gate(gate5,self.owner_identity(),at='2026-09-24T10:07:00Z',completed='2026-09-24T10:08:00Z')
        return gate5, new_path, data

    def test_exact_rc_fresh_after_approved_gf4_and_retained_early_receipts(self):
        self.rc_chain(); self.assertEqual(self.errors(), [])

    def test_gf5_requires_owner_and_full_rc_sha(self):
        gate, _, _ = self.rc_chain()
        self.approve_gate(gate,at='2026-09-24T10:07:00Z',completed='2026-09-24T10:08:00Z')
        self.rejects('requires designated human owner approval')
        self.plan['releaseCandidate']['commit'] = 'abcd'; self.rejects('must pin full commit SHA')
        self.plan['releaseCandidate']['commit'] = '0'*40; self.rejects('not a verified ancestor of HEAD')

    def test_gf5_rejects_stale_rc_and_pre_gf4_execution(self):
        gate, path, data = self.rc_chain()
        data['runAt'] = '2026-09-24T10:04:00Z'; path.write_text(json.dumps(data)); self.pin_attempt(path,'passed','rc-attempt')
        self.rejects('receipts must run after evidenced GF4 completion')
        self.plan['releaseCandidate'] = {'status':'pending','commit':None}
        self.rejects('every receipt must use exact releaseCandidate.commit')

    def test_gf5_cannot_trust_status_timestamp_without_gf4_evidence_approval(self):
        self.rc_chain(); self.plan['gates'][1]['approvedBy'] = None
        self.rejects('receipts must run after evidenced GF4 completion')
        self.plan['gates'][1]['evidence'] = []; self.rejects('complete without evidence')

    def test_rc_pending_has_no_invented_commit(self):
        self.assertEqual(self.errors(), [])
        self.plan['releaseCandidate']['commit'] = self.commit
        self.rejects('pending commit must be explicit null')

    def test_malformed_governance_is_a_validation_error(self):
        for key in ('waivers','humanDependencies'):
            original = self.plan[key]; self.plan[key] = 'not-an-array'
            self.rejects('must be an array'); self.plan[key] = original
        self.plan['tests']['GF-T0']['attempts'] = None; self.rejects('attempts: must be an array')


    def test_completion_cannot_hide_current_open_test_behind_old_attempt(self):
        self.complete_first_gate()
        self.plan['tests']['GF-T0'].update(status='planned', receipts=[])
        self.rejects('complete without passed tests')

    def test_plan_validation_requires_code_commit_time_and_all_tool_sources(self):
        path, data = self.plan_validation_receipt()
        data['codeCommit'] = '0'*40; path.write_text(json.dumps(data))
        self.rejects('planValidation: codeCommit is not a verified ancestor')
        data['codeCommit'] = self.commit; data['checkedAt'] = '2999-01-01T00:00:00Z'
        path.write_text(json.dumps(data)); self.rejects('timestamp is in the future')
        helper = self.h/'tools/new_helper.py'; helper.parent.mkdir(); helper.write_bytes(b'# metadata helper\n')
        path, data = self.plan_validation_receipt(); self.rejects('filesSha256 omits active plan inputs')
        data['filesSha256'][helper.relative_to(self.root).as_posix()] = hashlib.sha256(helper.read_bytes()).hexdigest()
        path.write_text(json.dumps(data)); self.rejects('codeCommit does not contain checked source')
        self.commit_plan()
        path, data = self.plan_validation_receipt()
        data['filesSha256'][helper.relative_to(self.root).as_posix()] = hashlib.sha256(helper.read_bytes()).hexdigest()
        path.write_text(json.dumps(data)); self.assertEqual(self.errors(), [])

    def test_gf5_rejects_another_valid_ancestor_instead_of_the_rc(self):
        gate, _, _ = self.rc_chain()
        self.commit_plan()
        self.plan['releaseCandidate']['commit'] = subprocess.check_output(
            ['git','-C',str(self.root),'rev-parse','HEAD'],text=True).strip()
        self.approve_gate(gate,self.owner_identity(),at='2026-09-24T10:07:00Z',completed='2026-09-24T10:08:00Z')
        self.rejects('every receipt must use exact releaseCandidate.commit')

if __name__ == '__main__':
    unittest.main()
