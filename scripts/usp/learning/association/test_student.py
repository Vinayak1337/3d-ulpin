"""Critical citation/state/family and containment-role regressions; stdlib only."""
from __future__ import annotations

import argparse
import builtins
import copy
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import uuid

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "services/geo"), str(REPO / "scripts/usp/learning"), str(Path(__file__).resolve().parent)]
import model_isolation as isolation
import association_student
from geo.usp_learning.association.validation import InvalidEvidence, project_raw, validate_input, validate_output

DATA = Path(os.environ["ASSOCIATION_TEST_DATA"])
CONTRACT = json.loads((DATA / "schema-v1.json").read_bytes())
FREEZE = json.loads((DATA / "family-freeze.json").read_bytes())
EXAMPLES = json.loads((DATA / "development.json").read_bytes())["examples"]
EXPECTED = json.loads((DATA / "expectations.json").read_bytes())["examples"]


class StudentTests(unittest.TestCase):
    def test_real_native_literals_and_missing_states_validate(self):
        for example, expected in zip(EXAMPLES, EXPECTED):
            result = project_raw(json.dumps(expected["expected"]), example, CONTRACT, FREEZE, ("development",))
            self.assertTrue(result["modelOutputValid"])
            self.assertFalse(result["repairApplied"])
        states = {claim["state"] for claim in EXPECTED[1]["expected"]["claims"]}
        self.assertEqual(states, {"absent", "null"})

    def test_fabricated_citation_identifier_unit_and_state_abstain(self):
        for mutation in ("quote", "identifier", "unit", "state", "canonical", "duplicate_json"):
            with self.subTest(mutation=mutation):
                index = 1 if mutation == "state" else 0
                value = copy.deepcopy(EXPECTED[index]["expected"])
                if mutation == "quote":
                    value["claims"][0]["citations"][0]["quote"] = "not present in the source"
                elif mutation == "identifier":
                    value["claims"][-1]["literal"] = "invented-canonical-123"
                elif mutation == "unit":
                    value["claims"][0]["unit"] = "m"
                elif mutation == "state":
                    value["claims"][0]["state"] = "null"
                elif mutation == "canonical":
                    value["canonicalLinks"] = [{"id": "invented"}]
                raw = json.dumps(value)
                if mutation == "duplicate_json":
                    raw = raw.replace('"claims":', '"claims": [], "claims":', 1)
                result = project_raw(raw, EXAMPLES[index], CONTRACT, FREEZE)
                self.assertFalse(result["modelOutputValid"])
                self.assertEqual(result["acceptedProjection"]["claims"], [])
                self.assertFalse(result["repairApplied"])

    def test_family_and_closed_evaluation_cannot_enter_development(self):
        example = copy.deepcopy(EXAMPLES[0])
        example["evidence"][0]["familyId"] = "in-haryana-rera-2831"
        with self.assertRaisesRegex(InvalidEvidence, "source_family_mismatch"):
            validate_input(example, CONTRACT, FREEZE, ("development",))
        example = copy.deepcopy(EXAMPLES[0])
        example["familyId"] = "ogc-citygml2-building-examples"
        with self.assertRaisesRegex(InvalidEvidence, "source_family_split_refused"):
            validate_input(example, CONTRACT, FREEZE, ("development",))

    def test_marked_input_conflict_cannot_be_omitted(self):
        example = copy.deepcopy(EXAMPLES[0])
        for fragment in example["evidence"][:2]:
            fragment["locator"]["conflictGroup"] = "synthetic-negative-control"
        with self.assertRaisesRegex(InvalidEvidence, "input_conflict_omitted"):
            validate_output(EXPECTED[0]["expected"], example, CONTRACT, FREEZE)

    def test_direct_host_student_refuses_before_dependencies_or_output(self):
        imports = []
        original = builtins.__import__
        def checked(name, *args, **kwargs):
            if name.split(".")[0] in ("torch", "transformers", "peft", "psutil"):
                imports.append(name)
                raise AssertionError("dependency imported before native boundary")
            return original(name, *args, **kwargs)
        with patch.object(builtins, "__import__", checked):
            with self.assertRaisesRegex(RuntimeError, "uncontained role refused"):
                association_student.worker(argparse.Namespace())
        self.assertEqual(imports, [])

    def test_new_role_resolves_only_fixed_nested_path_and_inputs(self):
        root = isolation.ASSOCIATION_STAGING_PARENT / ("role-control-" + uuid.uuid4().hex)
        (root / "inputs").mkdir(parents=True)
        role = "code/scripts/usp/learning/association/association_student.py"
        profile = {"files": {role: "technical-only"}}
        profile_path = root / "profile.json"
        digest = "0" * 64
        command = [sys.executable, "association_student.py", "run"]
        for key in ("input-batch", "schema", "family-freeze", "model-receipt", "run-freeze"):
            path = root / "inputs" / (key + ".json")
            path.write_text("{}", encoding="utf-8")
            command.extend(["--" + key, str(path)])
        command.extend(["--output-dir", str(root / "outputs/baseline"), "--containment-profile", str(profile_path),
                        "--containment-sha256", digest])
        script, _ = isolation.checked_command(root, profile, command, profile_path, digest)
        self.assertEqual(script, root / role)
        with self.assertRaisesRegex(RuntimeError, "only run"):
            isolation.checked_command(root, profile, command[:2] + ["prepare"] + command[3:], profile_path, digest)
        bad = command.copy()
        bad[bad.index("--schema") + 1] = str(root / "model/model.json")
        with self.assertRaisesRegex(RuntimeError, "pinned input file"):
            isolation.checked_command(root, profile, bad, profile_path, digest)
        historical = command.copy()
        historical[1] = "compare_reranker.py"
        with self.assertRaisesRegex(RuntimeError, "role staging scope mismatch"):
            isolation.checked_command(root, profile, historical, profile_path, digest)


if __name__ == "__main__":
    unittest.main()
