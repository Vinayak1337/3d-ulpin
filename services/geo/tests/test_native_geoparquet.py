"""Focused source/local-access/allocation/reference regressions.

NATIVE_GEOPARQUET_TEST_SOURCES selects retained unchanged upstream originals.
Adverse copies alter metadata/control framing only, never qualification facts.
Native imports and row decoding use the gated supervisor in every test.
"""
from dataclasses import replace
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/"services/geo"))
from geo.native_geoparquet import DEFAULT_LIMITS, Footer, GeoParquetError, json_metadata, profile, wkb_guard

spec = importlib.util.spec_from_file_location("geoparquet_cli", ROOT/"scripts/usp/desktop-geoparquet-read.py")
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)
SOURCES = Path(os.environ["NATIVE_GEOPARQUET_TEST_SOURCES"]) if "NATIVE_GEOPARQUET_TEST_SOURCES" in os.environ else None


class LocalReferenceControls(unittest.TestCase):
    def test_resource_paths_fail_before_io(self):
        for path in ("https://example.invalid/data.parquet", "s3://bucket/object", "file:///tmp/file", "//host/share/file", r"\\host\share\file"):
            with self.subTest(path=path), patch.object(cli.os, "open", side_effect=AssertionError("unexpected I/O")):
                with self.assertRaises(GeoParquetError) as caught:
                    cli.read_file(path, "unused-output")
                self.assertEqual(caught.exception.code, "LOCAL_ONLY")
        if os.name == "nt":
            with self.assertRaises(GeoParquetError) as caught:
                cli.local_path("C:/file.parquet:secret")
            self.assertEqual(caught.exception.code, "LOCAL_ONLY")

    def test_reference_absent_null_declared_and_version_default(self):
        geo = {"version": "1.1.0", "primary_column": "g", "columns": {"g": {"encoding": "WKB", "geometry_types": []}}}
        crs = lambda: profile(geo, ["g"])["columns"]["g"]["crs"]
        self.assertEqual(crs()["state"], "absent")
        self.assertEqual(crs()["specificationDefault"]["code"], "CRS84")
        geo["columns"]["g"]["crs"] = None
        self.assertEqual(crs()["state"], "null")
        self.assertIsNone(crs()["specificationDefault"])
        geo["columns"]["g"]["crs"] = {"id": {"authority": "EPSG", "code": 4326}}
        self.assertEqual(crs()["state"], "declared")
        self.assertEqual(crs()["qualification"], "unqualified")
        del geo["columns"]["g"]["crs"]
        geo["version"] = "1.0.0"
        self.assertIsNone(crs()["specificationDefault"])
        geo["primary_column"] = []
        self.assertEqual(profile(geo, ["g"])["status"], "unsupported")
        with self.assertRaises(GeoParquetError) as caught:
            json_metadata('{"crs":null,"crs":{}}', DEFAULT_LIMITS)
        self.assertEqual(caught.exception.status, "conflicting")

    def test_wkb_allocation_and_framing_guard(self):
        # Framing probes are not property records or expected operational facts.
        probes = ((bytes.fromhex("0102000000ffffffff"), "WKB_LIMIT"),
                  (bytes.fromhex("01e9030000"), "WKB_PROFILE"),
                  (b"\1"+struct.pack("<I2d", 1, float("inf"), 1), "WKB"))
        for raw, code in probes:
            with self.subTest(code=code), self.assertRaises(GeoParquetError) as caught:
                wkb_guard(raw, DEFAULT_LIMITS)
            self.assertEqual(caught.exception.code, code)


@unittest.skipUnless(SOURCES, "Retained unchanged upstream originals not configured")
class PublishedSourceControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = (SOURCES/"example.parquet").read_bytes()
        cls.private = SOURCES.parent/"evidence"

    def read_copy(self, raw, limits=DEFAULT_LIMITS, start_row=0, row_count=2):
        with tempfile.TemporaryDirectory(prefix="regression-", dir=self.private) as directory:
            source, output = Path(directory)/"input.parquet", Path(directory)/"result"
            source.write_bytes(raw)
            try:
                receipt = cli.read_file(source, output, limits, start_row, row_count)
                return json.loads((output/"projection.json").read_bytes()), receipt
            finally:
                self.assertEqual(source.read_bytes(), raw)

    def test_published_rows_wkb_and_original_metadata(self):
        # Independent stdlib page/Snappy/RLE oracle retained beside originals;
        # its hash and exact locators appear in the source manifest.
        proof = json.loads((self.private/"independent-original-check.json").read_text())
        self.assertEqual(hashlib.sha256(self.raw).hexdigest(), proof["sourceSha256"])
        result, receipt = self.read_copy(self.raw)
        for row, expected in zip(result["rows"], proof["rows"], strict=True):
            self.assertEqual(row["rowIndex"], expected["rowIndex"])
            self.assertEqual(row["columns"]["name"]["value"], expected["name"])
            self.assertEqual(row["columns"]["gdp_md_est"]["value"]["decimalInteger"], expected["gdp_md_est"])
            self.assertEqual(row["columns"]["geometry"]["wkb"]["sha256"], expected["wkbSha256"])
            self.assertEqual(row["columns"]["geometry"]["wkb"]["bytes"], expected["wkbBytes"])
        self.assertEqual(result["rows"][0]["columns"]["geometry"]["decoded"]["coordinates"][0][0][0], proof["row0FirstXY"])
        metadata = result["geoMetadata"]["entries"][0]
        loc = metadata["locator"]
        self.assertEqual(self.raw[loc["byteStart"]:loc["byteEnd"]].decode(), metadata["utf8"])
        upstream = json.loads((SOURCES.parent/"references/example_metadata.json").read_text())
        self.assertEqual(metadata["parsed"], upstream["geo"])
        self.assertEqual(result["window"]["nextRowIndex"], 2)
        self.assertTrue(result["window"]["truncated"])
        self.assertEqual(result["profile"]["columns"]["geometry"]["crs"]["state"], "declared")
        self.assertFalse(result["semantics"]["globalPlacementQualified"])
        self.assertTrue(receipt["execution"]["gatedStart"])
        self.assertEqual(receipt["execution"]["processingCpuLimit"], 2)
        continued, _ = self.read_copy(self.raw, start_row=2, row_count=1)
        self.assertEqual(continued["rows"][0]["rowIndex"], 2)
        self.assertEqual(continued["rows"][0]["columns"]["name"]["locator"]["rowIndexInGroup"], 2)

    def test_naturally_absent_geo_inventory_without_rows(self):
        original = (SOURCES/"alltypes_plain.parquet").read_bytes()
        result, receipt = self.read_copy(original)
        self.assertEqual(result["geoMetadata"]["state"], "absent")
        self.assertEqual(receipt["status"], "unsupported")
        self.assertEqual(result["profile"]["reasons"], ["geo_absent"])
        self.assertTrue(result["schema"]["columns"])
        self.assertEqual(result["window"]["totalRows"], 8)
        self.assertEqual(result["rows"], [])

    def test_expansion_output_and_coordinate_bounds(self):
        for limits, code in ((replace(DEFAULT_LIMITS, group_bytes=100), "EXPANSION_LIMIT"),
                             (replace(DEFAULT_LIMITS, output_bytes=1024), "OUTPUT_LIMIT"),
                             (replace(DEFAULT_LIMITS, footer_bytes=100), "FOOTER_LIMIT")):
            with self.subTest(code=code), tempfile.TemporaryDirectory(dir=self.private) as directory:
                source, output = Path(directory)/"input.parquet", Path(directory)/"result"
                source.write_bytes(self.raw)
                with self.assertRaises(GeoParquetError) as caught:
                    cli.read_file(source, output, limits, row_count=2)
                self.assertEqual(caught.exception.code, code)
                self.assertFalse((output/"projection.json").exists())
                self.assertEqual(source.read_bytes(), self.raw)
        result, _ = self.read_copy(self.raw, replace(DEFAULT_LIMITS, coordinates=100))
        self.assertEqual(result["window"]["coordinateValues"], 44)
        # Second cell exceeds its own profile, so its bytes remain but no XY is
        # decoded; oversized single geometry is explicit rather than omitted.
        self.assertEqual(result["rows"][1]["columns"]["geometry"]["decoded"]["reason"], "COORDINATE_LIMIT")
        window, _ = self.read_copy(self.raw, replace(DEFAULT_LIMITS, coordinates=130))
        self.assertEqual(window["window"]["returnedRows"], 1)
        self.assertEqual(window["window"]["nextRowIndex"], 1)
        self.assertEqual(window["window"]["stopReason"], "coordinate_budget")

    def test_literal_metadata_null_and_conflict_do_not_become_defaults(self):
        footer = Footer(self.raw, DEFAULT_LIMITS)
        entry = next(e[2] for e in footer.entries if e[1]["bytes"] == b"geo")

        def altered(literal):
            n, prefix = len(literal), bytearray()
            while n >= 128:
                prefix.append((n & 127) | 128)
                n >>= 7
            prefix.append(n)
            raw = self.raw[:entry["lengthByteStart"]]+prefix+literal+self.raw[entry["byteEnd"]:]
            length = len(raw)-8-footer.start
            return raw[:-8]+struct.pack("<I", length)+b"PAR1"

        for literal, state in ((b"null", "null"), (b'{"crs":null,"crs":{}}', "conflicting")):
            with self.subTest(state=state):
                result, _ = self.read_copy(altered(literal))
                self.assertEqual(result["geoMetadata"]["state"], state)
                self.assertEqual(result["rows"], [])
                self.assertEqual(result["profile"]["status"], "unsupported")

    @unittest.skipUnless(os.name == "nt", "Windows Job gated attachment and memory controls")
    def test_attachment_failure_and_memory_preserve_original_and_no_projection(self):
        import psutil
        pid = None

        class RefusedJob:
            def __init__(self, process, limits):
                nonlocal pid
                pid = process.pid
                raise OSError("test attachment refused")

        with tempfile.TemporaryDirectory(dir=self.private) as directory:
            source, result = Path(directory)/"input.parquet", Path(directory)/"result.json"
            source.write_bytes(self.raw)
            with patch.object(cli, "WindowsJob", RefusedJob), self.assertRaises(OSError):
                cli.supervise(source, result)
            self.assertFalse(result.exists())
            self.assertFalse(psutil.pid_exists(pid))
            self.assertEqual(source.read_bytes(), self.raw)
        with self.assertRaises(GeoParquetError):
            self.read_copy(self.raw, replace(DEFAULT_LIMITS, memory_bytes=16*1024**2))

    def test_timeout_and_no_replacement(self):
        with self.assertRaises(GeoParquetError) as caught:
            self.read_copy(self.raw, replace(DEFAULT_LIMITS, seconds=0.001))
        self.assertEqual(caught.exception.code, "TIME_LIMIT")
        with tempfile.TemporaryDirectory(dir=self.private) as directory:
            source = Path(directory)/"input.parquet"
            source.write_bytes(self.raw)
            for output in (source, Path(directory)):
                with self.assertRaises(GeoParquetError) as caught:
                    cli.read_file(source, output)
                self.assertEqual(caught.exception.code, "OUTPUT_EXISTS")
            self.assertEqual(source.read_bytes(), self.raw)


if __name__ == "__main__":
    unittest.main()
