"""Small CPU-only controls. Vocabulary bytes are read, never tokenized natively."""
import ast
import copy
import ctypes
from ctypes import wintypes
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "services/geo"), str(REPO / "scripts/usp/learning"), str(Path(__file__).resolve().parent)]
from geo.usp_learning.association import selector_constraints as constraint, selector_adapter
from geo.usp_learning.association.selectors import canonical, checked_schema, context, project
from geo.usp_learning.association.validation import InvalidEvidence
import stage_selector_adapter as staging
import association_adapter as cli

ROOT = Path("E:/BhuAayam-data/task-data/ml-distillation/student/adapter-selector-reload-5c4c5b3f14154294ae01760e60d04b7d")
COORDINATOR = Path("C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin")
PREP = COORDINATOR / "docs/evidence/usp/ml-distillation/student-11.selector-constraints-preparation.assignment.json"
METRICS = {}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def document(claims=(), decisions=(), conflicts=()):
    return {"abstentions": [{"citations": [], "code": "no_canonical_targets"}, *decisions],
            "canonicalLinks": [], "claims": list(claims), "conflicts": list(conflicts),
            "version": "evidence-association-selectors/1"}


def claim(citations, literal, role="building", state="declared", unit=None):
    return dict(citations=citations, literal=literal, role=role, state=state, unit=unit)


class TensorFixture:
    def __init__(self, values):
        self.values = values

    def tolist(self):
        return list(self.values)


class ConstraintTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert digest(PREP.read_bytes()) == "8adbfddb0a2405236c3c3d47769dd64418f53b74f659a0a5533bfafe0ea78f28"
        cls.schema = checked_schema((ROOT / "inputs/selector-schema-v1.json").read_bytes())
        cls.contract = json.loads((ROOT / "inputs/schema-v1.json").read_bytes())
        cls.family = json.loads((ROOT / "inputs/family-freeze.json").read_bytes())
        train_bytes = (staging.TEACHER / "train-teacher-selectors-v1.jsonl").read_bytes()
        assert digest(train_bytes) == selector_adapter.DATA_SHA
        # Only source inputs are consumed; no teacher output or expectation enters the controller.
        cls.train_input = json.loads(train_bytes.splitlines()[1])["input"]
        development_bytes = (ROOT / "inputs/development.json").read_bytes()
        assert digest(development_bytes) == selector_adapter.BATCH_SHA
        cls.dev_input = json.loads(development_bytes)["examples"][0]
        cls.train = context(cls.train_input, cls.contract, cls.family, ("train",))
        cls.dev = context(cls.dev_input, cls.contract, cls.family, ("development",))
        started = time.perf_counter()
        cls.vocab = constraint.Vocabulary(ROOT / "model")
        METRICS.update(vocabularyBuildSeconds=time.perf_counter() - started, trieNodes=len(cls.vocab.first),
                       compactTrieArrayBytes=sum(len(a) * a.itemsize for a in (cls.vocab.first, cls.vocab.next, cls.vocab.terminal)) + len(cls.vocab.label),
                       vocabularyPayloadBytes=sum(map(len, cls.vocab.token_bytes)),
                       trainingInputSha256=cls.train.input_sha256, developmentInputSha256=cls.dev.input_sha256,
                       tokenizerPins=constraint.TOKENIZER_PINS, policy=constraint.metadata())

    def parse(self, value, source=None):
        grammar = constraint.Grammar(source or self.dev, self.schema)
        raw = value if isinstance(value, bytes) else canonical(value).encode()
        return grammar.feed(grammar.initial(), raw)

    def test_real_source_projection_and_snapshot_preservation(self):
        before = canonical(self.train_input), canonical(self.dev_input)
        # Technical source-copy fixture, not a model prediction or learning label.
        value = document([claim([[0, 0, 1]], [0, 0, 1])])
        raw = canonical(value)
        self.assertFalse(self.parse(value, self.train).ops)
        checked = project(raw, self.train, self.schema, self.contract, self.family, ("train",))
        self.assertTrue(checked["modelOutputValid"])
        self.assertEqual(checked["acceptedProjection"]["claims"][0]["literal"], self.train_input["evidence"][0]["text"])
        self.assertFalse(self.parse(document()).ops)
        self.assertTrue(project(canonical(document()), self.dev, self.schema, self.contract, self.family, ("development",))["modelOutputValid"])
        # Grammar legality cannot infer the native semantic role/value.
        wrong = document([claim([[0, 0, 1]], [0, 0, 1], role="area")])
        self.assertFalse(self.parse(wrong).ops)
        self.assertFalse(project(canonical(wrong), self.dev, self.schema, self.contract, self.family, ("development",))["modelOutputValid"])
        self.assertEqual(before, (canonical(self.train_input), canonical(self.dev_input)))

    def test_fragment_range_coverage_state_and_integer_corruptions(self):
        legal = document([claim([[0, 0, 19]], [0, 10, 18], role="project")])
        self.assertFalse(self.parse(legal).ops)
        bad = [claim([[4, 0, 1]], None, state="unknown"), claim([[0, 0, 0]], None, state="unknown"),
               claim([[0, 5, 4]], None, state="unknown"), claim([[0, 0, 20]], None, state="unknown"),
               claim([[0, 0, 1]], [1, 0, 1]), claim([[0, 0, 1]], [0, 0, 2]),
               claim([[0, 0, 1]], [0, 0, 1], state="unknown"), claim([[0, 0, 1]], None),
               claim([[0, 0, 1]], None, state="null", unit=[0, 0, 1]),
               claim([[0, 0, 1], [0, 0, 1]], None, state="unknown")]
        for value in bad:
            self.assertIsNone(self.parse(document([value])), value)
        text = canonical(legal).encode()
        for value in (b"[false,0,19]", b"[-1,0,19]", b"[00,0,19]", b"[0,0.0,19]"):
            self.assertIsNone(self.parse(text.replace(b"[0,0,19]", value)))
        self.assertIsNone(self.parse(document(conflicts=[{"citations": [[0, 0, 1]], "code": "technical_control"}])))
        self.assertIsNotNone(self.parse(document(conflicts=[{"citations": [[0, 0, 1], [1, 0, 1]], "code": "technical_control"}])))
        # A single-token fragment already exhausted by a citation is unavailable.
        grammar = constraint.Grammar(self.train, self.schema)
        state = grammar.feed(grammar.initial(), canonical(document([claim([[0, 0, 1]], None, state="unknown")])).encode().split(b']],"literal"')[0] + b'],[')
        self.assertIsNotNone(state)
        self.assertIsNone(grammar.feed(state, b"0"))

    def test_utf8_escapes_and_eos_prefixes(self):
        grammar = constraint.Grammar(self.dev, self.schema)
        prefix = b'{"abstentions":[{"citations":[],"code":"no_canonical_targets"},{"citations":[],"code":"'
        suffix = b'"}],"canonicalLinks":[],"claims":[],"conflicts":[],"version":"evidence-association-selectors/1"}'
        for code in ('éह😀'.encode(), b'\\u00e9\\u0939\\uD83D\\uDE00', b'quote\\"slash\\/back\\\\tab\\t'):
            state = grammar.feed(grammar.initial(), prefix)
            for byte in code:
                state = grammar.step(state, byte)
                self.assertIsNotNone(state)
                self.assertTrue(state.ops)
            self.assertFalse(grammar.feed(state, suffix).ops)
        for invalid in (b'\xc0', b'\xe0\x80', b'\xed\xa0', b'\xf4\x90', b'\\uDC', b'\\uD800x', b'\\uD800\\u00', b'\n', b'"'):
            self.assertIsNone(grammar.feed(grammar.initial(), prefix + invalid), invalid)
        self.assertIsNone(grammar.feed(grammar.initial(), prefix + b'a' * 121))
        complete = self.parse(document())
        self.assertEqual(self.vocab.allowed(grammar, complete)[0], [self.vocab.eos_id])
        allowed, visits = self.vocab.allowed(grammar, grammar.feed(grammar.initial(), prefix + b'\xe2'))
        self.assertNotIn(self.vocab.eos_id, allowed)
        self.assertIn(self.vocab.single_bytes[0x82], allowed)
        self.assertNotIn(self.vocab.single_bytes[0x22], allowed)
        METRICS['partialUtf8MaskVisits'] = visits
        started = time.perf_counter()
        allowed, visits = self.vocab.allowed(grammar, grammar.feed(grammar.initial(), prefix))
        METRICS['freeCodeMask'] = {'seconds': time.perf_counter() - started, 'nodeVisits': visits, 'allowedTokens': len(allowed)}
        self.assertNotIn(self.vocab.eos_id, allowed)
        self.assertNotIn(self.vocab.single_bytes[34], allowed)  # Empty code is illegal.
        incomplete = prefix + b'\xe2'
        controller = constraint.Controller(self.vocab, self.dev, self.schema, [])
        receipt = controller.finish([self.vocab.single_bytes[b] for b in incomplete], incomplete.decode('utf-8', 'replace'))
        self.assertFalse(receipt['grammarComplete']); self.assertFalse(receipt['eosEmitted'])
        with patch.object(grammar, 'step', return_value=None):
            with self.assertRaisesRegex(InvalidEvidence, 'empty_allowed_set'):
                self.vocab.allowed(grammar, grammar.initial())

    def test_actual_vocabulary_callback_preserves_bytes_and_generated_only_boundary(self):
        raw = canonical(document([claim([[0, 0, 19]], [0, 10, 18], role="project")])).encode()
        # Greedy byte-trie fixture segmentation is not the native BPE encoder.
        ids, offset = [], 0
        while offset < len(raw):
            node, at, best = 0, offset, None
            while at < len(raw):
                child = self.vocab.first[node]
                while child >= 0 and self.vocab.label[child] != raw[at]:
                    child = self.vocab.next[child]
                if child < 0:
                    break
                node, at = child, at + 1
                if self.vocab.terminal[node] >= 0:
                    best = (at, self.vocab.terminal[node])
            self.assertIsNotNone(best)
            offset, index = best
            ids.append(index)
        prompt = [151644, 1234, 999]
        controller = constraint.Controller(self.vocab, self.dev, self.schema, prompt)
        generated = []
        for index in ids:
            allowed = controller(0, TensorFixture(prompt + generated))
            self.assertIn(index, allowed)
            self.assertNotIn(self.vocab.eos_id, allowed)
            generated.append(index)
        self.assertEqual(controller(0, TensorFixture(prompt + generated)), [self.vocab.eos_id])
        generated.append(self.vocab.eos_id)
        result = controller.finish(generated, raw.decode())
        self.assertTrue(result['grammarComplete']); self.assertTrue(result['eosEmitted'])
        self.assertEqual(result['generatedBytesSha256'], digest(raw))
        self.assertTrue(any(any(pair in self.vocab.token_bytes[i] for pair in (b'":', b'],', b'}]')) for i in ids))
        METRICS['representativeMask'] = result
        METRICS['representativeTokenCount'] = len(ids)
        empty = constraint.Controller(self.vocab, self.dev, self.schema, prompt)
        for bad_id in (self.vocab.eos_id, 151657, 151936):
            with self.assertRaises(InvalidEvidence):
                empty.finish([bad_id], '')
        with self.assertRaisesRegex(InvalidEvidence, 'prompt_changed'):
            empty(0, TensorFixture([0, 1234, 999]))
        with self.assertRaisesRegex(InvalidEvidence, 'batch_or_beam'):
            empty(1, TensorFixture(prompt))
        with self.assertRaisesRegex(InvalidEvidence, 'final_decode_mismatch'):
            constraint.Controller(self.vocab, self.dev, self.schema, prompt).finish(ids, raw.decode() + ' ')

    def test_policy_opt_in_freeze_prep_refusal_and_historical_projection(self):
        assignment = json.loads((ROOT / 'inputs/assignment.json').read_bytes())
        freeze = json.loads((ROOT / 'inputs/run-freeze.json').read_bytes())
        self.assertEqual(selector_adapter.checked_freeze(freeze, assignment), selector_adapter.training_plan())
        assignment['generationConstraints'] = constraint.metadata()
        with self.assertRaisesRegex(InvalidEvidence, 'unversioned'):
            selector_adapter.checked_execution(assignment, 'reload')
        assignment.update(version=constraint.EXECUTION_VERSION, task='STUDENT-11-CONSTRAINED-RELOAD')
        freeze.update(version=constraint.FREEZE_VERSION, generationConstraints=constraint.metadata())
        self.assertEqual(selector_adapter.checked_freeze(freeze, assignment), selector_adapter.training_plan())
        self.assertIs(cli.representation_module(freeze, assignment), selector_adapter)
        with self.assertRaises(InvalidEvidence):
            selector_adapter.checked_execution(assignment, 'fit')
        broken = copy.deepcopy(freeze); broken['generationConstraints']['policy']['states'] = 'relaxed'
        with self.assertRaisesRegex(InvalidEvidence, 'constraints_drift'):
            selector_adapter.checked_freeze(broken, assignment)
        with patch.object(Path, 'mkdir') as mkdir, patch.object(staging.isolation, 'sha', side_effect=AssertionError('runtime inspected')):
            with self.assertRaisesRegex(InvalidEvidence, 'separate_selector_adapter_execution_required'):
                staging.stage('reload', PREP)
            mkdir.assert_not_called()
        historical = json.loads((ROOT / 'outputs/reload/raw-0.json').read_bytes())
        checked = project(historical['rawText'], self.dev, self.schema, self.contract, self.family, ('development',))
        self.assertEqual(checked['errors'], [{'stage': 'selector_ranges', 'message': 'selector_fragment_range'}])
        self.assertEqual(checked['acceptedClaimCount'], 0)

    def test_single_existing_generation_loop_and_protected_source_bytes(self):
        tree = ast.parse((REPO / 'services/geo/geo/usp_learning/association/selector_baseline.py').read_bytes())
        generate_calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == 'generate']
        self.assertEqual(len(generate_calls), 1)
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'run_selectors')
        defaults = dict(zip((x.arg for x in function.args.kwonlyargs), function.args.kw_defaults))
        self.assertIsNone(ast.literal_eval(defaults['generation_constraints']))
        for relative in ('services/geo/geo/usp_learning/association/selectors.py',
                         'services/geo/geo/usp_learning/association/validation.py',
                         'services/geo/geo/usp_learning/association/adapter.py',
                         'scripts/usp/learning/model_isolation.py', 'services/geo/geo/usp_learning/resources.py'):
            original = subprocess.check_output(['git', 'show', '448d6ea04f7ff9dfe00a6f05c3a80390503c73fc:' + relative], cwd=REPO)
            self.assertEqual((REPO / relative).read_bytes().replace(b'\r\n', b'\n'), original)
        self.assertFalse({'torch', 'transformers', 'tokenizers', 'peft', 'safetensors'} & set(sys.modules))


def process_memory():
    class Counters(ctypes.Structure):
        _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD)] + [(name, ctypes.c_size_t) for name in
            ('PeakWorkingSetSize', 'WorkingSetSize', 'QuotaPeakPagedPoolUsage', 'QuotaPagedPoolUsage',
             'QuotaPeakNonPagedPoolUsage', 'QuotaNonPagedPoolUsage', 'PagefileUsage', 'PeakPagefileUsage', 'PrivateUsage')]
    api = ctypes.WinDLL('psapi', use_last_error=True); kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    api.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    counters = Counters(); counters.cb = ctypes.sizeof(counters)
    if not api.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
        raise ctypes.WinError(ctypes.get_last_error())
    return {'peakWorkingSetBytes': counters.PeakWorkingSetSize, 'workingSetBytes': counters.WorkingSetSize,
            'privateCommittedBytes': counters.PrivateUsage, 'method': 'GetProcessMemoryInfo current CPU test process'}


if __name__ == '__main__':
    started = time.perf_counter()
    result = unittest.main(verbosity=2, exit=False)
    METRICS.update(testsRun=result.result.testsRun, passed=result.result.wasSuccessful(),
                   elapsedSeconds=time.perf_counter() - started, memory=process_memory(),
                   nativeTokenizerOrModelImported=False, nativeTransportQualification='deferred to separately authorized contained run')
    print(json.dumps(METRICS, sort_keys=True))
    raise SystemExit(0 if result.result.wasSuccessful() else 1)
