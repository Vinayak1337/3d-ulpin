"""Bounded 2D GeoPackage and Shapefile-set adapters; originals remain caller assets."""
from __future__ import annotations

import base64
import binascii
import hashlib
import io
import json
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
            quote = lambda name: '"' + name.replace('"', '""') + '"'
            available = {entry[1] for entry in connection.execute(f"PRAGMA table_info({quote(layer)})")}
            if inspecting:
                selected = sorted(available - {column})
                if len(selected) > 256:
                    raise InputError("GIS inspection supports at most 256 attribute fields.")
            if any(name not in available for name in selected):
                raise InputError("A mapped field is absent from the selected GeoPackage layer.")
            records = connection.execute(f"SELECT {','.join(quote(name) for name in [column] + selected)} FROM {quote(layer)} LIMIT {MAX_FEATURES + 1}").fetchall()
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
                    _, vertices = _geometry(geometry, "GeoPackage feature")
                except InputError:
                    raise
                except Exception:
                    raise InputError("GeoPackage WKB is malformed or unsupported.") from None
                count += vertices
                if count > MAX_VERTICES:
                    raise InputError("GeoPackage layer exceeds 100,000 vertices.")
                features.append({"attributes": dict(zip(selected, record[1:])), "geometry": _arcgis(geometry)})
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
    from .area import _geometry, _arcgis_geometry, MAX_FEATURES, MAX_VERTICES
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
                for item in reader.iterShapeRecords():
                    if item.shape.shapeType == 5:
                        starts = list(item.shape.parts) + [len(item.shape.points)]
                        rings = [[list(point) for point in item.shape.points[starts[i]:starts[i + 1]]] for i in range(len(starts) - 1)]
                        geometry = _arcgis_geometry({"rings": rings})
                    else:
                        geometry = json.loads(json.dumps(item.shape.__geo_interface__))
                    _, vertices = _geometry(geometry, "Shapefile feature")
                    count += vertices
                    if count > MAX_VERTICES:
                        raise InputError("Shapefile exceeds 100,000 total vertices.")
                    attributes = item.record.as_dict()
                    selected_values = {name: attributes[name].isoformat() if hasattr(attributes[name], "isoformat") else attributes[name] for name in selected}
                    features.append({"attributes": selected_values, "geometry": _arcgis(geometry)})
                    originals.append(geometry)
                if len(features) != reader.numRecords:
                    raise InputError("Deleted/missing Shapefile records cannot silently disappear; supply a consistent source export.")
                return {"layers": layers, "layer": layer, "features": features, "geometries": originals, "epsg": epsg} if inspecting else (features, originals, epsg, layer)
    except InputError:
        raise
    except (zipfile.BadZipFile, UnicodeError, LookupError, shapefile.ShapefileException, ValueError, OSError):
        raise InputError("Shapefile archive could not be parsed with its declared companions and encoding.") from None


def normalize_native(data):
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
    for feature, original in zip(result["features"], originals):
        feature["sourceGeometry"] = original
    result["adapter"] = {"format": data["format"], "version": "native-gis-v1", "layer": layer, "sourceSha256": hashlib.sha256(raw).hexdigest(),
                         "sourceUnits": CRS.from_epsg(epsg).axis_info[0].unit_name}
    result["warnings"].append("Native container bytes remain the source asset. Decoded geometry and normalized arrays are derivatives; no files, rows, dimensions or companion parts were silently discarded.")
    return result
