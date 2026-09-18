import json
import math
from pathlib import Path
import pytest
from geo.core_contract import CoreContractError
from geo.core_signature import canonical_core_text, core_input_digest
from geo.core_snapshot import build_core_snapshot, validate_core_publication_candidate
from geo.core_geometry import measure_core_representation

ROOT = Path(__file__).resolve().parents[3] / "fixtures/contracts"
SIGNATURES = json.loads((ROOT / "signature.cases.json").read_text(encoding="utf-8"))["cases"]
SNAPSHOTS = json.loads((ROOT / "snapshot.cases.json").read_text(encoding="utf-8"))["cases"]
PUBLICATIONS = json.loads((ROOT / "publication.cases.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", SIGNATURES, ids=lambda c: c["id"])
def test_signature_independent_oracle(case):
    assert canonical_core_text(case["value"]) == case["expectedEncoding"]
    assert core_input_digest(case["value"]) == case["expectedDigest"]


@pytest.mark.parametrize("case", SNAPSHOTS, ids=lambda c: c["id"])
def test_snapshot_composition(case):
    x = case["input"]
    before = json.dumps(x, sort_keys=True)
    if not case["valid"]:
        with pytest.raises(CoreContractError) as caught:
            build_core_snapshot(x)
        assert caught.value.code == case["code"]
    else:
        result = build_core_snapshot(x)
        assert [r["ref"]["id"] for r in result["geometry"]["representations"]] == case["representationIds"]
        assert result["manifest"]["inputDigest"] == case["expectedDigests"]["input"]
        assert result["manifest"]["geometryDigest"] == case["expectedDigests"]["geometry"]
        if "reportedIds" in case:
            assert sorted(q["ref"]["id"] for q in result["geometry"]["reportedQuantities"]) == case["reportedIds"]
        if "volume" in case:
            q = measure_core_representation(result["geometry"], x["identity"], x["sources"], x["frames"], {"representation":{"ref":{"namespace":"representation","id":"exterior"},"revision":1},"definition":"prism_volume"})
            assert q["value"] == case["volume"]
        if "unavailable" in case:
            assert any(r["reasonCode"] == case["unavailable"] for r in result["results"])
        if "temporalCoverage" in case:
            assert all(r["temporalCoverage"] == case["temporalCoverage"] for r in result["results"])
    assert json.dumps(x, sort_keys=True) == before


@pytest.mark.parametrize("case", PUBLICATIONS, ids=lambda c: c["id"])
def test_publication_candidate_is_not_activation(case):
    if case["valid"]:
        validate_core_publication_candidate(case["snapshot"], case["candidate"])
    else:
        with pytest.raises(CoreContractError) as caught:
            validate_core_publication_candidate(case["snapshot"], case["candidate"])
        assert caught.value.code == case["code"]
