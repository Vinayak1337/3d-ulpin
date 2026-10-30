"""Focused safety/source controls; tiny XML controls are not property fixtures."""
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
sys.path.insert(0, str(ROOT / "services/geo"))
from geo.native_citygml import DEFAULT_LIMITS, CityGMLError, Limits, encode_result, extract

spec = importlib.util.spec_from_file_location("citygml_cli", ROOT / "scripts/usp/desktop-citygml-read.py")
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)

OPEN = b'<CityModel xmlns="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:xlink="http://www.w3.org/1999/xlink">'


class NativeCityGMLTests(unittest.TestCase):
    def test_versions_are_literal_and_mixed_namespaces_are_refused(self):
        raw = (OPEN + b'<cityObjectMember><Building xmlns="http://www.opengis.net/citygml/building/2.0">'
               b'<lod0FootPrint><gml:posList srsDimension="3">0 0 0 1 0 0</gml:posList></lod0FootPrint>'
               b'</Building></cityObjectMember></CityModel>')
        two = extract(raw)
        one = extract(raw.replace(b'citygml/2.0', b'citygml/1.0')
                      .replace(b'citygml/building/2.0', b'citygml/building/1.0'))
        self.assertEqual("1.0", one["source"]["citygmlVersion"])
        self.assertEqual("2.0", two["source"]["citygmlVersion"])
        for field in ("elements", "buildingsAndParts", "coordinateDeclarations", "decodedCoordinateValues"):
            self.assertEqual(two["counts"][field], one["counts"][field])
        self.assertEqual(two["coordinates"], one["coordinates"])
        self.error("VERSION_PROFILE", raw.replace(b'citygml/building/2.0', b'citygml/building/1.0'))
        self.error("VERSION_PROFILE", raw.replace(b'citygml/2.0', b'citygml/1.0'))
        self.error("VERSION_PROFILE", raw.replace(b'citygml/building/2.0', b'citygml/building/3.0'))
        self.error("VERSION_PROFILE", OPEN.replace(b'xmlns:gml=',
                   b'xmlns:unused="http://www.opengis.net/citygml/generics/1.0" xmlns:gml=') + b'</CityModel>')

    def test_default_bounds_refuse_one_extra_element_or_input_byte(self):
        raw = OPEN + b'<gml:name/>' * DEFAULT_LIMITS.elements + b'</CityModel>'
        self.error("STRUCTURE_LIMIT", raw)
        self.error("INPUT_LIMIT", b' ' * (DEFAULT_LIMITS.input_bytes + 1))
        with self.assertRaisesRegex(ValueError, "only be reduced"):
            Limits(elements=DEFAULT_LIMITS.elements + 1)

    def test_real_berlin_inventory_past_the_artifact_bound_reads_whole_members_to_it(self):
        path = Path("E:/BhuAayam-data/datasets/practice-kit-20261024/berlin-senstadt/"
                    "LoD2_33_392_5820_1_BE.gml")
        if not path.is_file():
            self.skipTest("Berlin test_only practice-kit tile is absent")
        raw = path.read_bytes()
        expected = "515aa294b686fbdbebff8ea9946198fc06adda8d922173ec316a7288f64ab0b5"
        self.assertEqual(expected, hashlib.sha256(raw).hexdigest())
        result = extract(raw)
        self.assertEqual("1.0", result["source"]["citygmlVersion"])
        self.assertEqual(244832, result["counts"]["elements"])
        self.assertEqual(1605, result["counts"]["buildingsAndParts"])
        self.assertEqual(732, sum(row["type"] == "Building" for row in result["buildings"]))
        self.assertEqual(363348, result["counts"]["decodedCoordinateValues"])
        self.assertEqual(16 * 1024**2, DEFAULT_LIMITS.output_bytes)
        data = encode_result(result)
        reading = json.loads(data)
        self.assertLessEqual(len(data), DEFAULT_LIMITS.output_bytes)
        self.assertEqual("partial", reading["status"])
        read = reading["findings"][-1]
        self.assertEqual(("READ_TO_LIMIT", 1605, 244832),
                         (read["code"], read["buildingsAndPartsInSource"], read["elementsInSource"]))
        cut = reading["counts"]["elements"]
        self.assertEqual((cut, 0), (read["unreadFrom"]["element"], result["elements"][cut]["parent"]))
        self.assertTrue(0 < reading["counts"]["buildingsAndParts"] < 1605)
        self.assertEqual(result["buildings"][:reading["counts"]["buildingsAndParts"]], reading["buildings"])
        self.assertEqual(expected, hashlib.sha256(path.read_bytes()).hexdigest())

    def error(self, code, raw, limits=Limits()):
        with self.assertRaises(CityGMLError) as raised:
            extract(raw, limits)
        self.assertEqual(code, raised.exception.code)

    def test_external_resources_and_entities_denied(self):
        self.error("XML_RESOURCE_DENIED", b'<!DOCTYPE CityModel SYSTEM "file:///must-not-read">'+OPEN+b'</CityModel>')
        self.error("XML_RESOURCE_DENIED", b'<!DOCTYPE CityModel [<!ENTITY x SYSTEM "https://must-not-fetch.invalid/">]>'+OPEN+b'</CityModel>')
        result = extract(OPEN+b'<gml:description xlink:href="https://must-not-fetch.invalid/">A &amp; B</gml:description></CityModel>')
        self.assertEqual("external_not_resolved", result["references"][0]["state"])
        self.assertEqual("A & B", result["elements"][1]["text"]["value"])
        self.assertFalse(result["semantics"]["externalResourcesResolved"])
        based = extract(OPEN+b'<gml:description gml:id="base-control"/><gml:name xml:base="https://must-not-fetch.invalid/" xlink:href="#base-control"/></CityModel>')
        self.assertEqual("unsupported_xml_base_context", based["references"][0]["state"])
        self.assertEqual([], based["references"][0]["targetElements"])
        with patch.object(Path, "resolve", side_effect=AssertionError("remote I/O must not start")):
            with self.assertRaises(CityGMLError) as raised:
                cli.read_file(Path("//control.invalid/share/source.gml"), Path("output"))
            self.assertEqual("LOCAL_ONLY", raised.exception.code)

    def test_malformed_and_bounded_tokens(self):
        self.error("XML_MALFORMED", OPEN+b'<gml:description></CityModel>')
        self.error("STRING_LIMIT", OPEN+b'<gml:description>'+b'x'*257+b'</gml:description></CityModel>', Limits(string_bytes=256))
        self.error("STRUCTURE_LIMIT", OPEN+b'<gml:description><gml:name/></gml:description></CityModel>', Limits(depth=2))
        self.error("COORDINATE_NUMBER", OPEN+b'<gml:pos>NaN</gml:pos></CityModel>')
        self.error("COORDINATE_LIMIT", OPEN+b'<gml:posList>0 0 0</gml:posList></CityModel>', Limits(coordinate_values=2))
        with self.assertRaises(CityGMLError) as raised:
            encode_result(extract(OPEN+b'</CityModel>'), Limits(output_bytes=128))
        self.assertEqual("OUTPUT_LIMIT", raised.exception.code)

    def test_reference_inventory_does_not_expand_or_hide_cycles(self):
        raw = OPEN+b'<gml:description gml:id="control-a" xlink:href="#control-b"/><gml:description gml:id="control-b" xlink:href="#control-a"/><gml:name gml:id="control-duplicate"/><gml:name gml:id="control-duplicate"/><gml:description xlink:href="#control-duplicate"/><gml:description xlink:href="#missing-control"/></CityModel>'
        result = extract(raw)
        self.assertEqual(["cycle_member", "cycle_member"], [r["cycleState"] for r in result["references"][:2]])
        self.assertEqual(["duplicate_target", "unresolved"], [r["state"] for r in result["references"][2:]])
        self.assertEqual(7, len(result["elements"]))

    def test_encoding_version_and_nil_states(self):
        self.error("VERSION_PROFILE", b'<CityModel xmlns="http://www.opengis.net/citygml/3.0"/>')
        self.error("ENCODING", b'<?xml version="1.0" encoding="ISO-8859-1"?>'+OPEN+b'</CityModel>')
        result = extract(OPEN+b'<gml:pos xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="true"/><gml:posList/><gml:pos xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="true" nilReason="withheld"/></CityModel>')
        self.assertEqual(["null", "needs_input", "withheld"], [c["state"] for c in result["coordinates"]])
        self.assertEqual("absent", result["coordinates"][0]["referenceDeclarations"]["srsName"]["state"])

    def test_original_and_complete_no_replace_publication(self):
        raw = OPEN+b'</CityModel>'
        data = encode_result(extract(raw))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original, output = root/"original.gml", root/"output"
            original.write_bytes(raw)
            def complete_worker(snapshot, result_path, limits):
                self.assertEqual(raw, snapshot.read_bytes())
                result_path.write_bytes(data)
                return data, {"test": "publication_control_only"}
            with patch.object(cli, "supervise", side_effect=complete_worker):
                receipt = cli.read_file(original, output)
            self.assertEqual(raw, original.read_bytes())
            self.assertEqual(data, (output/"projection.json").read_bytes())
            self.assertEqual(hashlib.sha256(raw).hexdigest(), receipt["sourceSha256"])
            before = {p.name: p.read_bytes() for p in output.iterdir()}
            with self.assertRaises(CityGMLError):
                cli.read_file(original, output)
            self.assertEqual(before, {p.name: p.read_bytes() for p in output.iterdir()})
            with patch.object(cli, "supervise", side_effect=CityGMLError("XML_MALFORMED", "control")):
                with self.assertRaises(CityGMLError):
                    cli.read_file(original, root/"failed-output")
            self.assertFalse((root/"failed-output").exists())
            self.assertEqual(raw, original.read_bytes())

    @unittest.skipUnless(os.environ.get("CITYGML_REVIEW_CONTROL") and os.environ.get("CITYGML_ORIGINALS"),
                         "Set CITYGML_REVIEW_CONTROL and CITYGML_ORIGINALS to retained reviewer/source directories")
    def test_opaque_ade_keeps_literals_without_typed_associations(self):
        control = Path(os.environ["CITYGML_REVIEW_CONTROL"])
        raw = (control/"opaque-ade-control.gml").read_bytes()
        self.assertEqual("b85e43be0ffb480959663a72736248006b7e161032f47db76d98243bd17224cb", hashlib.sha256(raw).hexdigest())
        before = json.loads((control/"ade-control-result/projection.json").read_bytes())
        result = extract(raw)
        self.assertEqual([], result["buildings"])
        self.assertEqual(0, result["counts"]["buildingsAndParts"])
        for field in ("elements", "namespaces", "identifiers", "references"):
            self.assertEqual(before[field], result[field], field)
        # The coordinate guard is unchanged; no opaque body values are decoded.
        expected_coordinates = [dict(c, buildingElement=None) for c in before["coordinates"]]
        actual_coordinates = json.loads(json.dumps(result["coordinates"]))
        for coordinate in actual_coordinates:
            for field in ("srsName", "srsDimension"):
                coordinate["referenceDeclarations"][field].pop("effectiveDeclaration")
        self.assertEqual(expected_coordinates, actual_coordinates)
        originals = Path(os.environ["CITYGML_ORIGINALS"])
        for name, saved in (("Building_and_garage_LOD2-EPSG25832.gml", "run-02-lod2"),
                            ("Building_LOD1-LocalEngineeringCRS.gml", "run-02-local")):
            previous = json.loads((originals.parent/saved/"projection.json").read_bytes())
            current = extract((originals/name).read_bytes())
            # CG1 changes effective systems/dimensions and findings, not any original literal or locator.
            for field in ("source", "elements", "namespaces", "identifiers", "references", "buildings", "counts"):
                self.assertEqual(previous[field], current[field], (name, field))

    def test_conflicting_envelopes_on_one_feature_are_a_finding_not_a_failure(self):
        raw = (b'<CityModel xmlns="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml"'
               b' xmlns:bldg="http://www.opengis.net/citygml/building/2.0">'
               b'<gml:boundedBy><gml:Envelope srsName="EPSG:25832" srsDimension="3"/></gml:boundedBy>'
               b'<cityObjectMember><bldg:Building gml:id="two">'
               b'<gml:boundedBy><gml:Envelope srsName="EPSG:25832" srsDimension="3"/></gml:boundedBy>'
               b'<gml:boundedBy><gml:Envelope srsName="EPSG:28992" srsDimension="2"/></gml:boundedBy>'
               b'<bldg:lod0FootPrint><gml:MultiSurface><gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing>'
               b'<gml:posList>0 0 7 2 0 7 2 2 7 0 0 7</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon>'
               b'</gml:surfaceMember></gml:MultiSurface></bldg:lod0FootPrint></bldg:Building></cityObjectMember>'
               b'<cityObjectMember><bldg:Building gml:id="one">'
               b'<gml:boundedBy><gml:Envelope srsName="EPSG:25832" srsDimension="3"/></gml:boundedBy>'
               b'<bldg:lod0FootPrint><gml:MultiSurface><gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing>'
               b'<gml:posList>0 0 7 2 0 7 2 2 7 0 0 7</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon>'
               b'</gml:surfaceMember></gml:MultiSurface></bldg:lod0FootPrint></bldg:Building></cityObjectMember>'
               b'</CityModel>')
        result = extract(raw)
        two, one = (b["element"] for b in result["buildings"])
        [finding] = [f for f in result["findings"] if f["code"] == "ENVELOPE_CONFLICT"]
        self.assertEqual("partial", result["status"])
        self.assertEqual([two], finding["elements"])
        [locator] = finding["locators"]
        self.assertEqual(result["elements"][two]["locator"], {k: locator[k] for k in ("byteStart", "byteEnd")})
        self.assertTrue(raw[locator["byteStart"]:locator["byteEnd"]].startswith(b'<bldg:Building gml:id="two"'))
        rows = {c["buildingElement"]: c for c in result["coordinates"]}
        for field in ("srsName", "srsDimension"):
            # Neither envelope is chosen and the CityModel envelope is not reached past the conflict.
            self.assertIsNone(rows[two]["referenceDeclarations"][field]["effectiveDeclaration"])
        self.assertEqual("absent", rows[two]["tupleDimensionState"])
        self.assertIsNone(rows[two]["tupleDimension"])
        self.assertEqual("EPSG:25832", rows[one]["referenceDeclarations"]["srsName"]["effectiveDeclaration"]["value"])
        self.assertEqual(3, rows[one]["tupleDimension"])

    @unittest.skipUnless(os.environ.get("CITYGML_ORIGINALS"), "Set CITYGML_ORIGINALS to the retained unchanged OGC originals")
    def test_retained_ogc_literals_and_byte_locators(self):
        source = Path(os.environ["CITYGML_ORIGINALS"])/"Building_and_garage_LOD2-EPSG25832.gml"
        raw = source.read_bytes()
        self.assertEqual("2c7e9c228ecc2b6549c7dd655289b7239fdb15e1e95ad49db6a757742e271f0a", hashlib.sha256(raw).hexdigest())
        result = extract(raw)
        self.assertEqual(["GML_7b1a5a6f-ddad-4c3d-a507-3eb9ee0a8e68", "GMLID_BUI379228_1244_301"], [b["id"] for b in result["buildings"]])
        self.assertEqual(result["buildings"][0]["element"], result["buildings"][1]["parentBuildingElement"])
        first = next(c for c in result["coordinates"] if c["kind"] == "posList")
        self.assertEqual(["458875.0", "5438350.0", "112.0"], [v["literal"] for v in first["values"][:3]])
        self.assertEqual(3, first["tupleDimension"])
        declaration = first["referenceDeclarations"]["srsName"]
        self.assertIsNone(declaration["nearestAncestorDeclaration"])
        self.assertEqual("urn:ogc:def:crs,crs:EPSG::25832,crs:EPSG::5783",
                         declaration["effectiveDeclaration"]["value"])
        for node in result["elements"]:
            span = node["locator"]
            self.assertTrue(raw[span["byteStart"]:span["byteEnd"]].startswith(b"<"))
            for attr in node["attributes"]:
                start, end = attr["locator"]["byteStart"], attr["locator"]["byteEnd"]
                self.assertEqual(attr["rawLiteral"], raw[start:end].decode("utf-8"))
            if node["text"]:
                start, end = node["text"]["locator"]["byteStart"], node["text"]["locator"]["byteEnd"]
                self.assertEqual(node["text"]["rawLiteral"], raw[start:end].decode("utf-8"))
        for coordinate in result["coordinates"]:
            for value in coordinate["values"] or []:
                start, end = value["locator"]["byteStart"], value["locator"]["byteEnd"]
                self.assertEqual(value["literal"], raw[start:end].decode("ascii"))
        self.assertTrue(any(n["interpretation"] == "unsupported_geometry" for n in result["elements"]))
        local_raw = (Path(os.environ["CITYGML_ORIGINALS"])/"Building_LOD1-LocalEngineeringCRS.gml").read_bytes()
        local = extract(local_raw)
        envelope = next(n for n in local["elements"] if n["localName"] == "Envelope")
        self.assertEqual("#local-CRS-1", next(a["value"] for a in envelope["attributes"] if a["name"] == "srsName"))
        self.assertTrue(any(n["interpretation"] == "unsupported_module_or_ADE" for n in local["elements"]))
        self.assertFalse(local["semantics"]["globalTransformApplied"])


if __name__ == "__main__":
    unittest.main()
