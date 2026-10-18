"""Focused Stage A feature, authority, split and no-pickle round-trip checks."""

from __future__ import annotations

import json
import subprocess
import time
import types
from collections import Counter
from pathlib import Path

import numpy as np
import pytest
from sklearn.linear_model import SGDClassifier

from geo.usp_learning import stage_a
from geo.usp_learning.stage_a import (
    CALIBRATION_FAMILY,
    VARIANT_HEADER_DROP,
    canonical_targets,
    choose_threshold,
    feature_text,
    fit_only_variants,
    load_examples,
    load_model,
    preferred_examples,
    online_update,
    resume_state,
    sample_weights,
    save_model,
    train,
    train_cross_fit,
    vectorizer,
    write_json,
)

REPO = Path(__file__).resolve().parents[3]
VA2 = Path("E:/BhuAayam-data/task-data/va2")
BEFORE_VARIANTS = "7231538c"


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


def variant_of(row: dict, header: str, tag: str) -> dict:
    # A copied real field is a software control for the fit-only rule, not a training example.
    return {**row, "profileId": f"variant-{tag}", "sourceField": f"variant_{tag}", "profileHash": f"variant-{tag}",
            "header": header, "labelKind": "synthetic_variant", "seedProfileId": row["profileId"], "synthetic": True}


def test_va2_variants_load_with_their_seed_family_and_a_variant_without_seed_is_refused(tmp_path: Path) -> None:
    rows = load_examples(VA2 / "variant-examples.jsonl")
    assert len(rows) == 270
    assert all(row["synthetic"] is True and row["labelKind"] == "synthetic_variant" and row["split"] == "dev"
               for row in rows)
    assert not any("synthetic" in row for row in examples())
    example = json.loads((VA2 / "variant-examples.jsonl").read_text(encoding="utf-8").splitlines()[0])
    link = next(json.loads(line) for line in (VA2 / "profile-links.jsonl").read_text(encoding="utf-8").splitlines()
                if json.loads(line)["profileHash"] == example["profileHash"])
    del example["seedProfileId"]
    (tmp_path / "examples.jsonl").write_text(json.dumps(example) + "\n", encoding="utf-8")
    (tmp_path / "profile-links.jsonl").write_text(json.dumps(link) + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match="STAGE_A_LABEL_AUTHORITY_DENIED"):
        load_examples(tmp_path / "examples.jsonl")


def test_variant_never_replaces_a_real_example_for_the_same_key() -> None:
    real = examples()[0]
    variant = {**real, "labelKind": "synthetic_variant", "synthetic": True}
    assert preferred_examples([real, variant]) == [real]
    assert preferred_examples([variant, real]) == [real]


def test_variants_fit_every_other_fold_and_are_never_tested_thresholded_or_calibrated(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = examples()
    families = list(dict.fromkeys(row["family"] for row in source if row["split"] == "dev"))[:3]
    real = [row for family in families for row in [entry for entry in source if entry["family"] == family][:4]]
    variants = [variant_of(row, f"{row['header']} variant", row["family"]) for row in real[::4]]
    variant_families = {row["profileId"]: row["family"] for row in variants}
    thresholded: list[list[str]] = []
    choose = stage_a.choose_threshold

    def spy(probabilities: np.ndarray, expected: list[str], classes: np.ndarray) -> dict:
        thresholded.append(list(expected))
        return choose(probabilities, expected, classes)

    monkeypatch.setattr(stage_a, "choose_threshold", spy)
    train_cross_fit([*real, *variants], tmp_path, False, {"loaded": len(variants)})
    assert sorted(path.name for path in (tmp_path / "folds").iterdir()) == sorted(families)
    for family in families:
        fold = json.loads((tmp_path / "folds" / family / "manifest.json").read_text(encoding="utf-8"))
        assert {item for item in fold["fitIds"] if item in variant_families} == {
            item for item, owner in variant_families.items() if owner != family}
        assert not set(fold["testIds"]) & set(variant_families)
    scores = json.loads((tmp_path / "cross-fit-scores.json").read_text(encoding="utf-8"))
    assert len(scores) == len(real) and not {score["profileId"] for score in scores} & set(variant_families)
    assert thresholded == [[score["expectedTarget"] for score in scores]]
    final = json.loads((tmp_path / "v1/manifest.json").read_text(encoding="utf-8"))
    assert sorted(final["calibrationIds"]) == sorted(row["profileId"] for row in real)
    assert set(variant_families) <= {row["profileId"] for row in final["trainingExamples"]}
    assert final["variants"] == {"loaded": len(variants)}


def test_variant_on_another_familys_real_header_is_dropped_and_its_seed_must_match() -> None:
    source = examples()
    first = source[0]
    second = next(row for row in source if row["family"] != first["family"])
    real_a = {**first, "target": "building.name", "header": "Building Name"}
    real_b = {**second, "target": "building.name", "header": "Bldg. Name"}
    leak = variant_of(real_a, "bldg name", "leak")
    own = variant_of(real_a, "Name of Building", "own")
    kept, summary = fit_only_variants([real_a, real_b, leak, own])
    assert [row["profileId"] for row in kept] == [real_a["profileId"], real_b["profileId"], "variant-own"]
    assert summary["droppedByReason"] == {VARIANT_HEADER_DROP: 1} and summary["fitOnly"] == 1
    assert fit_only_variants([real_a, real_b]) == ([real_a, real_b], None)
    with pytest.raises(ValueError, match="STAGE_A_VARIANT_SEED_UNKNOWN"):
        fit_only_variants([real_b, own])
    with pytest.raises(ValueError, match="STAGE_A_VARIANT_SEED_UNKNOWN"):
        fit_only_variants([real_a, {**own, "family": second["family"]}])


def trainer_before_variants() -> types.ModuleType:
    source = subprocess.check_output(
        ["git", "show", f"{BEFORE_VARIANTS}:services/geo/geo/usp_learning/stage_a.py"], cwd=REPO, encoding="utf-8")
    module = types.ModuleType("stage_a_before_variants")
    # The same file path keeps REPO and codeSha256 equal; only the code under test differs.
    module.__file__ = stage_a.__file__
    exec(compile(source, "stage_a_before_variants", "exec"), module.__dict__)
    return module


def output_tree(root: Path) -> dict[str, bytes]:
    return {path.relative_to(root).as_posix(): path.read_bytes() for path in sorted(root.rglob("*")) if path.is_file()}


@pytest.mark.parametrize("mode", ["cross_fit", "single_family"])
def test_without_variants_every_output_is_byte_identical_to_the_trainer_before_variants(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch, mode: str) -> None:
    receipt = json.loads((REPO / "docs/evidence/gf-agent/t1/verify.json").read_text(encoding="utf-8"))
    path = Path(receipt["outputDirectory"]) / "pseudo-labels.jsonl"
    # Fixed zip entry times inside model.npz, so equal arrays give equal bytes.
    monkeypatch.setattr(time, "time", lambda: 1_790_000_000.0)
    before = trainer_before_variants().train([path], tmp_path / "before", calibration_mode=mode)
    after = train([path], tmp_path / "after", calibration_mode=mode)
    assert json.dumps(before).replace("before", "after") == json.dumps(after)
    assert output_tree(tmp_path / "before") == output_tree(tmp_path / "after")
    assert len(output_tree(tmp_path / "after")) > 3
