import json
from pathlib import Path
import pytest
from geo.core_contract import CoreContractError
from geo.core_identity import validate_core_identity_graph

CASES = json.loads((Path(__file__).resolve().parents[3] / "fixtures/contracts/identity.cases.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_shared_core_identity_semantics(case):
    if case["valid"]:
        assert validate_core_identity_graph(case["value"]) == case["value"]
    else:
        with pytest.raises(CoreContractError) as caught:
            validate_core_identity_graph(case["value"])
        assert caught.value.code == case["code"]
