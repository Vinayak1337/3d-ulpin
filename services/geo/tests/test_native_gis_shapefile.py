"""Shapefile dimension regressions; generated coordinates are synthetic, never survey evidence."""
import hashlib
import json
import struct
import zipfile
from pathlib import Path

import pytest
import shapefile
from pyproj import CRS

from geo import native_gis
from geo.area import normalize_area
from geo.native_gis import convert_native_file
from geo.validation import InputError


TWEED = Path(
    "E:/BhuAayam-data/datasets/map-formats/tweed-shire-council/"
    "TSC_Buildings_OD_8831041243266425049.zip"
)
# Clockwise exteriors, counterclockwise hole; each Z is only an unqualified source coordinate.
OUTER = [[500000, 3100000, 10], [500000, 3100020, 11], [500020, 3100020, 12],
         [500020, 3100000, 13], [500000, 3100000, 10]]
HOLE = [[500005, 3100005, 20], [500010, 3100005, 21], [500010, 3100010, 22],
        [500005, 3100010, 23], [500005, 3100005, 20]]
OTHER = [[point[0] + 30, point[1], point[2] + 30] for point in OUTER]


def test_only_large_shapefile_set_passes_the_new_source_and_derivative_bounds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Synthetic test_only size control, not survey evidence; only a record or hash block is held at a time."""
    base, records = tmp_path / "test_only", 4500
    with shapefile.Writer(str(base), shapeType=shapefile.POINT) as writer:
        for index in range(128):
            writer.field(f"pad_{index}", "C", size=254)
        for _ in range(records):
            writer.point(*OUTER[0][:2])
            writer.record(*(["x" * 254] * 128))
    base.with_suffix(".prj").write_text(CRS.from_epsg(32643).to_wkt(), encoding="utf-8")

    def digest(path: Path) -> str:
        hashed = hashlib.sha256()
        with path.open("rb") as stream:
            while block := stream.read(1024 * 1024):
                hashed.update(block)
        return hashed.hexdigest()

    members = []
    for index, extension in enumerate(("shp", "shx", "dbf", "prj")):
        path = base.with_suffix(f".{extension}")
        source_id = f"10000000-0000-4000-8000-{index:012d}"
        hashed = digest(path)
        members.append({"extension": extension, "sourceId": source_id, "sha256": hashed,
                        "bytes": path.stat().st_size, "objectKey": f"large-originals/{source_id}/{hashed}"})
    pins = {key: members[0][key] for key in native_gis._PIN_FIELDS}
    request = {**pins, "members": members, "layer": "test_only"}
    old_bound = 128 * 1024 * 1024
    assert native_gis.MAX_SOURCE_BYTES == native_gis.MAX_DERIVATIVE_BYTES == 1024 ** 3
    assert members[0]["bytes"] + members[2]["bytes"] > old_bound
    parts = native_gis._set_parts(request)
    layer = native_gis._shapefile_set_layer(base, "test_only", pins["sha256"], parts, {})
    assert (layer["state"], layer["features"], layer["notWritten"]) == ("converted", records, 0)
    assert layer["geojson"]["bytes"] > old_bound
    for name in ("geojson", "sidecar"):
        entry = layer[name]
        path = Path(entry["path"])
        assert (entry["bytes"], entry["sha256"]) == (path.stat().st_size, digest(path))
    assert all(digest(base.with_suffix(f".{part['extension']}")) == part["sha256"] for part in members)
    with monkeypatch.context() as old:
        old.setattr(native_gis, "MAX_SOURCE_BYTES", old_bound)
        with pytest.raises(InputError, match=str(old_bound)):
            native_gis._pins(*(members[2][key] for key in native_gis._PIN_FIELDS))
    with pytest.raises(InputError, match="1 GiB"):
        native_gis._pins(pins["sourceId"], pins["objectKey"], pins["sha256"], 1024 ** 3 + 1)


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
        elif shape_type == 18:
            writer.multipointz([OUTER[0], OTHER[0]])
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


@pytest.mark.parametrize("shape_type", [18, 21, 23, 25, 31])
def test_unsupported_shape_type_is_named_and_still_refused(tmp_path: Path, shape_type: int) -> None:
    path = fixture_zip(tmp_path, shape_type)
    if shape_type == 18:
        with zipfile.ZipFile(path) as archive:
            with shapefile.Reader(shp=archive.open("layer.shp"), shx=archive.open("layer.shx"),
                                  dbf=archive.open("layer.dbf")) as reader:
                assert reader.numShapes == reader.numRecords == 1
                assert all(value is None for value in reader.shape(0).m)
    layer, collection, _ = convert(path, tmp_path)
    assert (layer["state"], layer["reason"]) == (
        "not_converted", f"stores unsupported shape type {shape_type} ({shapefile.SHAPETYPE_LOOKUP[shape_type]})"
    )
    assert collection == {} and "geojson" not in layer


def test_mismatched_shape_and_record_counts_keep_their_own_refusal(tmp_path: Path) -> None:
    path = fixture_zip(tmp_path, 15)
    with zipfile.ZipFile(path) as archive:
        raw = bytearray(archive.read("layer.dbf"))
    struct.pack_into("<I", raw, 4, 0)
    mismatched = rewrite_member(path, tmp_path / "mismatched.zip", ".dbf", bytes(raw))
    layer, collection, _ = convert(mismatched, tmp_path)
    assert (layer["state"], layer["reason"]) == (
        "not_converted", "its shapes and records differ in number"
    )
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
