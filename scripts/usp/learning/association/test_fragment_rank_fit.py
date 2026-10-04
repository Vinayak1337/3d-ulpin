"""Focused CPU controls. All tokenizer/tensor/model/proof work uses doubles.

Run with -B -I -S. Real retained train publication, donor metadata and sources;
no runtime/model/tokenizer bytes or actual stage/native/resource effects.
"""
from __future__ import annotations

import builtins
import contextlib
import copy
import io
import json
import math
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "services/geo"), str(REPO / "scripts/usp/learning"), str(Path(__file__).resolve().parent)]
REAL_IMPORT = builtins.__import__
BLOCKED = {"torch", "transformers", "peft", "accelerate", "safetensors", "numpy", "psutil"}


def cpu_import(name, *args, **kwargs):
    if name.split(".")[0] in BLOCKED:
        raise AssertionError("native import forbidden in CPU controls: " + name)
    return REAL_IMPORT(name, *args, **kwargs)


builtins.__import__ = cpu_import
from geo.usp_learning.association import adapter, fragment_rank_adapter as authority, fragment_rank_fit as fit_helpers
from geo.usp_learning.association import fragment_adapter, fragment_support_v2, citation_view
from geo.usp_learning.association.validation import InvalidEvidence
import association_adapter as dispatcher
import stage_fragment_adapter as stager
import stage_fragment_rank as entry


class StopEffect(Exception):
    pass


class TokenizerDouble:
    all_special_ids = [0]
    chunk_size = 32

    def __init__(self):
        self.tokens, self.prompts, self.messages_seen = {48: "0", 49: "1"}, {}, []

    def apply_chat_template(self, messages, *, tokenize, add_generation_prompt):
        assert tokenize is False and add_generation_prompt is True
        assert [m["role"] for m in messages] == ["system", "user"]
        self.messages_seen.append(copy.deepcopy(messages))
        prompt = messages[0]["content"] + "\n" + messages[1]["content"] + "\nASSISTANT:"
        ids = []
        # Artificial reversible chunks. These lengths do not qualify the real tokenizer.
        for i in range(0, len(prompt), self.chunk_size):
            token = len(self.tokens) + 100
            self.tokens[token] = prompt[i:i + self.chunk_size]
            ids.append(token)
        self.prompts[prompt] = ids
        return prompt

    def encode(self, text, *, add_special_tokens):
        assert add_special_tokens is False
        if text in self.prompts:
            return list(self.prompts[text])
        return [*self.prompts[text[:-1]], ord(text[-1])]

    def decode(self, ids, **kwargs):
        return "".join(self.tokens[i] for i in ids)


class Scalar:
    """Two-variable forward derivatives; not a floating point/native emulator."""
    def __init__(self, value, derivative=(0., 0.), root=None):
        self.value, self.derivative, self.root = float(value), derivative, root

    def __add__(self, other):
        other = other if isinstance(other, Scalar) else Scalar(other)
        assert self.root is None or other.root is None or self.root is other.root
        return Scalar(self.value + other.value, tuple(a + b for a, b in zip(self.derivative, other.derivative)),
                      self.root if self.root is not None else other.root)

    def __mul__(self, other):
        return Scalar(self.value * other, tuple(a * other for a in self.derivative), self.root)


class TensorDouble:
    def __init__(self, values, shape=None, dtype="float32", root=None):
        self.values = [v if isinstance(v, Scalar) else Scalar(v) for v in values]
        self.shape = shape if shape is not None else (len(values),)
        self.dtype, self.root = dtype, root

    def __getitem__(self, key):
        index = key[-1] if isinstance(key, tuple) else key
        return TensorDouble([self.values[index]], (), self.dtype)

    def __add__(self, other):
        return TensorDouble([v + other for v in self.values], self.shape, self.dtype)

    def __mul__(self, other):
        return TensorDouble([v * other for v in self.values], self.shape, self.dtype)

    def __truediv__(self, other):
        return self * (1 / other)

    def __neg__(self):
        return self * -1

    def __float__(self):
        assert self.shape == ()
        return self.values[0].value

    def to(self, *, dtype):
        return TensorDouble(self.values, self.shape, dtype)

    def reshape(self, *shape):
        return TensorDouble(self.values, shape, self.dtype)

    def detach(self):
        return TensorDouble([v.value for v in self.values], self.shape, self.dtype)

    def cpu(self):
        return self

    def tolist(self):
        return [v.value for v in self.values]

    def backward(self):
        assert self.shape == ()
        value = self.values[0]
        if value.root is not None:
            for i in (0, 1):
                value.root[i] += value.derivative[i]

    @property
    def grad(self):
        return None if self.root is None else TensorDouble(self.root)


class BoolDouble:
    def __init__(self, value):
        self.value = value

    def __bool__(self):
        return self.value

    def all(self):
        return self.value


class TorchDouble:
    float32, float16, long = "float32", "float16", "long"
    cuda = NS(synchronize=lambda: None)

    def __init__(self):
        self.nn = NS(functional=NS(log_softmax=self.log_softmax), utils=NS(clip_grad_norm_=lambda *a, **k: 1.0))

    def tensor(self, values, *, dtype, device, requires_grad=False):
        shape = (len(values), len(values[0])) if isinstance(values[0], list) else (len(values),)
        flat = sum(values, []) if len(shape) == 2 else values
        root = [0., 0.] if requires_grad else None
        return TensorDouble([Scalar(v, tuple(float(j == i) for j in (0, 1)) if requires_grad else (0., 0.), root)
                             for i, v in enumerate(flat)], shape, dtype, root)

    def stack(self, tensors):
        assert all(t.shape == () for t in tensors)
        return TensorDouble([t.values[0] for t in tensors])

    def isfinite(self, tensor):
        return BoolDouble(all(math.isfinite(v.value) for v in tensor.values))

    def count_nonzero(self, tensor):
        return sum(v.value != 0 for v in tensor.values)

    def log_softmax(self, pair, *, dim):
        assert dim == 0 and pair.shape == (2,) and pair.dtype == self.float32
        a, b = pair.values
        maximum = max(a.value, b.value)
        ea, eb = math.exp(a.value - maximum), math.exp(b.value - maximum)
        normalizer = math.log(ea + eb)
        derivative = tuple((ea * x + eb * y) / (ea + eb) for x, y in zip(a.derivative, b.derivative))
        return TensorDouble([Scalar(v.value - maximum - normalizer, tuple(x - y for x, y in zip(v.derivative, derivative)), v.root)
                             for v in (a, b)])

    def autocast(self, *args, **kwargs):
        return contextlib.nullcontext()

    def ones_like(self, tensor):
        return TensorDouble([1] * len(tensor.values), tensor.shape, self.long)


class Controls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.packet = json.loads(Path('C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin/docs/evidence/usp/ml-distillation/student-28.fragment-rank-fit-code.assignment.json').read_bytes())
        cls.pins = {name: authority.sha((REPO / name).read_bytes()) for name in authority.SOURCE_PATHS}
        cls.canonical = {name: authority.sha((REPO / name).read_bytes().replace(b'\r\n', b'\n')) for name in authority.SOURCE_PATHS}
        prototype = authority.disabled_prototype('0' * 40, cls.canonical)
        cls.assignment = {k: prototype[k] for k in ('action', 'model', 'revision', 'modelWeightsSha256', 'runtimeProfileSha256',
            'modelProfileSha256', 'publicationSha256', 'inputArtifactSha256', 'settings', 'numerics', 'inferenceSettings',
            'representation', 'trainingPlan', 'memoryExecutionPolicy', 'attentionControlBeforeFit', 'lossImplementation', 'runtimeCodeCanonicalLfSha256')}
        cls.assignment.update(version=authority.VERSIONS['fit'][0], task=authority.TASKS['fit'], executable=True,
            executionAllowance=authority.allowance('fit'), studentCodeCommit='0' * 40)
        cls.raw = authority.serialized(cls.assignment)
        cls.freeze = authority.make_freeze(cls.assignment, cls.raw, cls.pins)
        cls.sources = authority.stage_sources(Path('cpu-assignment.json'), cls.raw, stager.BASELINE, stager.RUNTIME)
        cls.payload = {name: path.read_bytes() for name, (path, _) in cls.sources.items() if name in authority.PAYLOAD_PINS}
        cls.schema, cls.contract, cls.family, cls.rows = authority.checked_payload(cls.payload)
        cls.inputs = REPO / 'CPU_VIRTUAL_INPUTS_NOT_CREATED'
        cls.virtual = {cls.inputs / name: raw for name, raw in cls.payload.items()}
        cls.virtual.update({cls.inputs / 'assignment.json': cls.raw, cls.inputs / 'run-freeze.json': authority.serialized(cls.freeze),
            cls.inputs / 'runtime-requirements-resolved.txt': cls.sources['runtime-requirements-resolved.txt'][0].read_bytes()})

    @contextlib.contextmanager
    def virtual_inputs(self, mapping=None):
        real_read, real_iter, real_open = Path.read_bytes, Path.iterdir, Path.open
        values = self.virtual if mapping is None else mapping
        def virtual_open(path, mode='r', *args, **kwargs):
            if path in values:
                assert mode == 'rb', 'virtual inputs are read-only'
                return io.BytesIO(values[path])
            return real_open(path, mode, *args, **kwargs)
        with patch.object(Path, 'read_bytes', lambda p: values[p] if p in values else real_read(p)), \
             patch.object(Path, 'iterdir', lambda p: iter(values) if p == self.inputs else real_iter(p)), \
             patch.object(Path, 'open', virtual_open):
            yield

    def refused(self, operation):
        with self.assertRaises((InvalidEvidence, RuntimeError, KeyError, ValueError)):
            operation()

    def test_real_authority_stage_and_dispatch_before_effects(self):
        self.assertEqual(len(authority.SOURCE_PATHS), 33)
        self.assertEqual(len(authority.PROTECTED_PINS), 27)
        for name, pins in self.packet['protectedExistingSourcePins'].items():
            raw = (REPO / name).read_bytes()
            self.assertEqual(authority.sha(raw), pins['physicalSha256'])
            self.assertEqual(authority.sha(raw.replace(b'\r\n', b'\n')), pins['canonicalLfSha256'])
        for spec in self.packet['trainOnlyAuthorities'].values():
            self.assertEqual(authority.sha(Path(spec['path']).read_bytes()), spec['physicalSha256'])
        stager.donor_metadata()  # Real profile metadata only.
        self.assertEqual(dispatcher.representation_module(self.freeze, self.assignment), authority)
        with self.virtual_inputs():
            self.assertEqual(authority.checked_inputs(self.freeze, self.assignment, self.inputs)[3], self.rows)
            authority.admit_fit({'freeze': self.freeze, 'assignment': self.assignment, 'inputs': self.inputs}, self.rows, self.contract, self.family)
        # Real stage admission/source checks/payload/make_freeze; future Git replies doubled.
        def git_reply(command, **kwargs):
            if command[1:3] == ['rev-parse', 'HEAD']:
                return '0' * 40
            if command[1] == 'status':
                return ''
            self.assertEqual(command[1], 'show')
            return (REPO / command[2].split(':', 1)[1]).read_bytes().replace(b'\r\n', b'\n')
        effects = []
        def mkdir(path, *args, **kwargs):
            effects.append(str(path))
            raise StopEffect()
        with self.virtual_inputs(), patch.object(stager.subprocess, 'check_output', git_reply), \
             patch.object(Path, 'mkdir', mkdir), patch.object(stager.shutil, 'disk_usage', return_value=NS(free=20 * 1024**3)):
            with self.assertRaises(StopEffect):
                entry.stage(self.inputs / 'assignment.json')
        self.assertEqual(len(effects), 1)
        args = NS(action='fit', adapter_dir=None, run_freeze=self.inputs / 'run-freeze.json', output_dir=self.inputs / 'OUTPUT',
                  input_batch=None, adapter_manifest=None, fit_proof=None)
        for key, name in authority.input_names('fit').items():
            setattr(args, key, self.inputs / name)
        with self.virtual_inputs(), patch.object(dispatcher, 'require_model_boundary'), patch.object(Path, 'mkdir', mkdir):
            with self.assertRaises(StopEffect):
                dispatcher.worker(args)
        self.assertEqual(len(effects), 2)
        cli = ['association_adapter.py', 'fit']
        for key, name in authority.input_names('fit').items():
            cli.extend(['--' + key.replace('_', '-'), str(self.inputs / name)])
        cli.extend(['--run-freeze', str(args.run_freeze), '--output-dir', str(args.output_dir),
                    '--containment-profile', str(self.inputs / 'profile.json'), '--containment-sha256', '0' * 64])
        with self.virtual_inputs(), patch.object(sys, 'argv', cli), \
             patch.object(dispatcher, 'guarded_run', side_effect=StopEffect()) as guard:
            with self.assertRaises(StopEffect):
                dispatcher.main()
            guard.assert_called_once()
        # Shared fit authority and row path stops immediately before native imports.
        phases = NS(sample=lambda *a, **k: (_ for _ in ()).throw(StopEffect()))
        with self.virtual_inputs(), self.assertRaises(StopEffect):
            adapter.fit(self.rows, self.contract, self.family, None, None, lambda: None, None, phases,
                rank_authority={'freeze': self.freeze, 'assignment': self.assignment, 'inputs': self.inputs})

    def test_default_off_mixed_drift_and_legacy_dispatch(self):
        self.refused(lambda: authority.checked_execution(self.packet, 'fit'))
        prototype = authority.disabled_prototype('0' * 40, self.canonical)
        self.assertFalse(prototype['executable'])
        self.assertFalse({'executionAllowance', 'studentCodeCommit', 'command', 'stageCommand', 'runCommand'} & prototype.keys())
        self.refused(lambda: authority.checked_execution(prototype, 'fit'))
        for changed in ({'executable': False}, {'action': 'reload'}, {'version': 'association-fragment-rank-fit-assignment/99'},
                        {'trainingPlan': {}}, {'development': []}, {'runtimeCodeCanonicalLfSha256': {}}):
            value = {**self.assignment, **changed}
            self.refused(lambda: authority.checked_execution(value, 'fit'))
        self.refused(lambda: dispatcher.representation_module({'version': 'association-fragment-rank-reload-freeze/1'}, self.assignment))
        self.refused(lambda: dispatcher.representation_module({}, self.assignment))
        bad = dict(self.payload); bad[authority.DATA_NAME] += b'\n'
        self.refused(lambda: authority.checked_payload(bad))
        bad_inputs = dict(self.virtual); bad_inputs[self.inputs / 'unexpected-development.json'] = b'{}'
        with self.virtual_inputs(bad_inputs):
            self.refused(lambda: authority.checked_inputs(self.freeze, self.assignment, self.inputs))
        self.assertIsNone(dispatcher.representation_module({}, {}))
        for module, version in ((fragment_adapter, 'association-fragment-fit-freeze/1'),
                                (fragment_support_v2, 'association-fragment-support-fit-freeze/2')):
            with patch.object(module, 'checked_freeze') as check:
                self.assertIs(dispatcher.representation_module({'version': version}, {}), module)
                check.assert_called_once()
        # Generative fit retains its row/plan path, doubled validator and pre-import stop.
        phases = NS(sample=lambda *a, **k: (_ for _ in ()).throw(StopEffect()))
        with patch.object(adapter, 'validate_output') as validate, self.assertRaises(StopEffect):
            adapter.fit([{'input': {}, 'output': {}}] * 11, {}, {}, None, None, lambda: None, None, phases)
        self.assertEqual(validate.call_count, 11)

    def test_complete_train_prompt_and_parent_controls(self):
        tokenizer, failed = TokenizerDouble(), []
        representation = authority.RankRepresentation(self.rows)
        encoded, lengths = fit_helpers.encode_training(tokenizer, self.rows, representation, failed.append)
        self.assertEqual(failed, [])
        self.assertEqual(len(tokenizer.messages_seen), 57)
        expected = [candidate['scoringInput'] for row in self.rows for candidate in row['candidates']]
        self.assertEqual([json.loads(messages[1]['content']) for messages in tokenizer.messages_seen], expected)
        plan = authority.training_plan()
        updates, candidates, losses = [], [], []
        for order in citation_view.epoch_orders(plan):
            self.assertEqual(sorted(order), list(range(10)))
            for index in order:
                item = encoded[index]
                def contribution(candidate):
                    candidates.append((index, candidate['record']['candidateIndex']))
                    return 1 / candidate['weight']['denominator']
                losses.append(fit_helpers.accumulate_parent(item['parent'], item['sha256'], contribution, updates.append))
        self.assertEqual((len(updates), len(candidates)), (60, 342))
        self.assertEqual(fit_helpers.epoch_sums(losses, plan), [1.0] * 6)
        self.assertEqual([row['candidateCount'] for row in lengths], list(authority.PARENT_COUNTS.values()))
        first = encoded[0]
        for mutation in ('omit', 'duplicate', 'reorder', 'label', 'weight', 'prefix', 'length'):
            parent = copy.deepcopy(first['parent']); vector = parent['candidates']
            if mutation == 'omit': vector.pop()
            elif mutation == 'duplicate': vector[1] = copy.deepcopy(vector[0])
            elif mutation == 'reorder': vector.reverse()
            elif mutation == 'label': vector[0]['label'] = 2
            elif mutation == 'weight': vector[0]['weight']['denominator'] = 1
            elif mutation == 'prefix': vector[0]['inputIds'][0] += 1
            else: vector[0]['inputIds'] *= 4096
            self.refused(lambda: fit_helpers.accumulate_parent(parent, first['sha256'], lambda c: self.fail('forward after drift'), self.fail))
        partial = []
        self.refused(lambda: fit_helpers.accumulate_parent(first['parent'], first['sha256'], lambda c: float('nan'), partial.append))
        self.assertEqual(partial, [])
        bad_rows = copy.deepcopy(self.rows); bad_rows[0]['candidates'].pop()
        self.refused(lambda: fit_helpers.encode_training(TokenizerDouble(), bad_rows, representation, failed.append))
        self.assertFalse(failed[-1]['labelBoundaryVerified'])
        class PrefixDrift(TokenizerDouble):
            def encode(self, text, **kwargs):
                ids = super().encode(text, **kwargs)
                return ids if text in self.prompts else [999, *ids[1:]]
        self.refused(lambda: fit_helpers.encode_training(PrefixDrift(), self.rows, representation, failed.append))
        long_tokens = TokenizerDouble(); long_tokens.chunk_size = 1
        self.refused(lambda: fit_helpers.encode_training(long_tokens, self.rows, representation, failed.append))
        self.assertIn('4096', failed[-1]['error'])

    def test_actual_loss_accumulation_and_training_helper_with_doubles(self):
        torch = TorchDouble()
        receipts, phases = [], NS(sample=lambda *a, **k: None)
        proof = fit_helpers.run_equivalence(torch, Path('VIRTUAL_OUTPUT'), lambda p, v: receipts.append((p.name, v)), phases)
        self.assertTrue(proof['passed'])  # Doubled control only; no native qualification.
        self.assertEqual(len(proof['records']), 4)
        encoded, _ = fit_helpers.encode_training(TokenizerDouble(), self.rows, authority.RankRepresentation(self.rows), self.fail)
        parent = encoded[0]
        theta = torch.tensor([0., 0.], dtype=torch.float32, device='double', requires_grad=True)
        events, seen, steps = [], [], []
        state = {}
        offsets = [(2., -3.), (0., 0.), (-4., 1.), (1., 2.)]
        class Hidden:
            def __getitem__(self, key):
                assert key == (slice(None), slice(-1, None), slice(None))
                return self
        def decoder(**kwargs):
            index = state['index']
            self.assertEqual(kwargs['input_ids'].tolist(), parent['parent']['candidates'][index]['inputIds'])
            self.assertEqual(kwargs['attention_mask'].tolist(), [1] * len(kwargs['input_ids'].values))
            self.assertFalse(kwargs['use_cache'])
            seen.append(index)
            return NS(last_hidden_state=Hidden())
        def head(hidden):
            a, b = offsets[state['index']]
            logits = [theta[0] * 0 for _ in range(50)]
            logits[48], logits[49] = theta[0] + a, theta[1] + b
            return torch.stack(logits).reshape(1, 1, 50).to(dtype=torch.float16)
        def begin(context, tokens):
            state['index'] = context['candidateIndex']
            events.append('candidate')
        attention = NS(begin=begin, snapshot=lambda kind: [])
        scaler = NS(scale=lambda loss: loss * 128, unscale_=lambda opt: events.append('unscale'),
            get_scale=lambda: 128, step=lambda opt: steps.append(1), update=lambda: events.append('scale-update'))
        def complete(total):
            reference = [math.fsum(fit_helpers.analytic_gradient(a, b, c['label'])[i] / 40 for (a, b), c in
                                  zip(offsets, parent['parent']['candidates'])) for i in (0, 1)]
            for actual, expected in zip((theta.grad / 128).tolist(), reference):
                self.assertAlmostEqual(actual, expected, places=12)
            adapter._optimizer_step(torch, scaler, None, [('theta', theta)], [('frozen', NS(grad=None))], phases, {}, first=True)
        with patch.object(fit_helpers, 'release_unused_cache', return_value={}):
            total = fit_helpers.train_parent(parent, model=NS(_enable_peft_forward_hooks=lambda **k: contextlib.nullcontext()),
                decoder=decoder, head=head, torch=torch, scaler=scaler, attention=attention, phases=phases,
                gpu_check=lambda: None, context={}, complete=complete)
        self.assertEqual(seen, [0, 1, 2, 3])
        self.assertEqual(steps, [1])
        self.assertEqual(events, ['candidate'] * 4 + ['unscale', 'scale-update'])
        self.assertAlmostEqual(total, math.fsum(authority.rank.binary_loss(a, b, c['label']) / 40 for (a, b), c in
                                               zip(offsets, parent['parent']['candidates'])), places=12)
        for bad_logits in (torch.tensor([[float('nan'), 0]], dtype=torch.float32, device='double').reshape(1, 1, 2),
                           torch.tensor([[0, 1]], dtype=torch.float32, device='double')):
            self.refused(lambda: fit_helpers.weighted_nll(bad_logits, {'0': 0, '1': 1}, 1, {'numerator': 1, 'denominator': 40}, torch))
        # Earlier proof receipt stays intact when the next proof fails.
        prior = copy.deepcopy(receipts)
        with patch.object(torch.nn.functional, 'log_softmax', side_effect=RuntimeError('synthetic failure')):
            self.refused(lambda: fit_helpers.run_equivalence(torch, Path('LATER_OUTPUT'), lambda p, v: receipts.append((p.name, v)), phases))
        self.assertEqual(receipts[:len(prior)], prior)
        self.assertFalse(receipts[-1][1]['passed'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
