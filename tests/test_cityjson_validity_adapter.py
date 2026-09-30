"""Diagnostic controls only: no authored property geometry or qualification receipts."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("cityjson_validity", REPO / "scripts/usp/cityjson-validity/validate.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def schema_report():
    return {"type": "cjval_report", "cjval_version": "0.10.0", "valid": True, "has_warnings": False,
            "checks": {"errors": {key: {"valid": True, "errors": []} for key in adapter.CHECKS},
                       "warnings": {key: {"valid": True, "errors": []} for key in
                                    ["extra_root_properties", "duplicate_vertices", "unused_vertices"]}}}


class AdapterRegression(unittest.TestCase):
    def test_incomplete_or_contradictory_schema_report_cannot_pass(self):
        for report in [[], {"valid": True}, schema_report()]:
            if isinstance(report, dict) and "checks" in report:
                report["checks"]["errors"]["schema"] = {"valid": False, "errors": ["control diagnostic"]}
            with self.assertRaises(adapter.Refused):
                adapter.cjval_result(report, "0.10.0")
        report = schema_report()
        report["valid"] = False
        report["checks"]["errors"]["schema"] = {"valid": False, "errors": ["control diagnostic"]}
        self.assertEqual(adapter.cjval_result(report, "0.10.0")["state"], "invalid")

    def test_incomplete_solid_report_cannot_pass(self):
        report = {"type": "val3dity_report", "val3dity_version": "2.7.0", "input_file_type": "CityJSON",
                  "validity": True, "parameters": adapter.PARAMETERS.copy(), "features": [],
                  "primitives_overview": [{"type": "Solid", "total": 1, "valid": 1}],
                  "all_errors": [], "dataset_errors": []}
        with self.assertRaises(adapter.Refused):
            adapter.val3dity_result(report, "2.7.0", [{"type": "Solid"}])
        report["parameters"]["snap_tol"] = 0.0
        with self.assertRaises(adapter.Refused):
            adapter.val3dity_result(report, "2.7.0", [{"type": "Solid"}])

    def test_tool_hash_mismatch_refuses_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "tool.exe").write_bytes(b"control, never executable")
            with self.assertRaises(adapter.Refused):
                adapter.verify_tool(root, {"files": [{"path": "tool.exe", "sha256": "0" * 64, "executable": True}]})

    def test_timeout_is_not_completed(self):
        with tempfile.TemporaryDirectory() as directory:
            result = adapter.run_process([sys.executable, "-c", "import time; time.sleep(10)"],
                                         Path(directory), "timeout-control", time.monotonic() + 0.15)
            self.assertEqual(result["execution"], "timeout")
            self.assertNotEqual(result["exitCode"], 0)

    def test_source_hash_mismatch_preserves_original_and_creates_no_derivative(self):
        source = REPO / "fixtures/usp/D1/single-roof/original.json"
        before = source.read_bytes()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = adapter.validate(source, "0" * 64, root, root / "run", [("unused", 0)], 1)
            self.assertEqual(result["state"], "error")
            self.assertEqual(result["commands"], [])
            self.assertFalse((root / "run/document.city.json").exists())
        self.assertEqual(source.read_bytes(), before)

    def test_identity_tolerance_cannot_merge_distinct_source_grid_points(self):
        source = json.loads((REPO / "fixtures/usp/D1/single-roof/original.json").read_bytes())
        document, _, _ = adapter.derivatives(source, [("NL.IMBAG.Pand.1655100000500568", 0)])
        self.assertTrue(adapter.exact_identity_gate(document)["distinctSourceGridPointsCannotCoalesce"])
        unsafe = copy.deepcopy(document)
        unsafe["transform"]["scale"] = [1e-15] * 3  # In-memory unsupported-reference control.
        with self.assertRaises(adapter.Refused):
            adapter.exact_identity_gate(unsafe)


if __name__ == "__main__":
    unittest.main()
