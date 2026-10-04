"""Stdlib-only checkpoint/admission controls; native serialization/equivalence unrun.

Tensor/autograd/device/safetensors codec and stochastic optimizer are modeled.
Real retained train metadata is used; Git/guard/filesystem launch edges are doubled.
"""
from __future__ import annotations

import builtins
import contextlib
import copy
import io
import json
import math
from pathlib import Path
import random
import stat
import struct
import sys
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "services/geo"), str(REPO / "scripts/usp/learning"), str(Path(__file__).resolve().parent)]
REAL_IMPORT = builtins.__import__


def stdlib_only(name, *args, **kwargs):
    if name.split(".")[0] in {"torch", "transformers", "peft", "accelerate", "safetensors", "numpy", "psutil"}:
        raise AssertionError("native import blocked: " + name)
    return REAL_IMPORT(name, *args, **kwargs)


builtins.__import__ = stdlib_only
from geo.usp_learning.association import adapter, fragment_rank_adapter as rank
from geo.usp_learning.association import fragment_rank_checkpoint as cp, fragment_rank_phase_adapter as phase
from geo.usp_learning.association.validation import InvalidEvidence
import association_adapter as dispatcher
import stage_fragment_adapter as stager
import stage_fragment_rank_phase as entry
import stage_adapter


class StopEffect(Exception):
    pass


class Tensor:
    def __init__(self, values, shape, dtype="float32", device="cpu"):
        self.values, self.shape, self.dtype = list(values), tuple(shape), dtype
        self.device, self.grad = NS(type=device), None

    def clone(self):
        return Tensor(self.values, self.shape, self.dtype, self.device.type)

    def detach(self):
        return self

    def cpu(self):
        return self.to("cpu")

    def contiguous(self):
        return self

    def to(self, device):
        return Tensor(self.values, self.shape, self.dtype, device if isinstance(device, str) else device.type)

    def copy_(self, value):
        self.values = list(value.values)


class Torch:
    float32 = "float32"

    def __init__(self):
        self.cpu_state = Tensor([0] * 5056, [5056], "uint8")
        self.cuda_state = Tensor([0] * 16, [16], "uint8")
        self.cuda = NS(device_count=lambda: 1, get_rng_state=lambda index: self.cuda_state.clone(),
                       set_rng_state=lambda value, index: setattr(self, 'cuda_state', value.clone()))

    def get_rng_state(self):
        return self.cpu_state.clone()

    def set_rng_state(self, value):
        self.cpu_state = value.clone()

    def equal(self, a, b):
        return a.dtype == b.dtype and a.shape == b.shape and a.values == b.values

    def no_grad(self):
        return contextlib.nullcontext()


def pack(tensors):
    header, chunks, offset = {}, [], 0
    for name, tensor in sorted(tensors.items()):
        raw = bytes(tensor.values) if tensor.dtype == "uint8" else struct.pack('<' + 'f' * len(tensor.values), *tensor.values)
        header[name] = {'dtype': 'U8' if tensor.dtype == 'uint8' else 'F32', 'shape': list(tensor.shape), 'data_offsets': [offset, offset + len(raw)]}
        chunks.append(raw); offset += len(raw)
    raw_header = cp.canonical(header)
    raw_header += b' ' * ((-len(raw_header)) % 8)
    return struct.pack('<Q', len(raw_header)) + raw_header + b''.join(chunks)


def unpack(raw):
    length = struct.unpack('<Q', raw[:8])[0]; header = json.loads(raw[8:8 + length]); result = {}
    for name, row in header.items():
        start, end = row['data_offsets']; payload = raw[8 + length + start:8 + length + end]
        values = list(payload) if row['dtype'] == 'U8' else [v for (v,) in struct.iter_unpack('<f', payload)]
        result[name] = Tensor(values, row['shape'], 'uint8' if row['dtype'] == 'U8' else 'float32')
    return result


def group(names):
    return {'params': names, 'lr': 0.0002, 'betas': [0.9, 0.999], 'eps': 1e-8, 'weight_decay': 0,
            'amsgrad': False, 'maximize': False, 'foreach': None, 'capturable': False, 'differentiable': False, 'fused': None,
            'decoupled_weight_decay': True}


def scaler_state(updates):
    return {'scale': 128.0, 'growth_factor': 2.0, 'backoff_factor': 0.5, 'growth_interval': 2000, '_growth_tracker': updates}


class Scaler:
    def __init__(self): self.value = scaler_state(0)
    def state_dict(self): return copy.deepcopy(self.value)
    def load_state_dict(self, value): self.value = copy.deepcopy(value)


def checkpoint_fixture(binding, shapes, schedule, update):
    rng = random.getstate()
    state = {'version': cp.VERSION, 'binding': binding, 'masterNames': list(shapes), 'optimizerGroup': group(list(shapes)),
        'scaler': scaler_state(update), 'cursor': {'updates': update, 'contributions': sum(r['candidates'] for r in schedule[:update]),
            'losses': [0.125] * update, 'scheduleSha256': cp.sha(cp.canonical(schedule))}, 'pythonRng': [rng[0], list(rng[1]), rng[2]]}
    tensors = {n: Tensor([update if n.startswith('step:') else 0] * math.prod(spec['shape']), spec['shape'],
                         'uint8' if spec['dtype'] == 'U8' else 'float32') for n, spec in cp.tensor_specs(shapes).items()}
    raws = {'state.json': cp.canonical(state), 'tensors.safetensors': pack(tensors)}
    manifest = {'version': cp.VERSION, 'files': {n: {'bytes': len(v), 'sha256': cp.sha(v)} for n, v in raws.items()},
                'bindingSha256': cp.sha(cp.canonical(binding)), 'tensorSpecsSha256': cp.sha(cp.canonical(cp.tensor_specs(shapes))),
                'updates': update, 'roundtripExact': True, 'rngUnchanged': True}
    raws['manifest.json'] = cp.canonical(manifest)
    return state, manifest, raws


class Controls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.packet = json.loads(Path('C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin/docs/evidence/usp/ml-distillation/student-30.fragment-rank-checkpoint-code.assignment.json').read_bytes())
        cls.pins = {n: rank.sha((REPO / n).read_bytes()) for n in phase.SOURCE_PATHS}
        cls.canonical = {n: rank.sha((REPO / n).read_bytes().replace(b'\r\n', b'\n')) for n in phase.SOURCE_PATHS}
        cls.first = {**phase.recipe(), 'version': phase.VERSIONS['fit'][0], 'task': phase.TASK, 'action': 'fit', 'executable': True,
            'executionAllowance': rank.allowance('fit'), 'studentCodeCommit': '0' * 40, 'runtimeCodeCanonicalLfSha256': cls.canonical,
            'experimentId': '1' * 32, 'phase': phase.phase(1), 'previous': None}
        cls.raw = rank.serialized(cls.first); cls.freeze = phase.make_freeze(cls.first, cls.raw, cls.pins)
        cls.sources = phase.stage_sources(REPO / 'CPU_VIRTUAL/assignment.json', cls.raw, stager.BASELINE, stager.RUNTIME)
        cls.payload = {n: p.read_bytes() for n, (p, _) in cls.sources.items() if n in rank.PAYLOAD_PINS}
        _, cls.contract, cls.family, cls.rows = rank.checked_payload(cls.payload)
        cls.inputs = REPO / 'CPU_VIRTUAL'
        cls.virtual = {cls.inputs / n: raw for n, raw in cls.payload.items()}
        cls.virtual.update({cls.inputs / 'assignment.json': cls.raw, cls.inputs / 'run-freeze.json': rank.serialized(cls.freeze),
            cls.inputs / 'runtime-requirements-resolved.txt': cls.sources['runtime-requirements-resolved.txt'][0].read_bytes()})

    @contextlib.contextmanager
    def virtual_files(self, files):
        real_read, real_open, real_iter, real_stat, real_file = Path.read_bytes, Path.open, Path.iterdir, Path.stat, Path.is_file
        dirs = {p.parent for p in files}
        def open_(p, mode='r', *args, **kwargs):
            if p in files:
                assert mode == 'rb'; return io.BytesIO(files[p])
            return real_open(p, mode, *args, **kwargs)
        with patch.object(Path, 'read_bytes', lambda p: files[p] if p in files else real_read(p)), \
             patch.object(Path, 'open', open_), \
             patch.object(Path, 'iterdir', lambda p: iter(k for k in files if k.parent == p) if p in dirs else real_iter(p)), \
             patch.object(Path, 'is_file', lambda p: True if p in files else real_file(p)), \
             patch.object(cp, 'checked_path', side_effect=lambda p, **kwargs: Path(p)), \
             patch.object(Path, 'stat', lambda p, **k: NS(st_size=len(files[p])) if p in files else real_stat(p, **k)):
            yield

    def refused(self, operation):
        with self.assertRaises((InvalidEvidence, RuntimeError, KeyError, ValueError, TypeError, OSError)):
            operation()

    def test_real_inputs_phase_admission_and_first_effect(self):
        self.assertEqual(set(phase.SOURCE_PATHS), set(self.packet['futureRuntimeSources']))
        self.assertEqual(len(phase.PROTECTED_PINS), 29)
        for name, pin in self.packet['protectedExistingSourcePins'].items():
            self.assertEqual(cp.sha((REPO / name).read_bytes().replace(b'\r\n', b'\n')), pin)
        for spec in self.packet['trainOnlyAuthorities'].values():
            self.assertEqual(cp.sha(Path(spec['path']).read_bytes()), spec['physicalSha256'])
        stager.donor_metadata()
        with self.virtual_files(self.virtual):
            self.assertEqual(phase.checked_inputs(self.freeze, self.first, self.inputs)[3], self.rows)
            self.assertIs(dispatcher.representation_module(self.freeze, self.first), phase)
        scope = REPO / 'CPU_CONTAINED_LEGACY'
        scoped_files = ContainedPathControls.child_files(self, scope, self.first, self.freeze)
        with ContainedPathControls.virtual_child(self, scope, scoped_files):
            phases = NS(sample=lambda *a, **k: (_ for _ in ()).throw(StopEffect()))
            with self.assertRaises(StopEffect):
                adapter.fit(self.rows, self.contract, self.family, None, None, lambda: None, None, phases,
                    rank_phase_authority={'freeze': self.freeze, 'assignment': self.first, 'inputs': scope / 'inputs', 'verified_root': scope})
        def git(command, **kwargs):
            if command[1] == 'rev-parse': return '0' * 40
            if command[1] == 'status': return ''
            assert command[1] == 'show'
            return (REPO / command[2].split(':', 1)[1]).read_bytes().replace(b'\r\n', b'\n')
        with self.virtual_files(self.virtual), patch.object(stager.subprocess, 'check_output', git), \
             patch.object(stager.shutil, 'disk_usage', return_value=NS(free=20 * 1024**3)), \
             patch.object(Path, 'mkdir', side_effect=StopEffect()) as effect:
            with self.assertRaises(StopEffect): entry.stage(self.inputs / 'assignment.json')
            effect.assert_called_once()
        args = NS(action='fit', adapter_dir=None, run_freeze=self.inputs / 'run-freeze.json', output_dir=self.inputs / 'out',
                  input_batch=None, adapter_manifest=None, fit_proof=None)
        for k, n in phase.input_names('fit').items(): setattr(args, k, self.inputs / n)
        args.run_freeze = scope / 'inputs/run-freeze.json'; args.output_dir = scope / 'outputs/fit'
        for k, n in phase.input_names('fit').items(): setattr(args, k, scope / 'inputs' / n)
        with ContainedPathControls.virtual_child(self, scope, scoped_files), \
             patch.object(dispatcher, 'require_model_boundary', return_value=(scope, {}, {})), \
             patch.object(Path, 'mkdir', side_effect=StopEffect()) as effect:
            with self.assertRaises(StopEffect): dispatcher.worker(args)
            effect.assert_called_once()
        for number in (1, 2, 3):
            prototype = phase.disabled_prototype(number, '0' * 40, self.canonical)
            self.refused(lambda: phase.checked_execution(prototype, 'fit'))
            self.assertFalse({'command', 'executionAllowance', 'studentCodeCommit'} & prototype.keys())
            window = phase.schedule()[(number-1)*20:number*20]
            self.assertEqual(sum(r['candidates'] for r in window), 114)
        for change in ({'phase': phase.phase(2)}, {'executable': False}, {'unexpected': 1}, {'experimentId': 'wrong'}):
            self.refused(lambda: phase.checked_execution({**self.first, **change}, 'fit'))
        self.refused(lambda: dispatcher.representation_module({'version': 'association-fragment-rank-phase-fit-freeze/99'}, self.first))
        self.assertIsNone(dispatcher.representation_module({}, {}))
        with patch.object(rank, 'checked_freeze') as check:
            self.assertIs(dispatcher.representation_module({'version': rank.VERSIONS['fit'][1]}, {}), rank)
            check.assert_called_once()

    def test_checkpoint_roundtrip_modeled_split_and_refusals(self):
        shapes, schedule, binding = {'p': [2]}, [{'candidates': 1, 'update': i} for i in range(1, 5)], {'cpuDouble': True}
        torch = Torch(); original_python = random.getstate(); random.seed(3017)
        def objects():
            p = Tensor([0.25, -0.5], [2], device='cuda')
            return [('p', p)], NS(param_groups=[group([p])], state={}), Scaler()
        def step(objects, losses):
            named, optimizer, scaler = objects; p = named[0][1]
            rng = random.random() + torch.cpu_state.values[0] / 256 + torch.cuda_state.values[0] / 256
            torch.cpu_state.values[0] += 1; torch.cuda_state.values[0] += 2
            state = optimizer.state.setdefault(p, {'step': Tensor([0], []), 'exp_avg': Tensor([0., 0.], [2], device='cuda'), 'exp_avg_sq': Tensor([0., 0.], [2], device='cuda')})
            gradients = [v + rng for v in p.values]
            state['step'].values[0] += 1
            def f32(v): return struct.unpack('<f', struct.pack('<f', v))[0]
            for i, g in enumerate(gradients):
                state['exp_avg'].values[i] = f32(.9 * state['exp_avg'].values[i] + .1 * g)
                state['exp_avg_sq'].values[i] = f32(.999 * state['exp_avg_sq'].values[i] + .001 * g * g)
                p.values[i] = f32(p.values[i] - .0002 * state['exp_avg'].values[i] / (math.sqrt(state['exp_avg_sq'].values[i]) + 1e-8))
            scaler.value['_growth_tracker'] += 1
            losses.append(sum(v * v for v in gradients))
        cursor = lambda losses: {'updates': len(losses), 'contributions': len(losses), 'losses': losses, 'scheduleSha256': cp.sha(cp.canonical(schedule))}
        try:
            reference = objects(); losses = []
            for _ in range(2): step(reference, losses)
            state, tensors = cp.capture(torch, *reference, binding, cursor(losses), shapes, schedule, (2, 4))
            with tempfile.TemporaryDirectory(prefix='rank-checkpoint-cpu-') as temporary:
                directory = Path(temporary).resolve() / 'synthetic-only'
                cp.publish(directory, state, tensors, torch=torch, binding=binding, shapes=shapes, schedule=schedule, boundaries=(2, 4), codec=(pack, unpack))
                pins = {n: cp.sha((directory / n).read_bytes()) for n in cp.FILES}
                loaded, raw, _ = cp.read_checkpoint({n: directory / n for n in cp.FILES}, binding=binding, shapes=shapes, schedule=schedule, boundaries=(2, 4), expected_pins=pins)
                for _ in range(2): step(reference, losses)
                expected, et = cp.capture(torch, *reference, binding, cursor(losses), shapes, schedule, (2, 4))
                resumed = objects(); random.random(); torch.cpu_state.values[0] = 99
                restored = cp.restore(loaded, raw, torch=torch, trainable=resumed[0], optimizer=resumed[1], scaler=resumed[2],
                    binding=binding, shapes=shapes, schedule=schedule, boundaries=(2, 4), codec=(pack, unpack))
                actual_losses = restored['losses']
                for _ in range(2): step(resumed, actual_losses)
                actual, at = cp.capture(torch, *resumed, binding, cursor(actual_losses), shapes, schedule, (2, 4))
                self.assertTrue(cp.same(actual, expected)); self.assertTrue(all(torch.equal(at[n], et[n]) for n in et))
                for mutation in ('missing', 'cursor', 'rng', 'scaler', 'group'):
                    bad = copy.deepcopy(loaded)
                    if mutation == 'missing': del bad['scaler']
                    elif mutation == 'cursor': bad['cursor']['updates'] = 3
                    elif mutation == 'rng': bad['pythonRng'][1].pop()
                    elif mutation == 'scaler': bad['scaler']['_growth_tracker'] = 0
                    else: bad['optimizerGroup']['lr'] = 1
                    self.refused(lambda: cp.checked_state(bad, binding, shapes, schedule, (2, 4)))
                bad_tensors = unpack(raw); bad_tensors['master:p'].values[0] = float('nan')
                self.refused(lambda: cp.checked_tensor_bytes(pack(bad_tensors), shapes, 2))
                bad_pins = {**pins, 'state.json': '0' * 64}
                self.refused(lambda: cp.read_checkpoint({n: directory / n for n in cp.FILES}, binding=binding, shapes=shapes, schedule=schedule, boundaries=(2, 4), expected_pins=bad_pins))
                self.refused(lambda: cp.read_checkpoint({**{n: directory / n for n in cp.FILES}, 'extra': directory / 'state.json'}, binding=binding, shapes=shapes, schedule=schedule, boundaries=(2, 4)))
                with self.assertRaises(FileExistsError):
                    cp.publish(directory, state, tensors, torch=torch, binding=binding, shapes=shapes, schedule=schedule, boundaries=(2, 4), codec=(pack, unpack))
                self.assertEqual({n: cp.sha((directory / n).read_bytes()) for n in cp.FILES}, pins)
                partial = Path(temporary).resolve() / 'partial'
                def wrong_load(raw):
                    result = unpack(raw); result['master:p'].values[0] += 1; return result
                self.refused(lambda: cp.publish(partial, state, tensors, torch=torch, binding=binding, shapes=shapes, schedule=schedule, boundaries=(2, 4), codec=(pack, wrong_load)))
                self.assertFalse((partial / 'manifest.json').exists())
                alias = directory / '..' / directory.name / 'state.json'
                self.refused(lambda: cp.checked_path(alias))
        finally:
            random.setstate(original_python)

    def test_preceding_acceptance_is_required_before_copy_or_native(self):
        root = rank.PUBLICATION_ROOT.parent / (phase.STAGE_PREFIX + 'fit-' + '2' * 32)
        proof_path = REPO / 'CPU_INDEPENDENT/accepted.json'
        state, manifest, raw = checkpoint_fixture(phase.binding(self.first), cp.production_shapes(), phase.schedule(), 20)
        previous = {'root': str(root), 'acceptancePath': str(proof_path), 'acceptanceSha256': '0' * 64,
            'checkpointFiles': {n: cp.sha(v) for n, v in raw.items()}, 'binding': phase.binding(self.first),
            **{k: '0' * 64 for k in ('guardSha256','acceptedMapSha256','completionSha256','fitResultSha256','adapterManifestSha256','freezeSha256','assignmentSha256','checkpointProofSha256')}}
        previous['acceptanceSha256'] = cp.sha(rank.serialized(phase.acceptance_body(previous)))
        second = {**self.first, 'phase': phase.phase(2), 'previous': previous}
        phase.checked_execution(second, 'fit')
        files = {proof_path: rank.serialized(phase.acceptance_body(previous))}
        with self.virtual_files(files), patch.object(stage_adapter, 'accepted_outputs', side_effect=StopEffect()) as accepted:
            with self.assertRaises(StopEffect): phase.accepted_previous(second)
            accepted.assert_called_once_with(root, 'fit')
        forged = copy.deepcopy(second); forged['previous']['acceptanceSha256'] = 'f' * 64
        with self.virtual_files(files), patch.object(stage_adapter, 'accepted_outputs') as accepted:
            self.refused(lambda: phase.accepted_previous(forged)); accepted.assert_not_called()
        for changed in ({'binding': {}}, {'checkpointFiles': {}}, {'root': str(rank.PUBLICATION_ROOT)}, {'acceptancePath': str(root / 'self-approved.json')}):
            bad = {**second, 'previous': {**previous, **changed}}
            self.refused(lambda: phase.checked_execution(bad, 'fit'))
        self.refused(lambda: phase.checked_proof({'passed': True, 'native': False}))
        session = phase.PhaseSession({'assignment': self.first, 'inputs': self.inputs, 'verified_root': self.inputs.parent})
        self.assertEqual((session.start, session.end), (0, 20))
        self.assertEqual(session.initialize(Torch(), [], None, None, phase.BASE), (0, 0, []))
        self.assertFalse(session.phase['final'])

    def test_positive_previous_chain_and_phase2_stage_stop(self):
        # Entire preceding native run is a metadata double. Actual phase/checkpoint
        # readers, hash/shape/order checks run; only the guard authority is doubled.
        root = rank.PUBLICATION_ROOT.parent / (phase.STAGE_PREFIX + 'fit-' + '3' * 32)
        output = root / 'outputs/fit'; files = {}
        put = lambda path, value: files.update({path: rank.serialized(value)})
        state, checkpoint_manifest, raw = checkpoint_fixture(phase.binding(self.first), cp.production_shapes(), phase.schedule(), 20)
        for n, value in raw.items(): files[output / 'checkpoint' / n] = value
        for p, value in self.virtual.items(): files[root / 'inputs' / p.name] = value
        for n in phase.SOURCE_PATHS: files[root / 'code' / n] = (REPO / n).read_bytes()
        proof = {'passed': True, 'native': True, 'trainingRngRestored': True, 'freshObjects': True,
                 'exactLossesGradientsMastersOptimizerScalerRngCursor': True, 'policy': cp.PROOF_POLICY}
        put(output / 'checkpoint-equivalence.json', proof)
        put(output / 'teacher-delta.json', phase.representation_metadata())
        recipe = {'trainingPlan': phase.training_plan(), 'settings': phase.FIT, 'numerics': phase.NUMERICS,
                  'lossImplementation': phase.LOSS_POLICY, 'representation': phase.representation_metadata()}
        preflight = {**recipe, 'epochOrder': phase.epoch_orders(phase.training_plan()), 'excludedRows': [], 'truncation': False,
            'maximumCombinedTokens': 2, 'lengths': [{'exampleId': n, 'focuses': [{'candidateIndex': i, 'inputTokens': 2} for i in range(count)]}
                                                  for n, count in rank.PARENT_COUNTS.items()]}
        put(output / 'token-preflight.json', preflight)
        for n in ('loss-equivalence.json', 'attention-control.json', 'reclamation-control.json'): put(output / n, {'passed': True})
        put(output / 'attention-scope.json', {'restored': True})
        history, blocks, progress = [], [], []
        for r in phase.schedule()[:20]:
            progress.append({k: r[k] for k in ('update', 'epoch', 'exampleId')} | {
                'candidateContributions': r['candidates'], 'loss': .125, 'gradientNormBeforeClip': 1., 'gradientScale': 128})
            for i in range(r['candidates']):
                identity = {k: r[k] for k in ('update', 'epoch', 'exampleId')} | {'candidateIndex': i}
                for name in ('before_decoder','after_decoder','after_loss_before_backward','before_backward_reclamation',
                             'after_backward_reclamation','after_backward','after_candidate_reclamation'):
                    history.append({**identity, 'phase': name, 'accumulatedGradientsRetained': True, 'peaksReset': False})
                for boundary, multiplier in (('decoder',1),('backward',3)):
                    blocks.append({**identity,'boundary':boundary,'tokens':2,'fullKeyTokens':2,'blockSizes':[2],
                        'layerCalls':{str(i):1 if boundary=='decoder' else 2 for i in range(24)},
                        'primitiveCallsStarted':24*multiplier,'maxQueryBlockTokens':2})
            history.append({'phase':'before_optimizer_step','update':r['update'],'frozenGradientsAbsent':True})
        for n, records in (('memory-phases.jsonl',history),('attention-blocks.jsonl',blocks),('fit-progress.jsonl',progress)):
            files[output/n] = b''.join(cp.canonical(r)+b'\n' for r in records)
        hashes = {key:cp.sha(files[output/n]) for key,n in (
            ('lossEquivalenceSha256','loss-equivalence.json'),('attentionControlSha256','attention-control.json'),
            ('reclamationControlSha256','reclamation-control.json'))}
        manifest = {**recipe, **hashes, 'version':'association-rank-phase-manifest/1','phase':phase.phase(1),
            'baseParametersBefore':phase.BASE,'baseParametersAfter':phase.BASE,'checkpointManifestSha256':cp.sha(raw['manifest.json']),
            'savedStateMatchesTrainableAdapter':True,'trainableParameters':540672,'tensorCount':96,'binding':phase.binding(self.first),
            'finalAdapter':False,'files':{}}
        put(output/'adapter-manifest.json',manifest)
        result = {**recipe, **hashes, 'version':'association-rank-phase-result/1','phase':phase.phase(1),'updates':20,'localUpdates':20,
            'localContributions':114,'candidateContributions':114,'fitPerformed':False,'phaseCompleted':True,'baseUnchanged':True,
            'binding':phase.binding(self.first),'stepLosses':state['cursor']['losses'],'checkpointManifestSha256':cp.sha(raw['manifest.json']),
            'checkpointProofSha256':cp.sha(files[output/'checkpoint-equivalence.json']),'developmentOpened':False,'evaluationOpened':False}
        result.update({key:cp.sha(files[output/n]) for key,n in (('memoryPhasesSha256','memory-phases.jsonl'),
            ('attentionBlocksSha256','attention-blocks.jsonl'),('attentionScopeSha256','attention-scope.json'),('adapterManifestSha256','adapter-manifest.json'))})
        put(output/'fit-result.json',result)
        guard = {'outputsAccepted':True,'failure':None,'cpuTestGuardDouble':True}
        put(root/'receipts/association_adapter-fit-guard.json',guard)
        put(root/'receipts/association_adapter-fit-accepted.json',{'cpuTestAcceptedMapDouble':True})
        completion = {'supervisor':guard,'runFreezeSha256':cp.sha(files[root/'inputs/run-freeze.json']),
            'fitResultSha256':cp.sha(files[output/'fit-result.json']),'adapterManifestSha256':cp.sha(files[output/'adapter-manifest.json']),
            'tokenPreflightSha256':cp.sha(files[output/'token-preflight.json'])}
        put(output/'completion.json',completion)
        previous = {'root':str(root),'acceptancePath':str(REPO/'CPU_INDEPENDENT/success.json'),'acceptanceSha256':'0'*64,
            'checkpointFiles':{n:cp.sha(v) for n,v in raw.items()},'binding':phase.binding(self.first),
            'checkpointProofSha256':result['checkpointProofSha256']}
        for key,path in (('guardSha256',root/'receipts/association_adapter-fit-guard.json'),
                         ('acceptedMapSha256',root/'receipts/association_adapter-fit-accepted.json'),('completionSha256',output/'completion.json'),
                         ('fitResultSha256',output/'fit-result.json'),('adapterManifestSha256',output/'adapter-manifest.json'),
                         ('freezeSha256',root/'inputs/run-freeze.json'),('assignmentSha256',root/'inputs/assignment.json')):
            previous[key] = cp.sha(files[path])
        put(Path(previous['acceptancePath']),phase.acceptance_body(previous))
        previous['acceptanceSha256'] = cp.sha(files[Path(previous['acceptancePath'])])
        second = {**self.first,'phase':phase.phase(2),'previous':previous}
        second_raw = rank.serialized(second); second_freeze=phase.make_freeze(second,second_raw,self.pins)
        virtual2 = {**self.virtual,self.inputs/'assignment.json':second_raw,self.inputs/'run-freeze.json':rank.serialized(second_freeze)}
        for n,v in raw.items(): virtual2[self.inputs/phase.CHECKPOINT_INPUTS[n]]=v
        virtual2[self.inputs/'previous-acceptance.json']=files[Path(previous['acceptancePath'])]
        virtual2[self.inputs/'previous-checkpoint-proof.json']=files[output/'checkpoint-equivalence.json']
        files.update(virtual2)
        def git(command, **kwargs):
            if command[1]=='rev-parse': return '0'*40
            if command[1]=='status': return ''
            return (REPO/command[2].split(':',1)[1]).read_bytes().replace(b'\r\n',b'\n')
        with self.virtual_files(files), patch.object(stage_adapter,'accepted_outputs',return_value=(guard,{})):
            self.assertEqual(len(phase.accepted_previous(second)),5)
            self.assertEqual(phase.checked_inputs(second_freeze,second,self.inputs)[3],self.rows)
            with patch.object(stager.subprocess,'check_output',git), patch.object(stager.shutil,'disk_usage',return_value=NS(free=20*1024**3)), \
                 patch.object(Path,'mkdir',side_effect=StopEffect()) as effect:
                with self.assertRaises(StopEffect): entry.stage(self.inputs/'assignment.json')
                effect.assert_called_once()
            changed=copy.deepcopy(second);changed['previous']['completionSha256']='f'*64
            self.refused(lambda: phase.accepted_previous(changed))


class ContainedPathControls(unittest.TestCase):
    """Task32 regression: real path validator; explicit OS/codec/native doubles."""
    setUpClass = classmethod(Controls.setUpClass.__func__)
    refused = Controls.refused

    @contextlib.contextmanager
    def virtual_child(self, root, files, denied=()):
        # Readonly inputs/source bytes are real retained bytes in a virtual tree.
        # Metadata/resolution and denied access model the observed OS boundary;
        # checked_path, read_bytes, freeze and checkpoint validators stay real.
        real = {n: getattr(Path, n) for n in ('stat', 'resolve', 'open', 'mkdir', 'iterdir')}
        directories = {root, root / 'outputs', root / 'model'}
        for p in files:
            directories.update(parent for parent in p.parents if parent.is_relative_to(root))
        forbidden = set(root.parents) | set(denied)
        touched = []
        def access(p):
            if p in forbidden or any(p.is_relative_to(d) for d in denied):
                touched.append(str(p)); raise PermissionError('outside verified stage: ' + str(p))
        def stat_(p, **kwargs):
            access(p)
            if p in files: return NS(st_mode=stat.S_IFREG, st_size=len(files[p]), st_file_attributes=0)
            if p in directories: return NS(st_mode=stat.S_IFDIR, st_size=0, st_file_attributes=0)
            if p.is_relative_to(root): raise FileNotFoundError(str(p))
            return real['stat'](p, **kwargs)
        def resolve(p, **kwargs):
            access(p)
            return p if p.is_relative_to(root) else real['resolve'](p, **kwargs)
        def open_(p, mode='r', *args, **kwargs):
            access(p)
            if p in files:
                assert mode == 'rb'; return io.BytesIO(files[p])
            return real['open'](p, mode, *args, **kwargs)
        def mkdir(p, *args, **kwargs):
            access(p)
            if p.is_relative_to(root):
                assert p not in directories and p.parent in directories; directories.add(p); return
            return real['mkdir'](p, *args, **kwargs)
        with patch.object(Path, 'stat', stat_), patch.object(Path, 'resolve', resolve), \
             patch.object(Path, 'open', open_), patch.object(Path, 'mkdir', mkdir), \
             patch.object(Path, 'iterdir', lambda p: iter(n for n in files if n.parent == p) if p in directories else real['iterdir'](p)), \
             patch.object(phase, '__file__', str(root / 'code/services/geo/geo/usp_learning/association/fragment_rank_phase_adapter.py')):
            yield touched

    def child_files(self, root, assignment, freeze):
        files = {root / 'inputs' / p.name: raw for p, raw in self.virtual.items()}
        files[root / 'inputs/assignment.json'] = rank.serialized(assignment)
        files[root / 'inputs/run-freeze.json'] = rank.serialized(freeze)
        files.update({root / 'code' / n: (REPO / n).read_bytes() for n in phase.SOURCE_PATHS})
        return files

    @contextlib.contextmanager
    def deny_parents(self, root, extra=()):
        originals = {n: getattr(Path, n) for n in ('exists', 'stat', 'lstat')}
        denied = set(root.parents) | set(extra); touched = []
        def guarded(name):
            def call(p, *a, **k):
                if p in denied:
                    touched.append(str(p)); raise PermissionError('denied parent')
                return originals[name](p, *a, **k)
            return call
        with contextlib.ExitStack() as stack:
            for name in originals: stack.enter_context(patch.object(Path, name, guarded(name)))
            yield touched

    def test_worker_verified_root_reaches_shared_fit_before_imports(self):
        root = REPO / 'CPU_CONTAINED'
        files = self.child_files(root, self.first, self.freeze)
        inputs = root / 'inputs'; outputs = root / 'outputs/fit'
        args = NS(action='fit', adapter_dir=None, run_freeze=inputs/'run-freeze.json', output_dir=outputs,
                  input_batch=None, adapter_manifest=None, fit_proof=None)
        for k,n in phase.input_names('fit').items(): setattr(args,k,inputs/n)
        acquisition = json.loads(files[inputs/'model-acquisition.json'])
        model_pins = {root/'model'/r['file']:r['sha256'] for r in acquisition['files']}
        actual_digest = dispatcher.digest_file
        samples = []
        def sample(name, *args, **kwargs):
            samples.append(name)
            if name == 'before_imports': raise StopEffect('native boundary reached')
        from geo.usp_learning.association import memory_observation
        with self.virtual_child(root,files) as outside, \
             patch.object(dispatcher,'require_model_boundary',return_value=(root,{},{})) as boundary, \
             patch.object(dispatcher,'local_model_path',return_value=root/'model'), \
             patch.object(dispatcher,'digest_file',side_effect=lambda p:model_pins[p] if p in model_pins else actual_digest(p)), \
             patch.object(memory_observation,'PhaseRecorder',return_value=NS(sample=sample)), \
             patch.object(dispatcher,'write_json_once'), \
             patch.object(phase,'admit_fit',wraps=phase.admit_fit) as admit:
            self.assertIs(dispatcher.representation_module(self.freeze,self.first,verified_root=root),phase)
            with self.assertRaisesRegex(StopEffect,'native boundary reached'): dispatcher.worker(args)
            self.assertEqual(admit.call_args.args[0]['verified_root'],root)
            self.assertIn('before_imports',samples); self.assertEqual(outside,[])
            self.assertGreaterEqual(boundary.call_count,2)
        self.assertIsNone(dispatcher.representation_module({}, {}, verified_root=root))
        with patch.object(rank,'checked_freeze') as legacy:
            self.assertIs(dispatcher.representation_module({'version':rank.VERSIONS['fit'][1]}, {}, verified_root=root),rank)
            legacy.assert_called_once_with({'version':rank.VERSIONS['fit'][1]}, {})

    def test_checkpoint_io_denied_parent_and_path_refusals(self):
        shapes={'p':[2]}; schedule=[{'candidates':1,'update':i} for i in range(1,5)]; binding={'cpuDouble':True}
        state,_,raw=checkpoint_fixture(binding,shapes,schedule,2)
        with tempfile.TemporaryDirectory(prefix='rank-contained-path-cpu-') as temporary:
            root=Path(temporary).resolve(); output=root/'output'; output.mkdir()
            with self.deny_parents(root) as outside:
                directory=output/'checkpoint'
                cp.publish(directory,state,unpack(raw['tensors.safetensors']),torch=Torch(),binding=binding,shapes=shapes,
                           schedule=schedule,boundaries=(2,4),codec=(pack,unpack),verified_root=root)
                saved,_,_=cp.read_checkpoint({n:directory/n for n in cp.FILES},binding=binding,shapes=shapes,
                    schedule=schedule,boundaries=(2,4),verified_root=root)
                self.assertEqual(saved,state); self.assertEqual(outside,[])
                self.refused(lambda:cp.checked_path(root.parent/'escape',verified_root=root))
                self.refused(lambda:cp.checked_path(root/'..'/root.name,verified_root=root))
                self.refused(lambda:cp.checked_path(directory/'state.json',verified_root=root/'..'/root.name))
                self.assertEqual(outside,[])
                with self.assertRaises(FileExistsError):cp.durable_write(directory/'state.json',b'x',verified_root=root)
                self.refused(lambda:cp.read_bytes(directory/'missing.json',1024,verified_root=root))
            # Real validator, metadata double for reparse attributes/root redirect.
            original=Path.lstat
            for target in (root,output):
                def redirected(p):
                    info=original(p)
                    return NS(st_mode=info.st_mode,st_file_attributes=stat.FILE_ATTRIBUTE_REPARSE_POINT) if p==target else info
                with patch.object(Path,'lstat',redirected):
                    self.refused(lambda:cp.checked_path(directory/'state.json',verified_root=root))
                    self.refused(lambda:cp.checked_path(directory/'state.json'))
            with self.deny_parents(root,extra=(output,)):
                with self.assertRaises(PermissionError):cp.read_bytes(directory/'state.json',1024,verified_root=root)
            with self.deny_parents(root):
                with self.assertRaises(PermissionError):cp.checked_path(directory/'state.json')

    def test_phase2_copies_and_session_io_use_only_verified_scope(self):
        root=REPO/'CPU_CONTAINED_PHASE2'; inputs=root/'inputs'
        state,_,raw=checkpoint_fixture(phase.binding(self.first),cp.production_shapes(),phase.schedule(),20)
        proof={'passed':True,'native':True,'trainingRngRestored':True,'freshObjects':True,
               'exactLossesGradientsMastersOptimizerScalerRngCursor':True,'policy':cp.PROOF_POLICY}
        proof_raw=cp.canonical(proof)
        previous={'root':str(rank.PUBLICATION_ROOT.parent/(phase.STAGE_PREFIX+'fit-'+'4'*32)),
            'acceptancePath':str(REPO/'CPU_INDEPENDENT/phase1.json'),'acceptanceSha256':'0'*64,
            'checkpointFiles':{n:cp.sha(v) for n,v in raw.items()},'binding':phase.binding(self.first),
            **{k:'0'*64 for k in ('guardSha256','acceptedMapSha256','completionSha256','fitResultSha256','adapterManifestSha256','freezeSha256','assignmentSha256')},
            'checkpointProofSha256':cp.sha(proof_raw)}
        acceptance_raw=rank.serialized(phase.acceptance_body(previous));previous['acceptanceSha256']=cp.sha(acceptance_raw)
        second={**self.first,'phase':phase.phase(2),'previous':previous}
        freeze=phase.make_freeze(second,rank.serialized(second),self.pins)
        files=self.child_files(root,second,freeze)
        files.update({inputs/phase.CHECKPOINT_INPUTS[n]:v for n,v in raw.items()})
        files[inputs/'previous-acceptance.json']=acceptance_raw;files[inputs/'previous-checkpoint-proof.json']=proof_raw
        authority={'assignment':second,'freeze':freeze,'inputs':inputs,'verified_root':root}
        original_rng=random.getstate()
        try:
            with self.virtual_child(root,files,denied=(Path(previous['root']),Path(previous['acceptancePath']))) as outside:
                self.assertIs(dispatcher.representation_module(freeze,second,verified_root=root),phase)
                self.assertEqual(phase.checked_inputs(freeze,second,inputs,verified_root=root)[3],self.rows)
                self.assertIsNotNone(phase.admit_fit(authority,self.rows,self.contract,self.family))
                session=phase.PhaseSession(authority)
                session.controls(Torch(),root/'outputs/fit',None,None)
                named=[(n,Tensor([0]*math.prod(shape),shape,device='cuda')) for n,shape in cp.production_shapes().items()]
                optimizer=NS(param_groups=[group([p for _,p in named])],state={});scaler=Scaler();torch=Torch()
                with patch.object(cp,'native_codec',return_value=(pack,unpack)):
                    self.assertEqual(session.initialize(torch,named,optimizer,scaler,phase.BASE),(20,114,[.125]*20))
                self.assertEqual(outside,[])
                for filename in ('previous-acceptance.json','previous-checkpoint-proof.json','previous-state.json'):
                    old=files[inputs/filename];files[inputs/filename]=b'{}'
                    try:self.refused(lambda:phase.checked_inputs(freeze,second,inputs,verified_root=root))
                    finally:files[inputs/filename]=old
                self.assertEqual(outside,[])
            # Host metadata path checking still precedes original guard authority.
            with tempfile.TemporaryDirectory(prefix='rank-phase-host-acceptance-') as temporary:
                receipt=Path(temporary).resolve()/'acceptance.json';receipt.write_bytes(acceptance_raw)
                bad=copy.deepcopy(second);bad['previous'].update(acceptancePath=str(receipt),acceptanceSha256='f'*64)
                with patch.object(stage_adapter,'accepted_outputs') as guard:
                    self.refused(lambda:phase.accepted_previous(bad));guard.assert_not_called()
            # Session save and first-phase proof I/O use actual helpers and real
            # files with forbidden outside parents; tensors/native proof doubled.
            with tempfile.TemporaryDirectory(prefix='rank-phase-session-cpu-') as temporary:
                scope=Path(temporary).resolve();output=scope/'outputs';output.mkdir()
                first_session=phase.PhaseSession({'assignment':self.first,'inputs':scope/'inputs','verified_root':scope})
                first_session.initialize(torch,named,optimizer,scaler,phase.BASE)
                def proof_double(t, directory, write, phases, *, verified_root):
                    self.assertEqual(verified_root,scope)
                    cp.durable_write(Path(directory)/'checkpoint-equivalence.json',proof_raw,verified_root=verified_root)
                with self.deny_parents(scope) as outside,patch.object(cp,'native_codec',return_value=(pack,unpack)), \
                     patch.object(cp,'run_equivalence',side_effect=proof_double):
                    first_session.controls(torch,output,None,None)
                    first_session.save(torch,named,optimizer,scaler,output,20,114,[.125]*20,phase.BASE,phase.BASE)
                    saved,_,_=cp.read_checkpoint({n:output/'checkpoint'/n for n in cp.FILES},binding=phase.binding(self.first),
                        shapes=cp.production_shapes(),schedule=phase.schedule(),boundaries=(20,40,60),verified_root=scope)
                    self.assertEqual(saved['cursor']['updates'],20);self.assertEqual(outside,[])
        finally:random.setstate(original_rng)


if __name__ == '__main__':
    unittest.main(verbosity=2)
