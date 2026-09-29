"""Pre-fit evidence gates and the one bounded desktop configuration."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .corpus import CORPUS_VERSION, TARGETS, input_proof, sha256_file
from .model import BASE_CONFIG_SHA256, BASE_REVISION, BASE_WEIGHT_SHA256, allowed_target_indices

CODE_PATHS = (
    "scripts/usp/learning/train.py",
    "scripts/usp/learning/freeze.py",
    "scripts/usp/learning/infer.py",
    "scripts/usp/learning/prepare_calibration_corpus.py",
    "services/geo/geo/usp_learning/corpus.py",
    "services/geo/geo/usp_learning/model.py",
    "services/geo/geo/usp_learning/experiment.py",
    "services/geo/geo/usp_learning/resources.py",
)
FIT = {
    "steps": 64, "seed": 17, "learningRate": 2e-5, "cpuThreads": 2,
    "optimizer": "AdamW", "weightDecay": 0.01, "maxTokens": 128,
    "maxFitSeconds": 600, "maxRunSeconds": 600, "maxPeakProcessRssBytes": 6 * 1024**3,
    "maxCudaReservedBytes": 5 * 1024**3, "cudaHeadroomBytes": 1536 * 1024**2,
    "device": "cpu", "precision": "float32", "reloadTolerance": 1e-5,
    "thresholdPolicy": "calibration-zero-errors-positive-macro-recall-v1",
}
ACCEPTANCE = {
    "calibration": "At least one correct positive per target; zero wrong-target positives or false-mapped negatives; maximize macro positive recall then higher threshold. If unavailable, do not open evaluation.",
    "evaluation": "One comparison after weights, reload and thresholds are frozen. Improvement over a baseline requires more correct positives and no increase in incorrect mappings. Compare lexical and frozen E5 separately; remain offline regardless.",
    "scope": "Small foreign schema samples only; no production, Indian, whole-record, association or population accuracy qualification.",
}


def coverage(examples: list[dict[str, Any]]) -> dict[str, Any]:
    calibration = [item for item in examples if item["split"] == "calibration"]
    evaluation = [item for item in examples if item["split"] == "evaluation"]
    gaps: list[str] = []
    targets = {}
    for index, target in enumerate(TARGETS):
        families = sorted({item["family"] for item in calibration
                           if item["target"] == target and item["wireCompatibleRows"]})
        controls = [item for item in calibration if item["target"] != target
                    and index in allowed_target_indices(item)]
        fresh = sorted({item["family"] for item in evaluation
                        if item["target"] == target and item["wireCompatibleRows"]})
        targets[target] = {"positiveCalibrationFamilies": families,
                           "wireCompatibleWrongTargetControls": len(controls),
                           "positiveEvaluationFamilies": fresh}
        if len(families) < 2:
            gaps.append(f"{target}: fewer than two eligible positive calibration families")
        if not controls:
            gaps.append(f"{target}: no wire-compatible wrong-map calibration control")
        if not fresh:
            gaps.append(f"{target}: no untouched wire-compatible evaluation positive")
    if not any(item["split"] == "train" and item["target"] == "building.name"
               and item["wireCompatibleRows"] for item in examples):
        gaps.append("training has no nonempty building-name positive")
    if any(item["source"] in ("dc-building-footprints-2021", "sf-building-footprints")
           and item["split"] != "diagnostic" for item in examples):
        gaps.append("observed DC/SF families must remain diagnostic")
    return {"fitEligible": not gaps, "gaps": gaps, "targets": targets}


def make_freeze(corpus_path: Path, proof_path: Path, corpus: dict[str, Any],
                examples: list[dict[str, Any]], repo: Path, device: str = "cpu") -> dict[str, Any]:
    if device not in ("cpu", "cuda"):
        raise ValueError("unsupported device")
    return {
        "schemaVersion": "usp-e5-fit-freeze-v2", "corpusSha256": sha256_file(corpus_path),
        "inputProofSha256": sha256_file(proof_path), "corpusVersion": corpus["schemaVersion"],
        "base": {"revision": BASE_REVISION, "weightSha256": BASE_WEIGHT_SHA256,
                 "configSha256": BASE_CONFIG_SHA256},
        "splits": {split: sorted({item["family"] for item in examples if item["split"] == split})
                   for split in ("train", "calibration", "evaluation", "diagnostic")},
        "fit": {**FIT, "device": device}, "acceptance": ACCEPTANCE, "coverage": coverage(examples),
        "codeSha256": {name: sha256_file(repo / name) for name in CODE_PATHS},
        "requirementsSha256": sha256_file(repo / "services/geo/requirements-learning.txt"),
    }


def validate_freeze(path: Path, corpus_path: Path, proof_path: Path, corpus: dict[str, Any],
                    examples: list[dict[str, Any]], repo: Path) -> dict[str, Any]:
    frozen = json.loads(path.read_text(encoding="utf-8"))
    if corpus["schemaVersion"] != CORPUS_VERSION:
        raise ValueError("new fits require the current source-only corpus")
    if json.loads(proof_path.read_text(encoding="utf-8")) != input_proof(corpus_path, examples):
        raise ValueError("source-only input proof differs from checked originals")
    expected = make_freeze(corpus_path, proof_path, corpus, examples, repo, frozen["fit"]["device"])
    if frozen != expected:
        raise ValueError("freeze differs from current code, source proof, splits, settings or acceptance criteria")
    if any(sum(item["split"] == split for item in examples) > 128 for split in frozen["splits"]):
        raise ValueError("bounded research corpus limit exceeded")
    if not frozen["coverage"]["fitEligible"]:
        raise ValueError("fit blocked: " + "; ".join(frozen["coverage"]["gaps"]))
    return frozen
