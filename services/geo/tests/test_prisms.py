import json
from copy import deepcopy
from fractions import Fraction
from pathlib import Path

import pytest

from geo.geometry import PRISM_METHOD, build_prisms

HAND_CASES = Path(__file__).resolve().parents[3] / "docs/evidence/gf-t16/k3a/hand-cases.json"


def hand_case(case_id: str) -> dict:
    cases = json.loads(HAND_CASES.read_text(encoding="utf-8"))["cases"]
    return next(case for case in cases if case["id"] == case_id)


def exact_values(result: dict) -> list[dict]:
    return [
        {"areaM2Exact": item["areaM2Exact"], "volumeM3Exact": item["prism"]["volumeM3Exact"]}
        for item in result["components"]
    ]


def assert_unsupported(result: dict, reason: str) -> None:
    assert result["method"] == PRISM_METHOD
    assert result["state"] == "unsupported"
    assert result["reason"] == reason
    assert "totalVolumeM3" not in result
    assert "totalVolumeM3Exact" not in result
    component = result["components"][0]
    assert component["state"] == "unsupported"
    assert component["reason"] == reason
    assert "prism" not in component
    assert "areaM2" not in component


def test_rectangle_matches_hand_area_and_volume():
    case = hand_case("rectangle")
    result = build_prisms(case["input"])
    assert result["method"] == "prism/2"
    assert result["state"] == "ok"
    assert result["heightState"] == "known"
    assert exact_values(result) == case["expected"]["components"]
    assert result["totalVolumeM3Exact"] == "321.3"
    assert result["components"][0]["areaM2"] == 102.0
    assert result["totalVolumeM3"] == 321.3


def test_l_shape_with_courtyard_matches_hand_area_volume_and_normalised_rings():
    case = hand_case("l-shape-courtyard")
    result = build_prisms(case["input"])
    expected = case["expected"]["components"][0]
    component = result["components"][0]
    assert component["areaM2Exact"] == expected["areaM2Exact"] == "56.25"
    assert component["prism"]["volumeM3Exact"] == expected["volumeM3Exact"] == "157.5"
    assert component["footprint"] == expected["footprint"]
    assert result["totalVolumeM3Exact"] == "157.5"


def test_clockwise_exterior_is_normalised_not_rejected():
    case = hand_case("l-shape-courtyard")
    rings = case["input"]["components"][0]["footprint"]["coordinates"]
    rings[0] = [rings[0][0]] + rings[0][:0:-1]
    result = build_prisms(case["input"])
    assert result["components"][0]["areaM2Exact"] == "56.25"
    assert result["components"][0]["footprint"] == case["expected"]["components"][0]["footprint"]


def test_volume_with_hole_equals_outer_volume_minus_hole_volume():
    case = hand_case("l-shape-courtyard")
    decomposition = case["decomposition"]
    with_hole = deepcopy(case["input"])
    outer_only = deepcopy(case["input"])
    hole_only = deepcopy(case["input"])
    outer_only["components"][0]["footprint"]["coordinates"] = with_hole["components"][0]["footprint"]["coordinates"][:1]
    hole_only["components"][0]["footprint"]["coordinates"] = [decomposition["holeRing"]]
    volumes = [
        Fraction(build_prisms(space)["totalVolumeM3Exact"]) for space in (with_hole, outer_only, hole_only)
    ]
    assert volumes == [Fraction("157.5"), Fraction(decomposition["outerVolumeM3Exact"]), Fraction("10.5")]
    assert volumes[0] == volumes[1] - volumes[2]


def test_duplex_has_one_identity_two_components_and_an_empty_slab():
    case = hand_case("duplex-empty-slab")
    result = build_prisms(case["input"])
    assert result["spaceId"] == "space-duplex"
    assert [item["levelId"] for item in result["components"]] == ["L1", "L2"]
    assert exact_values(result) == case["expected"]["components"]
    assert result["totalVolumeM3Exact"] == "283.5"
    assert result["totalVolumeM3Exact"] != case["rejectedNaiveVolumeM3Exact"]


def test_unknown_limits_keep_the_footprint_without_prism_or_volume():
    case = hand_case("unknown-limits")
    result = build_prisms(case["input"])
    component = result["components"][0]
    assert result["state"] == "ok"
    assert result["heightState"] == "unknown"
    assert result["totalVolumeM3"] is None
    assert result["totalVolumeM3Exact"] is None
    assert component["heightState"] == "unknown"
    assert component["reason"] == "level_limit_unknown"
    assert component["prism"] is None
    assert component["areaM2Exact"] == "20"


def test_self_intersecting_ring_is_unsupported():
    result = build_prisms(hand_case("invalid-self-intersecting")["input"])
    assert_unsupported(result, "ring_self_intersecting")


def test_zero_area_ring_is_unsupported_not_zero():
    result = build_prisms(hand_case("invalid-zero-area")["input"])
    assert_unsupported(result, "ring_zero_area")


@pytest.mark.parametrize("case_id", ["invalid-limits-equal", "invalid-limits-inverted"])
def test_level_limits_that_do_not_increase_are_unsupported(case_id):
    result = build_prisms(hand_case(case_id)["input"])
    assert_unsupported(result, "level_limits_not_increasing")


def test_stilt_level_is_an_open_prism():
    case = hand_case("stilt-open")
    result = build_prisms(case["input"])
    assert result["components"][0]["enclosure"] == "open"
    assert exact_values(result) == [{"areaM2Exact": "30", "volumeM3Exact": "72"}]
    assert result["totalVolumeM3Exact"] == "72"


def test_multipolygon_component_sums_disjoint_parts_and_rejects_overlap():
    space = deepcopy(hand_case("rectangle")["input"])
    space["components"][0]["upperM"] = "2.00"
    parts = [
        [[["0", "0"], ["2", "0"], ["2", "3"], ["0", "3"]]],
        [[["5", "0"], ["9", "0"], ["9", "1"], ["5", "1"]]],
    ]
    space["components"][0]["footprint"] = {"type": "MultiPolygon", "coordinates": parts}
    result = build_prisms(space)
    assert result["components"][0]["areaM2Exact"] == "10"
    assert result["totalVolumeM3Exact"] == "20"
    parts[1] = [[["1", "1"], ["4", "1"], ["4", "2"], ["1", "2"]]]
    assert_unsupported(build_prisms(space), "polygons_overlap")
