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
from geo.core_geometry import evaluate_core_geometry, measure_core_representation
from geo.core_snapshot import build_core_snapshot, validate_core_publication_candidate
from geo.core_signature import canonical_core_text, core_input_digest


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
    geometry_cases = json.loads((root / "fixtures/contracts/geometry.cases.json").read_text(encoding="utf-8"))["cases"]
    for case in geometry_cases:
        data = case["input"]
        before = json.dumps(data, sort_keys=True)
        try:
            result = measure_core_representation(data["geometry"], data["identity"], data["sources"], data["frames"], data["request"])
            actual = None
        except CoreContractError as error:
            actual = error.code
        expected = None if case["valid"] else case["code"]
        if actual != expected:
            raise AssertionError(f"Geometry semantic mismatch: {case['id']}; expected {expected}, got {actual}")
        if case["valid"]:
            assert result["reasonCode"] == case["reasonCode"], case["id"]
            if case["value"] is None:
                assert result["value"] is None, case["id"]
            elif result["value"] is None or not math.isclose(result["value"], case["value"], rel_tol=0, abs_tol=1e-8):
                raise AssertionError(f"Geometry quantity mismatch: {case['id']}: {result['value']} != {case['value']}")
            if case.get("capabilities"):
                caps = evaluate_core_geometry(data["geometry"], data["identity"], data["sources"], data["frames"])[0]["capabilities"]
                for key, value in case["capabilities"].items():
                    assert caps[key]["available"] == value, (case["id"], key)
        assert json.dumps(data, sort_keys=True) == before
    print(json.dumps({"kind":"core-geometry-quantity-parity","cases":len(geometry_cases),"result":"PASS","sharedSchemaAndPolicy":True}))
    signature_cases = json.loads((root / "fixtures/contracts/signature.cases.json").read_text(encoding="utf-8"))["cases"]
    for case in signature_cases:
        assert canonical_core_text(case["value"]) == case["expectedEncoding"], case["id"]
        assert core_input_digest(case["value"]) == case["expectedDigest"], case["id"]
    print(json.dumps({"kind":"core-signature-oracle-parity","cases":len(signature_cases),"result":"PASS"}))
    snapshot_cases = json.loads((root / "fixtures/contracts/snapshot.cases.json").read_text(encoding="utf-8"))["cases"]
    for case in snapshot_cases:
        data = case["input"]
        before = json.dumps(data, sort_keys=True)
        try:
            result = build_core_snapshot(data)
            actual = None
        except CoreContractError as error:
            actual = error.code
        expected = None if case["valid"] else case["code"]
        if actual != expected:
            raise AssertionError(f"Snapshot semantic mismatch: {case['id']}; expected {expected}, got {actual}")
        if case["valid"]:
            assert [r["ref"]["id"] for r in result["geometry"]["representations"]] == case["representationIds"], case["id"]
            if "reportedIds" in case:
                assert sorted(q["ref"]["id"] for q in result["geometry"]["reportedQuantities"]) == case["reportedIds"], case["id"]
            assert result["manifest"]["inputDigest"] == case["expectedDigests"]["input"], (case["id"], "input signature")
            assert result["manifest"]["geometryDigest"] == case["expectedDigests"]["geometry"], (case["id"], "geometry signature")
            if "volume" in case:
                q = measure_core_representation(result["geometry"], data["identity"], data["sources"], data["frames"], {"representation":{"ref":{"namespace":"representation","id":"exterior"},"revision":1},"definition":"prism_volume"})
                assert q["value"] == case["volume"], case["id"]
            if "unavailable" in case:
                assert any(r["reasonCode"] == case["unavailable"] for r in result["results"]), case["id"]
            if "temporalCoverage" in case:
                assert all(r["temporalCoverage"] == case["temporalCoverage"] for r in result["results"]), case["id"]
        assert json.dumps(data, sort_keys=True) == before, case["id"]
    print(json.dumps({"kind":"core-snapshot-composition-parity","cases":len(snapshot_cases),"result":"PASS"}))
    publication_cases = json.loads((root / "fixtures/contracts/publication.cases.json").read_text(encoding="utf-8"))["cases"]
    for case in publication_cases:
        try:
            validate_core_publication_candidate(case["snapshot"], case["candidate"])
            actual = None
        except CoreContractError as error:
            actual = error.code
        expected = None if case["valid"] else case["code"]
        assert actual == expected, (case["id"], expected, actual)
    print(json.dumps({"kind":"core-publication-metadata-parity","cases":len(publication_cases),"result":"PASS"}))


if __name__ == "__main__":
    run()
