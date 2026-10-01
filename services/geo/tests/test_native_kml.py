"""Targeted XML/ZIP, literal provenance and immutable publication regressions.

Authored inputs below are safety fixtures only, never source qualification.
"""
import hashlib
from contextlib import redirect_stderr
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "services/geo"))
from geo.native_kml import KMLError, _read_kml, encode_kml_result
import geo.native_kml as reader

spec = importlib.util.spec_from_file_location("kml_cli", ROOT / "scripts/usp/desktop-kml-read.py")
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


def xml(body):
    return ('<kml xmlns="http://www.opengis.net/kml/2.2">' + body + '</kml>').encode()


def kmz(entries):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, raw in entries:
            if isinstance(name, str):
                info = zipfile.ZipInfo()
                info.filename = info.orig_filename = name  # Preserve hostile lexeme on Windows.
                info.compress_type = zipfile.ZIP_DEFLATED
            else:
                info = name
            archive.writestr(info, raw)
    return buffer.getvalue()


class NativeKMLTests(unittest.TestCase):
    def assert_code(self, code, function, *args, **kwargs):
        with self.assertRaises(KMLError) as raised:
            function(*args, **kwargs)
        self.assertEqual(raised.exception.code, code)

    def test_xml_hostile_input_never_resolves(self):
        self.assert_code("XML_FORBIDDEN", _read_kml,
                         b'<!DOCTYPE kml [<!ENTITY x SYSTEM "file:///secret">]><kml>&x;</kml>')
        self.assert_code("XML_FORBIDDEN", _read_kml, b'<!DOCTYPE kml><kml/>')
        self.assert_code("XML_TREE_LIMIT", _read_kml, xml('<Folder>' * 64 + '</Folder>' * 64))
        result = _read_kml(xml('<Document><NetworkLink><Link><href>https://invalid.example/a</href></Link></NetworkLink>'
                               '<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="file:///secret"/></Document>'))
        self.assertEqual(result["references"][0]["resolution"], "not_resolved")
        self.assertTrue(any(item["name"] == "include" for item in result["unsupported"]))

    def test_literal_fields_missing_altitude_and_conflicts(self):
        result = _read_kml(xml('<Placemark id="source-id"><name>001</name><description><![CDATA[<script>ignored()</script>]]></description>'
                               '<ExtendedData><Data name="code"><value>0007</value></Data></ExtendedData>'
                               '<Point><altitudeMode>absolute</altitudeMode><altitudeMode>relativeToGround</altitudeMode>'
                               '<coordinates>77.0,28.0</coordinates></Point></Placemark>'))
        feature = result["features"][0]
        self.assertEqual(feature["sourceId"]["text"], "source-id")
        self.assertEqual(feature["name"]["values"][0]["text"], "001")
        self.assertTrue(any(f["text"] == "0007" and f["name"] == "value" for f in feature["sourceFields"]))
        geometry = feature["geometries"][0]
        coordinate = geometry["coordinates"]["sequences"][0]["tuples"][0]
        self.assertEqual(coordinate["lexemes"], ["77.0", "28.0"])
        self.assertIsNone(coordinate["altitude"])
        self.assertEqual(geometry["declarations"]["altitudeMode"]["state"], "conflicting")
        self.assertEqual(geometry["declarations"]["extrude"]["state"], "absent")
        self.assertEqual(geometry["specificationDefaults"]["extrude"], "0")
        self.assertFalse(result["qualification"]["analyticEligible"])
        self.assertGreater(geometry["locator"]["line"], 0)

    def test_nonfinite_tuple_and_bounded_encoding(self):
        self.assert_code("NONFINITE_COORDINATE", _read_kml,
                         xml('<Placemark><Point><coordinates>77,28,1e999</coordinates></Point></Placemark>'))
        with patch.object(reader, "MAX_COORDINATES", 1):
            self.assert_code("COORDINATE_LIMIT", _read_kml,
                             xml('<Placemark><LineString><coordinates>77,28 78,29</coordinates></LineString></Placemark>'))
        with patch.object(reader, "MAX_OUTPUT_BYTES", 8):
            self.assert_code("OUTPUT_LIMIT", encode_kml_result, {"long": "a" * 20})

    def test_multigeometry_keeps_polygon_rings_and_unsupported_children(self):
        result = _read_kml(xml('<Placemark><MultiGeometry><Point><coordinates>77,28</coordinates></Point>'
                               '<Polygon><outerBoundaryIs><LinearRing><coordinates>77,28 78,28 78,29 77,28</coordinates></LinearRing></outerBoundaryIs>'
                               '<innerBoundaryIs><LinearRing><coordinates>77.1,28.1 77.2,28.1 77.2,28.2 77.1,28.1</coordinates></LinearRing></innerBoundaryIs></Polygon>'
                               '<Model><Link><href>https://invalid.example/model.dae</href></Link></Model></MultiGeometry></Placemark>'))
        geometry = result['features'][0]['geometries'][0]
        self.assertEqual(geometry['status'], 'partial')
        self.assertEqual([g['type'] for g in geometry['geometries']], ['Point', 'Polygon'])
        self.assertEqual([b['role'] for b in geometry['geometries'][1]['boundaries']], ['outerBoundaryIs', 'innerBoundaryIs'])
        self.assertEqual(result['coordinateCount'], 9)
        self.assertEqual(result['references'][0]['resolution'], 'not_resolved')

    def test_opaque_payloads_cannot_promote_features_or_coordinates(self):
        # Authored safety wrappers/values only; not source qualification facts.
        payload = '<Placemark id="opaque"><Point><coordinates>1,2</coordinates></Point></Placemark>'
        wrappers = ('<ExtendedData><audit:payload xmlns:audit="urn:opaque">{}</audit:payload></ExtendedData>',
                    '<description>{}</description>', '<Style>{}</Style>', '<Model>{}</Model>',
                    '<audit:payload xmlns:audit="urn:opaque">{}</audit:payload>')
        for wrapper in wrappers:
            with self.subTest(wrapper=wrapper):
                result = _read_kml(xml('<Document>' + wrapper.format(payload) + '</Document>'))
                self.assertEqual([feature['type'] for feature in result['features']], ['Document'])
                self.assertEqual(result['coordinateCount'], 0)
                opaque = next(item for item in result['unsupported'] if item['name'] == 'Placemark')
                self.assertEqual(opaque['reason'], 'OPAQUE_FEATURE_CONTENT')
                self.assertEqual(opaque['literal']['text'], '1,2')
                self.assertIn('Placemark', opaque['literal']['locator']['path'])
        result = _read_kml(xml('<Document><Placemark><Point><coordinates>'
                               '<audit:payload xmlns:audit="urn:opaque">' + payload +
                               '</audit:payload></coordinates></Point></Placemark></Document>'))
        self.assertEqual([feature['type'] for feature in result['features']], ['Document', 'Placemark'])
        self.assertEqual(result['coordinateCount'], 0)
        geometry = result['features'][1]['geometries'][0]
        self.assertEqual(geometry['status'], 'partial')
        self.assertEqual(geometry['coordinates']['state'], 'unsupported')
        self.assertEqual(geometry['coordinates']['sequences'][0]['source']['text'], '1,2')

    def test_kmz_selection_and_member_lineage(self):
        raw = kmz([('doc.kml', xml('<Placemark><name>one</name></Placemark>')),
                   ('nested/other.kml', xml('<Document/>')), ('image.bin', b'inert')])
        result = _read_kml(raw)
        self.assertEqual(result["status"], "needs_input")
        self.assertEqual(len(result["memberInventory"]), 3)
        selected = _read_kml(raw, member='doc.kml')
        self.assertEqual(selected["sourceSha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(selected["member"]["sha256"], selected["xmlSha256"])
        self.assertEqual(selected["features"][0]["geometryState"], "absent")
        self.assert_code("MEMBER_NOT_FOUND", _read_kml, raw, member='other.kml')

    def test_kmz_unsafe_names_special_entries_and_bomb(self):
        for name in ('../doc.kml', '/doc.kml', 'C:doc.kml', 'dir\\doc.kml', 'a/./doc.kml'):
            self.assert_code("UNSAFE_MEMBER_PATH", _read_kml, kmz([(name, xml('<Document/>'))]))
        self.assert_code("DUPLICATE_MEMBER", _read_kml,
                         kmz([('doc.kml', b'a'), ('DOC.kml', b'b')]))
        link = zipfile.ZipInfo('doc.kml')
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.assert_code("SPECIAL_MEMBER", _read_kml, kmz([(link, b'outside.kml')]))
        self.assert_code("EXPANSION_LIMIT", _read_kml, kmz([('doc.kml', b'a' * 100000)]))
        raw = bytearray(kmz([('doc.kml', xml('<Document/>'))]))
        # Corrupt compressed member bytes while leaving directory/CRC unchanged.
        offset = 30 + len('doc.kml')
        raw[offset] ^= 0xff
        self.assert_code("KMZ_CORRUPT", _read_kml, bytes(raw))

    @unittest.skipUnless(os.name == "nt", "Windows Job supervision profile")
    def test_gated_supervision_attachment_refusal_and_timeout(self):
        with tempfile.TemporaryDirectory() as folder:
            marker = Path(folder) / 'marker'
            probe = Path(folder) / 'probe.py'
            probe.write_text("from pathlib import Path\nimport sys,time\nPath(sys.argv[1]).write_text('started')\ntime.sleep(10)\n")
            original = cli._WindowsJob

            class DelayedJob(original):
                def __init__(self, process):
                    import time
                    time.sleep(0.1)
                    assert not marker.exists(), 'worker executed before Job attachment'
                    super().__init__(process)

            with patch.object(cli, "_WindowsJob", DelayedJob), patch.object(cli, "MAX_SECONDS", 1):
                self.assert_code("TIME_LIMIT", cli._supervise, [str(probe), str(marker)], '')
            self.assertTrue(marker.exists())
            marker.unlink()

            class RefusedJob:
                def __init__(self, process):
                    assert not marker.exists()
                    raise OSError('attachment refused')

            with patch.object(cli, "_WindowsJob", RefusedJob):
                with self.assertRaises(OSError):
                    cli._supervise([str(probe), str(marker)], '')
            self.assertFalse(marker.exists())

    def test_original_and_publication_guards(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'original.kml'
            raw = xml('<Document/>')
            source.write_bytes(raw)
            digest = hashlib.sha256(raw).hexdigest()
            self.assertEqual(cli._original(source, digest)[1], raw)
            with self.assertRaises(ValueError):
                cli._original(source, '0' * 64)
            with self.assertRaises(ValueError):
                cli._fresh_output(Path(folder))
            fakegit = Path(folder) / 'repo'
            fakegit.mkdir()
            (fakegit / '.git').write_text('gitdir: elsewhere')
            with self.assertRaises(ValueError):
                cli._fresh_output(fakegit / 'out')
            self.assertEqual(source.read_bytes(), raw)

    def test_changed_original_refuses_publication_and_cleans_owned_temp(self):
        with tempfile.TemporaryDirectory() as folder:
            source, out = Path(folder) / 'original.kml', Path(folder) / 'out'
            raw = xml('<Document/>')
            source.write_bytes(raw)
            digest = hashlib.sha256(raw).hexdigest()
            result = encode_kml_result(_read_kml(raw))

            def mutate(*args, **kwargs):
                source.write_bytes(xml('<Folder/>'))
                return result, {}

            with patch.object(cli, 'run_supervised', mutate), patch.object(sys, 'argv',
                    ['cli', str(source), '--expected-sha256', digest, '--output-dir', str(out)]), redirect_stderr(io.StringIO()):
                self.assertEqual(cli.main(), 2)
            self.assertFalse(out.exists())
            self.assertEqual(list(Path(folder).iterdir()), [source])


if __name__ == '__main__':
    unittest.main()
