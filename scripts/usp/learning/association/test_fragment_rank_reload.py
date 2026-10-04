"""Three focused CPU groups. No native import or stage/guard/model execution.

Retained source-only development and fit metadata are real. Saved/checkpoint
tensor payloads, their two hashes, PEFT/tensors/NumPy byte transport, shared
native proof/base digest, code filesystem, donor plan/Git/disk and OS boundary
are explicit doubles. These controls do not qualify native reload or quality.
"""
from __future__ import annotations

import contextlib
import copy
import hashlib
import importlib.abc
import json
from pathlib import Path
import struct
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "services/geo"), str(REPO / "scripts/usp/learning"), str(Path(__file__).resolve().parent)]
BLOCKED = {"torch", "transformers", "peft", "safetensors", "numpy", "accelerate", "psutil"}
REJECTED = (RuntimeError, ValueError)


class NoNative(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split(".")[0] in BLOCKED:
            raise AssertionError("native import forbidden: " + fullname)


sys.meta_path.insert(0, NoNative())
from geo.usp_learning.association import fragment_rank_reload as reload, fragment_rank_runtime as runtime
from geo.usp_learning.association import student
import association_student as worker
import stage_selector_baseline as stager
import stage_fragment_rank_reload as thin

checkpoint, phase, baseline = reload.checkpoint, reload.phase, reload.baseline
PRIVATE = Path("E:/BhuAayam-data/task-data/ml-distillation/student/fragment-rank-reload-code-v1-ab83852610d64916807eb4a0e21a35da")
COORDINATOR = Path(reload.COORDINATOR)
OLD_ASSIGNMENT = COORDINATOR / "student-27.fragment-rank-baseline.assignment.json"


def serialize(values, target_size):
    header, payload = {}, bytearray()
    for name, (dtype, shape, data) in values.items():
        start = len(payload); payload.extend(data)
        header[name] = {"dtype": dtype, "shape": shape, "data_offsets": [start, len(payload)]}
    raw = checkpoint.canonical(header)
    size = target_size - 8 - len(payload)
    assert len(raw) <= size <= checkpoint.MAX_HEADER
    return struct.pack("<Q", size) + raw.ljust(size, b" ") + payload


class Fixture:
    def __init__(self):
        old_raw = OLD_ASSIGNMENT.read_bytes()
        assert len(old_raw) == 10509 and hashlib.sha256(old_raw).hexdigest() == "be96805696afe9a5660e97cbb97eb927bc01fe0a47828007b3822138dd0602a5"
        self.old = json.loads(old_raw)
        self.artifact_root = Path(self.old["artifactRoot"])
        self.source_bytes = {n: (REPO / n).read_bytes() for n in reload.SOURCE_PATHS}
        self.canonical_pins = {n: checkpoint.sha(b.replace(b"\r\n", b"\n")) for n, b in self.source_bytes.items()}
        self.physical_pins = {n: checkpoint.sha(b) for n, b in self.source_bytes.items()}
        self.assignment = {**self.old, "version": reload.ASSIGNMENT_VERSION, "task": reload.TASK,
            "executable": True, "studentCodeCommit": "a" * 40, "adapter": reload.ADAPTER_ID,
            "acceptedFit": reload.ACCEPTED_FIT, "runtimeCodeCanonicalLfSha256": self.canonical_pins}
        self.temp = tempfile.TemporaryDirectory(prefix="cpu-fixture-", dir=PRIVATE)
        self.root = Path(self.temp.name).resolve(); self.inputs = self.root / "inputs"
        self.inputs.mkdir()
        self.paths = {n: self.inputs / "accepted-fit" / n for n in reload.FIT_FILES}
        retained = Path(reload.FIT_ROOT)
        for n, relative in reload.FIT_FILES.items():
            if n.endswith(".safetensors"): continue
            source = Path(reload.ACCEPTED_FIT["acceptancePath"] if n == "acceptance.json" else
                reload.ACCEPTED_FIT["reviewPath"] if n == "review.json" else retained / relative)
            p = self.paths[n]; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(source.read_bytes())
        self.acceptance = json.loads(self.paths["acceptance.json"].read_bytes())
        self.accepted = json.loads(self.paths["accepted-map.json"].read_bytes())
        self.fit_pins = reload.fit_pins(self.acceptance, self.accepted)
        values = {n: (spec["dtype"], spec["shape"],
            (struct.pack("<f", 60.0) if n.startswith("step:") else b"\0" * (4 if spec["dtype"] == "F32" else 1) * __import__("math").prod(spec["shape"])))
            for n, spec in checkpoint.tensor_specs(checkpoint.production_shapes()).items()}
        manifest = json.loads(self.paths["checkpoint/manifest.json"].read_bytes())
        self.checkpoint_raw = serialize(values, manifest["files"]["tensors.safetensors"]["bytes"])
        adapter_values = {n.replace(".default.", "."): ("F32", shape, b"\0" * 4 * __import__("math").prod(shape))
            for n, shape in checkpoint.production_shapes().items()}
        self.adapter_raw = serialize(adapter_values, 2175168)
        self.paths["checkpoint/tensors.safetensors"].write_bytes(self.checkpoint_raw)
        self.paths["adapter/adapter_model.safetensors"].write_bytes(self.adapter_raw)
        self.sha_map = {hashlib.sha256(self.checkpoint_raw).hexdigest(): self.fit_pins["checkpoint/tensors.safetensors"],
            hashlib.sha256(self.adapter_raw).hexdigest(): self.fit_pins["adapter/adapter_model.safetensors"]}
        for n in reload.ARTIFACT_PINS:
            (self.inputs / n).write_bytes((self.artifact_root / n).read_bytes())
        for n in reload.INPUT_NAMES.values():
            (self.inputs / n).write_bytes((self.artifact_root / n).read_bytes())
        self.assignment_raw = checkpoint.canonical(self.assignment)
        (self.inputs / reload.ASSIGNMENT_NAME).write_bytes(self.assignment_raw)
        self.freeze = reload.make_freeze(self.assignment, self.assignment_raw, self.physical_pins,
            {"accepted-fit/" + n: p for n, p in self.fit_pins.items()}, verified_root=self.root)
        (self.inputs / "run-freeze.json").write_bytes(checkpoint.canonical(self.freeze))
        self.profile = {"root": str(self.root), "files": {
            **{"code/" + n: p for n, p in self.physical_pins.items()},
            **{"inputs/" + n: p for n, p in self.freeze["auxiliaryInputSha256"].items()},
            **{"inputs/" + reload.INPUT_NAMES[k]: p for k, p in reload.INPUT_PINS.items()},
            "inputs/run-freeze.json": checkpoint.sha(checkpoint.canonical(self.freeze)),
            "inputs/runtime-requirements-resolved.txt": phase.REQUIREMENTS_SHA,
            **{"model/" + r["file"]: r["sha256"] for r in json.loads((self.inputs / "model-acquisition.json").read_bytes())["files"]}}}
        self.batch = json.loads((self.inputs / "development.json").read_bytes())
        self.contract = json.loads((self.inputs / "legacy-schema-v1.json").read_bytes())
        self.family = json.loads((self.inputs / "family-freeze.json").read_bytes())
        self.authority = {"freeze": self.freeze, "inputs": self.inputs, "verified_root": self.root, "profile": self.profile}

    def close(self): self.temp.cleanup()

    def mocked_sha(self, raw):
        real = hashlib.sha256(raw).hexdigest()
        return self.sha_map.get(real, real)

    @contextlib.contextmanager
    def doubles(self):
        original_read = checkpoint.read_bytes
        def read(path, maximum, *, verified_root=None):
            path = Path(path)
            if path.is_relative_to(self.root / "code"):
                return self.source_bytes[path.relative_to(self.root / "code").as_posix()]
            return original_read(path, maximum, verified_root=verified_root)
        with patch.object(checkpoint, "sha", self.mocked_sha), patch.object(reload, "sha", self.mocked_sha), \
             patch.object(checkpoint, "read_bytes", read), \
             patch.object(reload, "__file__", str(self.root / "code/services/geo/geo/usp_learning/association/fragment_rank_reload.py")), \
             patch.object(reload.adapter, "digest_file", lambda p: self.mocked_sha(Path(p).read_bytes())):
            yield

    def bundle(self): return reload.checked_fit_bundle(self.paths, verified_root=self.root)


class Scalar:
    def __init__(self, value): self.value = value
    def to(self, dtype): return Scalar(struct.unpack("<f", struct.pack("<f", self.value))[0])
    def item(self): return self.value
    def __sub__(self, other): return Scalar(struct.unpack("<f", struct.pack("<f", self.value - other.value))[0])


class Logits:
    shape, dtype = (1, 1, 32), "float16-double"
    def __init__(self, margin): self.margin = margin
    def __getitem__(self, key): return Scalar(0.0 if key[-1] == 10 else self.margin)


class InputTensor:
    shape = (1, 1)
    def __getitem__(self, key): return self
    def tolist(self): return [101]
    def to(self, device): return self


class StateTensor:
    dtype, requires_grad, grad = "float32-double", False, None
    def __init__(self, shape, raw): self.shape, self.raw = shape, raw
    def detach(self): return self
    def cpu(self): return self
    def contiguous(self): return self
    def numpy(self): return types.SimpleNamespace(tobytes=lambda: self.raw)


class Qwen2ForCausalLM: pass


class PeftModel:
    def __init__(self, fixture):
        self.training = False
        self.config = types.SimpleNamespace(model_type="qwen2", vocab_size=32)
        config = json.loads(fixture.paths["adapter/adapter_config.json"].read_bytes())
        self.peft_config = {"default": types.SimpleNamespace(to_dict=lambda: config)}
        self.active_adapters = ["default"]
        self.values = {n: StateTensor(shape, b"\0" * 4 * __import__("math").prod(shape)) for n, shape in checkpoint.production_shapes().items()}
        self.saved = {n.replace(".default.", "."): p for n, p in self.values.items()}
        self.values.update({"base" + str(i): StateTensor([1], b"\0" * 4) for i in range(290)})
        self.margins = iter([1, 0, -1, 2, 0, -2, -1]); self.calls = 0
    def get_base_model(self): return Qwen2ForCausalLM()
    def parameters(self): return self.values.values()
    def named_parameters(self): return self.values.items()
    def modules(self): return [self, *(types.SimpleNamespace(training=False, lora_A={}, disable_adapters=False, merged=False) for _ in range(48))]
    def __call__(self, **kwargs):
        assert kwargs["logits_to_keep"] == 1 and kwargs["use_cache"] is False
        self.calls += 1
        return types.SimpleNamespace(logits=Logits(next(self.margins)))


class Controls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = Fixture()
        for name in (*reload.SOURCE_PATHS, "scripts/usp/learning/association/test_fragment_rank_reload.py"):
            compile((REPO / name).read_bytes(), name, "exec")
        assert len(reload.PROTECTED_PINS) == 33
        snapshot = json.loads((PRIVATE / "preflight.json").read_bytes())["protectedSources"]
        assert reload.PROTECTED_PINS == {n: p["canonicalLfSha256"] for n, p in snapshot.items()}

    @classmethod
    def tearDownClass(cls): cls.fixture.close()

    def test_1_authority_dispatch_before_effects(self):
        f = self.fixture
        with f.doubles():
            self.assertEqual(stager.checked_stage_assignment(f.assignment)[1], "fragment-rank-reload")
            for changes in ({"executable": False}, {"version": "association-fragment-rank-reload-prototype/1"},
                    {"acceptedFit": {**reload.ACCEPTED_FIT, "acceptanceSha256": "0" * 64}}, {"settings": {}}, {"adapter": None},
                    {"extra": True}, {"runtimeCodeCanonicalLfSha256": {**f.canonical_pins, next(iter(reload.PROTECTED_PINS)): "0" * 64}}):
                with self.assertRaises(REJECTED):
                    stager.checked_stage_assignment({**f.assignment, **changes})
            for freeze in ({"version": "association-fragment-rank-reload-prototype/1"}, {"version": "association-baseline-freeze/1", "adapter": reload.ADAPTER_ID, "donors": reload.DONORS}):
                with self.assertRaises(RuntimeError): worker.preadmit_rank(freeze, f.inputs)
            with self.assertRaises(REJECTED):
                student.run_local(f.batch["examples"], f.contract, f.family, f.root / "model", lambda: None, lambda *a: None,
                    rank_authority={"freeze": {}, "inputs": f.inputs}, model_loader=lambda _: None, preserve_preflight=lambda _: None, preserve_technical=lambda _: None)
            with self.assertRaises(REJECTED): reload._Session(f.authority, f.bundle(), lambda _: None)
            selected, options, _ = worker.admitted_runtime(f.freeze, f.inputs, lambda _: None, lambda _: None,
                verified_root=f.root, profile=f.profile)
            self.assertIs(selected, reload.run); self.assertEqual(options["rank_reload_authority"]["verified_root"], f.root)
            # Legacy explicit dispatch still returns its original runner/options.
            with patch.object(baseline, "checked_run_inputs", return_value=(None, None, None)):
                selected, options, _ = worker.admitted_runtime({"version": baseline.FREEZE_VERSION}, f.inputs, lambda _: None, lambda _: None)
                self.assertIs(selected, student.run_local); self.assertIn("rank_authority", options)
            self.assertIs(worker.admitted_runtime({"version": "association-baseline-freeze/1"}, f.inputs, None)[0], student.run_local)
            # Actual stager path, intercepted at its first mkdir. No copy occurs.
            packet = f.root / "cpu-assignment.json"; packet.write_bytes(f.assignment_raw)
            donors = {n: (f.root / n, p) for n, p in f.profile["files"].items() if n.startswith("model/")}
            donors["runtime/python.exe"] = (f.root / "runtime/python.exe", "0" * 64)
            def git(args, **kwargs):
                if args[1] == "rev-parse": return "a" * 40
                if args[1] == "status": return ""
                return f.source_bytes[args[2].split(":", 1)[1]].replace(b"\r\n", b"\n")
            with patch.object(reload, "accepted_fit_files", return_value={"accepted-fit/" + n: (p, f.fit_pins[n]) for n, p in f.paths.items()}), \
                 patch.object(stager, "rank_donor_plan", return_value=donors), patch.object(stager.subprocess, "check_output", side_effect=git), \
                 patch.object(stager.shutil, "disk_usage", return_value=types.SimpleNamespace(free=20 * 1024**3)), \
                 patch.object(Path, "mkdir", side_effect=RuntimeError("first mkdir intercepted")) as mkdir:
                with self.assertRaisesRegex(RuntimeError, "first mkdir intercepted"): thin.stage(packet)
                self.assertEqual(mkdir.call_count, 1)
            # Actual worker admission, stopped before any output or native work.
            args = types.SimpleNamespace(run_freeze=f.inputs / "run-freeze.json", output_dir=f.root / "outputs/baseline",
                **{k: f.inputs / n for k, n in reload.INPUT_NAMES.items()})
            with patch.object(worker, "require_model_boundary", return_value=(f.root, f.profile, {})), \
                 patch.object(Path, "mkdir", side_effect=RuntimeError("worker mkdir intercepted")) as mkdir:
                with self.assertRaisesRegex(RuntimeError, "worker mkdir intercepted"): worker.worker(args)
                self.assertEqual(mkdir.call_count, 1)

    def test_2_copied_fit_scope_and_tensor_integrity(self):
        f = self.fixture
        with f.doubles():
            original_lstat = Path.lstat
            def denied_outer(path, *args, **kwargs):
                if not path.is_relative_to(f.root): raise PermissionError("outside ancestor or historical path denied")
                return original_lstat(path, *args, **kwargs)
            with patch.object(Path, "lstat", denied_outer):
                schema, _, route, bundle = reload.checked_run_inputs(**f.authority)
                self.assertEqual(bundle["pins"], f.fit_pins)
                self.assertEqual(len(route["contexts"]), 2)
            with self.assertRaises(PermissionError):
                with patch.object(Path, "lstat", side_effect=PermissionError("in scope denial")): f.bundle()
            with self.assertRaises(REJECTED): checkpoint.checked_path(f.root / ".." / "escape", verified_root=f.root)
            # Reparse metadata double avoids requiring symlink privileges.
            redirected = f.inputs
            def reparse(path, *args, **kwargs):
                if path == redirected: return types.SimpleNamespace(st_mode=0, st_file_attributes=1024)
                return original_lstat(path, *args, **kwargs)
            with patch.object(Path, "lstat", reparse):
                with self.assertRaises(REJECTED): checkpoint.checked_path(redirected, verified_root=f.root)
            for name in ("acceptance.json", "result.json", "checkpoint/state.json", "adapter/adapter_config.json"):
                p = f.paths[name]; saved = p.read_bytes(); p.write_bytes(saved + b" ")
                try:
                    with self.assertRaises(REJECTED): f.bundle()
                finally: p.write_bytes(saved)
            profile = copy.deepcopy(f.profile); profile["files"]["inputs/teacher-targets.json"] = "0" * 64
            with self.assertRaises(REJECTED): reload.checked_run_inputs(**{**f.authority, "profile": profile})
            profile = copy.deepcopy(f.profile); profile["files"]["model/model.safetensors"] = "0" * 64
            with self.assertRaises(REJECTED): reload.checked_run_inputs(**{**f.authority, "profile": profile})
            self.assertEqual(reload.serialized_adapter_check(f.adapter_raw, f.checkpoint_raw)["parameters"], 540672)
            changed = bytearray(f.adapter_raw); start = 8 + struct.unpack("<Q", changed[:8])[0]; changed[start:start + 4] = struct.pack("<f", 1.0)
            with self.assertRaisesRegex(REJECTED, "checkpoint_mismatch"): reload.serialized_adapter_check(changed, f.checkpoint_raw)
            with self.assertRaises(REJECTED): reload.serialized_adapter_check(f.adapter_raw + b"extra", f.checkpoint_raw)

    def test_3_native_doubles_and_unchanged_score_projection(self):
        f = self.fixture
        torch = types.SimpleNamespace(float32="float32-double", inference_mode=contextlib.nullcontext,
            cuda=types.SimpleNamespace(synchronize=lambda: None))
        tokenizer = lambda *args, **kwargs: {"input_ids": InputTensor(), "attention_mask": InputTensor()}
        model = PeftModel(f)
        fake_peft = types.ModuleType("peft"); fake_peft.PeftModel = PeftModel; fake_peft.get_peft_model_state_dict = lambda m: m.saved
        fake_transformers = types.ModuleType("transformers"); fake_transformers.Qwen2ForCausalLM = Qwen2ForCausalLM
        with f.doubles(), patch.dict(sys.modules, {"peft": fake_peft, "transformers": fake_transformers}), \
             patch.object(reload.adapter, "_tensor_digest", return_value=phase.BASE):
            bundle = f.bundle(); sessions = []
            def capture(*args, model_loader, **kwargs):
                sessions.append(reload._Session(f.authority, bundle, model_loader)); return [], {}
            reload.adapter.reload_and_compare([], {}, {}, f.root / "model", bundle["adapterDirectory"], bundle["manifest"], lambda: None, lambda *a: None, inference_runner=capture)
            session = sessions[0]
            session.shared_proof.update(tensorCount=96, savedTensorsExact=True, explicitLocalBase=True, remoteBaseLookup=False)
            native = session.verify_native(model, torch)
            self.assertTrue(native["loadedEqualsSavedEqualsCheckpointMasters"])
            first = next(iter(model.saved)); original = model.saved[first].raw; model.saved[first].raw = b"bad"
            try:
                with self.assertRaisesRegex(REJECTED, "native_tensor_value"): session.verify_native(model, torch)
            finally: model.saved[first].raw = original
            with patch.object(reload.adapter, "_tensor_digest", return_value={"tensorCount": 290, "sha256": "0" * 64}):
                with self.assertRaisesRegex(REJECTED, "native_base"): session.verify_native(model, torch)
            session.verify_native(model, torch)
            schema, contexts = session.admit(f.batch["examples"], f.contract, f.family, (f.root, f.profile, {}))
            prepared = []
            for i, context in enumerate(contexts):
                for j, candidate in enumerate(context.snapshot()["candidates"]):
                    prepared.append({"prompt": "cpu-double-prompt", "inputIds": [101], "record": {
                        "exampleId": context.snapshot()["exampleId"], "exampleIndex": i, "candidateIndex": j,
                        "candidateId": candidate["id"], "candidateSetSha256": context.input_sha256, "labelIds": {"0": 10, "1": 11}}})
            raw, proofs = [], []
            with patch.object(runtime, "technical_loss_proof", side_effect=AssertionError("proof campaign must not rerun")):
                records, result = runtime.run_scores(model, tokenizer, prepared, contexts, schema, f.contract, f.family, torch,
                    lambda: None, lambda i, r: raw.append(r), proofs.append, reload_session=session)
            self.assertEqual(len(raw), 7); self.assertEqual(model.calls, 7); self.assertEqual(len(result["scoreVectors"]), 2)
            self.assertEqual([r["margin"] for r in records], [1, 0, -1, 2, 0, -2, -1])
            self.assertTrue(all(r["scoreOrigin"] == "accepted_rank_adapter_last_prompt_position" and r["adapterApplied"] for r in records))
            self.assertTrue(proofs[0]["baseUnchanged"]); self.assertFalse(result["fitPerformedInThisProcess"])
            self.assertEqual(result["scoreVectors"][0]["scores"], [{"candidateId": c["id"], "margin": m} for c, m in zip(contexts[0].snapshot()["candidates"], [1, 0, -1, 2])])
            self.assertEqual(result["results"][1]["retrievedFragmentCount"], 0)
            with self.assertRaises(REJECTED): runtime.project_records(records[:-1], prepared, contexts, schema, f.contract, f.family)
            with self.assertRaisesRegex(REJECTED, "original_qwen2"): runtime.run_scores(model, tokenizer, prepared, contexts, schema, f.contract, f.family, torch, lambda: None, lambda *a: None, lambda _: None)
            session.proof = None
            with self.assertRaisesRegex(REJECTED, "native_proof"): runtime.run_scores(model, tokenizer, prepared, contexts, schema, f.contract, f.family, torch, lambda: None, lambda *a: None, lambda _: None, reload_session=session)
        self.assertTrue(all(n not in sys.modules for n in BLOCKED))


if __name__ == "__main__":
    unittest.main(verbosity=2)
