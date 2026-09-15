"""Independently specified G01–G07/V01–V04 synthetic acceptance fixtures."""
import base64
import copy

import pytest
from shapely.geometry import shape

from geo.area import check_area, extract_document, normalize_area
from geo.officer import resolve_profile_request, resolve_utility_profile
from geo.validation import InputError
from test_area import REFERENCE, arcgis, polygon, ring


EVIDENCE = [{"sourceRevisionId": "synthetic-fixture-r1", "featureId": "authored-test-feature"}]


def feature(identity, role, geometry=None, kind="building"):
    return {"id": identity, "kind": kind, "geometry": geometry or polygon(), "worldStatus": "synthetic", "revision": 1,
            "sourceRevisionId": "synthetic-fixture-r1", "evidence": copy.deepcopy(EVIDENCE),
            "semantics": {"geometryRole": role, "evidenceState": "source_supported", "sourceDate": "2026-09-14"}}


def association(building="O", parcel="P", status="confirmed"):
    return {"id": f"{building}-{parcel}", "buildingId": building, "parcelId": parcel, "status": status, "revision": 1, "evidence": copy.deepcopy(EVIDENCE)}


def checked(features, associations=None):
    return check_area({"features": features, "reference": REFERENCE, "associations": associations or []})


def finding(result, code):
    return next(item for item in result["findings"] if item["code"] == code)


def test_g01_exact_outside_strip_road_overlap_and_extension():
    result = checked([feature("O", "observed_ground_occupation", polygon(0, 0, 12, 10)),
                      feature("P", "recorded_parcel", kind="parcel"),
                      feature("R", "public_road_land", polygon(10, -5, 6, 20), "road")], [association()])
    outside = finding(result, "OUTSIDE_CONFIRMED_PARCEL")
    assert outside["areaM2"] == 20
    assert outside["extensionM"] == 2
    assert shape(outside["geometry"]).equals(shape(polygon(10, 0, 2, 10)))
    assert outside["quantities"]["occupationAreaM2"] == 120
    assert outside["quantities"]["parcelUnionAreaM2"] == 100
    public = finding(result, "OCCUPATION_PUBLIC_CONTEXT_OVERLAP")
    assert public["areaM2"] == public["outsideAreaM2"] == 20
    assert outside["inputs"][0]["sourceRevisionId"] == "synthetic-fixture-r1"
    assert all(item["worldStatus"] == "synthetic" for item in outside["inputs"])


def test_g02_equal_total_area_translated_produces_ten_square_metres_outside():
    result = checked([feature("O", "observed_ground_occupation", polygon(1, 0)), feature("P", "recorded_parcel", kind="parcel")], [association()])
    outside = finding(result, "OUTSIDE_CONFIRMED_PARCEL")
    assert outside["quantities"]["occupationAreaM2"] == outside["quantities"]["parcelUnionAreaM2"] == 100
    assert outside["areaM2"] == 10
    assert shape(outside["geometry"]).equals(shape(polygon(10, 0, 1, 10)))


def test_g03_boundary_contact_is_zero_area_not_collision():
    result = checked([feature("O", "observed_ground_occupation"), feature("P", "recorded_parcel", kind="parcel"),
                      feature("R", "public_road_land", polygon(10, 0), "road")], [association()])
    contact = finding(result, "PUBLIC_BOUNDARY_CONTACT")
    assert contact["areaM2"] == 0 and contact["lengthM"] == 10
    assert not any(item["code"] == "OUTSIDE_CONFIRMED_PARCEL" for item in result["findings"])


def test_g04_union_of_two_confirmed_parcels_contains_occupation():
    result = checked([feature("O", "observed_ground_occupation"), feature("P1", "recorded_parcel", polygon(0, 0, 5, 10), "parcel"),
                      feature("P2", "recorded_parcel", polygon(5, 0, 5, 10), "parcel")], [association(parcel="P1"), association(parcel="P2")])
    assert result["quantities"][0]["outsideAreaM2"] == 0
    assert result["quantities"][0]["parcelUnionAreaM2"] == 100
    assert not any(item["code"] == "OUTSIDE_CONFIRMED_PARCEL" for item in result["findings"])


def test_g05_holes_and_parts_survive_native_normalization_and_exact_overlay():
    source = arcgis([{"attributes": {"OBJECTID": 1}, "geometry": {"rings": [ring(500000, 3100000), ring(500002, 3100002, 2, 2)]}},
                     {"attributes": {"OBJECTID": 2}, "geometry": {"rings": [ring(500020, 3100000, 2, 2), ring(500025, 3100000, 2, 2)]}}], geometryRole="observed_ground_occupation")
    normalized = normalize_area(source)
    assert [item["areaM2"] for item in normalized["features"]] == [96, 8]
    occupation = feature("O", "observed_ground_occupation", normalized["features"][0]["geometry"])
    parcel = feature("P", "recorded_parcel", polygon(20, 20), "parcel")
    outside = finding(checked([occupation, parcel], [association()]), "OUTSIDE_CONFIRMED_PARCEL")
    assert shape(outside["geometry"]).area == 96
    assert len(shape(outside["geometry"]).interiors) == 1


def test_g06_roof_is_not_ground_and_missing_association_asks_for_evidence():
    roof = feature("ROOF", "observed_roof_projection", polygon(0, 0, 12, 10))
    ground = feature("O", "observed_ground_occupation")
    parcel = feature("P", "recorded_parcel", kind="parcel")
    result = checked([roof, ground, parcel], [association()])
    assert not any(item["code"] == "OUTSIDE_CONFIRMED_PARCEL" for item in result["findings"])
    for links in ([], [association(status="suggested")]):
        result = checked([ground, parcel], links)
        assert finding(result, "PARCEL_ASSOCIATION_REQUIRED")["category"] == "coverage"
        assert result["questions"][0]["property"] == "confirmedParcelAssociation"
        assert not result["quantities"]


def test_changed_participant_revision_requires_association_reconfirmation():
    link = {**association(), "fromRevision": 1, "toRevision": 1}
    occupation = feature("O", "observed_ground_occupation", polygon(0, 0, 12, 10))
    occupation["revision"] = 2
    result = checked([occupation, feature("P", "recorded_parcel", kind="parcel")], [link])
    assert finding(result, "PARCEL_ASSOCIATION_REQUIRED")
    assert not result["quantities"]


def test_approved_comparison_requires_explicit_matching_level_and_relation():
    occupation = feature("O", "observed_ground_occupation", polygon(0, 0, 12, 10))
    approved = feature("A", "approved_building_outline")
    data = {"features": [occupation, approved], "reference": REFERENCE,
            "representationComparisons": [{"observedId": "O", "approvedId": "A", "status": "confirmed", "evidence": EVIDENCE}]}
    assert finding(check_area(data), "APPROVED_COMPARISON_EVIDENCE_REQUIRED")
    for item in (occupation, approved):
        item["semantics"]["levelReference"] = "ground-occupation-plane"
    assert finding(check_area(data), "OUTSIDE_APPROVED_OUTLINE")["areaM2"] == 20


def test_g07_per_layer_overlaps_do_not_double_count_union():
    rows = [feature("O", "observed_ground_occupation", polygon(0, 0, 12, 10)), feature("P", "recorded_parcel", kind="parcel"),
            feature("R", "public_road_land", polygon(10, 0, 2, 10), "road"), feature("L", "public_land", polygon(11, 0, 3, 10), "public_land")]
    result = checked(rows, [association()])
    individual = [item["areaM2"] for item in result["findings"] if item["code"] == "OCCUPATION_PUBLIC_CONTEXT_OVERLAP"]
    assert sorted(individual) == [10, 20]
    unique = finding(result, "PUBLIC_CONTEXT_UNIQUE_UNION")
    assert unique["areaM2"] == unique["outsideAreaM2"] == 20
    assert shape(unique["outsideGeometry"]).equals(shape(polygon(10, 0, 2, 10)))


def prism_feature(identity, lower, upper, kind="building", geometry=None, reference="SURVEY-BM-1"):
    result = feature(identity, "physical_utility" if kind == "utility" else "approved_building_outline", geometry, kind)
    result["verticalExtent"] = {"lower": lower, "upper": upper, "unit": "m", "reference": reference,
                                "evidenceState": "source_supported", "evidence": copy.deepcopy(EVIDENCE)}
    return result


def test_v01_exact_rectangular_utility_prism_intersection_three_cubic_metres():
    result = checked([prism_feature("B", -3, -2), prism_feature("U", -2.5, -1.5, "utility", polygon(2, 4, 6, 1))])
    collision = finding(result, "SUPPORTED_UTILITY_PRISM_COLLISION")
    assert collision["volumeM3"] == 3 and collision["areaM2"] == 6
    assert collision["verticalInterval"] == [-2.5, -2]
    assert not any(item["code"] == "UTILITY_VERTICAL_UNRESOLVED" for item in result["findings"])


@pytest.mark.parametrize("lower,upper,code", [(-5, -4, "UTILITY_PRISM_SEPARATED"), (-4, -3, "UTILITY_PRISM_CONTACT")])
def test_v02_separation_and_contact_have_zero_volume(lower, upper, code):
    result = checked([prism_feature("B", -3, -2), prism_feature("U", lower, upper, "utility", polygon(2, 4, 6, 1))])
    assert finding(result, code)["volumeM3"] == 0
    assert not any(item["code"] == "SUPPORTED_UTILITY_PRISM_COLLISION" for item in result["findings"])


@pytest.mark.parametrize("reference", [None, "ELLIPSOID-WGS84", "building-relative; not aligned between features"])
def test_v03_missing_or_incompatible_reference_prohibits_collision(reference):
    result = checked([prism_feature("B", -3, -2), prism_feature("U", -2.5, -1.5, "utility", polygon(2, 4, 6, 1), reference)])
    assert not any(item.get("volumeM3", 0) > 0 for item in result["findings"])
    assert result["questions"]
    assert finding(result, "UTILITY_HORIZONTAL_INTERSECTION")


def profile_feature(meaning="invert", levels=None, section=None):
    result = feature("U", "physical_utility", {"type": "LineString", "coordinates": [[2, 4.5], [8, 4.5]]}, "utility")
    result["utilityProfile"] = {"crossSection": section or {"shape": "circular", "diameterM": 1}, "levels": levels or [-3, -2],
                                "levelMeaning": meaning, "interpolation": "linear_endpoints", "verticalReference": "SURVEY-BM-1",
                                "evidenceState": "source_supported", "evidence": copy.deepcopy(EVIDENCE)}
    return result


def test_v04_supplied_invert_and_crown_convert_to_the_same_known_centreline():
    invert = resolve_utility_profile(profile_feature())
    crown = resolve_utility_profile(profile_feature("crown", [-2, -1]))
    assert invert["resolved"]["positions"] == crown["resolved"]["positions"] == [[2, 4.5, -2.5], [8, 4.5, -1.5]]
    assert invert["resolved"]["checkSupport"] == "display_only"
    result = checked([prism_feature("B", -3, -2), profile_feature()])
    assert not any(item.get("volumeM3", 0) > 0 for item in result["findings"])


def test_rectangular_line_profile_uses_same_resolved_footprint_for_exact_check():
    utility = profile_feature("centre", [-2, -2], {"shape": "rectangular", "widthM": 1, "heightM": 1})
    resolved = resolve_utility_profile(utility)["resolved"]
    assert shape(resolved["footprint"]).equals(shape(polygon(2, 4, 6, 1)))
    assert resolved["lower"] == -2.5 and resolved["upper"] == -1.5
    assert finding(checked([prism_feature("B", -3, -2), utility]), "SUPPORTED_UTILITY_PRISM_COLLISION")["volumeM3"] == 3


def test_depth_requires_ground_source_and_matching_reference():
    utility = profile_feature("depth_below_ground", [2, 2])
    utility["utilityProfile"].update(depthTo="crown", groundLevels=[0, 0], groundReference="SURVEY-BM-1")
    assert resolve_utility_profile(utility).get("resolved") is None
    utility["utilityProfile"]["groundEvidence"] = EVIDENCE
    assert resolve_utility_profile(utility)["resolved"]["positions"] == [[2, 4.5, -2.5], [8, 4.5, -2.5]]


def test_private_profile_endpoint_resolves_bound_depth_and_never_trusts_cached_positions(monkeypatch):
    from fastapi.testclient import TestClient
    from geo import api, settings
    monkeypatch.setattr(settings, "GEO_SERVICE_TOKEN", "officer-profile-test")
    client = TestClient(api.app)
    feature = profile_feature("depth_below_ground", [2, 2])
    feature["utilityProfile"].update(depthTo="crown", groundLevels=[0, 0], groundReference="SURVEY-BM-1", groundEvidence=EVIDENCE,
                                      resolved={"positions": [[999, 999, 999]]})
    assert client.post("/internal/area/profile", json={"feature": feature}).status_code == 401
    response = client.post("/internal/area/profile", json={"feature": feature}, headers={"Authorization": "Bearer officer-profile-test"})
    assert response.status_code == 200
    assert response.json()["utilityProfile"]["resolved"]["positions"] == [[2, 4.5, -2.5], [8, 4.5, -2.5]]


def test_profile_batch_preserves_identity_evidence_and_enforces_aggregate_limits(monkeypatch):
    from geo import area
    invert = profile_feature()
    crown = profile_feature("crown", [-2, -1])
    crown["id"], crown["sourceKey"] = "C", "source-crown"
    unbound = profile_feature()
    unbound["id"] = "unbound"
    unbound["utilityProfile"].update(evidence=[], resolved={"positions": [[999, 999, 999]]})
    result = resolve_profile_request({"features": [invert, crown, unbound]})
    assert [item["id"] for item in result["profiles"]] == ["U", "C", "unbound"]
    assert result["profiles"][1]["sourceKey"] == "source-crown"
    assert result["profiles"][0]["utilityProfile"]["resolved"]["positions"] == result["profiles"][1]["utilityProfile"]["resolved"]["positions"]
    assert "resolved" not in result["profiles"][2]["utilityProfile"]
    assert result["profiles"][2]["utilityProfile"]["unresolved"]
    assert resolve_profile_request({"features": []})["profiles"] == []
    with pytest.raises(InputError, match="2000 features"):
        resolve_profile_request({"features": [invert] * 2001})
    with pytest.raises(InputError, match="identities must be unique"):
        resolve_profile_request({"features": [invert, invert]})
    monkeypatch.setattr(area, "MAX_VERTICES", 3)
    with pytest.raises(InputError, match="3 total vertices"):
        resolve_profile_request({"features": [invert, crown]})


def test_documented_restriction_is_never_reported_as_physical_pipe_collision():
    corridor = prism_feature("R", -2.5, -1.5, "utility", polygon(2, 4, 6, 1))
    corridor["semantics"]["geometryRole"] = "documented_restriction"
    result = checked([prism_feature("B", -3, -2), corridor])
    assert finding(result, "RESTRICTION_GEOMETRY_INTERSECTION")
    assert finding(result, "RESTRICTION_RULE_EVIDENCE_REQUIRED")
    assert not any(item.get("volumeM3", 0) > 0 for item in result["findings"])


def test_public_line_is_not_buffered_or_called_a_land_area_boundary_contact():
    result = checked([feature("O", "observed_ground_occupation"), feature("R", "public_road_land", {"type": "LineString", "coordinates": [[0, 5], [10, 5]]}, "road")])
    assert finding(result, "PUBLIC_CONTEXT_AREA_REQUIRED")
    assert not any(item["code"] == "PUBLIC_BOUNDARY_CONTACT" for item in result["findings"])


def test_invalid_semantics_and_unrepresentable_numeric_bounds_are_actionable_errors():
    malformed = feature("B", "unknown")
    malformed["semantics"] = ["ground"]
    with pytest.raises(InputError, match="semantics"):
        checked([malformed])
    malformed = prism_feature("B", -(10 ** 1000), 1)
    with pytest.raises(InputError, match="finite"):
        checked([malformed])


def test_typed_semantics_preserves_status_floor_and_source_dates_without_height_guessing():
    source = arcgis(geometryRole="observed_ground_occupation", floorCountField="floors", approvalStatusField="approved", sourceDateField="date", worldStatusField="status", worldStatusValues={"design": "planned"})
    # Exercise a planned-status source mapping; these coordinates remain an
    # independently authored unit-test fixture, never an acquired survey asset.
    source["worldStatus"] = "observed"
    for row in source["data"]["features"]:
        row["attributes"].update(floors=4, approved="approved drawing", date="2025-02-01", status="design")
    result = normalize_area(source)
    assert result["features"][0]["semantics"]["floorCount"] == 4
    assert result["features"][0]["worldStatus"] == "planned"
    assert result["features"][0]["height"]["value"] is None


@pytest.mark.parametrize("promoted", ["observed", "planned"])
def test_source_declared_synthetic_cannot_be_promoted_through_status_mapping(promoted):
    source = arcgis(worldStatusField="status", worldStatusValues={"live": promoted})
    for row in source["data"]["features"]:
        row["attributes"]["status"] = "live"
    with pytest.raises(InputError, match="synthetic/hypothetical source"):
        normalize_area(source)


def test_native_csv_level_facts_missing_questions_and_cell_locators():
    raw = b"alias,label,level,lower,upper,unit,benchmark\nU1,Basement,B1,-3,-2,m,BM-1\nU2,Room,1,,10,ft,BM-1\n"
    result = extract_document({"format": "csv", "base64": base64.b64encode(raw).decode()})
    assert result["status"] == "needs_input"
    assert result["parts"][0]["locator"]["row"] == 2
    lower = next(item for item in result["candidates"] if item["subject"] == "U1" and item["property"] == "space.lower")
    assert lower["value"] == -3 and lower["referenceFrameId"] == "BM-1"
    assert lower["locator"]["column"] == 4 and lower["partIndex"] == 0
    upper = next(item for item in result["candidates"] if item["subject"] == "U2" and item["property"] == "space.upper")
    assert upper["value"] == 3.048
    assert result["questions"][0]["property"] == "space.lower"


@pytest.mark.parametrize("row", ["U,NaN,1,m,BM", "U,2,1,m,BM", "U,0,1,,BM", "U,0,1,m,", "U,0,1,m,BM,extra"])
def test_csv_invalid_levels_are_not_accepted(row):
    with pytest.raises(InputError):
        extract_document({"format": "csv", "base64": base64.b64encode(("alias,lower,upper,unit,benchmark\n" + row).encode()).decode()})


def test_existing_levels_csv_method_is_retained_as_text_without_becoming_authority():
    raw = b"alias,lower,upper,unit,benchmark,method\nB1,-3,0,m,SYNTHETIC-BM,declared survey method\n"
    result = extract_document({"format": "csv", "base64": base64.b64encode(raw).decode()})
    assert result["status"] == "ready"
    assert "method: declared survey method" in result["parts"][0]["text"]
    assert result["parts"][0]["locator"] == {"row": 2, "label": "CSV row 2"}
    assert {c["property"] for c in result["candidates"]} == {"space.lower", "space.upper"}
    assert all(c["method"] == "native_parse" and c["evidenceState"] == "source_supported" for c in result["candidates"])
    assert [c["value"] for c in result["candidates"]] == [-3, 0]
