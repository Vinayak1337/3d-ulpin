"""B3D1. Building ground outlines from the real D1 3DBAG CityJSON (test_only), through the native conversion."""
import hashlib
import json
from pathlib import Path

from geo.area import normalize_area
from geo.cityjson_outline import LAYER, stated_epsg
from geo.native_cityjson import read_cityjson
from geo.native_gis import convert_native_file

D1 = Path(__file__).resolve().parents[3] / "fixtures" / "usp" / "D1" / "single-roof" / "original.json"
BUILDING = "NL.IMBAG.Pand.1655100000500568"


def convert(tmp_path, document, run="run"):
    raw = json.dumps(document).encode("utf-8")
    folder = tmp_path / run
    folder.mkdir()
    path = folder / "original.json"
    path.write_bytes(raw)
    out = folder / "out"
    out.mkdir()
    [layer] = convert_native_file(path, "cityjson", out, hashlib.sha256(raw).hexdigest())
    return layer


def d1():
    return json.loads(D1.read_bytes())


def written(layer):
    collection = json.loads(Path(layer["geojson"]["path"]).read_bytes())
    sidecar = [json.loads(line) for line in Path(layer["sidecar"]["path"]).read_text("utf-8").splitlines()]
    return collection, sidecar


def test_the_building_lod0_footprint_becomes_one_outline_in_the_horizontal_part_of_the_stated_code(tmp_path):
    document = d1()
    layer = convert(tmp_path, document)
    assert {key: layer[key] for key in ("layer", "state", "crs", "crsSource", "features", "notWritten")} == {
        "layer": LAYER, "state": "converted", "crs": "EPSG:28992", "crsSource": "stated", "features": 1,
        "notWritten": 0}
    assert layer["crsBasis"] == "EPSG:28992, the horizontal part of the EPSG:7415 the file states"
    collection, sidecar = written(layer)
    assert collection["crs"] == {"type": "name", "properties": {"name": "EPSG:28992"}}
    [feature] = collection["features"]
    reading = read_cityjson(json.dumps(document).encode("utf-8"))
    footprint = reading["objects"][0]["geometries"][0]
    face = document["feature"]["CityObjects"][BUILDING]["geometry"][0]["boundaries"][0]
    expected = [[reading["decodedVertices"][index] for index in ring + ring[:1]] for ring in face]
    assert feature["geometry"] == {"type": "Polygon", "coordinates": expected}
    assert feature["properties"] == {"cityObjectId": BUILDING, "cityObjectType": "Building",
                                     "outlineBasis": "lod0_footprint", "lod": "0",
                                     "geometryPointer": footprint["pointer"]}
    assert sidecar[0]["readerVersion"] == "cityjson-ground-outline/1" and sidecar[0]["format"] == "cityjson"
    assert sidecar[1:] == [{"feature": 0, "position": f"/feature/CityObjects/{BUILDING}"}]


def test_the_outline_reads_as_a_building_with_its_heights_beside_it_and_no_height_measured(tmp_path):
    layer = convert(tmp_path, d1())
    collection, _ = written(layer)
    normalized = normalize_area({"format": "geojson", "data": collection,
                                 "mapping": {"kind": "building", "idField": "cityObjectId"}})
    [feature] = normalized["features"]
    assert feature["sourceKey"] == BUILDING and feature["kind"] == "building"
    assert feature["sourceHeights"]["unit"] is None and feature["sourceHeights"]["reference"] is None
    assert feature["height"]["state"] == "unknown" and feature["height"]["value"] is None


def test_without_its_own_footprint_a_building_takes_the_ground_surface_of_its_first_geometry_holding_one(tmp_path):
    # Control from the real D1 literals: the part's LoD 1.2 Solid is moved onto the Building in place of its LoD0.
    document = d1()
    objects = document["feature"]["CityObjects"]
    part = objects[f"{BUILDING}-0"]
    objects[BUILDING]["geometry"] = [part.pop("geometry")[0]]
    layer = convert(tmp_path, document)
    collection, _ = written(layer)
    [feature] = collection["features"]
    assert feature["properties"]["outlineBasis"] == "ground_surface"
    assert feature["properties"]["lod"] == "1.2"
    assert feature["geometry"]["type"] == "Polygon"


def test_a_building_with_no_outline_of_its_own_is_named_in_the_sidecar_and_parts_are_not_composed(tmp_path):
    document = d1()
    del document["feature"]["CityObjects"][BUILDING]["geometry"]
    layer = convert(tmp_path, document)
    assert layer["state"] == "not_converted"
    assert layer["reason"] == "holds no Building with a LoD0 footprint or GroundSurface of its own"


def test_a_file_stating_no_system_or_a_local_one_stays_unplaced_and_says_so(tmp_path):
    absent = d1()
    del absent["metadata"]["metadata"]["referenceSystem"]
    layer = convert(tmp_path, absent)
    assert layer == {"layer": LAYER, "ordinal": 0, "state": "not_converted",
                     "reason": "states no coordinate reference system, so its outlines stay unplaced"}
    local = d1()
    local["metadata"]["metadata"]["referenceSystem"] = "#local-engineering"
    layer = convert(tmp_path, local, "local")
    assert layer["state"] == "not_converted"
    assert layer["reason"] == ("states a coordinate reference system that is not an EPSG code, "
                               "so its outlines stay unplaced")
    unknown = d1()
    unknown["metadata"]["metadata"]["referenceSystem"] = "https://www.opengis.net/def/crs/EPSG/0/4979"
    layer = convert(tmp_path, unknown, "unknown")
    assert layer["reason"] == ("states EPSG:4979, which has no two-dimensional horizontal system "
                               "the reader knows, so its outlines stay unplaced")


def test_a_file_the_cityjson_reader_refuses_is_not_converted_with_the_reader_code(tmp_path):
    broken = d1()
    broken["feature"]["vertices"][0] = [1, 2]
    layer = convert(tmp_path, broken)
    assert layer["reason"] == "was not read by the CityJSON reader (VERTEX)"


def test_only_literal_epsg_forms_are_codes():
    assert stated_epsg("https://www.opengis.net/def/crs/EPSG/0/7415") == 7415
    assert stated_epsg("urn:ogc:def:crs:EPSG::28992") == 28992
    assert stated_epsg("EPSG:32643") == 32643
    for literal in ("#local-CRS-1", "EPSG:0", "epsg:7415 ", "urn:ogc:def:crs,crs:EPSG::25832,crs:EPSG::5783", None,
                    7415):
        assert stated_epsg(literal) is None
