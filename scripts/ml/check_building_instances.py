"""Preregistered v2 parity for final production instances, without changing v1 or model semantics."""

from __future__ import annotations

import argparse
import ast
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time
from typing import Any

import numpy as np
from PIL import Image
from rasterio.features import rasterize
from scipy.optimize import linear_sum_assignment
from shapely.geometry import shape

from building_io import EVIDENCE, REPO, RUNS, configure_offline, read_json, sha, write_json
from eval_buildings import committed, mask_iou_matrix, production, session
from export_buildings import dev_inputs

PROTOCOL = EVIDENCE / "parity-protocol-v2.json"


def production_contract(source: str) -> dict[str, str]:
    """Bind postprocessing, not unrelated registration/readiness changes in the same module."""
    functions = {"_building_tile", "_building_layout", "_resize_logits", "_components"}
    constants = {"BUILDING_TILE", "BUILDING_STRIDE", "MAX_COMPONENTS", "MAX_VERTICES"}
    bindings = {}
    for node in ast.parse(source).body:
        if isinstance(node, ast.FunctionDef) and node.name in functions:
            bindings[node.name] = ast.dump(node, include_attributes=False)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in constants:
                    bindings[target.id] = ast.dump(node.value, include_attributes=False)
    if set(bindings) != functions | constants:
        raise ValueError("Incomplete production postprocessing contract")
    return bindings


def frozen_protocol() -> tuple[dict[str, Any], str, dict[str, Any]]:
    protocol_commit = committed(PROTOCOL)
    protocol = read_json(PROTOCOL)
    old_path = REPO / protocol["old_elementwise_result"]
    committed(old_path)
    old = read_json(old_path)
    if protocol["status"] != "frozen" or old["status"] != "failed":
        raise ValueError("The frozen v2 protocol and unchanged failed v1 receipt are required")
    checkpoint = Path(protocol["checkpoint"])
    if sha(checkpoint / "model.safetensors") != protocol["checkpoint_sha256"]:
        raise ValueError("Selected checkpoint drift")
    graph = Path(protocol["onnx_path"])
    if sha(graph) != protocol["onnx_sha256"] or old["onnx_sha256"] != protocol["onnx_sha256"]:
        raise ValueError("V2 must use the preregistered retained graph, not another export")
    if old["opset"] != protocol["opset"]:
        raise ValueError("Export opset differs")
    if [row["chip_id"] for row in old["per_chip"]] != protocol["chip_ids"]:
        raise ValueError("Fixed 20-chip identities differ from v1")
    original_source = subprocess.check_output(
        ["git", "show", f"{protocol_commit}:services/geo/geo/spatial_ml.py"], cwd=REPO, text=True
    )
    if production_contract(Path(production().__file__).read_text()) != production_contract(original_source):
        raise ValueError("Production postprocessing changed since protocol commitment")
    return protocol, protocol_commit, old


def production_instances(native: Any, image: Image.Image, fingerprint: str) -> tuple[list[dict], list, dict]:
    prod = production()
    if len(prod._building_layout(image)) != 1:
        raise ValueError("The frozen 20-chip protocol uses single-tile source chips only")
    labels, scores, palette, _ = prod._building_tile(native, image)
    components, omissions = prod._components(labels, scores, palette, fingerprint)
    masks = [
        rasterize([(component["geometry"], 1)], out_shape=labels.shape, dtype="uint8").astype(bool)
        for component in components
    ]
    return components, masks, omissions


def instance_pairs(reference_masks: list[Any], candidate_masks: list[Any]) -> list[tuple[int, int, float]]:
    ious = mask_iou_matrix(reference_masks, candidate_masks)
    if not ious.size:
        return []
    reference_indices, candidate_indices = linear_sum_assignment(ious, maximize=True)
    return [
        (int(reference_index), int(candidate_index), float(ious[reference_index, candidate_index]))
        for reference_index, candidate_index in zip(reference_indices, candidate_indices)
    ]


def pair_comparison(reference: dict, candidate: dict, iou: float, limits: dict) -> dict[str, Any]:
    score_delta = float(abs(Decimal(str(reference["score"])) - Decimal(str(candidate["score"]))))
    reference_bounds = np.asarray(shape(reference["geometry"]).bounds)
    candidate_bounds = np.asarray(shape(candidate["geometry"]).bounds)
    corner_delta = float(np.max(np.abs(reference_bounds - candidate_bounds)))
    failures = []
    if iou < limits["matched_mask_iou_min"]:
        failures.append("mask_iou")
    if score_delta > limits["matched_absolute_score_delta_max"]:
        failures.append("score_delta")
    if corner_delta > limits["matched_box_corner_delta_max_source_pixels"]:
        failures.append("box_corners")
    return {
        "mask_iou": iou,
        "absolute_score_delta": score_delta,
        "box_corner_delta_source_pixels": corner_delta,
        "reference_score": reference["score"],
        "candidate_score": candidate["score"],
        "reference_bounds": reference_bounds.tolist(),
        "candidate_bounds": candidate_bounds.tolist(),
        "failures": failures,
    }


def unmatched_instances(instances: list[dict], matched: set[int], limits: dict) -> list[dict[str, Any]]:
    return [
        {
            "index": index,
            "score": instance["score"],
            "bounds": list(shape(instance["geometry"]).bounds),
            "threshold_band_exception": instance["score"] <= limits["no_unmatched_score_above"],
        }
        for index, instance in enumerate(instances)
        if index not in matched
    ]


def pair_maxima(pairs: list[dict]) -> dict[str, float | None]:
    return {
        "minimum_matched_mask_iou": min((pair["mask_iou"] for pair in pairs), default=None),
        "maximum_mask_iou_loss": max((1 - pair["mask_iou"] for pair in pairs), default=None),
        "maximum_absolute_score_delta": max((pair["absolute_score_delta"] for pair in pairs), default=None),
        "maximum_box_corner_delta_source_pixels": max(
            (pair["box_corner_delta_source_pixels"] for pair in pairs), default=None
        ),
    }


def compare_instances(
    reference: list[dict], candidate: list[dict], reference_masks: list, candidate_masks: list, limits: dict
) -> dict[str, Any]:
    indices = instance_pairs(reference_masks, candidate_masks)
    pairs = [
        {
            "reference_index": reference_index,
            "candidate_index": candidate_index,
            **pair_comparison(reference[reference_index], candidate[candidate_index], iou, limits),
        }
        for reference_index, candidate_index, iou in indices
    ]
    unmatched_reference = unmatched_instances(reference, {row[0] for row in indices}, limits)
    unmatched_candidate = unmatched_instances(candidate, {row[1] for row in indices}, limits)
    reference_exceptions = sum(row["threshold_band_exception"] for row in unmatched_reference)
    candidate_exceptions = sum(row["threshold_band_exception"] for row in unmatched_candidate)
    adjusted_equal = len(reference) - reference_exceptions == len(candidate) - candidate_exceptions
    unmatched = unmatched_reference + unmatched_candidate
    failures = sorted({failure for pair in pairs for failure in pair["failures"]})
    if not adjusted_equal:
        failures.append("instance_counts")
    if any(not row["threshold_band_exception"] for row in unmatched):
        failures.append("unmatched_above_threshold_band")
    return {
        "status": "failed" if failures else "passed",
        "failures": failures,
        "reference_count": len(reference),
        "candidate_count": len(candidate),
        "raw_counts_equal": len(reference) == len(candidate),
        "exception_adjusted_counts_equal": adjusted_equal,
        "threshold_band_unmatched_count": reference_exceptions + candidate_exceptions,
        "unmatched_reference": unmatched_reference,
        "unmatched_candidate": unmatched_candidate,
        **pair_maxima(pairs),
        "pairs": pairs,
    }


def check_chip(
    reference_session: Any, candidate_session: Any, root: Path, chip: dict, limits: dict, artifact: Path
) -> tuple[dict[str, Any], dict[str, Any]]:
    with Image.open(root / chip["file_name"]) as original:
        image = original.convert("RGB")
    if hashlib.sha256(np.asarray(image).tobytes()).hexdigest() != chip["rgb_pixel_sha256"]:
        raise ValueError("DEV source pixels drift")
    fingerprint = chip["source_image_sha256"]
    reference, reference_masks, reference_omissions = production_instances(reference_session, image, fingerprint)
    candidate, candidate_masks, candidate_omissions = production_instances(candidate_session, image, fingerprint)
    result = compare_instances(reference, candidate, reference_masks, candidate_masks, limits)
    result.update(
        chip_id=chip["source_id"], reference_omissions=reference_omissions, candidate_omissions=candidate_omissions
    )
    reference_array = np.stack(reference_masks) if reference_masks else np.empty((0, image.height, image.width), bool)
    candidate_array = np.stack(candidate_masks) if candidate_masks else np.empty((0, image.height, image.width), bool)
    np.savez_compressed(artifact / f"{chip['source_id']}.npz", reference=reference_array, candidate=candidate_array)
    details = {"chip_id": chip["source_id"], "reference": reference, "candidate": candidate}
    return result, details


def run(protocol: dict, artifact: Path) -> list[dict[str, Any]]:
    root, chips, _ = dev_inputs()
    if [chip["source_id"] for chip in chips] != protocol["chip_ids"]:
        raise ValueError("The selected DEV chips drifted")
    if sha(root / "_annotations.coco.json") != protocol["dev_annotations_sha256"]:
        raise ValueError("DEV COCO drifted")
    reference, _ = session(Path(protocol["checkpoint"]) / "model.safetensors", "cpu")
    candidate, providers = session(Path(protocol["onnx_path"]), "cpu")
    if providers != ["CPUExecutionProvider"]:
        raise ValueError("CPU provider is required")
    rows = []
    with (artifact / "instances.jsonl").open("x", encoding="utf-8") as journal:
        for chip in chips:
            row, details = check_chip(reference, candidate, root, chip, protocol["pass_per_chip"], artifact)
            rows.append(row)
            journal.write(json.dumps(details, separators=(",", ":"), allow_nan=False) + "\n")
    return rows


def result_record(protocol: dict, commit: str, old: dict, rows: list[dict], artifact: Path, seconds: float) -> dict:
    return {
        "schema": "building-instance-parity/2",
        "status": "passed" if all(row["status"] == "passed" for row in rows) else "failed",
        "protocol": PROTOCOL.relative_to(REPO).as_posix(),
        "protocol_commit": commit,
        "protocol_sha256": sha(PROTOCOL),
        "model_sha256": protocol["checkpoint_sha256"],
        "onnx_sha256": protocol["onnx_sha256"],
        "opset": protocol["opset"],
        "providers": ["PyTorch-cpu", "CPUExecutionProvider"],
        "ort_optimization": "ORT_ENABLE_ALL",
        "profile": protocol["profile"],
        "production_source_sha256": sha(Path(production().__file__)),
        "dev_annotations_sha256": protocol["dev_annotations_sha256"],
        "chips": len(rows),
        "passed_chips": sum(row["status"] == "passed" for row in rows),
        "threshold_band_unmatched_count": sum(row["threshold_band_unmatched_count"] for row in rows),
        "per_chip": rows,
        "old_elementwise_result_unchanged": old,
        "v1_qualified": False,
        "registered": False,
        "activated": False,
        "seconds": seconds,
        "artifacts": artifact.as_posix(),
        "holdout_calls": 0,
        "transfer_calls": 0,
        "git_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
    }


def main() -> None:
    configure_offline()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.run_id):
        parser.error("Simple unique run-id required")
    protocol, commit, old = frozen_protocol()
    artifact = RUNS / args.run_id
    artifact.mkdir(exist_ok=False)
    evidence = EVIDENCE / args.run_id
    evidence.mkdir(exist_ok=False)
    started = time.perf_counter()
    rows = run(protocol, artifact)
    result = result_record(protocol, commit, old, rows, artifact, time.perf_counter() - started)
    write_json(artifact / "result.json", result)
    write_json(evidence / "result.json", result)
    print(json.dumps({"status": result["status"], "passed_chips": result["passed_chips"]}))
    if result["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
