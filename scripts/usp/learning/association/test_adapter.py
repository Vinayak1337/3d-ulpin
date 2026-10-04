"""Targeted data-boundary, assistant-mask, local artifact and fixed-role controls."""
from __future__ import annotations

import argparse
import builtins
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "services/geo"), str(REPO / "scripts/usp/learning"), str(Path(__file__).resolve().parent)]
import association_adapter
import model_isolation as isolation
from geo.usp_learning.association import adapter, student
from geo.usp_learning.association.validation import InvalidEvidence
from stage_adapter import BASELINE, TEACHER
from geo.usp_learning.association.memory_observation import PhaseRecorder
from geo.usp_learning.association.query_attention import validate_options


class TokenizerControl:
    eos_token = "\u0003"
    eos_token_id = 3

    def apply_chat_template(self, messages, tokenize, add_generation_prompt):
        rendered = "".join(item["role"] + ":" + item["content"] + self.eos_token + "\n" for item in messages)
        return rendered + "assistant:" if add_generation_prompt else rendered

    def encode(self, text, add_special_tokens):
        return [ord(c) for c in text]


class AdapterTests(unittest.TestCase):
    def test_fit_attention_refuses_unsupported_context_and_options(self):
        validate_options(None, 0.0, 0.125, {"sliding_window": None, "use_cache": False, "output_attentions": False})
        for mask, dropout, scale, options in ((object(), 0.0, 0.125, {}), (None, 0.1, 0.125, {}),
                (None, 0.0, 0.25, {}), (None, 0.0, 0.125, {"use_cache": True}),
                (None, 0.0, 0.125, {"sliding_window": 128}), (None, 0.0, 0.125, {"output_attentions": True}),
                (None, 0.0, 0.125, {"is_causal": False}), (None, 0.0, 0.125, {"head_mask": object()})):
            with self.subTest(options=options), self.assertRaises(InvalidEvidence):
                validate_options(mask, dropout, scale, options)

    @classmethod
    def setUpClass(cls):
        cls.v1 = (TEACHER / "train-teacher-v1.jsonl").read_bytes()
        cls.v2 = (TEACHER / "train-teacher-v2.jsonl").read_bytes()
        cls.contract = json.loads((BASELINE / "inputs/schema-v1.json").read_bytes())
        cls.freeze = json.loads((BASELINE / "inputs/family-freeze.json").read_bytes())

    def test_exact_teacher_delta_and_reject_source_claim_or_metadata_changes(self):
        rows, delta = adapter.checked_teacher(self.v1, self.v2, self.contract, self.freeze)
        self.assertEqual((len(rows), delta["claimsUnchanged"], delta["addedCanonicalAbstentions"]), (11, 62, 11))
        self.assertEqual(sum(len(row["output"]["conflicts"]) for row in rows), 2)
        with self.assertRaisesRegex(InvalidEvidence, "teacher_v2_pin_drift"):
            adapter.checked_teacher(self.v1, self.v2 + b"\n", self.contract, self.freeze)
        for field in ("input", "output", "supervision"):
            changed = copy.deepcopy(rows)
            if field == "input":
                changed[0][field]["evidence"][0]["text"] += "changed"
            elif field == "output":
                changed[0][field]["claims"][0]["literal"] = "changed"
            else:
                changed[0][field]["unexpected"] = True
            raw = b"\n".join(json.dumps(row).encode() for row in changed)
            # Bypass only the outer byte pin to exercise the semantic delta boundary.
            with self.subTest(field=field), patch.object(adapter, "V2_SHA", hashlib.sha256(raw).hexdigest()):
                with self.assertRaises(InvalidEvidence):
                    adapter.checked_teacher(self.v1, raw, self.contract, self.freeze)

    def test_assistant_only_mask_eos_and_no_truncation(self):
        rows = [json.loads(self.v2.splitlines()[0])]
        encoded, lengths = adapter.encode_training(TokenizerControl(), rows)
        row = encoded[0]
        boundary = row["promptTokens"]
        self.assertEqual(row["labels"][:boundary], [-100] * boundary)
        self.assertEqual(row["labels"][boundary:], row["inputIds"][boundary:])
        self.assertEqual(row["labels"][-1], 3)
        self.assertEqual(lengths[0]["combinedTokens"], len(row["inputIds"]))
        self.assertGreater(len(row["inputIds"]), 4096)  # control characters, not actual model tokenization
        broken = TokenizerControl()
        broken.eos_token_id = -1
        with self.assertRaisesRegex(InvalidEvidence, "mask_alignment"):
            adapter.encode_training(broken, rows)

    def test_fit_and_reload_host_refuse_before_dependencies(self):
        original = builtins.__import__
        def deny_models(name, *args, **kwargs):
            if name.split(".")[0] in ("torch", "transformers", "peft", "safetensors"):
                raise AssertionError("model dependency imported on host")
            return original(name, *args, **kwargs)
        with patch.object(builtins, "__import__", deny_models):
            for action in ("fit", "reload"):
                with self.subTest(action=action), self.assertRaisesRegex(RuntimeError, "uncontained role refused"):
                    association_adapter.worker(argparse.Namespace(action=action))

    def test_saved_adapter_drift_and_unsafe_files_rejected(self):
        config = {"peft_type": "LORA", "task_type": "CAUSAL_LM", "r": 8, "lora_alpha": 16,
                  "lora_dropout": 0.05, "target_modules": ["q_proj", "v_proj"], "bias": "none", "modules_to_save": None}
        with tempfile.TemporaryDirectory(prefix="association-adapter-test-") as temporary:
            root = Path(temporary)
            (root / "adapter_config.json").write_text(json.dumps(config))
            (root / "adapter_model.safetensors").write_bytes(b"technical-integrity-control-only")
            (root / "README.md").write_text("technical control")
            manifest = {"files": {p.name: adapter.digest_file(p) for p in root.iterdir()}}
            adapter.verify_adapter_files(root, manifest)
            (root / "adapter_model.safetensors").write_bytes(b"changed")
            with self.assertRaisesRegex(InvalidEvidence, "pin_drift"):
                adapter.verify_adapter_files(root, manifest)
            (root / "pytorch_model.bin").write_bytes(b"refuse-pickle")
            with self.assertRaisesRegex(InvalidEvidence, "unsafe_adapter_file"):
                adapter.verify_adapter_files(root, manifest)
        for change in ({"r": 16}, {"target_modules": ["k_proj"]}, {"rank_pattern": {"q_proj": 16}}, {"modules_to_save": ["lm_head"]}):
            with self.subTest(change=change), self.assertRaises(InvalidEvidence):
                adapter.check_adapter_config({**config, **change})

    def test_fixed_actions_require_disjoint_fit_reload_inputs(self):
        root = isolation.ASSOCIATION_STAGING_PARENT / ("adapter-role-control-" + uuid.uuid4().hex)
        (root / "inputs/adapter").mkdir(parents=True)
        role = "code/scripts/usp/learning/association/association_adapter.py"
        profile = {"files": {role: "technical-control"}}
        for action in ("fit", "reload"):
            keys = ["schema", "family-freeze", "model-receipt", "run-freeze", "assignment"]
            keys += ["training-data", "teacher-v1"] if action == "fit" else ["input-batch", "adapter-manifest", "fit-proof"]
            command = [sys.executable, "association_adapter.py", action]
            for key in keys:
                path = root / "inputs" / (key + ".json")
                path.write_text("{}")
                command.extend(["--" + key, str(path)])
            if action == "reload":
                command.extend(["--adapter-dir", str(root / "inputs/adapter")])
            command.extend(["--output-dir", str(root / "outputs" / action), "--containment-profile", str(root / "profile.json"),
                            "--containment-sha256", "0" * 64])
            script, _ = isolation.checked_command(root, profile, command, root / "profile.json", "0" * 64)
            self.assertEqual(script, root / role)
            for bad in (command[:2] + ["run"] + command[3:], command + ["--input-batch" if action == "fit" else "--training-data", str(path)],
                        command[:3] + command[5:]):
                with self.subTest(action=action), self.assertRaises(RuntimeError):
                    isolation.checked_command(root, profile, bad, root / "profile.json", "0" * 64)

    def test_baseline_prompt_settings_and_generation_remain_exact(self):
        source = (BASELINE / "code/services/geo/geo/usp_learning/association/student.py").read_text()
        namespace = {"__name__": "geo.usp_learning.association.baseline_control", "__package__": "geo.usp_learning.association"}
        exec(compile(source, "accepted-baseline-control", "exec"), namespace)
        self.assertEqual(student.SYSTEM_PROMPT, namespace["SYSTEM_PROMPT"])
        self.assertEqual(student.SETTINGS, namespace["SETTINGS"])
        row = json.loads(self.v2.splitlines()[0])["input"]
        self.assertEqual(student.prompt_messages(row), namespace["prompt_messages"](row))
        current = (REPO / "services/geo/geo/usp_learning/association/student.py").read_text()
        # The actual generation and raw/projection path remain byte-identical.
        self.assertEqual(current[current.index("    raw_outputs, results = [], []"):], source[source.index("    raw_outputs, results = [], []"):])

    def test_unhealthy_cuda_preserves_native_failure_observation(self):
        with tempfile.TemporaryDirectory(prefix="association-memory-control-") as temporary:
            root = Path(temporary).resolve()
            self.assertEqual(root.parent, Path(tempfile.gettempdir()).resolve())
            self.assertTrue(root.name.startswith("association-memory-control-"))
            recorder = PhaseRecorder.__new__(PhaseRecorder)
            recorder.path = root / "phases.jsonl"
            recorder.started = time.perf_counter()
            recorder.native = lambda: {"jobCurrentCommittedBytes": 6466048000, "jobPeakCommittedBytes": 6466048000,
                                       "processPeakRssBytes": 3209150464}
            def unhealthy():
                raise RuntimeError("technical CUDA observation failure")
            torch_control = SimpleNamespace(cuda=SimpleNamespace(is_initialized=lambda: True, mem_get_info=unhealthy))
            row = recorder.sample("failure", torch_control, failure=True, primaryException="OriginalBackwardError")
            self.assertEqual(row["primaryException"], "OriginalBackwardError")
            self.assertEqual(row["native"]["jobPeakCommittedBytes"], 6466048000)
            self.assertIn("technical CUDA", row["gpuObservationError"])
            self.assertEqual(json.loads(recorder.path.read_text()), row)


if __name__ == "__main__":
    unittest.main()
