"""Focused Stage A feature, authority, split and no-pickle round-trip checks."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import numpy as np
import pytest
from sklearn.linear_model import SGDClassifier

from geo.usp_learning.stage_a import (
    CALIBRATION_FAMILY,
    canonical_targets,
    choose_threshold,
    feature_text,
    load_examples,
    load_model,
    preferred_examples,
    online_update,
    resume_state,
    sample_weights,
    save_model,
    train_cross_fit,
    vectorizer,
    write_json,
)

REPO = Path(__file__).resolve().parents[3]


def examples() -> list[dict]:
    receipt = json.loads((REPO / "docs/evidence/gf-agent/t1/verify.json").read_text(encoding="utf-8"))
    return load_examples(Path(receipt["outputDirectory"]) / "pseudo-labels.jsonl")


def test_features_use_metadata_never_masked_sample_or_raw_values() -> None:
    profile = {"header": "क्षेत्रफल AREA", "neighbourHeaders": ["Floor"], "inferredType": "number",
               "declaredUnit": None, "valueShapes": {"lakhGroupingRate": 1, "khasraLikeRate": 0},
               "cellCount": 10, "emptyCount": 2, "maskedSamples": ["SECRET RAW VALUE"]}
    text = feature_text(profile)
    assert "word:area" in text and "nb:floor" in text and "char:" in text
    assert "SECRET" not in text and "magnitude:unavailable" in text
    assert "lakh:high" in text and "empty:low" in text


def test_verified_examples_and_whole_calibration_family_are_separable() -> None:
    rows = examples()
    assert len(rows) == 398
    assert not any(row["family"].startswith("mi-h") for row in rows)
    calibration = [row for row in rows if row["family"] == CALIBRATION_FAMILY]
    assert len(calibration) == 6
    assert all(row["profileId"] not in {item["profileId"] for item in rows
                                      if item["family"] != CALIBRATION_FAMILY} for row in calibration)


def test_officer_authority_replaces_teacher_even_if_teacher_arrives_later() -> None:
    teacher = examples()[0]
    officer = {**teacher, "labelKind": "officer", "method": "reviewer:test-only-control"}
    assert preferred_examples([teacher, officer, teacher]) == [officer]


def test_threshold_never_commits_wrong_calibration_field() -> None:
    probabilities = np.array([[0.9, 0.1], [0.2, 0.8]])
    calibration = choose_threshold(probabilities, ["unknown", "unknown"], np.array(["unknown", "building.name"]))
    assert calibration["threshold"] == 0.9 and calibration["precision"] == 1.0
    abstain = choose_threshold(np.array([[0.1, 0.9]]), ["unknown"], np.array(["unknown", "building.name"]))
    assert abstain["threshold"] is None


def test_npz_reload_preserves_probabilities_without_pickle(tmp_path: Path) -> None:
    rows = examples()[:8]
    matrix = vectorizer().transform([feature_text(row) for row in rows])
    model = SGDClassifier(loss="log_loss", random_state=17)
    model.partial_fit(matrix, [row["target"] for row in rows], classes=np.asarray(canonical_targets()))
    manifest = {"threshold": None}
    save_model(model, tmp_path / "model.npz", manifest)
    write_json(tmp_path / "manifest.json", manifest)
    restored, _ = load_model(tmp_path)
    np.testing.assert_allclose(model.predict_proba(matrix), restored.predict_proba(matrix), rtol=0, atol=0)
    assert load_model(tmp_path)[1]["calibration"]["mode"] == "single_family"


def test_cross_fit_seed_online_update_keeps_threshold_mode_and_class_balance(tmp_path: Path) -> None:
    source = examples()
    families = list(dict.fromkeys(row["family"] for row in source if row["split"] == "dev"))[:2]
    rows = [row for family in families for row in [entry for entry in source if entry["family"] == family][:4]]
    assert len({row["family"] for row in rows}) == 2
    seed = train_cross_fit(rows, tmp_path / "seed", False)
    _, before = load_model(Path(seed["model"]))
    # A copied real field is a software authority control, not an actual officer label or training claim.
    row = rows[0]
    example = {"columnProfile": {"name": row["sourceField"]}, "profileHash": row["profileHash"],
               "target": row["target"], "verified": True, "labelKind": "officer",
               "method": "reviewer:test-only-control"}
    batch = tmp_path / "batch"
    batch.mkdir()
    (batch / "examples.jsonl").write_text(json.dumps(example) + "\n", encoding="utf-8")
    (batch / "profile-links.jsonl").write_text(json.dumps(row) + "\n", encoding="utf-8")
    updated = online_update(batch / "examples.jsonl", tmp_path / "updated", Path(seed["model"]))
    _, after = load_model(Path(updated["model"]))
    assert after["threshold"] == before["threshold"]
    assert after["calibration"]["mode"] == before["calibration"]["mode"] == "cross_fit"
    assert after["classBalance"] == before["classBalance"]
    assert after["parentModelSha256"] == before["modelSha256"]
    assert after["calibrationIds"] == before["calibrationIds"]
    assert after["calibrationFamily"] is None
    with pytest.raises(ValueError, match="STAGE_A_RULE_LINEAGE_CHANGED"):
        resume_state(Path(updated["model"]), rows, "single_family", False)
    pooled = json.loads((tmp_path / "seed/cross-fit-metrics.json").read_text(encoding="utf-8"))
    assert pooled["wrongCommitted"] == 0


def test_class_balance_uses_fit_counts_only_and_exact_inverse_frequency() -> None:
    rows = [{"target": "unknown"}, {"target": "unknown"}, {"target": "building.name"}]
    counts = Counter(row["target"] for row in rows)
    np.testing.assert_allclose(sample_weights(rows, counts), [0.75, 0.75, 1.5])
