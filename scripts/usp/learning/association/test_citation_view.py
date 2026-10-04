"""CPU integrity controls, without constructing a second 22-row teacher dataset.

Small in-memory variants use retained train rows only. Receipt controls are count
fixtures, not model execution evidence. No v3 file or model dependency is opened.
"""
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(Path(__file__).resolve().parent), str(REPO / "services/geo")]
from geo.usp_learning.association import adapter, citation_view as view
from geo.usp_learning.association.validation import InvalidEvidence

TEACHER = Path("E:/BhuAayam-data/task-data/ml-distillation/teacher")
ACCEPTED_FIT = Path("E:/BhuAayam-data/task-data/ml-distillation/student/adapter-query-sdpa-fit-f90a65c82dde45ae9c2e0ce4a60dddcd")


def declaration_for_control(raw):
    # This hashes actual negative-control bytes; it is never a production freeze.
    return {"version": view.VERSION, "frozen": True, "datasetSha256": hashlib.sha256(raw).hexdigest(),
            "rows": 22, "parent": {"sha256": adapter.V2_SHA, "rows": 11},
            "transform": view.POLICY, "provenance": copy.deepcopy(view.PROVENANCE)}


def one_variant(parent, line):
    """Independent implementation of teacher-03's documented metadata layout."""
    row = copy.deepcopy(parent)
    example = parent["input"]["exampleId"]
    old = [fragment["key"] for fragment in parent["input"]["evidence"]]
    aliases = {key: "view01:k-" + hashlib.sha256((example + "\0" + key).encode()).hexdigest()[:16] for key in old}
    row["input"]["exampleId"] += "-citation-view01"
    row["input"]["evidence"] = list(reversed(row["input"]["evidence"]))
    for fragment in row["input"]["evidence"]:
        fragment["key"] = aliases[fragment["key"]]
    for section in ("claims", "conflicts", "abstentions"):
        for decision in row["output"][section]:
            for citation in decision["citations"]:
                citation["key"] = aliases[citation["key"]]
    row["supervision"]["augmentation"] = True
    row["supervision"]["citationViewAugmentation"] = {
        "version": "opaque_keys_reverse_evidence/1", "parentDatasetPath": (TEACHER / "train-teacher-v2.jsonl").as_posix(),
        "parentDatasetSha256": adapter.V2_SHA, "parentExampleId": example,
        "parentRowSha256": hashlib.sha256(line).hexdigest(),
        "parentRowHashConvention": "raw UTF-8 JSONL row payload, excluding its LF terminator",
        "keyBijection": [{"oldKey": key, "newKey": aliases[key]} for key in old],
        "oldEvidenceOrder": old, "newEvidenceOrder": [aliases[key] for key in reversed(old)],
        "assignment": copy.deepcopy(view.PROVENANCE)}
    return row


class CitationViewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.v1 = (TEACHER / "train-teacher-v1.jsonl").read_bytes()
        cls.v2 = (TEACHER / "train-teacher-v2.jsonl").read_bytes()
        cls.contract = json.loads((ACCEPTED_FIT / "inputs/schema-v1.json").read_bytes())
        cls.family = json.loads((ACCEPTED_FIT / "inputs/family-freeze.json").read_bytes())
        cls.rows, cls.delta = adapter.checked_teacher(cls.v1, cls.v2, cls.contract, cls.family)
        cls.lines = cls.v2.split(b"\n")[:-1]
        cls.declaration = declaration_for_control(cls.v2 + b"\n")

    def assert_rejected(self, expected, function, *args, **kwargs):
        with self.assertRaisesRegex(InvalidEvidence, expected):
            function(*args, **kwargs)

    def test_legacy_admission_and_actual_count_receipts_still_pass(self):
        self.assertEqual(len(self.rows), 11)
        self.assertEqual(self.delta["claimsUnchanged"], 62)
        for before, after in ((self.v1 + b" ", self.v2), (self.v1, self.v2 + b" ")):
            self.assert_rejected("teacher_v[12]_pin_drift", adapter.checked_teacher,
                                 before, after, self.contract, self.family)
        plan = view.training_plan()
        self.assertEqual((plan["teacherExamples"], plan["epochs"], plan["plannedUpdates"]), (11, 6, 66))
        read = lambda name: json.loads((ACCEPTED_FIT / "outputs/fit" / name).read_bytes())
        progress = [json.loads(line) for line in (ACCEPTED_FIT / "outputs/fit/fit-progress.jsonl").read_bytes().splitlines()]
        view.checked_count_receipts(plan, read("token-preflight.json"), read("fit-result.json"),
                                    read("adapter-manifest.json"), progress, versioned=False)
        view.checked_reload_counts({"updates": 66}, read("adapter-manifest.json"), plan, versioned=False)
        freeze = json.loads((ACCEPTED_FIT / "inputs/run-freeze.json").read_bytes())
        assignment = json.loads((ACCEPTED_FIT / "inputs/assignment.json").read_bytes())
        self.assertEqual(view.checked_freeze(freeze, assignment), plan)

    def test_new_mode_requires_frozen_declaration_and_separate_assignment(self):
        for change in (None, {}, {**self.declaration, "frozen": False},
                       {**self.declaration, "datasetSha256": ""}, {**self.declaration, "datasetSha256": "0" * 64},
                       {**self.declaration, "rows": 11}, {**self.declaration, "rows": 22.0},
                       {**self.declaration, "parent": {"sha256": adapter.V1_SHA, "rows": 11}},
                       {**self.declaration, "transform": "unreviewed"}, {**self.declaration, "provenance": {}}):
            with self.subTest(declaration=change):
                self.assert_rejected("citation_view_", view.checked_declaration, change)
        prep = {"version": "ml-distillation-citation-view-code-preparation/1", "task": "STUDENT-08-PREP"}
        self.assert_rejected("separate_citation_view_fit_assignment_required", view.checked_execution, prep, "fit")
        plan = view.training_plan(self.declaration)
        self.assertEqual((plan["teacherExamples"], plan["epochs"], plan["plannedUpdates"]), (22, 6, 132))
        assignment = {"version": view.FIT_ASSIGNMENT_VERSION, "task": "STUDENT-08-FIT",
                      "executionAllowance": {"stageModelRun": True, "fit": True, "inference": False},
                      "datasetDeclaration": self.declaration, "trainingPlan": plan,
                      "studentCodeCommit": "be4e9b09399ad8c03e4986bab53754be2d324d5c"}
        freeze = {"version": "association-citation-view-freeze/1", "action": "fit", "datasetDeclaration": self.declaration,
                  "trainingPlan": plan, "inputSha256": {"training_data": self.declaration["datasetSha256"]},
                  "sourceCommit": assignment["studentCodeCommit"]}
        self.assertEqual(view.checked_freeze(freeze, assignment), plan)
        self.assert_rejected("execution_not_authorized", view.checked_execution, assignment, "reload")
        for key, value in (("trainingPlan", view.training_plan()), ("sourceCommit", ""), ("datasetDeclaration", None)):
            self.assert_rejected("citation_view_|frozen_", view.checked_freeze, {**freeze, key: value}, assignment)

    def test_dataset_digest_exact_prefix_and_row_count_refusals(self):
        # No complete variant batch is assembled or read. Check the envelope with corrupt bytes.
        admission = lambda raw, declaration: view.checked_citation_teacher(
            self.v1, self.v2, raw, declaration, self.contract, self.family)
        self.assert_rejected("dataset_pin_drift", admission, self.v2, self.declaration)
        reformatted = b" " + self.v2
        self.assert_rejected("original_prefix_changed", admission, reformatted, declaration_for_control(reformatted))
        missing_suffix = self.v2 + b"\n"
        self.assert_rejected("row_count_drift", admission, missing_suffix, declaration_for_control(missing_suffix))

    def test_real_row_inverse_recovery_including_unknown_and_conflict(self):
        selected = {0, next(i for i, r in enumerate(self.rows) if r["output"]["conflicts"]),
                    next(i for i, r in enumerate(self.rows) if r["input"]["exampleId"] == "teacher-bihar-unusable-approval-date")}
        for index in sorted(selected):
            with self.subTest(example=self.rows[index]["input"]["exampleId"]):
                variant = one_variant(self.rows[index], self.lines[index])
                view.checked_variant(self.rows[index], variant, self.lines[index], self.declaration, self.contract, self.family)
                altered_family = copy.deepcopy(self.family)
                for family in altered_family["families"]:
                    if family["familyId"] == variant["input"]["familyId"]:
                        family["split"] = "evaluation"
                self.assert_rejected("family|split", view.checked_variant, self.rows[index], variant,
                                     self.lines[index], self.declaration, self.contract, altered_family)

    def test_input_output_and_provenance_mutations_cannot_recover(self):
        parent, line = self.rows[0], self.lines[0]
        original = one_variant(parent, line)
        mutations = [
            lambda r: r["input"].update(exampleId="wrong"),
            lambda r: r["input"]["evidence"].reverse(),
            lambda r: r["input"]["evidence"][0].update(key="wrong"),
            lambda r: r["input"]["evidence"][0].update(sourceSha256=adapter.V1_SHA),
            lambda r: r["input"]["evidence"][0].update(familyId="other"),
            lambda r: r["input"]["evidence"][0].update(method="native_metadata"),
            lambda r: r["input"]["evidence"][0]["locator"].update(pageNumber=99),
            lambda r: r["input"]["evidence"][0].update(text="changed"),
            lambda r: r["output"]["claims"][0]["citations"][0].update(quote="changed"),
            lambda r: r["output"]["claims"][0]["citations"][0].update(key=r["input"]["evidence"][0]["key"]),
            lambda r: r["output"]["claims"][0].update(role="floor"),
            lambda r: r["output"]["claims"][0].update(state="unknown"),
            lambda r: r["output"]["claims"][0].update(literal=None),
            lambda r: r["output"]["claims"][0].update(unit="m"),
            lambda r: r["output"]["claims"].reverse(),
            lambda r: r["output"]["abstentions"].clear(),
            lambda r: r["output"].update(canonicalLinks=[{}]),
            lambda r: r["supervision"].update(qualification="qualified"),
            lambda r: r["supervision"].update(augmentation=False),
            lambda r: r["supervision"]["citationViewAugmentation"].update(parentRowSha256=adapter.V1_SHA),
            lambda r: r["supervision"]["citationViewAugmentation"].update(assignment={}),
            lambda r: r["supervision"]["citationViewAugmentation"]["keyBijection"].pop(),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(mutation=index):
                changed = copy.deepcopy(original)
                mutate(changed)
                self.assert_rejected("citation_view_", view.checked_variant, parent, changed, line,
                                     self.declaration, self.contract, self.family)
        for section in ("conflicts", "abstentions"):
            index = next(i for i, row in enumerate(self.rows) if any(d["citations"] for d in row["output"][section]))
            variant = one_variant(self.rows[index], self.lines[index])
            decision = next(d for d in variant["output"][section] if d["citations"])
            decision["citations"][0]["key"] = "unmapped"
            self.assert_rejected("unknown_citation", view.checked_variant, self.rows[index], variant, self.lines[index],
                                 self.declaration, self.contract, self.family)

    def test_132_update_receipts_and_reload_must_agree(self):
        plan = view.training_plan(self.declaration)
        # Count-only fixtures: no teacher targets, no purported fit observations.
        lengths = [{"exampleId": str(i), "assistantJsonPlusEosTokens": 1, "combinedTokens": 2} for i in range(22)]
        orders = view.epoch_orders(plan)
        progress = [{"update": 22 * epoch + step + 1, "epoch": epoch + 1, "exampleId": str(index),
                     "loss": 1.0, "supervisedTokens": 1, "combinedTokens": 2}
                    for epoch, order in enumerate(orders) for step, index in enumerate(order)]
        preflight = {"lengths": lengths, "plannedUpdates": 132, "epochOrder": orders, "trainingPlan": plan}
        result = {"updates": 132, "teacherExamples": 22, "stepLosses": [1.0] * 132,
                  "epochMeanLoss": [1.0] * 6, "supervisedTokens": 132, "trainingPlan": plan}
        manifest = {"updates": 132, "trainingPlan": plan}
        view.checked_count_receipts(plan, preflight, result, manifest, progress, versioned=True)
        view.checked_reload_counts(manifest, manifest, plan, versioned=True)
        for mutated in ({**manifest, "updates": 66}, {"updates": 132}, {**manifest, "trainingPlan": view.training_plan()}):
            self.assert_rejected("fit_|accepted_fit_", view.checked_reload_counts, mutated, manifest, plan, versioned=True)
        for target, mutate in ((0, lambda p: p.update(plannedUpdates=66)), (0, lambda p: p["epochOrder"][0].reverse()),
                               (1, lambda r: r.update(teacherExamples=11)), (1, lambda r: r["epochMeanLoss"].pop()),
                               (1, lambda r: r.update(supervisedTokens=66)), (2, lambda m: m.update(updates=66)),
                               (3, lambda p: p.pop()), (3, lambda p: p[0].update(exampleId="other"))):
            values = copy.deepcopy([preflight, result, manifest, progress])
            mutate(values[target])
            self.assert_rejected("fit_", view.checked_count_receipts, plan, *values, versioned=True)

    def test_no_model_dependencies_imported(self):
        self.assertFalse({"torch", "transformers", "peft", "safetensors", "accelerate"} & set(sys.modules))


if __name__ == "__main__":
    unittest.main(verbosity=2)
