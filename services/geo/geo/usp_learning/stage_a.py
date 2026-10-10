"""CPU-only online column classifier. Teacher supervision is pseudo-label data, never truth."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import unicodedata
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
    return {family["id"] for family in manifest["families"] if family["split"] == "dev"}


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
        if link["split"] not in ("dev", "pool") or (link["split"] == "dev" and link["family"] not in allowed):
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
        return {"threshold": None, "committed": 0, "precision": None, "fields": 0, "agreement": None}
    matrix = vectorizer().transform([feature_text(profile) for profile in calibration])
    probabilities = model.predict_proba(matrix)
    expected = [example["target"] for example in calibration]
    predicted = model.classes_[probabilities.argmax(axis=1)]
    return {**choose_threshold(probabilities, expected, model.classes_), "fields": len(calibration),
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
            "trainingExamples": [{key: row[key] for key in ("profileId", "family", "profileHash", "sourceField",
                                   "target", "method", "labelKind", "labelFileSha256", "exampleSha256")}
                                 for row in training],
            "qualification": "pseudo_label-trained; no evaluation families fitted or used for calibration"}


def training_batches(examples: list[Row]) -> list[list[Row]]:
    batches: dict[str, list[Row]] = {}
    for example in examples:
        batches.setdefault(example["profileHash"], []).append(example)
    return list(batches.values())


def train(examples_paths: list[Path], out: Path) -> Row:
    external_output(out)
    rows = preferred_examples([example for path in examples_paths for example in load_examples(path)])
    calibration = [row for row in rows if row["family"] == CALIBRATION_FAMILY]
    fitting = [row for row in rows if row["family"] != CALIBRATION_FAMILY]
    if not fitting:
        raise ValueError("STAGE_A_NO_VERIFIED_FIT_EXAMPLES")
    model = SGDClassifier(loss="log_loss", random_state=SEED)
    trained: list[Row] = []
    for index, batch in enumerate(training_batches(fitting), 1):
        destination = out / f"v{index}"
        destination.mkdir(parents=True, exist_ok=False)
        matrix = vectorizer().transform([feature_text(row) for row in batch])
        model.partial_fit(matrix, [row["target"] for row in batch], classes=np.asarray(canonical_targets()))
        trained.extend(batch)
        metrics = calibration_metrics(model, calibration)
        manifest = version_manifest(index, trained, calibration, metrics)
        save_model(model, destination / "model.npz", manifest)
        write_json(destination / "manifest.json", manifest)
        write_json(destination / "metrics.json", {**metrics, "fitExamples": len(trained),
                                                  "fitFamilies": len({row["family"] for row in trained})})
    return {"model": str(destination), "versions": index, "fitExamples": len(trained), "calibration": metrics}


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
    inference = commands.add_parser("predict")
    inference.add_argument("--model", type=Path, required=True)
    inference.add_argument("--profiles", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "train":
        print(json.dumps(train(args.examples, args.out)))
    else:
        for prediction in predict(args.model, read_lines(args.profiles)):
            print(json.dumps(prediction))


if __name__ == "__main__":
    main()
