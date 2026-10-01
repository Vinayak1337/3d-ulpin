"""Focused integrity/bounds regressions and unchanged published-source inspection.

Set NATIVE_IFC_TEST_SOURCES to the private retained originals directory. Corruptions
are isolated test copies only, never operational sources or qualification labels.
All native parsing uses the externally supervised local reader.
"""
from __future__ import annotations

from dataclasses import replace
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/"services/geo"))
from geo.native_ifc import DEFAULT_LIMITS, IFCError, lexical_index

spec = importlib.util.spec_from_file_location("ifc_cli", ROOT/"scripts/usp/desktop-ifc-read.py")
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)
SOURCES = Path(os.environ["NATIVE_IFC_TEST_SOURCES"]) if "NATIVE_IFC_TEST_SOURCES" in os.environ else None


@unittest.skipUnless(SOURCES, "Retained published IFC originals not configured")
class NativeIFCTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = (SOURCES/"ifc4-building-architecture.ifc").read_bytes()

    def read_copy(self, raw, limits=DEFAULT_LIMITS):
        with tempfile.TemporaryDirectory(prefix="ifc-regression-") as directory:
            source, output = Path(directory)/"input.ifc", Path(directory)/"output.json"
            source.write_bytes(raw)
            try:
                receipt = cli.read_file(source, output, limits)
                return json.loads(output.read_bytes()), receipt
            finally:
                self.assertEqual(source.read_bytes(), raw)

    def assert_code(self, raw, code, limits=DEFAULT_LIMITS):
        with self.assertRaises(IFCError) as caught:
            self.read_copy(raw, limits)
        self.assertEqual(caught.exception.code, code)

    def mutate_attribute(self, ident, attribute_index, literal):
        index = lexical_index(self.raw, DEFAULT_LIMITS)
        start, end = index[ident]["attributes"][attribute_index]
        return self.raw[:start]+literal+self.raw[end:]

    def test_published_ifc2x3_and_ifc4_exact_projection(self):
        for schema in ("ifc2x3", "ifc4"):
            with self.subTest(schema=schema):
                original = (SOURCES/f"{schema}-building-architecture.ifc").read_bytes()
                result, receipt = self.read_copy(original)
                self.assertEqual(result["source"]["sha256"], hashlib.sha256(original).hexdigest())
                records = result["records"]
                by_type = lambda name: [r for r in records if r["entityType"] == name]
                self.assertEqual(len(by_type("IfcBuilding")), 1)
                self.assertEqual(len(by_type("IfcBuildingStorey")), 1)
                self.assertEqual({r["attributes"]["Name"]["value"] for r in by_type("IfcSpace")}, {"living room", "entry hall"})
                storey = by_type("IfcBuildingStorey")[0]
                self.assertEqual(storey["attributes"]["Elevation"]["value"], 0)
                self.assertEqual(by_type("IfcBuilding")[0]["attributes"]["Elevation"]["state"], "absent")
                self.assertEqual(by_type("IfcBuilding")[0]["attributes"]["ElevationOfRefHeight"]["state"], "null")
                self.assertTrue(by_type("IfcLocalPlacement"))
                self.assertTrue(by_type("IfcRelAggregates"))
                self.assertTrue(by_type("IfcRelContainedInSpatialStructure"))
                unit = next(r for r in by_type("IfcSIUnit") if r["attributes"]["UnitType"]["value"] == "LENGTHUNIT")
                self.assertEqual(unit["attributes"]["Prefix"]["value"], "MILLI")
                self.assertEqual(unit["attributes"]["Name"]["value"], "METRE")
                self.assertEqual(unit["attributes"]["Dimensions"]["state"], "unsupported")
                for record in records:
                    for field in record["attributes"].values():
                        if field["rawLiteral"] is not None:
                            loc = field["locator"]
                            self.assertEqual(field["rawLiteral"].encode("latin-1"), original[loc["byteStart"]:loc["byteEnd"]])
                self.assertFalse(result["semantics"]["unitConversionApplied"])
                self.assertFalse(result["georeference"]["globalTransformApplied"])
                if schema == "ifc2x3":
                    self.assertEqual(result["georeference"]["state"], "missing_or_unqualified")
                    self.assertFalse(result["georeference"]["mapConversionStepIds"])
                else:
                    self.assertEqual(result["georeference"]["state"], "supplied_unqualified")
                    self.assertEqual(by_type("IfcProjectedCRS")[0]["attributes"]["Name"]["value"], "EPSG:32760")
                self.assertTrue(receipt["execution"]["gatedStart"])
                self.assertEqual(receipt["execution"]["processingCpuLimit"], 2)

    def test_duplicate_ids_and_dangling_references(self):
        with self.assertRaises(IFCError) as caught:
            lexical_index(self.raw.replace(b"#35=IFCBUILDING", b"#13=IFCBUILDING", 1), DEFAULT_LIMITS)
        self.assertEqual(caught.exception.code, "DUPLICATE_STEP_ID")
        self.assert_code(self.mutate_attribute(35, 5, b"#99999999"), "DANGLING_REFERENCE")

    def test_duplicate_identity_wrong_reference_type_and_cycle(self):
        self.assert_code(self.mutate_attribute(35, 0, b"'2Ndyd$OSX7s9A04nc4lyye'"), "DUPLICATE_GLOBAL_ID")
        self.assert_code(self.mutate_attribute(35, 5, b"#35"), "ATTRIBUTE_TYPE")
        self.assert_code(self.mutate_attribute(40, 0, b"#40"), "CYCLE")

    def test_unsupported_schema_and_comments_preserve_null(self):
        self.assert_code(self.raw.replace(b"FILE_SCHEMA(('IFC4'))", b"FILE_SCHEMA(('IFC5'))"), "SCHEMA")
        result, _ = self.read_copy(self.mutate_attribute(35, 10, b"/* source comment */ $"))
        building = next(r for r in result["records"] if r["stepId"] == 35)
        self.assertEqual(building["attributes"]["ElevationOfRefHeight"]["state"], "null")

    def test_input_entity_record_and_output_bounds(self):
        for field, bound, code in (("input_bytes", 32, "INPUT_LIMIT"), ("entities", 2, "ENTITY_LIMIT"),
                                   ("records", 2, "RECORD_LIMIT"), ("output_bytes", 1024, "OUTPUT_LIMIT")):
            with self.subTest(bound=field):
                self.assert_code(self.raw, code, replace(DEFAULT_LIMITS, **{field: bound}))

    def test_timeout_and_no_overwrite(self):
        self.assert_code(self.raw, "TIME_LIMIT", replace(DEFAULT_LIMITS, seconds=0.001))
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory)/"input.ifc", Path(directory)/"output.json"
            source.write_bytes(self.raw)
            output.write_bytes(b"prior result")
            for target in (source, output):
                with self.assertRaises(IFCError) as caught:
                    cli.read_file(source, target)
                self.assertEqual(caught.exception.code, "OUTPUT_EXISTS")
            self.assertEqual(output.read_bytes(), b"prior result")
            self.assertEqual(source.read_bytes(), self.raw)

    @unittest.skipUnless(os.name == "nt", "Windows native memory ceiling regression")
    def test_lowered_native_memory_ceiling_never_publishes(self):
        with self.assertRaises(IFCError):
            self.read_copy(self.raw, replace(DEFAULT_LIMITS, memory_bytes=16*1024**2))

    @unittest.skipUnless(os.name == "nt", "Windows Job attachment regression")
    def test_attachment_failure_never_releases_worker(self):
        import psutil
        pid = None

        class RefusedJob:
            def __init__(self, process, limits):
                nonlocal pid
                pid = process.pid
                raise OSError("test attachment rejected")

        with tempfile.TemporaryDirectory() as directory:
            source, result = Path(directory)/"input.ifc", Path(directory)/"result.json"
            source.write_bytes(self.raw)
            with patch.object(cli, "WindowsJob", RefusedJob), self.assertRaises(OSError):
                cli.supervise(source, result)
            self.assertFalse(result.exists())
        self.assertFalse(psutil.pid_exists(pid))


if __name__ == "__main__":
    unittest.main()
