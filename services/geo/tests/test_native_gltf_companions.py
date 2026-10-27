"""GB1: a .gltf reads its external buffer only from the retained original bound to it.

test_only: the triangle glTF and its .bin are written here from literal values; they are
not retained records, survey data or a source/accuracy qualification.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "services/geo"))
from geo import native_gltf as reader

POSITIONS = ((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0))
BIN = b"".join(struct.pack("<fff", *p) for p in POSITIONS) + struct.pack("<HHH", 0, 1, 2)


def triangle(uri="tri.bin", byte_length=len(BIN)):
    return json.dumps({
        "asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
        "buffers": [{"uri": uri, "byteLength": byte_length}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 36},
                        {"buffer": 0, "byteOffset": 36, "byteLength": 6}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3",
                       "min": [0, 0, 0], "max": [1, 1, 0]},
                      {"bufferView": 1, "componentType": 5123, "count": 3, "type": "SCALAR"}],
    }).encode("utf-8")


def bound(data=BIN, uri="tri.bin", index=0):
    return {"bufferIndex": index, "uri": uri, "state": "bound", "sourceId": "test-only-source",
            "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "data": data}


class CompanionBufferTest(unittest.TestCase):
    def test_bound_buffer_gives_positions(self):
        with patch("builtins.open", side_effect=AssertionError("The reader must not resolve a path")):
            result = reader.inspect_gltf(triangle(), companions=[bound()])
        self.assertEqual(result["status"], "inspected_local")
        self.assertEqual(result["geometryProjectionStatus"], "available")
        projection = result["primitives"][0]["projection"]
        self.assertEqual(projection["POSITION"]["values"], [list(p) for p in POSITIONS])
        self.assertEqual(projection["indices"]["values"], [0, 1, 2])
        buffer = result["buffers"][0]
        self.assertEqual((buffer["kind"], buffer["status"], buffer["fetched"]), ("bound_companion", "available", False))
        self.assertEqual(buffer["binding"], {"bufferIndex": 0, "uri": "tri.bin", "state": "bound", "name": "tri.bin",
                                             "sourceId": "test-only-source",
                                             "sha256": hashlib.sha256(BIN).hexdigest(), "bytes": len(BIN)})
        self.assertIsNone(projection["POSITION"]["locator"]["originalByteOffset"])
        self.assertEqual(result["qualification"]["globalPlacement"], "unknown")

    def test_percent_decoded_name_and_longer_file(self):
        padded = BIN + b"\0\0"
        result = reader.inspect_gltf(triangle("tri%20mesh.bin"), companions=[bound(padded, "tri%20mesh.bin")])
        self.assertEqual(result["buffers"][0]["binding"]["name"], "tri mesh.bin")
        self.assertEqual(result["counts"]["projectedPositions"], 3)

    def test_missing_stays_needs_input(self):
        result = reader.inspect_gltf(triangle())
        self.assertEqual(result["buffers"][0]["status"], "needs_input")
        self.assertEqual(result["buffers"][0]["reason"], "EXTERNAL_BUFFER_NOT_RESOLVED")
        self.assertEqual(result["status"], "inspected_partial")
        self.assertEqual(result["counts"]["projectedPositions"], 0)

    def test_byte_length_larger_than_file_refuses(self):
        short = BIN[:40]
        result = reader.inspect_gltf(triangle(), companions=[bound(short)])
        buffer = result["buffers"][0]
        self.assertEqual((buffer["status"], buffer["reason"]), ("refused", "COMPANION_SHORTER_THAN_BYTE_LENGTH"))
        self.assertIn("declares 42 bytes but 'tri.bin' has 40", buffer["message"])
        self.assertEqual(result["counts"]["projectedPositions"], 0)
        self.assertEqual(result["primitives"][0]["status"], "unsupported")

    def test_unsafe_uris_refuse_even_when_offered(self):
        for uri in ("../tri.bin", "dir/tri.bin", "dir\\tri.bin", "%2E%2E%2Ftri.bin", "a%2Ftri.bin",
                    "https://127.0.0.1/tri.bin", "file:///C:/tri.bin", "C:tri.bin", "tri.bin?x=1", "tri.bin#x",
                    "..", "tri%zz.bin", "tri%FF.bin", ""):
            with self.subTest(uri=uri):
                self.assertIsNone(reader.companion_name(uri))
                result = reader.inspect_gltf(triangle(uri), companions=[bound(uri=uri)])
                buffer = result["buffers"][0]
                self.assertEqual((buffer["status"], buffer["reason"]), ("refused", "EXTERNAL_URI_NOT_PLAIN_NAME"))
                self.assertIn(repr(uri), buffer["message"])
                self.assertEqual(result["counts"]["projectedPositions"], 0)

    def test_ambiguous_and_mismatched_bindings_refuse(self):
        result = reader.inspect_gltf(triangle(), companions=[{"bufferIndex": 0, "uri": "tri.bin", "state": "ambiguous"}])
        self.assertEqual(result["buffers"][0]["reason"], "COMPANION_AMBIGUOUS")
        self.assertIn("Several retained files are named 'tri.bin'", result["buffers"][0]["message"])
        result = reader.inspect_gltf(triangle(), companions=[bound(uri="other.bin")])
        self.assertEqual(result["buffers"][0]["reason"], "COMPANION_URI_MISMATCH")

    def test_hash_budget_and_index_guards(self):
        wrong = dict(bound(), sha256="0" * 64)
        with self.assertRaises(reader.GltfError) as caught:
            reader.inspect_gltf(triangle(), companions=[wrong])
        self.assertEqual(caught.exception.code, "COMPANION_HASH")
        with patch.object(reader, "MAX_INPUT_BYTES", len(triangle()) + len(BIN) - 1):
            with self.assertRaises(reader.GltfError) as caught:
                reader.inspect_gltf(triangle(), companions=[bound()])
        self.assertEqual(caught.exception.code, "INPUT_LIMIT")
        with self.assertRaises(reader.GltfError) as caught:
            reader.inspect_gltf(triangle(), companions=[bound(index=1)])
        self.assertEqual(caught.exception.code, "COMPANION_BINDING")

    def test_worker_reads_manifest_files(self):
        raw = triangle()
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / "source.bin").write_bytes(raw)
            (folder / "companion-0.bin").write_bytes(BIN)
            entry = {key: value for key, value in bound().items() if key != "data"}
            (folder / "companions.json").write_text(json.dumps([{**entry, "path": str(folder / "companion-0.bin")}]))
            code = reader._worker(str(folder / "source.bin"), str(folder / "gltf.json"),
                                  hashlib.sha256(raw).hexdigest(), None, str(folder / "companions.json"))
            self.assertEqual(code, 0)
            result = json.loads((folder / "gltf.json").read_text(encoding="utf-8"))
            self.assertEqual(result["counts"]["projectedPositions"], 3)
            self.assertEqual(result["buffers"][0]["binding"]["sha256"], entry["sha256"])
            self.assertEqual((folder / "companion-0.bin").read_bytes(), BIN)

    @unittest.skipUnless(sys.platform == "win32", "Windows Job profile only")
    def test_supervised_cli_reads_bound_original_by_hash(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("gltf_cli_gb1", ROOT / "scripts/usp/desktop-gltf-read.py")
        cli = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cli)
        raw = triangle()
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / "scene.gltf").write_bytes(raw)
            (folder / "retained-bin").write_bytes(BIN)
            entry = {key: value for key, value in bound().items() if key != "data"}
            manifest = folder / "companions.json"
            manifest.write_text(json.dumps([{**entry, "path": str(folder / "retained-bin")}]))
            args = [str(folder / "scene.gltf"), "--expected-sha256", hashlib.sha256(raw).hexdigest(),
                    "--output-dir", str(folder / "out"), "--companions", str(manifest)]
            self.assertEqual(cli.main(args), 0)
            result = json.loads((folder / "out/gltf.json").read_text(encoding="utf-8"))
            receipt = json.loads((folder / "out/receipt.json").read_text(encoding="utf-8"))
            self.assertEqual(result["counts"]["projectedPositions"], 3)
            self.assertEqual(receipt["companions"], [entry])
            self.assertEqual((folder / "retained-bin").read_bytes(), BIN)
            manifest.write_text(json.dumps([{**entry, "sha256": "0" * 64, "path": str(folder / "retained-bin")}]))
            args[4] = str(folder / "out-wrong")
            with patch.object(cli, "_supervise", side_effect=AssertionError("A changed companion must not launch")):
                self.assertEqual(cli.main(args), 2)
            self.assertFalse((folder / "out-wrong").exists())


if __name__ == "__main__":
    unittest.main()
