"""Targeted source-integrity/default/budget regressions on unchanged upstream files.

DXF_NATIVE_SOURCE_DIR points to the two retained v1.4.3 samples; no authored
property facts or edited drawings are used as fixtures. These checks prevent
parser defaults being mistaken for declarations and unbounded publication.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "services/geo"))
from geo import native_dxf as dxf

HASHES = {"1_polylines.dxf": "37f57491672a9b330be08888200a8ad893d15af52af91e1c6be54b0c9cda75de",
          "ASCII_R12.dxf": "b476d3e53fe24c1db3c701d20b2bebd774f7bd7966b12d81891505b9b29e4d21"}


class NativeDXFTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = os.environ.get("DXF_NATIVE_SOURCE_DIR")
        if not source or not importlib.util.find_spec("ezdxf"):
            raise unittest.SkipTest("Supply retained DXF samples and the pinned isolated environment.")
        cls.source = Path(source)
        cls.raw = {name: (cls.source / name).read_bytes() for name in HASHES}
        for name, raw in cls.raw.items():
            if hashlib.sha256(raw).hexdigest() != HASHES[name]:
                raise ValueError("Retained source SHA differs: " + name)
        cls.temp = tempfile.TemporaryDirectory(prefix="dxf-tests-", dir=cls.source.parent / "runs")
        cls.scratch = Path(cls.temp.name)
        (cls.scratch / "ezdxf").mkdir()
        (cls.scratch / "ezdxf/font_manager_cache.json").write_text('{"version":2,"font-faces":[]}', encoding="utf-8")
        cls.env = patch.dict(os.environ, {"XDG_CONFIG_HOME": str(cls.scratch), "XDG_CACHE_HOME": str(cls.scratch),
                                         "OMP_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2", "MKL_NUM_THREADS": "2"})
        cls.env.start()

    @classmethod
    def tearDownClass(cls):
        cls.env.stop()
        cls.temp.cleanup()
        for name in HASHES:
            assert hashlib.sha256((cls.source / name).read_bytes()).hexdigest() == HASHES[name]

    def test_supervised_declared_primitives_and_exact_locators(self):
        raw = self.raw["1_polylines.dxf"]
        result = dxf.inspect_dxf(raw, temporary_parent=self.scratch)
        self.assertEqual(result["projectedEntityCountIncludingChildren"], 83)
        self.assertEqual(result["units"]["code"], 6)
        self.assertEqual(result["units"]["state"], "declared")
        self.assertEqual(result["supervision"]["memoryLimitBytes"], 2 * 1024**3)
        self.assertFalse(result["qualification"]["analyticEligible"])
        lines = raw.decode(result["encoding"]["name"]).splitlines()
        for record in result["entities"] + result["layers"] + result["blocks"]:
            for tag in record["sourceTags"]:
                self.assertEqual(int(lines[tag["tagIndex"] * 2]), tag["code"])
                self.assertEqual(lines[tag["tagIndex"] * 2 + 1], tag["rawValue"])
            for field in record["fields"].values():
                for tag in field["tags"]:
                    self.assertEqual(lines[tag["locator"]["valueLine"] - 1], tag["rawValue"])
        self.assertEqual({e["type"] for e in result["entities"]}, {"LINE", "ARC", "TEXT"})

    def test_absent_units_and_insert_defaults_remain_absent(self):
        result = dxf.inspect_dxf(self.raw["ASCII_R12.dxf"], temporary_parent=self.scratch)
        self.assertEqual(result["units"]["state"], "absent")
        self.assertIsNone(result["units"]["code"])
        self.assertNotIn("$INSUNITS", result["headerVariables"])
        insert = next(e for e in result["entities"] if e["type"] == "INSERT")
        self.assertEqual(insert["fields"]["scaleX"]["state"], "absent")
        self.assertEqual(insert["fields"]["rotationDegrees"]["state"], "absent")
        self.assertEqual(insert["fields"]["blockName"]["tags"][0]["value"], "*U1")
        self.assertTrue(any(f["type"] == "INSERT" for f in result["unsupportedFindings"]))
        self.assertTrue(result["opaqueRecordTypes"])
        self.assertEqual(result["projectedEntityCountIncludingChildren"], 4)

    def test_budgets_stop_unchanged_inputs(self):
        # Lower configured ceilings; preserve every source byte and value.
        raw = self.raw["1_polylines.dxf"]
        for name, value, code in (("MAX_INPUT_BYTES", 8, "INPUT_LIMIT"),
                                  ("MAX_ENTITIES", 2, "ENTITY_LIMIT"),
                                  ("MAX_POINTS", 1, "POINT_LIMIT"),
                                  ("MAX_OUTPUT_BYTES", 100, "OUTPUT_LIMIT")):
            with self.subTest(name=name), patch.object(dxf, name, value):
                with self.assertRaises(dxf.DXFError) as found:
                    dxf.read_dxf(raw)
                self.assertEqual(found.exception.code, code)

    def test_supervisor_timeout_stops_its_child(self):
        with patch.object(dxf, "MAX_SECONDS", 0.001):
            with self.assertRaises(dxf.DXFError) as found:
                dxf.inspect_dxf(self.raw["ASCII_R12.dxf"], temporary_parent=self.scratch)
        self.assertEqual(found.exception.code, "TIME_LIMIT")

    def test_wrong_original_pin_and_existing_output_are_refused(self):
        cli = ROOT / "scripts/usp/desktop-dxf-read.py"
        target = self.scratch / "not-published"
        command = [sys.executable, str(cli), str(self.source / "ASCII_R12.dxf"),
                   "--output-dir", str(target), "--expected-sha256", "0" * 64]
        failed = subprocess.run(command, capture_output=True, timeout=10)
        self.assertEqual(failed.returncode, 2)
        self.assertFalse(target.exists())
        target.mkdir()
        marker = target / "preserved.txt"
        marker.write_text("owned-existing-output", encoding="utf-8")
        command[-1] = HASHES["ASCII_R12.dxf"]
        failed = subprocess.run(command, capture_output=True, timeout=10)
        self.assertEqual(failed.returncode, 2)
        self.assertEqual(marker.read_text(), "owned-existing-output")


if __name__ == "__main__":
    unittest.main()
