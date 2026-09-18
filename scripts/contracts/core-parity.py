"""Run the persisted identity corpus against the production Python core gate."""
import json
import sys
from pathlib import Path
root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "services/geo"))
from geo.core_contract import CoreContractError, assert_core_json
from geo.core_identity import validate_core_identity_graph


def run():
    cases = json.loads((root / "fixtures/contracts/identity.cases.json").read_text(encoding="utf-8"))["cases"]
    for case in cases:
        before = json.dumps(case["value"], sort_keys=True)
        try:
            validate_core_identity_graph(case["value"])
            actual = None
        except CoreContractError as error:
            actual = error.code
        expected = None if case["valid"] else case["code"]
        if actual != expected:
            raise AssertionError(f"Identity semantic mismatch: {case['id']}; expected {expected}, got {actual}")
        if json.dumps(case["value"], sort_keys=True) != before:
            raise AssertionError("Validation mutated its caller")
    for value in (float("nan"), float("inf"), float("-inf")):
        try:
            assert_core_json({"value": value})
        except CoreContractError as error:
            assert error.code == "NON_FINITE"
        else:
            raise AssertionError("Non-finite value accepted")
    shared = {"value": 1}
    assert_core_json([shared, shared])
    cyclic = {}; cyclic["self"] = cyclic
    try:
        assert_core_json(cyclic)
    except CoreContractError as error:
        assert error.code == "JSON_CYCLE"
    else:
        raise AssertionError("Cycle accepted")
    print(json.dumps({"kind":"core-identity-semantic-parity","cases":len(cases),"result":"PASS","sharedSchemaAndPolicy":True}))


if __name__ == "__main__":
    run()
