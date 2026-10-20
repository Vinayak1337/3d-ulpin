"""Bounded 2D GeoPackage and Shapefile-set adapters; originals remain caller assets."""
from __future__ import annotations

import base64
import binascii
import hashlib
import io
import json
import math
import re
import sqlite3
import stat
import struct
import tempfile
import time
import zipfile
from pathlib import Path, PurePosixPath

from pyproj import CRS
from pyproj.exceptions import CRSError
from shapely import from_wkb

from .validation import InputError

MAX_BYTES = 16 * 1024 * 1024
MAX_EXPANDED = 64 * 1024 * 1024


def _raw(data):
    encoded = data.get("base64")
    if not isinstance(encoded, str) or len(encoded) > (MAX_BYTES + 2) // 3 * 4:
        raise InputError("Native GIS input requires base64 containing at most 16 MiB.")
    try:
        result = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise InputError("Native GIS base64 is invalid.") from None
    if not result or len(result) > MAX_BYTES:
        raise InputError("Native GIS input must contain 1 byte–16 MiB.")
    return result


def _epsg(wkt):
    try:
        reference = CRS.from_wkt(wkt)
        code = reference.to_epsg()
        if code is None or len(reference.axis_info) != 2:
            raise ValueError()
        return code
    except (ValueError, TypeError, CRSError):
        raise InputError("The source CRS must resolve to a supported two-dimensional EPSG reference; do not relabel unknown coordinates.") from None


def _arcgis(geometry):
    kind, coordinates = geometry["type"], geometry["coordinates"]
    if kind == "Polygon":
        return {"rings": coordinates}
    if kind == "MultiPolygon":
        return {"rings": [ring for polygon in coordinates for ring in polygon]}
    if kind == "LineString":
        return {"paths": [coordinates]}
    if kind == "MultiLineString":
        return {"paths": coordinates}
    if kind == "Point":
        return {"x": coordinates[0], "y": coordinates[1]}
    if kind == "MultiPoint":
        return {"points": coordinates}
    raise InputError("Native GIS adapter supports 2D simple point, line and polygon geometries, including multipart forms.")


def _field_names(mapping):
    from .area_semantics import selected_semantic_fields
    return sorted(set([mapping[key] for key in ("idField", "nameField", "heightField") if mapping.get(key)] + mapping.get("identifierFields", []) + selected_semantic_fields(mapping)))


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _gpkg_position(connection: sqlite3.Connection, layer: str, columns: list) -> tuple[str, str]:
    primary = [entry for entry in columns if entry[5]]
    if len(primary) == 1 and primary[0][2].upper() == "INTEGER":
        return primary[0][1], "integer_primary_key"
    for name in ("_rowid_", "rowid", "oid"):
        if name.lower() not in {entry[1].lower() for entry in columns}:
            try:
                connection.execute(f"SELECT {name} FROM {_quote(layer)} LIMIT 0")
                return name, "rowid"
            except sqlite3.Error:
                continue
    raise InputError("GeoPackage table has no accessible rowid or single integer primary key; "
                     "a stable decoded-record citation is unavailable for this table.")


def _gpkg(raw, layer, selected):
    # selected=None is bounded metadata inspection through the same native reader.
    inspecting = selected is None
    from .area import _json_geometry, _geometry, MAX_FEATURES, MAX_VERTICES
    if not raw.startswith(b"SQLite format 3\x00"):
        raise InputError("GeoPackage must be a SQLite GeoPackage file.")
    with tempfile.TemporaryDirectory(prefix="ulpin-gpkg-") as temporary:
        path = Path(temporary) / "source.gpkg"
        path.write_bytes(raw)
        connection = sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)
        try:
            connection.execute("PRAGMA query_only=ON")
            connection.execute("PRAGMA trusted_schema=OFF")
            started = time.monotonic()
            connection.set_progress_handler(lambda: int(time.monotonic() - started > 5), 10000)
            layers = connection.execute("SELECT table_name FROM gpkg_contents WHERE data_type='features' ORDER BY table_name LIMIT 101").fetchall()
            names = [item[0] for item in layers]
            if not names or len(names) > 100:
                raise InputError("GeoPackage must have 1–100 feature layers; raster/tile-only packages need a different adapter.")
            if layer is None:
                if len(names) != 1:
                    if inspecting:
                        return {"layers": names}
                    raise InputError("Select one GeoPackage feature layer explicitly; multiple layers must be ingested with their own semantics.")
                layer = names[0]
            if layer not in names or not isinstance(layer, str) or len(layer) > 256:
                raise InputError("Selected GeoPackage layer is unavailable.")
            table = connection.execute("SELECT type,sql FROM sqlite_master WHERE name=?", (layer,)).fetchone()
            if table is None or table[0] != "table" or "VIRTUAL TABLE" in table[1].upper():
                raise InputError("GeoPackage views or virtual tables are unsupported; provide a materialized native feature table.")
            meta = connection.execute("SELECT column_name,srs_id,z,m FROM gpkg_geometry_columns WHERE table_name=?", (layer,)).fetchall()
            if len(meta) != 1 or meta[0][2] != 0 or meta[0][3] != 0:
                raise InputError("GeoPackage layer requires one strictly 2D geometry column; Z/M must use an explicitly supported utility-level schedule.")
            column, srs_id = meta[0][:2]
            srs = connection.execute("SELECT organization,organization_coordsys_id,definition FROM gpkg_spatial_ref_sys WHERE srs_id=?", (srs_id,)).fetchone()
            if srs is None:
                raise InputError("GeoPackage source CRS metadata is missing.")
            epsg = int(srs[1]) if str(srs[0]).upper() == "EPSG" and int(srs[1]) > 0 else _epsg(srs[2])
            reference = CRS.from_epsg(epsg)
            if len(reference.axis_info) != 2:
                raise InputError("GeoPackage requires a two-dimensional EPSG reference.")
            if srs[2] and str(srs[2]).lower() != "undefined" and not CRS.from_wkt(srs[2]).equals(reference):
                raise InputError("GeoPackage EPSG and WKT declarations conflict; correct the source metadata.")
            columns = connection.execute(f"PRAGMA table_info({_quote(layer)})").fetchall()
            available = {entry[1] for entry in columns}
            position_field, position_kind = _gpkg_position(connection, layer, columns)
            encoding = connection.execute("PRAGMA encoding").fetchone()[0]
            if inspecting:
                selected = sorted(available - {column})
                if len(selected) > 256:
                    raise InputError("GIS inspection supports at most 256 attribute fields.")
            if any(name not in available for name in selected):
                raise InputError("A mapped field is absent from the selected GeoPackage layer.")
            names_sql = ','.join(_quote(name) for name in [column] + selected + [position_field])
            records = connection.execute(
                f"SELECT {names_sql} FROM {_quote(layer)} ORDER BY {_quote(position_field)} "
                f"LIMIT {MAX_FEATURES + 1}"
            ).fetchall()
            if not 1 <= len(records) <= MAX_FEATURES:
                raise InputError("GeoPackage selected layer must have 1–2000 features; no partial layer is imported.")
            features, originals, count = [], [], 0
            for record in records:
                binary = record[0]
                if not isinstance(binary, bytes) or len(binary) < 9 or binary[:2] != b"GP" or binary[2] != 0:
                    raise InputError("Invalid GeoPackage binary geometry header.")
                flags = binary[3]
                envelope = (flags >> 1) & 7
                if flags & 0xF0 or envelope not in (0, 1):
                    raise InputError("Empty, extended or Z/M GeoPackage geometries require a dedicated profile; no dimensions are dropped.")
                geometry_srs = struct.unpack("<i" if flags & 1 else ">i", binary[4:8])[0]
                if geometry_srs != srs_id:
                    raise InputError("GeoPackage geometry CRS differs from its layer reference.")
                offset = 8 + (32 if envelope == 1 else 0)
                try:
                    parsed = from_wkb(binary[offset:])
                    geometry = _json_geometry(parsed)
                    _, vertices = _geometry(geometry, "GeoPackage feature", topology=False)
                except InputError:
                    raise
                except Exception:
                    raise InputError("GeoPackage WKB is malformed or unsupported.") from None
                count += vertices
                if count > MAX_VERTICES:
                    raise InputError("GeoPackage layer exceeds 100,000 vertices.")
                position = record[-1]
                if not isinstance(position, int) or abs(position) > 9007199254740991:
                    raise InputError("GeoPackage record position must be a safe integer.")
                native_record = {"format": "gpkg", "table": layer, "position": position,
                                 "positionKind": position_kind, "positionField": position_field,
                                 "encoding": encoding, "readerVersion": "native-gis-v2"}
                features.append({"attributes": dict(zip(selected, record[1:-1])),
                                 "geometry": _arcgis(geometry), "nativeRecord": native_record})
                originals.append(geometry)
            return {"layers": names, "layer": layer, "features": features, "geometries": originals, "epsg": epsg} if inspecting else (features, originals, epsg, layer)
        except CRSError:
            raise InputError("GeoPackage CRS metadata is invalid; correct the source reference.") from None
        except sqlite3.Error:
            raise InputError("GeoPackage schema is malformed, unsupported or exceeds the five-second native read limit.") from None
        finally:
            connection.close()


def _shapefile(raw, layer, selected):
    inspecting = selected is None
    import shapefile
    from .area import _geometry, _arcgis_geometry, GeometryRejected, MAX_FEATURES, MAX_VERTICES
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            if len(entries) > 1000 or sum(entry.file_size for entry in entries) > MAX_EXPANDED:
                raise InputError("Shapefile ZIP exceeds 1000 members or 64 MiB expanded bytes.")
            names = {}
            for entry in entries:
                path = PurePosixPath(entry.filename)
                if path.is_absolute() or ".." in path.parts or "\\" in entry.filename or re.match(r"^[A-Za-z]:", entry.filename) or stat.S_ISLNK(entry.external_attr >> 16) or entry.flag_bits & 1:
                    raise InputError("Shapefile archive contains an unsafe path, symlink or encrypted member.")
                if entry.is_dir():
                    continue
                name = str(path).lower()
                if name in names:
                    raise InputError("Shapefile ZIP contains duplicate case-insensitive member names.")
                names[name] = entry.filename
            layers = [name[:-4] for name in names if name.endswith(".shp")]
            if not 1 <= len(layers) <= 100:
                raise InputError("Shapefile ZIP must contain 1–100 layers.")
            if layer is None:
                if len(layers) != 1:
                    if inspecting:
                        return {"layers": layers}
                    raise InputError("Select one Shapefile layer explicitly when the archive contains multiple sets.")
                layer = layers[0]
            layer = str(layer).lower().removesuffix(".shp")
            if layer not in layers or any(layer + suffix not in names for suffix in (".shp", ".shx", ".dbf", ".prj")):
                raise InputError("Shapefile import requires a matching .shp, .shx, .dbf and .prj set.")
            component = lambda suffix: archive.read(names[layer + suffix])
            epsg = _epsg(component(".prj").decode("utf-8-sig"))
            encoding = component(".cpg").decode("ascii").strip() if layer + ".cpg" in names else "utf-8"
            encoding = {"65001": "utf-8", "1252": "cp1252"}.get(encoding, encoding)
            if encoding.lower() not in ("utf-8", "utf8", "cp1252", "windows-1252", "iso-8859-1"):
                raise InputError("Shapefile character encoding is unsupported; provide UTF-8, Windows-1252 or ISO-8859-1 explicitly.")
            with shapefile.Reader(shp=io.BytesIO(component(".shp")), shx=io.BytesIO(component(".shx")), dbf=io.BytesIO(component(".dbf")), encoding=encoding) as reader:
                if reader.shapeType not in (1, 3, 5, 8):
                    raise InputError("Shapefile requires 2D Point/Polyline/Polygon/Multipoint. Z/M/MultiPatch are explicitly unsupported.")
                if not 1 <= len(reader) <= MAX_FEATURES or reader.numShapes != reader.numRecords:
                    raise InputError("Shapefile must contain 1–2000 matching geometry/attribute records.")
                fields = [item[0] for item in reader.fields[1:]]
                if inspecting:
                    selected = fields
                    if len(selected) > 256:
                        raise InputError("GIS inspection supports at most 256 attribute fields.")
                if any(name not in fields for name in selected):
                    raise InputError("A mapped field is absent from the Shapefile DBF.")
                features, originals, count = [], [], 0
                for position, item in enumerate(reader.iterShapeRecords()):
                    if item.shape.shapeType == 5:
                        starts = list(item.shape.parts) + [len(item.shape.points)]
                        rings = [[list(point) for point in item.shape.points[starts[i]:starts[i + 1]]] for i in range(len(starts) - 1)]
                        try:
                            geometry = _arcgis_geometry({"rings": rings})
                        except GeometryRejected:
                            # Replay these unchanged rings into the common validator;
                            # rejected rows retain their original indexes and attributes.
                            geometry = {"type": "Polygon", "coordinates": rings}
                    else:
                        geometry = json.loads(json.dumps(item.shape.__geo_interface__))
                    try:
                        _, vertices = _geometry(geometry, "Shapefile feature", topology=False)
                    except GeometryRejected as error:
                        vertices = error.vertices
                    count += vertices
                    if count > MAX_VERTICES:
                        raise InputError("Shapefile exceeds 100,000 total vertices.")
                    attributes = item.record.as_dict()
                    selected_values = {name: attributes[name].isoformat() if hasattr(attributes[name], "isoformat") else attributes[name] for name in selected}
                    native_record = {"format": "shapefile_zip", "member": names[layer + ".dbf"],
                                     "position": position, "positionKind": "sequence", "encoding": encoding,
                                     "readerVersion": "native-gis-v2"}
                    features.append({"attributes": selected_values, "geometry": _arcgis(geometry),
                                     "nativeRecord": native_record})
                    originals.append(geometry)
                if len(features) != reader.numRecords:
                    raise InputError("Deleted/missing Shapefile records cannot silently disappear; supply a consistent source export.")
                return {"layers": layers, "layer": layer, "features": features, "geometries": originals, "epsg": epsg} if inspecting else (features, originals, epsg, layer)
    except InputError:
        raise
    except (zipfile.BadZipFile, UnicodeError, LookupError, shapefile.ShapefileException, ValueError, OSError):
        raise InputError("Shapefile archive could not be parsed with its declared companions and encoding.") from None


def decode_shapefile_record(raw: bytes, reference: dict) -> dict:
    member = reference.get("member", "")
    if not isinstance(member, str) or not member.lower().endswith(".dbf"):
        raise InputError("Decoded Shapefile record requires its exact DBF member.")
    parsed = _shapefile(raw, member[:-4], None)
    return _decoded_fields(parsed, reference)


def decode_gpkg_record(raw: bytes, reference: dict) -> dict:
    parsed = _gpkg(raw, reference.get("table"), None)
    return _decoded_fields(parsed, reference)


def _decoded_fields(parsed: dict, reference: dict) -> dict:
    # Select by the retained position only, never by a source-key search.
    matches = [feature for feature in parsed.get("features", [])
               if feature["nativeRecord"]["position"] == reference.get("position")]
    if len(matches) != 1:
        return {"status": "unavailable", "code": "PACKET_PLAN_NATIVE_POSITION_UNAVAILABLE"}
    feature = matches[0]
    actual = {**feature["nativeRecord"], "idField": reference.get("idField")}
    if actual != reference:
        return {"status": "unavailable", "code": "PACKET_PLAN_NATIVE_REFERENCE_MISMATCH"}
    # JSON numbers cross into JavaScript; never publish a rounded 64-bit integer as a decoded value.
    if any(isinstance(value, int) and not isinstance(value, bool) and abs(value) > 9007199254740991
           for value in feature["attributes"].values()):
        return {"status": "unavailable", "code": "PACKET_PLAN_NATIVE_FIELD_UNSUPPORTED"}
    value = feature["attributes"].get(reference["idField"])
    if isinstance(value, bool) or not isinstance(value, (str, int, float)) or str(value).strip() == "":
        return {"status": "unavailable", "code": "PACKET_PLAN_NATIVE_KEY_MISMATCH"}
    return {"status": "available", "decodedRecord": actual, "fields": feature["attributes"],
            "sourceKey": str(value).strip()}


def decode_native_record(data: dict) -> dict:
    raw = _raw(data)
    reference = data.get("nativeRecord")
    if not isinstance(reference, dict) or reference.get("format") != data.get("format"):
        raise InputError("Decoded native record requires a matching import-time reference.")
    decoder = decode_gpkg_record if data["format"] == "gpkg" else decode_shapefile_record
    result = decoder(raw, reference)
    return {**result, "sourceSha256": hashlib.sha256(raw).hexdigest()}


def normalize_native(data):
    if data.get("operation") == "decode_record":
        return decode_native_record(data)
    from .area import normalize_area
    mapping = data.get("mapping")
    if not isinstance(mapping, dict):
        raise InputError("Native GIS import requires explicit typed field mappings.")
    raw = _raw(data)
    parser = _gpkg if data["format"] == "gpkg" else _shapefile
    features, originals, epsg, layer = parser(raw, data.get("layer"), _field_names(mapping))
    canonical = {**data, "format": "arcgis", "data": {"spatialReference": {"wkid": epsg}, "features": features}}
    canonical.pop("base64", None)
    result = normalize_area(canonical)
    for feature in result["features"]:
        index = feature["sourceFeatureIndex"]
        feature["sourceGeometry"] = originals[index]
        feature["sourceReference"] = {**result["reference"], "nativeRecord": {
            **features[index]["nativeRecord"], "idField": mapping["idField"]}}
    result["adapter"] = {"format": data["format"], "version": "native-gis-v2", "layer": layer, "sourceSha256": hashlib.sha256(raw).hexdigest(),
                         "sourceUnits": CRS.from_epsg(epsg).axis_info[0].unit_name}
    result["warnings"].append("Native container bytes remain the source asset. Decoded geometry and normalized arrays are derivatives; no files, rows, dimensions or companion parts were silently discarded.")
    return result


# SH2. Windowed conversion of a whole GeoPackage or shapefile ZIP into one GeoJSON derivative per layer. The original
# is read from scratch disk a window at a time; values are written as decoded, never reprojected, rounded or renamed.
CONVERSION = "native_gis_to_geojson@1"
WINDOW_READER = "native-gis-window/1"
WINDOW = 1000
MAX_SOURCE_BYTES = 128 * 1024 * 1024
MAX_DERIVATIVE_BYTES = 128 * 1024 * 1024
MAX_LAYERS = 100
SAFE_INTEGER = 9007199254740991
_ENVELOPE_BYTES = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
_SOURCE_KEY = re.compile(r"^(sources|large-originals)/([0-9a-f-]{36})/([0-9a-f]{64})$")


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


class _Derivative:
    """One layer's GeoJSON and its locator sidecar, each hashed as it is written; only the current line is held."""

    def __init__(self, folder: Path, ordinal: int, header: dict, crs: str):
        self.paths = {"geojson": folder / f"{ordinal}.geojson", "sidecar": folder / f"{ordinal}.locators.jsonl"}
        self.files = {name: path.open("xb") for name, path in self.paths.items()}
        self.hashes = {name: hashlib.sha256() for name in self.paths}
        self.sizes = dict.fromkeys(self.paths, 0)
        self.features = self.not_written = 0
        crs_member = _json({"type": "name", "properties": {"name": crs}})
        self._write("geojson", '{"type":"FeatureCollection","crs":' + crs_member + ',"features":[')
        self._write("sidecar", _json(header) + "\n")

    def _write(self, name: str, text: str):
        raw = text.encode("utf-8")
        self.sizes[name] += len(raw)
        if self.sizes[name] > MAX_DERIVATIVE_BYTES:
            raise InputError(f"would exceed {MAX_DERIVATIVE_BYTES} bytes once written as GeoJSON")
        self.hashes[name].update(raw)
        self.files[name].write(raw)

    def feature(self, position: int, properties: dict, geometry):
        text = _json({"type": "Feature", "properties": properties, "geometry": geometry})
        self._write("geojson", ("," if self.features else "") + text)
        self._write("sidecar", _json({"feature": self.features, "position": position}) + "\n")
        self.features += 1

    def refuse(self, position: int, reason: str):
        self._write("sidecar", _json({"feature": None, "position": position, "reason": reason}) + "\n")
        self.not_written += 1

    def close(self) -> dict:
        self._write("geojson", "]}")
        self.abandon()
        return {"features": self.features, "notWritten": self.not_written, **{
            name: {"path": str(self.paths[name]), "bytes": self.sizes[name], "sha256": self.hashes[name].hexdigest()}
            for name in self.paths}}

    def abandon(self):
        for handle in self.files.values():
            handle.close()


def _value_refusal(properties: dict) -> str | None:
    """A value JSON cannot carry exactly keeps its record out of the GeoJSON; the sidecar names the field."""
    for name, value in properties.items():
        if isinstance(value, (bytes, bytearray, memoryview)):
            return f"attribute_binary:{name}"
        if isinstance(value, float) and not math.isfinite(value):
            return f"attribute_not_finite:{name}"
        if isinstance(value, int) and not isinstance(value, bool) and abs(value) > SAFE_INTEGER:
            return f"attribute_unsafe_integer:{name}"
    return None


def _wkb_measured(wkb: bytes) -> bool:
    if len(wkb) < 5 or wkb[0] not in (0, 1):
        return False
    code = struct.unpack("<I" if wkb[0] else ">I", wkb[1:5])[0]
    return bool(code & 0x40000000) or 2000 <= code < 4000


def _gpkg_geometry(binary, srs_id: int):
    """One GeoPackage blob as GeoJSON geometry (None for a null or empty one), or the reason it is not written."""
    from shapely.geometry import mapping
    if binary is None:
        return None, None
    if not isinstance(binary, bytes) or len(binary) < 8 or binary[:2] != b"GP" or binary[2] != 0:
        return None, "geometry_header"
    flags = binary[3]
    envelope = (flags >> 1) & 7
    if flags & 0x20 or envelope not in _ENVELOPE_BYTES:
        return None, "geometry_extended"
    if struct.unpack("<i" if flags & 1 else ">i", binary[4:8])[0] != srs_id:
        return None, "geometry_crs_differs"
    if flags & 0x10:
        return None, None
    wkb = binary[8 + _ENVELOPE_BYTES[envelope]:]
    if _wkb_measured(wkb):
        return None, "geometry_measure"
    try:
        parsed = from_wkb(wkb)
    except Exception:
        return None, "geometry_undecodable"
    return (None, None) if parsed.is_empty else (json.loads(_json(mapping(parsed))), None)


def _gpkg_crs(connection: sqlite3.Connection, srs_id) -> tuple[str | None, str | None]:
    """The layer's stated EPSG name, or None and the words naming why no usable one is stated."""
    srs = connection.execute("SELECT organization,organization_coordsys_id,definition FROM gpkg_spatial_ref_sys "
                             "WHERE srs_id=?", (srs_id,)).fetchone()
    if srs is None or srs_id in (0, -1) or str(srs[0]).upper() == "NONE" \
            or str(srs[2] or "").strip().lower() in ("", "undefined"):
        return None, "states no coordinate reference system"
    try:
        epsg = int(srs[1]) if str(srs[0]).upper() == "EPSG" and int(srs[1]) > 0 else _epsg(srs[2])
        if not CRS.from_wkt(srs[2]).equals(CRS.from_epsg(epsg)):
            return None, "states EPSG and WKT coordinate reference systems that conflict"
    except (InputError, CRSError, ValueError, TypeError):
        return None, "states a coordinate reference system that does not resolve to one EPSG code"
    return f"EPSG:{epsg}", None


def _gpkg_layers(path: Path, folder: Path, source_sha256: str) -> list[dict]:
    connection = sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        connection.execute("PRAGMA query_only=ON")
        connection.execute("PRAGMA trusted_schema=OFF")
        names = [row[0] for row in connection.execute(
            "SELECT table_name FROM gpkg_contents WHERE data_type='features' ORDER BY table_name LIMIT ?",
            (MAX_LAYERS + 1,))]
        if not 1 <= len(names) <= MAX_LAYERS:
            raise InputError(f"A GeoPackage must hold 1 to {MAX_LAYERS} feature layers to be converted.")
        return [_gpkg_layer(connection, name, ordinal, folder, source_sha256) for ordinal, name in enumerate(names)]
    except sqlite3.Error:
        raise InputError("The GeoPackage schema could not be read.") from None
    finally:
        connection.close()


def _gpkg_layer(connection, layer: str, ordinal: int, folder: Path, source_sha256: str) -> dict:
    stopped = {"layer": layer, "ordinal": ordinal, "state": "not_converted"}
    table = connection.execute("SELECT type,sql FROM sqlite_master WHERE name=?", (layer,)).fetchone()
    if table is None or table[0] != "table" or "VIRTUAL TABLE" in table[1].upper():
        return {**stopped, "reason": "is a view or virtual table, not a stored feature table"}
    meta = connection.execute("SELECT column_name,srs_id,m FROM gpkg_geometry_columns WHERE table_name=?",
                              (layer,)).fetchall()
    if len(meta) != 1:
        return {**stopped, "reason": "does not have exactly one geometry column"}
    column, srs_id, measured = meta[0]
    if measured == 1:
        return {**stopped, "reason": "stores measure (M) values on every geometry"}
    crs, words = _gpkg_crs(connection, srs_id)
    if crs is None:
        return {**stopped, "state": "crs_unstated", "reason": words}
    columns = connection.execute(f"PRAGMA table_info({_quote(layer)})").fetchall()
    try:
        position, kind = _gpkg_position(connection, layer, columns)
    except InputError:
        return {**stopped, "reason": "has no rowid or single integer primary key to cite each row by"}
    fields = [entry[1] for entry in columns if entry[1] != column]
    header = {"version": "native-gis-locators/1", "conversion": CONVERSION, "readerVersion": WINDOW_READER,
              "originalSha256": source_sha256, "format": "gpkg", "layer": layer, "positionKind": kind,
              "positionField": position}
    derivative = _Derivative(folder, ordinal, header, crs)
    try:
        select = ",".join(_quote(name) for name in [position, column] + fields)
        last = None
        while True:
            # Keyset by the row's own position: one window of rows is held at a time.
            where, values = ("", (WINDOW,)) if last is None else (f"WHERE {_quote(position)}>? ", (last, WINDOW))
            rows = connection.execute(f"SELECT {select} FROM {_quote(layer)} {where}"
                                      f"ORDER BY {_quote(position)} LIMIT ?", values).fetchall()
            for row in rows:
                properties = dict(zip(fields, row[2:]))
                geometry, reason = _gpkg_geometry(row[1], srs_id)
                reason = reason or _value_refusal(properties)
                if reason:
                    derivative.refuse(row[0], reason)
                else:
                    derivative.feature(row[0], properties, geometry)
            if len(rows) < WINDOW:
                break
            last = rows[-1][0]
    except InputError as error:
        derivative.abandon()
        return {**stopped, "reason": str(error)}
    except BaseException:
        derivative.abandon()
        raise
    return {**stopped, "state": "converted", "crs": crs, **derivative.close()}


def _shapefile_layers(path: Path, folder: Path, source_sha256: str) -> list[dict]:
    import shapefile
    try:
        with zipfile.ZipFile(path) as archive:
            names = {}
            for entry in archive.infolist():
                member = PurePosixPath(entry.filename)
                if member.is_absolute() or ".." in member.parts or "\\" in entry.filename \
                        or stat.S_ISLNK(entry.external_attr >> 16) or entry.flag_bits & 1:
                    raise InputError("The shapefile ZIP holds an unsafe path, a link or an encrypted member.")
                if not entry.is_dir():
                    names[entry.filename.lower()] = entry
            layers = sorted(name[:-4] for name in names if name.endswith(".shp"))
            if not 1 <= len(layers) <= MAX_LAYERS:
                raise InputError(f"A shapefile ZIP must hold 1 to {MAX_LAYERS} .shp sets to be converted.")
            return [_shapefile_layer(archive, names, layer, ordinal, folder, source_sha256, shapefile)
                    for ordinal, layer in enumerate(layers)]
    except zipfile.BadZipFile:
        raise InputError("The shapefile ZIP could not be opened.") from None


def _shapefile_layer(archive, names: dict, layer: str, ordinal: int, folder: Path, source_sha256: str,
                     shapefile) -> dict:
    stopped = {"layer": names[layer + ".shp"].filename[:-4], "ordinal": ordinal, "state": "not_converted"}
    if any(layer + suffix not in names for suffix in (".shx", ".dbf")):
        return {**stopped, "reason": "lacks its .shx or .dbf companion"}
    if layer + ".prj" not in names:
        return {**stopped, "state": "crs_unstated", "reason": "states no coordinate reference system (no .prj)"}
    try:
        crs = f"EPSG:{_epsg(archive.read(names[layer + '.prj']).decode('utf-8-sig'))}"
    except (InputError, UnicodeError):
        return {**stopped, "state": "crs_unstated",
                "reason": "states a coordinate reference system that does not resolve to one EPSG code"}
    encoding = archive.read(names[layer + ".cpg"]).decode("ascii").strip() if layer + ".cpg" in names else "utf-8"
    encoding = {"65001": "utf-8", "1252": "cp1252"}.get(encoding, encoding)
    scratch = folder / f"shapefile-{ordinal}"
    scratch.mkdir()
    for suffix in (".shp", ".shx", ".dbf"):
        with archive.open(names[layer + suffix]) as source, (scratch / f"layer{suffix}").open("xb") as target:
            while block := source.read(1024 * 1024):
                target.write(block)
    header = {"version": "native-gis-locators/1", "conversion": CONVERSION, "readerVersion": WINDOW_READER,
              "originalSha256": source_sha256, "format": "shapefile_zip", "layer": stopped["layer"],
              "member": names[layer + ".dbf"].filename, "positionKind": "sequence", "encoding": encoding}
    try:
        reader = shapefile.Reader(str(scratch / "layer"), encoding=encoding)
    except (shapefile.ShapefileException, LookupError, OSError):
        return {**stopped, "reason": "could not be opened with its companions and encoding"}
    with reader:
        if reader.shapeType not in (0, 1, 3, 5, 8) or reader.numShapes != reader.numRecords:
            return {**stopped, "reason": "stores Z, M or MultiPatch shapes, or its shapes and records differ in number"}
        fields = [item[0] for item in reader.fields[1:]]
        derivative = _Derivative(folder, ordinal, header, crs)
        try:
            for start in range(0, len(reader), WINDOW):
                for position in range(start, min(start + WINDOW, len(reader))):
                    _shapefile_record(reader, position, fields, derivative)
        except (InputError, UnicodeError, shapefile.ShapefileException) as error:
            derivative.abandon()
            return {**stopped, "reason": str(error) if isinstance(error, InputError)
                    else "has a record that could not be decoded"}
        except BaseException:
            derivative.abandon()
            raise
    return {**stopped, "state": "converted", "crs": crs, **derivative.close()}


def _shapefile_record(reader, position: int, fields: list, derivative: _Derivative):
    record = reader.record(position)
    if record is None:
        derivative.refuse(position, "record_deleted")
        return
    shape = reader.shape(position)
    values = record.as_dict()
    properties = {name: values[name].isoformat() if hasattr(values[name], "isoformat") else values[name]
                  for name in fields}
    geometry = None if shape.shapeType == 0 else json.loads(_json(shape.__geo_interface__))
    reason = _value_refusal(properties)
    if reason:
        derivative.refuse(position, reason)
    else:
        derivative.feature(position, properties, geometry)


def convert_native_file(path: Path, fmt: str, folder: Path, source_sha256: str) -> list[dict]:
    """Every layer of one original on scratch disk, each converted or stopped with words naming why."""
    if fmt == "gpkg":
        with path.open("rb") as head:
            if head.read(16) != b"SQLite format 3\x00":
                raise InputError("A GeoPackage must be a SQLite GeoPackage file.")
        return _gpkg_layers(path, folder, source_sha256)
    if fmt == "shapefile_zip":
        return _shapefile_layers(path, folder, source_sha256)
    raise InputError("Only a GeoPackage or a shapefile ZIP is converted.")


def _s3():
    import boto3
    from botocore.config import Config
    from . import settings
    return boto3.client("s3", endpoint_url=settings.S3_ENDPOINT, aws_access_key_id=settings.S3_ACCESS_KEY,
                        aws_secret_access_key=settings.S3_SECRET_KEY, region_name=settings.S3_REGION,
                        config=Config(connect_timeout=5, read_timeout=60, retries={"max_attempts": 2}))


def convert_native(data: dict, s3=None) -> dict:
    """SH2. Copies a retained original from object storage to scratch disk (size and SHA-256 checked), converts
    each layer and stores each derivative and its sidecar under content-addressed keys for the caller to retain."""
    from . import settings
    if not isinstance(data, dict) or set(data) != {"sourceId", "objectKey", "sha256", "bytes", "format"}:
        raise InputError("Conversion requires the retained original's exact pins and its format.")
    source_id, key, digest, size, fmt = (data[name] for name in ("sourceId", "objectKey", "sha256", "bytes", "format"))
    match = _SOURCE_KEY.fullmatch(key) if isinstance(key, str) else None
    if not match or match.group(2) != source_id or match.group(3) != digest:
        raise InputError("The object key must name the retained original's ID and SHA-256.")
    if isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= MAX_SOURCE_BYTES:
        raise InputError(f"Conversion reads originals of 1 to {MAX_SOURCE_BYTES} bytes.")
    client = s3 or _s3()
    with tempfile.TemporaryDirectory(prefix="ulpin-native-convert-") as temporary:
        folder = Path(temporary)
        original = folder / "original"
        body = client.get_object(Bucket=settings.S3_BUCKET, Key=key)["Body"]
        hashed, count = hashlib.sha256(), 0
        try:
            with original.open("xb") as target:
                for block in body.iter_chunks(chunk_size=1024 * 1024):
                    count += len(block)
                    if count > size:
                        raise InputError("The retained original is longer than its receipt.")
                    hashed.update(block)
                    target.write(block)
        finally:
            body.close()
        if count != size or hashed.hexdigest() != digest:
            raise InputError("The retained original's size or SHA-256 differs from its receipt.")
        layers = convert_native_file(original, fmt, folder, digest)
        for layer in (layer for layer in layers if layer["state"] == "converted"):
            for name, kind in (("geojson", "application/geo+json"), ("sidecar", "application/x-ndjson")):
                entry = layer[name]
                entry["objectKey"] = f"native-derivatives/{digest}/{layer['ordinal']}/{name}-{entry['sha256']}"
                client.upload_file(entry.pop("path"), settings.S3_BUCKET, entry["objectKey"],
                                   ExtraArgs={"ContentType": kind, "Metadata": {"sha256": entry["sha256"]}})
    return {"conversion": CONVERSION, "readerVersion": WINDOW_READER, "sourceId": source_id,
            "sourceSha256": digest, "layers": layers}
