"""CPU controls for selector admission/encoding and the explicit future route."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "services/geo"), str(REPO / "scripts/usp/learning"), str(Path(__file__).resolve().parent)]
import association_adapter as cli
import stage_selector_adapter as staging
from geo.usp_learning.association import adapter, selector_adapter as selector, student
from geo.usp_learning.association.selectors import canonical, context
from geo.usp_learning.association.validation import InvalidEvidence

COORDINATOR = Path("C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin")
PREP = COORDINATOR / "docs/evidence/usp/ml-distillation/student-10.selector-adapter-preparation.assignment.json"


class TokenizerControl:
    """Character IDs verify interfaces/masks only, never actual model lengths."""
    eos_token, eos_token_id = "\u0003", 3

    def apply_chat_template(self, messages, tokenize, add_generation_prompt):
        return "".join(m["role"] + ":" + m["content"] + self.eos_token + "\n" for m in messages) + ("assistant:" if add_generation_prompt else "")

    def encode(self, text, add_special_tokens):
        return [ord(c) for c in text]


class SelectorAdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parent = (staging.TEACHER / "train-teacher-v2.jsonl").read_bytes()
        cls.targets = (staging.TEACHER / "train-teacher-selectors-v1.jsonl").read_bytes()
        cls.contract = json.loads((staging.BASELINE / "inputs/schema-v1.json").read_bytes())
        cls.family = json.loads((staging.BASELINE / "inputs/family-freeze.json").read_bytes())
        cls.schema = selector.checked_schema((COORDINATOR / "scripts/usp/learning/association/selector-schema-v1.json").read_bytes())
        cls.rows, cls.delta = selector.checked_teacher(cls.parent, cls.targets, cls.schema, cls.contract, cls.family)
        cls.rep = selector.SelectorRepresentation(cls.schema, cls.contract, cls.family)
        cls.donor_freeze = json.loads((staging.RUNTIME / "inputs/run-freeze.json").read_bytes())

    def execution_fixture(self, action="fit"):
        # In-memory future contract only; never saved or passed to stage().
        a = {"version": selector.EXECUTION_VERSION, "task": "STUDENT-10-SELECTOR-FIT", "action": action,
             "executionAllowance": {"stageModelRun": True, "loadModel": True, "fit": action == "fit",
                "inference": action == "reload", "evaluation": False, "promotion": False, "freshPhases": 1},
             "settings": adapter.FIT, "numerics": adapter.NUMERICS, "inferenceSettings": student.SETTINGS,
             "model": selector.MODEL, "revision": selector.REVISION, "teacherV2Sha256": adapter.V2_SHA,
             "representation": selector.representation_metadata(), "trainingPlan": selector.training_plan(),
             "studentCodeCommit": "c2773a4ca5054a851b611945db7ac6dab3d9f24b",
             "memoryExecutionPolicy": copy.deepcopy(self.donor_freeze["memoryExecutionPolicy"]),
             "attentionControlBeforeFit": selector.ATTENTION_CONTROL,
             **{k: self.donor_freeze[k] for k in ("previousFailedFit", "previousFailureReceiptSha256")}}
        if action == "reload":
            a.update(cases=copy.deepcopy(selector.CASES), inputBatchSha256=selector.BATCH_SHA,
                     acceptedFit={"root": str(staging.RUNTIME), **{k: "1" * 64 for k in (
                         "profileSha256", "guardSha256", "adapterManifestSha256", "fitResultSha256", "adapterWeightsSha256")}})
        return a

    def freeze_fixture(self, action="fit"):
        a = self.execution_fixture(action)
        inputs = {**selector.COMMON_INPUT_PINS, "assignment": "1" * 64}
        inputs.update({"teacher_v1": adapter.V2_SHA, "training_data": selector.DATA_SHA} if action == "fit" else {
            "input_batch": selector.BATCH_SHA, "adapter_manifest": "1" * 64, "fit_proof": "2" * 64})
        f = {"version": selector.FREEZE_VERSION, "action": action, "sourceCommit": a["studentCodeCommit"],
             "representation": a["representation"], "trainingPlan": a["trainingPlan"], "systemPromptSha256": selector.PROMPT_SHA,
             "fitSettings": adapter.FIT, "numerics": adapter.NUMERICS, "inferenceSettings": student.SETTINGS,
             "memoryExecutionPolicy": a["memoryExecutionPolicy"], "lossImplementation": selector.LOSS_POLICY,
             "reclamationImplementation": selector.RECLAMATION_POLICY, "attentionImplementation": selector.ATTENTION_POLICY,
             **{k: a[k] for k in ("previousFailedFit", "previousFailureReceiptSha256")},
             "evaluationAllowed": False, "promotionAuthorized": False, "developmentInputsPresent": action == "reload", "inputSha256": inputs}
        if action == "reload":
            f.update(cases=a["cases"], acceptedFit=a["acceptedFit"])
        return f, a

    def test_real_admission_pins_counts_and_exact_parent_preservation(self):
        self.assertEqual(self.delta["counts"], selector.COUNTS)
        self.assertEqual(self.delta["trainingPlan"], selector.training_plan())
        for admitted, parent, target in zip(self.rows, self.parent.splitlines(), self.targets.splitlines()):
            self.assertEqual(admitted["output"], json.loads(parent)["output"])
            self.assertEqual(admitted["input"], json.loads(parent)["input"])
            self.assertEqual(admitted["selectorTarget"], json.loads(target)["output"])
        for parent, targets, error in ((self.parent + b"\n", self.targets, "parent_pin"),
                                       (self.parent, self.targets + b"\n", "teacher_pin")):
            with self.assertRaisesRegex(InvalidEvidence, error):
                selector.checked_teacher(parent, targets, self.schema, self.contract, self.family)

    def test_source_split_pointer_and_nondeclared_state_rejection(self):
        index = next(i for i, r in enumerate(self.rows) if r["input"]["exampleId"] == "teacher-bihar-unusable-approval-date")
        line = self.parent.splitlines()[index]; parent = json.loads(line); original = json.loads(self.targets.splitlines()[index])
        self.assertIsNone(original["output"]["claims"][0]["literal"])
        mutations = (lambda r: r["input"]["evidence"][0].update(text="changed"),
                     lambda r: r["supervision"].update(split="development"),
                     lambda r: r["output"]["claims"][0].update(literal=[0, 0, 1]),
                     lambda r: r["output"]["claims"][0]["citations"][0].__setitem__(0, False))
        for mutate in mutations:
            row = copy.deepcopy(original); mutate(row)
            with self.assertRaises(InvalidEvidence):
                selector.checked_row(parent, row, line, self.schema, self.contract, self.family)
        family = copy.deepcopy(self.family)
        for f in family["families"]:
            if f["familyId"] == parent["input"]["familyId"]:
                f["split"] = "evaluation"
        with self.assertRaisesRegex(InvalidEvidence, "source_family_split"):
            selector.checked_row(parent, original, line, self.schema, self.contract, family)

    def test_source_only_messages_raw_selector_target_mask_and_eos(self):
        rows = [r for r in self.rows if r["input"]["exampleId"] in ("teacher-haryana-floor02", "teacher-bihar-unusable-approval-date")]
        tokenizer = TokenizerControl()
        encoded, lengths = adapter.encode_training(tokenizer, rows, representation=self.rep)
        for row, enc, length in zip(rows, encoded, lengths):
            messages = self.rep.messages(row)
            self.assertEqual(messages, context(row["input"], self.contract, self.family).messages())
            self.assertEqual(set(json.loads(messages[1]["content"])), {"evidence"})
            boundary = enc["promptTokens"]
            self.assertEqual(enc["labels"][:boundary], [-100] * boundary)
            self.assertEqual(enc["labels"][boundary:], enc["inputIds"][boundary:])
            target = "".join(chr(i) for i in enc["inputIds"][boundary:-1])
            self.assertEqual(target, canonical(row["selectorTarget"]))
            self.assertNotEqual(target, canonical(row["output"]))
            self.assertEqual(enc["labels"][-1], tokenizer.eos_token_id)
            self.assertEqual(length["targetSha256"], selector.sha(target.encode()))
        tokenizer.eos_token_id = -1
        with self.assertRaisesRegex(InvalidEvidence, "mask_alignment"):
            adapter.encode_training(tokenizer, rows[:1], representation=self.rep)

    def test_legacy_encoder_and_cli_defaults_preserved(self):
        parent = json.loads(self.parent.splitlines()[0]); tokenizer = TokenizerControl()
        encoded, lengths = adapter.encode_training(tokenizer, [parent])
        prompt = tokenizer.apply_chat_template(student.prompt_messages(parent["input"]), tokenize=False, add_generation_prompt=True)
        target = canonical(parent["output"])
        self.assertEqual(encoded[0]["inputIds"], tokenizer.encode(prompt + target + tokenizer.eos_token, add_special_tokens=False))
        self.assertEqual(lengths[0]["targetSha256"], selector.sha(target.encode()))
        self.assertIsNone(cli.representation_module({"version": "association-adapter-freeze/5"}, {}))
        self.assertIs(cli.representation_module({"version": selector.FREEZE_VERSION}, {}), selector)
        for freeze, assignment in (({"version": "association-selector-adapter-freeze/2"}, {}),
                                    ({"version": "association-adapter-freeze/5"}, {"version": selector.EXECUTION_VERSION})):
            with self.assertRaisesRegex(RuntimeError, "explicit selector"):
                cli.representation_module(freeze, assignment)
        path = "scripts/usp/learning/association/association_adapter.py"
        old = ast.parse(subprocess.check_output(["git", "show", "c2773a4ca5054a851b611945db7ac6dab3d9f24b:" + path], cwd=REPO))
        new = ast.parse((REPO / path).read_bytes())
        main = lambda tree: ast.dump(next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main"))
        self.assertEqual(main(old), main(new))

    def test_future_action_input_and_proof_contracts_and_prep_refusal(self):
        self.assertEqual(selector.sha(PREP.read_bytes()), "98e20dc1fb718cdb75edbdc58366d2d9758c1ee8533a5e3cc6573a020ab112a3")
        with patch.object(Path, "mkdir") as mkdir, patch.object(staging.isolation, "sha", side_effect=AssertionError("runtime inspected")):
            with self.assertRaisesRegex(InvalidEvidence, "separate_selector_adapter_execution_required"):
                staging.stage("fit", PREP)
            mkdir.assert_not_called()
        for action in ("fit", "reload"):
            freeze, assignment = self.freeze_fixture(action)
            self.assertEqual(selector.checked_freeze(freeze, assignment), selector.training_plan())
            freeze["inputSha256"]["input_batch" if action == "fit" else "training_data"] = "0" * 64
            with self.assertRaisesRegex(InvalidEvidence, "input_set_drift"):
                selector.checked_freeze(freeze, assignment)
        assignment = self.execution_fixture()
        assignment["cases"] = selector.CASES
        with self.assertRaisesRegex(InvalidEvidence, "development_fields_refused"):
            selector.checked_execution(assignment, "fit")
        freeze, assignment = self.freeze_fixture("reload")
        proof = {"fitRoot": assignment["acceptedFit"]["root"], **{k: v for k, v in assignment["acceptedFit"].items() if k not in ("root", "adapterWeightsSha256")}, "representation": selector.representation_metadata()}
        manifest = {"representation": selector.representation_metadata(), "files": {"adapter_model.safetensors": "1" * 64}}
        selector.checked_reload_binding(freeze, proof, manifest)
        manifest["representation"] = {"version": "legacy"}
        with self.assertRaisesRegex(InvalidEvidence, "representation_drift"):
            selector.checked_reload_binding(freeze, proof, manifest)

    def test_fit_metadata_binds_actual_target_and_no_model_imports(self):
        row = self.rows[0]
        _, lengths = adapter.encode_training(TokenizerControl(), [row], representation=self.rep)
        preflight = {"representation": self.rep.metadata, "systemPromptSha256": selector.PROMPT_SHA, "lengths": lengths}
        receipt = {"representation": self.rep.metadata}
        selector.checked_fit_metadata(preflight, receipt, receipt, [row], self.rep)
        preflight["lengths"][0]["targetSha256"] = selector.sha(canonical(row["output"]).encode())
        with self.assertRaisesRegex(InvalidEvidence, "raw_target_digest_drift"):
            selector.checked_fit_metadata(preflight, receipt, receipt, [row], self.rep)
        self.assertFalse({"torch", "transformers", "peft", "accelerate", "safetensors"} & set(sys.modules))


if __name__ == "__main__":
    unittest.main(verbosity=2)
