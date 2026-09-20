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
    source["crs"]["properties"]["name"] = "EPSG:32643"
    with pytest.raises(InputError):
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
