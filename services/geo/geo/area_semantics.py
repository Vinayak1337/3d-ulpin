"""Typed source mappings; source status, geometry meaning and height are independent."""
from __future__ import annotations

import copy
from datetime import date, datetime

from .officer import ROLES, resolve_utility_profile
from .validation import InputError

FIELD_KEYS = ("geometryRoleField", "floorCountField", "approvalStatusField", "sourceDateField", "validFromField", "validToField", "horizontalUncertaintyField", "worldStatusField")
UTILITY_FIELDS = ("assetIdField", "utilityTypeField", "operatorField", "startLevelField", "endLevelField", "levelsField", "groundStartField", "groundEndField", "diameterField", "widthField", "heightField")


def selected_semantic_fields(mapping):
    from .area import _text
    result = []
    for key in FIELD_KEYS:
        if mapping.get(key) is not None:
            result.append(_text(mapping[key], key))
    for name, keys in (("utility", UTILITY_FIELDS), ("verticalExtent", ("lowerField", "upperField"))):
        configuration = mapping.get(name)
        if configuration is not None:
            if not isinstance(configuration, dict):
                raise InputError(f"{name} mapping must be an object.")
            for key in keys:
                if configuration.get(key) is not None:
                    result.append(_text(configuration[key], key))
    return result


def mapped_semantics(mapping, properties, warnings, source_key):
    from .area import _number, _text, WORLD_STATES

    def value(key, configuration=mapping):
        field = configuration.get(key)
        return properties.get(field) if field else None

    def numeric(raw, label, unit="m"):
        if raw is None or raw == "":
            return None
        try:
            converted = float(raw) if isinstance(raw, str) else _number(raw, label)
        except (ValueError, TypeError):
            raise InputError(f"{label} must be a finite numeric source value.") from None
        converted = _number(converted, label)
        if unit not in ("m", "ft"):
            raise InputError(f"{label} units must be explicitly m or ft.")
        return converted * (0.3048 if unit == "ft" else 1)

    role = mapping.get("geometryRole", "unknown")
    if mapping.get("geometryRoleField"):
        choices = mapping.get("roleValues")
        if not isinstance(choices, dict) or len(choices) > 100 or any(role not in ROLES for role in choices.values()):
            raise InputError("roleValues must map at most 100 explicit source values to known geometry roles.")
        role = choices.get(str(value("geometryRoleField")), "unknown")
    if role not in ROLES:
        raise InputError("geometryRole must explicitly identify a supported source meaning or unknown.")
    result = {"geometryRole": role, "evidenceState": "source_supported" if role != "unknown" else "unresolved"}
    if mapping.get("levelReference"):
        result["levelReference"] = _text(mapping["levelReference"], "levelReference")
    floor_count = numeric(value("floorCountField"), "Floor count")
    if floor_count is not None:
        if floor_count < 0 or floor_count > 300 or floor_count != int(floor_count):
            raise InputError("Floor count must be an integer from 0 to 300; it is not a measured height.")
        result["floorCount"] = int(floor_count)
    if value("approvalStatusField") is not None:
        result["approvalStatus"] = _text(str(value("approvalStatusField")), "Approval/source status", 500)
    for field, name in (("sourceDateField", "sourceDate"), ("validFromField", "validFrom"), ("validToField", "validTo")):
        raw = value(field)
        if raw not in (None, ""):
            if not isinstance(raw, str):
                raise InputError(f"{name} must be an ISO date or date-time; source epoch units must be explicitly converted.")
            try:
                datetime.fromisoformat(raw.replace("Z", "+00:00")) if "T" in raw else date.fromisoformat(raw)
            except ValueError:
                raise InputError(f"{name} must be a valid ISO date/date-time.") from None
            result[name] = raw
    if result.get("validFrom") and result.get("validTo") and result["validFrom"] > result["validTo"]:
        raise InputError("Feature validity start follows its end.")
    uncertainty = numeric(value("horizontalUncertaintyField"), "Horizontal uncertainty", mapping.get("horizontalUncertaintyUnit", "m"))
    if uncertainty is not None:
        if not 0 <= uncertainty <= 1000:
            raise InputError("Horizontal uncertainty must be from zero to 1000 metres.")
        result["horizontalUncertaintyM"] = uncertainty
    output = {"semantics": result, "geometryRole": role}
    if mapping.get("worldStatusField"):
        choices = mapping.get("worldStatusValues")
        if not isinstance(choices, dict) or len(choices) > 100 or any(status not in WORLD_STATES for status in choices.values()):
            raise InputError("worldStatusValues must explicitly map source statuses to observed/planned/hypothetical/synthetic.")
        status = choices.get(str(value("worldStatusField")))
        if status not in WORLD_STATES:
            raise InputError(f"{source_key}: the source status has no explicit worldStatus mapping.")
        output["worldStatus"] = status
    if mapping.get("utilityProfile") is not None:
        if not isinstance(mapping["utilityProfile"], dict):
            raise InputError("utilityProfile mapping requires an explicit canonical profile.")
        output["utilityProfile"] = copy.deepcopy(mapping["utilityProfile"])
        output["utilityProfile"].pop("resolved", None)
    elif mapping.get("utility"):
        configuration = mapping["utility"]
        unit = configuration.get("levelUnit")
        start, end = numeric(value("startLevelField", configuration), "Utility start level", unit), numeric(value("endLevelField", configuration), "Utility end level", unit)
        levels = [start, end] if start is not None and end is not None else None
        if configuration.get("levelsField"):
            raw = value("levelsField", configuration)
            if raw is not None:
                if not isinstance(raw, list):
                    raise InputError("A per-vertex level field must be an array of finite numbers, not an opaque text value.")
                levels = [numeric(item, "Utility vertex level", unit) for item in raw]
                if any(item is None for item in levels):
                    raise InputError("Per-vertex utility levels cannot silently omit unknown intermediate levels.")
        profile = {"levels": levels, "levelMeaning": configuration.get("levelMeaning"), "verticalReference": configuration.get("verticalReference"),
                   "interpolation": configuration.get("interpolation", "linear_endpoints"), "evidenceState": "source_supported", "evidence": []}
        for field, name in (("assetIdField", "assetId"), ("utilityTypeField", "utilityType"), ("operatorField", "operator")):
            if value(field, configuration) is not None:
                profile[name] = _text(str(value(field, configuration)), name, 500)
        dimension_unit = configuration.get("dimensionUnit")
        section = configuration.get("crossSection")
        if section == "circular":
            diameter = numeric(value("diameterField", configuration), "Utility diameter", dimension_unit)
            if diameter is not None:
                profile["crossSection"] = {"shape": "circular", "diameterM": diameter}
        elif section == "rectangular":
            width, height = numeric(value("widthField", configuration), "Utility width", dimension_unit), numeric(value("heightField", configuration), "Utility height", dimension_unit)
            if width is not None and height is not None:
                profile["crossSection"] = {"shape": "rectangular", "widthM": width, "heightM": height}
        elif section is not None:
            raise InputError("Utility crossSection mapping must be circular or rectangular.")
        if configuration.get("depthTo"):
            profile["depthTo"] = configuration["depthTo"]
        if configuration.get("groundReference"):
            profile["groundReference"] = configuration["groundReference"]
        ground_start, ground_end = numeric(value("groundStartField", configuration), "Ground start level", unit), numeric(value("groundEndField", configuration), "Ground end level", unit)
        if ground_start is not None and ground_end is not None:
            profile["groundLevels"] = [ground_start, ground_end]
        if result.get("sourceDate"):
            profile["sourceDate"] = result["sourceDate"]
        output["utilityProfile"] = profile
    if mapping.get("verticalExtent"):
        configuration = mapping["verticalExtent"]
        lower, upper = numeric(value("lowerField", configuration), "Prism lower", configuration.get("unit")), numeric(value("upperField", configuration), "Prism upper", configuration.get("unit"))
        if lower is not None and upper is not None:
            if lower >= upper:
                raise InputError("Source prism lower bound must be below its upper bound.")
            output["verticalExtent"] = {"lower": lower, "upper": upper, "unit": "m", "reference": configuration.get("reference"), "evidenceState": "source_supported", "evidence": []}
        else:
            warnings.append(f"{source_key}: missing source lower/upper elevation; no vertical prism was constructed.")
    return output
