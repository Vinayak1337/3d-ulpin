from copy import deepcopy
import json

import pytest

from geo.geometry import build_model
from geo.validation import InputError
from conftest import FIXTURES


def test_real_nyc_envelope_matches_recorded_source_quantities(draft):
    provenance = json.loads((FIXTURES / "real-nyc/provenance.json").read_text())
    result = build_model(draft)
    assert result["inputFingerprint"] == draft["inputFingerprint"]
    assert len(result["units"]) == 1
    envelope = result["units"][0]
    assert envelope["area"] == pytest.approx(provenance["checks"]["projectedFootprintAreaM2"], abs=1e-5)
    assert envelope["volume"] == pytest.approx(provenance["checks"]["expectedEnvelopeVolumeM3"], abs=1e-4)
    assert envelope["height"] == pytest.approx(provenance["conversion"]["roofHeightMetres"])
    assert not any(f["code"] == "OVERLAP" for f in result["findings"])


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


def test_plan_calibration_requires_distinct_controls(draft):
    draft["units"][0]["calibration"] = {"sourceId": "plan-source", "page": 1, "imagePoints": [[10, 10], [10, 10]], "worldPoints": [[0, 0], [2, 2]]}
    with pytest.raises(InputError, match="distinct"):
        build_model(draft)
