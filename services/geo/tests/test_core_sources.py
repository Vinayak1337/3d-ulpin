import json
from pathlib import Path
import pytest
from geo.core_contract import CoreContractError
from geo.core_sources import validate_core_source_catalog

CASES = json.loads((Path(__file__).resolve().parents[3] / "fixtures/contracts/source.cases.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_shared_source_evidence_semantics(case):
    if case["valid"]:
        assert validate_core_source_catalog(case["catalog"], case["identity"]) == case["catalog"]
    else:
        with pytest.raises(CoreContractError) as caught:
            validate_core_source_catalog(case["catalog"], case["identity"])
        assert caught.value.code == case["code"]
