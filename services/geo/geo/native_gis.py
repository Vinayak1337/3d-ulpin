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
import zlib
from pathlib import Path, PurePosixPath

from pyproj import CRS
from pyproj.exceptions import CRSError
from shapely import from_wkb

from .citygml_outline import OUTLINE_READER as CITYGML_OUTLINE_READER, convert_citygml_file
from .cityjson_outline import OUTLINE_READER, convert_cityjson_file
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
# Both match STREAMING_VECTOR_LIMITS.sourceBytes in packages/contracts/src/usp/streaming-vector.ts (1 GiB).
MAX_SOURCE_BYTES = 1024 * 1024 * 1024
MAX_DERIVATIVE_BYTES = MAX_SOURCE_BYTES
MAX_LAYERS = 100
SAFE_INTEGER = 9007199254740991
_ENVELOPE_BYTES = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
_SOURCE_KEY = re.compile(r"^(sources|large-originals)/([0-9a-f-]{36})/([0-9a-f]{64})$")
_OFFICER_CODE = re.compile(r"EPSG:([1-9][0-9]{0,8})")
_STATES_NONE = "states no coordinate reference system"
_PIN_FIELDS = ("sourceId", "objectKey", "sha256", "bytes")
# N05. A shapefile dropped as loose parts: each part is its own retained original, read together as one set.
SET_FORMAT = "shapefile_set"
SET_PARTS = ("shp", "shx", "dbf", "prj", "cpg")


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
        self.identity_field = header.get("positionField")
        self.name_field = "name" if header.get("format") in ("kml", "kmz") else None
        self.layout = header.get("converterLayout", {
            "method": "converter:" + header["readerVersion"].replace("/", "@"),
            "sourceClasses": [], "kind": None, "identifierField": None, "nameField": None,
        })
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
        if self.identity_field in properties:
            self.layout["identifierField"] = self.identity_field
        if self.name_field in properties:
            self.layout["nameField"] = self.name_field
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
        return {"features": self.features, "notWritten": self.not_written, "converterLayout": self.layout, **{
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
        return None, _STATES_NONE
    try:
        epsg = int(srs[1]) if str(srs[0]).upper() == "EPSG" and int(srs[1]) > 0 else _epsg(srs[2])
        if not CRS.from_wkt(srs[2]).equals(CRS.from_epsg(epsg)):
            return None, "states EPSG and WKT coordinate reference systems that conflict"
    except (InputError, CRSError, ValueError, TypeError):
        return None, "states a coordinate reference system that does not resolve to one EPSG code"
    return f"EPSG:{epsg}", None


def _officer_crs(stopped: dict, words: str, answers: dict) -> str | dict:
    """CR1. A layer whose file states no CRS takes the officer's EPSG code if pyproj builds it as a two-dimensional
    horizontal system; without an answer it rests asking for one. The file's own statement is never replaced."""
    code = answers.get(stopped["layer"])
    if code is None:
        return {**stopped, "state": "crs_unstated", "statesCrs": False, "reason": words}
    try:
        reference = CRS.from_epsg(int(_OFFICER_CODE.fullmatch(code).group(1)))
        if reference.is_compound or len(reference.axis_info) != 2 \
                or not (reference.is_projected or reference.is_geographic):
            raise ValueError()
    except (CRSError, ValueError, AttributeError):
        return {**stopped,
                "reason": f"the officer's stated {code} is not a two-dimensional EPSG system the reader knows"}
    return code


def _crs_fields(crs: str, officer: bool) -> dict:
    return {"crs": crs, "crsSource": "officer_stated"} if officer else {}


def _gpkg_layers(path: Path, folder: Path, source_sha256: str, answers: dict) -> list[dict]:
    connection = sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        connection.execute("PRAGMA query_only=ON")
        connection.execute("PRAGMA trusted_schema=OFF")
        names = [row[0] for row in connection.execute(
            "SELECT table_name FROM gpkg_contents WHERE data_type='features' ORDER BY table_name LIMIT ?",
            (MAX_LAYERS + 1,))]
        if not 1 <= len(names) <= MAX_LAYERS:
            raise InputError(f"A GeoPackage must hold 1 to {MAX_LAYERS} feature layers to be converted.")
        return [_gpkg_layer(connection, name, ordinal, folder, source_sha256, answers)
                for ordinal, name in enumerate(names)]
    except sqlite3.Error:
        raise InputError("The GeoPackage schema could not be read.") from None
    finally:
        connection.close()


def _gpkg_layer(connection, layer: str, ordinal: int, folder: Path, source_sha256: str, answers: dict) -> dict:
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
    if crs is None and words != _STATES_NONE:
        return {**stopped, "state": "crs_unstated", "statesCrs": True, "reason": words}
    officer = crs is None
    crs = _officer_crs(stopped, words, answers) if officer else crs
    if isinstance(crs, dict):
        return crs
    columns = connection.execute(f"PRAGMA table_info({_quote(layer)})").fetchall()
    try:
        position, kind = _gpkg_position(connection, layer, columns)
    except InputError:
        return {**stopped, "reason": "has no rowid or single integer primary key to cite each row by"}
    fields = [entry[1] for entry in columns if entry[1] != column]
    header = {"version": "native-gis-locators/1", "conversion": CONVERSION, "readerVersion": WINDOW_READER,
              "originalSha256": source_sha256, "format": "gpkg", "layer": layer, "positionKind": kind,
              "positionField": position, **_crs_fields(crs, officer)}
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
    return {**stopped, "state": "converted", "crs": crs, "crsSource": "officer_stated" if officer else "stated",
            **derivative.close()}


def _unsafe_member(entry: zipfile.ZipInfo) -> bool:
    member = PurePosixPath(entry.filename)
    return member.is_absolute() or ".." in member.parts or "\\" in entry.filename \
        or stat.S_ISLNK(entry.external_attr >> 16) or bool(entry.flag_bits & 1)


def _shapefile_layers(path: Path, folder: Path, source_sha256: str, answers: dict) -> list[dict]:
    import shapefile
    try:
        with zipfile.ZipFile(path) as archive:
            names = {}
            for entry in archive.infolist():
                if _unsafe_member(entry):
                    raise InputError("The shapefile ZIP holds an unsafe path, a link or an encrypted member.")
                if not entry.is_dir():
                    names[entry.filename.lower()] = entry
            layers = sorted(name[:-4] for name in names if name.endswith(".shp"))
            if not 1 <= len(layers) <= MAX_LAYERS:
                raise InputError(f"A shapefile ZIP must hold 1 to {MAX_LAYERS} .shp sets to be converted.")
            return [_shapefile_layer(archive, names, layer, ordinal, folder, source_sha256, shapefile, answers)
                    for ordinal, layer in enumerate(layers)]
    except zipfile.BadZipFile:
        raise InputError("The shapefile ZIP could not be opened.") from None


def _shapefile_layer(archive, names: dict, layer: str, ordinal: int, folder: Path, source_sha256: str,
                     shapefile, answers: dict) -> dict:
    stopped = {"layer": names[layer + ".shp"].filename[:-4], "ordinal": ordinal, "state": "not_converted"}
    if any(layer + suffix not in names for suffix in (".shx", ".dbf")):
        return {**stopped, "reason": "lacks its .shx or .dbf companion"}

    def read(suffix: str) -> bytes | None:
        return archive.read(names[layer + suffix]) if layer + suffix in names else None

    def place() -> Path:
        scratch = folder / f"shapefile-{ordinal}"
        scratch.mkdir()
        for suffix in (".shp", ".shx", ".dbf"):
            with archive.open(names[layer + suffix]) as source, (scratch / f"layer{suffix}").open("xb") as target:
                while block := source.read(1024 * 1024):
                    target.write(block)
        return scratch / "layer"
    origin = {"originalSha256": source_sha256, "format": "shapefile_zip", "layer": stopped["layer"],
              "member": names[layer + ".dbf"].filename}
    return _shapefile_parts(stopped, read, place, folder, origin, shapefile, answers)


def _shapefile_set_layer(base: Path, layer: str, source_sha256: str, parts: dict, answers: dict) -> dict:
    """N05. Loose parts already copied side by side under one base name are read as the ZIP's one set is."""
    import shapefile

    def read(suffix: str) -> bytes | None:
        path = base.with_suffix(suffix)
        return path.read_bytes() if path.exists() else None
    origin = {"originalSha256": source_sha256, "format": SET_FORMAT, "layer": layer, "member": f"{layer}.dbf",
              "parts": [{"extension": extension, "sha256": parts[extension]["sha256"]} for extension in sorted(parts)]}
    return _shapefile_parts({"layer": layer, "ordinal": 0, "state": "not_converted"}, read, lambda: base,
                            base.parent, origin, shapefile, answers)


def _shapefile_parts(stopped: dict, read, place, folder: Path, origin: dict, shapefile, answers: dict) -> dict:
    """One shapefile, from a ZIP's members or from loose parts: `read` gives a .prj or .cpg's bytes (None when
    absent) and `place` the base path its .shp, .shx and .dbf sit under on scratch disk."""
    prj = read(".prj")
    officer = prj is None
    if officer:
        crs = _officer_crs(stopped, f"{_STATES_NONE} (no .prj)", answers)
        if isinstance(crs, dict):
            return crs
    else:
        try:
            crs = f"EPSG:{_epsg(prj.decode('utf-8-sig'))}"
        except (InputError, UnicodeError):
            return {**stopped, "state": "crs_unstated", "statesCrs": True,
                    "reason": "states a coordinate reference system that does not resolve to one EPSG code"}
    cpg = read(".cpg")
    encoding = cpg.decode("ascii").strip() if cpg is not None else "utf-8"
    encoding = {"65001": "utf-8", "1252": "cp1252"}.get(encoding, encoding)
    base = place()
    header = {"version": "native-gis-locators/1", "conversion": CONVERSION, "readerVersion": WINDOW_READER,
              **origin, "positionKind": "sequence", "encoding": encoding, **_crs_fields(crs, officer)}
    try:
        reader = shapefile.Reader(str(base), encoding=encoding)
    except (shapefile.ShapefileException, LookupError, OSError):
        return {**stopped, "reason": "could not be opened with its companions and encoding"}
    with reader:
        if reader.shapeType not in (0, 1, 3, 5, 8, 11, 13, 15):
            shape_name = shapefile.SHAPETYPE_LOOKUP.get(reader.shapeType, "unknown")
            return {**stopped, "reason": f"stores unsupported shape type {reader.shapeType} ({shape_name})"}
        if reader.numShapes != reader.numRecords:
            return {**stopped, "reason": "its shapes and records differ in number"}
        fields = [item[0] for item in reader.fields[1:]]
        derivative = _Derivative(folder, stopped["ordinal"], header, crs)
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
    return {**stopped, "state": "converted", "crs": crs, "crsSource": "officer_stated" if officer else "stated",
            **derivative.close()}


def _shapefile_z_geometry(shape) -> dict:
    """Keep Z in the GeoJSON positions; the GeoJSON reader supplies sourceHeights, never a measurement."""
    import shapefile

    heights = getattr(shape, "z", [])
    if len(heights) != len(shape.points) or not all(math.isfinite(value) for value in heights):
        raise InputError("stores a Z shape without one finite Z value per position")
    if any(value is not None for value in getattr(shape, "m", [])):
        raise InputError("stores measure (M) values on a Z shape; they will not be dropped")
    points = [[point[0], point[1], height] for point, height in zip(shape.points, heights)]
    if shape.shapeType == 11:
        return {"type": "Point", "coordinates": points[0] if points else []}
    ends = list(shape.parts[1:]) + [len(points)]
    parts = [points[start:end] for start, end in zip(shape.parts, ends)]
    if shape.shapeType == 13:
        if len(parts) == 1:
            return {"type": "LineString", "coordinates": parts[0]}
        return {"type": "MultiLineString", "coordinates": parts}
    # Group rings using x,y only: pyshp's containment helpers expect pairs, not triples.
    rings = [shape.points[start:end] for start, end in zip(shape.parts, ends)]
    with_z = {id(ring): part for ring, part in zip(rings, parts)}
    polygons = [[with_z[id(ring)] for ring in polygon] for polygon in shapefile.organize_polygon_rings(rings)]
    if len(polygons) == 1:
        return {"type": "Polygon", "coordinates": polygons[0]}
    return {"type": "MultiPolygon", "coordinates": polygons}


def _shapefile_geometry(shape, layer_type: int) -> dict | None:
    if shape.shapeType == 0:
        return None
    if shape.shapeType != layer_type:
        raise InputError("stores mixed shape types; no dimensions will be dropped")
    if shape.shapeType in (11, 13, 15):
        return _shapefile_z_geometry(shape)
    return json.loads(_json(shape.__geo_interface__))


def _shapefile_record(reader, position: int, fields: list, derivative: _Derivative):
    record = reader.record(position)
    if record is None:
        derivative.refuse(position, "record_deleted")
        return
    shape = reader.shape(position)
    values = record.as_dict()
    properties = {name: values[name].isoformat() if hasattr(values[name], "isoformat") else values[name]
                  for name in fields}
    geometry = _shapefile_geometry(shape, reader.shapeType)
    reason = _value_refusal(properties)
    if reason:
        derivative.refuse(position, reason)
    else:
        derivative.feature(position, properties, geometry)


# KML1. A KML, or a KMZ's document member, is read as a stream of XML events. Each Document or Folder holding
# Placemarks becomes one GeoJSON derivative (the whole file when the file has none); only the open Placemark is held.
# Names and ExtendedData are written as written; a coordinate's third value is kept as written, never measured.
KML_READER = "native-kml-stream/1"
KML_FORMATS = ("kml", "kmz")
KML_CRS = "EPSG:4326"
KML_CRS_BASIS = "the KML 2.2 specification states longitude and latitude on WGS 84 (EPSG:4326)"
WHOLE_FILE = "whole file"
_KML_NOT_READ = ("NetworkLink", "GroundOverlay", "PhotoOverlay", "ScreenOverlay")
_KML_GEOMETRIES = ("Point", "LineString", "LinearRing", "Polygon", "MultiGeometry")
_KML_BOUNDARIES = ("outerBoundaryIs", "innerBoundaryIs")
_KML_RATIO = 100
# The large GeoJSON path's record bound (STREAMING_VECTOR_LIMITS.featureBytes, projected_vector.FEATURE_BYTES), held
# here as the characters captured for one open Placemark (or one container name) across all its captures.
PLACEMARK_BOUND = 1024 * 1024
TOO_LARGE = "placemark_too_large"
# KML2. Expat holds a start tag (or any other open token) whole until it closes: bytes fed past the last event are
# bounded, and the file is fed in chunks of at most _KML_CHUNK so the bound is checked often.
TAG_BOUND = 1024 * 1024
TAG_TOO_LARGE = "tag_too_large"
_KML_CHUNK = 64 * 1024
_NOT_KML = "is not a KML 2.2 document: its root is not kml in the KML namespace"
_TAG_WORDS = ("A KML tag is larger than 1 MiB before it closes; the file was not read further. "
              "The original is kept with its SHA-256.")


class _KmlStop(Exception):
    """Nothing further is read: the root is not a KML document, or (KML2) a tag is past TAG_BOUND."""

    def __init__(self, code: str = "not_kml", reason: str = _NOT_KML):
        super().__init__(code)
        self.code, self.reason = code, reason


class _Placemark:
    def __init__(self, position: int, depth: int):
        self.position, self.depth = position, depth
        self.properties, self.modes, self.geometries, self.frames = [], [], [], []
        self.dimensions, self.data, self.reason = set(), None, None
        self.held = 0

    def refuse(self, reason: str):
        self.reason = self.reason or reason

    def drop(self):
        """Past the bound: what the Placemark holds is let go and only its refusal remains."""
        self.properties, self.modes, self.geometries, self.frames = [], [], [], []
        self.dimensions, self.data, self.reason = set(), None, TOO_LARGE


def _kml_tuples(text: str) -> tuple[list | None, str | None]:
    from .native_kml import NUMBER
    tuples = []
    for token in text.split():
        parts = token.split(",")
        if len(parts) not in (2, 3) or not all(NUMBER.fullmatch(part) for part in parts):
            return None, "coordinates_syntax"
        values = [float(part) for part in parts]
        if not all(math.isfinite(value) for value in values):
            return None, "coordinates_syntax"
        if not (-180 <= values[0] <= 180 and -90 <= values[1] <= 90):
            return None, "coordinates_range"
        tuples.append(values)
    return tuples, None


def _kml_geometry(frame: dict) -> tuple[dict | None, str | None]:
    """One closed KML geometry as GeoJSON; a LinearRing standing alone is the closed line it draws."""
    kind = frame["kind"]
    if kind == "MultiGeometry":
        parts = frame["parts"]
        if not parts:
            return None, "geometry_empty"
        kinds = {part["type"] for part in parts}
        if len(kinds) == 1 and parts[0]["type"] in ("Point", "LineString", "Polygon"):
            return {"type": "Multi" + parts[0]["type"], "coordinates": [part["coordinates"] for part in parts]}, None
        return {"type": "GeometryCollection", "geometries": parts}, None
    if kind == "Polygon":
        outer = [ring for role, ring in frame["rings"] if role == "outerBoundaryIs"]
        if len(outer) != 1:
            return None, "polygon_outer_boundary"
        return {"type": "Polygon", "coordinates": outer + [
            ring for role, ring in frame["rings"] if role == "innerBoundaryIs"]}, None
    if not frame["coordinates"]:
        return None, "coordinates_absent"
    if kind == "Point":
        if len(frame["coordinates"]) != 1:
            return None, "coordinates_count"
        return {"type": "Point", "coordinates": frame["coordinates"][0]}, None
    return {"type": "LineString", "coordinates": frame["coordinates"]}, None


class _KmlReader:
    """Expat handlers: open elements, open containers, and the one open Placemark with its geometry frames."""

    def __init__(self, folder: Path, header: dict):
        from .native_kml import GX, KML_NAMESPACES
        self.gx, self.namespaces = GX, KML_NAMESPACES
        self.folder, self.header, self.namespace = folder, header, None
        self.stack, self.containers, self.layers, self.used = [], [], [], set()
        self.whole, self.placemark, self.capture, self.placemarks = None, None, None, 0
        self.numbers = dict.fromkeys(("Document", "Folder"), 0)
        self.not_read = {}

    def start(self, name: str, attributes: dict):
        namespace, _, local = name.rpartition("|")
        depth = len(self.stack)
        if not depth:
            if namespace not in self.namespaces or local != "kml":
                raise _KmlStop()
            self.namespace = namespace
        native = namespace == self.namespace
        holds = native and depth and self.stack[-1][2] and local in ("Document", "Folder")
        self.stack.append((namespace, local, not depth or holds))
        if native and local in _KML_NOT_READ:
            self.not_read[local] = self.not_read.get(local, 0) + 1
        if holds:
            self.numbers[local] += 1
            self.containers.append({"kind": local, "number": self.numbers[local], "depth": depth,
                                    "name": None, "layer": None})
        elif native and local == "Placemark" and self.stack[-2][2] and self.placemark is None:
            self.placemark = _Placemark(self.placemarks, depth)
            self.placemarks += 1
        elif self.placemark is not None:
            self._within(namespace, local, attributes, depth)
        elif native and local == "name" and self.containers and depth == self.containers[-1]["depth"] + 1:
            self.capture = {"depth": depth, "target": "container", "parts": [], "held": 0}

    def _within(self, namespace: str, local: str, attributes: dict, depth: int):
        mark, parent = self.placemark, self.stack[-2][1]
        if mark.reason == TOO_LARGE:
            return
        frame = mark.frames[-1] if mark.frames and mark.frames[-1]["depth"] == depth - 1 else None
        native = namespace == self.namespace
        if native and local == "name" and depth == mark.depth + 1:
            self._capture(depth, "name")
        elif native and local == "Data" and parent == "ExtendedData":
            mark.data = [attributes.get("name"), None]
        elif native and local == "value" and parent == "Data" and mark.data is not None:
            self._capture(depth, "value")
        elif native and local == "SimpleData" and parent == "SchemaData":
            self._capture(depth, "simple", attributes.get("name"))
        elif native and local in _KML_GEOMETRIES:
            self._frame(local, parent, frame, depth)
        elif native and local == "coordinates" and frame and frame["kind"] not in ("Polygon", "MultiGeometry"):
            self._capture(depth, "coordinates")
        elif local == "altitudeMode" and (native or namespace == self.gx) and frame:
            self._capture(depth, "mode")
        elif (native and local == "Model" or namespace == self.gx and local in ("Track", "MultiTrack")) \
                and (depth == mark.depth + 1 or parent == "MultiGeometry"):
            mark.refuse(f"geometry_not_read:{local}")

    def _capture(self, depth: int, target: str, key=None):
        self.capture = {"depth": depth, "target": target, "key": key, "parts": [], "held": 0}

    def _frame(self, kind: str, parent: str, frame: dict | None, depth: int):
        mark = self.placemark
        enclosing = mark.frames[-1] if mark.frames and mark.frames[-1]["depth"] == depth - 2 else None
        role = parent if parent in _KML_BOUNDARIES and kind == "LinearRing" and enclosing \
            and enclosing["kind"] == "Polygon" else None
        if role or depth == mark.depth + 1 or frame and frame["kind"] == "MultiGeometry":
            mark.frames.append({"kind": kind, "depth": depth, "role": role, "coordinates": None,
                                "rings": [], "parts": []})

    def characters(self, text: str):
        capture = self.capture
        if capture is None or capture["parts"] is None:
            return
        capture["held"] += len(text)
        mark = None if capture["target"] == "container" else self.placemark
        if mark is not None:
            mark.held += len(text)
        if (mark.held if mark is not None else capture["held"]) <= PLACEMARK_BOUND:
            capture["parts"].append(text)
        elif mark is not None:
            mark.drop()
            self.capture = None
        else:
            # A container name past the bound is left unread; the layer takes its ordinal name.
            capture["parts"] = None

    def end(self, name: str):
        self.stack.pop()
        depth = len(self.stack)
        if self.capture is not None and self.capture["depth"] == depth:
            self._captured(self.capture)
            self.capture = None
        mark = self.placemark
        if mark is None:
            if self.containers and self.containers[-1]["depth"] == depth:
                self.containers.pop()
        elif depth == mark.depth:
            self._write(mark)
            self.placemark = None
        elif mark.frames and mark.frames[-1]["depth"] == depth:
            self._closed(mark, mark.frames.pop())
        elif mark.data is not None and name.endswith("|Data") and self.stack[-1][1] == "ExtendedData":
            mark.properties.append(tuple(mark.data))
            mark.data = None

    def _captured(self, capture: dict):
        text, target, mark = "".join(capture["parts"] or ()), capture["target"], self.placemark
        if target == "container":
            self.containers[-1]["name"] = text if capture["parts"] is not None else None
        elif target == "name":
            mark.properties.append(("name", text))
        elif target == "value":
            mark.data[1] = text
        elif target == "simple":
            mark.properties.append((capture["key"], text))
        elif target == "mode":
            mark.modes.append(text.strip())
        else:
            frame = mark.frames[-1]
            tuples, reason = _kml_tuples(text)
            if frame["coordinates"] is not None:
                reason = reason or "coordinates_repeated"
            if reason:
                mark.refuse(reason)
                return
            frame["coordinates"] = tuples
            mark.dimensions.update(len(values) for values in tuples)

    def _closed(self, mark: _Placemark, frame: dict):
        if frame["role"]:
            if not frame["coordinates"]:
                mark.refuse("coordinates_absent")
            else:
                mark.frames[-1]["rings"].append((frame["role"], frame["coordinates"]))
            return
        geometry, reason = _kml_geometry(frame)
        if reason:
            mark.refuse(reason)
        elif mark.frames:
            mark.frames[-1]["parts"].append(geometry)
        else:
            mark.geometries.append(geometry)

    def _write(self, mark: _Placemark):
        layer = self._layer()
        properties = {}
        for key, value in mark.properties:
            if not isinstance(key, str) or not key:
                mark.refuse("attribute_unnamed")
            elif key in properties:
                mark.refuse(f"attribute_repeated:{key}")
            properties[key] = value
        if mark.modes:
            # As written beside the outline; a reference level is never assumed from it.
            modes = list(dict.fromkeys(mark.modes))
            if "altitudeMode" in properties:
                mark.refuse("attribute_repeated:altitudeMode")
            properties["altitudeMode"] = modes[0] if len(modes) == 1 else modes
        if len(mark.dimensions) > 1:
            mark.refuse("coordinates_mixed_height")
        if len(mark.geometries) > 1:
            mark.refuse("geometry_repeated")
        if mark.reason:
            layer["derivative"].refuse(mark.position, mark.reason)
            return
        layer["derivative"].feature(mark.position, properties, mark.geometries[0] if mark.geometries else None)
        layer["geometries"] += bool(mark.geometries)

    def _layer(self) -> dict:
        container = self.containers[-1] if self.containers else None
        if container is None and self.whole is None:
            self.whole = self._open(WHOLE_FILE)
        elif container is not None and container["layer"] is None:
            stated = (container["name"] or "").strip()
            container["layer"] = self._open(stated if 1 <= len(stated) <= 240
                                            else f"{container['kind']} {container['number']}")
        return self.whole if container is None else container["layer"]

    def _open(self, base: str) -> dict:
        if len(self.layers) >= MAX_LAYERS:
            raise InputError(f"A KML must hold Placemarks in at most {MAX_LAYERS} Documents or Folders "
                             "to be converted.")
        name, repeat = base, 1
        while name in self.used:
            repeat += 1
            name = f"{base} ({repeat})"
        self.used.add(name)
        ordinal = len(self.layers)
        derivative = _Derivative(self.folder, ordinal, {**self.header, "layer": name}, KML_CRS)
        self.layers.append({"layer": name, "ordinal": ordinal, "derivative": derivative, "geometries": 0})
        return self.layers[-1]

    def abandon(self):
        for layer in self.layers:
            layer["derivative"].abandon()

    def finish(self) -> list[dict]:
        results = []
        for layer in self.layers:
            stopped = {"layer": layer["layer"], "ordinal": layer["ordinal"], "state": "not_converted"}
            if not layer["geometries"]:
                layer["derivative"].abandon()
                results.append({**stopped, "reason": "holds no Placemark whose geometry could be written"})
                continue
            results.append({**stopped, "state": "converted", "crs": KML_CRS, "crsSource": "stated",
                            "crsBasis": KML_CRS_BASIS, **layer["derivative"].close()})
        return results or [{"layer": WHOLE_FILE, "ordinal": 0, "state": "not_converted",
                            "reason": "holds no Placemark"}]


def _kml_parse(blocks, reader: _KmlReader):
    from xml.parsers import expat

    def deny(*_):
        raise InputError("A KML with a document type, entity declarations or external references is not read.")

    parser = expat.ParserCreate(namespace_separator="|")
    parser.buffer_text = True
    parser.SetParamEntityParsing(expat.XML_PARAM_ENTITY_PARSING_NEVER)
    parser.StartDoctypeDeclHandler = parser.EntityDeclHandler = parser.ExternalEntityRefHandler = deny
    seen = fed = 0

    def marked(handler):
        def event(*arguments):
            nonlocal seen
            seen = parser.CurrentByteIndex
            handler(*arguments)
        return event

    parser.StartElementHandler, parser.EndElementHandler = marked(reader.start), marked(reader.end)
    parser.CharacterDataHandler = marked(reader.characters)
    try:
        for block in blocks:
            parser.Parse(block, False)
            fed += len(block)
            if fed - seen > TAG_BOUND:
                raise _KmlStop(TAG_TOO_LARGE, _TAG_WORDS)
        parser.Parse(b"", True)
    except expat.ExpatError:
        raise InputError("The KML is not well-formed XML.") from None


def _file_blocks(path: Path):
    with path.open("rb") as source:
        while block := source.read(_KML_CHUNK):
            yield block


def _kmz_document(archive: zipfile.ZipFile) -> tuple[zipfile.ZipInfo | None, str | None]:
    """The KMZ's root doc.kml, else its only .kml member, or the words saying why none is the document."""
    entries = archive.infolist()
    if any(_unsafe_member(entry) for entry in entries):
        raise InputError("The KMZ holds an unsafe path, a link or an encrypted member.")
    documents = [entry for entry in entries if not entry.is_dir() and entry.filename.lower().endswith(".kml")]
    chosen = [entry for entry in documents if entry.filename.lower() == "doc.kml"] or documents
    if len(chosen) == 1:
        return chosen[0], None
    if not documents:
        return None, "holds no .kml member"
    return None, f"holds {len(documents)} .kml members and none is doc.kml at its root"


def _kmz_blocks(archive: zipfile.ZipFile, entry: zipfile.ZipInfo):
    """The member read as a stream, never past its stated size, the SH2 source bound or a 1:100 expansion."""
    limit = min(entry.file_size, MAX_SOURCE_BYTES, max(1, entry.compress_size) * _KML_RATIO)
    if entry.file_size > limit:
        raise InputError("The KMZ's KML member expands beyond the conversion's bound.")
    count = 0
    with archive.open(entry) as stream:
        while block := stream.read(_KML_CHUNK):
            count += len(block)
            if count > limit:
                raise InputError("The KMZ's KML member expands beyond its stated size.")
            yield block


def convert_kml_file(path: Path, fmt: str, folder: Path, source_sha256: str) -> tuple[list[dict], dict]:
    """KML1. Every layer of one KML or KMZ on scratch disk, converted or stopped with words, and the count of each
    kind of element kept in the original but not fetched or read."""
    header = {"version": "native-gis-locators/1", "conversion": CONVERSION, "readerVersion": KML_READER,
              "originalSha256": source_sha256, "format": fmt, "positionKind": "placemark_sequence",
              "crs": KML_CRS, "crsBasis": KML_CRS_BASIS}
    archive = None
    try:
        if fmt == "kmz":
            archive = zipfile.ZipFile(path)
            entry, words = _kmz_document(archive)
            if entry is None:
                return [{"layer": WHOLE_FILE, "ordinal": 0, "state": "not_converted", "reason": words}], {}
            header["member"] = entry.filename
        reader = _KmlReader(folder, header)
        try:
            _kml_parse(_kmz_blocks(archive, entry) if archive is not None else _file_blocks(path), reader)
            return reader.finish(), reader.not_read
        except _KmlStop as stop:
            reader.abandon()
            return [{"layer": WHOLE_FILE, "ordinal": 0, "state": "not_converted", "reason": stop.reason}], {}
        except BaseException:
            reader.abandon()
            raise
    except (zipfile.BadZipFile, zlib.error, NotImplementedError, EOFError):
        raise InputError("The KMZ could not be read.") from None
    finally:
        if archive is not None:
            archive.close()


def _horizontal_epsg(code: int) -> str | None:
    """B3D1. The two-dimensional horizontal EPSG system of a code a file states: the code itself, or the horizontal
    part the EPSG registry defines for a compound code. None for anything else; nothing is guessed."""
    try:
        reference = CRS.from_epsg(code)
    except CRSError:
        return None
    if reference.is_compound:
        reference = reference.sub_crs_list[0]
    authority = reference.to_authority()
    planar = len(reference.axis_info) == 2 and (reference.is_projected or reference.is_geographic)
    if authority is None or authority[0] != "EPSG" or not planar:
        return None
    return f"EPSG:{authority[1]}"


def _geoparquet_crs(meta: dict, version: str, stopped: dict, answers: dict) -> dict:
    if "crs" not in meta and version in ("1.0.0", "1.1.0"):
        return {"crs": "EPSG:4326", "crsSource": "stated", "crsBasis":
                f"the GeoParquet {version} specification states longitude and latitude on OGC CRS84 "
                "when a column has no crs"}
    if meta.get("crs") is None:
        answer = _officer_crs(stopped, _STATES_NONE, answers)
        return answer if isinstance(answer, dict) else {"crs": answer, "crsSource": "officer_stated"}
    try:
        reference = CRS.from_json_dict(meta["crs"])
        code = reference.to_epsg()
        # CRS84 names the same horizontal system with longitude first, not EPSG's latitude-first axes.
        if code is None and reference.equals(CRS.from_user_input("OGC:CRS84")):
            code = 4326
        crs = _horizontal_epsg(code) if code is not None else None
    except (CRSError, ValueError, TypeError):
        crs = None
    if crs is None:
        return {**stopped, "state": "crs_unstated", "statesCrs": True,
                "reason": "states a coordinate reference system that does not resolve to a horizontal EPSG code"}
    return {"crs": crs, "crsSource": "stated"}


def _geoparquet_value(value: object, field: str) -> object:
    import datetime
    import decimal
    if isinstance(value, (datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, dict):
        return {name: _geoparquet_value(item, f"{field}.{name}") for name, item in value.items()}
    if isinstance(value, list):
        return [_geoparquet_value(item, field) for item in value]
    reason = _value_refusal({field: value})
    if reason:
        raise InputError(reason)
    return value


def _geoparquet_row(row: dict, primary: str, columns: dict) -> tuple[dict, dict | None, str | None]:
    from shapely.errors import GEOSException
    from shapely.geometry import mapping
    from .native_geoparquet import DEFAULT_LIMITS, GeoParquetError, wkb_guard
    properties = {name: value for name, value in row.items() if name not in columns}
    binary = row[primary]
    if binary is None:
        return properties, None, "geometry is null"
    if not isinstance(binary, bytes):
        return properties, None, "geometry is not WKB bytes"
    try:
        wkb_guard(binary, DEFAULT_LIMITS)
        geometry = from_wkb(binary)
        if geometry.is_empty:
            return properties, None, "geometry is empty"
        properties = {name: _geoparquet_value(value, name) for name, value in properties.items()}
        _json(properties)
        return properties, mapping(geometry), _value_refusal(properties)
    except (GeoParquetError, InputError) as error:
        return {}, None, str(error)
    except GEOSException:
        return {}, None, "geometry could not be decoded"
    except (ValueError, TypeError):
        return {}, None, "attributes cannot be written exactly as JSON"


def _geoparquet_layer(parquet, folder: Path, source_sha256: str, answers: dict) -> dict:
    from .native_geoparquet import DEFAULT_LIMITS, GeoParquetError, json_metadata, profile
    raw = (parquet.metadata.metadata or {}).get(b"geo")
    if raw is None:
        raise InputError("This Parquet file has no geo metadata; it is kept as a table.")
    try:
        if len(raw) > DEFAULT_LIMITS.footer_bytes:
            raise InputError("The GeoParquet geo metadata exceeds the reader's metadata limit.")
        geo = json_metadata(raw.decode("utf-8"), DEFAULT_LIMITS)
    except (GeoParquetError, UnicodeError) as error:
        raise InputError(f"The GeoParquet geo metadata could not be read: {error}") from None
    checked = profile(geo, parquet.schema_arrow.names)
    primary = geo.get("primary_column") if isinstance(geo, dict) else None
    stopped = {"layer": primary if isinstance(primary, str) and 1 <= len(primary) <= 256 else "geometry",
               "ordinal": 0, "state": "not_converted"}
    if isinstance(primary, str) and not 1 <= len(primary) <= 256:
        return {**stopped, "reason": "the primary geometry column name must have 1 to 256 characters"}
    version = geo.get("version") if isinstance(geo, dict) else None
    if checked["reasons"] == ["version_unsupported"]:
        # The converter accepts 1.0.0 WKB too; other versions need the officer when no system is stated.
        meta = checked["columns"][primary]
        if version != "1.0.0" and meta["crs"]["state"] == "declared":
            return {**stopped, "reason": f"GeoParquet version {version} is not supported "
                    "when a coordinate reference system is stated"}
    elif checked["status"] != "supported":
        words = "; ".join(item.replace("_", " ") for item in checked["reasons"])
        return {**stopped, "reason": f"GeoParquet profile not supported: {words}"[:300]}
    crs = _geoparquet_crs(geo["columns"][primary], version, stopped, answers)
    if "state" in crs:
        return crs
    return _geoparquet_write(parquet, geo, crs, stopped, folder, source_sha256)


def _geoparquet_write(parquet, geo: dict, crs: dict, stopped: dict, folder: Path, source_sha256: str) -> dict:
    primary = geo["primary_column"]
    others = [name for name in geo["columns"] if name != primary]
    header = {"version": "native-gis-locators/1", "conversion": CONVERSION, "readerVersion": WINDOW_READER,
              "originalSha256": source_sha256, "format": "geoparquet", "layer": primary,
              "positionKind": "row", **crs}
    if others:
        header["words"] = "Other geometry columns kept in the original, not in properties: " + ", ".join(others)
    derivative = _Derivative(folder, 0, header, crs["crs"])
    try:
        position = 0
        for batch in parquet.iter_batches(batch_size=WINDOW, use_threads=False):
            for row in batch.to_pylist():
                properties, geometry, reason = _geoparquet_row(row, primary, geo["columns"])
                if reason:
                    derivative.refuse(position, reason)
                else:
                    derivative.feature(position, properties, geometry)
                position += 1
    except InputError as error:
        derivative.abandon()
        return {**stopped, "reason": str(error)}
    except BaseException:
        derivative.abandon()
        raise
    return {**stopped, "state": "converted", **crs, **derivative.close()}


def convert_native_file(path: Path, fmt: str, folder: Path, source_sha256: str,
                        answers: dict | None = None) -> list[dict]:
    """Every layer of one original on scratch disk, each converted or stopped with words naming why. `answers` maps
    a layer whose file states no CRS to the EPSG code an officer stated for it (CR1). B3D1: a CityJSON gives one
    layer of building ground outlines. CG1: CityGML uses the same path and its literal reader's envelope system."""
    if fmt in ("cityjson", "citygml"):
        convert = convert_citygml_file if fmt == "citygml" else convert_cityjson_file
        return convert(path, source_sha256, lambda header, crs: _Derivative(
            folder, 0, {"version": "native-gis-locators/1", "conversion": CONVERSION, **header}, crs),
            _horizontal_epsg)
    if fmt == "geoparquet":
        try:
            from pyarrow.parquet import ParquetFile
        except ImportError:
            raise InputError("This processor has no GeoParquet reader installed yet.") from None
        with ParquetFile(path) as parquet:
            return [_geoparquet_layer(parquet, folder, source_sha256, answers or {})]
    if fmt == "gpkg":
        with path.open("rb") as head:
            if head.read(16) != b"SQLite format 3\x00":
                raise InputError("A GeoPackage must be a SQLite GeoPackage file.")
        return _gpkg_layers(path, folder, source_sha256, answers or {})
    if fmt == "shapefile_zip":
        return _shapefile_layers(path, folder, source_sha256, answers or {})
    raise InputError("Only a GeoPackage or a shapefile ZIP is converted.")


def _answers(value) -> dict:
    """CR1. The officer's answers: layer name to EPSG code, each in the exact form the intake route stores."""
    if not isinstance(value, dict) or len(value) > MAX_LAYERS or not all(
            isinstance(layer, str) and 1 <= len(layer) <= 256 and isinstance(code, str)
            and _OFFICER_CODE.fullmatch(code) for layer, code in value.items()):
        raise InputError(f"layerCrs maps at most {MAX_LAYERS} layer names to EPSG:<code> answers.")
    return value


def _s3():
    import boto3
    from botocore.config import Config
    from . import settings
    return boto3.client("s3", endpoint_url=settings.S3_ENDPOINT, aws_access_key_id=settings.S3_ACCESS_KEY,
                        aws_secret_access_key=settings.S3_SECRET_KEY, region_name=settings.S3_REGION,
                        config=Config(connect_timeout=5, read_timeout=60, retries={"max_attempts": 2}))


def _pins(source_id, key, digest, size):
    match = _SOURCE_KEY.fullmatch(key) if isinstance(key, str) else None
    if not match or match.group(2) != source_id or match.group(3) != digest:
        raise InputError("The object key must name the retained original's ID and SHA-256.")
    if isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= MAX_SOURCE_BYTES:
        raise InputError(f"Conversion reads originals of 1 to {MAX_SOURCE_BYTES} bytes (1 GiB); the file stays kept.")


def _set_parts(data: dict) -> dict:
    """N05. Each loose part's pins by extension: one .shp, .shx and .dbf, and a .prj and .cpg when present. The .shp
    is the original the request names; the layer is its name without the extension."""
    members, layer = data["members"], data["layer"]
    if not isinstance(members, list) or not isinstance(layer, str) or not 1 <= len(layer) <= 256:
        raise InputError("A shapefile set names its layer and its parts.")
    parts = {}
    for member in members:
        if not isinstance(member, dict) or set(member) != {"extension", *_PIN_FIELDS} \
                or member["extension"] not in SET_PARTS or member["extension"] in parts:
            raise InputError("A shapefile set holds one .shp, .shx and .dbf, and at most one .prj and .cpg.")
        _pins(*(member[name] for name in _PIN_FIELDS))
        parts[member["extension"]] = member
    if not {"shp", "shx", "dbf"} <= set(parts) or any(parts["shp"][name] != data[name] for name in _PIN_FIELDS):
        raise InputError("A shapefile set needs its .shp, .shx and .dbf, and its .shp is the original it names.")
    if sum(member["bytes"] for member in parts.values()) > MAX_SOURCE_BYTES:
        raise InputError(f"Conversion reads a shapefile set of at most {MAX_SOURCE_BYTES} bytes (1 GiB); "
                         "its parts stay kept.")
    return parts


def _fetch(client, key: str, size: int, digest: str, target: Path):
    """Copies one retained original from object storage to scratch disk, byte for byte, checking size and SHA-256."""
    from . import settings
    body = client.get_object(Bucket=settings.S3_BUCKET, Key=key)["Body"]
    hashed, count = hashlib.sha256(), 0
    try:
        with target.open("xb") as output:
            for block in body.iter_chunks(chunk_size=1024 * 1024):
                count += len(block)
                if count > size:
                    raise InputError("The retained original is longer than its receipt.")
                hashed.update(block)
                output.write(block)
    finally:
        body.close()
    if count != size or hashed.hexdigest() != digest:
        raise InputError("The retained original's size or SHA-256 differs from its receipt.")


def convert_native(data: dict, s3=None) -> dict:
    """SH2. Copies a retained original from object storage to scratch disk (size and SHA-256 checked), converts
    each layer and stores each derivative and its sidecar under content-addressed keys for the caller to retain.
    KML1: a KML or KMZ is read by its streamed reader and the result counts what it kept but did not read.
    N05: a shapefile set's loose parts are each copied and checked into one scratch folder, then read as one."""
    from . import settings
    loose = isinstance(data, dict) and data.get("format") == SET_FORMAT
    fields = {"format", *_PIN_FIELDS, *(("layer", "members") if loose else ())}
    if not isinstance(data, dict) or set(data) - {"layerCrs"} != fields:
        raise InputError("Conversion requires the retained original's exact pins and its format.")
    answers = _answers(data.get("layerCrs", {}))
    source_id, key, digest, size, fmt = (data[name] for name in (*_PIN_FIELDS, "format"))
    _pins(source_id, key, digest, size)
    parts = _set_parts(data) if loose else None
    client = s3 or _s3()
    with tempfile.TemporaryDirectory(prefix="ulpin-native-convert-") as temporary:
        folder = Path(temporary)
        kml = fmt in KML_FORMATS
        if parts:
            base = folder / "parts" / "layer"
            base.parent.mkdir()
            for extension, part in parts.items():
                _fetch(client, part["objectKey"], part["bytes"], part["sha256"], base.with_suffix(f".{extension}"))
            layers, not_read = [_shapefile_set_layer(base, data["layer"], digest, parts, answers)], {}
        else:
            original = folder / "original"
            _fetch(client, key, size, digest, original)
            layers, not_read = convert_kml_file(original, fmt, folder, digest) if kml \
                else (convert_native_file(original, fmt, folder, digest, answers), {})
        for layer in (layer for layer in layers if layer["state"] == "converted"):
            for name, kind in (("geojson", "application/geo+json"), ("sidecar", "application/x-ndjson")):
                entry = layer[name]
                entry["objectKey"] = f"native-derivatives/{digest}/{layer['ordinal']}/{name}-{entry['sha256']}"
                client.upload_file(entry.pop("path"), settings.S3_BUCKET, entry["objectKey"],
                                   ExtraArgs={"ContentType": kind, "Metadata": {"sha256": entry["sha256"]}})
    reader = {"cityjson": OUTLINE_READER, "citygml": CITYGML_OUTLINE_READER,
              **dict.fromkeys(KML_FORMATS, KML_READER)}.get(fmt, WINDOW_READER)
    return {"conversion": CONVERSION, "readerVersion": reader, "sourceId": source_id,
            "sourceSha256": digest, "layers": layers, **({"notRead": not_read} if not_read else {})}
