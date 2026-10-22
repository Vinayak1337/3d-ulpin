"""Synthetic fixtures: bounded, read-only preflight is not source acceptance."""
import base64
import hashlib
import io
import json
import sqlite3
import zipfile

import pytest
from pyproj import CRS

from geo.gis_inspection import inspect_gis
from geo.native_gis import MAX_BYTES, MAX_EXPANDED
from geo.validation import InputError
from test_native_adapters import gpkg, shapefile_zip
from test_area import CRS_DECLARATION_REFUSALS


def inspect(raw, **extra):
    return inspect_gis({"base64": base64.b64encode(raw).decode(), **extra})


def geojson(rows=None):
    return {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": row, "geometry": {"type": "Point", "coordinates": [77.2, 28.6]}} for row in (rows or [{"id": "A", "name": "First"}, {"id": "B", "name": "Second"}])]}


def json_inspect(data):
    return inspect(json.dumps(data).encode())


def arcgis():
    return {"spatialReference": {"wkid": 32643}, "features": [{"attributes": {"OBJECTID": 1}, "geometry": {"x": 500000, "y": 3100000}}]}


def test_projected_gpkg_detects_layer_crs_fields_without_modifying_original(tmp_path):
    raw = gpkg(tmp_path)
    result = inspect(raw)
    assert result["format"] == "gpkg" and result["layer"] == "buildings"
    assert result["sourceCrs"] == "EPSG:32643" and result["featureCount"] == 1
    assert result["suggestedIdField"] == "id"
    assert {field["name"] for field in result["fields"]} == {"id", "owner"}
    assert "private omitted" not in json.dumps(result)
    assert result["sourceSha256"] == hashlib.sha256(raw).hexdigest()
    assert (tmp_path / "test.gpkg").read_bytes() == raw


def test_multiple_gpkg_layers_need_selection_before_metadata_is_claimed(tmp_path):
    raw = gpkg(tmp_path, extra_layer=True)
    result = inspect(raw)
    assert result["layers"] == ["buildings", "other"]
    assert result["layer"] is None and result["featureCount"] is None and result["sourceCrs"] is None
    assert inspect(raw, layer="buildings")["sourceCrs"] == "EPSG:32643"
    with pytest.raises(InputError):
        inspect(raw, layer="absent")


def test_shapefile_reuses_native_crs_and_layer_guards():
    assert inspect(shapefile_zip())["sourceCrs"] == "EPSG:32643"
    assert inspect(shapefile_zip(second=True))["layer"] is None
    assert inspect(shapefile_zip(second=True), layer="buildings")["suggestedIdField"] == "id"


@pytest.mark.parametrize("options", [{"unsafe": True}, {"companions": False}, {"z": True}])
def test_invalid_shapefiles_fail_before_suggestions(options):
    with pytest.raises(InputError):
        inspect(shapefile_zip(**options))


def test_geojson_and_accepted_crs84_have_evidence_for_wgs84():
    source = geojson()
    assert json_inspect(source)["sourceCrs"] == "EPSG:4326"
    source["crs"] = {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}}
    assert json_inspect(source)["crsEvidence"] == "Declared OGC CRS84"
    assert json_inspect(source)["sourceCrs"] == "EPSG:4326"


@pytest.mark.parametrize("name,code", [
    ("EPSG:2958", "EPSG:2958"), ("urn:ogc:def:crs:EPSG::2958", "EPSG:2958"),
    ("EPSG:3857", "EPSG:3857"), ("EPSG:4269", "EPSG:4269"),
])
def test_inspection_reads_named_horizontal_geojson_declaration(name, code):
    source = geojson()
    source["crs"] = {"type": "name", "properties": {"name": name}}
    if CRS.from_user_input(code).is_projected:
        for feature in source["features"]:
            feature["geometry"]["coordinates"] = [500000, 3100000]
    raw = json.dumps(source).encode()
    result = inspect(raw)
    assert result["sourceCrs"] == code
    assert result["crsEvidence"] == f"Declared in the file's crs member: `{name}`"
    assert result["sourceSha256"] == hashlib.sha256(raw).hexdigest()
    assert result["featureCount"] == len(source["features"])


@pytest.mark.parametrize("member,words", CRS_DECLARATION_REFUSALS)
def test_inspection_refuses_bad_declaration_with_literal_and_reason(member, words):
    source = geojson()
    source["crs"] = member
    with pytest.raises(InputError, match=words) as caught:
        json_inspect(source)
    assert json.dumps(member, ensure_ascii=False, separators=(",", ":")) in str(caught.value)


def test_inspection_reads_a_geojson_position_with_a_height_and_refuses_a_fourth_number():
    data = geojson()
    data["features"][0]["geometry"]["coordinates"] = [77.2, 28.6, 214.5]
    result = json_inspect(data)
    assert result["geometryTypes"] == ["Point"] and result["featureCount"] == 2
    data["features"][0]["geometry"]["coordinates"] = [77.2, 28.6, 214.5, 1]
    with pytest.raises(InputError, match="position of 4 numbers"):
        json_inspect(data)

def test_undeclared_geojson_outside_degrees_explains_missing_declaration():
    source = geojson()
    source["features"][0]["geometry"]["coordinates"] = [500000, 3100000]
    with pytest.raises(InputError, match="The file declares no coordinate system"):
        json_inspect(source)


@pytest.mark.parametrize("level", ["feature", "geometry"])
def test_inspection_refuses_feature_or_geometry_crs(level):
    source = geojson()
    target = source["features"][0]
    if level == "geometry":
        target = target["geometry"]
    target["crs"] = {"type": "name", "properties": {"name": "EPSG:4326"}}
    with pytest.raises(InputError, match="CRS override"):
        json_inspect(source)


def test_arcgis_crs_is_declared_not_defaulted():
    source = arcgis()
    assert json_inspect(source)["sourceCrs"] == "EPSG:32643"
    del source["spatialReference"]
    assert json_inspect(source)["sourceCrs"] is None
    source["features"][0]["geometry"]["spatialReference"] = {"wkid": 32643}
    assert json_inspect(source)["sourceCrs"] == "EPSG:32643"
    source["spatialReference"] = {"wkid": 4326}
    with pytest.raises(InputError, match="conflict"):
        json_inspect(source)


def test_incomplete_feature_references_need_officer_input():
    source = arcgis()
    del source["spatialReference"]
    source["features"][0]["geometry"]["spatialReference"] = {"wkid": 32643}
    source["features"].append({"attributes": {"OBJECTID": 2}, "geometry": {"x": 500010, "y": 3100010}})
    assert json_inspect(source)["sourceCrs"] is None


def test_ids_and_names_are_complete_unique_and_recognized_across_all_rows():
    result = json_inspect(geojson())
    assert result["suggestedIdField"] == "id" and result["suggestedNameField"] == "name"
    rows = [{"id": str(index), "name": f"Building {index}"} for index in range(30)]
    rows[-1]["id"] = "0"
    assert json_inspect(geojson(rows))["suggestedIdField"] is None
    rows[-1]["id"] = None
    assert json_inspect(geojson(rows))["suggestedIdField"] is None
    assert json_inspect(geojson([{"name": "Unique name"}]))["suggestedIdField"] is None
    assert json_inspect(geojson([{"grid": "A", "valid": "yes"}]))["suggestedIdField"] is None
    assert json_inspect(geojson([{"id": "A", "parcel_id": "P"}]))["suggestedIdField"] is None
    assert json_inspect(geojson([{"id": "A"}, {"id": " A "}]))["suggestedIdField"] is None


@pytest.mark.parametrize("raw", [b"", b"not json", b"PKbroken", b"SQLite format 3\x00broken", b'{"features": []}', b'{"features": [NaN]}'])
def test_malformed_sources_do_not_produce_success(raw):
    with pytest.raises(InputError):
        inspect(raw)


def test_size_and_archive_expansion_limits():
    with pytest.raises(InputError):
        inspect(b"x" * (MAX_BYTES + 1))
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("bomb.shp", b"x" * (MAX_EXPANDED + 1))
    with pytest.raises(InputError, match="64 MiB"):
        inspect(output.getvalue())


def test_gpkg_conflicting_crs_metadata_is_rejected(tmp_path):
    gpkg(tmp_path)
    with sqlite3.connect(tmp_path / "test.gpkg") as db:
        db.execute("UPDATE gpkg_spatial_ref_sys SET definition=?", (CRS.from_epsg(4326).to_wkt(),))
    with pytest.raises(InputError, match="conflict"):
        inspect((tmp_path / "test.gpkg").read_bytes())


def test_gpkg_view_cannot_execute_during_inspection(tmp_path):
    gpkg(tmp_path)
    with sqlite3.connect(tmp_path / "test.gpkg") as db:
        db.executescript("ALTER TABLE buildings RENAME TO retained; CREATE VIEW buildings AS SELECT * FROM retained;")
    with pytest.raises(InputError, match="views"):
        inspect((tmp_path / "test.gpkg").read_bytes())


def test_feature_ids_are_available_only_when_complete_unique_and_valid():
    source = geojson([{"name": "Repeated name"}, {"name": "Repeated name"}])
    source["features"][0]["id"] = "A"
    source["features"][1]["id"] = "B"
    result = json_inspect(source)
    assert result["featureIdEligible"] is True
    assert result["suggestedIdField"] is None
    assert result["suggestedNameField"] == "name"
    source["features"][1]["id"] = " A "
    assert json_inspect(source)["featureIdEligible"] is False
    del source["features"][1]["id"]
    assert json_inspect(source)["featureIdEligible"] is False
    source["features"][1]["id"] = True
    assert json_inspect(source)["featureIdEligible"] is False


def test_feature_ids_ingest_without_attribute_mapping_and_keep_source_identity():
    from geo.area import normalize_area
    source = geojson([{"name": "Same name"}, {"name": "Same name"}])
    for index, feature in enumerate(source["features"]):
        feature["id"] = f"retained-{index}"
        x = 77.2 + index * .001
        feature["geometry"] = {"type": "Polygon", "coordinates": [[[x, 28.6], [x + .0001, 28.6], [x + .0001, 28.6001], [x, 28.6001], [x, 28.6]]]}
    result = normalize_area({"format": "geojson", "data": source, "mapping": {"kind": "building", "nameField": "name"}, "worldStatus": "synthetic"})
    assert [feature["sourceKey"] for feature in result["features"]] == ["retained-0", "retained-1"]
    assert [feature["name"] for feature in result["features"]] == ["Same name", "Same name"]


@pytest.mark.parametrize("code,unit", [("EPSG:2958", "metre"), ("EPSG:4326", "degree"),
                                     ("EPSG:2263", "US survey foot")])
def test_inspection_publishes_the_resolved_horizontal_unit(code, unit):
    source = geojson()
    source["crs"] = {"type": "name", "properties": {"name": code}}
    assert json_inspect(source)["crsUnit"] == unit


@pytest.mark.parametrize("tokens,eligible", [
    (["7", "8"], True), (["-7", "0"], True), (["9007199254740991", "-9007199254740991"], True),
    (["7.0", "8"], False), (["7e0", "8"], False), (["-0", "8"], False),
    (["7", "7"], False), (["7", "null"], False), (["9007199254740992", "8"], False),
    (['"7"', '"8"'], False), (["true", "8"], False),
])
def test_integer_identity_is_qualified_from_the_tokens_not_the_parsed_numbers(tokens, eligible):
    source = geojson([{"id": "TOKEN0"}, {"id": "TOKEN1"}])
    raw = json.dumps(source).replace('"TOKEN0"', tokens[0]).replace('"TOKEN1"', tokens[1]).encode()
    field = next(field for field in inspect(raw)["fields"] if field["name"] == "id")
    assert field["integerIdEligible"] is eligible


def test_invalid_leading_zero_is_not_accepted_as_an_integer_identifier():
    raw = json.dumps(geojson([{"id": "TOKEN"}])).replace('"TOKEN"', '007').encode()
    with pytest.raises(InputError, match="valid GeoJSON"):
        inspect(raw)


def test_missing_integer_field_and_float_feature_id_are_not_eligible():
    result = json_inspect(geojson([{"id": 7}, {"name": "missing"}]))
    assert next(field for field in result["fields"] if field["name"] == "id")["integerIdEligible"] is False
    source = geojson()
    source["features"][0]["id"] = 7
    source["features"][1]["id"] = 8
    assert json_inspect(source)["featureIntegerIdEligible"] is True
    source["features"][1]["id"] = 8.0
    assert json_inspect(source)["featureIntegerIdEligible"] is False


def test_mixed_geojson_reports_integer_keys_over_the_outlines_an_outline_layout_draws():
    outline = {"type": "Polygon", "coordinates": [[[77, 28], [77.001, 28], [77.001, 28.001], [77, 28]]]}
    source = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "id": index, "properties": {"bin": 100 + index}, "geometry": outline}
        for index in range(2)] + [{"type": "Feature", "properties": {"address": "Fixture pin"},
                                   "geometry": {"type": "Point", "coordinates": [77.2, 28.6]}}]}
    result = json_inspect(source)
    field = next(field for field in result["fields"] if field["name"] == "bin")
    assert (field["integerIdEligible"], field["outlineIntegerIdEligible"]) == (False, True)
    assert (result["featureIntegerIdEligible"], result["featureOutlineIntegerIdEligible"]) == (False, True)
    source["features"][1]["properties"]["bin"] = 100.0
    field = next(field for field in json_inspect(source)["fields"] if field["name"] == "bin")
    assert field["outlineIntegerIdEligible"] is False


@pytest.mark.parametrize("missing", [False, True])
def test_mixed_names_are_suggested_only_when_every_outline_has_text(missing):
    # test_only: literal geometry and labels, not operational records.
    source = geojson([{"id": "A", "name": "First"}, {"id": "B", "name": "Second"}])
    for feature in source["features"]:
        feature["geometry"] = {"type": "Polygon", "coordinates": [
            [[77, 28], [77.001, 28], [77.001, 28.001], [77, 28]]
        ]}
    if missing:
        del source["features"][1]["properties"]["name"]
    polygons = json_inspect(source)
    assert polygons["suggestedNameField"] == (None if missing else "name")
    assert all("outlineComplete" not in field for field in polygons["fields"])
    source["features"].extend([
        {"type": "Feature", "properties": {}, "geometry": {"type": "Point", "coordinates": [77, 28]}},
        {"type": "Feature", "properties": {"name": {"not": "text"}}, "geometry": {
            "type": "LineString", "coordinates": [[77, 28], [77.001, 28]]}},
    ])
    result = json_inspect(source)
    field = next(field for field in result["fields"] if field["name"] == "name")
    assert field["complete"] is False
    assert field["outlineComplete"] is not missing
    assert result["suggestedNameField"] == (None if missing else "name")


def test_a_single_kind_geojson_carries_no_outline_flags():
    result = json_inspect(geojson([{"id": 7}, {"id": 8}]))
    assert "featureOutlineIntegerIdEligible" not in result
    assert all("outlineIntegerIdEligible" not in field for field in result["fields"])


def test_undeclared_and_legacy_crs84_keep_evidence_and_degree_unit():
    source = geojson()
    assert json_inspect(source)["crsUnit"] == "degree"
    assert json_inspect(source)["crsEvidence"] == "RFC 7946 GeoJSON longitude/latitude"
    source["crs"] = {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}}
    assert json_inspect(source)["crsUnit"] == "degree"
    assert json_inspect(source)["crsEvidence"] == "Declared OGC CRS84"
