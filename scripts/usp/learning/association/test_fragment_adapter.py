"""Focused CPU admission/dispatch controls; no native import or model phase."""
from __future__ import annotations

import builtins
import copy
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "services/geo"), str(Path(__file__).resolve().parent)]
import association_adapter as cli
import stage_adapter as proof_stage
import stage_fragment_adapter as staging
from geo.usp_learning.association import adapter, fragment_adapter as f, selector_adapter, student
from geo.usp_learning.association.validation import InvalidEvidence

SOURCE = staging.BASELINE / "inputs"
PREP = Path("C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin/docs/evidence/usp/ml-distillation/student-18.fragment-adapter-preparation.assignment-v2.json")


class BoundaryReached(Exception):
    pass


class TemplateTokenizer:
    """Technical masking fixture, never a native token-length qualification."""
    eos_token, eos_token_id = "\x03", 3

    def apply_chat_template(self, messages, *, tokenize, add_generation_prompt):
        prompt = "\n".join(m["role"] + ":" + m["content"] for m in messages[:2]) + "\nassistant:"
        return prompt if add_generation_prompt else prompt + messages[-1]["content"] + self.eos_token + "\n"

    def encode(self, value, *, add_special_tokens):
        return [ord(c) for c in value]


class FragmentAdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        prep = PREP.read_bytes()
        assert f.sha(prep) == "d0444d2d273486dc76ceb5b1214bec0f4a00577eb53cd8df7cf714c65886f5f6"
        cls.prep = json.loads(prep)
        cls.data = staging.TRAINING.read_bytes()
        cls.schema = f.codec.checked_schema((SOURCE / "fragment-schema-v1.json").read_bytes())
        cls.contract = json.loads((SOURCE / "legacy-schema-v1.json").read_bytes())
        cls.family = json.loads((SOURCE / "family-freeze.json").read_bytes())
        cls.sources = {p: (REPO / p).read_bytes() for p in f.SOURCE_PATHS}
        cls.physical = {p: f.sha(raw) for p, raw in cls.sources.items()}
        cls.canonical = {p: f.sha(raw.replace(b"\r\n", b"\n")) for p, raw in cls.sources.items()}
        cls.rows, cls.delta = f.checked_teacher(cls.data, cls.schema, cls.contract, cls.family)
        cls.rep = f.FragmentRepresentation(cls.schema, cls.contract, cls.family)

    def tearDown(self):
        self.assertFalse({"torch", "transformers", "tokenizers", "peft", "accelerate", "safetensors", "numpy", "ifcopenshell"}
                         & {n.split(".")[0] for n in sys.modules})

    def assignment(self, action="fit"):
        value = copy.deepcopy(staging.phase_template(action)["assignment"])
        value.update(executable=True, executionAllowance=f.allowance(action), studentCodeCommit="1" * 40,
                     runtimeCodeCanonicalLfSha256=self.canonical)
        if action == "reload":
            value["acceptedFit"] = {k: "2" * 64 for k in f.ACCEPTED_FIT_KEYS}
            value["acceptedFit"].update(root=str(staging.BASELINE.parent / "__cpu_fake_fit_never_created__"), sourceCommit="3" * 40)
        return value

    def freeze(self, assignment):
        return f.make_freeze(assignment, f.serialized(assignment), self.physical)

    def test_six_unchanged_rows_prompt_targets_and_assistant_mask(self):
        self.assertEqual(self.delta["counts"], {"rows": 6, "candidateAppearances": 35, "selectedAppearances": 10})
        self.assertEqual(self.rep.training_plan["plannedUpdates"], 36)
        originals = [json.loads(line) for line in self.data.splitlines()]
        encoded, lengths = adapter.encode_training(TemplateTokenizer(), self.rows, representation=self.rep)
        for original, row, tokens, length in zip(originals, self.rows, encoded, lengths):
            self.assertEqual(row["fragmentTrainingRow"], original)
            self.assertNotIn("output", row)
            self.assertEqual(self.rep.messages(row)[0]["content"], f.codec.SYSTEM_PROMPT)
            self.assertEqual(json.loads(self.rep.messages(row)[1]["content"]), original["input"])
            self.assertEqual(self.rep.target(row), f.codec.canonical(original["output"]))
            prompt_count = tokens["promptTokens"]
            self.assertEqual(tokens["labels"][:prompt_count], [-100] * prompt_count)
            self.assertEqual(tokens["labels"][prompt_count:], tokens["inputIds"][prompt_count:])
            self.assertEqual(tokens["labels"][-1], TemplateTokenizer.eos_token_id)
            self.assertEqual(length["targetSha256"], f.sha(self.rep.target(row).encode()))
        for field in ("output", "input", "supervision"):
            changed = copy.deepcopy(originals[0])
            changed[field] = {}
            with self.assertRaises(InvalidEvidence):
                f.checked_row(changed, self.schema, self.contract, self.family)
        with self.assertRaises(InvalidEvidence):
            f.checked_teacher(self.data + b" ", self.schema, self.contract, self.family)

    def test_prep_templates_mixed_and_source_drift_refused_before_stage_effects(self):
        for value in [self.prep, *(staging.phase_template(a)["assignment"] for a in f.VERSIONS)]:
            with patch.object(Path, "read_bytes", return_value=f.serialized(value)), patch.object(Path, "mkdir") as mkdir, \
                    patch.object(staging, "donor_metadata") as donor, patch.object(staging, "checked_sources") as sources:
                with self.assertRaises(InvalidEvidence):
                    staging.stage("fit", Path("__not_read__"))
                mkdir.assert_not_called(); donor.assert_not_called(); sources.assert_not_called()
        assignment = self.assignment()
        for mutate in (lambda a: a.update(previousFailedFit="historical"),
                       lambda a: a["runtimeCodeCanonicalLfSha256"].update({next(iter(f.PROTECTED_PINS)): "0" * 64}),
                       lambda a: a.update(version=f.VERSIONS["reload"][0])):
            bad = copy.deepcopy(assignment); mutate(bad)
            with self.assertRaises(InvalidEvidence):
                f.checked_execution(bad, "fit")
        self.assertEqual(f.checked_execution(assignment, "fit")["teacherExamples"], 6)

    def test_exact_fit_inputs_aliases_and_no_development_inputs(self):
        assignment = self.assignment(); freeze = self.freeze(assignment)
        virtual = REPO / "__fragment_inputs_never_created__"
        values = {"assignment.json": f.serialized(assignment), "run-freeze.json": f.serialized(freeze),
            "schema-v1.json": (SOURCE / "legacy-schema-v1.json").read_bytes(),
            "family-freeze.json": (SOURCE / "family-freeze.json").read_bytes(),
            "model-acquisition.json": (SOURCE / "model-acquisition.json").read_bytes(),
            "train-teacher-fragments-v1.jsonl": self.data,
            "runtime-requirements-resolved.txt": (staging.RUNTIME / "inputs/runtime-requirements-resolved.txt").read_bytes(),
            **{name: (SOURCE / name).read_bytes() for name in f.auxiliary_pins("fit")}}
        original_read = Path.read_bytes
        def read(path):
            return values[path.name] if path.parent == virtual else original_read(path)
        def digest(path):
            return f.sha(read(Path(path)))
        with patch.object(Path, "read_bytes", read), patch.object(Path, "iterdir", lambda p: iter(virtual / n for n in values)), \
                patch.object(f, "digest_file", digest):
            self.assertEqual(f.checked_inputs(freeze, assignment, virtual), self.schema)
            values["development.json"] = b"{}"
            with self.assertRaisesRegex(InvalidEvidence, "unexpected_input"):
                f.checked_inputs(freeze, assignment, virtual)
            del values["development.json"]
        args = SimpleNamespace(action="fit", run_freeze=virtual / "run-freeze.json", adapter_dir=None,
            input_batch=None, adapter_manifest=None, fit_proof=None,
            **{key: virtual / name for key, name in f.input_names("fit").items()})
        f.checked_cli(args, freeze)
        self.assertEqual(args.teacher_v1, args.training_data)
        args.teacher_v1 = virtual / "legacy-data.jsonl"
        with self.assertRaisesRegex(InvalidEvidence, "alias"):
            f.checked_cli(args, freeze)
        self.assertIs(cli.representation_module(freeze, assignment), f)
        self.assertIsNone(cli.representation_module({"version": "association-adapter-freeze/5"}, {}))
        self.assertIs(cli.representation_module({"version": selector_adapter.FREEZE_VERSION}, {}), selector_adapter)
        bad = copy.deepcopy(freeze); bad["sourceCommit"] = "0" * 40
        with self.assertRaises(InvalidEvidence):
            cli.representation_module(bad, assignment)

    def test_fragment_loader_is_explicit_default_off_and_uses_existing_runner(self):
        examples = json.loads((SOURCE / "development.json").read_bytes())["examples"]
        route = json.loads((SOURCE / "fragment-route.json").read_bytes())
        options = dict(fragment_route=route, fragment_contract=self.schema, preserve_preflight=lambda value: None)
        call = lambda **kwargs: student.run_local(examples, self.contract, self.family, Path("__no_model__"), lambda: None, lambda *a: None, **options, **kwargs)
        with self.assertRaises(InvalidEvidence):
            call(model_loader=lambda path: None)
        assignment = self.assignment("reload"); freeze = self.freeze(assignment)
        authority = {"freeze": freeze, "assignment": assignment}
        original_import = builtins.__import__
        def stop_native(name, *args, **kwargs):
            if name == "torch":
                raise BoundaryReached("native import not executed")
            return original_import(name, *args, **kwargs)
        with patch.object(builtins, "__import__", stop_native):
            with self.assertRaises(BoundaryReached):
                call(model_loader=lambda path: None, fragment_adapter_reload=authority)
            with self.assertRaises(BoundaryReached):
                call()  # Original fragment baseline still reaches the same loader boundary.
        runner = f.reload_runner(freeze, assignment, SOURCE, self.schema, lambda value: None)
        self.assertIs(runner.func, student.run_local)
        self.assertNotIn("model_loader", runner.keywords)
        observed = {}
        def fake_runner(*args, **kwargs):
            observed.update(kwargs)
            return [], {}
        with patch.object(adapter, "verify_adapter_files") as verify:
            _, result = adapter.reload_and_compare([], self.contract, self.family, Path("__no_model__"), Path("__no_adapter__"),
                {"updates":36,"trainingPlan":f.training_plan()}, lambda: None, lambda *a: None, inference_runner=fake_runner)
            verify.assert_called_once()
        self.assertTrue(callable(observed["model_loader"]))
        self.assertFalse(result["fitPerformedInThisProcess"])

    def test_saved_fit_binding_and_raw_target_proof(self):
        assignment = self.assignment("reload")
        expected = assignment["acceptedFit"]
        proof = {k:v for k,v in expected.items() if k not in ("root", "adapterWeightsSha256", "fitProofSha256")}
        proof.update(fitRoot=expected["root"], representation=f.representation_metadata(), updates=36,
                     trainingPlan=f.training_plan(), fitResourceAccepted=True)
        expected["fitProofSha256"] = f.sha(f.serialized(proof))
        manifest = {"representation":f.representation_metadata(),"files":{"adapter_model.safetensors":expected["adapterWeightsSha256"]},
            "updates":36,"trainingPlan":f.training_plan(),"tensorCount":96,"savedStateMatchesTrainableAdapter":True,
            "baseParametersBefore":{"sha256":"4"*64},"baseParametersAfter":{"sha256":"4"*64}}
        freeze = self.freeze(assignment)
        f.checked_reload_binding(freeze, proof, manifest)
        for changed in ("weights", "updates"):
            bad = copy.deepcopy(manifest)
            if changed == "weights": bad["files"]["adapter_model.safetensors"] = "0" * 64
            else: bad["updates"] = 35
            with self.assertRaises(InvalidEvidence):
                f.checked_reload_binding(freeze, proof, bad)
        preflight = {"representation":f.representation_metadata(),"systemPromptSha256":f.codec.PROMPT_SHA,
            "lengths":[{"exampleId":r["input"]["exampleId"],"targetSha256":f.sha(self.rep.target(r).encode())} for r in self.rows]}
        f.checked_fit_metadata(preflight, {"representation":f.representation_metadata()}, manifest, self.rows, self.rep)
        preflight["lengths"][0]["targetSha256"] = "0" * 64
        with self.assertRaises(InvalidEvidence):
            f.checked_fit_metadata(preflight, {"representation":f.representation_metadata()}, manifest, self.rows, self.rep)

    def test_new_proof_admission_reaches_same_common_checks_and_keeps_old_dispatch(self):
        assignment = self.assignment(); freeze = self.freeze(assignment)
        root = staging.BASELINE.parent / "__proof_cpu_fixture_never_created__"
        guard = {"fixture":True}
        completion = {"supervisor":guard,"fitResultSha256":"5"*64,"tokenPreflightSha256":"5"*64,
                      "adapterManifestSha256":"5"*64,"runFreezeSha256":"5"*64}
        values = {"fit-result.json":{},"adapter-manifest.json":{},"completion.json":completion,
                  "run-freeze.json":freeze,"assignment.json":assignment,"token-preflight.json":{}}
        def pin(path):
            return freeze["inputSha256"]["assignment"] if Path(path).name == "assignment.json" else "5"*64
        with patch.object(proof_stage, "accepted_outputs", return_value=(guard, {})), \
                patch.object(proof_stage.isolation, "read", lambda p: values[Path(p).name]), \
                patch.object(proof_stage.isolation, "sha", pin), patch.object(Path, "read_text", return_value=""), \
                patch.object(proof_stage, "checked_count_receipts", side_effect=BoundaryReached("common count proof")) as common:
            with self.assertRaises(BoundaryReached):
                proof_stage.accepted_fit(root)
            self.assertEqual(common.call_args.args[0]["plannedUpdates"], 36)
            self.assertTrue(common.call_args.kwargs["versioned"])
            freeze["version"] = "association-fragment-fit-freeze/999"
            with self.assertRaisesRegex(RuntimeError, "explicit fragment"):
                proof_stage.accepted_fit(root)
            values["assignment.json"] = {}
            values["run-freeze.json"] = {"version":"association-adapter-freeze/5"}
            with patch.object(proof_stage, "checked_freeze", side_effect=BoundaryReached("legacy")) as legacy:
                with self.assertRaises(BoundaryReached): proof_stage.accepted_fit(root)
                legacy.assert_called_once()
            values["run-freeze.json"] = {"version":selector_adapter.FREEZE_VERSION}
            with patch.object(selector_adapter, "checked_freeze", side_effect=BoundaryReached("selector")) as old_selector:
                with self.assertRaises(BoundaryReached): proof_stage.accepted_fit(root)
                old_selector.assert_called_once()


if __name__ == "__main__":
    unittest.main(verbosity=2)
