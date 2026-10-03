"""CPU controls for exact v2 admission and shared proof/loader boundaries."""
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
NATIVE = {"torch", "transformers", "tokenizers", "peft", "accelerate", "safetensors", "numpy", "ifcopenshell"}


class NativeForbidden(Exception):
    pass


original_import = builtins.__import__


def cpu_import(name, *args, **kwargs):
    if name.split(".")[0] in NATIVE:
        raise NativeForbidden(name)
    return original_import(name, *args, **kwargs)


# Guard imports from initial module loading through every control.
builtins.__import__ = cpu_import
import association_adapter as cli
import stage_adapter as proof_stage
import stage_fragment_adapter as shared
import stage_fragment_support_v2 as staging
from geo.usp_learning.association import adapter, fragment_adapter as v1, fragment_support_v2 as f, selector_adapter, student
from geo.usp_learning.association.citation_view import epoch_orders
from geo.usp_learning.association.validation import InvalidEvidence
from test_fragment_adapter import TemplateTokenizer, BoundaryReached


class FragmentSupportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = staging.TRAINING.read_bytes()
        cls.support = {name: path.read_bytes() for name, path in staging.TRAINING_SOURCES.items()}
        cls.source = shared.BASELINE / "inputs"
        cls.schema = f.codec.checked_schema((cls.source / "fragment-schema-v1.json").read_bytes())
        cls.contract = json.loads((cls.source / "legacy-schema-v1.json").read_bytes())
        cls.family = json.loads((cls.source / "family-freeze.json").read_bytes())
        cls.physical = {p: f.sha((REPO / p).read_bytes()) for p in f.SOURCE_PATHS}
        cls.canonical = {p: f.sha((REPO / p).read_bytes().replace(b"\r\n", b"\n")) for p in f.SOURCE_PATHS}
        cls.rows, cls.delta = f.checked_teacher(cls.data, cls.schema, cls.contract, cls.family)
        cls.rep = f.FragmentRepresentation(cls.schema, cls.contract, cls.family)

    def tearDown(self):
        self.assertFalse(NATIVE & {n.split(".")[0] for n in sys.modules})

    def assignment(self, action="fit", module=f):
        value = shared.phase_template(action, fragment=module)["assignment"]
        value.update(executable=True, executionAllowance=f.allowance(action), studentCodeCommit="1" * 40,
                     runtimeCodeCanonicalLfSha256={p: self.canonical[p] for p in module.SOURCE_PATHS})
        if action == "reload":
            value["acceptedFit"] = {k: "2" * 64 for k in f.ACCEPTED_FIT_KEYS}
            value["acceptedFit"].update(root=str(REPO / "__fake_fit_never_created__"), sourceCommit="3" * 40)
        return value

    def freeze(self, assignment, module=f):
        return module.make_freeze(assignment, f.serialized(assignment), {p: self.physical[p] for p in module.SOURCE_PATHS})

    def test_exact_rows_parent_receipts_and_unchanged_targets(self):
        f.checked_support_files(self.support, self.data)
        self.assertEqual(self.delta["counts"], {"rows": 10, "candidateAppearances": 57, "selectedAppearances": 12, "emptySelections": 3})
        self.assertEqual(self.rep.training_plan["plannedUpdates"], 60)
        originals = f.checked_data(self.data)
        encoded, lengths = adapter.encode_training(TemplateTokenizer(), self.rows, representation=self.rep)
        for original, row, tokens, length in zip(originals, self.rows, encoded, lengths, strict=True):
            self.assertEqual(row["fragmentTrainingRow"], original)
            self.assertEqual(self.rep.messages(row)[0]["content"], f.SYSTEM_PROMPT)
            self.assertEqual(json.loads(self.rep.messages(row)[1]["content"]), original["input"])
            self.assertEqual(self.rep.target(row), f.codec.canonical(original["output"]))
            self.assertEqual(length["targetSha256"], f.object_sha(original["output"]))
            count = tokens["promptTokens"]
            self.assertEqual(tokens["labels"][:count], [-100] * count)
            self.assertEqual(tokens["labels"][count:], tokens["inputIds"][count:])
            self.assertEqual(tokens["labels"][-1], TemplateTokenizer.eos_token_id)
        parent = self.support["train-teacher-fragments-v1.jsonl"]
        old_rows, _ = v1.checked_teacher(parent, self.schema, self.contract, self.family)
        self.assertEqual(self.rows[:6], old_rows)
        self.assertEqual(v1.FragmentRepresentation(self.schema, self.contract, self.family).training_plan["plannedUpdates"], 36)
        for field in ("context", "input", "output", "supervision"):
            bad = copy.deepcopy(originals[6]); bad[field]["unknown"] = True
            with self.assertRaises(InvalidEvidence): f.checked_row(bad, self.schema, self.contract, self.family)
        for bad in (parent, self.data + b" ", self.data.replace(b"pair01-a", b"pair01-z")):
            with self.assertRaises(InvalidEvidence): f.checked_teacher(bad, self.schema, self.contract, self.family)
        with self.assertRaises(InvalidEvidence): v1.checked_teacher(self.data, self.schema, self.contract, self.family)
        for name in f.SUPPORT_PINS:
            bad = dict(self.support); bad[name] += b" "
            with self.assertRaises(InvalidEvidence): f.checked_support_files(bad, self.data)

    def test_disabled_mixed_stale_and_source_drift_refuse_before_mkdir(self):
        assignment = self.assignment()
        variants = [staging.phase_template(a)["assignment"] for a in f.VERSIONS]
        variants += [self.assignment(module=v1), {**assignment, "version": "association-fragment-support-fit-assignment/999"},
                     {**assignment, "studentCodeCommit": None}, {**assignment, "previousFailedFit": "forbidden"}]
        for value in variants:
            with patch.object(Path, "read_bytes", return_value=f.serialized(value)), patch.object(Path, "mkdir") as mkdir, \
                    patch.object(shared, "donor_metadata") as donor, patch.object(shared, "checked_sources") as sources:
                with self.assertRaises(InvalidEvidence): staging.stage("fit", Path("__assignment_not_read__"))
                mkdir.assert_not_called(); donor.assert_not_called(); sources.assert_not_called()
        # A syntactically valid mutable-source pin must still match actual Git bytes.
        assignment["runtimeCodeCanonicalLfSha256"]["services/geo/geo/usp_learning/association/fragment_support_v2.py"] = "0" * 64
        real_read = Path.read_bytes
        sentinel = REPO / "__assignment_not_created__"
        def read(path):
            return f.serialized(assignment) if path == sentinel else real_read(path)
        def git(args, **kwargs):
            if args[1] == "rev-parse": return "1" * 40
            if args[1] == "status": return ""
            return real_read(REPO / args[2].split(":", 1)[1]).replace(b"\r\n", b"\n")
        with patch.object(Path, "read_bytes", read), patch.object(shared.subprocess, "check_output", git), \
                patch.object(Path, "mkdir") as mkdir, patch.object(shared, "donor_metadata") as donor:
            with self.assertRaisesRegex(InvalidEvidence, "source_git_pin_drift"): staging.stage("fit", sentinel)
            mkdir.assert_not_called(); donor.assert_not_called()
        for action in f.VERSIONS:
            template = staging.phase_template(action)
            self.assertFalse(template["executable"])
            self.assertEqual(template["assignment"]["executionAllowance"], f.allowance(action, False))
            self.assertIsNone(template["assignment"]["studentCodeCommit"])
            self.assertTrue(all(v is None for v in template["assignment"]["runtimeCodeCanonicalLfSha256"].values()))
            for k in ("runCommand", "runFreezeSha256", "phaseProfileSha256"): self.assertIsNone(template[k])
            if action == "reload": self.assertTrue(all(v is None for v in template["assignment"]["acceptedFit"].values()))

    def test_exact_input_allowlist_and_version_dispatch(self):
        assignment = self.assignment(); freeze = self.freeze(assignment)
        virtual = REPO / "__inputs_never_created__"
        values = {**self.support, f.DATA_NAME: self.data, "assignment.json": f.serialized(assignment),
            "run-freeze.json": f.serialized(freeze), "runtime-requirements-resolved.txt": b"not opened; profile pin only",
            "schema-v1.json": (self.source / "legacy-schema-v1.json").read_bytes(),
            **{name: (self.source / name).read_bytes() for name in
               ("family-freeze.json", "model-acquisition.json", "fragment-schema-v1.json", "fragment-prompt.txt")}}
        original_read = Path.read_bytes
        def read(path):
            return values[path.name] if path.parent == virtual else original_read(path)
        def digest(path):
            return f.REQUIREMENTS_SHA if Path(path).name == "runtime-requirements-resolved.txt" else f.sha(read(Path(path)))
        with patch.object(Path, "read_bytes", read), patch.object(Path, "iterdir", lambda p: iter(virtual / n for n in values)), \
                patch.object(v1, "digest_file", digest):
            self.assertEqual(f.checked_inputs(freeze, assignment, virtual), self.schema)
            values["development.json"] = b"{}"
            with self.assertRaisesRegex(InvalidEvidence, "unexpected_input"): f.checked_inputs(freeze, assignment, virtual)
            del values["development.json"]
            values["source-support-v2.receipt.json"] += b" "
            with self.assertRaisesRegex(InvalidEvidence, "auxiliary_pin_drift"): f.checked_inputs(freeze, assignment, virtual)
        self.assertIs(cli.representation_module(freeze, assignment), f)
        old = self.assignment(module=v1)
        self.assertIs(cli.representation_module(self.freeze(old, v1), old), v1)
        with self.assertRaises(InvalidEvidence): cli.representation_module(freeze, old)
        with self.assertRaises(InvalidEvidence): cli.representation_module(self.freeze(old, v1), assignment)
        self.assertIsNone(cli.representation_module({"version": "association-adapter-freeze/5"}, {}))
        self.assertIs(cli.representation_module({"version": selector_adapter.FREEZE_VERSION}, {}), selector_adapter)
        args = SimpleNamespace(action="fit", run_freeze=virtual / "run-freeze.json", adapter_dir=None,
            input_batch=None, adapter_manifest=None, fit_proof=None,
            **{key: virtual / name for key, name in f.input_names("fit").items()})
        f.checked_cli(args, freeze)
        self.assertEqual(args.teacher_v1, args.training_data)
        args.teacher_v1 = virtual / "train-teacher-fragments-v1.jsonl"
        with self.assertRaisesRegex(InvalidEvidence, "alias_drift"): f.checked_cli(args, freeze)
        self.assertFalse(set(f.SUPPORT_PINS) & set(f.auxiliary_pins("reload")))

    def test_reload_remains_default_off_and_uses_same_controller(self):
        examples = json.loads((self.source / "development.json").read_bytes())["examples"]
        route = json.loads((self.source / "fragment-route.json").read_bytes())
        def call(**kwargs):
            return student.run_local(examples, self.contract, self.family, Path("__no_model__"), lambda: None,
                lambda *a: None, fragment_route=route, fragment_contract=self.schema, preserve_preflight=lambda x: None, **kwargs)
        with self.assertRaises(InvalidEvidence): call(model_loader=lambda path: None)
        for module in (f, v1):
            assignment = self.assignment("reload", module); freeze = self.freeze(assignment, module)
            with self.assertRaises(NativeForbidden):
                call(model_loader=lambda path: None, fragment_adapter_reload={"freeze": freeze, "assignment": assignment})
            runner = module.reload_runner(freeze, assignment, self.source, self.schema, lambda x: None)
            self.assertIs(runner.func, student.run_local)
            self.assertNotIn("model_loader", runner.keywords)
        with self.assertRaises(NativeForbidden): call()  # unchanged baseline boundary
        disabled = staging.phase_template("reload")["assignment"]
        with self.assertRaises(InvalidEvidence):
            call(model_loader=lambda path: None, fragment_adapter_reload={"freeze": freeze, "assignment": disabled})

    def test_new_saved_fit_binding_and_common_sixty_update_proof(self):
        assignment = self.assignment("reload"); expected = assignment["acceptedFit"]
        proof = {k: v for k, v in expected.items() if k not in ("root", "adapterWeightsSha256", "fitProofSha256")}
        proof.update(fitRoot=expected["root"], representation=f.representation_metadata(), updates=60,
                     trainingPlan=f.training_plan(), fitResourceAccepted=True)
        expected["fitProofSha256"] = f.sha(f.serialized(proof))
        manifest = {"representation": f.representation_metadata(), "files": {"adapter_model.safetensors": expected["adapterWeightsSha256"]},
            "updates": 60, "trainingPlan": f.training_plan(), "tensorCount": 96, "savedStateMatchesTrainableAdapter": True,
            "baseParametersBefore": {"sha256": "4" * 64}, "baseParametersAfter": {"sha256": "4" * 64}}
        f.checked_reload_binding(self.freeze(assignment), proof, manifest)
        for field, value in (("updates", 36), ("representation", v1.representation_metadata())):
            bad = copy.deepcopy(manifest); bad[field] = value
            with self.assertRaises(InvalidEvidence): f.checked_reload_binding(self.freeze(assignment), proof, bad)
        # Technical storage fixtures only: reach unchanged count/order/token/base/GPU
        # checks, then deliberately stop before touching any saved adapter bytes.
        assignment = self.assignment(); freeze = self.freeze(assignment); plan = f.training_plan()
        orders = epoch_orders(plan)
        preflight = {"representation": f.representation_metadata(), "systemPromptSha256": f.codec.PROMPT_SHA,
            "trainingPlan": plan, "plannedUpdates": 60, "epochOrder": orders,
            "lengths": [{"exampleId": r["input"]["exampleId"], "targetSha256": f.sha(self.rep.target(r).encode()),
                         "assistantJsonPlusEosTokens": 7, "combinedTokens": 99} for r in self.rows]}
        progress = [{"update": e * 10 + j + 1, "epoch": e + 1, "exampleId": self.rows[i]["input"]["exampleId"],
                     "loss": 1.0, "supervisedTokens": 7, "combinedTokens": 99} for e, order in enumerate(orders) for j, i in enumerate(order)]
        result = {"representation": f.representation_metadata(), "trainingPlan": plan, "updates": 60, "teacherExamples": 10,
            "stepLosses": [1.0] * 60, "epochMeanLoss": [1.0] * 6, "supervisedTokens": 420, "baseUnchanged": True,
            "developmentOpened": False, "evaluationOpened": False,
            "gpu": {"maxCudaAllocatedBytes": 1, "maxCudaReservedBytes": 1, "minimumSampledFreeCudaBytes": 2 * 1024**3}}
        manifest.update(settings=f.FIT, numerics=f.NUMERICS, trainableParameters=540672)
        guard = {"cpuFixture": True}
        completion = {"supervisor": guard, **{k: "5" * 64 for k in
            ("fitResultSha256", "tokenPreflightSha256", "adapterManifestSha256", "runFreezeSha256")}}
        values = {"fit-result.json": result, "adapter-manifest.json": manifest, "completion.json": completion,
            "run-freeze.json": freeze, "assignment.json": assignment, "token-preflight.json": preflight,
            "teacher-delta.json": self.delta, "schema-v1.json": self.contract, "family-freeze.json": self.family}
        def pin(path):
            return freeze["inputSha256"]["assignment"] if Path(path).name == "assignment.json" else "5" * 64
        with patch.object(proof_stage, "accepted_outputs", return_value=(guard, {})), \
                patch.object(proof_stage.isolation, "read", lambda p: values[Path(p).name]), \
                patch.object(proof_stage.isolation, "sha", pin), patch.object(Path, "read_bytes", return_value=self.data), \
                patch.object(Path, "read_text", lambda p: "\n".join(json.dumps(r) for r in progress)), \
                patch.object(f, "checked_inputs", return_value=self.schema), \
                patch.object(proof_stage, "verify_adapter_files", side_effect=BoundaryReached("saved bytes not opened")) as boundary:
            with self.assertRaises(BoundaryReached): proof_stage.accepted_fit(REPO / "__fake_fit_never_created__")
            boundary.assert_called_once()
            progress[-1]["supervisedTokens"] = 8
            with self.assertRaisesRegex(InvalidEvidence, "supervised_token_count_drift"):
                proof_stage.accepted_fit(REPO / "__fake_fit_never_created__")


if __name__ == "__main__":
    unittest.main(verbosity=2)
