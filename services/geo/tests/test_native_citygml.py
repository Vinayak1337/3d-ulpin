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
from geo.native_citygml import CityGMLError, Limits, encode_result, extract

spec = importlib.util.spec_from_file_location("citygml_cli", ROOT / "scripts/usp/desktop-citygml-read.py")
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)

OPEN = b'<CityModel xmlns="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:xlink="http://www.w3.org/1999/xlink">'


class NativeCityGMLTests(unittest.TestCase):
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
        self.assertIsNone(first["tupleDimension"])
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
