"""SH2. Real public GeoPackage and shapefile originals (test_only) converted window by window into GeoJSON."""
import hashlib
import io
import json
import shutil
import sqlite3
import struct
import tempfile
from pathlib import Path

import pytest
from shapely.geometry import shape

from geo.native_gis import WINDOW, _gpkg, _shapefile, convert_kml_file, convert_native, convert_native_file
from geo.validation import InputError

DATA = Path("E:/BhuAayam-data/datasets/map-formats")
# Tweed Shire Council building outlines, the GeoPackage and shapefile ZIP CB1 used (test_only, licence as received).
TWEED_GPKG = DATA / "tweed-shire-council/TSC_Buildings_OD_-1703359794462598529.gpkg"
TWEED_ZIP = DATA / "tweed-shire-council/TSC_Buildings_OD_8831041243266425049.zip"
# Niagara Falls 2018 building footprints, EPSG:2958 with heights in Z (test_only, attributed reuse).
NIAGARA = DATA / "niagara-falls/Niagara_Falls_Building_Footprints_2018_1330698285055863645.geojson"
pytestmark = pytest.mark.skipif(not TWEED_GPKG.exists(), reason="the data drive with the real test originals")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def convert(path: Path, fmt: str, tmp_path: Path) -> list[dict]:
    out = tmp_path / "out"
    out.mkdir()
    return convert_native_file(path, fmt, out, sha(path))


def written(layer: dict) -> tuple[dict, list[dict]]:
    collection = json.loads(Path(layer["geojson"]["path"]).read_text(encoding="utf-8"))
    lines = Path(layer["sidecar"]["path"]).read_text(encoding="utf-8").splitlines()
    return collection, [json.loads(line) for line in lines]


def copy(tmp_path: Path, name: str) -> Path:
    target = tmp_path / name
    shutil.copyfile(TWEED_GPKG, target)
    return target


def niagara_gpkg(tmp_path: Path, count: int) -> Path:
    """The first `count` real Niagara footprints written into a GeoPackage table with their Z, nothing changed."""
    features = json.loads(NIAGARA.read_text(encoding="utf-8"))["features"][:count]
    path = tmp_path / "niagara.gpkg"
    with sqlite3.connect(path) as db:
        db.executescript("CREATE TABLE gpkg_contents(table_name TEXT,data_type TEXT);"
                         "CREATE TABLE gpkg_geometry_columns(table_name TEXT,column_name TEXT,srs_id INTEGER,"
                         "z INTEGER,m INTEGER);"
                         "CREATE TABLE gpkg_spatial_ref_sys(srs_id INTEGER,organization TEXT,"
                         "organization_coordsys_id INTEGER,definition TEXT);"
                         "CREATE TABLE footprints(fid INTEGER PRIMARY KEY,geom BLOB,source_id INTEGER);")
        from pyproj import CRS
        db.execute("INSERT INTO gpkg_contents VALUES('footprints','features')")
        db.execute("INSERT INTO gpkg_geometry_columns VALUES('footprints','geom',2958,1,0)")
        db.execute("INSERT INTO gpkg_spatial_ref_sys VALUES(2958,'EPSG',2958,?)", (CRS.from_epsg(2958).to_wkt(),))
        for feature in features:
            blob = b"GP\x00\x01" + struct.pack("<i", 2958) + shape(feature["geometry"]).wkb
            db.execute("INSERT INTO footprints(fid,geom,source_id) VALUES(?,?,?)", (feature["id"], blob, feature["id"]))
    return path


@pytest.mark.skipif(not NIAGARA.exists(), reason="the Niagara footprints original")
def test_a_geopackage_over_2000_polygons_is_written_whole_with_its_heights_and_stated_crs(tmp_path):
    count = 2 * WINDOW + 500
    path = niagara_gpkg(tmp_path, count)
    [layer] = convert(path, "gpkg", tmp_path)
    assert layer["state"] == "converted" and layer["crs"] == "EPSG:2958"
    assert (layer["features"], layer["notWritten"]) == (count, 0)
    collection, sidecar = written(layer)
    assert list(collection) == ["type", "crs", "features"]
    assert collection["crs"] == {"type": "name", "properties": {"name": "EPSG:2958"}}
    assert hashlib.sha256(Path(layer["geojson"]["path"]).read_bytes()).hexdigest() == layer["geojson"]["sha256"]
    source = json.loads(NIAGARA.read_text(encoding="utf-8"))["features"][:count]
    for index in (0, WINDOW - 1, WINDOW, count - 1):
        assert collection["features"][index]["geometry"]["coordinates"] == source[index]["geometry"]["coordinates"]
        assert collection["features"][index]["properties"] == {"fid": source[index]["id"],
                                                               "source_id": source[index]["id"]}
        assert sidecar[1 + index] == {"feature": index, "position": source[index]["id"]}


def test_each_geopackage_layer_is_its_own_derivative_and_a_layer_without_crs_is_not_written(tmp_path):
    path = copy(tmp_path, "layers.gpkg")
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE "Copy" AS SELECT * FROM "Council_Buildings"')
        db.execute("INSERT INTO gpkg_contents(table_name,data_type,identifier,srs_id) "
                   "VALUES('Copy','features','Copy',28356)")
        db.execute("INSERT INTO gpkg_geometry_columns SELECT 'Copy',column_name,geometry_type_name,srs_id,z,m "
                   "FROM gpkg_geometry_columns WHERE table_name='Council_Buildings'")
        db.execute('CREATE TABLE "Unstated" AS SELECT * FROM "Council_Buildings"')
        db.execute("INSERT INTO gpkg_contents(table_name,data_type,identifier,srs_id) "
                   "VALUES('Unstated','features','Unstated',-1)")
        db.execute("INSERT INTO gpkg_geometry_columns SELECT 'Unstated',column_name,geometry_type_name,-1,z,m "
                   "FROM gpkg_geometry_columns WHERE table_name='Council_Buildings'")
    layers = convert(path, "gpkg", tmp_path)
    assert [(layer["layer"], layer["state"]) for layer in layers] == [
        ("Copy", "converted"), ("Council_Buildings", "converted"), ("Unstated", "crs_unstated")]
    assert layers[2]["reason"] == "states no coordinate reference system" and "geojson" not in layers[2]
    # A table made by CREATE TABLE AS has no primary key: its rows are cited by rowid.
    assert written(layers[0])[1][0]["positionField"] == "_rowid_"
    assert [layer["features"] for layer in layers[:2]] == [88, 88]


def test_the_sidecar_names_each_feature_row_and_lists_a_row_that_is_not_written(tmp_path):
    path = copy(tmp_path, "refused.gpkg")
    with sqlite3.connect(path) as db:
        # The copy's spatial-index triggers call functions only a spatial SQLite has; the copy needs no index.
        for (trigger,) in db.execute("SELECT name FROM sqlite_master WHERE type='trigger' "
                                     "AND tbl_name='Council_Buildings'").fetchall():
            db.execute(f'DROP TRIGGER "{trigger}"')
        db.execute("UPDATE Council_Buildings SET Shape=X'00' WHERE OBJECTID=3")
    [layer] = convert(path, "gpkg", tmp_path)
    collection, sidecar = written(layer)
    assert (layer["features"], layer["notWritten"]) == (87, 1)
    assert sidecar[3] == {"feature": None, "position": 3, "reason": "geometry_header"}
    with sqlite3.connect(TWEED_GPKG) as db:
        rows = db.execute("SELECT OBJECTID,Building_Name FROM Council_Buildings ORDER BY OBJECTID").fetchall()
    written_rows = [row for row in rows if row[0] != 3]
    for line in sidecar[1:]:
        if line["feature"] is not None:
            feature = collection["features"][line["feature"]]
            assert (line["position"], feature["properties"]["Building_Name"]) == written_rows[line["feature"]]
            assert feature["properties"]["OBJECTID"] == line["position"]


def test_derivative_geometry_equals_the_native_readers_decode(tmp_path):
    [layer] = convert(TWEED_GPKG, "gpkg", tmp_path)
    native = _gpkg(TWEED_GPKG.read_bytes(), "Council_Buildings", None)
    collection, _ = written(layer)
    for index in (0, 41, 87):
        assert collection["features"][index]["geometry"]["coordinates"] == \
            json.loads(json.dumps(native["geometries"][index]["coordinates"]))


def test_a_shapefile_zip_is_written_with_record_positions_and_matches_the_native_decode(tmp_path):
    [layer] = convert(TWEED_ZIP, "shapefile_zip", tmp_path)
    assert (layer["state"], layer["crs"], layer["features"]) == ("converted", "EPSG:28356", 88)
    collection, sidecar = written(layer)
    assert sidecar[0]["member"] == "Council_Buildings.dbf" and sidecar[0]["positionKind"] == "sequence"
    assert [line["position"] for line in sidecar[1:]] == list(range(88))
    native = _shapefile(TWEED_ZIP.read_bytes(), "council_buildings", None)
    for index in (0, 41, 87):
        assert shape(collection["features"][index]["geometry"]).equals(shape(native["geometries"][index]))
        assert collection["features"][index]["properties"] == native["features"][index]["attributes"]


def noprj_zip(tmp_path: Path) -> Path:
    """A test_only copy of the real Tweed shapefile ZIP with its .prj left out; the original is not touched."""
    import zipfile
    source = zipfile.ZipFile(TWEED_ZIP)
    target = tmp_path / "noprj.zip"
    with zipfile.ZipFile(target, "w") as archive:
        for entry in source.infolist():
            if not entry.filename.lower().endswith(".prj"):
                archive.writestr(entry.filename, source.read(entry))
    return target


def test_a_shapefile_set_without_prj_is_not_written(tmp_path):
    [layer] = convert(noprj_zip(tmp_path), "shapefile_zip", tmp_path)
    assert (layer["state"], layer["reason"]) == ("crs_unstated", "states no coordinate reference system (no .prj)")
    assert layer["statesCrs"] is False


class Storage:
    def __init__(self, objects):
        self.objects, self.uploads = objects, {}

    def get_object(self, Bucket, Key):
        raw = self.objects[Key]

        class Body(io.BytesIO):
            def iter_chunks(self, chunk_size):
                while block := self.read(chunk_size):
                    yield block
        return {"Body": Body(raw)}

    def upload_file(self, path, bucket, key, ExtraArgs):
        self.uploads[key] = (Path(path).read_bytes(), ExtraArgs)


def test_the_original_is_read_from_storage_checked_and_each_derivative_stored_by_its_hash():
    raw = TWEED_GPKG.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    source = "10000000-0000-4000-8000-000000000001"
    key = f"sources/{source}/{digest}"
    storage = Storage({key: raw})
    request = {"sourceId": source, "objectKey": key, "sha256": digest, "bytes": len(raw), "format": "gpkg"}
    result = convert_native(request, storage)
    [layer] = result["layers"]
    assert result["conversion"] == "native_gis_to_geojson@1" and "path" not in layer["geojson"]
    stored, extra = storage.uploads[layer["geojson"]["objectKey"]]
    assert hashlib.sha256(stored).hexdigest() == layer["geojson"]["sha256"] == extra["Metadata"]["sha256"]
    assert layer["sidecar"]["objectKey"] in storage.uploads
    with pytest.raises(InputError):
        convert_native({**request, "bytes": len(raw) - 1}, Storage({key: raw}))
    with pytest.raises(InputError):
        convert_native({**request, "objectKey": f"sources/{source}/{'0' * 64}"}, storage)


def test_an_officer_stated_crs_converts_a_shapefile_set_without_prj_as_the_officer_stated_it(tmp_path):
    path = noprj_zip(tmp_path)
    out = tmp_path / "answered"
    out.mkdir()
    [layer] = convert_native_file(path, "shapefile_zip", out, sha(path), {"Council_Buildings": "EPSG:28356"})
    assert (layer["state"], layer["crs"], layer["crsSource"], layer["features"]) == \
        ("converted", "EPSG:28356", "officer_stated", 88)
    collection, sidecar = written(layer)
    assert collection["crs"] == {"type": "name", "properties": {"name": "EPSG:28356"}}
    assert (sidecar[0]["crs"], sidecar[0]["crsSource"]) == ("EPSG:28356", "officer_stated")
    [stated] = convert(TWEED_ZIP, "shapefile_zip", tmp_path)
    assert stated["crsSource"] == "stated" and "crsSource" not in written(stated)[1][0]
    # Only the CRS member differs: every feature is written exactly as the file with its .prj gives it.
    assert collection["features"] == written(stated)[0]["features"]


def test_an_unknown_code_is_refused_and_a_stated_crs_is_never_replaced(tmp_path):
    path = copy(tmp_path, "answered.gpkg")
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE "Unstated" AS SELECT * FROM "Council_Buildings"')
        # Removing the CRS: the column and every geometry header name the undefined system -1.
        db.create_function("undefined", 1, lambda blob: blob[:4] + struct.pack("<i", -1) + blob[8:])
        db.execute("UPDATE Unstated SET Shape=undefined(Shape)")
        db.execute("INSERT INTO gpkg_contents(table_name,data_type,identifier,srs_id) "
                   "VALUES('Unstated','features','Unstated',-1)")
        db.execute("INSERT INTO gpkg_geometry_columns SELECT 'Unstated',column_name,geometry_type_name,-1,z,m "
                   "FROM gpkg_geometry_columns WHERE table_name='Council_Buildings'")
    out = tmp_path / "out"
    out.mkdir()
    layers = convert_native_file(path, "gpkg", out, sha(path),
                                 {"Council_Buildings": "EPSG:4326", "Unstated": "EPSG:28356"})
    assert [(layer["state"], layer["crs"], layer["crsSource"], layer["features"]) for layer in layers] == [
        ("converted", "EPSG:28356", "stated", 88), ("converted", "EPSG:28356", "officer_stated", 88)]
    assert [feature["geometry"] for feature in written(layers[1])[0]["features"]] == \
        [feature["geometry"] for feature in written(layers[0])[0]["features"]]
    unknown = tmp_path / "unknown"
    unknown.mkdir()
    [_, refused] = convert_native_file(path, "gpkg", unknown, sha(path), {"Unstated": "EPSG:999999"})
    assert refused == {"layer": "Unstated", "ordinal": 1, "state": "not_converted",
                       "reason": "the officer's stated EPSG:999999 is not a two-dimensional EPSG system the reader "
                                 "knows"}
    asked = tmp_path / "asked"
    asked.mkdir()
    [_, unstated] = convert_native_file(path, "gpkg", asked, sha(path))
    assert (unstated["state"], unstated["statesCrs"]) == ("crs_unstated", False)


def test_answers_must_name_layers_with_epsg_codes():
    request = {"sourceId": "10000000-0000-4000-8000-000000000001", "objectKey": "x", "sha256": "0" * 64,
               "bytes": 1, "format": "gpkg"}
    for answers in ({"Unstated": "28356"}, {"Unstated": "EPSG:0"}, ["EPSG:28356"], {"": "EPSG:28356"}):
        with pytest.raises(InputError, match="layerCrs"):
            convert_native({**request, "layerCrs": answers}, Storage({}))


def test_the_intake_routes_check_resolves_a_known_code_to_itself_and_refuses_an_unknown_one():
    from geo.area import resolve_geojson_crs

    def named(code):
        return {"collection": {"crs": {"type": "name", "properties": {"name": code}}}}
    assert resolve_geojson_crs(named("EPSG:28356"))["authority"] == "EPSG:28356"
    for code in ("EPSG:999999", "EPSG:4979"):
        with pytest.raises(InputError):
            resolve_geojson_crs(named(code))


# KML1. Google's libkml samples (test_only, as datasets.json records them) and a test_only KML written below.
KML_DATA = Path("E:/BhuAayam-data/task-data/desktop-kml-native/originals")
KML_SAMPLES = KML_DATA / "kmlsamples.kml"
MULTI_KMZ = KML_DATA / "multikml-doc.kmz"
WARD = """<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document><name>Ward 12</name>
  <Style id="s"><PolyStyle><color>ff0000ff</color></PolyStyle></Style>
  <NetworkLink><name>Live tiles</name><Link><href>https://example.invalid/tiles.kml</href></Link></NetworkLink>
  <Folder><name>Buildings</name>
    <Placemark><name>Block A</name><styleUrl>#s</styleUrl>
      <ExtendedData><Data name="storeys"><value>4</value></Data>
        <SchemaData schemaUrl="#b"><SimpleData name="use">residential</SimpleData></SchemaData></ExtendedData>
      <Polygon><altitudeMode>relativeToGround</altitudeMode>
        <outerBoundaryIs><LinearRing><coordinates>77.1,28.6,12 77.2,28.6,12 77.2,28.7,12 77.1,28.6,12</coordinates>
        </LinearRing></outerBoundaryIs>
        <innerBoundaryIs><LinearRing><coordinates>77.12,28.61,12 77.13,28.61,12 77.13,28.62,12 77.12,28.61,12
        </coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark>
    <Placemark><name>Mixed</name><LineString><coordinates>77.1,28.6 77.2,28.6,5</coordinates></LineString>
    </Placemark>
    <Placemark><name>Twice</name><ExtendedData><Data name="name"><value>other</value></Data></ExtendedData>
      <Point><coordinates>77.1,28.6</coordinates></Point></Placemark>
  </Folder>
  <Folder><name>Buildings</name>
    <Placemark><name>Gate</name><MultiGeometry><Point><coordinates>77.3,28.6</coordinates></Point>
      <Point><coordinates>77.31,28.6</coordinates></Point></MultiGeometry></Placemark>
    <Placemark><name>Note</name></Placemark>
  </Folder>
  <GroundOverlay><Icon><href>plan.png</href></Icon></GroundOverlay>
</Document></kml>"""


def kml(path: Path, fmt: str, tmp_path: Path) -> tuple[list[dict], dict]:
    out = Path(tempfile.mkdtemp(dir=tmp_path))
    return convert_kml_file(path, fmt, out, sha(path))


def text_file(tmp_path: Path, name: str, text: str) -> Path:
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


@pytest.mark.skipif(not KML_SAMPLES.exists(), reason="the libkml samples")
def test_each_kml_folder_holding_placemarks_is_its_own_layer_with_heights_and_modes_as_written(tmp_path):
    layers, not_read = kml(KML_SAMPLES, "kml", tmp_path)
    assert [(layer["layer"], layer["state"], layer.get("features")) for layer in layers] == [
        ("Placemarks", "converted", 3), ("Highlighted Icon", "converted", 1),
        ("Styles and Markup", "not_converted", None), ("Paths", "converted", 6),
        ("Google Campus", "converted", 4), ("Extruded Polygon", "converted", 1),
        ("Absolute and Relative", "converted", 4)]
    assert layers[2]["reason"] == "holds no Placemark whose geometry could be written"
    assert not_read == {"GroundOverlay": 1, "ScreenOverlay": 7}
    collection, sidecar = written(layers[4])
    assert collection["crs"] == {"type": "name", "properties": {"name": "EPSG:4326"}}
    assert (sidecar[0]["crs"], sidecar[0]["positionKind"]) == ("EPSG:4326", "placemark_sequence")
    assert "KML 2.2 specification" in layers[4]["crsBasis"] and layers[4]["crsSource"] == "stated"
    building = collection["features"][0]
    assert building["properties"] == {"name": "Building 40", "altitudeMode": "relativeToGround"}
    assert building["geometry"]["coordinates"][0][0] == [-122.0848938459612, 37.42257124044786, 17.0]
    assert sidecar[1] == {"feature": 0, "position": 11}


@pytest.mark.skipif(not MULTI_KMZ.exists(), reason="the libkml samples")
def test_a_kmz_with_no_root_doc_kml_and_several_kml_members_is_not_converted_with_words(tmp_path):
    assert kml(MULTI_KMZ, "kmz", tmp_path) == ([{"layer": "whole file", "ordinal": 0, "state": "not_converted",
                                                 "reason": "holds 4 .kml members and none is doc.kml at its root"}], {})


def test_names_and_extended_data_are_properties_and_a_refused_placemark_is_named_in_the_sidecar(tmp_path):
    layers, not_read = kml(text_file(tmp_path, "ward.kml", WARD), "kml", tmp_path)
    assert not_read == {"NetworkLink": 1, "GroundOverlay": 1}
    assert [(layer["layer"], layer["features"], layer["notWritten"]) for layer in layers] == [
        ("Buildings", 1, 2), ("Buildings (2)", 2, 0)]
    collection, sidecar = written(layers[0])
    [block] = collection["features"]
    assert block["properties"] == {"name": "Block A", "storeys": "4", "use": "residential",
                                   "altitudeMode": "relativeToGround"}
    assert block["geometry"]["type"] == "Polygon" and len(block["geometry"]["coordinates"]) == 2
    assert block["geometry"]["coordinates"][0][0] == [77.1, 28.6, 12.0]
    assert sidecar[1:] == [{"feature": 0, "position": 0},
                           {"feature": None, "position": 1, "reason": "coordinates_mixed_height"},
                           {"feature": None, "position": 2, "reason": "attribute_repeated:name"}]
    gate, note = written(layers[1])[0]["features"]
    assert gate["geometry"] == {"type": "MultiPoint", "coordinates": [[77.3, 28.6], [77.31, 28.6]]}
    assert (note["properties"], note["geometry"]) == ({"name": "Note"}, None)


def test_a_kmz_reads_its_doc_kml_as_a_stream_and_writes_what_the_kml_writes(tmp_path):
    import zipfile
    path = tmp_path / "ward.kmz"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("files/plan.png", b"\x89PNG\r\n\x1a\n")
        archive.writestr("doc.kml", WARD)
        archive.writestr("files/other.kml", "<kml/>")
    layers, not_read = kml(path, "kmz", tmp_path)
    plain, _ = kml(text_file(tmp_path, "ward.kml", WARD), "kml", tmp_path)
    assert [layer["geojson"]["sha256"] for layer in layers] == [layer["geojson"]["sha256"] for layer in plain]
    assert not_read == {"NetworkLink": 1, "GroundOverlay": 1}
    assert written(layers[0])[1][0]["member"] == "doc.kml"


def test_no_placemark_a_root_other_than_kml_and_a_document_type_are_not_converted(tmp_path):
    links = text_file(tmp_path, "links.kml", '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><NetworkLink>'
                      '<Link><href>a.kml</href></Link></NetworkLink></Document></kml>')
    assert kml(links, "kml", tmp_path) == ([{"layer": "whole file", "ordinal": 0, "state": "not_converted",
                                             "reason": "holds no Placemark"}], {"NetworkLink": 1})
    fragment = text_file(tmp_path, "fragment.kml", "<Placemark><name>a</name></Placemark>")
    [stopped], _ = kml(fragment, "kml", tmp_path)
    assert stopped["reason"] == "is not a KML 2.2 document: its root is not kml in the KML namespace"
    typed = text_file(tmp_path, "typed.kml", '<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY e "x">]><kml/>')
    with pytest.raises(InputError, match="document type"):
        kml(typed, "kml", tmp_path)


def test_a_kmz_is_read_from_storage_and_its_not_read_elements_are_counted():
    import zipfile
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("doc.kml", WARD)
    raw = buffer.getvalue()
    digest = hashlib.sha256(raw).hexdigest()
    source = "10000000-0000-4000-8000-000000000002"
    key = f"sources/{source}/{digest}"
    storage = Storage({key: raw})
    result = convert_native({"sourceId": source, "objectKey": key, "sha256": digest, "bytes": len(raw),
                             "format": "kmz"}, storage)
    assert result["readerVersion"] == "native-kml-stream/1"
    assert result["notRead"] == {"NetworkLink": 1, "GroundOverlay": 1}
    assert all(layer["geojson"]["objectKey"] in storage.uploads for layer in result["layers"])
