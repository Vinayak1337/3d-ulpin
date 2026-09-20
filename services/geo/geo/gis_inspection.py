"""Read-only preflight. Reuses ingestion's bounded native readers and geometry guards."""
import hashlib
import json
import math
import re

from .native_gis import _raw, _gpkg, _shapefile
from .validation import InputError


def _eligible_ids(values):
    return bool(values and all(isinstance(value, (str, int, float)) and not isinstance(value, bool) and (not isinstance(value, float) or math.isfinite(value)) and str(value).strip() and len(str(value)) <= 256 for value in values) and len({str(value).strip() for value in values}) == len(values))


def _fields(rows):
    names = sorted({name for row in rows for name in row})
    if len(names) > 256:
        raise InputError("GIS inspection supports at most 256 attribute fields.")
    fields = []
    for name in names:
        values = [row.get(name) for row in rows]
        scalar = all(value is None or isinstance(value, (str, int, float, bool)) and (not isinstance(value, float) or math.isfinite(value)) for value in values)
        complete = scalar and all(value is not None and str(value).strip() for value in values)
        normalized = [str(value).strip() for value in values] if scalar else []
        unique = bool(complete and len(set(normalized)) == len(rows))
        id_eligible = bool(len(name) <= 80 and name.strip() == name and _eligible_ids(values))
        fields.append({"name": name, "complete": bool(complete), "unique": unique, "idEligible": id_eligible})
    ids = [field["name"] for field in fields if field["idEligible"] and (field["name"].lower() in ("id", "fid", "oid", "objectid", "globalid") or field["name"].lower().endswith("_id") or re.search(r"[a-z0-9](?:Id|ID)$", field["name"]))]
    labels = [field["name"] for field in fields if field["complete"] and len(field["name"]) <= 80 and re.search(r"(^|_)(name|title|label)$", field["name"], re.I) and all(isinstance(row.get(field["name"]), str) and len(row[field["name"]]) <= 2048 for row in rows)]
    return fields, ids[0] if len(ids) == 1 else None, labels[0] if len(labels) == 1 else None


def inspect_gis(data):
    from .area import _geometry, _arcgis_geometry, _spatial_reference, MAX_FEATURES, MAX_VERTICES
    raw = _raw(data)
    layer = data.get("layer") or None
    if layer is not None and (not isinstance(layer, str) or len(layer) > 256):
        raise InputError("Select a valid layer name.")
    base = {"sourceSha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw), "featureIdEligible": False}
    if raw.startswith(b"SQLite format 3\x00") or raw.startswith(b"PK"):
        format = "gpkg" if raw.startswith(b"SQLite format 3\x00") else "shapefile_zip"
        result = (_gpkg if format == "gpkg" else _shapefile)(raw, layer, None)
        base.update({"format": format, "layers": result["layers"], "layer": result.get("layer"), "sourceCrs": None, "crsEvidence": None, "featureCount": None, "geometryTypes": [], "fields": [], "suggestedIdField": None, "suggestedNameField": None})
        if "features" not in result:
            return base
        rows = [feature["attributes"] for feature in result["features"]]
        base.update({"sourceCrs": f'EPSG:{result["epsg"]}', "crsEvidence": "GeoPackage spatial reference" if format == "gpkg" else "Shapefile .prj companion", "geometryTypes": sorted({geometry["type"] for geometry in result["geometries"]})})
    else:
        try:
            source = json.loads(raw.decode("utf-8-sig"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        except (UnicodeError, ValueError, RecursionError):
            raise InputError("Choose a valid GeoJSON, ArcGIS JSON, GeoPackage or Shapefile ZIP source.") from None
        if not isinstance(source, dict) or not isinstance(source.get("features"), list):
            raise InputError("GIS JSON requires a complete feature collection.")
        format = "geojson" if source.get("type") == "FeatureCollection" else "arcgis"
        if format == "geojson":
            if "crs" in source and source["crs"] != {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}}:
                raise InputError("Projected or unknown GeoJSON CRS overrides are unsupported; use a native GIS source with declared CRS.")
            crs = "EPSG:4326"
            evidence = "Declared OGC CRS84" if "crs" in source else "RFC 7946 GeoJSON longitude/latitude"
        else:
            if source.get("exceededTransferLimit") or source.get("hasZ") or source.get("hasM"):
                raise InputError("ArcGIS source must be a complete, strictly 2D feature set.")
            crs = _spatial_reference(source["spatialReference"]).to_string() if source.get("spatialReference") is not None else None
            evidence = "ArcGIS spatialReference" if crs else None
        features = source["features"]
        if format == "geojson":
            base["featureIdEligible"] = _eligible_ids([feature.get("id") if isinstance(feature, dict) else None for feature in features])
        if not 1 <= len(features) <= MAX_FEATURES:
            raise InputError("Choose a complete layer with 1–2000 features.")
        rows, types, vertices, row_crs = [], set(), 0, []
        for feature in features:
            if not isinstance(feature, dict) or "crs" in feature or format == "geojson" and feature.get("type") != "Feature":
                raise InputError("Each source entry must be a valid feature without a CRS override.")
            attributes = feature.get("properties" if format == "geojson" else "attributes") or {}
            if not isinstance(attributes, dict):
                raise InputError("Feature fields must be an object.")
            # Reject nonfinite JSON numbers (including overflowing exponent notation).
            try:
                json.dumps(attributes, allow_nan=False)
            except (ValueError, TypeError):
                raise InputError("Source fields must contain finite JSON values.") from None
            geometry = feature.get("geometry")
            if format == "arcgis":
                declared = geometry.get("spatialReference") if isinstance(geometry, dict) else None
                row_crs.append(_spatial_reference(declared).to_string() if declared is not None else None)
                geometry = _arcgis_geometry(geometry)
            parsed, count = _geometry(geometry, "Source feature", geographic=format == "geojson")
            vertices += count
            if vertices > MAX_VERTICES:
                raise InputError("GIS layer exceeds 100,000 vertices.")
            types.add(parsed.geom_type)
            rows.append(attributes)
        declared = {value for value in [crs, *row_crs] if value}
        if len(declared) > 1:
            raise InputError("Source coordinate reference declarations conflict; separate or correct the layers.")
        if format == "arcgis" and not crs and row_crs and all(row_crs):
            crs, evidence = row_crs[0], "Consistent ArcGIS feature spatial references"
        base.update({"format": format, "layers": [], "layer": None, "sourceCrs": crs, "crsEvidence": evidence, "geometryTypes": sorted(types)})
    fields, id_field, name_field = _fields(rows)
    return {**base, "featureCount": len(rows), "fields": fields, "suggestedIdField": id_field, "suggestedNameField": name_field}
