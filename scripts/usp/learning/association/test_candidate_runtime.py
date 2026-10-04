"""CPU admission/dispatch controls; retained candidates, no native/model phase.

Positive fixtures use the impossible all-zero Git head and are never staged.
These tests protect accepted-source authority and pre-model refusal, not model
quality, grammar behavior or the already accepted source reconstruction.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "services/geo"), str(Path(__file__).resolve().parent)]
import association_student as cli
import stage_selector_baseline as staging
from geo.usp_learning.association import candidate_baseline as admission, selector_baseline as selector
from geo.usp_learning.association import selectors
from geo.usp_learning.association.validation import InvalidEvidence

COORDINATOR = Path("C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin")
PREPARATION = Path("E:/BhuAayam-data/task-data/ml-distillation/student/native-candidates-preparation-9e147bf705c5413388f86ab0f785eadc")
PREP_ASSIGNMENT = COORDINATOR / "docs/evidence/usp/ml-distillation/student-13.candidate-runtime-preparation.assignment.json"
NATIVE = {"torch", "transformers", "tokenizers", "ifcopenshell", "safetensors", "peft", "numpy"}


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


class CandidateRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sources = {name: (REPO / name).read_bytes() for name in admission.SOURCE_PATHS}
        cls.canonical_pins = {name: admission.sha(raw.replace(b"\r\n", b"\n")) for name, raw in cls.sources.items()}
        cls.physical_pins = {name: admission.sha(raw) for name, raw in cls.sources.items()}
        cls.inputs = {key: (staging.BASELINE / "inputs" / name).read_bytes() for key, name in admission.INPUT_NAMES.items()}
        cls.artifacts = {name: (PREPARATION / name).read_bytes() for name in admission.ARTIFACT_PINS}
        cls.profile = json.loads((staging.BASELINE / "profile.json").read_bytes())
        cls.assignment = {"version": admission.ASSIGNMENT_VERSION, "task": admission.TASK,
            "executionAllowance": admission.ALLOWANCE, "studentCodeCommit": "0" * 40,
            "model": admission.MODEL, "revision": admission.REVISION, "adapter": None,
            "settings": admission.SETTINGS, "baselineProfileSha256": admission.PARENT_PROFILE_SHA,
            "inputSha256": admission.INPUT_PINS, "acceptedArtifactSha256": admission.ARTIFACT_PINS,
            "representation": admission.candidate.metadata(), "cases": admission.CASES,
            "runtimeCodeCanonicalLfSha256": cls.canonical_pins, "artifactRoot": str(PREPARATION)}

    def tearDown(self):
        self.assertFalse(NATIVE & {name.split(".")[0] for name in sys.modules})

    def fixture(self, root):
        inputs = root / "inputs"
        inputs.mkdir()
        for key, name in admission.INPUT_NAMES.items():
            (inputs / name).write_bytes(self.inputs[key])
        for name, raw in self.artifacts.items():
            (inputs / name).write_bytes(raw)
        raw_assignment = encoded(self.assignment)
        (inputs / "candidate-assignment.json").write_bytes(raw_assignment)
        freeze = admission.make_freeze(self.assignment, raw_assignment, self.physical_pins)
        (inputs / "run-freeze.json").write_bytes(encoded(freeze))
        return inputs, freeze

    def test_accepted_two_contexts_and_existing_cli_dispatch(self):
        with tempfile.TemporaryDirectory(prefix="candidate-cpu-control-") as temporary:
            inputs, freeze = self.fixture(Path(temporary))
            runner, options, prompt = cli.admitted_runtime(freeze, inputs, lambda value: None)
            self.assertIs(runner, selector.run_selectors)
            self.assertEqual(prompt, admission.candidate.SYSTEM_PROMPT)
            self.assertEqual(options["cases"], admission.CASES)
            snapshots = options["candidate_route"]["contexts"]
            self.assertEqual([s["snapshot"]["candidateSetSha256"] for s in snapshots], admission.SET_PINS)
            self.assertEqual([len(s["snapshot"]["candidateSet"]["candidates"]) for s in snapshots], [4, 2])
            incomplete = snapshots[1]["snapshot"]["candidateSet"]
            self.assertEqual({c["claim"]["state"] for c in incomplete["candidates"]}, {"absent", "null"})
            self.assertNotIn("model_loader", options)
            self.assertNotIn("generation_constraints", options)
            self.assertEqual(staging.checked_source_pins(self.sources, self.profile["files"], self.canonical_pins,
                candidate_mode=True), self.physical_pins)

    def test_tampered_context_and_self_issued_route_pin_stop_before_model(self):
        for changed in ("context-1.json", "candidate-route.json"):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory(prefix="candidate-cpu-control-") as temporary:
                root = Path(temporary)
                inputs, freeze = self.fixture(root)
                (inputs / changed).write_bytes(self.artifacts[changed] + b" ")
                if changed == "candidate-route.json":
                    freeze["auxiliaryInputSha256"][changed] = admission.sha((inputs / changed).read_bytes())
                    (inputs / "run-freeze.json").write_bytes(encoded(freeze))
                args = SimpleNamespace(run_freeze=inputs / "run-freeze.json", output_dir=root / "outputs")
                with patch.object(cli, "require_model_boundary"), patch.object(cli, "local_model_path") as model:
                    with self.assertRaises(InvalidEvidence):
                        cli.worker(args)
                    model.assert_not_called()

    def test_prep_mixed_and_unapproved_sources_cannot_reach_staging(self):
        bad_source = copy.deepcopy(self.assignment)
        bad_source["runtimeCodeCanonicalLfSha256"]["unapproved.py"] = "0" * 64
        mixed = copy.deepcopy(self.assignment)
        mixed["version"] = selector.ASSIGNMENT_VERSION
        prep = json.loads(PREP_ASSIGNMENT.read_bytes())
        self.assertEqual(admission.sha(PREP_ASSIGNMENT.read_bytes()), "1e4b637e0278b697eab27f6d5d17a24e39165a124052ce3224e454f2e479cdd6")
        for assignment in (prep, mixed, bad_source):
            with self.subTest(version=assignment["version"]), patch.object(Path, "read_bytes", return_value=encoded(assignment)), \
                    patch.object(staging.isolation, "sha") as runtime_read, patch.object(Path, "mkdir") as mkdir, \
                    patch.object(staging.shutil, "disk_usage") as disk:
                with self.assertRaises(InvalidEvidence):
                    staging.stage(Path("technical-fixture-only.json"))
                runtime_read.assert_not_called()
                mkdir.assert_not_called()
                disk.assert_not_called()

    def test_historical_baseline_selector_dispatch_and_mixed_freeze_refusal(self):
        runner, options, prompt = cli.admitted_runtime({"version": "association-baseline-freeze/1"}, Path("unused"), None)
        self.assertIs(runner, cli.run_local)
        self.assertEqual(options, {})
        self.assertEqual(prompt, cli.SYSTEM_PROMPT)
        assignment = json.loads((COORDINATOR / "docs/evidence/usp/ml-distillation/student-09.selector-baseline.assignment.json").read_bytes())
        selector.checked_assignment(assignment)
        raw = {"selector-assignment.json": encoded(assignment),
            "selector-schema-v1.json": (COORDINATOR / "scripts/usp/learning/association/selector-schema-v1.json").read_bytes(),
            "selector-prompt.txt": selectors.SYSTEM_PROMPT.encode()}
        freeze = {"version": selector.FREEZE_VERSION, "sourceCommit": assignment["studentCodeCommit"],
            "promptVersion": selectors.PROMPT_VERSION, "systemPromptSha256": selectors.PROMPT_SHA,
            "lexicalPolicy": selectors.POLICY, "selectorSchemaCanonicalLfSha256": selectors.SCHEMA_SHA,
            "model": selector.MODEL, "modelRevision": selector.REVISION, "settings": cli.SETTINGS,
            "cases": assignment["cases"], "inputSha256": dict(admission.INPUT_PINS),
            "auxiliaryInputSha256": {name: admission.sha(value) for name, value in raw.items()},
            "fitPerformed": False, "evaluationAllowed": False}
        with patch.object(Path, "read_bytes", lambda path: raw[path.name]):
            runner, options, prompt = cli.admitted_runtime(freeze, Path("unused"), None)
        self.assertIs(runner, selector.run_selectors)
        self.assertEqual(prompt, selectors.SYSTEM_PROMPT)
        self.assertNotIn("candidate_route", options)
        self.assertNotIn("model_loader", options)
        self.assertEqual(staging.checked_source_pins({p: self.sources[p] for p in staging.SOURCE_PATHS}, self.profile["files"],
            {p: self.canonical_pins[p] for p in staging.SOURCE_PATHS}), {p: self.physical_pins[p] for p in staging.SOURCE_PATHS})
        for bad in ({**freeze, "candidateRoute": {}}, {"version": "association-candidate-baseline-freeze/999"}):
            with self.assertRaisesRegex(RuntimeError, "explicit candidate"):
                cli.admitted_runtime(bad, Path("unused"), None)


if __name__ == "__main__":
    unittest.main(verbosity=2)
