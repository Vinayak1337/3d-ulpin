"""Focused training split/target isolation and unchanged-generation checks."""
import ast
import copy
import json
from pathlib import Path
import sys
import unittest

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(Path(__file__).resolve().parent), str(REPO / "services/geo")]
import training_diagnostic as diagnostic
from geo.usp_learning.association import student, training_generation
from geo.usp_learning.association.validation import InvalidEvidence


class DiagnosticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.assignment = diagnostic.isolation.read(diagnostic.ASSIGNMENT)
        cls.fit = Path(cls.assignment["acceptedFitRoot"])
        cls.contract = diagnostic.isolation.read(cls.fit / "inputs/schema-v1.json")
        cls.family = diagnostic.isolation.read(cls.fit / "inputs/family-freeze.json")
        cls.batch, cls.targets = diagnostic.selected_records(cls.assignment, cls.contract, cls.family)

    def test_real_inputs_keep_targets_out_of_batch_and_prompt(self):
        self.assertEqual(set(self.batch), {"version", "split", "examples"})
        self.assertEqual(sum(len(t["output"]["claims"]) for t in self.targets), 7)
        self.assertIn("13rd", self.batch["examples"][0]["evidence"][1]["text"])
        for example in self.batch["examples"]:
            messages = student.prompt_messages(example)
            self.assertEqual([m["role"] for m in messages], ["system", "user"])
            self.assertEqual(json.loads(messages[1]["content"]),
                {"evidence": [{"key": e["key"], "text": e["text"]} for e in example["evidence"]]})
        for key in ("output", "expectations", "supervision"):
            bad = copy.deepcopy(self.batch)
            bad[key] = self.targets[0]["output"]
            with self.assertRaises(InvalidEvidence):
                training_generation.checked_batch(bad, self.assignment, self.contract, self.family)

    def test_wrong_split_order_or_input_bytes_refused(self):
        for split in ("development", "evaluation"):
            family = copy.deepcopy(self.family)
            for row in family["families"]:
                if row["familyId"] == self.batch["examples"][0]["familyId"]:
                    row["split"] = split
            with self.assertRaisesRegex(InvalidEvidence, "source_family_split_refused"):
                training_generation.checked_batch(self.batch, self.assignment, self.contract, family)
        for change in ("order", "text", "example_target"):
            batch = copy.deepcopy(self.batch)
            if change == "order":
                batch["examples"].reverse()
            elif change == "text":
                batch["examples"][0]["evidence"][0]["text"] += " changed"
            else:
                batch["examples"][0]["target"] = self.targets[0]["output"]
            with self.assertRaises(InvalidEvidence):
                training_generation.checked_batch(batch, self.assignment, self.contract, self.family)

    def test_generation_and_protected_sources_match_accepted_run(self):
        original_path = self.fit / "code/services/geo/geo/usp_learning/association/student.py"
        source = original_path.read_text()
        self.assertEqual(source, (REPO / "services/geo/geo/usp_learning/association/student.py").read_text())
        def loop(text, function):
            body = next(n for n in ast.parse(text).body if isinstance(n, ast.FunctionDef) and n.name == function)
            loops = [n for n in body.body if isinstance(n, ast.For)]
            return loops[-1]
        expected, actual = loop(source, "run_local"), loop(Path(training_generation.__file__).read_text(), "run_training")
        # The only generation-loop change is true train membership for projection.
        for node in ast.walk(expected):
            if isinstance(node, ast.Constant) and node.value == "development":
                node.value = "train"
        self.assertEqual(ast.dump(actual), ast.dump(expected))
        profile = diagnostic.isolation.read(self.fit / "profile.json")
        for relative in ("scripts/usp/learning/model_isolation.py", "scripts/usp/security/appcontainer_audit.py",
                         "services/geo/geo/usp_learning/resources.py"):
            self.assertEqual(diagnostic.isolation.sha(REPO / relative), profile["files"]["code/" + relative])


if __name__ == "__main__":
    unittest.main()
