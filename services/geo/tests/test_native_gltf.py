"""Focused source/bounds controls using two unchanged upstream Box originals.

Set GLTF_TEST_SOURCE_ROOT to their private originals directory. Adverse inputs
are transient byte/declaration mutations of those graphics test inputs; they
are neither retained operational records nor source/accuracy qualification.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "services/geo"))
from geo import native_gltf as reader

spec = importlib.util.spec_from_file_location("gltf_cli", ROOT / "scripts/usp/desktop-gltf-read.py")
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


def glb(document, binary):
    block = json.dumps(document, allow_nan=False).encode("utf-8")
    block += b" " * (-len(block) % 4)
    binary += b"\0" * (-len(binary) % 4)
    return (struct.pack("<4sII", b"glTF", 2, 28 + len(block) + len(binary)) +
            struct.pack("<II", len(block), 0x4E4F534A) + block +
            struct.pack("<II", len(binary), 0x004E4942) + binary)


class NativeGltfTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source_root = os.environ.get("GLTF_TEST_SOURCE_ROOT")
        if not source_root:
            raise unittest.SkipTest("Private unchanged upstream inputs are required.")
        cls.source_root = Path(source_root)
        cls.raw = (cls.source_root / "Box.glb").read_bytes()
        cls.external = (cls.source_root / "Box.gltf").read_bytes()
        if hashlib.sha256(cls.raw).hexdigest() != "ed52f7192b8311d700ac0ce80644e3852cd01537e4d62241b9acba023da3d54e":
            raise AssertionError("Retained Box GLB differs from the pinned original.")
        if hashlib.sha256(cls.external).hexdigest() != "4a0d69eecfce0672a50b71dc218cbacec6c53fe2445040c235c6314b1b2c41b9":
            raise AssertionError("Retained Box glTF differs from the pinned original.")
        json_raw, binary, _, _ = reader._container(cls.raw)
        cls.document, cls.binary = json.loads(json_raw), bytes(binary[0])

    def error(self, code, raw):
        with self.assertRaises(reader.GltfError) as caught:
            reader.inspect_gltf(raw)
        self.assertEqual(caught.exception.code, code)

    def test_original_projection_and_exact_spans(self):
        result = reader.inspect_gltf(self.raw)
        self.assertEqual(result["status"], "inspected_local")
        self.assertEqual(result["sourceSha256"], hashlib.sha256(self.raw).hexdigest())
        self.assertEqual(result["counts"], {"nodes": 2, "primitives": 1, "projectedPositions": 24, "projectedIndices": 36})
        self.assertEqual(result["nodes"][0]["transform"]["declarations"]["matrix"], self.document["nodes"][0]["matrix"])
        self.assertEqual(result["nodes"][1]["transform"]["declarations"], {})
        self.assertFalse(result["qualification"]["analyticalGeometry"])
        projection = result["primitives"][0]["projection"]
        for field, fmt in (("POSITION", "<fff"), ("indices", "<H")):
            locator = projection[field]["locator"]
            start, size, stride = locator["originalByteOffset"], locator["byteSpan"], locator["byteStride"]
            self.assertEqual(hashlib.sha256(self.raw[start:start + size]).hexdigest(), locator["referencedSpanSha256"])
            for index, values in enumerate(projection[field]["values"]):
                decoded = struct.unpack_from(fmt, self.raw, start + index * stride)
                self.assertEqual(list(decoded) if field == "POSITION" else decoded[0], values)

    def test_embedded_and_external_no_resolution(self):
        document = copy.deepcopy(self.document)
        document["buffers"][0]["uri"] = "data:application/octet-stream;base64," + base64.b64encode(self.binary).decode("ascii")
        embedded = reader.inspect_gltf(json.dumps(document).encode())
        locator = embedded["primitives"][0]["projection"]["POSITION"]["locator"]
        self.assertIsNone(locator["originalByteOffset"])
        self.assertEqual(locator["bufferOrigin"]["uriPointer"], "/buffers/0/uri")
        self.assertEqual(embedded["primitives"][0]["projection"]["POSITION"]["values"],
                         reader.inspect_gltf(self.raw)["primitives"][0]["projection"]["POSITION"]["values"])
        with patch("builtins.open", side_effect=AssertionError("Input must not resolve a path")):
            external = reader.inspect_gltf(self.external)
        self.assertEqual(external["status"], "inspected_partial")
        self.assertEqual(external["geometryProjectionStatus"], "unavailable")
        self.assertEqual(external["counts"]["projectedPositions"], 0)
        self.assertEqual(external["buffers"][0]["uri"], "Box0.bin")
        self.assertFalse(external["buffers"][0]["fetched"])
        for uri in ("../../private.bin", "https://127.0.0.1/secret", "file:///C:/private.bin"):
            document["buffers"][0]["uri"] = uri
            observed = reader.inspect_gltf(json.dumps(document).encode())
            self.assertEqual(observed["buffers"][0]["status"], "needs_input")
        document = copy.deepcopy(self.document)
        document["images"] = [{"uri": "https://127.0.0.1/private.png"}]
        document["textures"] = [{"source": 0}]
        with patch("builtins.open", side_effect=AssertionError("No image resolution")):
            resource = reader.inspect_gltf(glb(document, self.binary))
        self.assertEqual(resource["resources"]["images"][0]["dependency"]["status"], "needs_input")
        self.assertEqual(resource["resources"]["textures"][0]["contentStatus"], "unsupported_not_rendered")

    def test_bounds_nonfinite_index_and_unsupported(self):
        document = copy.deepcopy(self.document)
        document["accessors"][2]["count"] = reader.MAX_POSITIONS + 1
        self.error("POSITION_LIMIT", glb(document, self.binary))
        document = copy.deepcopy(self.document)
        document["accessors"][2]["byteOffset"] = 576
        self.error("ACCESSOR_BOUNDS", glb(document, self.binary))
        document = copy.deepcopy(self.document)
        document["bufferViews"][1]["byteStride"] = 8
        self.error("ACCESSOR_ALIGNMENT", glb(document, self.binary))
        binary = bytearray(self.binary)
        struct.pack_into("<f", binary, 288, float("nan"))
        self.error("NONFINITE_BUFFER", glb(self.document, bytes(binary)))
        binary = bytearray(self.binary)
        struct.pack_into("<H", binary, 576, 24)
        self.error("INDEX_RANGE", glb(self.document, bytes(binary)))
        document = copy.deepcopy(self.document)
        document["accessors"][2]["sparse"] = {}
        sparse = reader.inspect_gltf(glb(document, self.binary))
        self.assertEqual(sparse["primitives"][0]["projection"]["POSITION"]["reason"], "SPARSE_ACCESSOR")
        self.assertEqual(sparse["geometryProjectionStatus"], "unavailable")
        document = copy.deepcopy(self.document)
        document["extensionsUsed"] = document["extensionsRequired"] = ["KHR_draco_mesh_compression"]
        unsupported = reader.inspect_gltf(glb(document, self.binary))
        self.assertIsNone(unsupported["primitives"][0]["projection"])
        self.assertEqual(unsupported["primitives"][0]["reason"], "UNSUPPORTED_REQUIRED_EXTENSIONS")

    def test_scene_and_json_structure_controls(self):
        document = copy.deepcopy(self.document)
        document["nodes"][1]["children"] = [0]
        self.error("NODE_CYCLE", glb(document, self.binary))
        document = copy.deepcopy(self.document)
        document["nodes"][1]["mesh"] = 1
        self.error("INTEGER_RANGE", glb(document, self.binary))
        document = copy.deepcopy(self.document)
        document["nodes"] = [{"children": [i - 1]} if i else {} for i in range(65)]
        document["scenes"][0]["nodes"] = [64]
        self.error("NODE_DEPTH", glb(document, self.binary))
        document = copy.deepcopy(self.document)
        document.pop("scene")
        self.assertEqual(reader.inspect_gltf(glb(document, self.binary))["selectedScene"]["origin"], "absent")
        self.assertEqual(reader.inspect_gltf(glb(document, self.binary), selected_scene=0)["selectedScene"]["origin"], "caller")
        self.error("DUPLICATE_KEY", b'{"asset":{},"asset":{}}')
        self.error("DEPTH_LIMIT", b"[" * 65 + b"0" + b"]" * 65)
        self.error("GLB_HEADER", self.raw[:-1])
        self.error("BUFFER_LIMIT", glb({**self.document, "buffers": [{"byteLength": 16 * 1024**2}, {"byteLength": 1}]}, self.binary))

    def test_output_bound(self):
        result = reader.inspect_gltf(self.raw)
        with patch.object(reader, "MAX_OUTPUT_BYTES", 100):
            with self.assertRaises(reader.GltfError) as caught:
                reader.write_inspection(result, io.BytesIO())
        self.assertEqual(caught.exception.code, "OUTPUT_LIMIT")

    def test_reserved_unsigned_indices(self):
        source = os.environ.get("GLTF_TEST_RESERVED_INDEX_SOURCE")
        if not source:
            self.skipTest("Retained reviewer reserved-index input is required.")
        raw = Path(source).read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),
                         "cea62fcd4c8a06037c7080f9dde3769a18132493361ee89e6c5766b359903bc7")
        self.error("RESERVED_INDEX", raw)
        json_raw, binary, _, _ = reader._container(raw)
        document, binary = json.loads(json_raw), bytes(binary[0])
        index_accessor = document["meshes"][0]["primitives"][0]["indices"]
        index_view = document["accessors"][index_accessor]["bufferView"]
        for component, fmt, reserved in ((5121, "B", 255), (5123, "H", 65535), (5125, "I", 4294967295)):
            with self.subTest(componentType=component):
                mutated = copy.deepcopy(document)
                payload = struct.pack("<" + fmt * 3, 0, 1, reserved)
                mutated["accessors"][index_accessor].update(componentType=component, byteOffset=0, max=[reserved])
                mutated["bufferViews"][index_view].update(byteOffset=len(binary), byteLength=len(payload))
                mutated["buffers"][0]["byteLength"] = len(binary) + len(payload)
                self.error("RESERVED_INDEX", glb(mutated, binary + payload))
        # Adjacent unsigned-byte value is valid with the retained 256 positions.
        mutated = copy.deepcopy(document)
        mutated["bufferViews"][index_view].update(byteOffset=len(binary), byteLength=3)
        mutated["buffers"][0]["byteLength"] = len(binary) + 3
        accepted = reader.inspect_gltf(glb(mutated, binary + bytes([0, 1, 254])))
        self.assertEqual(accepted["primitives"][0]["status"], "available_local_projection")
        # Non-reserved ordinary out-of-range indices must still fail.
        mutated["accessors"][index_accessor].update(componentType=5123, byteOffset=0, max=[256])
        mutated["bufferViews"][index_view]["byteLength"] = 6
        mutated["buffers"][0]["byteLength"] = len(binary) + 6
        self.error("INDEX_RANGE", glb(mutated, binary + struct.pack("<HHH", 0, 1, 256)))

    @unittest.skipUnless(sys.platform == "win32", "Windows Job profile only")
    def test_supervision_timeout_memory_process_and_gate(self):
        def run(code, **kwargs):
            gate = "import sys\nif sys.stdin.buffer.read(1)!=b'1': raise SystemExit(3)\n" + code
            return cli._supervise([sys._base_executable, "-I", "-S", "-c", gate], **kwargs)
        with self.assertRaisesRegex(ValueError, "deadline"):
            run("import time; time.sleep(10)", timeout=0.15)
        exit_code, output, _, observed = run("x=bytearray(256*1024**2); print('allocated')", memory_bytes=64*1024**2)
        self.assertNotEqual(exit_code, 0)
        self.assertNotIn(b"allocated", output)
        self.assertLessEqual(observed["peakJobPrivateBytes"], 64*1024**2)
        exit_code, output, _, observed = run("import subprocess; subprocess.run([sys.executable,'-I','-S','-c','print(123)'],check=True)")
        self.assertNotEqual(exit_code, 0)
        self.assertNotIn(b"123", output)
        self.assertEqual(observed["activeProcessLimit"], 1)
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "must-not-exist"
            with patch.object(cli, "_WindowsJob", side_effect=OSError("attachment refused")):
                with self.assertRaises(OSError):
                    run("from pathlib import Path; Path(" + repr(str(marker)) + ").write_text('released')")
            self.assertFalse(marker.exists())

    @unittest.skipUnless(sys.platform == "win32", "Windows publication profile only")
    def test_original_lock_and_fresh_hash_guards(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "Box.glb"
            source.write_bytes(self.raw)
            with cli._locked_source(source):
                with self.assertRaises(OSError):
                    source.write_bytes(b"changed")
            self.assertEqual(source.read_bytes(), self.raw)
            output = Path(directory) / "output"
            args = [str(source), "--expected-sha256", "0" * 64, "--output-dir", str(output)]
            with patch.object(cli, "_supervise", side_effect=AssertionError("Wrong hash must not launch")):
                self.assertEqual(cli.main(args), 2)
            self.assertFalse(output.exists())
            output.mkdir()
            args[2] = hashlib.sha256(self.raw).hexdigest()
            with patch.object(cli, "_supervise", side_effect=AssertionError("Existing output must not launch")):
                self.assertEqual(cli.main(args), 2)
            self.assertEqual(list(output.iterdir()), [])
            self.assertEqual(source.read_bytes(), self.raw)


if __name__ == "__main__":
    unittest.main()
