from copy import deepcopy
import json

import pytest
from shapely.geometry import Polygon

from geo.geometry import build_model
from geo.validation import InputError
from conftest import FIXTURES, fixture_input


@pytest.mark.parametrize("dataset", ["c001", "c002"])
def test_independent_demo_arithmetic_and_correction(dataset):
    manifest = json.loads((FIXTURES / dataset / "manifest.json").read_text())
    expected = manifest["expected"]
    initial = fixture_input(dataset)
    result = build_model(initial)
    assert result["inputFingerprint"] == initial["inputFingerprint"]
    assert len(result["units"]) == expected["unitCount"]
    for unit in result["units"]:
        original = next(u for u in initial["units"] if u["id"] == unit["id"])
        assert unit["revision"] == original["revision"]
        assert unit["bindings"] == original["bindings"]
        assert unit["area"] == pytest.approx(expected["areas"][unit["alias"]])
        if unit["alias"] in expected["draftVolumes"]:
            assert unit["volume"] == pytest.approx(expected["draftVolumes"][unit["alias"]])
    overlaps = [f for f in result["findings"] if f["code"] == "OVERLAP"]
    assert len(overlaps) == 1
    assert sum(f["overlap"]["volume"] for f in overlaps) == pytest.approx(expected["draftOverlapVolume"])
    for finding in overlaps:
        region = finding["overlap"]
        shape = Polygon(region["footprint"])
        assert shape.area * (region["upper"] - region["lower"]) == pytest.approx(region["volume"])
        assert len(finding["sourceIds"]) > 0
    unverified = {f["unitIds"][0] for f in result["findings"] if f["code"] == "UNVERIFIED_LOWER"}
    assert unverified == {u["id"] for u in result["units"] if u["alias"] in expected["r1UnverifiedLower"]}
    assert any(f["code"] == "CONTEXT_CONTAINMENT" for f in result["findings"])
    assert not any(f["code"].startswith("OUTSIDE") for f in result["findings"])
    corrected = build_model(fixture_input(dataset, corrected=True))
    assert sum(f["overlap"]["volume"] for f in corrected["findings"] if f["code"] == "OVERLAP") == expected["correctedOverlapVolume"]
    assert not any(f["code"].startswith("UNVERIFIED") for f in corrected["findings"])
    assert any(f["code"] == "BOUNDARY_CONTACT" for f in corrected["findings"])


@pytest.mark.parametrize("mutation,match", [("null", "finite number"), ("nan", "nonfinite"), ("zero_height", "above"), ("crossing", "invalid polygon"), ("duplicate", "duplicate unit"), ("units", "metres"), ("reference", "reference"), ("false_evidence", "source locator"), ("degenerate", "invalid polygon|negligible area"), ("boolean", "finite number")])
def test_build_rejects_unsupported_inputs(draft, mutation, match):
    unit = draft["units"][0]
    if mutation == "null":
        unit["lower"] = None
    elif mutation == "nan":
        unit["upper"] = float("nan")
    elif mutation == "zero_height":
        unit["upper"] = unit["lower"]
    elif mutation == "crossing":
        unit["footprint"] = [[0, 0], [3, 3], [0, 3], [3, 0]]
    elif mutation == "duplicate":
        draft["units"].append(deepcopy(unit))
    elif mutation == "units":
        draft["frame"]["verticalUnit"] = "ft"
    elif mutation == "reference":
        unit["frame"] = {**draft["frame"], "benchmark": "OTHER"}
    elif mutation == "false_evidence":
        del unit["bindings"]["lower"]
    elif mutation == "degenerate":
        unit["footprint"] = [[0, 0], [1, 1], [2, 2]]
    elif mutation == "boolean":
        unit["lower"] = False
    with pytest.raises(InputError, match=match):
        build_model(draft)


def test_manual_measurement_remains_unverified_and_binding_change_changes_result(draft):
    first = build_model(draft)
    second = deepcopy(draft)
    upper_east = next(u for u in second["units"] if u["alias"] == "U04")
    upper_east.update(lowerVerified=True, revision=2)
    upper_east["bindings"]["lower"] = {"sourceId": "new-level-source", "locator": "csv row 3"}
    second["inputFingerprint"] = "new-source-fingerprint"
    revised = build_model(second)
    assert revised["inputFingerprint"] != first["inputFingerprint"]
    assert next(u for u in first["units"] if u["alias"] == "U04")["volume"] == next(u for u in revised["units"] if u["alias"] == "U04")["volume"]
    assert not any(f["code"] == "UNVERIFIED_LOWER" and upper_east["id"] in f["unitIds"] for f in revised["findings"])


def test_context_is_not_a_competing_volume_and_outside_context_warns(draft):
    draft["context"][2]["footprint"] = [[2, 2], [5, 2], [5, 10], [2, 10]]
    result = build_model(draft)
    assert any(f["code"] == "OUTSIDE_BUILDING" for f in result["findings"])
    assert sum(f["overlap"]["volume"] for f in result["findings"] if f["code"] == "OVERLAP") == pytest.approx(6.4)


def test_plan_calibration_requires_distinct_controls(draft):
    draft["units"][0]["calibration"] = {"sourceId": "plan-source", "page": 1, "imagePoints": [[10, 10], [10, 10]], "worldPoints": [[0, 0], [2, 2]]}
    with pytest.raises(InputError, match="distinct"):
        build_model(draft)


def test_disconnected_intersections_get_exact_separate_highlights(draft):
    draft["context"] = []
    a, b = deepcopy(draft["units"][:2])
    a["footprint"] = [[0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6]]
    b["footprint"] = [[-1, 3], [7, 3], [7, 5], [-1, 5]]
    draft["units"] = [a, b]
    result = build_model(draft)
    overlaps = [f for f in result["findings"] if f["code"] == "OVERLAP"]
    assert len(overlaps) == 2
    assert sum(f["overlap"]["volume"] for f in overlaps) == pytest.approx(24)
    assert len({f["id"] for f in overlaps}) == 2
