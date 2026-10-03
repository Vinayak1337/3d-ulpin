"""Focused CPU controls; synthetic scores establish no model or source quality."""
from __future__ import annotations

import builtins
import copy
from fractions import Fraction
import math
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "services/geo"), str(Path(__file__).resolve().parent)]
NATIVE = {"torch", "transformers", "tokenizers", "peft", "accelerate", "safetensors", "numpy", "ifcopenshell"}
original_import = builtins.__import__


def cpu_import(name, *args, **kwargs):
    if name.split(".")[0] in NATIVE:
        raise RuntimeError("native import forbidden in CPU controls:" + name)
    return original_import(name, *args, **kwargs)


builtins.__import__ = cpu_import
import prepare_fragment_rank as prepare
from geo.usp_learning.association import fragment_rank as rank
from geo.usp_learning.association.validation import InvalidEvidence, strict_json

ASSIGNMENT = Path("C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin/docs/evidence/usp/ml-distillation/student-25.fragment-rank-cpu.assignment.json")


class FragmentRankTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.assignment, cls.assignment_raw, cls.values = prepare.load_inputs(ASSIGNMENT)
        cls.bundle = prepare.compile_training(cls.values)
        cls.rows = prepare.authority.checked_data(cls.values[prepare.authority.DATA_NAME])
        cls.schema = prepare.authority.codec.checked_schema(cls.values["fragment-schema-v1.json"])
        cls.contract, cls.family = (strict_json(cls.values[name]) for name in ("schema-v1.json", "family-freeze.json"))
        cls.pairs = [strict_json(line) for line in cls.bundle["train-fragment-rank-v1.jsonl"].splitlines()]
        cls.inputs = [strict_json(line) for line in cls.bundle["scoring-inputs.jsonl"].splitlines()]
        cls.lineage = strict_json(cls.bundle["lineage.json"])

    def tearDown(self):
        self.assertFalse(NATIVE & {name.split(".")[0] for name in sys.modules})

    def focus(self, context, focus):
        return rank.scoring_input(context, focus, self.schema, self.contract, self.family)

    def project(self, vector):
        return rank.project_scores(vector, self.rows[0]["context"], self.schema, self.contract, self.family)

    def test_pinned_parent_pairs_and_lineage(self):
        self.assertEqual(strict_json(self.bundle["counts.json"]),
            {"parents": 10, "pairs": 57, "positive": 12, "negative": 45, "emptyParents": 3, "families": 2})
        weights = [Fraction(0) for _ in self.rows]
        for pair, source in zip(self.pairs, self.inputs, strict=True):
            row = self.rows[pair["parentIndex"]]
            candidate = row["context"]["candidates"][pair["candidateIndex"]]
            lineage = self.lineage["parents"][pair["parentIndex"]]
            self.assertEqual(source["context"], row["context"])
            self.assertEqual(source["focusCandidateId"], candidate["id"])
            self.assertEqual(set(source), {"version", "candidateSetSha256", "context", "focusCandidateId"})
            self.assertEqual(pair["scoringInputSha256"], prepare.sha(prepare.encoded(source)))
            self.assertEqual(pair["label"], int(candidate["id"] in row["output"]["selected"]))
            self.assertEqual(pair["targetText"], str(pair["label"]))
            self.assertEqual(pair["fragmentSha256"], prepare.sha(prepare.encoded(candidate["fragment"])))
            self.assertEqual(pair["originalTargetSha256"], prepare.sha(prepare.encoded(row["output"])))
            self.assertEqual(pair["parentLineageSha256"], prepare.sha(prepare.encoded(lineage)))
            self.assertEqual(lineage["supervision"], row["supervision"])
            self.assertEqual(lineage["target"], row["output"])
            self.assertEqual(pair["reviewState"], "needs_independent_review")
            self.assertFalse(pair["sarvamDerived"])
            weights[pair["parentIndex"]] += Fraction(**pair["weight"])
        self.assertEqual(weights, [Fraction(1, 10)] * 10)
        contrasts = self.lineage["sameCandidateDifferentRequest"]
        self.assertEqual(len(contrasts), 2)
        self.assertEqual([len(c["oppositeLabels"]) for c in contrasts], [1, 1])
        self.assertTrue(all(c["oppositeLabels"][0]["labels"] == [1, 0] for c in contrasts))

    def test_source_only_prompt_and_refusal_before_publication(self):
        original = self.rows[0]
        before = self.focus(original["context"], "c0").messages()
        changed = copy.deepcopy(original)
        changed["output"] = {"technicalMutation": "untrusted target"}
        changed["supervision"] = {"technicalMutation": "untrusted teacher"}
        self.assertEqual(before, self.focus(changed["context"], "c0").messages())
        self.assertEqual(strict_json(before[1]["content"])["context"], original["context"])
        self.assertFalse(rank.metadata()["nativeExecutable"])
        self.assertFalse(rank.metadata()["nativeTokensVerified"])
        with self.assertRaises(InvalidEvidence):
            self.focus({**original["context"], "output": original["output"]}, "c0")
        with self.assertRaises(InvalidEvidence):
            self.focus(original["context"], "unknown")
        with self.assertRaises(InvalidEvidence):
            self.focus({**original["context"], "split": "development"}, "c0")
        mutations = []
        for kind in ("missing", "duplicate", "unknown", "drift", "nontrain"):
            rows = copy.deepcopy(self.rows)
            if kind == "missing":
                del rows[0]["output"]["selected"]
            elif kind == "nontrain":
                rows[0]["context"]["split"] = "development"
            else:
                rows[0]["output"]["selected"] = {"duplicate": ["c3", "c3"], "unknown": ["foreign"], "drift": []}[kind]
            mutations.append(b"".join(prepare.encoded(row) + b"\n" for row in rows))
        for bad in mutations:
            values = {**self.values, prepare.authority.DATA_NAME: bad}
            with self.subTest(digest=prepare.sha(bad)), patch.object(prepare, "load_inputs", return_value=(
                    self.assignment, self.assignment_raw, values)), patch.object(Path, "mkdir") as mkdir:
                with self.assertRaises(InvalidEvidence):
                    prepare.prepare(ASSIGNMENT, prepare.PRIVATE_PARENT / ("fragment-rank-cpu-v1-" + "0" * 32))
                mkdir.assert_not_called()

    def test_complete_score_vector_and_unchanged_projection(self):
        context = self.rows[0]["context"]
        vector = {"version": rank.SCORE_VERSION, "policySha256": rank.metadata()["policySha256"],
            "candidateSetSha256": prepare.sha(prepare.encoded(context)),
            "scores": [{"candidateId": c["id"], "margin": margin}
                for c, margin in zip(context["candidates"], [-1.0, 0.0, 0.25, 1e300], strict=True)]}
        result = self.project(vector)
        self.assertEqual(result["selection"]["selected"], ["c2", "c3"])
        self.assertEqual(result["projection"]["acceptedProjection"]["selected"], context["candidates"][2:])
        empty = copy.deepcopy(vector)
        for row in empty["scores"]:
            row["margin"] = 0.0
        self.assertEqual(self.project(empty)["projection"]["acceptedProjection"]["status"], "no_support_in_supplied_context")
        bads = []
        for scores in ([], vector["scores"][:-1], [vector["scores"][0]] * 4, list(reversed(vector["scores"]))):
            bads.append({**vector, "scores": scores})
        foreign = copy.deepcopy(vector); foreign["scores"][0]["candidateId"] = "foreign"; bads.append(foreign)
        bads.append({**vector, "candidateSetSha256": "0" * 64})
        bads.append({**vector, "policySha256": "0" * 64})
        for invalid in (float("nan"), float("inf"), True):
            bad = copy.deepcopy(vector); bad["scores"][0]["margin"] = invalid; bads.append(bad)
        for bad in bads:
            with self.assertRaises(InvalidEvidence):
                self.project(bad)

    def test_binary_loss_and_equal_parent_objective(self):
        correct = math.log1p(math.exp(-2))
        incorrect = 2 + correct
        for logits, label, expected in (((0, 2), 1, correct), ((0, 2), 0, incorrect),
                                        ((2, 0), 0, correct), ((2, 0), 1, incorrect)):
            self.assertAlmostEqual(rank.binary_loss(*logits, label), expected, places=14)
        self.assertEqual(rank.binary_loss(-1000, 1000, 1), 0.0)
        self.assertEqual(rank.binary_loss(-1000, 1000, 0), 2000.0)
        self.assertEqual(rank.binary_loss(1e300, -1e300, 0), 0.0)
        self.assertEqual(rank.binary_loss(1e300, -1e300, 1), 2e300)
        with self.assertRaises(InvalidEvidence):
            rank.binary_loss(0, float("nan"), 1)
        parents = [[(0, 0, 0)] * len(r["context"]["candidates"]) for r in self.rows]
        parents[0][0] = (0, 2, 0)
        expected = ((incorrect + 3 * math.log(2)) / 4 + 9 * math.log(2)) / 10
        self.assertAlmostEqual(rank.parent_mean_loss(parents), expected, places=14)
        with self.assertRaises(InvalidEvidence):
            rank.parent_mean_loss(parents[:-1])


if __name__ == "__main__":
    unittest.main(verbosity=2)
