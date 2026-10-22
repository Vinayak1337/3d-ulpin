"""Shapefile dimension regressions; generated coordinates are synthetic, never survey evidence."""
import hashlib
import json
import struct
import zipfile
from pathlib import Path

import pytest
import shapefile
from pyproj import CRS

from geo.area import normalize_area
from geo.native_gis import convert_native_file


TWEED = Path(
    "E:/BhuAayam-data/datasets/map-formats/tweed-shire-council/"
    "TSC_Buildings_OD_8831041243266425049.zip"
)
REFUSAL = "stores M or MultiPatch shapes, or its shapes and records differ in number"
# Clockwise exteriors, counterclockwise hole; each Z is only an unqualified source coordinate.
OUTER = [[500000, 3100000, 10], [500000, 3100020, 11], [500020, 3100020, 12],
         [500020, 3100000, 13], [500000, 3100000, 10]]
HOLE = [[500005, 3100005, 20], [500010, 3100005, 21], [500010, 3100010, 22],
        [500005, 3100010, 23], [500005, 3100005, 20]]
OTHER = [[point[0] + 30, point[1], point[2] + 30] for point in OUTER]


def fixture_zip(tmp_path: Path, shape_type: int, measured: bool = False) -> Path:
    base = tmp_path / "layer"
    with shapefile.Writer(str(base), shapeType=shape_type) as writer:
        writer.field("source_id", "N")
        if shape_type == 11:
            writer.pointz(*OUTER[0])
        elif shape_type == 13:
            writer.linez([OUTER[:3], OTHER[:3]])
        elif shape_type == 15:
            rings = [OUTER, HOLE, OTHER]
            if measured:
                rings = [[point + [7] for point in ring] for ring in rings]
            writer.polyz(rings)
        elif shape_type == 21:
            writer.pointm(500000, 3100000, 7)
        elif shape_type == 23:
            writer.linem([OUTER[:3]])
        elif shape_type == 25:
            writer.polym([OUTER])
        else:
            writer.multipatch([OUTER], [shapefile.OUTER_RING])
        writer.record(1)
    path = tmp_path / "layer.zip"
    with zipfile.ZipFile(path, "w") as archive:
        for suffix in (".shp", ".shx", ".dbf"):
            archive.write(base.with_suffix(suffix), "layer" + suffix)
        archive.writestr("layer.prj", CRS.from_epsg(32643).to_wkt())
    return path


def convert(path: Path, tmp_path: Path, answers: dict | None = None) -> tuple[dict, dict, list]:
    folder = tmp_path / "out"
    folder.mkdir()
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    [layer] = convert_native_file(path, "shapefile_zip", folder, digest, answers)
    assert hashlib.sha256(path.read_bytes()).hexdigest() == digest
    if layer["state"] != "converted":
        return layer, {}, []
    collection = json.loads(Path(layer["geojson"]["path"]).read_text(encoding="utf-8"))
    sidecar = [json.loads(line) for line in Path(layer["sidecar"]["path"]).read_text(encoding="utf-8").splitlines()]
    return layer, collection, sidecar


def rewrite_member(path: Path, target: Path, suffix: str, replacement: bytes) -> Path:
    with zipfile.ZipFile(path) as source, zipfile.ZipFile(target, "w") as archive:
        for entry in source.infolist():
            raw = replacement if entry.filename.lower().endswith(suffix) else source.read(entry)
            archive.writestr(entry.filename, raw)
    return target


def test_polygon_z_reaches_geojson_source_heights_without_a_height_measurement(tmp_path: Path) -> None:
    path = fixture_zip(tmp_path, 15)
    layer, collection, sidecar = convert(path, tmp_path)
    assert (layer["state"], layer["crs"], layer["features"], layer["notWritten"]) == (
        "converted", "EPSG:32643", 1, 0
    )
    [feature] = collection["features"]
    assert feature["geometry"] == {"type": "MultiPolygon", "coordinates": [[OUTER, HOLE], [OTHER]]}
    assert feature["properties"] == {"source_id": 1}
    assert sidecar[1:] == [{"feature": 0, "position": 0}]
    assert sidecar[0]["originalSha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    result = normalize_area({"format": "geojson", "data": collection,
                             "mapping": {"kind": "building", "idField": "source_id"},
                             "worldStatus": "synthetic"})
    [normalized] = result["features"]
    assert normalized["sourceHeights"] == {"positions": 15, "min": 10, "max": 43,
                                           "unit": None, "reference": None, "basis": "source_coordinates"}
    assert normalized["height"]["state"] == "unknown" and normalized["height"]["value"] is None
    assert "floors" not in normalized
    assert normalized["sourceGeometry"] == feature["geometry"]
    assert all(len(point) == 2 for polygon in normalized["geometry"]["coordinates"]
               for ring in polygon for point in ring)


@pytest.mark.parametrize("shape_type,kind,coordinates", [
    (11, "Point", OUTER[0]),
    (13, "MultiLineString", [OUTER[:3], OTHER[:3]]),
])
def test_point_and_line_z_keep_their_third_coordinates(
    tmp_path: Path, shape_type: int, kind: str, coordinates: list
) -> None:
    layer, collection, _ = convert(fixture_zip(tmp_path, shape_type), tmp_path)
    assert layer["state"] == "converted"
    assert collection["features"][0]["geometry"] == {"type": kind, "coordinates": coordinates}


@pytest.mark.parametrize("shape_type", [21, 23, 25, 31])
def test_m_and_multipatch_still_have_the_existing_refusal(tmp_path: Path, shape_type: int) -> None:
    layer, collection, _ = convert(fixture_zip(tmp_path, shape_type), tmp_path)
    assert (layer["state"], layer["reason"]) == ("not_converted", REFUSAL)
    assert collection == {} and "geojson" not in layer


def test_polygon_z_with_populated_m_is_not_silently_flattened(tmp_path: Path) -> None:
    layer, _, _ = convert(fixture_zip(tmp_path, 15, measured=True), tmp_path)
    assert (layer["state"], layer["reason"]) == (
        "not_converted", "stores measure (M) values on a Z shape; they will not be dropped"
    )


def test_a_2d_record_in_a_z_layer_is_refused_as_mixed(tmp_path: Path) -> None:
    path = fixture_zip(tmp_path, 15)
    with zipfile.ZipFile(path) as archive:
        raw = bytearray(archive.read("layer.shp"))
    struct.pack_into("<i", raw, 108, 5)
    mixed = rewrite_member(path, tmp_path / "mixed.zip", ".shp", bytes(raw))
    layer, _, _ = convert(mixed, tmp_path)
    assert (layer["state"], layer["reason"]) == (
        "not_converted", "stores mixed shape types; no dimensions will be dropped"
    )


def test_an_unresolvable_prj_is_not_replaced_by_an_officer_answer(tmp_path: Path) -> None:
    path = fixture_zip(tmp_path, 15)
    unresolved = rewrite_member(path, tmp_path / "unresolved.zip", ".prj", b"Unresolvable system")
    layer, collection, _ = convert(unresolved, tmp_path, {"layer": "EPSG:32643"})
    assert (layer["state"], layer["statesCrs"], layer["reason"]) == (
        "crs_unstated", True, "states a coordinate reference system that does not resolve to one EPSG code"
    )
    assert collection == {} and "geojson" not in layer


@pytest.mark.skipif(not TWEED.exists(), reason="public test_only Tweed shapefile original is unavailable")
def test_real_2d_shapefile_still_converts_with_its_record_locators(tmp_path: Path) -> None:
    layer, collection, sidecar = convert(TWEED, tmp_path)
    assert (layer["state"], layer["features"], layer["crs"]) == ("converted", 88, "EPSG:28356")
    assert len(collection["features"]) == 88
    assert [line["position"] for line in sidecar[1:]] == list(range(88))


@pytest.mark.skipif(not TWEED.exists(), reason="public test_only Tweed shapefile original is unavailable")
def test_real_shapefile_copy_with_unresolvable_prj_is_kept_not_converted(tmp_path: Path) -> None:
    path = rewrite_member(TWEED, tmp_path / "unresolved.zip", ".prj", b"Unresolvable system")
    layer, _, _ = convert(path, tmp_path, {"Council_Buildings": "EPSG:28356"})
    assert (layer["state"], layer["statesCrs"]) == ("crs_unstated", True)
    assert "does not resolve to one EPSG code" in layer["reason"]
    assert "geojson" not in layer
