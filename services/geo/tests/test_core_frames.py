import json
import math
from pathlib import Path
import pytest
from geo.core_contract import CoreContractError
from geo.core_frames import transform_core_point

CASES = json.loads((Path(__file__).resolve().parents[3] / "fixtures/contracts/frame.cases.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_independent_frame_expectations(case):
    before = json.dumps([case["catalog"], case["request"]], sort_keys=True)
    if case["valid"]:
        result = transform_core_point(case["catalog"], case["request"])
        assert len(result["point"]) == len(case["expectedPoint"])
        assert all(math.isclose(a, b, rel_tol=0, abs_tol=case["tolerance"]) for a, b in zip(result["point"], case["expectedPoint"]))
    else:
        with pytest.raises(CoreContractError) as caught:
            transform_core_point(case["catalog"], case["request"])
        assert caught.value.code == case["code"]
    assert json.dumps([case["catalog"], case["request"]], sort_keys=True) == before
