"""Bounded native area adapters; local metre geometry is explicitly not RFC GeoJSON.

These operations prepare physical observations, not cadastral rights or evidence of
illegality. Source geometry and mapped values survive normalization unchanged.
"""
from __future__ import annotations

import base64
import binascii
import copy
import hashlib
import io
import json
import math
import re
import uuid
import zipfile
from xml.etree import ElementTree

import pyproj
from pyproj import CRS, Transformer
from pyproj.exceptions import CRSError, ProjError
from shapely.geometry import mapping as shape_mapping, shape
from shapely.ops import transform
from shapely.strtree import STRtree
from shapely.validation import explain_validity

from .validation import InputError

MAX_FEATURES = 2000
MAX_VERTICES = 100_000
MAX_FEATURE_VERTICES = 10_000
MAX_PARTS = 256
MAX_PAIRS = 20_000
MAX_EXTENT_M = 50_000
MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
MAX_DOCUMENT_TEXT = 250_000
MAX_DOCUMENT_PAGES = 100
KINDS = {"building", "parcel", "road", "public_land", "utility"}
WORLD_STATES = {"observed", "planned", "hypothetical", "synthetic"}
VERTICAL_REFERENCE = "building-relative; not aligned between features"
EPSILON = 1e-6


def _number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise InputError(f"{label} must be a finite number.")
    return float(value)


def _text(value, label, limit=256):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise InputError(f"{label} must be nonempty text of at most {limit} characters.")
    return value.strip()


def _crs(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"EPSG:[1-9][0-9]{2,5}", value, re.IGNORECASE):
        raise InputError(f"{label} requires an explicit EPSG code, for example EPSG:32643.")
    try:
        result = CRS.from_user_input(value.upper())
    except CRSError:
        raise InputError(f"{label} is not a recognized EPSG coordinate reference system.") from None
    if len(result.axis_info) != 2 or not (result.is_projected or result.is_geographic):
        raise InputError(f"{label} must be a two-dimensional horizontal CRS.")
    return result


def _analysis_crs(value):
    result = _crs(value, "analysisCrs")
    code = result.to_epsg()
    if code is None or not (32601 <= code <= 32660 or 32701 <= code <= 32760):
        raise InputError("analysisCrs must be a WGS84 UTM EPSG:32601–32660 or EPSG:32701–32760 frame in metres.")
    return result


def _list(value, label, minimum=1, maximum=MAX_PARTS):
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise InputError(f"{label} requires {minimum}–{maximum} entries.")
    return value


def _geometry(raw, label="geometry", geographic=False):
    """Validate before GEOS, so unsupported dimensions cannot be silently discarded."""
    if not isinstance(raw, dict) or "crs" in raw:
        raise InputError(f"{label} requires a geometry object without a per-feature CRS override.")
    kind, coordinates = raw.get("type"), raw.get("coordinates")
    count = 0

    def position(value):
        nonlocal count
        if not isinstance(value, list) or len(value) != 2:
            raise InputError(f"{label} requires exactly two coordinates; Z/M values are unsupported and will not be dropped.")
        x, y = (_number(v, label + " coordinate") for v in value)
        if geographic and not (-180 <= x <= 180 and -90 <= y <= 90):
            raise InputError(f"{label} longitude/latitude are outside geographic bounds.")
        count += 1
        if count > MAX_FEATURE_VERTICES:
            raise InputError(f"Each feature supports at most {MAX_FEATURE_VERTICES} vertices.")
        return [x, y]

    def line(value, ring=False):
        values = _list(value, label + (" ring" if ring else " line"), 4 if ring else 2, MAX_FEATURE_VERTICES)
        result = [position(p) for p in values]
        if ring and result[0] != result[-1]:
            raise InputError(f"{label} polygon rings must be explicitly closed.")
        return result

    def polygon(value):
        return [line(ring, True) for ring in _list(value, label + " rings")]

    if kind == "Point":
        parsed = position(coordinates)
    elif kind == "MultiPoint":
        parsed = [position(p) for p in _list(coordinates, label + " points")]
    elif kind == "LineString":
        parsed = line(coordinates)
    elif kind == "MultiLineString":
        parsed = [line(p) for p in _list(coordinates, label + " lines")]
    elif kind == "Polygon":
        parsed = polygon(coordinates)
    elif kind == "MultiPolygon":
        parsed = [polygon(p) for p in _list(coordinates, label + " polygons")]
    else:
        raise InputError(f"{label} supports Point, MultiPoint, LineString, MultiLineString, Polygon and MultiPolygon only.")
    result = shape({"type": kind, "coordinates": parsed})
    if result.is_empty or not result.is_valid:
        raise InputError(f"{label} is empty or invalid: {explain_validity(result)}. Repair the source explicitly; no parts were discarded.")
    if kind in ("LineString", "MultiLineString") and result.length <= 0:
        raise InputError(f"{label} must have positive line length.")
    return result, count


def _arcgis_geometry(raw):
    if not isinstance(raw, dict):
        raise InputError("ArcGIS feature requires a geometry object.")
    if any(raw.get(key) for key in ("hasZ", "hasM")) or any(key in raw for key in ("z", "m", "curveRings", "curvePaths")):
        raise InputError("ArcGIS Z/M and curved geometries require a dedicated adapter; they will not be flattened.")
    shapes = [key for key in ("rings", "paths", "points", "x") if key in raw]
    if len(shapes) != 1:
        raise InputError("ArcGIS geometry must contain exactly one supported geometry representation.")
    if "x" in raw:
        return {"type": "Point", "coordinates": [raw.get("x"), raw.get("y")]}
    if "points" in raw:
        return {"type": "MultiPoint", "coordinates": raw["points"]}
    if "paths" in raw:
        paths = _list(raw["paths"], "ArcGIS paths")
        return {"type": "LineString" if len(paths) == 1 else "MultiLineString", "coordinates": paths[0] if len(paths) == 1 else paths}

    rings = _list(raw["rings"], "ArcGIS rings")
    if sum(len(ring) if isinstance(ring, list) else 0 for ring in rings) > MAX_FEATURE_VERTICES:
        raise InputError(f"Each feature supports at most {MAX_FEATURE_VERTICES} vertices.")
    polygons = [_geometry({"type": "Polygon", "coordinates": [ring]}, "ArcGIS ring")[0] for ring in rings]
    # ArcGIS uses even/odd ring filling. Full-ring containment handles unordered
    # shells, courtyards and islands; orientation alone can lose multipart shells.
    parents = []
    for i, polygon in enumerate(polygons):
        containers = []
        for j, other in enumerate(polygons):
            if i == j or not polygon.intersects(other):
                continue
            if polygon.equals(other) or polygon.boundary.intersects(other.boundary):
                raise InputError("ArcGIS rings overlap, duplicate or touch ambiguously; supply valid separated shell/hole boundaries.")
            if other.contains(polygon):
                containers.append(j)
            elif not polygon.contains(other):
                raise InputError("ArcGIS rings partially overlap; no ring can be safely discarded.")
        parents.append(min(containers, key=lambda j: polygons[j].area) if containers else None)

    def depth(index):
        level = 0
        while parents[index] is not None:
            level += 1
            index = parents[index]
        return level

    parts = [[ring] + [rings[j] for j in range(len(rings)) if parents[j] == i and depth(j) % 2 == 1]
             for i, ring in enumerate(rings) if depth(i) % 2 == 0]
    return {"type": "Polygon" if len(parts) == 1 else "MultiPolygon", "coordinates": parts[0] if len(parts) == 1 else parts}


def _spatial_reference(raw):
    if not isinstance(raw, dict):
        raise InputError("ArcGIS spatialReference requires a wkid or latestWkid.")
    if any(raw.get(key) for key in ("vcsWkid", "latestVcsWkid", "wkt")):
        raise InputError("ArcGIS vertical/custom WKT references require an explicit dedicated adapter.")
    wkid = raw.get("latestWkid", raw.get("wkid"))
    if isinstance(wkid, bool) or not isinstance(wkid, int):
        raise InputError("ArcGIS spatialReference requires an integer wkid or latestWkid.")
    # Esri's documented historical aliases for Web Mercator.
    wkid = 3857 if wkid in (102100, 102113, 900913) else wkid
    return _crs(f"EPSG:{wkid}", "sourceCrs")


def _json_geometry(value):
    return json.loads(json.dumps(shape_mapping(value), allow_nan=False))


def _transform(value, operation):
    try:
        result = transform(lambda x, y: operation.transform(x, y, errcheck=True), value)
    except ProjError:
        raise InputError("Coordinate transformation failed; verify source CRS and extent.") from None
    _geometry(_json_geometry(result), "transformed geometry")
    return result


def _bounds(shapes):
    bounds = [item.bounds for item in shapes]
    return [min(b[0] for b in bounds), min(b[1] for b in bounds), max(b[2] for b in bounds), max(b[3] for b in bounds)]


def _height(properties, fields, warnings, source_key):
    raw = properties.get(fields.get("heightField"))
    meaning = fields.get("heightMeaning") or "height above the building's own ground level"
    result = {"state": "unknown", "value": None, "unit": "m", "meaning": meaning, "reference": VERTICAL_REFERENCE}
    if raw is None or raw == "":
        return result
    result["originalValue"] = raw
    if fields.get("heightUnit"):
        result["originalUnit"] = fields["heightUnit"]
    if fields.get("heightUnit") not in ("m", "ft"):
        warnings.append(f"{source_key}: height units are unresolved; the original value is retained and analytical height remains unknown.")
        return result
    try:
        value = float(raw) if isinstance(raw, str) else _number(raw, "height")
    except (ValueError, TypeError):
        raise InputError(f"{source_key}: mapped height must be a finite numeric value or empty.") from None
    if not math.isfinite(value) or value <= 0 or value > 20_000:
        raise InputError(f"{source_key}: mapped height must be positive and finite, at most 20,000 source units.")
    value *= 0.3048 if fields["heightUnit"] == "ft" else 1
    result.update(state="source_supported", value=value)
    return result


def normalize_area(data):
    if not isinstance(data, dict) or data.get("format") not in ("geojson", "arcgis"):
        raise InputError("format must be geojson or arcgis.")
    source, fields = data.get("data"), data.get("mapping")
    if not isinstance(source, dict) or not isinstance(fields, dict) or fields.get("kind") not in KINDS:
        raise InputError("A source object and explicit supported feature-kind mapping are required.")
    try:
        source_size = len(json.dumps(source, allow_nan=False, separators=(",", ":")))
    except (ValueError, TypeError):
        raise InputError("Source input must contain JSON-safe finite values.") from None
    if source_size > 20 * 1024 * 1024:
        raise InputError("A normalized import supports at most 20 MiB of source JSON.")
    for key in ("idField", "nameField", "heightField"):
        if fields.get(key) is not None:
            _text(fields[key], key)
    identifier_fields = fields.get("identifierFields", [])
    _list(identifier_fields, "identifierFields", 0, 10)
    for field in identifier_fields:
        _text(field, "identifierField")
    if fields.get("heightMeaning") is not None:
        _text(fields["heightMeaning"], "heightMeaning", 500)
    if fields.get("heightUnit") not in (None, "m", "ft"):
        raise InputError("heightUnit must be m or ft; unresolved units may be omitted.")
    world_status = data.get("worldStatus", "observed")
    if world_status not in WORLD_STATES:
        raise InputError("worldStatus must be observed, planned, hypothetical or synthetic.")
    reference = data.get("reference") or {}
    if not isinstance(reference, dict):
        raise InputError("reference must be an object.")
    source_crs = None
    legacy_geojson_crs = False
    if data["format"] == "geojson":
        # Socrata's unchanged NYC export declares CRS84, whose x/y order is
        # explicitly longitude/latitude. This is a recognized legacy declaration,
        # not permission to reinterpret projected GeoJSON as EPSG:4326.
        legacy_geojson_crs = source.get("crs") == {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}}
        if source.get("type") != "FeatureCollection" or "crs" in source and not legacy_geojson_crs:
            raise InputError("GeoJSON requires an RFC 7946 FeatureCollection in longitude/latitude EPSG:4326, without a crs override.")
        source_crs = CRS.from_epsg(4326)
        if reference.get("sourceCrs") and not _crs(reference["sourceCrs"], "sourceCrs").equals(source_crs):
            raise InputError("RFC GeoJSON input is EPSG:4326; projected data must use an explicit source adapter.")
    else:
        if source.get("exceededTransferLimit"):
            raise InputError("ArcGIS transfer is incomplete; retrieve and reconcile all pages before normalization.")
        if source.get("hasZ") or source.get("hasM"):
            raise InputError("ArcGIS Z/M feature sets require a dedicated adapter.")
        if source.get("spatialReference") is not None:
            source_crs = _spatial_reference(source["spatialReference"])
        if reference.get("sourceCrs"):
            specified = _crs(reference["sourceCrs"], "sourceCrs")
            if source_crs is not None and not specified.equals(source_crs):
                raise InputError("Explicit sourceCrs conflicts with ArcGIS spatialReference.")
            source_crs = specified
    collection_reference = source_crs is not None
    rows = _list(source.get("features"), "Source features", 1, MAX_FEATURES)
    prepared, warnings, keys, total_vertices = [], [], set(), 0
    if legacy_geojson_crs:
        warnings.append("Recognized the source's legacy OGC CRS84 declaration as longitude/latitude WGS84. Original bytes retain that declaration; normalized geographic geometry uses RFC 7946 coordinates.")
    fallback_ids = False
    for index, feature in enumerate(rows):
        if not isinstance(feature, dict) or "crs" in feature:
            raise InputError("Each source feature must be an object without a CRS override.")
        if data["format"] == "geojson" and feature.get("type") != "Feature":
            raise InputError("Every GeoJSON collection entry must be a Feature.")
        original = feature.get("geometry")
        properties = feature.get("properties" if data["format"] == "geojson" else "attributes") or {}
        if not isinstance(properties, dict):
            raise InputError("Feature attributes/properties must be an object.")
        allowed = {}
        selected_fields = [fields.get(key) for key in ("idField", "nameField", "heightField")] + identifier_fields
        for field in selected_fields:
            if field and field in properties:
                value = properties[field]
                if value is not None and (isinstance(value, (dict, list)) or isinstance(value, str) and len(value) > 2048):
                    raise InputError("Mapped fields must be scalar values of at most 2048 characters.")
                if isinstance(value, (float, int)) and not isinstance(value, bool):
                    _number(value, "Mapped field")
                allowed[field] = value
        raw_key = properties.get(fields["idField"]) if fields.get("idField") else feature.get("id")
        if raw_key is None or raw_key == "":
            if fields.get("idField"):
                raise InputError("The mapped source ID is missing on a feature; choose a complete unique ID field.")
            raw_key = f"feature:{index + 1}"
            fallback_ids = True
        if isinstance(raw_key, bool) or not isinstance(raw_key, (str, int, float)):
            raise InputError("Source IDs must be nonempty text or numbers.")
        source_key = _text(str(raw_key), "Source ID")
        if source_key in keys:
            raise InputError(f"Duplicate source ID {source_key}; source-feature identity must be unique.")
        keys.add(source_key)
        name_value = properties.get(fields.get("nameField"))
        name = _text(str(name_value), "Feature name", 2048) if name_value is not None and name_value != "" else f"{fields['kind'].replace('_', ' ').title()} {source_key}"
        if data["format"] == "arcgis":
            if not collection_reference and (not isinstance(original, dict) or original.get("spatialReference") is None):
                raise InputError("Every ArcGIS feature needs a spatialReference when no collection/sourceCrs reference is supplied.")
            if isinstance(original, dict) and original.get("spatialReference") is not None:
                row_crs = _spatial_reference(original["spatialReference"])
                if source_crs is not None and not source_crs.equals(row_crs):
                    raise InputError("Mixed source coordinate references are unsupported in one import; normalize each layer separately into the retained area reference.")
                source_crs = row_crs
            parsed = _arcgis_geometry(original)
        else:
            parsed = original
        geometry, count = _geometry(parsed, f"Feature {source_key}", geographic=data["format"] == "geojson")
        if fields["kind"] in ("building", "parcel", "public_land") and geometry.geom_type not in ("Polygon", "MultiPolygon"):
            raise InputError(f"{fields['kind']} features require Polygon or MultiPolygon geometry.")
        total_vertices += count
        if total_vertices > MAX_VERTICES:
            raise InputError(f"An import supports at most {MAX_VERTICES} vertices.")
        prepared.append({"sourceKey": source_key, "name": name, "kind": fields["kind"], "sourceGeometry": copy.deepcopy(original),
                         "height": _height(allowed, fields, warnings, source_key), "worldStatus": world_status,
                         "properties": allowed, "_shape": geometry})
    if source_crs is None:
        raise InputError("ArcGIS source CRS is unknown; provide spatialReference.wkid or reference.sourceCrs.")
    try:
        to_geographic = Transformer.from_crs(source_crs, 4326, always_xy=True, allow_ballpark=False, only_best=True)
        geographic = [_transform(row["_shape"], to_geographic) for row in prepared]
        geographic_extent = _bounds(geographic)
        west, south, east, north = geographic_extent
        if not (-180 <= west <= east <= 180 and -80 <= south <= north <= 84) or east - west > 1 or north - south > 1:
            raise InputError("Choose one bounded area within UTM coverage (80°S–84°N), without crossing the antimeridian.")
        middle_lon, middle_lat = (west + east) / 2, (south + north) / 2
        zone = min(60, max(1, int((middle_lon + 180) // 6) + 1))
        analysis = _analysis_crs(reference["analysisCrs"]) if reference.get("analysisCrs") else CRS.from_epsg((32600 if middle_lat >= 0 else 32700) + zone)
        aou = analysis.area_of_use
        if not (aou.west - 0.25 <= middle_lon <= aou.east + 0.25 and aou.south <= middle_lat <= aou.north):
            raise InputError("The selected analysis CRS does not cover this area; use its appropriate UTM zone and hemisphere.")
        projection = Transformer.from_crs(source_crs, analysis, always_xy=True, allow_ballpark=False, only_best=True)
        projected = [_transform(row["_shape"], projection) for row in prepared]
        metric_extent = _bounds(projected)
        if metric_extent[2] - metric_extent[0] > MAX_EXTENT_M or metric_extent[3] - metric_extent[1] > MAX_EXTENT_M:
            raise InputError("Choose a bounded area no more than 50 km across for this local analytical adapter.")
        origin = reference.get("origin")
        if origin is None:
            origin = metric_extent[:2]
        if not isinstance(origin, list) or len(origin) != 2:
            raise InputError("The retained area origin requires two projected metre coordinates.")
        origin = [_number(value, "origin") for value in origin]
        if any(abs(metric_extent[i] - origin[i % 2]) > MAX_EXTENT_M for i in range(4)):
            raise InputError("Features exceed 50 km from the retained area origin; select the matching map area.")
        anchor = list(Transformer.from_crs(analysis, 4326, always_xy=True).transform(*origin, errcheck=True))
    except ProjError:
        raise InputError("No supported coordinate operation is available locally for these references.") from None
    features = []
    for row, local_source, geographic_shape in zip(prepared, projected, geographic):
        row.pop("_shape")
        local = transform(lambda x, y: (x - origin[0], y - origin[1]), local_source)
        row.update(geometry=_json_geometry(local), geographicGeometry=_json_geometry(geographic_shape),
                   areaM2=local.area if local.geom_type in ("Polygon", "MultiPolygon") else None)
        features.append(row)
    if fallback_ids:
        warnings.append("Some features have positional source IDs; map a stable source ID field before importing later source revisions.")
    unknown_heights = sum(row["kind"] == "building" and row["height"]["state"] == "unknown" for row in features)
    if unknown_heights:
        warnings.append(f"{unknown_heights} building(s) have unknown height and remain footprint-only; no analytical height was invented.")
    warnings.append("Local geometry uses metres in the retained area frame and is not RFC GeoJSON. Building-relative heights do not establish shared elevation or legal rights.")
    return {"reference": {"sourceCrs": source_crs.to_string(), "analysisCrs": analysis.to_string(), "origin": origin,
                          "anchor": anchor, "transformVersion": f"area-native-v1 / pyproj {pyproj.__version__} / PROJ {pyproj.proj_version_str} / {projection.definition}",
                          "verticalReference": VERTICAL_REFERENCE},
            "extent": [metric_extent[i] - origin[i % 2] for i in range(4)], "geographicExtent": geographic_extent,
            "features": features, "warnings": warnings}


def check_area(data):
    if not isinstance(data, dict) or not isinstance(data.get("reference"), dict):
        raise InputError("Area checks require the retained analysis reference.")
    reference = data["reference"]
    _analysis_crs(reference.get("analysisCrs"))
    if not isinstance(reference.get("origin"), list) or len(reference["origin"]) != 2:
        raise InputError("Area checks require the retained projected origin.")
    for value in reference["origin"]:
        _number(value, "origin")
    rows = _list(data.get("features"), "Check features", 0, MAX_FEATURES)
    shapes, identifiers, vertex_count = [], set(), 0
    for row in rows:
        if not isinstance(row, dict) or row.get("kind") not in KINDS:
            raise InputError("Every check feature requires an explicit supported kind.")
        identifier = _text(row.get("id"), "Feature ID")
        if identifier in identifiers:
            raise InputError("Check feature IDs must be unique.")
        identifiers.add(identifier)
        if row.get("worldStatus", "observed") not in WORLD_STATES:
            raise InputError("Invalid check feature worldStatus.")
        geometry, count = _geometry(row.get("geometry"), "Check geometry")
        if row["kind"] in ("building", "parcel", "public_land") and geometry.geom_type not in ("Polygon", "MultiPolygon"):
            raise InputError(f"{row['kind']} check geometry requires a polygon.")
        if any(abs(value) > MAX_EXTENT_M for value in geometry.bounds):
            raise InputError("Check geometry exceeds the bounded local area frame.")
        vertex_count += count
        if vertex_count > MAX_VERTICES:
            raise InputError(f"An area check supports at most {MAX_VERTICES} vertices.")
        shapes.append(geometry)
    findings, coverage = [], [
        "Horizontal findings describe intersections of the supplied snapshot, not ownership, encroachment or illegality.",
        "No vertical collision volume was computed: building-relative heights and utility depth/elevation lack an aligned shared vertical reference.",
        "Coverage is limited to supplied features; absent roads, public land or utilities cannot establish absence of conflicts.",
    ]
    if not rows:
        return {"findings": [], "coverage": coverage + ["No features were supplied."]}
    tree = STRtree(shapes)
    candidate_count = 0

    def finding(category, code, message, indices, intersection=None, area=None):
        feature_ids = sorted(rows[i]["id"] for i in indices)
        entry = {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"area-check-v1:{code}:{':'.join(feature_ids)}")),
                 "category": category, "code": code, "message": message, "featureIds": feature_ids}
        if area is not None:
            entry["areaM2"] = area
        if intersection is not None and not intersection.is_empty:
            entry["geometry"] = _json_geometry(intersection)
        findings.append(entry)

    for i, geometry in enumerate(shapes):
        for raw_j in tree.query(geometry):
            j = int(raw_j)
            if j <= i:
                continue
            first, second = rows[i], rows[j]
            kinds = {first["kind"], second["kind"]}
            if "building" not in kinds or not kinds.issubset({"building", "road", "public_land", "utility"}):
                continue
            candidate_count += 1
            if candidate_count > MAX_PAIRS:
                raise InputError(f"Area check exceeds {MAX_PAIRS} candidate pairs; split the area. No partial check is reported as complete.")
            other = shapes[j]
            if not geometry.intersects(other):
                continue
            intersection = geometry.intersection(other)
            status_note = "; ".join(f"{r['id']}: {r.get('worldStatus', 'observed')}" for r in (first, second))
            if geometry.touches(other):
                finding("geometric", "BOUNDARY_CONTACT", f"Boundary contact only; no positive footprint-area overlap. {status_note}.", (i, j), intersection, 0.0)
            elif "utility" in kinds:
                finding("geometric", "UTILITY_HORIZONTAL_INTERSECTION", f"Building and utility intersect horizontally. This does not establish a 3D collision or an easement violation. {status_note}.", (i, j), intersection,
                        intersection.area if intersection.area > EPSILON else None)
            elif intersection.area > EPSILON:
                code = "BUILDING_FOOTPRINT_OVERLAP" if kinds == {"building"} else "BUILDING_ROAD_OVERLAP" if "road" in kinds else "BUILDING_PUBLIC_LAND_OVERLAP"
                finding("geometric", code, f"Positive horizontal footprint overlap of {intersection.area:.3f} m² requires source/geometry review; this is not a legal determination. {status_note}.", (i, j), intersection, intersection.area)
            elif not geometry.touches(other):
                finding("geometric", "HORIZONTAL_INTERSECTION", f"Horizontal line/point intersection; road width or polygon evidence is needed to compute overlap area. {status_note}.", (i, j), intersection)
            if "utility" in kinds:
                finding("coverage", "UTILITY_VERTICAL_UNRESOLVED", "A horizontal utility relationship is present, but aligned building elevation, utility depth/elevation and cross-section evidence are missing; 3D collision analysis is unavailable.", (i, j))
    for kind, description in (("road", "road"), ("public_land", "public-land"), ("utility", "utility")):
        if not any(row["kind"] == kind for row in rows):
            coverage.append(f"No {description} layer is present in this snapshot.")
    return {"findings": sorted(findings, key=lambda f: (f["code"], f["featureIds"])), "coverage": coverage}


def extract_document(data):
    """Extract native text with locators, without interpreting document instructions."""
    if not isinstance(data, dict) or data.get("format") not in ("pdf", "docx", "text"):
        raise InputError("Native document format must be pdf, docx or text.")
    encoded = data.get("base64")
    if not isinstance(encoded, str) or len(encoded) > (MAX_DOCUMENT_BYTES + 2) // 3 * 4:
        raise InputError("Document must be base64 with at most 10 MiB of decoded bytes.")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise InputError("Document base64 is invalid.") from None
    if not raw or len(raw) > MAX_DOCUMENT_BYTES:
        raise InputError("Document must contain 1 byte–10 MiB.")
    parts, warnings, total_text = [], [], 0

    def add(text, locator):
        nonlocal total_text
        total_text += len(text)
        if total_text > MAX_DOCUMENT_TEXT:
            raise InputError("Native document text exceeds 250,000 characters; split the source into explicit parts.")
        if text.strip():
            if len(parts) >= 10_000:
                raise InputError("Native document extraction supports at most 10,000 text parts.")
            parts.append({"id": f"part-{len(parts) + 1}", "text": text, "locator": locator})

    if data["format"] == "text":
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise InputError("Text input must be UTF-8.") from None
        if "\x00" in text:
            raise InputError("Text input contains binary null bytes.")
        if len(text) > MAX_DOCUMENT_TEXT:
            raise InputError("Native document text exceeds 250,000 characters; split the source into explicit parts.")
        for index, line in enumerate(text.splitlines()):
            add(line, {"line": index + 1, "label": f"line {index + 1}"})
    elif data["format"] == "pdf":
        from pypdf import PdfReader
        try:
            reader = PdfReader(io.BytesIO(raw), strict=True)
            if reader.is_encrypted:
                raise InputError("Encrypted PDFs require an explicitly decrypted source.")
            if len(reader.pages) > MAX_DOCUMENT_PAGES:
                raise InputError("Native PDF extraction supports at most 100 pages.")
            for index, page in enumerate(reader.pages):
                contents = page.get_contents()
                if contents is not None and len(contents.get_data()) > 5 * 1024 * 1024:
                    raise InputError("A PDF page exceeds the native extraction content limit.")
                text = page.extract_text() or ""
                add(text, {"page": index + 1, "label": f"PDF page {index + 1}"})
                if not text.strip():
                    warnings.append(f"PDF page {index + 1} has no native text; image interpretation/OCR remains unresolved.")
        except InputError:
            raise
        except Exception:
            raise InputError("PDF native text could not be parsed; preserve the source and use an explicit assisted workflow.") from None
    else:
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                entries = archive.infolist()
                if len(entries) > 1000 or sum(info.file_size for info in entries) > 30 * 1024 * 1024 or any(info.flag_bits & 1 for info in entries):
                    raise InputError("DOCX archive is encrypted or exceeds bounded extraction size.")
                if "word/document.xml" not in archive.namelist():
                    raise InputError("DOCX has no Word document part.")
                xml = archive.read("word/document.xml")
                if len(xml) > 5 * 1024 * 1024 or b"<!DOCTYPE" in xml.upper() or b"<!ENTITY" in xml.upper():
                    raise InputError("DOCX XML exceeds limits or contains unsupported entity declarations.")
                root = ElementTree.fromstring(xml)
                ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
                body = root.find("w:body", ns)
                if body is None:
                    raise InputError("DOCX has no document body.")

                def paragraph_text(paragraph):
                    pieces = []

                    def visit(node):
                        local_name = node.tag.rsplit("}", 1)[-1]
                        if local_name in ("drawing", "pict", "txbxContent", "del"):
                            return
                        if local_name == "t":
                            pieces.append(node.text or "")
                        elif local_name == "tab":
                            pieces.append("\t")
                        elif local_name in ("br", "cr"):
                            pieces.append("\n")
                        else:
                            for descendant in node:
                                visit(descendant)

                    visit(paragraph)
                    return "".join(pieces)

                paragraph_index = table_index = 0
                for child in body:
                    if child.tag == f"{{{ns['w']}}}p":
                        paragraph_index += 1
                        text = paragraph_text(child)
                        add(text, {"paragraph": paragraph_index, "label": f"DOCX paragraph {paragraph_index}"})
                    elif child.tag == f"{{{ns['w']}}}tbl":
                        table_index += 1
                        for row_index, row in enumerate(child.findall("w:tr", ns), 1):
                            for column_index, cell in enumerate(row.findall("w:tc", ns), 1):
                                text = "\n".join(paragraph_text(paragraph) for paragraph in cell.findall("w:p", ns))
                                add(text, {"table": table_index, "row": row_index, "column": column_index,
                                           "label": f"DOCX table {table_index}, row {row_index}, column {column_index}"})
                if any(name.startswith("word/media/") for name in archive.namelist()):
                    warnings.append("Embedded images are retained in the original DOCX but were not interpreted.")
                warnings.append("DOCX extraction covers native body paragraphs and direct table cells; drawings, headers, footnotes, nested tables, tracked deletions and text boxes require separate review.")
        except InputError:
            raise
        except (zipfile.BadZipFile, ElementTree.ParseError, KeyError, RuntimeError):
            raise InputError("DOCX native text could not be parsed.") from None
    warnings.append("Native text is a source reference only. Facts, entity associations, coordinates and legal claims require explicit review; document instructions were not executed.")
    return {"format": data["format"], "method": "native_parse", "status": "ready" if parts else "needs_input",
            "sourceSha256": hashlib.sha256(raw).hexdigest(), "parts": parts, "warnings": warnings, "characterCount": total_text}
