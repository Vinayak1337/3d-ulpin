"""Focused integrity/bounds regressions and unchanged published-source inspection.

Set NATIVE_IFC_TEST_SOURCES to the private retained originals directory. Corruptions
are isolated test copies only, never operational sources or qualification labels.
Source integration reads use the externally supervised local reader; outline pass
fault injection uses small, bounded in-process reads.
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
import time
import tracemalloc
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/"services/geo"))
from geo.native_ifc import (DEFAULT_LIMITS, IFCError, encode_result, extract, lexical_index,
                            outline_polygons, scan_structure, storey_outlines, structure_or_reason)

spec = importlib.util.spec_from_file_location("ifc_cli", ROOT/"scripts/usp/desktop-ifc-read.py")
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)
FIXTURES = ROOT/"services/geo/tests/fixtures"
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
                outlines = result["storeyOutlines"]
                self.assertEqual((outlines["state"], outlines["frame"]), ("read", "source_local"))
                self.assertEqual(outlines["lengthUnit"]["prefix"], "MILLI")
                points = outlines["storeys"][0]["polygons"][0]["exterior"]
                self.assertEqual((max(p[0] for p in points), max(p[1] for p in points)), (8400, 8800))
                self.assertFalse(outlines["globalTransformApplied"])
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


class OneByteStream:
    """Returns one byte per read, so every statement, string and comment crosses a read boundary."""
    def __init__(self, raw):
        self.raw, self.pos = raw, 0

    def read(self, _size):
        self.pos += 1
        return self.raw[self.pos-1:self.pos]


class StructureScanTests(unittest.TestCase):
    """Pass 1 on hand-written test-only fixtures; no parser, geometry kernel or source record."""
    def scan(self, schema, limits=DEFAULT_LIMITS):
        raw = (FIXTURES/f"ifc1-structure-{schema}.ifc").read_bytes()
        return raw, structure_or_reason(raw, limits)

    def test_ifc4_tree_with_step_locators_and_stated_values(self):
        raw, structure = self.scan("ifc4")
        self.assertEqual(structure["state"], "read")
        self.assertEqual(structure["lengthUnit"], {"state": "supplied", "stepId": 3, "entityType": "IfcSIUnit",
                                                   "prefix": "MILLI", "name": "METRE"})
        nodes = {node["stepId"]: node for node in structure["nodes"]}
        self.assertEqual(sorted(nodes), [1, 5, 6, 7, 8, 9, 10, 11])
        self.assertEqual([nodes[k]["candidate"] for k in (1, 5, 6, 7, 8, 9)],
                         [None, None, "building", "level", "level", "space"])
        self.assertEqual((nodes[6]["name"], nodes[6]["longName"]), ("Test building", "Building 'A'"))
        self.assertEqual({k: nodes[k]["parentStepIds"] for k in (6, 7, 8, 9, 10, 11)},
                         {6: [5], 7: [6], 8: [6], 9: [7], 10: [7], 11: [8]})
        self.assertEqual(nodes[11]["relationStepIds"], [16])
        self.assertEqual((nodes[9]["longName"], nodes[11]["longName"]), ("Café", "Room; with semicolon"))
        self.assertEqual(nodes[9]["globalId"], "0Kq2fRvcL1xBtS0Gx3Zs06")
        self.assertEqual(nodes[7]["elevation"], {"state": "supplied", "value": 0.0, "literal": "0."})
        self.assertEqual(nodes[8]["elevation"], {"state": "absent"})
        self.assertNotIn("elevation", nodes[6])
        self.assertEqual(scan_structure(OneByteStream(raw)), structure)

    def test_ifc2x3_reads_the_same_way(self):
        _, structure = self.scan("ifc2x3")
        self.assertEqual(structure["lengthUnit"], {"state": "supplied", "stepId": 3,
                                                   "entityType": "IfcConversionBasedUnit", "prefix": None,
                                                   "name": "FOOT"})
        nodes = {node["stepId"]: node for node in structure["nodes"]}
        self.assertEqual([node["candidate"] for node in structure["nodes"]],
                         [None, "building", "level", "level", "space", "space", "space"])
        self.assertEqual(nodes[8]["elevation"], {"state": "supplied", "value": -1.5, "literal": "-1.5E0"})
        self.assertEqual(nodes[9]["elevation"], {"state": "absent"})
        self.assertEqual((nodes[12]["parentStepIds"], nodes[12]["relationStepIds"]), ([9], [16]))

    def test_ceilings_keep_the_file_and_say_why(self):
        for field, bound, code in (("structure_entities", 3, "STRUCTURE_ENTITY_LIMIT"),
                                   ("structure_bytes", 512, "STRUCTURE_INPUT_LIMIT"),
                                   ("structure_output_bytes", 256, "STRUCTURE_OUTPUT_LIMIT")):
            with self.subTest(ceiling=field):
                _, structure = self.scan("ifc4", replace(DEFAULT_LIMITS, **{field: bound}))
                self.assertEqual((structure["state"], structure["code"]), ("not_read", code))
                self.assertTrue(structure["reason"])

    def test_malformed_or_truncated_statement_is_not_read(self):
        raw = (FIXTURES/"ifc1-structure-ifc4.ifc").read_bytes()
        short = raw.replace(b"'Ground',$,$,$,$,$,.ELEMENT.,0.)", b"'Ground')")
        self.assertEqual(structure_or_reason(short, DEFAULT_LIMITS)["code"], "STRUCTURE_SYNTAX")
        self.assertEqual(structure_or_reason(raw[:raw.index(b"#9=") + 12], DEFAULT_LIMITS)["code"], "STRUCTURE_SYNTAX")


class StoreyOutlineTests(unittest.TestCase):
    def test_fixtures_keep_every_prior_byte_apart_from_added_limits_key_and_message(self):
        hashes = {"ifc2x3": "312c74737971ba76412232cd1136775b0619c1e29f13cf783fb8df854c7d06ad",
                  "ifc4": "546b8a6a5a11cf00ecaf00460a4f68e9f68caae616f5115299a234e2903b5844"}
        for schema, expected in hashes.items():
            raw = (FIXTURES/f"ifc1-structure-{schema}.ifc").read_bytes()
            result = extract(raw)
            self.assertEqual(result["structure"], structure_or_reason(raw, DEFAULT_LIMITS))
            self.assertEqual(result.pop("storeyOutlines")["state"], "not_read")
            for key in list(result["limits"]):
                if key.startswith("outline_"):
                    del result["limits"][key]
            result["findings"][0]["message"] = ("Representation references and type inventory retained; "
                                                 "no geometry, tessellation or measurement is produced.")
            self.assertEqual(hashlib.sha256(encode_result(result)).hexdigest(), expected)

    def test_holes_and_disconnected_polygons_keep_closed_rings(self):
        from shapely.geometry import MultiPolygon, Polygon
        outer = [(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)]
        hole = [(2, 2), (3, 2), (3, 3), (2, 3), (2, 2)]
        # Test-only geometry exercises ring encoding, never an operational outline.
        polygons = outline_polygons(MultiPolygon([Polygon(outer, [hole]),
                                                  Polygon([(20, 0), (21, 0), (21, 1), (20, 0)])]), 2)
        self.assertEqual(len(polygons), 2)
        self.assertEqual({tuple(p) for p in polygons[0]["interiors"][0]}, set(hole))
        for polygon in polygons:
            for ring in [polygon["exterior"], *polygon["interiors"]]:
                self.assertEqual(ring[0], ring[-1])
                self.assertGreaterEqual(len(ring), 4)

    def test_no_structure_never_starts_geometry_and_bounds_only_reduce(self):
        with patch("ifcopenshell.geom.create_shape", side_effect=AssertionError("must not mesh")):
            self.assertEqual(storey_outlines(None, {"state": "not_read"}, DEFAULT_LIMITS)["code"],
                             "OUTLINE_STRUCTURE_NOT_READ")
        for field in ("outline_elements", "outline_vertices", "outline_output_bytes", "outline_seconds"):
            for value in (0, getattr(DEFAULT_LIMITS, field) * 2):
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    replace(DEFAULT_LIMITS, **{field: value})


def apartment_ifc(tmp_path: Path, storeys: int = 20, per_storey: int = 50) -> Path:
    """test_only procedural load fixture, never a source record; bytes exist only in the temporary directory."""
    import numpy as np
    from ifcopenshell.api import aggregate, context, geometry, project, root, spatial, unit
    model = project.create_file(version="IFC4")
    building_project = root.create_entity(model, ifc_class="IfcProject", name="test_only apartment load")
    unit.assign_unit(model, length={"is_metric": True, "raw": "METERS"})
    parent = context.add_context(model, context_type="Model")
    body = context.add_context(model, context_type="Model", context_identifier="Body",
                               target_view="MODEL_VIEW", parent=parent)
    building = root.create_entity(model, ifc_class="IfcBuilding", name="test_only")
    aggregate.assign_object(model, products=[building], relating_object=building_project)
    levels = [root.create_entity(model, ifc_class="IfcBuildingStorey", name=f"test_only {i}")
              for i in range(storeys + 1)]
    aggregate.assign_object(model, products=levels, relating_object=building)
    for i, level in enumerate(levels):
        elements = []
        spaces = i == storeys
        for j in range(50 if spaces else per_storey):
            element = root.create_entity(model, ifc_class="IfcSpace" if spaces else "IfcSlab", name="test_only")
            representation = geometry.add_slab_representation(
                model, context=body, depth=3.0 if spaces else 0.2,
                polyline=[(0.0, 0.0), (8.0, 0.0), (8.0, 6.0), (0.0, 6.0), (0.0, 0.0)])
            geometry.assign_representation(model, product=element, representation=representation)
            matrix = np.eye(4)
            matrix[:3, 3] = ((j % 10) * 8, (j // 10) * 6, i * 3)
            geometry.edit_object_placement(model, product=element, matrix=matrix)
            elements.append(element)
        if spaces:
            aggregate.assign_object(model, products=elements, relating_object=level)
        else:
            spatial.assign_container(model, products=elements, relating_structure=level)
    path = tmp_path/"test_only-apartment.ifc"
    model.write(str(path))
    return path


def measure_outline_pass(model, structure: dict) -> tuple[dict, dict]:
    import ifcopenshell.geom
    counts = []
    create_shape = ifcopenshell.geom.create_shape

    def mesh(settings, element):
        shape = create_shape(settings, element)
        counts.append(len(shape.geometry.faces))
        return shape

    started = time.perf_counter()
    with patch("ifcopenshell.geom.create_shape", mesh):
        outlines = storey_outlines(model, structure, DEFAULT_LIMITS)
    seconds = time.perf_counter() - started
    tracemalloc.start()
    traced = storey_outlines(model, structure, DEFAULT_LIMITS)
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return outlines, {"elements": len(counts), "triangleVertices": sum(counts),
                      "outlineSeconds": seconds, "outlineTracemallocPeak": peak,
                      "tracedOutlineState": traced["state"],
                      "outlineBytes": len(json.dumps(outlines, separators=(",", ":")))}


def measure_full_extract(raw: bytes) -> dict:
    import psutil
    with patch("geo.native_ifc.storey_outlines", return_value={"state": "not_read",
               "code": "TEST_ONLY_METADATA_BASELINE", "reason": "test_only budget measurement"}):
        started = time.perf_counter()
        baseline = extract(raw)
        metadata_seconds = time.perf_counter() - started
        tracemalloc.start()
        extract(raw)
        _, metadata_peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
    started = time.perf_counter()
    result = extract(raw)
    seconds = time.perf_counter() - started
    memory = psutil.Process().memory_info()
    return {"metadataBytes": len(encode_result(baseline)), "metadataSeconds": metadata_seconds,
            "metadataTracemallocPeak": metadata_peak, "fullExtractSeconds": seconds,
            "fullExtractOutlineState": result["storeyOutlines"]["state"], "artifactBytes": len(encode_result(result)),
            "processPeakBytes": getattr(memory, "peak_pagefile", memory.rss)}


class ApartmentOutlineTests(unittest.TestCase):
    def test_apartment_scale_outlines_and_budget_measurement(self):
        import ifcopenshell
        per_storey = int(os.environ.get("NATIVE_IFC_TEST_SLABS_PER_STOREY", "50"))
        with tempfile.TemporaryDirectory(prefix="ifc-test-only-apartment-") as directory:
            path = apartment_ifc(Path(directory), per_storey=per_storey)
            raw = path.read_bytes()
            model = ifcopenshell.open(str(path))
            outlines, metrics = measure_outline_pass(model, structure_or_reason(raw, DEFAULT_LIMITS))
            metrics.update(measure_full_extract(raw))
            metrics.update({"entities": len(list(model)), "sourceBytes": len(raw)})
            print("IFC_OUTLINE_BENCHMARK " + json.dumps(metrics, sort_keys=True))
            self.assertEqual(outlines["state"], "read", outlines)
            self.assertEqual(metrics["tracedOutlineState"], "read")
            self.assertEqual(metrics["fullExtractOutlineState"], "read")
            self.assertEqual(len(outlines["storeys"]), 21)
            self.assertEqual([s["elementSource"] for s in outlines["storeys"]], ["IfcSlab"] * 20 + ["IfcSpace"])
            self.assertEqual(sum(len(s["elementStepIds"]) for s in outlines["storeys"]), 20 * per_storey + 50)
            self.assertEqual(metrics["triangleVertices"], (20 * per_storey + 50) * 36)
            self.assertLessEqual(metrics["artifactBytes"], DEFAULT_LIMITS.output_bytes)
            self.assertEqual(path.read_bytes(), raw)


HAUS = Path("E:/BhuAayam-data/task-data/paired-building-floor-sources-20261004-run01/originals/AC20-FZK-Haus.ifc")


@unittest.skipUnless(HAUS.is_file(), "Public AC20-FZK-Haus.ifc is absent from the paired-building sources")
class RealStoreyOutlineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import ifcopenshell
        cls.raw = HAUS.read_bytes()
        with tempfile.TemporaryDirectory(prefix="ifc-outline-") as directory:
            source, output = Path(directory)/"original.ifc", Path(directory)/"native.json"
            source.write_bytes(cls.raw)
            cli.read_file(source, output)
            cls.result = json.loads(output.read_bytes())
            if source.read_bytes() != cls.raw:
                raise AssertionError("The supervised outline read changed its source bytes.")
        cls.model = ifcopenshell.open(str(HAUS))

    def test_real_slabs_give_one_closed_outline_per_storey_in_stated_unit(self):
        result = self.result["storeyOutlines"]
        self.assertEqual((result["state"], result["frame"], result["globalTransformApplied"]),
                         ("read", "source_local", False))
        self.assertEqual(result["lengthUnit"], self.result["structure"]["lengthUnit"])
        expected = {s.id(): sorted(e.id() for r in s.ContainsElements for e in r.RelatedElements
                                  if e.is_a("IfcSlab")) for s in self.model.by_type("IfcBuildingStorey")}
        self.assertEqual({s["stepId"]: s["elementStepIds"] for s in result["storeys"]}, expected)
        self.assertEqual((len(result["storeys"]), result["rounding"]["decimalPlaces"]), (2, 5))
        for storey in result["storeys"]:
            self.assertEqual(storey["elementSource"], "IfcSlab")
            self.assertTrue(storey["polygons"])
            for polygon in storey["polygons"]:
                for ring in [polygon["exterior"], *polygon["interiors"]]:
                    self.assertEqual(ring[0], ring[-1])
                    self.assertGreaterEqual(len(ring), 4)
                    self.assertTrue(all(round(v, 5) == v for point in ring for v in point))
        self.assertEqual(HAUS.read_bytes(), self.raw)

    def test_limits_and_geometry_exception_leave_the_other_reading_unchanged(self):
        baseline = {k: v for k, v in self.result.items() if k not in ("storeyOutlines", "limits")}
        for field, value, code in (("outline_seconds", 1e-9, "OUTLINE_TIME_LIMIT"),
                                   ("outline_vertices", 1, "OUTLINE_VERTEX_LIMIT"),
                                   ("outline_elements", 1, "OUTLINE_ELEMENT_LIMIT"),
                                   ("outline_output_bytes", 1, "OUTLINE_OUTPUT_LIMIT"),
                                   ("output_bytes", len(encode_result(self.result)) - 256, "OUTLINE_OUTPUT_LIMIT")):
            with self.subTest(field=field):
                limits = replace(DEFAULT_LIMITS, **{field: value})
                result = extract(self.raw, limits)
                self.assertLessEqual(len(encode_result(result, limits)), limits.output_bytes)
                self.assertEqual(result.pop("storeyOutlines")["code"], code)
                result.pop("limits")
                self.assertEqual(encode_result(result), encode_result(baseline))
        with patch("ifcopenshell.geom.create_shape", side_effect=RuntimeError("forced geometry failure")):
            result = extract(self.raw)
        self.assertEqual(result.pop("storeyOutlines")["code"], "OUTLINE_GEOMETRY")
        result.pop("limits")
        self.assertEqual(encode_result(result), encode_result(baseline))

    def test_space_fallback_and_storeys_without_elements(self):
        import ifcopenshell
        # Remove only the in-memory containment links; retained IFC bytes are never changed.
        model = ifcopenshell.open(str(HAUS))
        storeys = model.by_type("IfcBuildingStorey")
        for storey in storeys:
            for relation in storey.ContainsElements:
                model.remove(relation)
        result = storey_outlines(model, self.result["structure"], DEFAULT_LIMITS)
        self.assertEqual(result["state"], "read", result)
        self.assertTrue(all(s["elementSource"] == "IfcSpace" for s in result["storeys"]))
        self.assertEqual(len(result["storeys"]), len(storeys))
        for storey in storeys:
            for relation in storey.IsDecomposedBy:
                model.remove(relation)
        result = storey_outlines(model, self.result["structure"], DEFAULT_LIMITS)
        self.assertEqual(result["storeys"], [])
        self.assertEqual(result["withoutOutline"], [{"stepId": s.id(), "reason": "no_slab_or_space"}
                                                   for s in storeys])


if __name__ == "__main__":
    unittest.main()
