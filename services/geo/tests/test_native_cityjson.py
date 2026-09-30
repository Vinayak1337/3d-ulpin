"""Real-source oracle plus focused integrity/resource regression controls.

Mutated copies are malformed/structural controls only, never property evidence.
"""
import copy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from geo import native_cityjson as reader

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "fixtures/usp/D1/single-roof/original.json"
ORACLE = ROOT / "fixtures/usp/D1/single-roof/expected.json"


def resolve(root, pointer):
    value = root
    for token in pointer.split("/")[1:]:
        token = token.replace("~1", "/").replace("~0", "~")
        value = value[int(token)] if isinstance(value, list) else value[token]
    return value


class NativeCityJSONTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = SOURCE.read_bytes()
        cls.source = json.loads(cls.raw)
        cls.oracle = json.loads(ORACLE.read_bytes())

    def read_copy(self, source):
        return reader.read_cityjson(json.dumps(source, allow_nan=False).encode())

    def test_unchanged_d1_against_independent_oracle(self):
        result = reader.read_cityjson(self.raw)
        expected = self.oracle
        self.assertEqual(result["sourceSha256"], "5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2")
        self.assertEqual(result["sourceDocument"], self.source)
        self.assertEqual(result["vertexCount"], expected["responseEnvelope"]["encodedVertexCount"])
        self.assertEqual(result["sourceDocument"]["metadata"]["transform"], expected["responseEnvelope"]["transform"])
        self.assertEqual(result["frame"]["referenceSystem"], expected["responseEnvelope"]["referenceSystem"])
        for side in ("minimum", "maximum"):
            for actual, value in zip(result["decodedBounds"][side], expected["decodedBoundsEpsg7415Metres"][side]):
                self.assertLessEqual(abs(actual - value), expected["decodedBoundsEpsg7415Metres"]["toleranceMetres"])
        building, part = result["objects"]
        self.assertEqual(building["id"], expected["identity"]["buildingId"])
        self.assertEqual(part["id"], expected["identity"]["buildingPartIds"][0])
        building_native = resolve(result["sourceDocument"], building["pointer"])
        part_native = resolve(result["sourceDocument"], part["pointer"])
        self.assertEqual(building_native["children"], [part["id"]])
        self.assertEqual(part_native["parents"], [building["id"]])
        self.assertIsNone(building_native["attributes"]["b3_bouwlagen"])
        self.assertEqual(result["qualification"]["interiorFloors"], "not_established_by_reader")
        self.assertEqual(result["hierarchyIssues"], [])
        self.assertEqual(building["geometries"][0]["lod"], expected["geometry"]["building"]["lod"])
        self.assertEqual(building["geometries"][0]["surfaceCount"], 1)
        for geometry, solid in zip(part["geometries"], expected["geometry"]["partSolids"]):
            self.assertEqual((geometry["type"], geometry["lod"], geometry["shellCount"], geometry["surfaceCount"], geometry["holeRingCount"]),
                             ("Solid", solid["lod"], solid["shellCount"], solid["faceCount"], solid["holeRings"]))
            roofs, nonhorizontal, roof_sizes = 0, 0, []
            for face in geometry["surfaces"]:
                semantic = resolve(result["sourceDocument"], face["semanticSurfacePointer"])
                if semantic["type"] == "RoofSurface":
                    roofs += 1
                    ring = resolve(result["sourceDocument"], face["ringPointers"][0])
                    roof_sizes.append(len(ring))
                    z = [result["decodedVertices"][i][2] for i in ring]
                    nonhorizontal += max(z) - min(z) > 0.000001
            self.assertEqual(roofs, solid["roofFaces"])
            self.assertEqual(nonhorizontal, solid["nonhorizontalRoofFaces"])
            if solid["lod"] == "2.2":
                self.assertEqual(roof_sizes, solid["roofRingVertexCounts"])
        self.assertEqual(hashlib.sha256(SOURCE.read_bytes()).hexdigest(), result["sourceSha256"])

    def test_malformed_indices_are_rejected_at_exact_locator(self):
        for bad in (True, -1, 62, 1.5):
            with self.subTest(index=bad):
                source = copy.deepcopy(self.source)
                source["feature"]["CityObjects"][self.oracle["identity"]["buildingId"]]["geometry"][0]["boundaries"][0][0][0] = bad
                with self.assertRaises(reader.CityJSONError) as caught:
                    self.read_copy(source)
                self.assertEqual(caught.exception.code, "VERTEX_INDEX")
                self.assertTrue(caught.exception.pointer.endswith("/geometry/0/boundaries/0/0/0"))

    def test_duplicate_keys_and_nonfinite_coordinates_fail(self):
        controls = ((self.raw.replace(b'"feature":', b'"feature":null,"feature":', 1), "DUPLICATE_KEY"),
                    (self.raw.replace(b'[8729,16617,0]', b'[8729,16617,1e400]', 1), "NONFINITE_NUMBER"))
        for raw, code in controls:
            with self.subTest(code=code), self.assertRaises(reader.CityJSONError) as caught:
                reader.read_cityjson(raw)
            self.assertEqual(caught.exception.code, code)

    def test_limits_fail_closed_without_partial_result(self):
        controls = (("MAX_INPUT_BYTES", len(self.raw) - 1, "INPUT_LIMIT"),
                    ("MAX_OBJECTS", 1, "OBJECT_LIMIT"),
                    ("MAX_VERTICES", 61, "VERTEX_LIMIT"),
                    ("MAX_BOUNDARY_INDICES", 7, "BOUNDARY_LIMIT"),
                    ("MAX_OUTPUT_BYTES", 100, "OUTPUT_LIMIT"),
                    ("MAX_SECONDS", 0, "TIME_LIMIT"),
                    ("MAX_DEPTH", 3, "DEPTH_LIMIT"))
        for setting, value, code in controls:
            with self.subTest(setting=setting), patch.object(reader, setting, value):
                with self.assertRaises(reader.CityJSONError) as caught:
                    reader.read_cityjson(self.raw)
                self.assertEqual((caught.exception.status, caught.exception.code), ("limit", code))

    def test_hole_and_null_semantic_preserve_nesting_in_structural_copy(self):
        source = copy.deepcopy(self.source)
        geometry = source["feature"]["CityObjects"][self.oracle["identity"]["buildingPartIds"][0]]["geometry"][0]
        # Reuse existing ring indices solely to check structure retention;
        # this is intentionally not a geometric validity/real-hole assertion.
        geometry["boundaries"][0][0].append(geometry["boundaries"][0][0][0][:3])
        geometry["semantics"]["values"][0][0] = None
        result = self.read_copy(source)
        projected = result["objects"][1]["geometries"][0]
        self.assertEqual(projected["holeRingCount"], 1)
        self.assertEqual(len(projected["surfaces"][0]["ringPointers"]), 2)
        self.assertEqual(projected["surfaces"][0]["semanticState"], "null")
        self.assertEqual(result["sourceDocument"], source)

    def test_unsupported_geometry_retained_and_frames_missing_are_explicit(self):
        source = copy.deepcopy(self.source["feature"])
        geometry = source["CityObjects"][self.oracle["identity"]["buildingId"]]["geometry"][0]
        geometry["type"] = "CompositeSurface"
        result = self.read_copy(source)
        projected = result["objects"][0]["geometries"][0]
        self.assertEqual((result["status"], projected["status"]), ("partial_unsupported", "unsupported"))
        self.assertEqual(resolve(result["sourceDocument"], projected["pointer"]), geometry)
        self.assertEqual(result["transformState"], "absent")
        self.assertEqual(result["frame"]["referenceSystemState"], "absent")
        self.assertEqual(result["decodedVertices"], source["vertices"])
        self.assertEqual(result["frame"]["globalPlacement"], "not_qualified")


if __name__ == "__main__":
    unittest.main()
