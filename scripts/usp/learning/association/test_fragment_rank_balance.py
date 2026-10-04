"""One stdlib CPU group; doubles are not native/autograd/resource qualification.

Run with -B -I -S, --receipt-root and the Task44 --assignment. The retained
fixture has source text and train metadata only, a nonexistent Git commit and
no model, runtime, containment profile or native execution capability.
"""
from __future__ import annotations

import argparse
import builtins
import contextlib
import copy
from fractions import Fraction
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import unittest

REPO = Path(__file__).resolve().parents[4]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--receipt-root", type=Path, required=True)
parser.add_argument("--assignment", type=Path, required=True)
options, unittest_args = parser.parse_known_args()
ROOT = options.receipt_root.resolve()
TASK = json.loads(options.assignment.read_bytes())
FIXTURE = ROOT / "cpu-fixture"
FIXTURE.mkdir(exist_ok=False)
CODE, INPUTS = FIXTURE / "code", FIXTURE / "inputs"
INPUTS.mkdir()


def durable(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())


def write(path, value):
    durable(path, (json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n").encode())


snapshot = json.loads(Path(TASK["protectedSourceSnapshot"]["path"]).read_bytes())
# Copy the authorized current runtime texts; only the exact active closure is
# admitted below. No old test, binary, model, runtime or developer input is read.
for name in sorted(set(snapshot["paths"]) | (set(TASK["ownedSources"]) - {
        "scripts/usp/learning/association/test_fragment_rank_balance.py"})):
    durable(CODE / name, (REPO / name).read_bytes())
sys.path[:0] = [str(CODE / "services/geo"), str(CODE / "scripts/usp/learning/association"), str(CODE / "scripts/usp/learning")]
native_attempts = []
original_import = builtins.__import__


def no_native(name, *args, **kwargs):
    if name.split(".")[0] in {"torch", "transformers", "peft", "accelerate", "safetensors", "numpy", "psutil"}:
        native_attempts.append(name)
        raise AssertionError("native import refused in CPU control: " + name)
    return original_import(name, *args, **kwargs)


builtins.__import__ = no_native
from geo.usp_learning.association import adapter, fragment_rank_adapter as rank
from geo.usp_learning.association import fragment_rank_balance as balance, fragment_rank_fit as fitter
from geo.usp_learning.association import fragment_rank_phase_adapter as phase, fragment_rank_checkpoint as cp
from geo.usp_learning.association.validation import InvalidEvidence, strict_json

OBJECTIVE = balance.admit(balance.record(), balance.OBJECTIVE_SHA256)
physical = {name: rank.sha((CODE / name).read_bytes()) for name in phase.BALANCED_SOURCE_PATHS}
canonical = {name: rank.sha((CODE / name).read_bytes().replace(b"\r\n", b"\n")) for name in phase.BALANCED_SOURCE_PATHS}
ASSIGNMENT = {**phase.recipe(phase.balanced_metadata_assignment()), "version": phase.BALANCED_VERSIONS["fit"][0],
    "task": phase.BALANCED_TASK, "action": "fit", "executable": True, "executionAllowance": rank.allowance("fit"),
    "studentCodeCommit": "0" * 40, "runtimeCodeCanonicalLfSha256": canonical, "experimentId": "0" * 32,
    "phase": phase.phase(1), "previous": None}
raw_assignment = rank.serialized(ASSIGNMENT)
FREEZE = phase.make_freeze(ASSIGNMENT, raw_assignment, physical, verified_root=FIXTURE)
baseline = Path("E:/BhuAayam-data/task-data/ml-distillation/student/fragment-baseline-6d2a6e03ea684bdcb30fabb45d4dbe80")
runtime = Path("E:/BhuAayam-data/task-data/ml-distillation/student/adapter-citation-view-fit-fffafce9835d4f59bef71f4377bb5619")
for name, digest in rank.PAYLOAD_PINS.items():
    source = baseline / "inputs/model-acquisition.json" if name == "model-acquisition.json" else rank.PUBLICATION_ROOT / (
        "inputs/" + name if name in {"schema-v1.json", "family-freeze.json", "fragment-schema-v1.json"} else name)
    raw = source.read_bytes()
    assert rank.sha(raw) == digest
    durable(INPUTS / name, raw)
requirements = (runtime / "inputs/runtime-requirements-resolved.txt").read_bytes()
assert rank.sha(requirements) == phase.REQUIREMENTS_SHA
durable(INPUTS / "runtime-requirements-resolved.txt", requirements)
durable(INPUTS / "assignment.json", raw_assignment)
durable(INPUTS / "run-freeze.json", rank.serialized(FREEZE))
_, CONTRACT, FAMILY, ROWS = phase.checked_inputs(FREEZE, ASSIGNMENT, INPUTS, verified_root=FIXTURE)
AUTHORITY = {"assignment": ASSIGNMENT, "freeze": FREEZE, "inputs": INPUTS, "verified_root": FIXTURE}


class Dual:
    """Float64 scalar/derivative double. No FP32, native device or autograd claim."""
    dtype = "float32"
    def __init__(self, value, gradient=(0.0, 0.0), sink=None):
        self.value, self.gradient, self.sink = float(value), tuple(gradient), sink
    def __float__(self): return self.value
    def detach(self): return self
    def to(self, **kwargs): return self
    def __neg__(self): return self * -1
    def __mul__(self, scalar):
        return Dual(self.value * scalar, [g * scalar for g in self.gradient], self.sink)
    def backward(self):
        for i, g in enumerate(self.gradient): self.sink[i] += g


class Logits:
    shape = (1, 1, 64)
    def __init__(self, a, b, sink):
        self.values = {48: Dual(a, (1, 0), sink), 49: Dual(b, (0, 1), sink)}
    def __getitem__(self, index): return self.values.get(index[2], Dual(13))


class TorchDouble:
    float32, float16, long = "float32", "float16", "long"
    def __init__(self):
        self.cache_calls = 0
        self.cuda = SimpleNamespace(synchronize=lambda: None, empty_cache=self.empty_cache)
        self.nn = SimpleNamespace(functional=SimpleNamespace(log_softmax=self.log_softmax))
    def empty_cache(self): self.cache_calls += 1
    @staticmethod
    def stack(values): return values
    @staticmethod
    def isfinite(values):
        if isinstance(values, list): return SimpleNamespace(all=lambda: all(math.isfinite(v.value) for v in values))
        return math.isfinite(values.value)
    @staticmethod
    def log_softmax(values, dim):
        maximum = max(v.value for v in values)
        exps = [math.exp(v.value - maximum) for v in values]
        probabilities = [v / math.fsum(exps) for v in exps]
        normalizer = maximum + math.log(math.fsum(exps))
        average = [math.fsum(p * v.gradient[i] for p, v in zip(probabilities, values)) for i in (0, 1)]
        return [Dual(v.value - normalizer, [g - a for g, a in zip(v.gradient, average)], v.sink) for v in values]
    @staticmethod
    def tensor(values, **kwargs): return SimpleNamespace(shape=(1, len(values[0])))
    @staticmethod
    def ones_like(value): return value
    @staticmethod
    def autocast(*args, **kwargs): return contextlib.nullcontext()


class TokenizerDouble:
    all_special_ids = []
    @staticmethod
    def apply_chat_template(messages, **kwargs):
        # Deliberately synthetic prompt length; real tokenizer limits unqualified.
        return "P" + hashlib.sha256(rank.serialized(messages)).hexdigest()
    @staticmethod
    def encode(value, **kwargs): return [ord(c) for c in value]
    @staticmethod
    def decode(values, **kwargs): return "".join(chr(i) for i in values)


class Recorder:
    def __init__(self): self.rows = []
    def sample(self, name, *args, **fields): self.rows.append({"phase": name, **fields})


class StopBeforeImports(Exception): pass


class BalanceControls(unittest.TestCase):
    def test_mass_and_real_parent_loss_path(self):
        pairs = [c["pair"] for r in ROWS for c in r["candidates"]]
        mass = balance.mass_summary(pairs, OBJECTIVE)
        self.assertEqual(mass["effectiveClassMass"], {"0": {"numerator": 1, "denominator": 2}, "1": {"numerator": 1, "denominator": 2}})
        self.assertEqual(sum(Fraction(**v) for v in mass["effectiveParentMass"].values()), 1)
        encoded, lengths = fitter.encode_training(TokenizerDouble(), ROWS, rank.RankRepresentation(ROWS),
            lambda failure: self.fail(str(failure)), objective=OBJECTIVE)
        self.assertEqual(sum(len(row["focuses"]) for row in lengths), 57)
        torch = TorchDouble(); recorder = Recorder(); controls = []
        cases = [(2.0, -3.0), (0.0, 0.0), (-1000.0, 1000.0)]
        for parent in encoded:
            sink, completions, references, gradients = [0.0, 0.0], [], [], []
            current = iter(cases[i % 3] for i in range(len(parent["parent"]["candidates"])))
            class Hidden:
                def __getitem__(self, key): return self
            decoder = lambda **kwargs: SimpleNamespace(last_hidden_state=Hidden())
            def head(hidden):
                a, b = next(current)
                return Logits(a, b, sink)
            for i, c in enumerate(parent["parent"]["candidates"]):
                a, b = cases[i % 3]; label = c["label"]
                w = Fraction(**balance.effective_weight(label, c["weight"], OBJECTIVE))
                # Independent stable float64 NLL and analytic derivative.
                margin = b - a; small = math.exp(-abs(margin))
                probability = 1 / (1 + small) if margin >= 0 else small / (1 + small)
                references.append((max(a, b) + math.log1p(small) - (a if label == 0 else b)) * float(w))
                gradients.append([-(probability - label) * float(w), (probability - label) * float(w)])
            total = fitter.train_parent(parent, model=SimpleNamespace(_enable_peft_forward_hooks=lambda **kwargs: contextlib.nullcontext()),
                decoder=decoder, head=head, torch=torch, scaler=SimpleNamespace(scale=lambda loss: loss * 128),
                attention=SimpleNamespace(begin=lambda *args: None, snapshot=lambda boundary: {}), phases=recorder,
                gpu_check=lambda: {}, context={"exampleId": parent["parent"]["exampleId"], **balance.fields(OBJECTIVE)},
                complete=completions.append, objective=OBJECTIVE)
            self.assertEqual(completions, [total])
            self.assertAlmostEqual(total, math.fsum(references), places=10)
            self.assertEqual(len(gradients), len(parent["parent"]["candidates"]))
            for i in (0, 1): self.assertAlmostEqual(sink[i] / 128, math.fsum(g[i] for g in gradients), places=12)
            controls.append({"parent": parent["parent"]["exampleId"], "contributions": len(gradients), "loss": total,
                "referenceLoss": math.fsum(references), "gradient": [v / 128 for v in sink]})
        selected = [r for r in recorder.rows if r["phase"] == "after_loss_before_backward"]
        self.assertEqual(len(selected), 57)
        self.assertEqual(torch.cache_calls, 114)
        for r, p in zip(selected, pairs, strict=True):
            for k, v in balance.weight_fields(p["label"], p["weight"], OBJECTIVE).items(): self.assertEqual(r[k], v)
        for label in (0, 1):
            logits = Logits(2, -3, [0, 0]); weight = {"numerator": 1, "denominator": 40}
            legacy = fitter.weighted_nll(logits, {"0": 48, "1": 49}, label, weight, torch)
            balanced = fitter.weighted_nll(logits, {"0": 48, "1": 49}, label, weight, torch, objective=OBJECTIVE)
            factor = Fraction(**balance.record()["classMultipliers"][str(label)])
            self.assertAlmostEqual(float(balanced), float(legacy) * float(factor), places=12)
        write(ROOT / "objective-controls.json", {"mass": mass, "parentControls": controls, "productionContributions": 57,
            "nativeProofRun": False, "doubles": "float64 scalar derivative, tensor/device, tokenizer, model/decoder/head, scaler128, attention and GPU observations; actual parent/loss/accumulation/reclamation helpers"})

    def test_real_shared_fit_admission_and_refusals(self):
        class Boundary(Recorder):
            def sample(self, name, *args, **fields):
                super().sample(name, *args, **fields)
                if name == "before_imports": raise StopBeforeImports(name)
        recorder = Boundary(); boundary_calls = []
        def run(authority, phases=recorder):
            return adapter.fit(ROWS, CONTRACT, FAMILY, FIXTURE / "absent-model", FIXTURE / "absent-output",
                lambda: boundary_calls.append(True), lambda *args: self.fail("write before imports"), phases,
                rank_phase_authority=authority)
        with self.assertRaises(StopBeforeImports): run(AUTHORITY)
        self.assertEqual([r["phase"] for r in recorder.rows], ["before_imports"])
        self.assertEqual(boundary_calls, [True])
        self.assertEqual(ASSIGNMENT["studentCodeCommit"], "0" * 40)
        self.assertFalse((FIXTURE / "profile.json").exists())
        self.assertFalse((FIXTURE / "model").exists())
        session = phase.PhaseSession(AUTHORITY, ROWS)
        self.assertEqual(session.binding["objectiveSha256"], balance.OBJECTIVE_SHA256)
        self.assertEqual(phase.recipe()["representation"], rank.representation_metadata())
        self.assertNotIn("objective", phase.recipe())
        refused = []
        for change in ("hash", "record", "extra", "legacy", "freeze"):
            authority = copy.deepcopy(AUTHORITY)
            if change == "hash": authority["assignment"]["objectiveSha256"] = "f" * 64
            if change == "record": authority["assignment"]["objective"]["classMultipliers"]["1"]["numerator"] += 1
            if change == "extra": authority["assignment"]["objective"]["extra"] = True
            if change == "legacy": authority["assignment"]["version"] = phase.VERSIONS["fit"][0]
            if change == "freeze": authority["freeze"]["objectiveSha256"] = "f" * 64
            isolated = Boundary()
            with self.assertRaises(InvalidEvidence): run(authority, isolated)
            self.assertEqual(isolated.rows, [])
            refused.append(change)
        write(ROOT / "admission-controls.json", {"actualSharedFitBoundary": "before_imports", "realSourcePathCodecPayloadValidation": True,
            "sourceClosure": len(canonical), "fixtureSourceTexts": 41, "fixtureGitCommit": "0" * 40,
            "boundaryDouble": "OS model boundary callback only; cannot grant model access", "refusedBeforeImports": refused})

    def test_legacy_checkpoint_and_invalid_contributions(self):
        old = Path("E:/BhuAayam-data/task-data/ml-distillation/student/adapter-fragment-rank-phase-fit-c35149db6a8c4a859d1e65cf4c5561a7/outputs/fit/checkpoint/state.json")
        raw = old.read_bytes()
        self.assertEqual(rank.sha(raw), "38bcf07f62734234bf839e76e2924177ef3771f420302fe0881a3bbbc462e587")
        state = strict_json(raw)
        with self.assertRaisesRegex(InvalidEvidence, "checkpoint_state_identity"):
            cp.checked_state(state, phase.binding(ASSIGNMENT), cp.production_shapes(), phase.schedule(), (20, 40))
        for label, weight in ((True, {"numerator": 1, "denominator": 40}), (1, {"numerator": True, "denominator": 40})):
            with self.assertRaises(InvalidEvidence): balance.effective_weight(label, weight, OBJECTIVE)
        for change in ("label", "order", "effective"):
            parent = {"candidates": [{"inputIds": [8], "label": 1, "weight": {"numerator": 1, "denominator": 10},
                "record": {"candidateIndex": 0, "focusCandidateId": "c0", "labelIds": {"0": 48, "1": 49}, "inputTokens": 1,
                    "lastPromptPosition": 0, "prefixIdsSha256": rank.codec.canonical_sha([8]), "completePrefixAndSingleTokenVerified": True,
                    **balance.weight_fields(1, {"numerator": 1, "denominator": 10}, OBJECTIVE)}}], **balance.fields(OBJECTIVE)}
            if change == "label": parent["candidates"][0]["label"] = True
            if change == "order": parent["candidates"][0]["record"]["candidateIndex"] = 1
            if change == "effective": parent["candidates"][0]["record"]["effectiveWeight"]["numerator"] += 1
            with self.assertRaises(InvalidEvidence):
                fitter.accumulate_parent(parent, rank.codec.canonical_sha(parent), lambda c: self.fail("bad candidate reached forward"),
                    lambda total: self.fail("bad parent stepped"), objective=OBJECTIVE)
        with self.assertRaisesRegex(InvalidEvidence, "nonfinite"):
            fitter.weighted_nll(Logits(float("nan"), 0, [0, 0]), {"0": 48, "1": 49}, 1,
                {"numerator": 1, "denominator": 10}, TorchDouble(), objective=OBJECTIVE)
        second = copy.deepcopy(ASSIGNMENT); second["phase"] = phase.phase(2)
        second["previous"] = {"root": str(rank.PUBLICATION_ROOT.parent / (phase.BALANCED_STAGE_PREFIX + "fit-" + "0" * 32)),
            "acceptancePath": str(ROOT / "nonexistent-independent-acceptance.json"), "checkpointFiles": {n: "f" * 64 for n in cp.FILES},
            "binding": state["binding"], **{k: "f" * 64 for k in ("acceptanceSha256", "guardSha256", "acceptedMapSha256",
                "completionSha256", "fitResultSha256", "adapterManifestSha256", "freezeSha256", "assignmentSha256", "checkpointProofSha256")}}
        with self.assertRaisesRegex(InvalidEvidence, "rank_phase_chain_binding"):
            phase.checked_execution(second, "fit", verified_root=FIXTURE)
        with self.assertRaisesRegex(InvalidEvidence, "balanced_native_weighted_proof_required"):
            phase.checked_balanced_loss_proof({"passed": True, "records": []}, ASSIGNMENT)
        write(ROOT / "refusal-controls.json", {"legacyJsonMetadataOnly": {"path": str(old), "physicalSha256": rank.sha(raw)},
            "legacyCheckpointRejectedBeforeTensorRead": True, "legacyPreviousBindingRejected": True,
            "malformedParentRefusedBeforeForward": ["bool label", "candidate order", "effective weight"], "nonfiniteRefused": True})

    def test_isolated_stager_worker_startup_refusal(self):
        refusals = FIXTURE / "refusals"
        disabled = phase.disabled_balanced_prototype(1, TASK["baseCommit"], canonical)
        write(refusals / "disabled.json", disabled)
        write(refusals / "wrong-freeze.json", {"version": "association-fragment-rank-balanced-phase-fit-freeze/0"})
        commands = [[sys.executable, "-B", "-I", "-S", str(CODE / "scripts/usp/learning/association/stage_fragment_rank_phase.py"),
            "--assignment", str(refusals / "disabled.json")]]
        worker = [sys.executable, "-B", "-I", "-S", str(CODE / "scripts/usp/learning/association/association_adapter.py"), "fit"]
        for name, path in (("schema", INPUTS / "schema-v1.json"), ("family-freeze", INPUTS / "family-freeze.json"),
                ("model-receipt", INPUTS / "model-acquisition.json"), ("run-freeze", refusals / "wrong-freeze.json"),
                ("assignment", refusals / "disabled.json"), ("output-dir", FIXTURE / "never-created-output"),
                ("containment-profile", FIXTURE / "nonexistent-profile.json")):
            worker += ["--" + name, str(path)]
        commands.append(worker + ["--containment-sha256", "0" * 64])
        receipts = []
        for i, command in enumerate(commands):
            result = subprocess.run(command, cwd=REPO, capture_output=True, text=True, timeout=30)
            durable(ROOT / f"startup-{i}.stdout.txt", result.stdout.encode())
            durable(ROOT / f"startup-{i}.stderr.txt", result.stderr.encode())
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn("ModuleNotFoundError", result.stderr)
            self.assertIn("rank_phase_assignment_fields" if i == 0 else "explicit rank fit freeze required; no rank reload", result.stderr)
            receipts.append({"command": command, "exitCode": result.returncode, "expectedRefusal": True})
        self.assertFalse((FIXTURE / "never-created-output").exists())
        self.assertFalse((FIXTURE / "nonexistent-profile.json").exists())
        self.assertEqual(native_attempts, [])
        write(ROOT / "startup-controls.json", {"commands": receipts, "guardRun": False, "nativeImports": native_attempts})


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0], *unittest_args], verbosity=2)
