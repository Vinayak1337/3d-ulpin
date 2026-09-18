import json
import math
from pathlib import Path
import pytest
from geo.core_contract import CoreContractError
from geo.core_geometry import measure_core_representation, evaluate_core_geometry

CASES = json.loads((Path(__file__).resolve().parents[3] / "fixtures/contracts/geometry.cases.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_geometry_contract_and_known_answers(case):
    x = case["input"]
    before = json.dumps(x, sort_keys=True)
    if not case["valid"]:
        with pytest.raises(CoreContractError) as caught:
            measure_core_representation(x["geometry"], x["identity"], x["sources"], x["frames"], x["request"])
        assert caught.value.code == case["code"]
    else:
        result = measure_core_representation(x["geometry"], x["identity"], x["sources"], x["frames"], x["request"])
        assert result["reasonCode"] == case["reasonCode"]
        if case["value"] is None:
            assert result["value"] is None
        else:
            assert math.isclose(result["value"], case["value"], rel_tol=0, abs_tol=1e-8)
        if case.get("capabilities"):
            caps = evaluate_core_geometry(x["geometry"], x["identity"], x["sources"], x["frames"])[0]["capabilities"]
            assert all(caps[key]["available"] == value for key, value in case["capabilities"].items())
    assert json.dumps(x, sort_keys=True) == before
