"""Regressions for fit gating, Windows process limits, and saved CPU inference."""

import json
import os
import sys
from pathlib import Path

import pytest

from geo.usp_learning.corpus import input_proof, load_examples
from geo.usp_learning.resources import guarded_run, write_json_once

REPO = Path(__file__).resolve().parents[3]


def checked_examples():
    originals = os.environ.get("USP_LEARNING_ORIGINALS_DIR")
    if not originals:
        pytest.skip("retained issuer originals not configured")
    path = REPO / "docs/api/learning-corpus.json"
    corpus, examples = load_examples(path, Path(originals))
    return path, corpus, examples


def test_coverage_requires_eligible_families_and_proof_is_exact(tmp_path):
    from geo.usp_learning.experiment import coverage, make_freeze, validate_freeze

    path, corpus, examples = checked_examples()
    prior = coverage([item for item in examples if item["source"] != "gnwt-buildings"])
    assert prior["gaps"] == [
        "building.sourceKey: fewer than two eligible positive calibration families",
        "building.name: fewer than two eligible positive calibration families",
    ]
    result = coverage(examples)
    assert result["fitEligible"] and not result["gaps"]
    assert result["targets"]["building.geometry"]["wireCompatibleWrongTargetControls"] >= 1
    proof_path, freeze_path = tmp_path / "proof.json", tmp_path / "freeze.json"
    proof = input_proof(path, examples)
    write_json_once(proof_path, proof)
    write_json_once(freeze_path, make_freeze(path, proof_path, corpus, examples, REPO))
    assert validate_freeze(freeze_path, path, proof_path, corpus, examples, REPO)["coverage"] == result
    proof["fields"][0]["textSha256"] = "0" * 64
    proof_path.write_text(json.dumps(proof), encoding="utf-8")
    with pytest.raises(ValueError, match="input proof differs"):
        validate_freeze(freeze_path, path, proof_path, corpus, examples, REPO)
    next(item for item in corpus["sources"] if item["id"] == "gnwt-buildings")["permission"]["trainingEligible"] = False
    unlicensed = tmp_path / "ineligible.json"
    unlicensed.write_text(json.dumps(corpus), encoding="utf-8")
    with pytest.raises(ValueError, match="source not eligible"):
        load_examples(unlicensed, Path(os.environ["USP_LEARNING_ORIGINALS_DIR"]))


def test_supervisor_kills_only_owned_process_tree_on_time_and_rss_limits(tmp_path):
    import psutil

    for name, body, limits, expected in (
        ("success", "import os,psutil; assert int(os.environ['USP_LEARNING_SUPERVISOR_PID']) in {p.pid for p in psutil.Process().parents()}",
         {"maxRunSeconds": 10, "maxPeakProcessRssBytes": 512 * 1024**2}, None),
        ("time", "import time; time.sleep(30)", {"maxRunSeconds": 0.4, "maxPeakProcessRssBytes": 512 * 1024**2}, "run_time_limit"),
        ("rss", "import time; data=bytearray(64*1024**2); time.sleep(30)", {"maxRunSeconds": 10, "maxPeakProcessRssBytes": 40 * 1024**2}, "process_rss_limit"),
        ("fit", "import sys,time,json; from pathlib import Path; (Path(sys.argv[1])/'fit-started.json').write_text(json.dumps({'monotonic':time.monotonic()})); time.sleep(30)",
         {"maxRunSeconds": 10, "maxFitSeconds": 0.2, "maxPeakProcessRssBytes": 512 * 1024**2}, "fit_time_limit"),
    ):
        destination = tmp_path / name
        destination.mkdir()
        report = guarded_run([sys.executable, "-c", body, str(destination)], destination, {"maxFitSeconds": 10, **limits})
        assert report["limitExceeded"] == expected
        assert report["exitCode"] in ((124, 137) if expected else (0,))
        for pid in report["observedOwnedPids"]:
            try:
                # Windows can retain a terminated PID while a process handle is open.
                psutil.Process(pid).wait(timeout=1)
            except psutil.NoSuchProcess:
                pass


@pytest.mark.parametrize("schema_version", ["usp-field-mapping-corpus-v5", "usp-field-mapping-corpus-v6"])
def test_literal_identifier_rejects_real_numeric_building_id(tmp_path, schema_version):
    from geo.usp_learning.corpus import wire_compatible_rows, wire_observation

    path, corpus, _ = checked_examples()
    corpus["schemaVersion"] = schema_version
    root = Path(os.environ["USP_LEARNING_ORIGINALS_DIR"])
    source = next(item for item in corpus["sources"] if item["id"] == "kitchener-buildings")
    features = json.loads((root / source["sample"]["file"]).read_text(encoding="utf-8"))["features"]
    assert wire_observation("properties.BUILDINGID", features)["nonNullTypes"] == ["number"]
    assert wire_compatible_rows("building.sourceKey", "properties.BUILDINGID", features) == 0
    # Deliberately corrupt only the test manifest; the actual numeric original is unchanged.
    field = next(item for item in source["excludedFields"] if item["path"] == "properties.BUILDINGID")
    source["excludedFields"].remove(field)
    metadata = json.loads((root / source["metadata"]["file"]).read_text(encoding="utf-8"))
    index = next(i for i, f in enumerate(metadata["fields"]) if f["name"] == "BUILDINGID")
    source["fields"].append({**field, "target": "building.sourceKey", "decision": "positive",
                             "definition": "Invalid test manifest coercion", "wireCompatibleRows": 0,
                             "inputEvidence": {"sourceField": "BUILDINGID", "fieldPointer": f"/fields/{index}"}})
    changed = tmp_path / "corrupt-manifest.json"
    changed.write_text(json.dumps(corpus), encoding="utf-8")
    with pytest.raises(ValueError, match="cannot coerce"):
        load_examples(changed, root)


def test_saved_cpu_inference_and_calibration_guard_on_development_only(tmp_path):
    base_dir = os.environ.get("USP_LEARNING_BASE_DIR")
    if not base_dir:
        pytest.skip("pinned local E5 checkpoint not configured")
    import torch
    from geo.usp_learning.model import choose_calibration_threshold, load_adapter, load_base, save_adapter, score_matrix

    _, corpus, examples = checked_examples()
    train = [item for item in examples if item["split"] == "train" and item["source"] == "nyc-building-footprints"]
    torch.set_num_threads(2)
    tokenizer, model = load_base(Path(base_dir))
    with torch.no_grad():
        before = score_matrix(tokenizer, model, train, corpus["targets"])
    assert before.device.type == "cpu"
    with pytest.raises(ValueError, match="calibration inputs only"):
        choose_calibration_threshold(train, before)
    path = tmp_path / "unchanged-base-last-layer.safetensors"
    checksum = save_adapter(model, path)
    load_adapter(model, path, checksum)
    with torch.no_grad():
        after = score_matrix(tokenizer, model, train, corpus["targets"])
    assert torch.equal(before, after)


def test_tied_scores_cannot_pass_calibration_by_abstaining_on_everything():
    import torch
    from geo.usp_learning.model import choose_calibration_threshold

    _, corpus, examples = checked_examples()
    calibration = [item for item in examples if item["split"] == "calibration"]
    # Numerical fault injection on real labels, not model performance evidence.
    tied = torch.zeros((len(calibration), len(corpus["targets"])))
    assert choose_calibration_threshold(calibration, tied) is None
