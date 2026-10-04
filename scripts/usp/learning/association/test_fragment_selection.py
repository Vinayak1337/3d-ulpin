"""Focused CPU retrieval/identity controls; no predictions, labels or native run."""
from __future__ import annotations

import copy
import hashlib
import inspect
import json
from pathlib import Path
import sys
import unittest

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "services/geo"), str(Path(__file__).resolve().parent)]
import prepare_fragment_selection as preparation
from geo.usp_learning.association import fragment_selection as codec, student
from geo.usp_learning.association.validation import InvalidEvidence, project_raw

ASSIGNMENT = Path("C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin/docs/evidence/usp/ml-distillation/student-15.fragment-selection-preparation.assignment.json")


class FragmentSelectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _, cls.schema, cls.legacy, cls.family, cls.evidence, *_ = preparation.load_preparation_inputs(ASSIGNMENT)
        cls.examples, cls.contexts = preparation.cpu_contexts(cls.evidence, cls.schema, cls.legacy, cls.family)

    def tearDown(self):
        self.assertFalse({"torch", "transformers", "tokenizers", "ifcopenshell", "safetensors", "peft", "numpy"}
                         & {n.split(".")[0] for n in sys.modules})

    def project(self, source, value):
        raw = value if type(value) is str else codec.canonical(value)
        return codec.project(raw, source, self.schema, self.legacy, self.family, ("train",))

    def test_exact_partial_ocr_fragment_and_empty_retrieval(self):
        source, empty_source = self.contexts
        self.assertEqual(source.snapshot()["split"], "train")
        self.assertEqual(source.model_input()["candidates"], [{"id": "c0", "fragment": self.evidence[0]}, {"id": "c1", "fragment": self.evidence[1]}])
        self.assertEqual(set(source.model_input()), {"version", "candidateSetSha256", "request", "candidates"})
        selected = self.project(source, codec.selection(source, ("c1",)))
        self.assertTrue(selected["modelOutputValid"])
        self.assertEqual(selected["retrievedFragmentCount"], 1)
        fragment = selected["acceptedProjection"]["selected"][0]["fragment"]
        self.assertEqual(fragment, self.evidence[1])
        self.assertEqual(fragment["locator"]["textCompleteness"], "unverified")
        self.assertIn("13rd", fragment["text"])
        self.assertEqual(fragment["method"], "ocr_observation")
        self.assertNotIn("claims", selected["acceptedProjection"])
        self.assertNotIn("canonicalLinks", selected["acceptedProjection"])
        empty = self.project(empty_source, codec.selection(empty_source))
        self.assertTrue(empty["modelOutputValid"])
        self.assertEqual(empty["selectedFraction"], 0)
        self.assertEqual(empty["acceptedProjection"]["status"], "no_support_in_supplied_context")
        self.assertEqual(empty["acceptedProjection"]["selected"], [])
        # Returned dictionaries do not mutate the immutable source snapshot.
        fragment["text"] = "technical output mutation"
        self.assertEqual(source.snapshot()["candidates"][1]["fragment"], self.evidence[1])

    def test_whole_response_stale_unknown_duplicate_rewrite_refusal(self):
        source = self.contexts[0]
        stale = codec.selection(self.contexts[1], ("c1",))
        values = [stale, codec.selection(source, ("c0", "c24")), codec.selection(source, ("c1", "c1")),
                  {**codec.selection(source, ("c1",)), "fragment": {"text": "rewritten"}},
                  codec.canonical(codec.selection(source, ("c1",)))[:-1]]
        for value in values:
            with self.subTest(value=value):
                result = self.project(source, value)
                self.assertFalse(result["modelOutputValid"])
                self.assertEqual(result["retrievedFragmentCount"], 0)
                self.assertIsNone(result["acceptedProjection"])
                self.assertFalse(result["repairApplied"])

    def test_context_identity_and_source_target_split_boundaries(self):
        source = self.contexts[0]
        for field in ("request", "provenance", "order"):
            example = copy.deepcopy(self.examples[0])
            request = source.snapshot()["request"]
            if field == "request":
                request += " Include its source locator."
            elif field == "provenance":
                example["evidence"][1]["locator"]["textCompleteness"] = "technical altered provenance"
            else:
                example["evidence"].reverse()
            changed = codec.context(example, request, self.schema, self.legacy, self.family)
            self.assertNotEqual(source.input_sha256, changed.input_sha256)
        for field in ("foreign_source", "duplicate_key", "target"):
            example = copy.deepcopy(self.examples[0])
            if field == "foreign_source":
                example["evidence"][0]["sourceSha256"] = "0" * 64
            elif field == "duplicate_key":
                example["evidence"][1]["key"] = example["evidence"][0]["key"]
            else:
                example["expectedIds"] = ["c1"]
            with self.assertRaises(InvalidEvidence):
                codec.context(example, source.snapshot()["request"], self.schema, self.legacy, self.family)
        changed = source.snapshot()
        changed["split"] = "development"
        with self.assertRaisesRegex(InvalidEvidence, "frozen_split"):
            codec.checked_context(changed, self.schema, self.legacy, self.family)
        with self.assertRaisesRegex(InvalidEvidence, "source_family_split_refused"):
            codec.context(self.examples[0], "Any request", self.schema, self.legacy, self.family, ("development",))

    def test_shared_id_grammar_and_source_only_route(self):
        route = {"version": codec.ROUTE_VERSION, "representation": codec.metadata(),
            "contexts": [{"context": c.snapshot(), "contextSha256": c.input_sha256} for c in self.contexts]}
        sources = codec.checked_route(route, self.examples, self.schema, self.legacy, self.family, ("train",))
        for source, ids in zip(sources, (("c1",), ())):
            grammar = codec.Grammar(source, self.schema)
            raw = codec.canonical(codec.selection(source, ids)).encode()
            state = grammar.feed(grammar.initial(), raw)
            self.assertIsNotNone(state)
            self.assertFalse(state.ops)
            bad = codec.canonical(codec.selection(source, ("c0", "c0"))).encode()
            self.assertIsNone(grammar.feed(grammar.initial(), bad))
        route["expectedIds"] = [["c1"], []]
        with self.assertRaises(InvalidEvidence):
            codec.checked_route(route, self.examples, self.schema, self.legacy, self.family, ("train",))
        self.assertEqual(hashlib.sha256(codec.SYSTEM_PROMPT.encode()).hexdigest(), codec.PROMPT_SHA)

    def test_historical_pure_default_and_train_runtime_refusal(self):
        example = self.examples[0]
        messages = student.prompt_messages(example)
        self.assertEqual(messages[0], {"role": "system", "content": student.SYSTEM_PROMPT})
        self.assertEqual(json.loads(messages[1]["content"]), {"evidence": [{"key": f["key"], "text": f["text"]} for f in example["evidence"]]})
        empty_legacy = {"version": "evidence-association-output/1", "claims": [], "conflicts": [],
            "abstentions": [{"code": "no_canonical_targets", "citations": []}], "canonicalLinks": []}
        self.assertEqual(project_raw(codec.canonical(empty_legacy), example, self.legacy, self.family, ("train",))["acceptedProjection"], empty_legacy)
        self.assertIsNone(inspect.signature(student.run_local).parameters["fragment_route"].default)
        # Technical guard callback only: train inputs are refused before any
        # dependency/model import even when the future route keyword is supplied.
        with self.assertRaisesRegex(InvalidEvidence, "source_family_split_refused"):
            student.run_local([example], self.legacy, self.family, Path("not-a-model"), lambda: None,
                              lambda *args: None, fragment_route={}, fragment_contract=self.schema,
                              preserve_preflight=lambda value: None)


if __name__ == "__main__":
    unittest.main(verbosity=2)
