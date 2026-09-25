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
        (self.root / 'check.py').write_text('# validator\n')
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
        self.plan['entryPoints'].append(str(p.relative_to(self.root)))
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
              'artifacts':[{'path':str(artifact.relative_to(self.root)),
                            'sha256':hashlib.sha256(artifact.read_bytes()).hexdigest()}]}
        path.write_text(json.dumps(data))
        self.plan['tests']['GF-T0'].update(status='passed',receipts=[str(path.relative_to(self.root))])
        return path,data

    def test_valid_runtime_receipt_and_complete_gate(self):
        path,_=self.passing_runtime_receipt()
        self.plan['gates'][0].update(status='complete',evidence=[str(path.relative_to(self.root))])
        self.plan['nextGate']='GF1'
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
        data['executionId'] = 'run-1'; path.write_text(json.dumps(data))
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
        data['codeCommit'] = self.commit; path.write_text(json.dumps(data))
        self.assertEqual(self.errors(), [])

    def test_receipt_rejects_future_execution_or_review(self):
        path, data = self.passing_runtime_receipt()
        for field in ('runAt', 'reviewedAt'):
            target = data if field == 'runAt' else data['review']
            old = target[field]; target[field] = '2999-01-01T00:00:00Z'
            path.write_text(json.dumps(data)); self.rejects('timestamp is in the future')
            target[field] = old
        path.write_text(json.dumps(data)); self.assertEqual(self.errors(), [])

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
        path.write_text(json.dumps(original)); self.assertEqual(self.errors(), [])

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
        path.write_text(json.dumps(data)); self.assertEqual(self.errors(), [])
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
        paths = [validator.PLAN, 'check.py'] + [str(p.relative_to(self.root)) for p in self.h.rglob('*.md')]
        data = {'filesSha256':{p:hashlib.sha256((self.root/p).read_bytes()).hexdigest() for p in paths}}
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


if __name__ == '__main__':
    unittest.main()
