"""Focused STUDENT-26 CPU controls; no native libraries or stage side effects.

Run with -B -I -S. Future assignment/clean Git state, tokenizer, tensors, model
and native loss proof are technical doubles; retained source metadata is real.
"""
from __future__ import annotations

import builtins
from contextlib import nullcontext
import copy
import hashlib
import json
from pathlib import Path
import struct
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "services/geo"), str(Path(__file__).resolve().parent)]
ORIGINAL_IMPORT = builtins.__import__
NATIVE_DOUBLES = {}
BLOCKED_IMPORTS = []


def cpu_import(name, *args, **kwargs):
    if name.split(".")[0] in {"torch", "transformers", "tokenizers", "safetensors", "numpy", "peft", "psutil"}:
        if name in NATIVE_DOUBLES:
            return NATIVE_DOUBLES[name]
        BLOCKED_IMPORTS.append(name)
        raise AssertionError("native import blocked: " + name)
    return ORIGINAL_IMPORT(name, *args, **kwargs)


builtins.__import__ = cpu_import
from geo.usp_learning.association import fragment_rank as rank, fragment_rank_baseline as admission
from geo.usp_learning.association import fragment_rank_runtime as runtime, student
from geo.usp_learning.association.validation import InvalidEvidence
import association_student as worker
import stage_selector_baseline as stager

METADATA_ROOT = Path(admission.DONORS["model"]["root"]) / "inputs"
READ_BYTES = Path.read_bytes
SOURCE_BYTES = {name: (REPO / name).read_bytes() for name in admission.SOURCE_PATHS}
PHYSICAL = {name: admission.sha(raw) for name, raw in SOURCE_BYTES.items()}
CANONICAL = {name: admission.sha(raw.replace(b"\r\n", b"\n")) for name, raw in SOURCE_BYTES.items()}
INPUTS = {key: (METADATA_ROOT / name).read_bytes() for key, name in admission.INPUT_NAMES.items()}
ARTIFACTS = {name: (METADATA_ROOT / name).read_bytes() for name in admission.ARTIFACT_PINS}
BATCH, CONTRACT, FAMILY = (json.loads(INPUTS[key]) for key in ("input_batch", "schema", "family_freeze"))
SCHEMA = rank.codec.checked_schema(ARTIFACTS["fragment-schema-v1.json"])
ROUTE = json.loads(ARTIFACTS["fragment-route.json"])
CONTEXTS = rank.codec.checked_route(ROUTE, BATCH["examples"], SCHEMA, CONTRACT, FAMILY)
MOCK_HEAD = "f" * 40
MOCK_ASSIGNMENT = {
    "version": admission.ASSIGNMENT_VERSION, "task": admission.TASK, "executionAllowance": admission.ALLOWANCE,
    "studentCodeCommit": MOCK_HEAD, "model": admission.MODEL, "revision": admission.REVISION, "adapter": None,
    "settings": student.SETTINGS, "donors": admission.DONORS, "inputSha256": admission.INPUT_PINS,
    "acceptedArtifactSha256": admission.ARTIFACT_PINS, "representation": rank.metadata(), "cases": admission.CASES,
    "runtimeCodeCanonicalLfSha256": CANONICAL, "artifactRoot": str(METADATA_ROOT),
}
ASSIGNMENT_PATH = METADATA_ROOT / admission.ASSIGNMENT_NAME  # virtual, never written
MOCK_MODEL = REPO / "technical-double-model-not-on-disk"
TOKENIZER_BYTES = {name: ("technical-double:" + name).encode() for name in runtime.TOKENIZER_PINS}
TOKENIZER_PINS = {name: admission.sha(raw) for name, raw in TOKENIZER_BYTES.items()}


def assignment_bytes(value=MOCK_ASSIGNMENT):
    return json.dumps(value, sort_keys=True).encode()


def virtual_read(path):
    if path == ASSIGNMENT_PATH:
        return assignment_bytes()
    if path.parent == MOCK_MODEL and path.name in TOKENIZER_BYTES:
        return TOKENIZER_BYTES[path.name]
    return READ_BYTES(path)


def mock_git(command, **kwargs):
    if command[1:] == ["rev-parse", "HEAD"]:
        return MOCK_HEAD + "\n"
    if command[1:] == ["status", "--porcelain"]:
        return ""
    if command[1] == "show":
        return SOURCE_BYTES[command[2].split(":", 1)[1]].replace(b"\r\n", b"\n")
    raise AssertionError(command)


class FirstEffect(Exception):
    pass


class Tensor:
    """Small shape/index/cast double, not a numerical native-proof substitute."""
    def __init__(self, values, dtype="float16", casts=None):
        self.values, self.dtype, self.casts = values, dtype, casts if casts is not None else []

    @property
    def shape(self):
        value, shape = self.values, []
        while isinstance(value, list):
            shape.append(len(value))
            value = value[0] if value else None
        return tuple(shape)

    def __getitem__(self, key):
        value = self.values
        for index in key if isinstance(key, tuple) else (key,):
            value = value[index]
        return Tensor(value, self.dtype, self.casts)

    def to(self, device=None, *, dtype=None):
        if dtype is not None:
            self.casts.append(dtype)
            return Tensor(struct.unpack("f", struct.pack("f", self.values))[0], dtype, self.casts)
        return self

    def item(self):
        return self.values

    def tolist(self):
        return self.values

    def __sub__(self, other):
        return Tensor(struct.unpack("f", struct.pack("f", self.values - other.values))[0], "float32", self.casts)


class Tokenizer:
    all_special_ids = []

    def __init__(self):
        self.texts, self.mode = {}, None

    def apply_chat_template(self, messages, **kwargs):
        assert kwargs == {"tokenize": False, "add_generation_prompt": True}
        return json.dumps(messages, ensure_ascii=False) + "<assistant>"

    def encode(self, text, **kwargs):
        assert kwargs == {"add_special_tokens": False}
        if text[-1:] in ("0", "1") and text[:-1] in self.texts:
            ids = [self.texts[text[:-1]], 2]
            if self.mode == "prefix":
                ids[0] += 1
            return ids + ([0, 1] if self.mode == "multiple" else [int(text[-1])])
        if text not in self.texts:
            self.texts[text] = len(self.texts) + 10
        return [self.texts[text], 2]

    def decode(self, ids, **kwargs):
        assert kwargs == {"skip_special_tokens": False, "clean_up_tokenization_spaces": False}
        mapping = {index: text for text, index in self.texts.items()}
        mapping.update({0: "0", 1: "1", 2: ""})
        if self.mode == "decode":
            mapping[1] = "yes"
        return "".join(mapping[index] for index in ids)

    def __call__(self, prompt, **kwargs):
        assert kwargs == {"return_tensors": "pt", "add_special_tokens": False, "truncation": False}
        ids = self.encode(prompt, add_special_tokens=False)
        if self.mode == "forward-prefix":
            ids[0] += 1
        return {"input_ids": Tensor([ids]), "attention_mask": Tensor([[1] * len(ids)])}


class Qwen2ForCausalLM:
    config = SimpleNamespace(model_type="qwen2", vocab_size=128)

    def __init__(self):
        self.calls, self.mode, self.casts = [], None, []

    def to(self, device):
        assert device == "cuda"
        return self

    def eval(self):
        return self

    def __call__(self, **kwargs):
        assert kwargs["logits_to_keep"] == 1 and kwargs["use_cache"] is False and kwargs["return_dict"] is True
        self.calls.append(kwargs)
        logits = [0.0] * self.config.vocab_size
        logits[1] = [-1.0, 0.0, 1.0][(len(self.calls) - 1) % 3]
        if self.mode == "nonfinite":
            logits[0] = float("nan")
        return SimpleNamespace(logits=Tensor([[logits, logits]] if self.mode == "shape" else [[logits]], casts=self.casts))


def torch_double():
    cuda = SimpleNamespace(is_available=lambda: True, mem_get_info=lambda: (7 * 1024**3, 8 * 1024**3),
        set_per_process_memory_fraction=lambda *a: None, reset_peak_memory_stats=lambda: None,
        memory_allocated=lambda: 1024, memory_reserved=lambda: 2048, synchronize=lambda: None,
        max_memory_allocated=lambda: 1024, max_memory_reserved=lambda: 2048, get_device_name=lambda: "CPU technical double")
    return SimpleNamespace(__version__="CPU-double", float16="float16", float32="float32", cuda=cuda,
        version=SimpleNamespace(cuda="CPU-double"), inference_mode=nullcontext,
        set_num_threads=lambda *a: None, set_num_interop_threads=lambda *a: None, manual_seed=lambda *a: None,
        use_deterministic_algorithms=lambda *a: None, backends=SimpleNamespace(cuda=SimpleNamespace(matmul=SimpleNamespace(allow_tf32=None))))


class RankControls(unittest.TestCase):
    def test_admission_stage_freeze_and_dispatch(self):
        self.assertEqual(rank.metadata()["policySha256"], "ab32fe7cb76e34aca57dbc799b9664c8a05f26aae1eaa13dffdc1e19ae0cb5e2")
        self.assertEqual(rank.PROMPT_SHA, "39ced4c36b37c0d67d3f68c95e10acdd8791c7e745d2139717aa050392cea6b5")
        # Real donor profiles and nine source-only inputs. Only future clean Git
        # metadata/assignment are mocked. mkdir is the sole intercepted effect.
        freezes, effects = [], []
        real_freeze = admission.make_freeze
        def capture_freeze(*args):
            value = real_freeze(*args)
            freezes.append(value)
            return value
        def stop_effect(path, *args, **kwargs):
            effects.append(str(path))
            self.assertEqual(len(freezes), 1)
            raise FirstEffect("stopped before mkdir")
        with patch.object(Path, "read_bytes", virtual_read), patch.object(stager.subprocess, "check_output", mock_git), \
                patch.object(admission, "make_freeze", capture_freeze), patch.object(Path, "mkdir", stop_effect):
            with self.assertRaises(FirstEffect):
                stager.stage(ASSIGNMENT_PATH)
        self.assertEqual(len(effects), 1)
        freeze = freezes[0]
        with patch.object(Path, "read_bytes", virtual_read):
            runner, options, prompt = worker.admitted_runtime(freeze, METADATA_ROOT, lambda v: None, lambda v: None)
            self.assertIs(runner, student.run_local)
            self.assertEqual(prompt, rank.SYSTEM_PROMPT)
            schema, contexts = admission.checked_loader_authority(options["rank_authority"], BATCH["examples"], CONTRACT, FAMILY)
            self.assertEqual(schema, SCHEMA)
            self.assertEqual(len(contexts), 2)
            bad = copy.deepcopy(freeze); bad["settings"]["seed"] = 18
            with self.assertRaises(InvalidEvidence):
                worker.preadmit_rank(bad, METADATA_ROOT)
        bads = [{"version": "student-fragment-rank-native-code-assignment/1", "task": "STUDENT-26-FRAGMENT-RANK-NATIVE-CODE"},
                {"version": "student-fragment-rank-cpu-assignment/1"}, copy.deepcopy(MOCK_ASSIGNMENT)]
        bads[-1]["fragmentRoute"] = {}
        for bad in bads:
            with patch.object(stager, "rank_donor_plan", side_effect=AssertionError("donor accessed before admission")), \
                    patch.object(Path, "mkdir", side_effect=AssertionError("unexpected effect")), \
                    patch.object(Path, "read_bytes", lambda path: assignment_bytes(bad) if path == ASSIGNMENT_PATH else virtual_read(path)):
                with self.assertRaises(InvalidEvidence):
                    stager.stage(ASSIGNMENT_PATH)
        drifted = dict(ARTIFACTS); drifted["context-0.json"] += b" "
        with self.assertRaises(InvalidEvidence):
            admission.checked_payload(MOCK_ASSIGNMENT, INPUTS, drifted)
        with self.assertRaises(InvalidEvidence):
            stager.checked_source_pins(SOURCE_BYTES, {}, CANONICAL, rank_mode=True, fragment_mode=True)
        for bad in ({"version": "association-fragment-rank-baseline-freeze/2"},
                    {"version": "association-baseline-freeze/1", "rankAuthority": {}},
                    {"version": "student-fragment-rank-native-code-assignment/1"}):
            with self.assertRaises(RuntimeError):
                worker.preadmit_rank(bad, METADATA_ROOT)
        self.assertEqual(worker.admitted_runtime({"version": "association-baseline-freeze/1"}, METADATA_ROOT, None),
                         (student.run_local, {}, student.SYSTEM_PROMPT))
        with patch.object(admission.source, "checked_run_inputs", return_value=(SCHEMA, {}, ROUTE)):
            runner, options, prompt = worker.admitted_runtime({"version": admission.source.FREEZE_VERSION}, METADATA_ROOT, lambda v: None)
            self.assertIs(runner, student.run_local)
            self.assertEqual(options["fragment_route"], ROUTE)
            self.assertEqual(prompt, rank.codec.SYSTEM_PROMPT)
        with self.assertRaises(InvalidEvidence):
            rank.scoring_input(CONTEXTS[0].snapshot(), "c0", SCHEMA, CONTRACT, FAMILY)  # train default unchanged
        with self.assertRaises(InvalidEvidence):
            rank.scoring_input(CONTEXTS[0].snapshot(), "c0", SCHEMA, CONTRACT, FAMILY, allowed_splits=("evaluation",))

    def test_existing_loader_complete_scores_and_raw_before_projection(self):
        tokenizer, model, torch = Tokenizer(), Qwen2ForCausalLM(), torch_double()
        loads, preflight, proofs, raw, boundaries = [], [], [], [], []
        def load_model(path, **kwargs):
            loads.append(kwargs)
            return model
        transformers = SimpleNamespace(__version__="4.57.6", AutoTokenizer=SimpleNamespace(from_pretrained=lambda *a, **k: tokenizer),
            AutoModelForCausalLM=SimpleNamespace(from_pretrained=load_model), StoppingCriteria=object, StoppingCriteriaList=list)
        freeze = admission.make_freeze(MOCK_ASSIGNMENT, assignment_bytes(), PHYSICAL)
        NATIVE_DOUBLES.update(torch=torch, transformers=transformers)
        try:
            with patch.object(Path, "read_bytes", virtual_read), patch.object(runtime, "TOKENIZER_PINS", TOKENIZER_PINS), \
                    patch.object(runtime, "technical_loss_proof", return_value={"cpuDouble": True, "nativeProof": "unrun"}) as technical:
                runner, options, _ = worker.admitted_runtime(freeze, METADATA_ROOT, preflight.append, proofs.append)
                records, result = runner(BATCH["examples"], CONTRACT, FAMILY, MOCK_MODEL, lambda: boundaries.append(True),
                    lambda index, record: raw.append((index, record)), **options)
                technical.assert_called_once_with(torch)
        finally:
            NATIVE_DOUBLES.clear()
        self.assertEqual(len(loads), 1)
        self.assertEqual(loads[0], {"local_files_only": True, "trust_remote_code": False, "use_safetensors": True,
                                  "torch_dtype": "float16", "attn_implementation": "sdpa"})
        self.assertEqual(len(boundaries), 1)
        self.assertEqual(len(preflight[0]["focuses"]), 7)
        self.assertEqual(len(proofs), 1)
        self.assertEqual(len(model.calls), 7)
        self.assertEqual(model.casts, ["float32"] * 14)
        self.assertEqual([index for index, _ in raw], list(range(7)))
        self.assertEqual([r for _, r in raw], records)
        self.assertEqual([len(v["scores"]) for v in result["scoreVectors"]], [4, 3])
        self.assertEqual(result["results"][0]["selection"]["selected"], ["c2"])  # synthetic scores, not source labels
        self.assertEqual(result["modelOutputValidCount"], 2)
        with patch.object(Path, "read_bytes", virtual_read):
            for override in ({"model_loader": lambda p: model}, {"fragment_route": ROUTE}):
                with self.assertRaises(InvalidEvidence):
                    student.run_local(BATCH["examples"], CONTRACT, FAMILY, MOCK_MODEL, lambda: None, lambda *a: None,
                        rank_authority={"freeze": freeze, "inputs": METADATA_ROOT}, preserve_preflight=lambda v: None,
                        preserve_technical=lambda v: None, **override)

    def test_token_forward_and_whole_vector_failures(self):
        tokenizer, torch = Tokenizer(), torch_double()
        for mode in ("multiple", "prefix", "decode"):
            tokenizer.mode = mode
            with self.assertRaises(InvalidEvidence):
                runtime.label_boundary(tokenizer, "synthetic prompt")
        tokenizer.mode = None
        with patch.object(Path, "read_bytes", virtual_read), patch.object(runtime, "TOKENIZER_PINS", TOKENIZER_PINS):
            prepared = runtime.prepare(tokenizer, MOCK_MODEL, CONTEXTS, SCHEMA, CONTRACT, FAMILY, student.SETTINGS, lambda v: None)
        model = Qwen2ForCausalLM()
        for mode in ("shape", "nonfinite"):
            model.mode = mode
            with self.assertRaises(InvalidEvidence):
                runtime.score_focus(model, tokenizer, prepared[0], torch, lambda: None)
        model.mode = None
        tokenizer.mode = "forward-prefix"
        with self.assertRaises(InvalidEvidence):
            runtime.score_focus(model, tokenizer, prepared[0], torch, lambda: None)
        tokenizer.mode = None
        records = [runtime.score_focus(model, tokenizer, item, torch, lambda: None) for item in prepared]
        for mode in ("incomplete", "order", "nonfinite"):
            bad = copy.deepcopy(records)
            if mode == "incomplete":
                bad.pop()
            elif mode == "order":
                bad[0], bad[1] = bad[1], bad[0]
            else:
                bad[0]["margin"] = float("inf")
            with self.assertRaises(InvalidEvidence):
                runtime.project_records(bad, prepared, CONTEXTS, SCHEMA, CONTRACT, FAMILY)
        # A failed later score leaves earlier raw evidence and no projected result.
        saved = []
        def fail_third(*args):
            if len(saved) == 2:
                raise RuntimeError("injected third score failure")
            return records[len(saved)]
        with patch.object(runtime, "technical_loss_proof", return_value={"nativeProof": "unrun"}), \
                patch.object(runtime, "score_focus", side_effect=fail_third), patch.object(runtime, "project_records") as project:
            with self.assertRaisesRegex(RuntimeError, "injected third"):
                runtime.run_scores(model, tokenizer, prepared, CONTEXTS, SCHEMA, CONTRACT, FAMILY, torch, lambda: None,
                    lambda index, value: saved.append(value), lambda v: None)
            project.assert_not_called()
        self.assertEqual(len(saved), 2)

    def test_analytic_reference_is_synthetic_and_equal_opposite(self):
        for zero, one, label, expected in ((0, 0, 0, [-0.5, 0.5]), (0, 0, 1, [0.5, -0.5]),
                (-1000, 1000, 0, [-1, 1]), (-1000, 1000, 1, [0, 0]), (1000, -1000, 1, [1, -1])):
            self.assertEqual(runtime.analytic_gradient(zero, one, label), expected)
        parents = [[(0.0, 0.0, i % 2)] * (i % 5 + 1) for i in range(10)]
        self.assertAlmostEqual(rank.parent_mean_loss(parents), rank.binary_loss(0, 0, 0), places=14)


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(RankControls)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(json.dumps({"tests": result.testsRun, "success": result.wasSuccessful(), "unexpectedNativeImportAttempts": BLOCKED_IMPORTS,
        "mocks": ["future assignment and clean Git head/blob responses", "tokenizer bytes/pins/IDs and tensors/Qwen forward",
                  "torch/transformers modules", "native technical loss proof"],
        "real": ["nine pinned source-only metadata inputs", "two pinned donor profiles", "executing source bytes",
                 "assignment/payload/source admission", "make_freeze before first intercepted mkdir", "dispatcher and existing loader"],
        "nativeProofOrInferenceOrModelCopyOrStagePerformed": False}, sort_keys=True))
    raise SystemExit(0 if result.wasSuccessful() and not BLOCKED_IMPORTS else 1)
