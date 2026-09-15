"""Synthetic native files prove format behavior without claiming real data acquisition."""
import base64
import hashlib
import io
import sqlite3
import struct
import zipfile

import pytest
import shapefile
from PIL import Image
from pyproj import CRS
from shapely.geometry import shape

from geo.area import normalize_area
from geo.image_derivative import crop_image
from geo.validation import InputError
from test_area import REFERENCE, polygon, ring


def native(raw, format, **extra):
    return {"format": format, "base64": base64.b64encode(raw).decode(), "mapping": {"kind": "building", "idField": "id", "geometryRole": "observed_ground_occupation"},
            "reference": REFERENCE, "worldStatus": "synthetic", **extra}


def gpkg(tmp_path, z=0, epsg=32643, invalid_header=False, extra_layer=False):
    path = tmp_path / "test.gpkg"
    with sqlite3.connect(path) as db:
        db.executescript("CREATE TABLE gpkg_contents(table_name TEXT,data_type TEXT); CREATE TABLE gpkg_geometry_columns(table_name TEXT,column_name TEXT,srs_id INTEGER,z INTEGER,m INTEGER); CREATE TABLE gpkg_spatial_ref_sys(srs_id INTEGER,organization TEXT,organization_coordsys_id INTEGER,definition TEXT); CREATE TABLE buildings(id TEXT,geom BLOB,owner TEXT);")
        db.execute("INSERT INTO gpkg_contents VALUES('buildings','features')")
        db.execute("INSERT INTO gpkg_geometry_columns VALUES('buildings','geom',?, ?,0)", (epsg, z))
        db.execute("INSERT INTO gpkg_spatial_ref_sys VALUES(?,'EPSG',?,?)", (epsg, epsg, CRS.from_epsg(epsg).to_wkt()))
        geometry = {"type": "Polygon", "coordinates": [ring(500000, 3100000), ring(500002, 3100002, 2, 2)]}
        binary = (b"XX" if invalid_header else b"GP") + bytes([0, 1]) + struct.pack("<i", epsg) + shape(geometry).wkb
        db.execute("INSERT INTO buildings VALUES('A',?,'private omitted')", (binary,))
        if extra_layer:
            db.execute("INSERT INTO gpkg_contents VALUES('other','features')")
    return path.read_bytes()


def shapefile_zip(*, companions=True, unsafe=False, z=False, second=False):
    shp, shx, dbf = io.BytesIO(), io.BytesIO(), io.BytesIO()
    with shapefile.Writer(shp=shp, shx=shx, dbf=dbf, shapeType=shapefile.POLYGONZ if z else shapefile.POLYGON) as writer:
        writer.field("id", "C")
        writer.field("owner", "C")
        rings = [ring(500000, 3100000), ring(500002, 3100002, 2, 2)]
        writer.polyz(rings) if z else writer.poly(rings)
        writer.record("A", "private omitted")
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("buildings.shp", shp.getvalue())
        archive.writestr("buildings.shx", shx.getvalue())
        archive.writestr("buildings.dbf", dbf.getvalue())
        if companions:
            archive.writestr("buildings.prj", CRS.from_epsg(32643).to_wkt(version="WKT1_ESRI"))
        if unsafe:
            archive.writestr("../escape.txt", "must never be extracted")
        if second:
            archive.writestr("other.shp", shp.getvalue())
    return output.getvalue()


def test_geopackage_2d_native_holes_source_crs_and_original_hash(tmp_path):
    raw = gpkg(tmp_path)
    result = normalize_area(native(raw, "gpkg"))
    assert result["features"][0]["areaM2"] == 96
    assert len(shape(result["features"][0]["geometry"]).interiors) == 1
    assert result["features"][0]["properties"] == {"id": "A"}
    assert result["features"][0]["sourceGeometry"]["coordinates"][0][0] == [500000, 3100000]
    assert result["adapter"]["sourceSha256"] == hashlib.sha256(raw).hexdigest()
    assert result["adapter"]["layer"] == "buildings"


@pytest.mark.parametrize("options", [{"z": 1}, {"invalid_header": True}, {"extra_layer": True}])
def test_geopackage_unsupported_or_ambiguous_features_fail(tmp_path, options):
    with pytest.raises(InputError):
        normalize_area(native(gpkg(tmp_path, **options), "gpkg"))


def test_geopackage_layer_selection_does_not_silently_merge_semantics(tmp_path):
    result = normalize_area(native(gpkg(tmp_path, extra_layer=True), "gpkg", layer="buildings"))
    assert len(result["features"]) == 1


def test_shapefile_native_companions_preserve_holes_even_with_source_ring_order():
    raw = shapefile_zip()
    result = normalize_area(native(raw, "shapefile_zip"))
    assert result["features"][0]["areaM2"] == 96
    assert result["features"][0]["properties"] == {"id": "A"}
    assert result["adapter"]["sourceSha256"] == hashlib.sha256(raw).hexdigest()
    assert result["reference"]["analysisCrs"] == "EPSG:32643"


@pytest.mark.parametrize("options", [{"companions": False}, {"unsafe": True}, {"z": True}, {"second": True}])
def test_shapefile_missing_companions_unsafe_archive_or_z_is_not_flattened(options):
    with pytest.raises(InputError):
        normalize_area(native(shapefile_zip(**options), "shapefile_zip"))


def test_native_source_crs_override_cannot_relabel_shapefile():
    data = native(shapefile_zip(), "shapefile_zip")
    data["reference"] = {**REFERENCE, "sourceCrs": "EPSG:4326"}
    with pytest.raises(InputError):
        normalize_area(data)


def image_source():
    pixels = Image.new("RGB", (100, 80), (255, 0, 0))
    for x in range(50, 100):
        for y in range(80):
            pixels.putpixel((x, y), (0, 0, 255))
    raw = io.BytesIO()
    pixels.save(raw, format="PNG")
    return raw.getvalue()


def test_selected_image_crop_hash_dimensions_and_pixel_correspondence():
    raw = image_source()
    result = crop_image({"format": "png", "base64": base64.b64encode(raw).decode(), "region": {"x": .5, "y": 0, "width": .5, "height": 1}})
    derivative = base64.b64decode(result["base64"])
    assert result["width"] == 50 and result["height"] == 80
    assert result["pixelRegion"] == [50, 0, 100, 80]
    assert result["sha256"] == hashlib.sha256(derivative).hexdigest()
    assert result["sourceSha256"] == hashlib.sha256(raw).hexdigest()
    assert Image.open(io.BytesIO(derivative)).getpixel((0, 0)) == (0, 0, 255)
    assert result["width"] * result["height"] <= 4_000_000 and result["bytes"] <= 4 * 1024 * 1024


@pytest.mark.parametrize("region", [None, {"x": 0, "y": 0, "width": 0, "height": 1}, {"x": .5, "y": 0, "width": 1, "height": 1}])
def test_image_crops_require_valid_explicit_region(region):
    with pytest.raises(InputError):
        crop_image({"format": "png", "base64": base64.b64encode(image_source()).decode(), "region": region})
