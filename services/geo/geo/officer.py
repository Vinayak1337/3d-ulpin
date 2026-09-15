"""Evidence-gated parcel differences and supported utility prism checks."""
from __future__ import annotations

import hashlib
import json
import math
import uuid

from shapely.geometry import LineString
from shapely.ops import unary_union

from .validation import InputError

ROLES = {"observed_ground_occupation", "observed_roof_projection", "approved_building_outline", "recorded_parcel",
         "public_road_land", "road_surface", "public_land", "physical_utility", "documented_restriction", "unknown"}
SUPPORTED_STATES = {"source_supported", "reviewed"}
METHOD = "officer-spatial-v1"
TOLERANCE_M = 1e-6
TOLERANCE_M2 = 1e-6
TOLERANCE_M3 = 1e-6


def _finite(value, name):
    try:
        finite = isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite:
        raise InputError(f"{name} requires a finite number.")
    return float(value)


def _evidenced(value):
    return isinstance(value, dict) and value.get("evidenceState") in SUPPORTED_STATES and _has_evidence(value.get("evidence"))


def _has_evidence(evidence):
    return isinstance(evidence, list) and bool(evidence) and all(isinstance(item, dict) and isinstance(item.get("sourceRevisionId"), str) and bool(item["sourceRevisionId"].strip()) for item in evidence)


def _role(row):
    semantics = row.get("semantics") or {}
    if not isinstance(semantics, dict):
        raise InputError("Feature semantics must be an explicitly typed object.")
    return semantics.get("geometryRole", "unknown")


def _geometry_evidenced(row):
    semantics = row.get("semantics") or {}
    return semantics.get("evidenceState") in SUPPORTED_STATES and _has_evidence(row.get("evidence"))


def resolve_utility_profile(row):
    """Use one centreline for display and checks; unsupported solid checks stay explicit."""
    profile = row.get("utilityProfile")
    if profile is None:
        return None
    if not isinstance(profile, dict):
        raise InputError("utilityProfile must be an object.")
    result = {key: value for key, value in profile.items() if key != "resolved"}
    geometry = row.get("geometry") or {}
    if geometry.get("type") != "LineString":
        result["unresolved"] = ["A utility profile requires one LineString segment; split multipart alignments into evidenced segments."]
        return result
    coordinates = geometry.get("coordinates", [])
    section = profile.get("crossSection")
    missing = []
    if not isinstance(section, dict) or section.get("shape") not in ("circular", "rectangular"):
        missing.append("Provide a declared circular diameter or rectangular cross section in metres.")
        radius = None
    elif section["shape"] == "circular":
        diameter = _finite(section.get("diameterM"), "Utility diameter")
        if not 0 < diameter <= 100:
            raise InputError("Utility diameter must be positive and no more than 100 metres.")
        radius = diameter / 2
    else:
        width, height = _finite(section.get("widthM"), "Utility width"), _finite(section.get("heightM"), "Utility height")
        if not 0 < width <= 100 or not 0 < height <= 100:
            raise InputError("Utility rectangular dimensions must be positive and no more than 100 metres.")
        radius = height / 2
    levels = profile.get("levels")
    if levels is None:
        missing.append("Provide supplied levels/depths for the utility segment.")
    elif not isinstance(levels, list) or not levels or len(levels) > 10_000:
        raise InputError("Utility levels must be a bounded array of finite metre values or null.")
    else:
        levels = [_finite(value, "Utility level") for value in levels]
    reference = profile.get("verticalReference")
    if not isinstance(reference, str) or not reference.strip():
        missing.append("Identify the utility's vertical datum/benchmark; ellipsoidal, surveyed and local references are not interchangeable.")
    meaning = profile.get("levelMeaning")
    if meaning not in ("centre", "invert", "crown", "depth_below_ground"):
        missing.append("Declare whether levels refer to centre, invert, crown or depth below ground.")
    interpolation = profile.get("interpolation")
    if interpolation not in ("per_vertex", "linear_endpoints"):
        missing.append("Declare per-vertex levels or explicit linear interpolation between supplied endpoints.")
    if missing:
        result["unresolved"] = missing
        return result
    if interpolation == "per_vertex":
        if len(levels) != len(coordinates):
            raise InputError("Per-vertex utility levels must match every alignment vertex.")
    else:
        if len(levels) != 2:
            raise InputError("Linear endpoint interpolation requires exactly two supplied levels.")
        distances = [0.0]
        for previous, current in zip(coordinates, coordinates[1:]):
            distances.append(distances[-1] + math.hypot(current[0] - previous[0], current[1] - previous[1]))
        if not distances[-1]:
            raise InputError("Utility alignment must have positive length.")
        levels = [levels[0] + distance / distances[-1] * (levels[1] - levels[0]) for distance in distances]
    if meaning == "depth_below_ground":
        ground = profile.get("groundLevels")
        if profile.get("groundReference") != reference or not isinstance(ground, list) or len(ground) != len(coordinates):
            result["unresolved"] = ["Depth requires an evidenced ground level at every alignment vertex in the same vertical reference."]
            return result
        if not _has_evidence(profile.get("groundEvidence")):
            result["unresolved"] = ["Bind the ground levels used for depth conversion to their source evidence."]
            return result
        if any(value < 0 for value in levels):
            raise InputError("Depth below ground must be nonnegative.")
        levels = [_finite(ground_value, "Ground elevation") - depth for ground_value, depth in zip(ground, levels)]
        meaning = profile.get("depthTo")
        if meaning not in ("centre", "invert", "crown"):
            result["unresolved"] = ["Declare whether measured depth terminates at the pipe centre, invert or crown."]
            return result
    centres = [value + radius if meaning == "invert" else value - radius if meaning == "crown" else value for value in levels]
    resolved = {"positions": [[point[0], point[1], z] for point, z in zip(coordinates, centres)],
                "method": f"{interpolation}; {profile['levelMeaning']} converted to centre using supplied cross section",
                "verticalReference": reference, "checkSupport": "display_only"}
    if section["shape"] == "rectangular" and max(centres) - min(centres) <= TOLERANCE_M:
        from .area import _json_geometry
        line = LineString(coordinates)
        # This is an explicitly modeled rectangular corridor with flat ends and
        # miter joins, not a circular-pipe volume or a legally assumed easement.
        footprint = line.buffer(section["widthM"] / 2, cap_style=2, join_style=2)
        resolved.update(checkSupport="exact_constant_rectangular_prism", footprint=_json_geometry(footprint),
                        lower=centres[0] - radius, upper=centres[0] + radius,
                        solidMeaning="Modeled constant rectangular corridor; flat ends and miter joins. No easement inferred.")
    else:
        resolved["limitation"] = "Circular or sloping profile is positioned for inspection only; an exact solid narrow-phase volume is not implemented."
    result["resolved"] = resolved
    result.pop("unresolved", None)
    return result


def resolve_profile_request(data):
    """Resolve a bound source profile for persistence or read-only older-record display."""
    from .area import MAX_FEATURES, MAX_VERTICES, _geometry, _text
    if not isinstance(data, dict) or ("feature" in data) == ("features" in data):
        raise InputError("Supply either one feature or a bounded features array for profile resolution.")
    batch = "features" in data
    features = data["features"] if batch else [data["feature"]]
    if not isinstance(features, list) or len(features) > MAX_FEATURES:
        raise InputError(f"Profile resolution supports at most {MAX_FEATURES} features.")
    profiles, identities, vertices = [], set(), 0
    for feature in features:
        if not isinstance(feature, dict) or feature.get("kind") != "utility" or not isinstance(feature.get("utilityProfile"), dict):
            raise InputError("Profile resolution requires utility features with their canonical source profiles.")
        _, count = _geometry(feature.get("geometry"), "Utility profile alignment")
        vertices += count
        if vertices > MAX_VERTICES:
            raise InputError(f"Profile resolution supports at most {MAX_VERTICES} total vertices.")
        identity = {key: _text(feature[key], f"Profile {key}") for key in ("id", "sourceKey") if key in feature}
        if batch:
            if not identity:
                raise InputError("Every batch profile needs an id or sourceKey.")
            key = ("id", identity["id"]) if "id" in identity else ("sourceKey", identity["sourceKey"])
            if key in identities:
                raise InputError("Batch profile identities must be unique.")
            identities.add(key)
        if _evidenced(feature["utilityProfile"]):
            profile = resolve_utility_profile(feature)
        else:
            profile = {key: value for key, value in feature["utilityProfile"].items() if key != "resolved"}
            profile["unresolved"] = ["Bind utility levels and cross-section values to their source evidence before resolving a stored profile."]
        profiles.append({**identity, "utilityProfile": profile})
    return {"profiles": profiles, "method": METHOD} if batch else {"utilityProfile": profiles[0]["utilityProfile"], "method": METHOD}


def _prism(row, geometry):
    extent = row.get("verticalExtent")
    profile = row.get("utilityProfile")
    if profile:
        profile = resolve_utility_profile(row)
        resolved = profile.get("resolved", {})
        if resolved.get("checkSupport") != "exact_constant_rectangular_prism" or not _evidenced(profile):
            return None
        from .area import _geometry
        geometry, _ = _geometry(resolved["footprint"], "Utility corridor footprint")
        extent = {"lower": resolved["lower"], "upper": resolved["upper"], "unit": "m",
                  "reference": profile["verticalReference"], "evidenceState": profile["evidenceState"], "evidence": profile["evidence"]}
    if extent is None:
        return None
    if not isinstance(extent, dict):
        raise InputError("verticalExtent requires an explicit prism profile.")
    lower, upper = _finite(extent.get("lower"), "Prism lower"), _finite(extent.get("upper"), "Prism upper")
    if upper <= lower or abs(lower) > 20_000 or abs(upper) > 20_000 or extent.get("unit") != "m":
        raise InputError("Prism bounds must increase, use metres and remain within ±20,000 metres.")
    if geometry.geom_type not in ("Polygon", "MultiPolygon") or not _evidenced(extent):
        return None
    reference = extent.get("reference")
    if not isinstance(reference, str) or not reference.strip() or reference.startswith("building-relative"):
        return None
    return geometry, lower, upper, reference, extent["evidence"]


def officer_checks(data, rows, shapes):
    from .area import _json_geometry, MAX_PAIRS
    findings, questions, quantities = [], [], []
    by_id = {row["id"]: index for index, row in enumerate(rows)}
    associations = data.get("associations", [])
    if not isinstance(associations, list) or len(associations) > 4000:
        raise InputError("At most 4,000 explicit property associations are supported per check.")
    for association in associations:
        if not isinstance(association, dict) or association.get("status") not in ("confirmed", "candidate", "suggested", "rejected"):
            raise InputError("Property associations require confirmed, candidate or rejected status.")
    pair_count = 0

    def emit(code, message, indices, result=None, category="geometric", **extra):
        participants = sorted({rows[index]["id"] for index in indices})
        inputs = [{"featureId": rows[index]["id"], "revision": rows[index].get("revision"),
                   "sourceRevisionId": rows[index].get("sourceRevisionId"), "geometryRole": _role(rows[index]),
                   "sourceDate": (rows[index].get("semantics") or {}).get("sourceDate"),
                   "worldStatus": rows[index].get("worldStatus", "observed")} for index in sorted(set(indices))]
        entry = {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{METHOD}:{code}:{':'.join(participants)}")),
                 "category": category, "code": code, "message": message, "featureIds": participants,
                 "method": METHOD, "inputs": inputs, "confidenceBasis": "Deterministic geometry of supplied, explicitly interpreted source representations; not independent survey certification.",
                 "numericalTolerance": {"lengthM": TOLERANCE_M, "areaM2": TOLERANCE_M2, "volumeM3": TOLERANCE_M3}, **extra}
        if result is not None and not result.is_empty:
            entry["geometry"] = _json_geometry(result)
            entry.setdefault("areaM2", result.area)
            if result.geom_type in ("LineString", "MultiLineString"):
                entry["lengthM"] = result.length
        evidence = [item for index in indices for item in rows[index].get("evidence", [])]
        entry["evidence"] = list({json.dumps(item, sort_keys=True): item for item in evidence}.values())
        findings.append(entry)
        return entry

    def request(code, message, indices, property_name):
        finding = emit(code, message, indices, category="coverage", requiredEvidence=property_name)
        questions.append({"id": finding["id"], "featureIds": finding["featureIds"], "property": property_name, "message": message})

    public_indices = [i for i, row in enumerate(rows) if _role(row) in ("public_road_land", "public_land", "road_surface")]
    for index, row in enumerate(rows):
        role = _role(row)
        if role not in ROLES:
            raise InputError("Unsupported geometryRole; retain unknown semantics until reviewed.")
        if role not in ("observed_ground_occupation", "observed_roof_projection", "approved_building_outline"):
            continue
        if role != "observed_ground_occupation":
            continue  # A roof crossing must never be presented as ground occupation.
        occupation = shapes[index]
        if occupation.geom_type not in ("Polygon", "MultiPolygon"):
            request("OCCUPATION_AREA_REQUIRED", "Provide a closed polygon for ground occupation; a line/point cannot establish occupation area.", [index], "groundOccupation.polygon")
            continue
        if not _geometry_evidenced(row):
            request("OCCUPATION_EVIDENCE_REQUIRED", "Confirm this outline's ground-occupation meaning and source evidence before a parcel discrepancy check.", [index], "groundOccupation.geometryRole")
            continue
        relevant = [link for link in associations if link.get("buildingId") == row["id"] and link["status"] == "confirmed"]
        confirmed = []
        invalid = []
        for link in relevant:
            parcel_index = by_id.get(link.get("parcelId"))
            stale = link.get("fromRevision") is not None and link["fromRevision"] != row.get("revision") or parcel_index is not None and link.get("toRevision") is not None and link["toRevision"] != rows[parcel_index].get("revision")
            if parcel_index is None or _role(rows[parcel_index]) != "recorded_parcel" or not _geometry_evidenced(rows[parcel_index]) or not _has_evidence(link.get("evidence")) or stale:
                invalid.append(link)
            else:
                confirmed.append(parcel_index)
        if invalid or not confirmed:
            request("PARCEL_ASSOCIATION_REQUIRED", "Provide an evidenced, confirmed recorded-parcel association and its current boundary. Nearby parcels are not substituted.", [index], "confirmedParcelAssociation")
            outside = None
        else:
            confirmed = sorted(set(confirmed))
            parcel_union = unary_union([shapes[i] for i in confirmed])
            outside = occupation.difference(parcel_union)
            summary = {"featureId": row["id"], "occupationAreaM2": occupation.area, "parcelUnionAreaM2": parcel_union.area,
                       "outsideAreaM2": outside.area, "parcelIds": [rows[i]["id"] for i in confirmed]}
            quantities.append(summary)
            if outside.area > TOLERANCE_M2:
                extra = {"quantities": summary, "areaM2": outside.area,
                         "associationInputs": [{key: link.get(key) for key in ("id", "revision", "fromRevision", "toRevision", "buildingId", "parcelId", "evidence")} for link in relevant]}
                contact = outside.boundary.intersection(parcel_union.boundary)
                if outside.geom_type == "Polygon" and not outside.interiors and outside.equals(outside.minimum_rotated_rectangle) and contact.geom_type == "LineString" and contact.length > TOLERANCE_M:
                    extra["extensionM"] = outside.area / contact.length
                    extra["extensionMethod"] = "Rectangular outside strip area divided by its single straight shared parcel-boundary edge."
                uncertainties = [(rows[i].get("semantics") or {}).get("horizontalUncertaintyM") for i in [index] + confirmed]
                known = [value for value in uncertainties if value is not None]
                if any(_finite(value, "Horizontal uncertainty") < 0 for value in known):
                    raise InputError("Horizontal uncertainty cannot be negative.")
                if known:
                    uncertain = occupation.boundary.buffer(sum(known)).union(parcel_union.boundary.buffer(sum(known)))
                    extra["withinDeclaredUncertainty"] = outside.difference(uncertain).area <= TOLERANCE_M2
                extra["measurementUncertainty"] = "Unspecified" if len(known) != len(uncertainties) else "Declared source uncertainty; independent of numerical tolerance"
                emit("OUTSIDE_CONFIRMED_PARCEL", "Ground occupation extends outside the union of explicitly associated recorded parcels. This is a geometric discrepancy requiring evidence review, not a legal conclusion.", [index] + confirmed, outside, **extra)
        layer_results, outside_results, participants = [], [], []
        for other_index in public_indices:
            pair_count += 1
            if pair_count > MAX_PAIRS:
                raise InputError("Officer check exceeds the bounded candidate-pair limit; split the area.")
            public = shapes[other_index]
            if not occupation.intersects(public):
                continue
            if public.geom_type not in ("Polygon", "MultiPolygon"):
                request("PUBLIC_CONTEXT_AREA_REQUIRED", "The supplied public context is a line/point, not a land-area boundary. Supply its evidenced polygon; no assumed buffer or reserve width is applied.", [index, other_index], "publicContext.polygon")
                continue
            if not _geometry_evidenced(rows[other_index]):
                request("PUBLIC_CONTEXT_EVIDENCE_REQUIRED", "The intersecting public-context boundary lacks confirmed source semantics; supply its meaning and evidence.", [index, other_index], "publicContext.geometryRole")
                continue
            overlap = occupation.intersection(public)
            public_role = _role(rows[other_index])
            participants.append(other_index)
            if overlap.area <= TOLERANCE_M2:
                emit("PUBLIC_BOUNDARY_CONTACT", "Ground occupation contacts the public-context boundary without positive-area overlap.", [index, other_index], overlap, areaM2=0.0)
                continue
            layer_results.append(overlap)
            extra = {"publicRole": public_role, "areaM2": overlap.area}
            if outside is not None:
                outside_part = outside.intersection(public)
                extra.update(outsideAreaM2=outside_part.area, outsideGeometry=_json_geometry(outside_part) if not outside_part.is_empty else None)
                if outside_part.area > TOLERANCE_M2:
                    outside_results.append(outside_part)
            emit("OCCUPATION_PUBLIC_CONTEXT_OVERLAP", "Ground occupation intersects this supplied public-context layer. Road surface and road land remain distinct meanings.", [index, other_index], overlap, **extra)
        if layer_results:
            unique = unary_union(layer_results)
            unique_outside = unary_union(outside_results) if outside_results else None
            emit("PUBLIC_CONTEXT_UNIQUE_UNION", "Unique overlap with the union of supplied public-context layers; per-layer quantities may overlap and must not be summed as a unique total.", [index] + participants, unique,
                 areaM2=unique.area, outsideAreaM2=unique_outside.area if unique_outside is not None else 0 if outside is not None else None,
                 outsideGeometry=_json_geometry(unique_outside) if unique_outside is not None else None)

    comparisons = data.get("representationComparisons", [])
    if not isinstance(comparisons, list) or len(comparisons) > 2000:
        raise InputError("At most 2000 explicit representation comparisons are supported.")
    for comparison in comparisons:
        if not isinstance(comparison, dict):
            raise InputError("Representation comparison must be an evidenced object.")
        observed_index, approved_index = by_id.get(comparison.get("observedId")), by_id.get(comparison.get("approvedId"))
        if observed_index is None or approved_index is None:
            raise InputError("Representation comparison references a missing snapshot feature.")
        observed, approved = rows[observed_index], rows[approved_index]
        observed_level, approved_level = (observed.get("semantics") or {}).get("levelReference"), (approved.get("semantics") or {}).get("levelReference")
        if comparison.get("status") != "confirmed" or not _has_evidence(comparison.get("evidence")) or _role(observed) != "observed_ground_occupation" or _role(approved) != "approved_building_outline" or not observed_level or observed_level != approved_level or not _geometry_evidenced(observed) or not _geometry_evidenced(approved):
            request("APPROVED_COMPARISON_EVIDENCE_REQUIRED", "Confirm the approved/observed relationship, geometry roles and identical level meaning before comparing outlines. Roof projections are not ground occupation.", [observed_index, approved_index], "compatibleApprovedObservedRepresentations")
            continue
        difference = shapes[observed_index].difference(shapes[approved_index])
        if difference.area > TOLERANCE_M2:
            emit("OUTSIDE_APPROVED_OUTLINE", "Observed ground occupation extends beyond the explicitly linked approved outline at the same declared level. Review the source dates and approval scope.", [observed_index, approved_index], difference,
                 levelReference=observed_level, comparisonEvidence=comparison["evidence"])

    vertical_resolved_pairs = set()
    prisms = [_prism(row, geometry) for row, geometry in zip(rows, shapes)]
    for index, row in enumerate(rows):
        if row.get("kind") != "building":
            continue
        for other_index, other in enumerate(rows):
            if other.get("kind") != "utility":
                continue
            first, second = prisms[index], prisms[other_index]
            first_xy, second_xy = first[0] if first else shapes[index], second[0] if second else shapes[other_index]
            if not first_xy.intersects(second_xy):
                continue
            pair_count += 1
            if pair_count > MAX_PAIRS:
                raise InputError("Officer check exceeds the bounded candidate-pair limit; split the area.")
            if _role(other) == "documented_restriction":
                emit("RESTRICTION_GEOMETRY_INTERSECTION", "The supplied restriction geometry intersects the building horizontally. This is not a physical utility collision, and no universal clearance or legal rule has been assumed.", [index, other_index], first_xy.intersection(second_xy))
                request("RESTRICTION_RULE_EVIDENCE_REQUIRED", "Provide the restriction's applicable rule, authority, valid scope and evidence before determining a restriction violation.", [index, other_index], "documentedRestriction.applicableRule")
                continue
            if _role(other) != "physical_utility":
                request("UTILITY_SEMANTICS_REQUIRED", "Confirm whether the supplied utility geometry describes a physical asset or a documented restriction before physical collision analysis.", [index, other_index], "utility.geometryRole")
                continue
            if first is None or second is None:
                request("UTILITY_PROFILE_EVIDENCE_REQUIRED", "Provide source-backed basement/foundation bounds, utility cross section and level meanings in an aligned vertical reference. Horizontal intersection alone is insufficient for a physical collision.", [index, other_index], "supportedUtilityAndBuildingPrisms")
                continue
            if first[3] != second[3]:
                request("VERTICAL_REFERENCE_MISMATCH", "The building and utility vertical references differ; an evidenced transformation is required before collision analysis.", [index, other_index], "verticalReferenceTransformation")
                continue
            vertical_resolved_pairs.add(tuple(sorted((row["id"], other["id"]))))
            intersection = first[0].intersection(second[0])
            lower, upper = max(first[1], second[1]), min(first[2], second[2])
            height = max(0.0, upper - lower)
            volume = intersection.area * height
            kwargs = {"volumeM3": volume, "verticalReference": first[3], "verticalInterval": [lower, upper] if upper >= lower else None,
                      "solidMethod": "Exact polygon intersection × overlapping constant vertical interval; Polygon holes and MultiPolygon parts retained."}
            if volume > TOLERANCE_M3:
                emit("SUPPORTED_UTILITY_PRISM_COLLISION", "The supplied, vertically aligned constant-prism representations intersect. This is a supported geometric collision, not an easement or legal determination.", [index, other_index], intersection, **kwargs)
            elif upper >= lower - TOLERANCE_M and not intersection.is_empty:
                emit("UTILITY_PRISM_CONTACT", "Supported utility/building prisms have boundary-only contact; collision volume is zero.", [index, other_index], intersection, **kwargs)
            else:
                emit("UTILITY_PRISM_SEPARATED", "Supplied utility/building prisms are vertically separated; collision volume is zero.", [index, other_index], intersection, **kwargs)
    return {"findings": findings, "questions": questions, "quantities": quantities, "verticalResolvedPairs": vertical_resolved_pairs,
            "method": METHOD, "inputFingerprint": hashlib.sha256(json.dumps(data, sort_keys=True, allow_nan=False, separators=(",", ":")).encode()).hexdigest()}
