"""Strict native level schedules propose typed facts with exact row/cell locators."""
import csv
import io
import math

from shapely import from_wkt

from .validation import InputError


def extract_schedule(raw):
    from .area import _geometry, _json_geometry
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise InputError("CSV schedule must be UTF-8.") from None
    if len(text) > 250_000 or "\x00" in text:
        raise InputError("CSV schedule exceeds 250,000 text characters or contains binary null bytes.")
    reader = csv.DictReader(io.StringIO(text), strict=True)
    header = reader.fieldnames
    allowed = {"alias", "label", "level", "lower", "upper", "unit", "benchmark", "method", "footprint_wkt", "frame"}
    if not header or len(header) != len(set(header)) or not set(header).issubset(allowed) or not {"alias", "lower", "upper", "unit", "benchmark"}.issubset(header):
        raise InputError("Native level CSV requires unique alias,lower,upper,unit,benchmark columns; optional label,level,method,footprint_wkt,frame. Unrecognized schemas require explicit mapping.")
    parts, candidates, questions, aliases = [], [], [], set()
    try:
        for index, row in enumerate(reader):
            row_number = index + 2
            if index >= 2000 or None in row or any(value is None for value in row.values()):
                raise InputError("CSV schedule exceeds 2000 rows or a row does not match its header.")
            if not any(value.strip() for value in row.values()):
                continue
            alias = row["alias"].strip()
            if not alias or len(alias) > 150 or alias in aliases:
                raise InputError("CSV aliases must be nonempty, unique and at most 150 characters.")
            aliases.add(alias)
            unit, benchmark = row["unit"].strip(), row["benchmark"].strip()
            if unit not in ("m", "ft") or not benchmark:
                raise InputError(f"CSV row {row_number} requires explicit m/ft units and a vertical benchmark.")
            part_index = len(parts)
            part_id = f"part-{part_index + 1}"
            parts.append({"id": part_id, "text": "\n".join(f"{key}: {row[key]}" for key in header), "locator": {"row": row_number, "label": f"CSV row {row_number}"}})

            def candidate(property_name, value, column, reference=benchmark, units=None):
                result = {"subject": alias, "property": property_name, "value": value, "referenceFrameId": reference,
                          "partIndex": part_index, "partId": part_id, "locator": {"row": row_number, "column": header.index(column) + 1, "label": f"CSV row {row_number}, column {column}"},
                          "method": "native_parse", "evidenceState": "source_supported"}
                if units:
                    result["unit"] = units
                candidates.append(result)

            bounds = {}
            for column in ("lower", "upper"):
                raw_value = row[column].strip()
                if not raw_value:
                    questions.append({"subject": alias, "property": f"space.{column}", "message": f"Provide the missing {column} level for {alias} in benchmark {benchmark}.", "partIndex": part_index})
                    continue
                try:
                    value = float(raw_value)
                except ValueError:
                    raise InputError(f"CSV row {row_number} {column} must be numeric or empty.") from None
                if not math.isfinite(value) or abs(value) > 20_000:
                    raise InputError(f"CSV row {row_number} {column} must be finite and within ±20,000 source units.")
                value *= 0.3048 if unit == "ft" else 1
                bounds[column] = value
                candidate(f"space.{column}", value, column, units="m")
            if len(bounds) == 2 and bounds["upper"] <= bounds["lower"]:
                raise InputError(f"CSV row {row_number} upper level must be above lower level.")
            for column, property_name in (("label", "space.label"), ("level", "space.levelLabel")):
                if row.get(column, "").strip():
                    candidate(property_name, row[column].strip(), column)
            if row.get("footprint_wkt", "").strip():
                frame = row.get("frame", "").strip()
                if not frame:
                    raise InputError("CSV footprint WKT requires an explicit named local metre frame; no geographic placement is inferred.")
                try:
                    geometry = _json_geometry(from_wkt(row["footprint_wkt"]))
                    parsed, _ = _geometry(geometry, "CSV footprint")
                    if parsed.geom_type not in ("Polygon", "MultiPolygon"):
                        raise InputError("CSV footprint must be Polygon or MultiPolygon.")
                except InputError:
                    raise
                except Exception:
                    raise InputError(f"CSV row {row_number} footprint WKT is invalid.") from None
                if unit != "m":
                    raise InputError("CSV footprint WKT currently requires explicit local metre coordinates; separate vertical feet schedules from geometry.")
                candidate("space.footprint", geometry, "footprint_wkt", reference=frame, units="m")
    except csv.Error:
        raise InputError("CSV schedule could not be parsed without ambiguity.") from None
    if not parts:
        raise InputError("CSV level schedule contains no data rows.")
    return {"parts": parts, "candidates": candidates, "questions": questions, "characterCount": len(text),
            "status": "needs_input" if questions else "ready", "warnings": ["Strict native level-schedule candidates require explicit building/space association and review. A benchmark string does not place local footprints in a geographic area."]}
