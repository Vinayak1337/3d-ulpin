"""Run the persisted identity corpus against the production Python core gate."""
import json
import math
import sys
from pathlib import Path
root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "services/geo"))
from geo.core_contract import CoreContractError, assert_core_json
from geo.core_identity import validate_core_identity_graph
from geo.core_sources import validate_core_source_catalog
from geo.core_frames import transform_core_point


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
    source_cases = json.loads((root / "fixtures/contracts/source.cases.json").read_text(encoding="utf-8"))["cases"]
    for case in source_cases:
        before = json.dumps(case["catalog"], sort_keys=True)
        try:
            validate_core_source_catalog(case["catalog"], case["identity"])
            actual = None
        except CoreContractError as error:
            actual = error.code
        expected = None if case["valid"] else case["code"]
        if actual != expected:
            raise AssertionError(f"Source semantic mismatch: {case['id']}; expected {expected}, got {actual}")
        assert json.dumps(case["catalog"], sort_keys=True) == before
    print(json.dumps({"kind":"core-source-semantic-parity","cases":len(source_cases),"result":"PASS","sharedSchemaAndPolicy":True}))
    frame_cases = json.loads((root / "fixtures/contracts/frame.cases.json").read_text(encoding="utf-8"))["cases"]
    for case in frame_cases:
        before = json.dumps([case["catalog"], case["request"]], sort_keys=True)
        try:
            result = transform_core_point(case["catalog"], case["request"])
            actual = None
        except CoreContractError as error:
            actual = error.code
        expected = None if case["valid"] else case["code"]
        if actual != expected:
            raise AssertionError(f"Frame semantic mismatch: {case['id']}; expected {expected}, got {actual}")
        if case["valid"]:
            assert len(result["point"]) == len(case["expectedPoint"])
            for value, expected_value in zip(result["point"], case["expectedPoint"]):
                if not math.isclose(value, expected_value, rel_tol=0, abs_tol=case["tolerance"]):
                    raise AssertionError(f"Coordinate mismatch: {case['id']}: {value} != {expected_value}")
        assert json.dumps([case["catalog"], case["request"]], sort_keys=True) == before
    print(json.dumps({"kind":"core-frame-numeric-parity","cases":len(frame_cases),"result":"PASS","sharedSchemaAndPolicy":True}))


if __name__ == "__main__":
    run()
