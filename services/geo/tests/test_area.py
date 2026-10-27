"""Synthetic coordinates test adapter correctness, never real survey evidence."""
import base64
import copy
import io
import json
import zipfile
from pathlib import Path
from unittest.mock import Mock

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pyproj import Transformer
from pyproj.exceptions import ProjError
from pypdf import PdfWriter
from shapely.geometry import shape
from shapely.ops import transform as scalar_transform

from geo import area
from geo.area import _transform, check_area, extract_document, normalize_area, resolve_geojson_crs
from geo.validation import InputError


REFERENCE = {"sourceCrs": "EPSG:32643", "analysisCrs": "EPSG:32643", "origin": [500000, 3100000]}


def test_equal_area_imagery_reference_keeps_a_bounded_explicit_metre_crs():
    from geo.area import _analysis_crs
    assert _analysis_crs("EPSG:6933").to_epsg() == 6933
    assert all(axis.unit_name == "metre" for axis in _analysis_crs("EPSG:6933").axis_info)
    with pytest.raises(InputError):
        _analysis_crs("EPSG:3857")


def ring(x=0, y=0, width=10, height=10):
    return [[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]]


def polygon(x=0, y=0, width=10, height=10):
    return {"type": "Polygon", "coordinates": [ring(x, y, width, height)]}


def arcgis(features=None, **mapping):
    return {"format": "arcgis", "data": {"spatialReference": {"wkid": 32643}, "features": features or [
        {"attributes": {"OBJECTID": 1}, "geometry": {"rings": [ring(500000, 3100000)]}},
        {"attributes": {"OBJECTID": 2}, "geometry": {"rings": [ring(500100, 3100000)]}},
    ]}, "mapping": {"kind": "building", "idField": "OBJECTID", **mapping}, "reference": copy.deepcopy(REFERENCE), "worldStatus": "synthetic"}


def geojson(geometry=None, **mapping):
    return {"format": "geojson", "data": {"type": "FeatureCollection", "features": [
        {"type": "Feature", "id": "B1", "properties": {}, "geometry": geometry or polygon(77, 28, .0001, .0001)},
    ]}, "mapping": {"kind": "building", **mapping}, "worldStatus": "synthetic"}


def check(features):
    return check_area({"reference": REFERENCE, "features": features})


def record(identifier, kind="building", geometry=None, world="observed"):
    return {"id": identifier, "kind": kind, "geometry": geometry or polygon(), "worldStatus": world,
            "height": {"state": "unknown", "value": None, "unit": "m"}}


def test_shared_origin_retains_building_spacing_and_unknown_height():
    result = normalize_area(arcgis())
    first, second = result["features"]
    assert result["reference"]["origin"] == [500000, 3100000]
    assert first["geometry"]["coordinates"][0][0] == [0, 0]
    assert second["geometry"]["coordinates"][0][0] == [100, 0]
    assert result["extent"] == [0, 0, 110, 10]
    assert first["areaM2"] == 100
    assert first["height"]["value"] is None
    assert first["height"]["state"] == "unknown"
    assert first["worldStatus"] == "synthetic"
    assert first["sourceGeometry"] == arcgis()["data"]["features"][0]["geometry"]
    assert any("footprint-only" in warning for warning in result["warnings"])


def test_geojson_uses_real_projected_metres_and_roundtrip_anchor():
    result = normalize_area(geojson())
    reference, feature = result["reference"], result["features"][0]
    assert reference["sourceCrs"] == "EPSG:4326"
    assert reference["analysisCrs"] == "EPSG:32643"
    assert 8 < result["extent"][2] < 12
    assert 10 < result["extent"][3] < 13
    projector = Transformer.from_crs(4326, 32643, always_xy=True)
    projected_anchor = projector.transform(*reference["anchor"])
    assert projected_anchor == pytest.approx(reference["origin"], abs=1e-7)
    assert feature["geographicGeometry"] == geojson()["data"]["features"][0]["geometry"]
    assert 90 < feature["areaM2"] < 125


def test_transform_keeps_pyproj_failure_words():
    operation = Transformer.from_crs(4326, 32643, always_xy=True)
    with pytest.raises(InputError) as caught:
        _transform(shape({"type": "Point", "coordinates": [77, 95]}), operation)
    assert str(caught.value) == "Coordinate transformation failed; verify source CRS and extent."
    failing = Mock()
    failing.transform.side_effect = ProjError("operation unavailable")
    with pytest.raises(InputError) as caught:
        _transform(shape({"type": "Point", "coordinates": [77, 28]}), failing)
    assert str(caught.value) == "Coordinate transformation failed; verify source CRS and extent."


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -float("inf")])
@pytest.mark.parametrize("axis", [0, 1])
def test_transform_still_refuses_nonfinite_results_with_the_same_error(bad, axis):
    operation = Mock()
    coordinates = [[77.0], [28.0]]
    coordinates[axis] = [bad]
    operation.transform.return_value = coordinates
    # The existing JSON-safe conversion refuses these before geometric validation.
    with pytest.raises(ValueError) as caught:
        _transform(shape({"type": "Point", "coordinates": [77, 28]}), operation)
    with pytest.raises(ValueError) as original:
        json.dumps(bad, allow_nan=False)
    assert type(caught.value) is type(original.value)
    assert str(caught.value) == str(original.value)


def test_transform_calls_pyproj_once_with_whole_xy_arrays():
    geometry = shape({"type": "MultiPolygon", "coordinates": [
        [ring(77, 28, .0002, .0002), ring(77.00005, 28.00005, .00005, .00005)],
        [ring(77.0003, 28, .0001, .0001)],
    ]})
    original_wkb = geometry.wkb
    operation = Transformer.from_crs(4326, 32643, always_xy=True)
    expected = scalar_transform(lambda x, y: operation.transform(x, y, errcheck=True), geometry)
    calls = []

    def project(x, y, *, errcheck):
        assert isinstance(x, np.ndarray) and isinstance(y, np.ndarray)
        assert x.shape == y.shape == (15,)
        assert errcheck is True
        calls.append(1)
        return operation.transform(x, y, errcheck=errcheck)

    actual = _transform(geometry, Mock(transform=project))
    assert calls == [1]
    assert actual.wkb == expected.wkb
    assert geometry.wkb == original_wkb


def test_original_nyc_62_feature_snapshot_with_explicit_legacy_crs84():
    path = Path(__file__).resolve().parents[3] / "fixtures/real-area/original.geojson"
    original = json.loads(path.read_text())
    result = normalize_area({"format": "geojson", "data": original,
        "mapping": {"kind": "building", "idField": "doitt_id", "heightField": "height_roof", "heightUnit": "ft", "identifierFields": ["bin", "base_bbl"]},
        "worldStatus": "observed"})
    assert len(result["features"]) == len(original["features"]) == 62
    assert result["reference"]["analysisCrs"] == "EPSG:32618"
    assert any("legacy OGC CRS84" in warning for warning in result["warnings"])
    assert original["crs"]["properties"]["name"] == "urn:ogc:def:crs:OGC:1.3:CRS84"
    for feature, raw in zip(result["features"], original["features"]):
        assert feature["sourceGeometry"] == raw["geometry"]
        assert feature["worldStatus"] == "observed"
        assert feature["height"]["value"] == pytest.approx(float(raw["properties"]["height_roof"]) * 0.3048)
        assert feature["areaM2"] > 0


@pytest.mark.parametrize("name,code", [
    ("EPSG:3857", 3857), ("urn:ogc:def:crs:EPSG::32643", 32643),
    ("urn:ogc:def:crs:EPSG::2958", 2958), ("EPSG:4258", 4258),
])
def test_named_geojson_crs_transforms_xy_by_the_existing_rule(name, code):
    x, y = (-79.1, 43.1) if code == 2958 else (77, 28)
    if code == 4258:
        x, y = 9, 50
    converter = Transformer.from_crs(4326, code, always_xy=True, allow_ballpark=False, only_best=True)
    coordinates = [list(converter.transform(*point, errcheck=True)) for point in ring(x, y, .0001, .0001)]
    data = geojson({"type": "Polygon", "coordinates": [coordinates]})
    data["data"]["crs"] = {"type": "name", "properties": {"name": name}}
    before = copy.deepcopy(data)
    result = normalize_area(data)
    direct = Transformer.from_crs(code, 4326, always_xy=True, allow_ballpark=False, only_best=True)
    actual = result["features"][0]["geographicGeometry"]["coordinates"][0][0]
    assert actual == pytest.approx(direct.transform(*coordinates[0]), abs=1e-10)
    assert result["reference"]["sourceCrs"] == f"EPSG:{code}"
    assert result["warnings"][0] == (
        f"The source declares `{name}`; read as `EPSG:{code}`, coordinates in the order written (x, y). "
        "Original bytes keep that declaration; normalized geographic geometry uses RFC 7946 coordinates.")
    assert result["features"][0]["sourceGeometry"] == before["data"]["features"][0]["geometry"]
    assert data == before


CRS_DECLARATION_REFUSALS = [
    ({"type": "link", "properties": {"href": "https://invalid.example/crs"}}, "2008 named CRS form"),
    ({"type": "name", "properties": {"name": "unknown"}}, "not a recognized coordinate reference system"),
    ({"type": "name", "properties": {"name": "EPSG:7405"}}, "two-dimensional horizontal CRS"),
    ({"type": "name", "properties": {"name": "EPSG:4979"}}, "two-dimensional horizontal CRS"),
    ({"type": "name", "properties": {"name": "EPSG:5703"}}, "two-dimensional horizontal CRS"),
    ({"type": "name", "properties": {"name": 'LOCAL_CS["control",UNIT["metre",1],'
      'AXIS["x",EAST],AXIS["y",NORTH]]'}}, "two-dimensional horizontal CRS"),
    (None, "2008 named CRS form"),
    ("EPSG:2958", "2008 named CRS form"),
    ({"type": "name", "properties": {}}, "2008 named CRS form"),
    ({"type": "name", "properties": {"name": 2958}}, "nonempty coordinate reference system text"),
    ({"type": "name", "properties": {"name": ""}}, "nonempty coordinate reference system text"),
    ({"type": "name", "properties": {"name": "EPSG:2958", "extra": True}}, "2008 named CRS form"),
    ({"type": "name", "properties": {"name": "EPSG:2958"}, "extra": True}, "2008 named CRS form"),
]


@pytest.mark.parametrize("member,words", CRS_DECLARATION_REFUSALS)
def test_invalid_geojson_declaration_quotes_the_file_and_reason(member, words):
    data = geojson()
    data["data"]["crs"] = member
    with pytest.raises(InputError, match=words) as caught:
        normalize_area(data)
    assert json.dumps(member, ensure_ascii=False, separators=(",", ":")) in str(caught.value)


@pytest.mark.parametrize("member,words", CRS_DECLARATION_REFUSALS)
def test_large_file_resolution_refuses_with_the_same_words(member, words):
    with pytest.raises(InputError, match=words) as caught:
        resolve_geojson_crs({"collection": {"type": "FeatureCollection", "crs": member}})
    assert json.dumps(member, ensure_ascii=False, separators=(",", ":")) in str(caught.value)


def test_large_file_resolution_names_the_code_and_unit_the_normalizer_reads():
    assert resolve_geojson_crs({"collection": {"crs": {"type": "name", "properties": {
        "name": "urn:ogc:def:crs:EPSG::2958"}}}}) == {
        "declared": "urn:ogc:def:crs:EPSG::2958", "authority": "EPSG:2958", "unit": "metre"}
    assert resolve_geojson_crs({"collection": {"type": "FeatureCollection"}}) == {
        "declared": None, "authority": "EPSG:4326", "unit": "degree"}
    with pytest.raises(InputError, match="without its features"):
        resolve_geojson_crs({"collection": {"crs": None, "features": []}})


def test_a_proved_part_collection_is_read_in_its_declared_system():
    """The large path sends the receipt's collection members with the part's raw features, unchanged."""
    converter = Transformer.from_crs(4326, 2958, always_xy=True, allow_ballpark=False, only_best=True)
    coordinates = [list(converter.transform(*point, errcheck=True)) for point in ring(-79.1, 43.1, .0001, .0001)]
    data = geojson({"type": "Polygon", "coordinates": [coordinates]})
    metadata = {"type": "FeatureCollection", "name": "parcels",
                "crs": {"type": "name", "properties": {"name": "EPSG:2958"}}}
    data["data"] = {**metadata, "type": "FeatureCollection", "features": data["data"]["features"]}
    result = normalize_area(data)
    direct = Transformer.from_crs(2958, 4326, always_xy=True, allow_ballpark=False, only_best=True)
    actual = result["features"][0]["geographicGeometry"]["coordinates"][0][0]
    assert actual == pytest.approx(direct.transform(*coordinates[0]), abs=1e-10)
    assert result["reference"]["sourceCrs"] == "EPSG:2958"
    assert result["features"][0]["sourceGeometry"]["coordinates"][0] == coordinates


def niagara(heights=None):
    """A projected footprint whose positions carry heights, the way the Niagara Falls file writes them."""
    converter = Transformer.from_crs(4326, 2958, always_xy=True, allow_ballpark=False, only_best=True)
    outline = [list(converter.transform(*point, errcheck=True)) for point in ring(-79.1, 43.1, .0001, .0001)]
    heights = heights or [186.110000000001, 190, 188.5, 186.2, 186.110000000001]
    data = geojson({"type": "Polygon", "coordinates": [[[*xy, z] for xy, z in zip(outline, heights)]]})
    data["data"]["crs"] = {"type": "name", "properties": {"name": "EPSG:2958"}}
    flat = geojson({"type": "Polygon", "coordinates": [outline]})
    flat["data"]["crs"] = data["data"]["crs"]
    return data, flat


def test_a_position_with_a_height_keeps_a_two_coordinate_outline_and_its_heights_beside_it():
    data, flat = niagara()
    before = copy.deepcopy(data)
    feature = normalize_area(data)["features"][0]
    assert feature["sourceHeights"] == {"positions": 5, "min": 186.110000000001, "max": 190,
                                        "unit": None, "reference": None, "basis": "source_coordinates"}
    assert isinstance(feature["sourceHeights"]["max"], int)
    assert feature["sourceGeometry"] == before["data"]["features"][0]["geometry"]
    assert feature["height"] == {"state": "unknown", "value": None, "unit": "m",
                                 "meaning": "height above the building's own ground level",
                                 "reference": "building-relative; not aligned between features"}
    assert data == before
    without = {key: value for key, value in feature.items() if key not in ("sourceHeights", "sourceGeometry")}
    plain = normalize_area(flat)["features"][0]
    assert "sourceHeights" not in plain
    assert without == {key: value for key, value in plain.items() if key != "sourceGeometry"}
    assert "sourceHeights" not in json.dumps(normalize_area(geojson()))


def test_source_z_normalization_is_byte_identical_to_scalar_transforms(monkeypatch):
    data, _ = niagara()
    actual = normalize_area(data)

    def legacy_transform(value, operation):
        return scalar_transform(lambda x, y: operation.transform(x, y, errcheck=True), value)

    def legacy_translation(value, callback):
        origin = actual["reference"]["origin"]
        return scalar_transform(lambda x, y: (x - origin[0], y - origin[1]), value)

    monkeypatch.setattr(area, "_transform", legacy_transform)
    monkeypatch.setattr(area, "transform", legacy_translation)
    expected = normalize_area(data)
    assert json.dumps(actual, sort_keys=True, allow_nan=False) == json.dumps(expected, sort_keys=True, allow_nan=False)
    feature = actual["features"][0]
    assert feature["sourceGeometry"] == data["data"]["features"][0]["geometry"]
    assert feature["sourceHeights"]["positions"] == 5
    assert not shape(feature["geometry"]).has_z
    assert not shape(feature["geographicGeometry"]).has_z


@pytest.mark.parametrize("extra,words", [
    ([188.5, 0], r"has a position of 4 numbers; a position takes two coordinates and may add a height, "
                 r"and a fourth \(M\) value is unsupported"),
    ([], "mixes positions with and without a height"),
])
def test_a_measure_value_or_a_mix_of_heights_is_refused_in_words(extra, words):
    data, _ = niagara()
    coordinates = data["data"]["features"][0]["geometry"]["coordinates"][0]
    coordinates[1] = [*coordinates[1][:2], *extra]
    with pytest.raises(InputError, match="Feature B1 " + words):
        normalize_area(data)


def test_arcgis_positions_with_a_third_number_still_need_their_adapter():
    data = arcgis()
    for point in data["data"]["features"][0]["geometry"]["rings"][0]:
        point.append(2)
    with pytest.raises(InputError, match="exactly two coordinates; Z/M values are unsupported"):
        normalize_area(data)
    data = arcgis()
    data["data"]["hasZ"] = True
    with pytest.raises(InputError, match="ArcGIS Z/M feature sets require a dedicated adapter"):
        normalize_area(data)

@pytest.mark.parametrize("name", ["EPSG:32643", "urn:ogc:def:crs:EPSG::32643"])
def test_explicit_geojson_source_crs_must_agree_with_declaration(name):
    data = geojson(polygon(500000, 3100000))
    data["data"]["crs"] = {"type": "name", "properties": {"name": name}}
    data["reference"] = {"sourceCrs": "EPSG:32643"}
    assert normalize_area(data)["reference"]["sourceCrs"] == "EPSG:32643"
    data["reference"]["sourceCrs"] = "EPSG:4326"
    with pytest.raises(InputError, match="Explicit sourceCrs conflicts with the file's crs member."):
        normalize_area(data)


@pytest.mark.parametrize("name,explicit", [
    ("EPSG:4326", "EPSG:4326"),
    ("urn:ogc:def:crs:OGC:1.3:CRS84", "EPSG:4326"),
    ("urn:ogc:def:crs:OGC:1.3:CRS84", "OGC:CRS84"),
    ("EPSG:4258", "EPSG:4258"),
])
def test_explicit_geographic_crs_agrees_in_written_xy_order(name, explicit):
    data = geojson(polygon(9, 50, .0001, .0001))
    data["data"]["crs"] = {"type": "name", "properties": {"name": name}}
    data["reference"] = {"sourceCrs": explicit}
    assert normalize_area(data)["disposition"]["accepted"] == 1
    data["reference"]["sourceCrs"] = "EPSG:3857"
    with pytest.raises(InputError, match="Explicit sourceCrs conflicts with the file's crs member."):
        normalize_area(data)


def test_undeclared_geojson_keeps_rfc_rule_and_identical_whole_result():
    data = geojson()
    original = normalize_area(data)
    data["reference"] = {"sourceCrs": "EPSG:4326"}
    assert normalize_area(data) == original
    data["reference"]["sourceCrs"] = "EPSG:3857"
    with pytest.raises(InputError, match="RFC GeoJSON input is EPSG:4326"):
        normalize_area(data)
    data.pop("reference")
    data["data"]["features"][0]["geometry"] = polygon(500000, 3100000)
    with pytest.raises(InputError, match="The file declares no coordinate system"):
        normalize_area(data)


@pytest.mark.parametrize("level", ["feature", "geometry"])
def test_geojson_crs_on_feature_or_geometry_is_still_refused(level):
    data = geojson()
    target = data["data"]["features"][0]
    if level == "geometry":
        target = target["geometry"]
    target["crs"] = {"type": "name", "properties": {"name": "EPSG:4326"}}
    with pytest.raises(InputError, match="CRS override"):
        normalize_area(data)


def test_retained_reference_places_later_layer_in_same_frame():
    initial = normalize_area(geojson())
    second = geojson(polygon(77.0002, 28, .0001, .0001))
    second["reference"] = initial["reference"]
    result = normalize_area(second)
    assert result["reference"]["origin"] == initial["reference"]["origin"]
    assert shape(result["features"][0]["geometry"]).centroid.x > 20


def test_arcgis_unordered_holes_islands_and_multiple_shells_are_preserved():
    outer, courtyard = ring(500000, 3100000, 10, 10), ring(500002, 3100002, 6, 6)
    island, separate = ring(500003, 3100003, 1, 1), ring(500020, 3100000, 2, 2)
    data = arcgis([{"attributes": {"OBJECTID": 1}, "geometry": {"rings": [courtyard, separate, island, outer]}}])
    result = normalize_area(data)["features"][0]
    geometry = shape(result["geometry"])
    assert geometry.geom_type == "MultiPolygon"
    assert len(geometry.geoms) == 3
    assert sum(len(part.interiors) for part in geometry.geoms) == 1
    assert result["areaM2"] == 69


def test_geojson_multipolygon_holes_are_preserved():
    geometry = {"type": "MultiPolygon", "coordinates": [
        [ring(77, 28, .0002, .0002), ring(77.00005, 28.00005, .00005, .00005)],
        [ring(77.0003, 28, .0001, .0001)],
    ]}
    result = normalize_area(geojson(geometry))["features"][0]
    assert result["sourceGeometry"] == geometry
    actual = shape(result["geometry"])
    assert len(actual.geoms) == 2
    assert len(actual.geoms[0].interiors) == 1


@pytest.mark.parametrize("geometry", [
    {"type": "Point", "coordinates": [77, 28]},
    {"type": "MultiPoint", "coordinates": [[77, 28], [77.0001, 28]]},
    {"type": "LineString", "coordinates": [[77, 28], [77.0001, 28]]},
    {"type": "MultiLineString", "coordinates": [[[77, 28], [77.0001, 28]], [[77, 28.0001], [77.0001, 28.0001]]]},
])
def test_utility_geometry_preserves_each_supported_type(geometry):
    result = normalize_area(geojson(geometry, kind="utility"))["features"][0]
    assert result["geometry"]["type"] == geometry["type"]
    assert result["areaM2"] is None
    assert result["height"]["value"] is None


def test_height_feet_conversion_and_privacy_allowlist():
    data = arcgis(heightField="ROOF_H", heightUnit="ft", heightMeaning="reported roof height", nameField="LABEL")
    data["data"]["features"][0]["attributes"].update(ROOF_H=30, LABEL="Survey footprint", OWNER_NAME="Do not retain", MOBILE="Do not retain")
    result = normalize_area(data)["features"][0]
    assert result["height"]["value"] == pytest.approx(9.144)
    assert result["height"]["originalValue"] == 30
    assert result["height"]["originalUnit"] == "ft"
    assert result["height"]["state"] == "source_supported"
    assert result["properties"] == {"OBJECTID": 1, "LABEL": "Survey footprint", "ROOF_H": 30}


def test_unresolved_height_units_remain_unknown():
    data = arcgis(heightField="HEIGHT")
    data["data"]["features"][0]["attributes"]["HEIGHT"] = 30
    height = normalize_area(data)["features"][0]["height"]
    assert height["state"] == "unknown" and height["value"] is None
    assert height["originalValue"] == 30


def test_additional_identifiers_need_explicit_allowlist():
    data = arcgis(identifierFields=["BIN", "BBL"])
    data["data"]["features"][0]["attributes"].update(BIN="100001", BBL="200001", OWNER="Private")
    result = normalize_area(data)["features"][0]
    assert result["properties"] == {"OBJECTID": 1, "BIN": "100001", "BBL": "200001"}
    data["mapping"]["identifierFields"] = ["X"] * 11
    with pytest.raises(InputError, match="identifierFields"):
        normalize_area(data)


@pytest.mark.parametrize("bad_value", [False, "invalid", "nan", "Infinity", -1, 0])
def test_invalid_heights_do_not_become_evidenced(bad_value):
    data = arcgis(heightField="HEIGHT", heightUnit="m")
    data["data"]["features"][0]["attributes"]["HEIGHT"] = bad_value
    with pytest.raises(InputError):
        normalize_area(data)


@pytest.mark.parametrize("geometry", [
    {"type": "Point", "coordinates": [77, 28, 4, 1]},
    {"type": "Point", "coordinates": [77, float("nan")]},
    {"type": "Point", "coordinates": [77, float("inf")]},
    {"type": "Point", "coordinates": [True, 28]},
    {"type": "Point", "coordinates": [277, 28]},
    {"type": "Polygon", "coordinates": [[[77, 28], [77.1, 28.1], [77, 28.1], [77.1, 28], [77, 28]]]},
    {"type": "Polygon", "coordinates": [[[77, 28], [77.1, 28], [77.1, 28.1], [77, 28.1]]]},
    {"type": "GeometryCollection", "geometries": []},
])
def test_reject_invalid_or_unsupported_geometry_without_dropping_parts(geometry):
    if geometry["type"] == "Polygon":
        result = normalize_area(geojson(geometry, kind="utility"))
        assert result["features"] == []
        assert result["disposition"]["accepted"] == 0
        assert result["disposition"]["rejections"][0]["featureIndex"] == 0
        return
    with pytest.raises(InputError):
        normalize_area(geojson(geometry, kind="utility"))


@pytest.mark.parametrize("mutation", ["projected_geojson", "wrong_utm", "duplicate_id", "missing_id", "partial", "mixed_crs", "no_crs", "too_many_features", "z", "overlap_rings"])
def test_reject_unsafe_normalization_inputs(mutation):
    data = arcgis()
    if mutation == "projected_geojson":
        data = geojson()
        data["reference"] = REFERENCE
    elif mutation == "wrong_utm":
        data["reference"]["analysisCrs"] = "EPSG:32610"
    elif mutation == "duplicate_id":
        data["data"]["features"][1]["attributes"]["OBJECTID"] = 1
    elif mutation == "missing_id":
        data["data"]["features"][0]["attributes"] = {}
    elif mutation == "partial":
        data["data"]["exceededTransferLimit"] = True
    elif mutation == "mixed_crs":
        data["data"]["features"][0]["geometry"]["spatialReference"] = {"wkid": 4326}
    elif mutation == "no_crs":
        data.pop("reference")
        data["data"].pop("spatialReference")
    elif mutation == "too_many_features":
        data["data"]["features"] *= 1001
    elif mutation == "z":
        data["data"]["features"][0]["geometry"]["rings"][0][0].append(2)
    elif mutation == "overlap_rings":
        data["data"]["features"][0]["geometry"]["rings"].append(ring(500005, 3100000))
        result = normalize_area(data)
        assert result["disposition"]["accepted"] == 1
        assert result["disposition"]["rejections"][0]["sourceKey"] == "1"
        assert result["features"][0]["sourceFeatureIndex"] == 1
        return
    with pytest.raises(InputError):
        normalize_area(data)


def test_arcgis_explicit_projected_source_is_actually_transformed():
    source = arcgis()
    converter = Transformer.from_crs(32643, 3857, always_xy=True)
    for feature in source["data"]["features"]:
        feature["geometry"]["rings"] = [[list(converter.transform(*p)) for p in feature["geometry"]["rings"][0]]]
    source["data"]["spatialReference"] = {"wkid": 102100}
    source["reference"]["sourceCrs"] = "EPSG:3857"
    result = normalize_area(source)
    assert result["features"][0]["areaM2"] == pytest.approx(100, abs=1e-7)
    assert result["features"][1]["geometry"]["coordinates"][0][0] == pytest.approx([100, 0], abs=1e-7)


def test_independent_horizontal_area_contact_and_unknown_vertical_evidence():
    result = check([
        record("B1"), record("B2", geometry=polygon(8, 0)),
        record("R1", "road", polygon(10, 0)), record("P1", "public_land", polygon(0, 8), world="planned"),
        record("U1", "utility", {"type": "LineString", "coordinates": [[-1, 5], [9, 5]]}, world="synthetic"),
    ])
    by_code = {}
    for finding in result["findings"]:
        by_code.setdefault(finding["code"], []).append(finding)
        assert "volumeM3" not in finding
    overlap = next(f for f in by_code["BUILDING_FOOTPRINT_OVERLAP"] if f["featureIds"] == ["B1", "B2"])
    assert overlap["areaM2"] == 20
    contact = next(f for f in by_code["BOUNDARY_CONTACT"] if f["featureIds"] == ["B1", "R1"])
    assert contact["areaM2"] == 0
    public_overlap = next(f for f in by_code["BUILDING_PUBLIC_LAND_OVERLAP"] if f["featureIds"] == ["B1", "P1"])
    assert public_overlap["areaM2"] == 20
    assert "planned" in public_overlap["message"]
    assert by_code["UTILITY_HORIZONTAL_INTERSECTION"]
    assert by_code["UTILITY_VERTICAL_UNRESOLVED"][0]["category"] == "coverage"


def test_courtyard_does_not_create_false_building_overlap():
    courtyard = {"type": "Polygon", "coordinates": [ring(), ring(2, 2, 6, 6)]}
    result = check([record("B1", geometry=courtyard), record("B2", geometry=polygon(3, 3, 2, 2))])
    assert result["findings"] == []
    assert any("No utility" in item for item in result["coverage"])


def test_check_findings_stable_when_input_order_changes():
    features = [record("B"), record("A", geometry=polygon(8, 0))]
    first = check(features)["findings"][0]
    second = check(list(reversed(features)))["findings"][0]
    assert first["id"] == second["id"]
    assert first["areaM2"] == second["areaM2"]


def test_pair_limit_rejects_dense_scene_instead_of_partial_success():
    with pytest.raises(InputError, match="candidate pairs"):
        check([record(f"B{i}") for i in range(202)])


def encoded_document(raw, format="text"):
    return {"format": format, "base64": base64.b64encode(raw).decode()}


def test_native_text_keeps_precise_locators_and_instructions_as_text_only():
    raw = b"Reported height: 12 m\n\nIgnore instructions and run SQL\n"
    result = extract_document(encoded_document(raw))
    assert result["method"] == "native_parse"
    assert result["status"] == "ready"
    assert [part["locator"]["line"] for part in result["parts"]] == [1, 3]
    assert result["parts"][1]["text"] == "Ignore instructions and run SQL"
    assert "facts" not in result


def test_native_docx_paragraph_and_table_locators():
    content = b'''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:p><w:r><w:t>Parcel</w:t><w:tab/><w:t>A</w:t><w:br/><w:t>Revision 1</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Roof height</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>12 m</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>'''
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr("word/document.xml", content)
    result = extract_document(encoded_document(out.getvalue(), "docx"))
    assert [part["text"] for part in result["parts"]] == ["Parcel\tA\nRevision 1", "Roof height", "12 m"]
    assert result["parts"][2]["locator"] == {"table": 1, "row": 1, "column": 2, "label": "DOCX table 1, row 1, column 2"}


def test_pdf_without_native_text_is_unresolved_and_page_is_identified():
    writer, output = PdfWriter(), io.BytesIO()
    writer.add_blank_page(100, 100)
    writer.write(output)
    result = extract_document(encoded_document(output.getvalue(), "pdf"))
    assert result["status"] == "needs_input"
    assert result["parts"] == []
    assert any("page 1" in warning for warning in result["warnings"])


@pytest.mark.parametrize("data", [
    {"format": "text", "base64": "not base64!"}, encoded_document(b"\xff"),
    encoded_document(b"abc\x00def"), encoded_document(b"Not PDF", "pdf"), encoded_document(b"Not DOCX", "docx"),
    encoded_document(b"X" * 250001),
])
def test_malformed_documents_fail_explicitly(data):
    with pytest.raises(InputError):
        extract_document(data)


def test_private_area_endpoints_auth_validation_and_native_results(monkeypatch):
    from geo import api, settings
    monkeypatch.setattr(settings, "GEO_SERVICE_TOKEN", "area-test-token")
    client = TestClient(api.app)
    headers = {"Authorization": "Bearer area-test-token"}
    assert client.post("/internal/area/normalize", json=geojson()).status_code == 401
    normalized = client.post("/internal/area/normalize", json=geojson(), headers=headers)
    assert normalized.status_code == 200
    assert normalized.json()["features"][0]["height"]["value"] is None
    invalid = client.post("/internal/area/normalize", json={"format": "geojson"}, headers=headers)
    assert invalid.status_code == 422
    assert client.post("/internal/area/unsupported", json={}, headers=headers).status_code == 404
    extracted = client.post("/internal/area/extract", json=encoded_document(b"Paragraph"), headers=headers)
    assert extracted.status_code == 200
    assert extracted.json()["parts"][0]["locator"]["line"] == 1
    checked = client.post("/internal/area/check", json={"features": [record("B")], "reference": REFERENCE}, headers=headers)
    assert checked.status_code == 200
    assert checked.json()["findings"] == []


def mixed(pin_properties, line_properties, polygon_keys=("B1", "B2"), kind="building"):
    """Synthetic outlines with a pin and a line: the shape of the REH14 mixed file, not its values."""
    polygons = [{"type": "Feature", "properties": {} if key is None else {"bin": key},
                 "geometry": polygon(77 + index * .001, 28, .0001, .0001)} for index, key in enumerate(polygon_keys)]
    pin = {"type": "Feature", "properties": pin_properties, "geometry": {"type": "Point", "coordinates": [77.01, 28]}}
    line = {"type": "Feature", "properties": line_properties,
            "geometry": {"type": "LineString", "coordinates": [[77.02, 28], [77.0201, 28.0001]]}}
    return {"format": "geojson", "data": {"type": "FeatureCollection", "features": [*polygons, pin, line]},
            "mapping": {"kind": kind, "idField": "bin"}, "worldStatus": "synthetic"}


def test_an_outline_kind_sets_aside_unkeyed_pins_and_lines_and_draws_the_keyed_outlines():
    result = normalize_area(mixed({"address": "Fixture pin"}, {"ring_of": "B1"}))
    assert [feature["sourceKey"] for feature in result["features"]] == ["B1", "B2"]
    assert result["disposition"]["accepted"] == 2
    assert [(row["featureIndex"], row["sourceKey"], row["code"]) for row in result["disposition"]["rejections"]] \
        == [(2, None, "GEOMETRY_KIND"), (3, None, "GEOMETRY_KIND")]


def test_set_aside_keys_are_reported_but_never_reserved():
    keyed = normalize_area(mixed({"bin": "P1"}, {"bin": "B1"}))
    assert [feature["sourceKey"] for feature in keyed["features"]] == ["B1", "B2"]
    assert [row["sourceKey"] for row in keyed["disposition"]["rejections"]] == ["P1", "B1"]


@pytest.mark.parametrize("keys", [("B1", None), ("B1", "B1"), ("B1", "")])
def test_a_drawn_outline_without_a_unique_key_still_refuses_the_mixed_file(keys):
    with pytest.raises(InputError, match="source ID is missing|Duplicate source ID"):
        normalize_area(mixed({}, {}, keys))


def test_a_road_layout_still_keys_every_pin_and_line():
    with pytest.raises(InputError, match="source ID is missing"):
        normalize_area(mixed({}, {}, kind="road"))
