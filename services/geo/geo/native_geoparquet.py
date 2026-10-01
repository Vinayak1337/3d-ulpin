"""Bounded GeoParquet 1.1.0 declarations; call only in the gated CLI worker.

PyArrow reads an in-memory snapshot, never a URI/filesystem/dataset. The compact
Thrift and WKB scans supply byte locators and allocation guards, not replacements
for Arrow/GEOS interpretation. Nothing here establishes placement or identity.
"""
from __future__ import annotations

import base64
from dataclasses import asdict, dataclass
import datetime
import decimal
import hashlib
import json
import math
import struct

PINS = {"pyarrow": "21.0.0", "shapely": "2.0.7", "numpy": "2.2.6"}
PROFILE_VERSION = "1.1.0"


@dataclass(frozen=True)
class Limits:
    input_bytes: int = 32 * 1024**2
    output_bytes: int = 16 * 1024**2
    memory_bytes: int = 2 * 1024**3
    seconds: float = 60
    threads: int = 2
    footer_bytes: int = 1024**2
    columns: int = 128
    row_groups: int = 128
    group_bytes: int = 128 * 1024**2
    group_rows: int = 100_000
    rows: int = 1_000
    coordinates: int = 100_000
    cell_bytes: int = 1024**2
    string_bytes: int = 32 * 1024
    nodes: int = 250_000
    depth: int = 32

    def __post_init__(self):
        if any(type(v) not in (int, float) or not math.isfinite(v) or v <= 0 for v in asdict(self).values()):
            raise ValueError("Limits must be positive and finite.")
        if any(type(v) is not int for k, v in asdict(self).items() if k != "seconds"):
            raise ValueError("Count/byte limits must be integers.")
        if "DEFAULT_LIMITS" in globals() and any(v > asdict(DEFAULT_LIMITS)[k] for k, v in asdict(self).items()):
            raise ValueError("Limits may only be reduced.")


DEFAULT_LIMITS = Limits()


class GeoParquetError(ValueError):
    def __init__(self, code, message, status="malformed", locator=None):
        super().__init__(message)
        self.code, self.status, self.locator = code, status, locator

    def as_dict(self):
        return {"status": self.status, "code": self.code, "message": str(self), "locator": self.locator}


def fail(code, message, status="malformed", locator=None):
    raise GeoParquetError(code, message, status, locator)


class Footer:
    """Skip bounded Compact Thrift; retain every literal key/value byte span.

    FileMetaData field 5 is key_value_metadata. Duplicates are preserved instead
    of being collapsed by Arrow's metadata dictionary. No external resources.
    """
    def __init__(self, raw, limits):
        if len(raw) > limits.input_bytes:
            fail("INPUT_LIMIT", "Original exceeds the byte limit.", "limit")
        if len(raw) < 12 or raw[:4] != b"PAR1" or raw[-4:] != b"PAR1":
            fail("FORMAT", "Only unencrypted Parquet files with PAR1 framing are supported.", "unsupported")
        length = struct.unpack("<I", raw[-8:-4])[0]
        if length > limits.footer_bytes:
            fail("FOOTER_LIMIT", "Footer exceeds the metadata limit.", "limit")
        self.start, self.end = len(raw)-8-length, len(raw)-8
        if self.start < 4 or length == 0:
            fail("FOOTER", "Invalid Parquet footer span.")
        self.raw, self.pos, self.limits, self.nodes = raw, self.start, limits, 0
        self.entries = []
        self.skip_struct(0, top=True)
        if self.pos != self.end:
            fail("FOOTER", "Trailing or incomplete footer data.")

    def take(self, count):
        if count < 0 or self.pos+count > self.end:
            fail("FOOTER", "Footer value exceeds its original byte span.")
        start = self.pos
        self.pos += count
        return self.raw[start:self.pos]

    def varint(self):
        value = 0
        for index in range(10):
            b = self.take(1)[0]
            if index == 9 and b > 1:
                fail("FOOTER", "Oversized footer integer.")
            value |= (b & 127) << (7*index)
            if b < 128:
                return value
        fail("FOOTER", "Unterminated footer integer.")

    def binary(self):
        length_start = self.pos
        size = self.varint()
        if size > self.limits.footer_bytes:
            fail("FOOTER_LIMIT", "Footer string exceeds the metadata limit.", "limit")
        start = self.pos
        value = self.take(size)
        return {"bytes": value, "lengthByteStart": length_start, "byteStart": start, "byteEnd": self.pos}

    def tick(self, depth):
        self.nodes += 1
        if self.nodes > self.limits.nodes or depth > self.limits.depth:
            fail("METADATA_LIMIT", "Footer expansion/nesting exceeds the profile.", "limit")

    def skip_struct(self, depth, top=False, kv=False):
        previous, fields = 0, {}
        while True:
            self.tick(depth)
            header = self.take(1)[0]
            if header == 0:
                return fields
            typ, delta = header & 15, header >> 4
            if delta:
                field = previous+delta
            else:
                encoded = self.varint()
                field = (encoded >> 1) ^ -(encoded & 1)
            if field <= 0 or field in fields:
                fail("FOOTER", "Duplicate or invalid footer field.")
            previous = field
            fields[field] = None
            if top and field == 5:
                if typ != 9:
                    fail("FOOTER", "Key/value metadata is not a list.")
                count, item_type = self.list_header()
                if item_type != 12:
                    fail("FOOTER", "Key/value metadata is not a struct list.")
                for _ in range(count):
                    entry = self.skip_struct(depth+1, kv=True)
                    if 1 not in entry or entry[1] is None:
                        fail("FOOTER", "Metadata entry has no literal key.")
                    self.entries.append(entry)
            elif kv and field in (1, 2):
                if typ != 8:
                    fail("FOOTER", "Metadata key/value is not a binary string.")
                fields[field] = self.binary()
            else:
                self.skip(typ, depth+1, struct_field=True)

    def list_header(self):
        header = self.take(1)[0]
        count = header >> 4
        if count == 15:
            count = self.varint()
        if count > self.limits.nodes:
            fail("METADATA_LIMIT", "Footer container exceeds the profile.", "limit")
        return count, header & 15

    def skip(self, typ, depth, struct_field=False):
        self.tick(depth)
        if typ in (1, 2):
            if not struct_field and self.take(1)[0] not in (1, 2):
                fail("FOOTER", "Invalid footer boolean.")
        elif typ == 3:
            self.take(1)
        elif typ in (4, 5, 6):
            self.varint()
        elif typ == 7:
            self.take(8)
        elif typ == 8:
            self.binary()
        elif typ in (9, 10):
            count, element = self.list_header()
            for _ in range(count):
                self.skip(element, depth+1)
        elif typ == 11:
            count = self.varint()
            if count > self.limits.nodes:
                fail("METADATA_LIMIT", "Footer map exceeds the profile.", "limit")
            if count:
                types = self.take(1)[0]
                for _ in range(count):
                    self.skip(types >> 4, depth+1)
                    self.skip(types & 15, depth+1)
        elif typ == 12:
            self.skip_struct(depth)
        else:
            fail("FOOTER", "Unknown Compact Thrift type.")


def json_metadata(text, limits):
    # Bound nesting before json.loads (which otherwise recurses on hostile JSON).
    depth, quoted, escaped = 0, False, False
    for char in text:
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in "[{":
            depth += 1
            if depth > limits.depth:
                fail("METADATA_LIMIT", "Geo JSON nesting exceeds the profile.", "limit")
        elif char in "]}":
            depth -= 1

    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                fail("GEO_CONFLICT", "Duplicate Geo JSON keys are ambiguous.", "conflicting")
            result[key] = value
        return result

    try:
        parsed = json.loads(text, object_pairs_hook=unique,
                            parse_constant=lambda _: fail("GEO_JSON", "Nonfinite Geo JSON constant."))
    except (ValueError, RecursionError) as exc:
        if isinstance(exc, GeoParquetError):
            raise
        fail("GEO_JSON", "Embedded geo metadata is not valid JSON.")
    # Includes strings/numbers buried in CRS declarations, not just coordinates.
    stack, nodes = [(parsed, 0)], 0
    while stack:
        item, depth = stack.pop()
        nodes += 1
        if nodes > limits.nodes or depth > limits.depth:
            fail("METADATA_LIMIT", "Geo JSON expansion exceeds the profile.", "limit")
        if isinstance(item, float) and not math.isfinite(item):
            fail("GEO_JSON", "Nonfinite Geo JSON number.")
        if isinstance(item, str) and len(item.encode("utf-8")) > limits.string_bytes:
            fail("STRING_LIMIT", "Geo JSON string exceeds the profile.", "limit")
        if isinstance(item, dict):
            stack.extend((x, depth+1) for pair in item.items() for x in pair)
        elif isinstance(item, list):
            stack.extend((x, depth+1) for x in item)
    return parsed


def declaration(obj, key):
    return {"state": "absent" if key not in obj else "null" if obj[key] is None else "declared",
            "value": obj.get(key)}


def profile(geo, names):
    reasons, columns = [], {}
    if not isinstance(geo, dict):
        return {"status": "unsupported", "reasons": ["geo_not_object"], "columns": columns}
    if geo.get("version") != PROFILE_VERSION:
        reasons.append("version_unsupported")
    declared = geo.get("columns")
    if not isinstance(declared, dict) or not declared:
        reasons.append("geometry_columns_missing_or_invalid")
        declared = {}
    if not isinstance(geo.get("primary_column"), str) or geo["primary_column"] not in declared:
        reasons.append("primary_column_missing_or_unresolved")
    for name, meta in declared.items():
        if not isinstance(meta, dict):
            reasons.append("geometry_column_metadata_invalid")
            continue
        crs = declaration(meta, "crs")
        crs["specificationDefault"] = ({"authority": "OGC", "code": "CRS84", "basis": "GeoParquet 1.1.0 absent crs"}
                                       if crs["state"] == "absent" and geo.get("version") == PROFILE_VERSION else None)
        crs["qualification"] = "unqualified"
        if crs["state"] == "declared" and not isinstance(crs["value"], dict):
            reasons.append("crs_not_projjson_object")
        edges = declaration(meta, "edges")
        edges["specificationDefault"] = "planar" if edges["state"] == "absent" and geo.get("version") == PROFILE_VERSION else None
        columns[name] = {"crs": crs, "edges": edges, "epoch": declaration(meta, "epoch"),
                         "orientation": declaration(meta, "orientation"), "encoding": declaration(meta, "encoding"),
                         "geometryTypes": declaration(meta, "geometry_types"),
                         "locator": {"metadataKey": "geo", "jsonPointer": "/columns/"+name.replace("~", "~0").replace("/", "~1")}}
        if name not in names:
            reasons.append("geometry_column_unresolved")
        if meta.get("encoding") != "WKB":
            reasons.append("encoding_unsupported")
        allowed = {"Point", "LineString", "Polygon", "MultiPoint", "MultiLineString", "MultiPolygon", "GeometryCollection"}
        types = meta.get("geometry_types")
        if not isinstance(types, list) or any(not isinstance(t, str) or t not in allowed for t in types):
            reasons.append("geometry_types_unsupported_or_missing")
        if "edges" in meta and meta["edges"] not in ("planar", "spherical"):
            reasons.append("edges_invalid")
    return {"status": "supported" if not reasons else "unsupported", "version": declaration(geo, "version"),
            "primaryColumn": declaration(geo, "primary_column"), "reasons": sorted(set(reasons)), "columns": columns}


def wkb_guard(raw, limits):
    """Only standard little/big-endian XY WKB 1..7, exact framing and finite XY.

    Reject EWKB/SRID, Z/M, unsupported nesting and trailing bytes before GEOS.
    Empty points use both NaNs as specified; other nonfinite values are rejected.
    """
    if len(raw) > limits.cell_bytes:
        fail("WKB_LIMIT", "WKB cell exceeds the profile.", "limit")
    pos, count, nodes = 0, 0, 0
    spans = []

    def take(size):
        nonlocal pos
        if size < 0 or pos+size > len(raw):
            fail("WKB", "Incomplete WKB value.")
        start = pos
        pos += size
        return raw[start:pos]

    def geometry(depth=0, expected=None):
        nonlocal count, nodes
        nodes += 1
        if depth > limits.depth or nodes > limits.nodes:
            fail("WKB_LIMIT", "WKB nesting exceeds the profile.", "limit")
        order = take(1)[0]
        if order not in (0, 1):
            fail("WKB", "Invalid WKB byte order.")
        endian = "<" if order else ">"
        kind = struct.unpack(endian+"I", take(4))[0]
        if kind not in range(1, 8):
            fail("WKB_PROFILE", "Only standard XY WKB types 1..7 are supported.", "unsupported")
        if expected and kind != expected:
            fail("WKB", "Invalid WKB multi-geometry member type.")

        def points(size, empty_point=False):
            nonlocal count
            if size > limits.coordinates//2 or count+size*2 > limits.coordinates:
                fail("COORDINATE_LIMIT", "WKB coordinate values exceed the profile.", "limit")
            start = pos
            chunk = take(size*16)
            for x, y in struct.iter_unpack(endian+"dd", chunk):
                if empty_point and math.isnan(x) and math.isnan(y):
                    continue
                if not math.isfinite(x) or not math.isfinite(y):
                    fail("WKB", "Nonfinite coordinate in WKB.")
            count += size*2
            spans.append({"byteStart": start, "byteEnd": pos, "byteOrder": "little" if order else "big", "coordinateValues": size*2})

        def number():
            value = struct.unpack(endian+"I", take(4))[0]
            if value > limits.nodes:
                fail("WKB_LIMIT", "WKB container count exceeds the profile.", "limit")
            return value

        if kind == 1:
            points(1, empty_point=True)
        elif kind == 2:
            points(number())
        elif kind == 3:
            for _ in range(number()):
                points(number())
        else:
            for _ in range(number()):
                geometry(depth+1, {4: 1, 5: 2, 6: 3}.get(kind))
        return kind

    kind = geometry()
    if pos != len(raw):
        fail("WKB", "Trailing WKB bytes are ambiguous.")
    return count, spans, kind


def extract(raw: bytes, start_row=0, row_count=100, limits=DEFAULT_LIMITS):
    """Must run after external limits attach. No native imports at module load."""
    if type(start_row) is not int or start_row < 0 or type(row_count) is not int or not 1 <= row_count <= limits.rows:
        fail("ROW_RANGE", "Select a nonnegative start and 1..1000 rows within configured limits.", "denied")
    footer = Footer(raw, limits)
    geo_entries = [e for e in footer.entries if e[1]["bytes"] == b"geo"]
    metadata = {"state": "absent", "entries": []}
    parsed = None
    for entry in geo_entries:
        value = entry.get(2)
        evidence = {"state": "absent" if value is None else "declared", "locator": {"metadataKey": "geo"}}
        if value:
            data = value["bytes"]
            evidence.update({"base64": base64.b64encode(data).decode("ascii"), "sha256": hashlib.sha256(data).hexdigest(),
                             "bytes": len(data), "locator": {"metadataKey": "geo", "byteStart": value["byteStart"], "byteEnd": value["byteEnd"]}})
            try:
                evidence["utf8"] = data.decode("utf-8")
                candidate = json_metadata(evidence["utf8"], limits)
                evidence["parsed"] = candidate
                evidence["state"] = "null" if candidate is None else "declared"
                parsed = candidate
            except (UnicodeError, GeoParquetError) as exc:
                evidence["state"] = "conflicting" if isinstance(exc, GeoParquetError) and exc.status == "conflicting" else "unsupported"
                evidence["reason"] = exc.code if isinstance(exc, GeoParquetError) else "GEO_UTF8"
        metadata["entries"].append(evidence)
    if geo_entries:
        metadata["state"] = "conflicting" if len(geo_entries) > 1 else metadata["entries"][0]["state"]

    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
        import shapely
        import numpy
    except ImportError:
        fail("PARSER_UNAVAILABLE", "Use the isolated pinned runtime.", "unavailable")
    if any(module.__version__ != PINS[name] for name, module in (("pyarrow", pa), ("shapely", shapely), ("numpy", numpy))):
        fail("PARSER_VERSION", "Native dependency version differs from the lane lock.", "unavailable")
    pa.set_cpu_count(1)
    pa.set_io_thread_count(1)
    try:
        parquet = pq.ParquetFile(pa.BufferReader(raw), memory_map=False, pre_buffer=False,
                                 thrift_string_size_limit=limits.footer_bytes, thrift_container_size_limit=limits.nodes,
                                 arrow_extensions_enabled=False)
    except Exception:
        fail("PARQUET", "Pinned Arrow rejected the Parquet footer.")
    fm = parquet.metadata
    if fm.num_columns > limits.columns or fm.num_row_groups > limits.row_groups:
        fail("SCHEMA_LIMIT", "Column/row-group inventory exceeds the profile.", "limit")
    schema = parquet.schema_arrow
    names = schema.names
    if len(set(names)) != len(names):
        fail("SCHEMA_CONFLICT", "Duplicate top-level column names are ambiguous.", "conflicting")
    arrow_geo = (fm.metadata or {}).get(b"geo")
    if len(geo_entries) == 1 and arrow_geo != geo_entries[0].get(2, {}).get("bytes"):
        fail("METADATA_DRIFT", "Arrow metadata disagrees with original footer bytes.")
    result_profile = profile(parsed, names)
    if metadata["state"] != "declared":
        result_profile.update(status="unsupported", reasons=["geo_"+metadata["state"]])
    groups, offset = [], 0
    for index in range(fm.num_row_groups):
        rg = fm.row_group(index)
        chunks, total = [], 0
        for ci in range(rg.num_columns):
            col = rg.column(ci)
            if col.file_path:
                fail("EXTERNAL_CHUNK", "External Parquet column files are not allowed.", "denied")
            if col.total_uncompressed_size < 0 or col.total_compressed_size < 0 or col.num_values < 0:
                fail("PARQUET", "Invalid column chunk size/count.")
            total += col.total_uncompressed_size
            begin = col.dictionary_page_offset if col.has_dictionary_page else col.data_page_offset
            if begin < 4 or begin+col.total_compressed_size > footer.start:
                fail("PARQUET", "Column chunk exceeds the original data span.")
            chunks.append({"columnIndex": ci, "columnPath": col.path_in_schema, "physicalType": col.physical_type,
                           "compression": col.compression, "encodings": list(col.encodings), "compressedBytes": col.total_compressed_size,
                           "declaredUncompressedBytes": col.total_uncompressed_size, "numValues": col.num_values,
                           "locator": {"rowGroupIndex": index, "byteStart": begin, "byteEnd": begin+col.total_compressed_size}})
        groups.append({"rowGroupIndex": index, "startRowIndex": offset, "numRows": rg.num_rows,
                       "declaredUncompressedBytes": total, "columns": chunks})
        if rg.num_rows < 0:
            fail("PARQUET", "Negative row-group row count.")
        offset += rg.num_rows
    if offset != fm.num_rows:
        fail("PARQUET", "File and row-group row counts conflict.")

    result = {"format": "usp-native-geoparquet/1", "source": {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw),
              "parquetVersion": fm.format_version, "footerLocator": {"byteStart": footer.start, "byteEnd": footer.end}},
              "reader": {"versions": PINS, "profileVersion": PROFILE_VERSION, "limits": asdict(limits)},
              "geoMetadata": metadata, "profile": result_profile,
              "schema": {"arrow": str(schema), "parquet": str(parquet.schema).split("\n", 1)[-1], "columns": [
                  {"columnIndex": i, "name": field.name, "arrowType": str(field.type), "nullable": field.nullable}
                  for i, field in enumerate(schema)], "leafColumns": [
                  {"columnIndex": i, "path": parquet.schema.column(i).path,
                   "physicalType": parquet.schema.column(i).physical_type,
                   "logicalType": str(parquet.schema.column(i).logical_type),
                   "convertedType": parquet.schema.column(i).converted_type,
                   "maxDefinitionLevel": parquet.schema.column(i).max_definition_level,
                   "maxRepetitionLevel": parquet.schema.column(i).max_repetition_level}
                  for i in range(fm.num_columns)]}, "rowGroups": groups, "rows": [],
              "semantics": {"globalPlacementQualified": False, "transformApplied": False, "measurementQualified": False,
                            "canonicalIdentityAssigned": False, "originalValuesOnly": True},
              "window": {"totalRows": fm.num_rows, "requestedStartRowIndex": start_row, "requestedRows": row_count,
                         "returnedRows": 0, "coordinateValues": 0, "status": "unsupported", "nextRowIndex": None,
                         "truncated": False, "prefixRowsOmitted": min(start_row, fm.num_rows)}}
    if result_profile["status"] != "supported":
        return result

    geometry_names = set(result_profile["columns"])
    for field in schema:
        if field.name in geometry_names and not (pa.types.is_binary(field.type) or pa.types.is_large_binary(field.type)):
            result_profile.update(status="unsupported", reasons=["wkb_column_not_binary"])
            return result
    end_row = min(fm.num_rows, start_row+row_count)
    selected = [g for g in groups if g["startRowIndex"] < end_row and g["startRowIndex"]+g["numRows"] > start_row]
    # This happens for ALL selected groups before the first decompression call.
    for g in selected:
        if g["declaredUncompressedBytes"] > limits.group_bytes or g["numRows"] > limits.group_rows:
            fail("EXPANSION_LIMIT", "Selected row group exceeds declared expansion/scan limits.", "limit", {"rowGroupIndex": g["rowGroupIndex"]})
        if any(c["compression"] not in ("UNCOMPRESSED", "SNAPPY") for c in g["columns"]):
            result_profile.update(status="unsupported", reasons=["compression_unsupported"])
            return result
    scalar_nodes = 0

    def decoded_geometry(geometry):
        # GEOS's __geo_interface__ cannot represent an empty Point nested inside
        # a nonempty collection. Preserve emptiness without manufacturing XY.
        if geometry.is_empty:
            return {"type": geometry.geom_type, "empty": True, "coordinates": []}
        if geometry.geom_type == "GeometryCollection":
            return {"type": geometry.geom_type, "empty": False,
                    "geometries": [decoded_geometry(g) for g in geometry.geoms]}
        return {"type": geometry.geom_type, "empty": False, "coordinates": geometry.__geo_interface__["coordinates"]}

    def encode(value, depth=0):
        nonlocal scalar_nodes
        scalar_nodes += 1
        if scalar_nodes > limits.nodes or depth > limits.depth:
            fail("VALUE_LIMIT", "Selected values exceed nesting/expansion limits.", "limit")
        if value is None or isinstance(value, bool):
            return value
        if isinstance(value, int):
            return {"decimalInteger": str(value)}
        if isinstance(value, float):
            return value if math.isfinite(value) else {"ieee754": "nan" if math.isnan(value) else "+infinity" if value > 0 else "-infinity"}
        if isinstance(value, decimal.Decimal):
            return {"decimal": str(value)}
        if isinstance(value, (datetime.date, datetime.time, datetime.datetime, datetime.timedelta)):
            return {"temporalLiteral": str(value), "pythonType": type(value).__name__}
        if isinstance(value, str):
            if len(value.encode("utf-8")) > limits.string_bytes:
                fail("STRING_LIMIT", "Selected string exceeds the profile.", "limit")
            return value
        if isinstance(value, bytes):
            if len(value) > limits.cell_bytes:
                fail("CELL_LIMIT", "Selected binary value exceeds the profile.", "limit")
            return {"hex": value.hex(), "sha256": hashlib.sha256(value).hexdigest(), "bytes": len(value)}
        if isinstance(value, dict):
            return {key: encode(item, depth+1) for key, item in value.items()}
        if isinstance(value, (tuple, list)):
            return [encode(item, depth+1) for item in value]
        fail("VALUE_TYPE", "Selected Arrow type is outside this literal profile.", "unsupported")

    coordinate_count, stopped, scanned_rows, prefix_rows = 0, False, 0, 0
    for group in selected:
        within = 0
        try:
            batches = parquet.iter_batches(batch_size=min(64, row_count), row_groups=[group["rowGroupIndex"]], use_threads=False)
            for batch in batches:
                scanned_rows += batch.num_rows
                for bi in range(batch.num_rows):
                    row_index = group["startRowIndex"]+within+bi
                    if row_index < start_row:
                        prefix_rows += 1
                        continue
                    if row_index >= end_row:
                        stopped = True
                        break
                    cells, row_coordinates = {}, 0
                    for ci, field in enumerate(schema):
                        scalar = batch.column(ci)[bi]
                        loc = {"rowGroupIndex": group["rowGroupIndex"], "rowIndexInGroup": within+bi,
                               "rowIndex": row_index, "columnIndex": ci, "columnName": field.name}
                        cell = {"state": "declared" if scalar.is_valid else "null", "arrowType": str(field.type), "locator": loc}
                        # Bound variable-width scalar conversion before Python
                        # materializes its bytes/string from the native buffer.
                        if scalar.is_valid and (pa.types.is_binary(field.type) or pa.types.is_large_binary(field.type)
                                                or pa.types.is_string(field.type) or pa.types.is_large_string(field.type)):
                            ceiling = limits.cell_bytes if field.name in geometry_names or pa.types.is_binary(field.type) or pa.types.is_large_binary(field.type) else limits.string_bytes
                            if scalar.as_buffer().size > ceiling:
                                fail("CELL_LIMIT", "Selected variable-width scalar exceeds the profile.", "limit", loc)
                        value = scalar.as_py()
                        cell["value"] = encode(value)
                        if field.name in geometry_names and value is not None:
                            try:
                                ncoords, spans, _ = wkb_guard(value, limits)
                                if coordinate_count+row_coordinates+ncoords > limits.coordinates:
                                    stopped = True
                                    break
                                geometry = shapely.from_wkb(value, on_invalid="raise")
                                decoded = decoded_geometry(geometry)
                                cell["wkb"] = cell.pop("value")
                                cell["decoded"] = {**decoded, "coordinateValues": ncoords,
                                                   "wkbCoordinateSpans": spans, "state": "available"}
                                types = parsed["columns"][field.name]["geometry_types"]
                                cell["decoded"]["declarationState"] = ("unknown" if not types else
                                                                       "consistent" if geometry.geom_type in types else "conflicting")
                                row_coordinates += ncoords
                            except (GeoParquetError, shapely.errors.GEOSException, IndexError, ValueError) as exc:
                                cell["wkb"] = cell.pop("value")
                                cell["decoded"] = {"state": "unsupported", "reason": exc.code if isinstance(exc, GeoParquetError) else "GEOS_REJECTED"}
                        cells[field.name] = cell
                    if stopped:
                        break
                    result["rows"].append({"rowIndex": row_index, "rowGroupIndex": group["rowGroupIndex"], "columns": cells})
                    coordinate_count += row_coordinates
                within += batch.num_rows
                if stopped or group["startRowIndex"]+within >= end_row:
                    break
        except GeoParquetError:
            raise
        except Exception:
            fail("ROW_DECODE", "Pinned Arrow rejected selected row data; no partial output is published.")
        if stopped:
            break
    returned = len(result["rows"])
    next_row = min(start_row+returned, fm.num_rows)
    result["window"].update(returnedRows=returned, coordinateValues=coordinate_count, status="available",
                            scannedBatchRows=scanned_rows, prefixRowsScannedInSelectedGroups=prefix_rows,
                            nextRowIndex=next_row if next_row < fm.num_rows else None,
                            truncated=next_row < fm.num_rows,
                            stopReason="coordinate_budget" if next_row < end_row else "row_window" if next_row < fm.num_rows else "end_of_file")
    return result


def encode_result(result, limits=DEFAULT_LIMITS):
    data = json.dumps(result, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode("utf-8")
    if len(data) > limits.output_bytes:
        fail("OUTPUT_LIMIT", "Complete projection exceeds the output byte limit.", "limit")
    return data
