"""Focused CPU source-integrity/identity controls; no expectations or native libraries."""
import ast
import copy
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
import unittest

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "services/geo"), str(Path(__file__).resolve().parent)]
from prepare_native_candidates import inputs
from geo.usp_learning.association import native_candidates as native, candidate_selection as candidate, selector_constraints as byte
from geo.usp_learning.association import selectors, selector_baseline
from geo.usp_learning.association.validation import InvalidEvidence

ASSIGNMENT = Path("C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin/docs/evidence/usp/ml-distillation/student-12.native-candidates-preparation.assignment.json")
ASSIGNMENT_SHA = "1a2da59403f8737a9b3573777712e94a04094e65e8d686071b6e3499b41e2657"
TOKENIZER = Path("E:/BhuAayam-data/task-data/ml-distillation/student/adapter-selector-reload-6dcb589a909b42b69dec5b024b308bd3/model")
METRICS = {}


class TensorFixture:
    def __init__(self, ids):
        self.ids = ids

    def tolist(self):
        return list(self.ids)


class CandidateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.assignment, cls.batch, cls.contract, cls.family, cls.authority, cls.schema = inputs(ASSIGNMENT, ASSIGNMENT_SHA)
        cls.sources = [candidate.context(x, cls.authority, cls.contract, cls.family) for x in cls.batch["examples"]]

    def project(self, value, source):
        return candidate.project(selectors.canonical(value), source, self.schema, self.contract, self.family)

    def test_source_records_subset_empty_and_immutable_snapshot(self):
        source = self.sources[0]
        candidates = source.candidate_set()["candidates"]
        reader = json.loads(self.authority.readers[0].reader_bytes)
        self.assertEqual(len(candidates), len(source.example()["evidence"]))
        for row in candidates:
            pointer = row["provenance"]["readerPointer"].split("/")
            record = reader["records"][int(pointer[2])]
            attribute = record["attributes"][pointer[4]]
            self.assertEqual(row["claim"]["literal"], attribute["value"])
            self.assertEqual(row["provenance"]["parserAttribute"], attribute)
        subset = self.project(candidate.selection(source, [candidates[0]["id"]]), source)
        empty = self.project(candidate.selection(source), source)
        self.assertTrue(subset["modelOutputValid"]); self.assertEqual(subset["acceptedClaimCount"], 1)
        self.assertTrue(empty["modelOutputValid"]); self.assertEqual(empty["acceptedSelectionFraction"], 0)
        original = source.private_view()
        candidates[0]["claim"]["literal"] = "technical mutation outside immutable context"
        view = source.example(); view["evidence"][0]["text"] = "technical mutation"
        self.assertEqual(source.private_view(), original)
        snapshot = selectors.canonical(original).encode()
        loaded = candidate.load_context(snapshot, hashlib.sha256(snapshot).hexdigest(), self.contract, self.family)
        self.assertEqual(loaded.messages(), source.messages())
        METRICS["ifc4"] = {"candidateCount": len(candidates), "setSha256": source.set_sha256,
                           "subsetAcceptedCount": subset["acceptedClaimCount"], "emptySelectionFraction": 0}

    def test_incomplete_native_absent_null_and_unsupported_georeference(self):
        source = self.sources[1]
        candidates = source.candidate_set()["candidates"]
        by_state = {c["claim"]["state"]: c for c in candidates}
        self.assertEqual(set(by_state), {"absent", "null"})
        self.assertNotIn("byteStart", by_state["absent"]["provenance"]["parserAttribute"]["locator"])
        self.assertEqual(by_state["absent"]["provenance"]["parserAttribute"]["reason"], "not_in_schema_entity")
        self.assertEqual(by_state["null"]["provenance"]["parserAttribute"]["rawLiteral"], "$")
        for item in by_state.values():
            self.assertIsNone(item["claim"]["literal"])
        self.assertEqual(source.candidate_set()["unsupported"],
                         [{"key": source.example()["evidence"][2]["key"], "reason": "georeference_not_property_candidate"}])
        self.assertTrue(self.project(candidate.selection(source, [c["id"] for c in candidates]), source)["modelOutputValid"])
        METRICS["ifc2x3"] = {"candidateCount": len(candidates), "states": list(by_state),
                            "setSha256": source.set_sha256, "unsupported": source.candidate_set()["unsupported"]}

    def test_stale_reader_pointer_original_and_conflict_denied(self):
        example = self.sources[0].example()
        stale = copy.deepcopy(example); stale["evidence"][0]["locator"]["readerOutputSha256"] = "0" * 64
        with self.assertRaisesRegex(InvalidEvidence, "stale_reader"):
            candidate.context(stale, self.authority, self.contract, self.family)
        wrong = copy.deepcopy(example)
        wrong["evidence"][0]["locator"]["readerPointer"] = wrong["evidence"][1]["locator"]["readerPointer"]
        with self.assertRaisesRegex(InvalidEvidence, "attribute_locator_drift"):
            candidate.context(wrong, self.authority, self.contract, self.family)
        old = self.authority.readers[0]
        changed = replace(self.authority, readers=(replace(old, original=old.original + b" "), *self.authority.readers[1:]))
        with self.assertRaisesRegex(InvalidEvidence, "authority_snapshot_drift"):
            candidate.context(example, changed, self.contract, self.family)
        conflict = copy.deepcopy(example)
        for row in conflict["evidence"][:2]:
            row["locator"]["conflictGroup"] = "technical_control"
        with self.assertRaisesRegex(InvalidEvidence, "explicit_conflict_unsupported"):
            candidate.context(conflict, self.authority, self.contract, self.family)

    def test_whole_response_identity_unknown_duplicate_and_no_fact_rewrite(self):
        source = self.sources[0]
        for bad in (candidate.selection(source, ["c99"]), candidate.selection(source, ["c0", "c0"]),
                    candidate.selection(self.sources[1], ["c0"]), {**candidate.selection(source, ["c0"]), "literal": "override"}):
            result = self.project(bad, source)
            self.assertFalse(result["modelOutputValid"])
            self.assertEqual(result["acceptedClaimCount"], 0)
            self.assertEqual(result["acceptedProjection"]["claims"], [])
        route = {"version": "association-candidate-runtime/1", "representation": candidate.metadata(), "contexts": [
            {"snapshot": c.private_view(), "snapshotSha256": selectors.canonical_sha(c.private_view())} for c in self.sources]}
        self.assertEqual(candidate.checked_route(route, self.batch["examples"], self.contract, self.family, self.schema), self.sources)
        route["contexts"][0], route["contexts"][1] = route["contexts"][1], route["contexts"][0]
        with self.assertRaisesRegex(InvalidEvidence, "runtime_input_drift"):
            candidate.checked_route(route, self.batch["examples"], self.contract, self.family, self.schema)

    def test_shared_transport_candidate_prefixes_and_selector_default(self):
        started = time.perf_counter(); vocabulary = byte.Vocabulary(TOKENIZER)
        source = self.sources[0]
        runs = []
        for ids in ([], ["c2"]):
            grammar = candidate.Grammar(source, self.schema)
            raw = selectors.canonical(candidate.selection(source, ids)).encode()
            controller = byte.Controller(vocabulary, source, self.schema, [151644], grammar=grammar)
            generated = []
            for value in raw:
                allowed = controller(0, TensorFixture([151644, *generated]))
                self.assertNotIn(vocabulary.eos_id, allowed)
                token = vocabulary.single_bytes[value]
                self.assertIn(token, allowed); generated.append(token)
            self.assertEqual(controller(0, TensorFixture([151644, *generated])), [vocabulary.eos_id])
            runs.append(controller.finish([*generated, vocabulary.eos_id], raw.decode()))
        for ids in (["c99"], ["c0", "c0"]):
            grammar = candidate.Grammar(source, self.schema)
            self.assertIsNone(grammar.feed(grammar.initial(), selectors.canonical(candidate.selection(source, ids)).encode()))
        old_schema = selectors.checked_schema((TOKENIZER.parent / "inputs/selector-schema-v1.json").read_bytes())
        old_source = selectors.context(self.batch["examples"][0], self.contract, self.family, ("development",))
        old_raw = selectors.canonical({"version": selectors.VERSION, "claims": [], "conflicts": [],
            "abstentions": [{"code": "no_canonical_targets", "citations": []}], "canonicalLinks": []})
        old_controller = byte.Controller(vocabulary, old_source, old_schema, [])
        self.assertTrue(old_controller.finish([vocabulary.single_bytes[b] for b in old_raw.encode()], old_raw)["grammarComplete"])
        self.assertTrue(selectors.project(old_raw, old_source, old_schema, self.contract, self.family, ("development",))["modelOutputValid"])
        tree = ast.parse((REPO / "services/geo/geo/usp_learning/association/selector_baseline.py").read_bytes())
        self.assertEqual(sum(isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "generate" for n in ast.walk(tree)), 1)
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "run_selectors")
        defaults = dict(zip((n.arg for n in function.args.kwonlyargs), function.args.kw_defaults))
        self.assertIsNone(ast.literal_eval(defaults["candidate_route"]))
        with self.assertRaises(InvalidEvidence):
            selector_baseline.checked_assignment(self.assignment)
        for relative in self.assignment["protectedCanonicalLfSha256"]:
            path = REPO / relative
            if path.exists():
                self.assertEqual(hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest(), self.assignment["protectedCanonicalLfSha256"][relative])
        self.assertFalse({"torch", "transformers", "tokenizers", "ifcopenshell", "peft", "safetensors"} & set(sys.modules))
        METRICS["transport"] = {"seconds": time.perf_counter() - started, "trieNodes": len(vocabulary.first),
            "controls": runs, "nativeTokenizerUsed": False, "segmentation": "actual vocabulary single-byte IDs; not native encoding"}


if __name__ == "__main__":
    started = time.perf_counter()
    tests = unittest.main(verbosity=2, exit=False)
    METRICS.update(testsRun=tests.result.testsRun, passed=tests.result.wasSuccessful(), elapsedSeconds=time.perf_counter() - started,
                   expectationsConsumed=False, nativeModelOrParserInitialized=False)
    print(json.dumps(METRICS, sort_keys=True))
    raise SystemExit(0 if tests.result.wasSuccessful() else 1)
