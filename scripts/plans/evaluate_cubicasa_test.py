"""Evaluate the unchanged installed CPU model on the frozen 100-plan publisher slice."""
from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from cubicasa_labels import LabelTransfer, verify_retained_transfer
from raster_common import pin, require_fresh_directory, write_json

REPO = Path(__file__).resolve().parents[2]
PRIVATE = Path("E:/BhuAayam-data/task-data/p2")


def validated_plans(root: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    selection = json.loads((root / "selection.json").read_text(encoding="utf-8"))
    if pin(root / "selection.json")["sha256"] != manifest["selection"]["sha256"]:
        raise ValueError("frozen_selection_hash_mismatch")
    plans = manifest["plans"]
    if len(plans) < 100 or [plan["id"] for plan in plans] != selection["ids"]:
        raise ValueError("evaluation_requires_the_exact_frozen_100_plans")
    for plan in plans:
        for original in plan["files"].values():
            if pin(Path(original["path"]))["sha256"] != original["sha256"]:
                raise ValueError("publisher_original_hash_mismatch")
    return plans, selection


def class_confusion(target: np.ndarray, predicted: np.ndarray) -> np.ndarray:
    if target.shape != predicted.shape or max(int(target.max()), int(predicted.max())) >= 12:
        raise ValueError("class_mask_frame_mismatch")
    return np.bincount((target.ravel().astype(np.int64) * 12 + predicted.ravel()), minlength=144).reshape(12, 12)


def class_metrics(confusion: np.ndarray, names: list[str]) -> list[dict[str, Any]]:
    result = []
    for index, name in enumerate(names):
        intersection = int(confusion[index, index])
        truth = int(confusion[index, :].sum())
        predicted = int(confusion[:, index].sum())
        union = truth + predicted - intersection
        result.append({"class": name, "targetPixels": truth, "predictedPixels": predicted,
                       "intersection": intersection, "union": union, "iou": intersection / union if union else None})
    return result


def evaluate_plan(plan: dict[str, Any], transfer: LabelTransfer, output: Path) -> tuple[dict[str, Any], np.ndarray]:
    from geo.raster_plan import segment_bytes

    image_path = Path(plan["files"]["F1_scaled.png"]["path"])
    with Image.open(image_path) as image:
        width, height = image.size
    if width * height > 40_000_000:
        raise ValueError("publisher_image_over_bound")
    target = transfer.target(Path(plan["files"]["model.svg"]["path"]), width, height)
    result = segment_bytes(image_path.read_bytes(), "image/png", 1, {"x": 0, "y": 0, "width": 1, "height": 1})
    predicted_image = Image.fromarray(result.labels).resize((width, height), Image.Resampling.NEAREST)
    confusion = class_confusion(target.labels, np.asarray(predicted_image))
    output.mkdir(parents=True)
    predicted_image.save(output / "prediction.png")
    Image.fromarray(target.labels).save(output / "publisher-target.png")
    predicted_counts = Counter(component["className"] for component in result.rooms)
    from geo.spatial_ml import ROOMS

    source_count = sum(target.room_counts.values())
    predicted_count = len(result.rooms)
    row = {"id": plan["id"], "sourcePixels": [width, height], "modelPixels": list(result.image.size),
           "publisherRoomCount": source_count, "predictedRoomCount": predicted_count,
           "signedCountError": predicted_count - source_count,
           "absoluteCountError": abs(predicted_count - source_count),
           "publisherCountByClass": {ROOMS[index]: count for index, count in target.room_counts.items()},
           "predictedCountByClass": dict(predicted_counts), "omissions": result.omissions,
           "omittedMaskPixels": result.diagnostics["omittedMaskPixels"],
           "smallPublisherWallsSkipped": target.small_walls_skipped,
           "prediction": pin(output / "prediction.png"), "target": pin(output / "publisher-target.png")}
    write_json(output / "result.json", {**row, "confusion": confusion.tolist(), "contours": result.rooms,
                                       "floorRepresentation": result.diagnostics})
    return row, confusion


def summarize(rows: list[dict[str, Any]], confusion: np.ndarray, selection: dict[str, Any]) -> dict[str, Any]:
    from geo.spatial_ml import ROOMS

    metrics = class_metrics(confusion, ROOMS)
    present = [row["iou"] for row in metrics if row["iou"] is not None]
    return {"schemaVersion": "p2-cubicasa-evaluation/1", "plans": len(rows), "classification": "test_only",
            "geography": selection["geography"], "datasetLicense": selection["datasetLicense"],
            "codeModelLicense": selection["codeLicense"], "selectionRule": selection["rule"],
            "perClass": metrics, "meanClassIoU": float(np.mean(present)),
            "pixelAccuracy": int(np.trace(confusion)) / int(confusion.sum()),
            "roomCount": {"publisher": sum(row["publisherRoomCount"] for row in rows),
                          "predicted": sum(row["predictedRoomCount"] for row in rows),
                          "meanSignedError": float(np.mean([row["signedCountError"] for row in rows])),
                          "mae": float(np.mean([row["absoluteCountError"] for row in rows])),
                          "exactPlans": sum(row["absoluteCountError"] == 0 for row in rows)},
            "perPlan": rows, "fineTuning": False, "thresholdTuning": False, "gpuCalls": 0,
            "limitations": ["Architectural-category first-100 diagnostic slice, not category-balanced",
                            "Foreign plans; no Indian or operational accuracy claim",
                            "Checkpoint/population/site overlap not independently audited; not a fresh final holdout",
                            "Source interior Space count versus returned v2 polygons; not instance matching",
                            "Omitted contours and merged same-class regions affect count; no repair or tuning"]}


def evaluation_receipt(root: Path, output: Path, transfer: LabelTransfer, parity: dict[str, Any]) -> dict[str, Any]:
    from geo.raster_plan import installed_model

    files = ("scripts/plans/evaluate_cubicasa_test.py", "scripts/plans/cubicasa_labels.py",
             "scripts/plans/raster_common.py", "services/geo/geo/raster_plan.py", "services/geo/geo/spatial_ml.py")
    return {"command": [sys.executable, *sys.argv], "model": installed_model(),
            "backend": "onnxruntime-cpu", "cudaVisibleDevices": "", "scoresCalibrated": False,
            "sourceManifest": pin(root / "manifest.json"), "selection": pin(root / "selection.json"),
            "fullPrecision": pin(output / "result.json"), "labelHelpers": transfer.pins, "transferParity": parity,
            "code": {name: pin(REPO / name) for name in files}, "python": sys.version.split()[0],
            "dependencies": {name: importlib.metadata.version(name)
                             for name in ("onnxruntime", "rasterio", "Shapely", "numpy", "Pillow")}}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--full-out", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--models", type=Path, required=True)
    args = parser.parse_args()
    if not args.out.resolve().is_relative_to(REPO / "docs/evidence/gf-ai/plans/raster"):
        parser.error("compact output must stay inside the task-owned evidence directory")
    os.environ.update(CUDA_VISIBLE_DEVICES="", ML_MODEL_DIR=str(args.models), OMP_NUM_THREADS="2")
    sys.path.insert(0, str(REPO / "services/geo"))
    plans, selection = validated_plans(args.root)
    transfer = LabelTransfer()
    parity = verify_retained_transfer(transfer)
    output = require_fresh_directory(args.full_out, PRIVATE)
    confusion = np.zeros((12, 12), dtype=np.int64)
    rows = []
    started = time.perf_counter()
    for index, plan in enumerate(plans):
        row, observed = evaluate_plan(plan, transfer, output / plan["id"])
        rows.append(row)
        confusion += observed
        print(f"evaluated {index + 1}/100 {plan['id']}", flush=True)
    result = summarize(rows, confusion, selection)
    result["seconds"] = round(time.perf_counter() - started, 3)
    write_json(output / "result.json", {**result, "confusion": confusion.tolist()})
    result["receipt"] = evaluation_receipt(args.root, output, transfer, parity)
    write_json(args.out, result)
    print(json.dumps({"plans": len(rows), "meanClassIoU": result["meanClassIoU"], "roomCount": result["roomCount"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
