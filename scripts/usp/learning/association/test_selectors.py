"""Focused CPU selector checks using retained train rows, never a teacher batch."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "services/geo"), str(Path(__file__).resolve().parent)]
from geo.usp_learning.association import selectors as codec, selector_baseline as baseline
from geo.usp_learning.association.validation import InvalidEvidence
import stage_selector_baseline as staging

COORDINATOR = Path("C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin")
FIT = Path("E:/BhuAayam-data/task-data/ml-distillation/student/adapter-query-sdpa-fit-f90a65c82dde45ae9c2e0ce4a60dddcd")


def train_control(row):
    """Test-only inverse on one row; teacher owns all production target encoding."""
    fragments = row["input"]["evidence"]
    spans = [codec.lex(fragment["text"]) for fragment in fragments]

    def select(index, text, inside=None):
        for first, (_, start, _) in enumerate(spans[index]):
            for end in range(first + 1, len(spans[index]) + 1):
                if inside and not inside[1] <= first < end <= inside[2]:
                    continue
                if fragments[index]["text"][start:spans[index][end - 1][2]] == text:
                    return [index, first, end]
        raise AssertionError("Retained control text has no exact lexical span")

    output = copy.deepcopy(row["output"])
    output["version"] = codec.VERSION
    for group in ("claims", "conflicts", "abstentions"):
        for decision in output[group]:
            decision["citations"] = [select(next(i for i, f in enumerate(fragments) if f["key"] == c["key"]), c["quote"])
                                     for c in decision["citations"]]
            if group == "claims":
                for field in ("literal", "unit"):
                    if decision[field] is not None:
                        decision[field] = next(select(c[0], decision[field], c) for c in decision["citations"])
    return output


class SelectorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw = Path("E:/BhuAayam-data/task-data/ml-distillation/teacher/train-teacher-v2.jsonl").read_bytes()
        assert hashlib.sha256(raw).hexdigest() == "7510a7040afb7bec2bba9422eb5e14bbf0664c927bd0c2b24989c1af6dc7674c"
        ids = ("teacher-haryana-floor02", "teacher-bihar-unusable-approval-date")
        retained = [json.loads(line) for line in raw.splitlines()]
        cls.rows = [next(row for row in retained if row["input"]["exampleId"] == key) for key in ids]
        cls.conflict = next(row for row in retained if row["output"]["conflicts"])
        cls.contract = json.loads((FIT / "inputs/schema-v1.json").read_bytes())
        cls.family = json.loads((FIT / "inputs/family-freeze.json").read_bytes())
        cls.schema_bytes = (COORDINATOR / "scripts/usp/learning/association/selector-schema-v1.json").read_bytes()
        cls.schema = codec.checked_schema(cls.schema_bytes)

    def projection(self, pointers, row=None):
        row = row or self.rows[0]
        source = codec.context(row["input"], self.contract, self.family)
        return codec.project(json.dumps(pointers), source, self.schema, self.contract, self.family)

    def rejected(self, output, row=None):
        result = self.projection(output, row)
        self.assertFalse(result["modelOutputValid"])
        self.assertFalse(result["expandedOutputValid"])
        self.assertEqual(result["acceptedClaimCount"], 0)
        self.assertEqual(result["acceptedProjection"]["claims"], [])
        self.assertFalse(result["repairApplied"])
        return result

    def test_lossless_unicode_whitespace_punctuation_and_codepoint_offsets(self):
        # Lexical-only fixture, not an operational record or qualification label.
        raw = "  A\t13rd,\r\nक्षेत्र e\u0301 😀$  "
        tokens = codec.lex(raw)
        self.assertEqual("".join(t[0] for t in tokens), raw)
        self.assertEqual([raw[a:b] for _, a, b in tokens], [t for t, _, _ in tokens])
        self.assertEqual(tokens[0], ("  ", 0, 2))
        self.assertIn(("\u0301", raw.index("\u0301"), raw.index("\u0301") + 1), tokens)
        self.assertEqual(codec.lex(""), ())
        with self.assertRaisesRegex(InvalidEvidence, "schema_pin_drift"):
            codec.checked_schema(self.schema_bytes + b" ")

    def test_real_train_targets_round_trip_without_changes(self):
        for row in [*self.rows, self.conflict]:
            with self.subTest(example=row["input"]["exampleId"]):
                pointers = train_control(row)
                result = self.projection(pointers, row)
                self.assertTrue(result["rawSelectorValid"])
                self.assertTrue(result["expandedOutputValid"])
                self.assertEqual(result["rawSelectors"], pointers)
                self.assertEqual(result["expandedOutput"], row["output"])
                self.assertEqual(result["acceptedProjection"], row["output"])
                self.assertEqual(result["acceptedClaimCount"], len(row["output"]["claims"]))
        self.assertEqual(self.projection(train_control(self.rows[0]))["expandedOutput"]["claims"][2]["literal"], "13rd")
        bihar = self.projection(train_control(self.rows[1]), self.rows[1])["expandedOutput"]["claims"][0]
        self.assertEqual((bihar["state"], bihar["literal"], bihar["unit"]), ("unknown", None, None))

    def test_raw_types_ranges_and_old_free_text_reject_whole_output(self):
        original = train_control(self.rows[0])
        invalid = ([False, 0, 1], [0, 0.0, 1], ["0", 0, 1], [-1, 0, 1], [99, 0, 1],
                   [0, 1, 1], [0, 1, 0], [0, 0, 9999], [0, 0], [0, 0, 1, 2], "TOWER03",
                   {"key": "t3-2-title:item-8", "quote": "TOWER03"})
        for pointer in invalid:
            with self.subTest(pointer=pointer):
                value = copy.deepcopy(original)
                value["claims"][-1]["citations"][0] = pointer
                result = self.rejected(value)
                self.assertEqual(result["rawSelectors"], value)
                self.assertFalse(result["rawSelectorValid"])
                self.assertIsNone(result["expandedOutput"])
        self.rejected(self.rows[0]["output"])
        source = codec.context(self.rows[0]["input"], self.contract, self.family)
        for raw in ('{"version":', '{"claims":[],"claims":[]}', '{"value":NaN}'):
            result = codec.project(raw, source, self.schema, self.contract, self.family)
            self.assertFalse(result["jsonSyntaxValid"])
            self.assertEqual(result["acceptedClaimCount"], 0)

    def test_citation_binding_and_semantics_are_separate_from_valid_pointers(self):
        pointers = train_control(self.rows[0])
        wrong = copy.deepcopy(pointers)
        wrong["claims"][2]["citations"] = wrong["claims"][0]["citations"]
        result = self.rejected(wrong)
        self.assertTrue(result["rawSelectorValid"])
        self.assertIsNotNone(result["expandedOutput"])
        self.assertIn("not_covered_by_own_citation", result["errors"][0]["message"])
        duplicate = copy.deepcopy(pointers)
        duplicate["claims"][0]["citations"] *= 2
        self.assertIn("duplicate_citation", self.rejected(duplicate)["errors"][0]["message"])
        bihar = train_control(self.rows[1])
        bad_null = copy.deepcopy(bihar)
        bad_null["claims"][0]["literal"] = bad_null["claims"][0]["citations"][0]
        self.assertIn("nondeclared_value", self.rejected(bad_null, self.rows[1])["errors"][0]["message"])
        for state in ("absent", "null", "withheld"):
            changed = copy.deepcopy(bihar)
            changed["claims"][0]["state"] = state
            self.assertIn("state_not_cited", self.rejected(changed, self.rows[1])["errors"][0]["message"])
        conflict = train_control(self.conflict)
        conflict["conflicts"] = []
        self.assertIn("conflict", self.rejected(conflict, self.conflict)["errors"][0]["message"])
        # The original validator cannot establish semantic role truth for OCR literals.
        role_only = copy.deepcopy(pointers)
        role_only["claims"][0]["role"] = "drawing"
        self.assertTrue(self.projection(role_only)["expandedOutputValid"])

    def test_source_snapshot_pin_family_and_prompt_isolation(self):
        example = copy.deepcopy(self.rows[0]["input"])
        digest = codec.canonical_sha(example)
        source = codec.context(example, self.contract, self.family, expected_input_sha256=digest)
        prompt = json.loads(source.messages()[1]["content"])
        self.assertEqual(prompt, {"evidence": [{"fragment": i, "tokens": [t for t, _, _ in codec.lex(f["text"])]}
                                               for i, f in enumerate(example["evidence"])]})
        self.assertNotIn("supervision", prompt)
        self.assertNotIn("output", prompt)
        original_prompt = source.messages()
        example["evidence"][0]["text"] = "mutated after snapshot"
        self.assertEqual(source.messages(), original_prompt)
        for mutate in (lambda x: x["evidence"][0].update(text="changed"),
                       lambda x: x["evidence"][0].update(key="changed"),
                       lambda x: x["evidence"][0]["locator"].update(pageNumber=99),
                       lambda x: x["evidence"][0].update(sourceSha256="0" * 64)):
            changed = copy.deepcopy(self.rows[0]["input"])
            mutate(changed)
            with self.assertRaises(InvalidEvidence):
                codec.context(changed, self.contract, self.family, expected_input_sha256=digest)
        with self.assertRaises(InvalidEvidence):
            codec.context(self.rows[0], self.contract, self.family)
        family = copy.deepcopy(self.family)
        for f in family["families"]:
            if f["familyId"] == self.rows[0]["input"]["familyId"]:
                f["split"] = "evaluation"
        with self.assertRaisesRegex(InvalidEvidence, "source_family_split"):
            codec.context(self.rows[0]["input"], self.contract, family)

    def test_preparation_cannot_stage_and_future_freeze_pins_prompt_and_inputs(self):
        prep = COORDINATOR / "docs/evidence/usp/ml-distillation/student-09.selector-preparation.assignment.json"
        with patch.object(Path, "mkdir") as mkdir:
            with self.assertRaisesRegex(InvalidEvidence, "separate_selector_baseline_assignment_required"):
                staging.stage(prep)
            mkdir.assert_not_called()
        # In-memory contract fixture only: no stage/profile/model/development input is created.
        examples = [row["input"] for row in self.rows]
        cases = [{"exampleId": e["exampleId"], "inputCanonicalJsonSha256": codec.canonical_sha(e)} for e in examples]
        batch = {"version": "association-development/1", "examples": examples}
        baseline.checked_batch(batch, cases, self.contract, self.family, ("train",))
        with self.assertRaises(InvalidEvidence):
            baseline.checked_batch({**batch, "expectations": []}, cases, self.contract, self.family, ("train",))
        assignment = {"version": baseline.ASSIGNMENT_VERSION, "task": "STUDENT-09-BASELINE",
            "executionAllowance": {"stageModelRun": True, "inference": True, "fit": False,
                                    "evaluation": False, "promotion": False, "freshBaselinePhases": 1},
            "settings": baseline.SETTINGS, "model": baseline.MODEL, "revision": baseline.REVISION,
            "promptVersion": codec.PROMPT_VERSION, "systemPromptSha256": codec.PROMPT_SHA,
            "selectorSchemaCanonicalLfSha256": codec.SCHEMA_SHA, "lexicalPolicy": codec.POLICY,
            "studentCodeCommit": "47b01a5c3d280333352bdbca7eb066f486445a07",
            "inputBatchSha256": codec.canonical_sha(batch), "cases": cases}
        raw = {"selector-assignment.json": json.dumps(assignment).encode(), "selector-schema-v1.json": self.schema_bytes,
               "selector-prompt.txt": codec.SYSTEM_PROMPT.encode()}
        freeze = {"version": baseline.FREEZE_VERSION, "sourceCommit": assignment["studentCodeCommit"],
            "promptVersion": codec.PROMPT_VERSION, "systemPromptSha256": codec.PROMPT_SHA,
            "selectorSchemaCanonicalLfSha256": codec.SCHEMA_SHA, "lexicalPolicy": codec.POLICY,
            "settings": baseline.SETTINGS, "model": baseline.MODEL, "modelRevision": baseline.REVISION,
            "cases": cases, "inputSha256": {"input_batch": assignment["inputBatchSha256"],
                "schema": hashlib.sha256((FIT / "inputs/schema-v1.json").read_bytes()).hexdigest(),
                "family_freeze": hashlib.sha256((FIT / "inputs/family-freeze.json").read_bytes()).hexdigest(),
                "model_receipt": hashlib.sha256((FIT / "inputs/model-acquisition.json").read_bytes()).hexdigest()},
            "auxiliaryInputSha256": {name: hashlib.sha256(data).hexdigest() for name, data in raw.items()},
            "fitPerformed": False, "evaluationAllowed": False}
        with patch.object(Path, "read_bytes", lambda p: raw[p.name]):
            self.assertEqual(baseline.checked_run_inputs(freeze, Path("unused"))[1], assignment)
            altered = copy.deepcopy(freeze)
            altered["systemPromptSha256"] = "0" * 64
            with self.assertRaises(InvalidEvidence):
                baseline.checked_run_inputs(altered, Path("unused"))
            raw["selector-prompt.txt"] += b"changed"
            with self.assertRaisesRegex(InvalidEvidence, "auxiliary_pin_drift"):
                baseline.checked_run_inputs(freeze, Path("unused"))

    def test_no_model_dependency_imports(self):
        self.assertFalse({"torch", "transformers", "peft", "accelerate", "safetensors"} & set(sys.modules))


class SourcePinTests(unittest.TestCase):
    def test_accepted_source_versions_and_assignment_pins_before_mkdir(self):
        self.assertEqual(staging.isolation.sha(staging.BASELINE / "profile.json"), staging.BASELINE_PROFILE_SHA)
        profile = json.loads((staging.BASELINE / "profile.json").read_bytes())
        assignment_path = COORDINATOR / "docs/evidence/usp/ml-distillation/student-09.selector-baseline.assignment.json"
        assignment_raw = assignment_path.read_bytes()
        self.assertEqual(hashlib.sha256(assignment_raw).hexdigest(),
                         "57b77caffc2a0527348b07cda104e08a53afb758acb90468b2467aba8b69c4f9")
        assigned = json.loads(assignment_raw)["runtimeCodeCanonicalLfSha256"]
        sources = {name: (REPO / name).read_bytes() for name in staging.SOURCE_PATHS}
        # In-memory future pin fixture for this owned correction; no assignment is rewritten.
        leaf = "scripts/usp/learning/association/stage_selector_baseline.py"
        assigned[leaf] = hashlib.sha256(sources[leaf].replace(b"\r\n", b"\n")).hexdigest()
        with patch.object(Path, "mkdir") as mkdir:
            pins = staging.checked_source_pins(sources, profile["files"], assigned)
            self.assertEqual(len(pins), 12)
            for name in staging.BASELINE_CODE:
                if name.endswith("association_student.py"):
                    continue
                expected = staging.ACCEPTED_LATER_SOURCE_SHA256.get(name, profile["files"]["code/" + name])
                self.assertEqual(pins[name], expected)
            # A matching assignment cannot authorize older or altered protected code.
            for name in staging.ACCEPTED_LATER_SOURCE_SHA256:
                old = (staging.BASELINE / "code" / name).read_bytes()
                self.assertEqual(hashlib.sha256(old).hexdigest(), profile["files"]["code/" + name])
                for unaccepted in (old, sources[name] + b"\n# changed\n"):
                    with self.subTest(source=name, retained=unaccepted == old):
                        changed = {**sources, name: unaccepted}
                        matching = {**assigned, name: hashlib.sha256(unaccepted.replace(b"\r\n", b"\n")).hexdigest()}
                        with self.assertRaisesRegex(InvalidEvidence, "selector_protected_source_drift"):
                            staging.checked_source_pins(changed, profile["files"], matching)
            name = "services/geo/geo/usp_learning/resources.py"
            changed = {**sources, name: sources[name] + b"\n# changed\n"}
            matching = {**assigned, name: hashlib.sha256(changed[name].replace(b"\r\n", b"\n")).hexdigest()}
            with self.assertRaisesRegex(InvalidEvidence, "selector_protected_source_drift"):
                staging.checked_source_pins(changed, profile["files"], matching)
            for bad_pins in ({k: v for k, v in assigned.items() if k != leaf}, {**assigned, "extra.py": "0" * 64}):
                with self.assertRaisesRegex(InvalidEvidence, "selector_assignment_code_pin_set_drift"):
                    staging.checked_source_pins(sources, profile["files"], bad_pins)
            with self.assertRaisesRegex(InvalidEvidence, "selector_assignment_code_pin_drift"):
                staging.checked_source_pins({**sources, leaf: sources[leaf] + b"\n"}, profile["files"], assigned)
            mkdir.assert_not_called()
        self.assertFalse({"torch", "transformers", "peft", "accelerate", "safetensors"} & set(sys.modules))


if __name__ == "__main__":
    unittest.main(verbosity=2)
