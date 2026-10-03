"""CPU-only admission controls. No stager, worker, guard or native phase runs.

Positive fixtures exist only in memory and use an impossible all-zero Git head.
Only named target-free source files and retained donor profile metadata are read.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "services/geo"), str(Path(__file__).resolve().parent)]
import association_student as cli
import stage_selector_baseline as staging
from geo.usp_learning.association import fragment_baseline as admission, selectors, selector_baseline
from geo.usp_learning.association.validation import InvalidEvidence

COORD = Path("C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin")
ASSIGNMENT = COORD / "docs/evidence/usp/ml-distillation/student-16.fragment-runtime-preparation.assignment.json"
SOURCE = Path("E:/BhuAayam-data/task-data/ml-distillation/coordinator/requested-fragment-development-v1-91836b2691344e2e8f0f28535ed6c4cb")


def encoded(value):
    return admission.codec.canonical(value).encode()


class FragmentRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw = ASSIGNMENT.read_bytes()
        assert admission.sha(raw) == "3d21c2a30801c1600b906540867fd4e0bf08ffba3702da48f98b5db8382c96f4"
        cls.prep = json.loads(raw)
        cls.inputs = {key: (SOURCE / name).read_bytes() for key, name in admission.INPUT_NAMES.items()}
        cls.artifacts = {name: (SOURCE / name).read_bytes() for name in admission.ARTIFACT_PINS}
        cls.sources = {name: (REPO / name).read_bytes() for name in admission.SOURCE_PATHS}
        cls.canonical = {name: admission.sha(raw.replace(b"\r\n", b"\n")) for name, raw in cls.sources.items()}
        cls.physical = {name: admission.sha(raw) for name, raw in cls.sources.items()}
        profile_raw = (staging.BASELINE / "profile.json").read_bytes()
        assert admission.sha(profile_raw) == admission.PARENT_PROFILE_SHA
        cls.donor = json.loads(profile_raw)
        cls.assignment = {"version": admission.ASSIGNMENT_VERSION, "task": admission.TASK,
            "executionAllowance": admission.ALLOWANCE, "studentCodeCommit": "0" * 40,
            "model": admission.MODEL, "revision": admission.REVISION, "adapter": None, "settings": admission.SETTINGS,
            "baselineProfileSha256": admission.PARENT_PROFILE_SHA, "inputSha256": admission.INPUT_PINS,
            "acceptedArtifactSha256": admission.ARTIFACT_PINS, "representation": admission.codec.metadata(),
            "cases": admission.CASES, "runtimeCodeCanonicalLfSha256": cls.canonical, "artifactRoot": str(SOURCE)}

    def tearDown(self):
        self.assertFalse({"torch", "transformers", "tokenizers", "ifcopenshell", "safetensors", "peft", "numpy"}
                         & {n.split(".")[0] for n in sys.modules})

    def fixture(self):
        assignment_raw = encoded(self.assignment)
        freeze = admission.make_freeze(self.assignment, assignment_raw, self.physical)
        virtual_inputs = REPO / "__fragment_cpu_inputs_never_created__"
        values = {**self.artifacts, **{admission.INPUT_NAMES[k]: v for k, v in self.inputs.items()},
                  "fragment-assignment.json": assignment_raw}
        original = Path.read_bytes

        def read(path):
            return values[path.name] if path.parent == virtual_inputs else original(path)
        return freeze, virtual_inputs, values, read

    def test_exact_payload_source_set_and_cli_options(self):
        schema, route = admission.checked_payload(self.assignment, self.inputs, self.artifacts)
        self.assertEqual([len(c["context"]["candidates"]) for c in route["contexts"]], [4, 3])
        self.assertEqual([c["context"]["request"] for c in route["contexts"]], [c["request"] for c in admission.CASES])
        self.assertEqual(staging.checked_stage_assignment(self.assignment), (self.assignment, "fragment"))
        pins = staging.checked_source_pins(self.sources, self.donor["files"], self.canonical, fragment_mode=True)
        self.assertEqual(pins, self.physical)
        freeze, path, _, read = self.fixture()
        with patch.object(Path, "read_bytes", read), patch.object(Path, "mkdir") as mkdir:
            runner, options, prompt = cli.admitted_runtime(freeze, path, lambda value: None)
            mkdir.assert_not_called()
        self.assertIs(runner, cli.run_local)
        self.assertEqual(options["fragment_route"], route)
        self.assertEqual(options["fragment_contract"], schema)
        self.assertEqual(prompt, admission.codec.SYSTEM_PROMPT)
        self.assertNotIn("model_loader", options)

    def test_changed_missing_or_extra_source_artifacts_refused(self):
        variants = []
        changed = dict(self.artifacts)
        changed["fragment-route.json"] += b" "
        variants.append(changed)
        missing = dict(self.artifacts)
        del missing["context-1.json"]
        variants.append(missing)
        extra = {**self.artifacts, "forbidden-extra.json": b"{}"}
        variants.append(extra)
        for artifacts in variants:
            with self.subTest(names=list(artifacts)), patch.object(Path, "mkdir") as mkdir:
                with self.assertRaises(InvalidEvidence):
                    admission.checked_payload(self.assignment, self.inputs, artifacts)
                mkdir.assert_not_called()
        stale = copy.deepcopy(self.assignment)
        stale["cases"][0]["request"] = "Changed request"
        with self.assertRaisesRegex(InvalidEvidence, "accepted_authority"):
            admission.checked_assignment(stale)

    def test_prep_mixed_and_wrong_source_pins_refused_by_pure_stage_admission(self):
        variants = [self.prep]
        for field in ("version", "missing_source", "old_student"):
            changed = copy.deepcopy(self.assignment)
            if field == "version":
                changed["version"] = selector_baseline.ASSIGNMENT_VERSION
            elif field == "missing_source":
                del changed["runtimeCodeCanonicalLfSha256"]["scripts/usp/learning/association/stage_baseline.py"]
            else:
                changed["runtimeCodeCanonicalLfSha256"]["services/geo/geo/usp_learning/association/student.py"] = staging.ACCEPTED_LATER_SOURCE_SHA256["services/geo/geo/usp_learning/association/student.py"]
            variants.append(changed)
        with patch.object(Path, "mkdir") as mkdir, patch.object(staging.isolation, "sha") as donor_read:
            for assignment in variants:
                with self.assertRaises(InvalidEvidence):
                    staging.checked_stage_assignment(assignment)
            mkdir.assert_not_called()
            donor_read.assert_not_called()

    def test_stale_freeze_and_changed_context_stop_before_runtime_dispatch(self):
        freeze, path, values, read = self.fixture()
        for changed in ("context", "self_pin", "unknown_version"):
            with self.subTest(changed=changed):
                bad = copy.deepcopy(freeze)
                content = dict(values)
                if changed == "context":
                    content["context-0.json"] += b" "
                elif changed == "self_pin":
                    bad["auxiliaryInputSha256"]["fragment-route.json"] = "0" * 64
                else:
                    bad["version"] = "association-fragment-baseline-freeze/999"
                def changed_read(p):
                    return content[p.name] if p.parent == path else read(p)
                with patch.object(Path, "read_bytes", changed_read):
                    with self.assertRaises((InvalidEvidence, RuntimeError)):
                        cli.admitted_runtime(bad, path, lambda value: None)

    def test_historical_dispatch_and_source_authority_remain_separate(self):
        runner, options, prompt = cli.admitted_runtime({"version": "association-baseline-freeze/1"}, Path("unused"), None)
        self.assertIs(runner, cli.run_local)
        self.assertEqual(options, {})
        self.assertEqual(prompt, cli.SYSTEM_PROMPT)
        selector_assignment = {"version": selector_baseline.ASSIGNMENT_VERSION, "task": "STUDENT-09-BASELINE",
            "executionAllowance": admission.ALLOWANCE, "settings": admission.SETTINGS, "model": admission.MODEL,
            "revision": admission.REVISION, "promptVersion": selectors.PROMPT_VERSION, "systemPromptSha256": selectors.PROMPT_SHA,
            "selectorSchemaCanonicalLfSha256": selectors.SCHEMA_SHA, "lexicalPolicy": selectors.POLICY,
            "studentCodeCommit": "0" * 40, "inputBatchSha256": admission.INPUT_PINS["input_batch"], "cases": admission.base.CASES}
        self.assertEqual(staging.checked_stage_assignment(selector_assignment)[1], "selector")
        for candidate_mode in (False, True):
            paths = admission.base.SOURCE_PATHS if candidate_mode else staging.SOURCE_PATHS
            with self.assertRaisesRegex(InvalidEvidence, "protected_source_drift:.*student.py"):
                staging.checked_source_pins({p: self.sources[p] for p in paths}, self.donor["files"],
                    {p: self.canonical[p] for p in paths}, candidate_mode=candidate_mode)
        with self.assertRaisesRegex(RuntimeError, "explicit fragment"):
            cli.admitted_runtime({"version": "association-baseline-freeze/1", "fragmentRoute": {}}, Path("unused"), None)


if __name__ == "__main__":
    unittest.main(verbosity=2)
