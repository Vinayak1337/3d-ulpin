"""CPU-only online column classifier. Teacher supervision is pseudo-label data, never truth."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import unicodedata
from collections import Counter
from importlib.metadata import version
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.feature_extraction.text import HashingVectorizer
from sklearn.linear_model import SGDClassifier

REPO = Path(__file__).resolve().parents[4]
CALIBRATION_FAMILY = "mi-d03"
N_FEATURES = 32768
SEED = 17
DEFAULT_CALIBRATION_MODE = "cross_fit"
DEFAULT_CLASS_BALANCE = False
Row = dict[str, Any]


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def object_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def canonical_targets() -> list[str]:
    text = (REPO / "packages/contracts/src/canonical/targets.ts").read_text(encoding="utf-8")
    body = text.split("export const CANONICAL_TARGETS = {", 1)[1].split("} as const satisfies", 1)[0]
    keys = re.findall(r"^  (?:'([^']+)'|(unknown)):", body, re.MULTILINE)
    targets = [quoted or plain for quoted, plain in keys]
    if len(targets) != len(set(targets)) or "unknown" not in targets:
        raise ValueError("STAGE_A_CONTRACT_INVALID")
    return targets


def normalized_header(header: str) -> str:
    return unicodedata.normalize("NFKC", header).lower()


def header_word_tokens(profile: Row) -> list[str]:
    return [f"word:{token}" for token in re.findall(r"[^\W_]+", normalized_header(profile.get("header", "")))]


def header_char_tokens(profile: Row) -> list[str]:
    header = normalized_header(profile.get("header", ""))
    return [f"char:{header[index:index + width]}" for width in range(2, 5)
            for index in range(max(0, len(header) - width + 1)) if " " not in header[index:index + width]]


def neighbour_tokens(profile: Row) -> list[str]:
    return [f"nb:{token}" for header in profile.get("neighbourHeaders", [])
            for token in re.findall(r"[^\W_]+", normalized_header(header))]


def inferred_type_tokens(profile: Row) -> list[str]:
    return [f"type:{profile.get('inferredType', 'unknown')}"]


def declared_unit_tokens(profile: Row) -> list[str]:
    return [f"unit:{profile.get('declaredUnit') or 'undeclared'}"]


def rate_bucket(value: float | None) -> str:
    if value is None:
        return "unavailable"
    if value == 0:
        return "zero"
    if value < 0.5:
        return "low"
    return "high"


def date_pattern_tokens(profile: Row) -> list[str]:
    shapes = profile.get("valueShapes", {})
    return [f"date_dmy:{rate_bucket(shapes.get('dateDmyRate'))}",
            f"date_iso:{rate_bucket(shapes.get('dateIsoRate'))}"]


def grouping_tokens(profile: Row) -> list[str]:
    shapes = profile.get("valueShapes", {})
    return [f"lakh:{rate_bucket(shapes.get('lakhGroupingRate'))}",
            f"khasra:{rate_bucket(shapes.get('khasraLikeRate'))}",
            f"devanagari:{rate_bucket(shapes.get('devanagariDigitRate'))}"]


def suffix_and_magnitude_tokens(profile: Row) -> list[str]:
    # The current contract lacks these statistics. Masked digits are not numeric evidence.
    shapes = profile.get("valueShapes", {})
    magnitude = shapes.get("numericMagnitudeBucket")
    suffix = shapes.get("unitSuffix")
    return [f"magnitude:{magnitude if isinstance(magnitude, str) else 'unavailable'}",
            f"unit_suffix:{suffix if isinstance(suffix, str) else 'unavailable'}"]


def empty_ratio_tokens(profile: Row) -> list[str]:
    cells = profile.get("cellCount", 0)
    ratio = profile.get("emptyCount", 0) / cells if cells else None
    return [f"empty:{rate_bucket(ratio)}"]


def feature_text(profile: Row) -> str:
    extractors = (header_word_tokens, header_char_tokens, neighbour_tokens, inferred_type_tokens,
                  declared_unit_tokens, date_pattern_tokens, grouping_tokens,
                  suffix_and_magnitude_tokens, empty_ratio_tokens)
    return " ".join(token for extract in extractors for token in extract(profile))


def vectorizer() -> HashingVectorizer:
    return HashingVectorizer(n_features=N_FEATURES, alternate_sign=False, lowercase=False,
                             tokenizer=str.split, token_pattern=None, norm="l2", dtype=np.float32)


def read_lines(path: Path) -> list[Row]:
    if path.name.startswith(".env"):
        raise ValueError("STAGE_A_PATH_DENIED")
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def development_families() -> set[str]:
    manifest = json.loads((REPO / "fixtures/usp/D8-messy-india/manifest.json").read_text(encoding="utf-8"))
    foreign = json.loads((REPO / "fixtures/usp/D8-open-property-foreign/manifest.json").read_text(encoding="utf-8"))
    if foreign["purpose"] != "test_only":
        raise ValueError("STAGE_A_TRAINING_SPLIT_DENIED")
    blind = {family["id"] for family in [*manifest["heldout"], *foreign["heldout"]]}
    admitted = {family["id"] for family in foreign["families"] if family["split"] == "dev"}
    for family in admitted:
        assets = [asset for asset in foreign["assets"] if asset["family"] == family]
        if not assets or any(asset["split"] != "dev" for asset in assets):
            raise ValueError("STAGE_A_TRAINING_SPLIT_DENIED")
        for asset in assets:
            if any(not re.fullmatch(r"[a-f0-9]{64}", asset[pin]["sha256"])
                   for pin in ("original", "profileInput", "dictionary")):
                raise ValueError("STAGE_A_TRAINING_SPLIT_DENIED")
            if asset["profileInput"]["sourceSha256"] != asset["original"]["sha256"]:
                raise ValueError("STAGE_A_TRAINING_SPLIT_DENIED")
    return {family["id"] for family in [*manifest["families"], *foreign["families"]]
            if family["split"] == "dev" and family["id"] not in blind}


def load_examples(path: Path) -> list[Row]:
    links = {(link["profileHash"], link["sourceField"]): link
             for link in read_lines(path.parent / "profile-links.jsonl")}
    allowed = development_families()
    targets = canonical_targets()
    result = []
    for example in read_lines(path):
        if example.get("verified") is not True:
            continue
        link = links[(example["profileHash"], example["columnProfile"]["name"])]
        if (link["split"] not in ("dev", "pool") or (link["split"] == "dev" and link["family"] not in allowed)
                or (link["family"].startswith("opf-") and link["split"] != "dev")):
            raise ValueError("STAGE_A_TRAINING_SPLIT_DENIED")
        if link["family"].startswith("mi-h") or example["target"] not in targets:
            raise ValueError("STAGE_A_TRAINING_SPLIT_DENIED")
        officer = example.get("labelKind") == "officer" and example["method"].startswith("reviewer:")
        teacher = example.get("labelKind") == "pseudo_label" and example["method"].startswith("model:")
        if not (officer or teacher):
            raise ValueError("STAGE_A_LABEL_AUTHORITY_DENIED")
        result.append({**link, "target": example["target"], "method": example["method"],
                       "labelKind": example["labelKind"], "labelFileSha256": sha256_file(path),
                       "exampleSha256": object_hash(example)})
    return result


def preferred_examples(examples: list[Row]) -> list[Row]:
    preferred: dict[tuple[str, str], Row] = {}
    for example in examples:
        key = (example["profileHash"], example["sourceField"])
        previous = preferred.get(key)
        if previous is None or previous["labelKind"] != "officer" or example["labelKind"] == "officer":
            preferred[key] = example
    return list(preferred.values())


def choose_threshold(probabilities: np.ndarray, expected: list[str], classes: np.ndarray) -> Row:
    confidence = probabilities.max(axis=1)
    predicted = classes[probabilities.argmax(axis=1)]
    for threshold in sorted(set(float(value) for value in confidence)):
        selected = confidence >= threshold
        if selected.any() and bool(np.all(predicted[selected] == np.asarray(expected)[selected])):
            return {"threshold": threshold, "committed": int(selected.sum()), "precision": 1.0}
    return {"threshold": None, "committed": 0, "precision": None}


def calibration_metrics(model: SGDClassifier, calibration: list[Row]) -> Row:
    if not calibration:
        return {"mode": "single_family", "threshold": None, "committed": 0, "precision": None,
                "fields": 0, "agreement": None}
    matrix = vectorizer().transform([feature_text(profile) for profile in calibration])
    probabilities = model.predict_proba(matrix)
    expected = [example["target"] for example in calibration]
    predicted = model.classes_[probabilities.argmax(axis=1)]
    return {**choose_threshold(probabilities, expected, model.classes_), "mode": "single_family",
            "fields": len(calibration),
            "agreement": float(np.mean(predicted == expected)),
            "unknownBaselineAgreement": sum(target == "unknown" for target in expected) / len(expected),
            "probabilities": "plain SGD; too few grouped calibration positives for stable CV calibration"}


def external_output(path: Path) -> None:
    resolved = path.resolve()
    for parent in (resolved, *resolved.parents):
        if (parent / ".git").exists():
            raise ValueError("STAGE_A_OUTPUT_IN_GIT")


def save_model(model: SGDClassifier, path: Path, manifest: Row) -> None:
    with path.open("xb") as handle:
        np.savez_compressed(handle, coef_=model.coef_, intercept_=model.intercept_, classes_=model.classes_,
                            t_=np.asarray(model.t_), n_iter_=np.asarray(model.n_iter_),
                            params=np.asarray(json.dumps({"n_features": N_FEATURES, "alternate_sign": False})))
    manifest["modelSha256"] = sha256_file(path)


def load_model(directory: Path) -> tuple[SGDClassifier, Row]:
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if sha256_file(directory / "model.npz") != manifest["modelSha256"]:
        raise ValueError("STAGE_A_MODEL_HASH_MISMATCH")
    with np.load(directory / "model.npz", allow_pickle=False) as saved:
        if json.loads(str(saved["params"])) != {"n_features": N_FEATURES, "alternate_sign": False}:
            raise ValueError("STAGE_A_VECTORIZER_MISMATCH")
        model = SGDClassifier(loss="log_loss", random_state=SEED)
        model.coef_ = saved["coef_"].copy()
        model.intercept_ = saved["intercept_"].copy()
        model.classes_ = saved["classes_"].copy()
        model.t_ = float(saved["t_"])
        model.n_iter_ = int(saved["n_iter_"])
        model.n_features_in_ = N_FEATURES
    if set(model.classes_) != set(canonical_targets()):
        raise ValueError("STAGE_A_CLASS_LIST_CHANGED")
    calibration = manifest.setdefault("calibration", {"threshold": manifest["threshold"]})
    calibration.setdefault("mode", "single_family")
    manifest.setdefault("classBalance", False)
    if calibration["mode"] not in ("single_family", "cross_fit"):
        raise ValueError("STAGE_A_CALIBRATION_MODE_INVALID")
    return model, manifest


def write_json(path: Path, value: Any) -> None:
    with path.open("x", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=True, indent=2)
        handle.write("\n")


def version_manifest(index: int, training: list[Row], calibration: list[Row], metrics: Row) -> Row:
    return {"schemaVersion": "stage-a/1", "version": f"v{index}", "method": f"model:stage-a@v{index}",
            "codeCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
            "codeSha256": sha256_file(Path(__file__)), "checkedWorkingTree": True,
            "versions": {name: version(name) for name in ("numpy", "scipy", "scikit-learn")},
            "classesContractSha256": sha256_file(REPO / "packages/contracts/src/canonical/targets.ts"),
            "calibrationFamily": CALIBRATION_FAMILY, "calibrationIds": [row["profileId"] for row in calibration],
            "threshold": metrics["threshold"], "calibration": metrics,
            "classBalance": metrics.get("classBalance", False),
            "trainingExamples": [{key: row[key] for key in ("profileId", "family", "profileHash", "sourceField",
                                   "target", "method", "labelKind", "labelFileSha256", "exampleSha256")}
                                 for row in training],
            "qualification": "pseudo_label-trained; no evaluation families fitted or used for calibration"}


def training_batches(examples: list[Row]) -> list[list[Row]]:
    batches: dict[str, list[Row]] = {}
    for example in examples:
        batches.setdefault(example["profileHash"], []).append(example)
    return list(batches.values())


def resume_state(resume: Path | None, fitting: list[Row], mode: str = "single_family",
                 class_balance: bool = False) -> tuple[SGDClassifier, list[Row], int]:
    if not resume:
        return SGDClassifier(loss="log_loss", random_state=SEED), [], 0
    model, previous = load_model(resume)
    if previous["calibration"]["mode"] != mode or previous["classBalance"] != class_balance:
        raise ValueError("STAGE_A_RULE_LINEAGE_CHANGED")
    if previous["calibrationFamily"] != CALIBRATION_FAMILY:
        raise ValueError("STAGE_A_CALIBRATION_CHANGED")
    trained = previous["trainingExamples"]
    fitted = {(row["profileHash"], row["sourceField"]): row for row in trained}
    if any(row["labelKind"] == "officer" and (row["profileHash"], row["sourceField"]) in fitted for row in fitting):
        raise ValueError("STAGE_A_OFFICER_OVERRIDE_REQUIRES_FRESH_REBUILD")
    return model, trained, int(previous["version"].removeprefix("v"))


def sample_weights(rows: list[Row], counts: Counter[str]) -> np.ndarray:
    """Mean-one inverse frequency: w_i = N_fit / (K_present * n_fit[target_i])."""
    total = sum(counts.values())
    return np.asarray([total / (len(counts) * counts[row["target"]]) for row in rows], dtype=np.float32)


def fit_batch(model: SGDClassifier, batch: list[Row], counts: Counter[str], class_balance: bool) -> None:
    matrix = vectorizer().transform([feature_text(row) for row in batch])
    weights = sample_weights(batch, counts) if class_balance else None
    model.partial_fit(matrix, [row["target"] for row in batch], classes=np.asarray(canonical_targets()),
                      sample_weight=weights)


def fit_rows(rows: list[Row], class_balance: bool) -> SGDClassifier:
    if not rows:
        raise ValueError("STAGE_A_NO_VERIFIED_FIT_EXAMPLES")
    model = SGDClassifier(loss="log_loss", random_state=SEED)
    counts = Counter(row["target"] for row in rows)
    for batch in training_batches(rows):
        fit_batch(model, batch, counts, class_balance)
    return model


def commit_counts(scores: list[Row], threshold: float | None) -> Row:
    per_target = {}
    for target in sorted({score["expectedTarget"] for score in scores}):
        selected = [score for score in scores if score["expectedTarget"] == target]
        committed = [score for score in selected if threshold is not None and score["confidence"] >= threshold]
        correct = sum(score["predictedTarget"] == target for score in committed)
        per_target[target] = {"n": len(selected), "committed": len(committed), "committedCorrect": correct,
                              "wrongCommitted": len(committed) - correct, "abstained": len(selected) - len(committed)}
    return {"n": len(scores), "perTarget": per_target,
            "wrongCommitted": sum(count["wrongCommitted"] for count in per_target.values()),
            "correctPositiveCommitted": sum(count["committedCorrect"] for target, count in per_target.items()
                                            if target != "unknown"),
            "unknownCommitted": sum(score["predictedTarget"] == "unknown" for score in scores
                                    if threshold is not None and score["confidence"] >= threshold),
            "unknownCommittedCorrect": per_target.get("unknown", {}).get("committedCorrect", 0),
            "abstained": sum(count["abstained"] for count in per_target.values())}


def cross_fit_fold(rows: list[Row], family: str, class_balance: bool, out: Path) -> tuple[np.ndarray, list[Row]]:
    fitting = [row for row in rows if row["family"] != family]
    testing = [row for row in rows if row["family"] == family]
    model = fit_rows(fitting, class_balance)
    probabilities = model.predict_proba(vectorizer().transform([feature_text(row) for row in testing]))
    scores = [{"profileId": row["profileId"], "family": family, "expectedTarget": row["target"],
               "predictedTarget": str(model.classes_[distribution.argmax()]), "confidence": float(distribution.max())}
              for row, distribution in zip(testing, probabilities, strict=True)]
    out.mkdir(parents=True, exist_ok=False)
    manifest = {"excludedFamily": family, "fitExamples": len(fitting),
                "fitFamilies": sorted({row["family"] for row in fitting}), "classBalance": class_balance,
                "testIds": [row["profileId"] for row in testing], "fitIds": [row["profileId"] for row in fitting]}
    save_model(model, out / "model.npz", manifest)
    write_json(out / "manifest.json", manifest)
    return probabilities, scores


def cross_fit_metrics(rows: list[Row], class_balance: bool, out: Path) -> tuple[Row, list[Row]]:
    families = sorted({row["family"] for row in rows if row["split"] == "dev"})
    if len(families) < 2:
        raise ValueError("STAGE_A_CROSS_FIT_FAMILIES_REQUIRED")
    distributions = []
    scores = []
    for family in families:
        probabilities, fold = cross_fit_fold(rows, family, class_balance, out / "folds" / family)
        distributions.append(probabilities)
        scores.extend(fold)
    classes = np.asarray(sorted(canonical_targets()))
    threshold = choose_threshold(np.concatenate(distributions), [score["expectedTarget"] for score in scores], classes)
    metrics = {**threshold, **commit_counts(scores, threshold["threshold"]), "mode": "cross_fit",
               "fields": len(scores), "families": len(families), "classBalance": class_balance,
               "sampleWeightFormula": "N_fit / (K_present * n_fit[target])" if class_balance else "none",
               "poolPolicy": "Pool families remain in each fold's fitting set; only dev families are cross-fitted."}
    write_json(out / "cross-fit-scores.json", scores)
    write_json(out / "cross-fit-metrics.json", metrics)
    return metrics, scores


def train_cross_fit(rows: list[Row], out: Path, class_balance: bool) -> Row:
    metrics, scores = cross_fit_metrics(rows, class_balance, out)
    model = fit_rows(rows, class_balance)
    destination = out / "v1"
    destination.mkdir(parents=True, exist_ok=False)
    calibration = [row for row in rows if row["split"] == "dev"]
    manifest = version_manifest(1, rows, calibration, metrics)
    manifest["calibrationFamily"] = None
    manifest["qualification"] = "Pseudo-label fit; threshold uses development out-of-family predictions, not accuracy."
    manifest["crossFitScoresSha256"] = sha256_file(out / "cross-fit-scores.json")
    manifest["partialFitCalls"] = len(training_batches(rows))
    save_model(model, destination / "model.npz", manifest)
    write_json(destination / "manifest.json", manifest)
    write_json(destination / "metrics.json", {**metrics, "fitExamples": len(rows),
                                              "fitFamilies": len({row["family"] for row in rows})})
    return {"model": str(destination), "fitExamples": len(rows), "calibration": metrics,
            "pooledScoreCount": len(scores)}


def train(examples_paths: list[Path], out: Path, resume: Path | None = None,
          calibration_mode: str = DEFAULT_CALIBRATION_MODE, class_balance: bool = DEFAULT_CLASS_BALANCE) -> Row:
    external_output(out)
    rows = preferred_examples([example for path in examples_paths for example in load_examples(path)])
    if calibration_mode == "cross_fit":
        if resume:
            raise ValueError("STAGE_A_CROSS_FIT_REQUIRES_FRESH_REBUILD")
        return train_cross_fit(rows, out, class_balance)
    if calibration_mode != "single_family" or class_balance:
        raise ValueError("STAGE_A_CALIBRATION_MODE_INVALID")
    calibration = [row for row in rows if row["family"] == CALIBRATION_FAMILY]
    fitting = [row for row in rows if row["family"] != CALIBRATION_FAMILY]
    if not fitting:
        raise ValueError("STAGE_A_NO_VERIFIED_FIT_EXAMPLES")
    model, trained, start = resume_state(resume, fitting)
    for index, batch in enumerate(training_batches(fitting), start + 1):
        destination = out / f"v{index}"
        destination.mkdir(parents=True, exist_ok=False)
        fit_batch(model, batch, Counter(row["target"] for row in fitting), False)
        trained.extend(batch)
        metrics = calibration_metrics(model, calibration)
        manifest = version_manifest(index, trained, calibration, metrics)
        save_model(model, destination / "model.npz", manifest)
        write_json(destination / "manifest.json", manifest)
        write_json(destination / "metrics.json", {**metrics, "fitExamples": len(trained),
                                                  "fitFamilies": len({row["family"] for row in trained})})
    return {"model": str(destination), "versions": index, "fitExamples": len(trained), "calibration": metrics}


def online_metrics(previous: Row) -> Row:
    if previous["calibration"]["mode"] == "single_family":
        return {"mode": "single_family", "threshold": None, "committed": 0, "precision": None,
                "qualification": "New weights abstain until frozen development recalibration; no holdout tuning."}
    return {**previous["calibration"], "classBalance": previous["classBalance"],
            "inheritedFromModelSha256": previous["modelSha256"],
            "qualification": "Seed cross-fit threshold retained; updated weights are not independently recalibrated."}


def online_update(examples_path: Path, out: Path, resume: Path) -> Row:
    """One approved officer batch, serialized by the existing server job transaction."""
    external_output(out)
    rows = preferred_examples(load_examples(examples_path))
    if not rows or any(row["labelKind"] != "officer" for row in rows):
        raise ValueError("STAGE_A_OFFICER_BATCH_REQUIRED")
    model, previous = load_model(resume)
    if previous["calibration"]["mode"] == "single_family":
        if any(row["family"] == CALIBRATION_FAMILY for row in rows):
            raise ValueError("STAGE_A_CALIBRATION_FIT_DENIED")
        if previous["calibrationFamily"] != CALIBRATION_FAMILY:
            raise ValueError("STAGE_A_CALIBRATION_CHANGED")
    trained = preferred_examples([*previous["trainingExamples"], *rows])
    fit_batch(model, rows, Counter(row["target"] for row in trained), previous["classBalance"])
    index = int(previous["version"].removeprefix("v")) + 1
    destination = out / f"v{index}"
    destination.mkdir(parents=True, exist_ok=False)
    metrics = online_metrics(previous)
    manifest = version_manifest(index, trained, [], metrics)
    manifest["calibrationFamily"] = previous["calibrationFamily"]
    manifest["calibrationIds"] = previous["calibrationIds"]
    manifest["qualification"] = "officer-approved; one partial_fit; old pseudo-label weights are not evaluation truth"
    manifest["parentModelSha256"] = previous["modelSha256"]
    manifest["approvedBatchSha256"] = sha256_file(examples_path)
    save_model(model, destination / "model.npz", manifest)
    write_json(destination / "manifest.json", manifest)
    write_json(destination / "metrics.json", {**metrics, "fitExamples": len(trained), "partialFitCalls": 1})
    return {"model": str(destination), "version": f"v{index}"}


def predict(directory: Path, profiles: list[Row]) -> list[Row]:
    model, manifest = load_model(directory)
    if not profiles:
        return []
    probabilities = model.predict_proba(vectorizer().transform([feature_text(profile) for profile in profiles]))
    threshold = manifest["threshold"]
    output = []
    for profile, distribution in zip(profiles, probabilities, strict=True):
        position = int(distribution.argmax())
        probability = float(distribution[position])
        output.append({"profileId": profile["profileId"], "target": str(model.classes_[position]),
                       "probability": probability, "committed": threshold is not None and probability >= threshold,
                       "version": manifest["version"]})
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    fitting = commands.add_parser("train")
    fitting.add_argument("--examples", type=Path, nargs="+", required=True)
    fitting.add_argument("--out", type=Path, required=True)
    fitting.add_argument("--resume", type=Path)
    fitting.add_argument("--calibration-mode", choices=("single_family", "cross_fit"),
                         default=DEFAULT_CALIBRATION_MODE)
    fitting.add_argument("--class-balance", action=argparse.BooleanOptionalAction, default=DEFAULT_CLASS_BALANCE)
    online = commands.add_parser("online")
    online.add_argument("--examples", type=Path, required=True)
    online.add_argument("--out", type=Path, required=True)
    online.add_argument("--resume", type=Path, required=True)
    inference = commands.add_parser("predict")
    inference.add_argument("--model", type=Path, required=True)
    inference.add_argument("--profiles", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "train":
        print(json.dumps(train(args.examples, args.out, args.resume, args.calibration_mode, args.class_balance)))
    elif args.command == "online":
        print(json.dumps(online_update(args.examples, args.out, args.resume)))
    else:
        profiles = json.load(sys.stdin) if str(args.profiles) == "-" else read_lines(args.profiles)
        for prediction in predict(args.model, profiles):
            print(json.dumps(prediction))


if __name__ == "__main__":
    main()
