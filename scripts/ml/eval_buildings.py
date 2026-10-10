"""Evaluate frozen RAMP DEV/HOLDOUT using the unchanged production tiling profile.

Main object metrics score the actual production polygon candidates against one
publisher feature per COCO instance. Also reports foreground mask and union
boundary metrics. HOLDOUT reserves one of two logged slots BEFORE model loading;
failed/interrupted attempts consume a slot. No threshold or checkpoint sweeps.
"""
from __future__ import annotations
import os
os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", OMP_NUM_THREADS="2", MKL_NUM_THREADS="2")
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys
import time
from typing import Any

from building_io import sha

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[2]
EVIDENCE = REPO / "docs/evidence/gf-ai/building"
PREREG = REPO / "docs/evidence/gf-ai/preregistration.json"
PROFILE = "rfdetr-rgb432-tile512-stride384-threshold050-mask000-v2"
BASELINE = "rfdetr-satellite-buildings-onnx-v1"


def repo_sha(path):
    """Git text identity survives native Windows autocrlf checkouts."""
    return hashlib.sha256(Path(path).read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def id_hash(ids):
    return hashlib.sha256(("\n".join(sorted(ids)) + "\n").encode()).hexdigest()


def utc():
    return datetime.now(timezone.utc).isoformat()


def git(*args):
    return subprocess.check_output(["git", "-C", str(REPO), *args], timeout=15)


def committed(path):
    relative = path.relative_to(REPO).as_posix()
    try:
        blob = git("show", "HEAD:" + relative)
    except subprocess.CalledProcessError as error:
        raise ValueError(f"HOLDOUT denied: {relative} is not committed") from error
    if blob != path.read_bytes().replace(b"\r\n", b"\n"):
        raise ValueError(f"HOLDOUT denied: {relative} differs from committed HEAD")
    return git("log", "-1", "--format=%H", "--", relative).decode().strip()


def holdout_reserve(args, split, model_sha, split_sha):
    committed(PREREG)
    committed(EVIDENCE / "split/split.json")
    prereg = json.loads(PREREG.read_bytes())["building_mask"]
    expected = split["splits"]["holdout"]
    if prereg["status"] != "frozen" or prereg["split_sha256"] != split_sha:
        raise ValueError("HOLDOUT denied: preregistration/split binding differs")
    for key in ("chip_ids_sha256", "cluster_ids", "cluster_ids_sha256"):
        if prereg["holdout"][key] != expected[key]:
            raise ValueError("HOLDOUT denied: held-out identities differ")
    if not args.holdout_role:
        raise ValueError("HOLDOUT requires --holdout-role baseline|final_candidate")
    log_path = EVIDENCE / "holdout-runs.jsonl"
    lock = EVIDENCE / "holdout-runs.lock"
    with lock.open("x") as f:
        f.write(str(os.getpid()))
    try:
        records = [json.loads(x) for x in log_path.read_text(encoding="utf-8").splitlines()] if log_path.exists() else []
        starts = [x for x in records if x["event"] == "started"]
        if len(starts) >= 2:
            raise ValueError("HOLDOUT denied: two attempts already reserved (including failures)")
        if not starts and args.holdout_role != "baseline":
            raise ValueError("HOLDOUT slot 1 is installed baseline only")
        if starts and (args.holdout_role != "final_candidate" or starts[0]["role"] != "baseline" or not any(x["event"] == "completed" and x["run_id"] == starts[0]["run_id"] for x in records)):
            raise ValueError("HOLDOUT slot 2 requires a completed baseline then final candidate")
        if args.holdout_role == "baseline" and model_sha != prereg["baseline"]["sha256"]:
            raise ValueError("HOLDOUT baseline model hash differs")
        with log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"event": "started", "run_id": args.run_id, "role": args.holdout_role, "attempt": len(starts) + 1, "at": utc(), "git_sha": git("rev-parse", "HEAD").decode().strip(), "model_sha256": model_sha, "split_sha256": split_sha, "preregistration_sha256": repo_sha(PREREG), "pid": os.getpid()}) + "\n")
    finally:
        lock.unlink()
    return log_path


def transfer_inputs(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    prereg = json.loads(PREREG.read_bytes())["building_mask_transfer"]
    root = Path(prereg["data_root"])
    coco_path = root / "coco/transfer/_annotations.coco.json"
    if prereg["status"] != "frozen" or sha(coco_path) != prereg["holdout"]["coco_sha256"]:
        raise ValueError("TRANSFER denied: frozen COCO binding differs")
    if sha(root / "source-index.json") != prereg["holdout"]["source_index_sha256"]:
        raise ValueError("TRANSFER denied: original source inventory changed")
    coco = json.loads(coco_path.read_bytes())
    ids = sorted(image["source_id"] for image in coco["images"])
    if id_hash(ids) != prereg["holdout"]["chip_ids_sha256"]:
        raise ValueError("TRANSFER denied: identities differ")
    if {image["region"] for image in coco["images"]} != {prereg["region"]}:
        raise ValueError("TRANSFER denied: mixed or wrong geography")
    args.root = root
    expected = {**prereg["holdout"], "chip_ids": ids}
    return {"splits": {"transfer": expected}, "limitations": prereg["limitations"]}, prereg


def transfer_reserve(args: argparse.Namespace, model_sha: str, split_sha: str) -> Path:
    prereg_commit = committed(PREREG)
    if not args.selection_result:
        raise ValueError("TRANSFER requires a committed final DEV selection")
    selection_path = args.selection_result.resolve()
    selection_commit = committed(selection_path)
    selection = json.loads(selection_path.read_bytes())
    if selection.get("run_id") != "b4-ka-continue-20261010":
        raise ValueError("TRANSFER denied: selection must compare the finished B4 continuation")
    fallback = EVIDENCE / "b3-final-dev-selection-20261010/result.json"
    if selection.get("comparison_sha256") != sha(fallback):
        raise ValueError("TRANSFER denied: epoch-4 DEV fallback was not compared")
    if not selection.get("final_candidate_fixed") or selection["model_sha256"] != model_sha:
        raise ValueError("TRANSFER denied: fixed DEV-selected model differs")
    finished = Path("E:/BhuAayam-data/ml/runs") / selection["run_id"] / "result.json"
    if not finished.is_file() or json.loads(finished.read_bytes()).get("status") != "passed":
        raise ValueError("TRANSFER denied: continuation has not finished successfully")
    log_path = EVIDENCE / "transfer-runs.jsonl"
    lock = EVIDENCE / "transfer-runs.lock"
    with lock.open("x") as handle:
        handle.write(str(os.getpid()))
    try:
        records = [json.loads(line) for line in log_path.read_text().splitlines()] if log_path.exists() else []
        if any(record["event"] == "started" for record in records):
            raise ValueError("TRANSFER denied: its sole attempt is already consumed")
        append_log(
            log_path,
            "started",
            args.run_id,
            attempt=1,
            model_sha256=model_sha,
            split_sha256=split_sha,
            preregistration_commit=prereg_commit,
            selection_commit=selection_commit,
            git_sha=git("rev-parse", "HEAD").decode().strip(),
        )
    finally:
        lock.unlink()
    return log_path


def append_log(path, event, run_id, **extra):
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"event": event, "run_id": run_id, "at": utc(), **extra}) + "\n")


def production():
    sys.path.insert(0, str(REPO / "services/geo"))
    from geo import spatial_ml
    return spatial_ml


def model_path(value):
    if value in ("onnx", BASELINE):
        path = Path("E:/Projects/3d-ulpin/.runtime/ml-models/building-rfdetr.onnx")
    elif value == "checkpoint":
        path = Path("E:/BhuAayam-data/task-data/d07-rfdetr-train-prep-20261005/original/model.safetensors")
    else:
        path = Path(value)
        if path.is_dir():
            path = path / "model.safetensors"
    if path.suffix not in (".onnx", ".safetensors"):
        raise ValueError("Only ONNX or local safetensors checkpoints accepted; no pickle/trust_remote_code")
    if not path.is_file():
        raise FileNotFoundError(path)
    return path.resolve()


def onnx_resolution(native: Any) -> int:
    resolution = native.get_inputs()[0].shape[-1]
    if not isinstance(resolution, int) or resolution < 432 or resolution % 24:
        raise ValueError("Expected a static model-compatible RF-DETR ONNX input grid")
    return resolution


def session(path, provider):
    if path.suffix == ".onnx":
        import onnxruntime as ort
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        providers = ["CPUExecutionProvider"]
        if provider == "cuda":
            import torch  # Load CUDA/cuDNN DLLs from the pinned PyTorch wheel.
            ort.preload_dlls()
            providers = [("CUDAExecutionProvider", {"gpu_mem_limit": 6 * 1024**3, "arena_extend_strategy": "kSameAsRequested"}), "CPUExecutionProvider"]
        native = ort.InferenceSession(str(path), options, providers=providers)
        native.input_resolution = onnx_resolution(native)
        if provider == "cuda" and native.get_providers()[0] != "CUDAExecutionProvider":
            raise RuntimeError("CUDA provider failed; request explicit CPU fallback, never silent fallback")
        return native, native.get_providers()
    import torch
    from transformers import RfDetrForInstanceSegmentation
    torch.set_num_threads(2)
    if provider == "cuda":
        torch.cuda.set_per_process_memory_fraction(.75)
    # The given file, not an implicit alternate checkpoint, must be loaded.
    if path.name != "model.safetensors":
        raise ValueError("Safetensors checkpoint must be a standard model.safetensors + config.json directory")
    native = RfDetrForInstanceSegmentation.from_pretrained(path.parent, local_files_only=True, use_safetensors=True, attn_implementation="eager").to(provider if provider == "cuda" else "cpu").eval()
    class Adapter:
        input_resolution = native.config.to_dict().get("ulpin_input_resolution", 432)

        def run(self, _outputs, inputs):
            with torch.inference_mode():
                tensor = torch.from_numpy(inputs["image"]).to(provider if provider == "cuda" else "cpu")
                result = native(pixel_values=tensor)
            return result.logits.cpu().numpy(), result.pred_masks.cpu().numpy()
    return Adapter(), ["PyTorch-" + provider]


def threshold_session(native: Any, threshold: float) -> Any:
    """DEV-only threshold calibration while reusing unchanged production painting.

    A monotone logit offset makes production's fixed sigmoid > .5 select exactly
    raw sigmoid > threshold. Geometry/ranking is unchanged; returned scores are
    shifted and must not be presented as calibrated candidate confidences.
    """
    import math
    if threshold == .5:
        return native
    offset = math.log(threshold / (1 - threshold))
    class Adapter:
        input_resolution = getattr(native, "input_resolution", 432)

        def run(self, outputs: Any, inputs: dict[str, Any]) -> tuple[Any, Any]:
            logits, masks = native.run(outputs, inputs)
            return logits - offset, masks
    return Adapter()


def infer(prod, native, image, fingerprint):
    import numpy as np
    layout = prod._building_layout(image)
    labels = np.zeros((image.height, image.width), np.uint8)
    scores = np.zeros(labels.shape, np.float32)
    resolution = getattr(native, "input_resolution", 432)
    if len(layout) == 1:
        labels, scores, palette, _ = prod._building_tile(native, image, resolution)
    else:
        for tile in layout:
            x, y, w, h = (tile[k] for k in ("x", "y", "width", "height"))
            tl, ts, _, _ = prod._building_tile(native, image.crop((x, y, x + w, y + h)), resolution)
            fg = tl > 0
            labels[y:y + h, x:x + w] |= fg.astype(np.uint8)
            np.maximum(scores[y:y + h, x:x + w], np.where(fg, ts, 0), out=scores[y:y + h, x:x + w])
        palette = {0: "background", 1: "building"}
    components, omissions = prod._components(labels, scores, palette, fingerprint)
    from rasterio.features import rasterize
    predictions = [rasterize([(x["geometry"], 1)], out_shape=labels.shape, dtype="uint8").astype(bool) for x in components]
    return predictions, labels > 0, omissions, len(layout)


def building_profile(resolution: int) -> str:
    return f"rfdetr-rgb{resolution}-tile512-stride384-threshold050-mask000-v2"


def record_size_bins(annotations: list[dict], pairs: list[tuple], counts: dict) -> None:
    from diagnose_building_recall import PIXEL_BINS, interval
    matched = {pair[0] for pair in pairs}
    for index, annotation in enumerate(annotations):
        bucket = counts[interval(annotation["area"], PIXEL_BINS)]
        bucket["tp" if index in matched else "fn"] += 1
        bucket["truth_buildings"] += 1


def size_recall(counts: dict) -> dict[str, dict]:
    return {
        label: {**count, "recall": ratio(count["tp"], count["truth_buildings"])}
        for label, count in sorted(counts.items())
    }


def ratio(a, b):
    return a / b if b else None


def mask_iou_matrix(truth: list[Any], predictions: list[Any]) -> Any:
    import numpy as np
    ious = np.zeros((len(truth), len(predictions)), dtype=np.float64)
    for truth_index, truth_mask in enumerate(truth):
        for prediction_index, prediction_mask in enumerate(predictions):
            union = np.count_nonzero(truth_mask | prediction_mask)
            intersection = np.count_nonzero(truth_mask & prediction_mask)
            ious[truth_index, prediction_index] = intersection / union if union else 0
    return ious


def matched_pairs(truth: list[Any], predictions: list[Any]) -> list[tuple[int, int, float]]:
    import numpy as np
    from scipy.optimize import linear_sum_assignment
    ious = mask_iou_matrix(truth, predictions)
    if not ious.size:
        return []
    # Cardinality first, IoU tie-break second; ineligible edges cannot match.
    reward = np.where(ious >= .5, min(ious.shape) + 1 + ious, 0)
    truth_indices, prediction_indices = linear_sum_assignment(reward, maximize=True)
    return [
        (int(truth_index), int(prediction_index), float(ious[truth_index, prediction_index]))
        for truth_index, prediction_index in zip(truth_indices, prediction_indices)
        if ious[truth_index, prediction_index] >= .5
    ]


def match(truth, predictions):
    return [iou for _, _, iou in matched_pairs(truth, predictions)]


def boundary_counts(truth_union, pred_union):
    import numpy as np
    from scipy.ndimage import binary_erosion, distance_transform_edt
    t = truth_union & ~binary_erosion(truth_union, border_value=0)
    p = pred_union & ~binary_erosion(pred_union, border_value=0)
    # 2 SOURCE pixels, Euclidean distance; all chip edges remain scored.
    precision_hits = np.count_nonzero(p & (distance_transform_edt(~t) <= 2)) if t.any() else 0
    recall_hits = np.count_nonzero(t & (distance_transform_edt(~p) <= 2)) if p.any() else 0
    return {"prediction_hits": int(precision_hits), "prediction_boundary_pixels": int(p.sum()), "truth_hits": int(recall_hits), "truth_boundary_pixels": int(t.sum())}


def boundary_summary(counts):
    p = ratio(counts["prediction_hits"], counts["prediction_boundary_pixels"])
    r = ratio(counts["truth_hits"], counts["truth_boundary_pixels"])
    return {**counts, "precision": p, "recall": r, "f1": 2 * p * r / (p + r) if p is not None and r is not None and p + r else (0.0 if p is not None and r is not None else None), "tolerance_source_pixels": 2, "scope": "Micro pooled full-chip foreground union boundaries; includes false boundaries on empty chips"}


def select_contact_rows(rows):
    """Undefined all-empty/no-prediction F1 is not an error or a best score."""
    eligible = [x for x in rows if x[0]["object_f1"] is not None]
    eligible.sort(key=lambda x: (x[0]["object_f1"], x[0]["chip_id"]))
    return eligible if len(eligible) <= 6 else eligible[:3] + eligible[-3:]


def contact_sheet(rows, coco_dir, output):
    import numpy as np
    from PIL import Image, ImageDraw
    from scipy.ndimage import binary_erosion
    ranked = select_contact_rows(rows)
    chosen = [("worst", x) for x in ranked[:3]] + [("best", x) for x in ranked[-3:][::-1]]
    sheet = Image.new("RGB", (3 * 320, 2 * 300), "white")
    draw = ImageDraw.Draw(sheet)
    for n, (kind, (row, truth, pred)) in enumerate(chosen):
        image = np.asarray(Image.open(coco_dir / row["file_name"]).convert("RGB")).copy()
        image[truth & ~binary_erosion(truth, border_value=0)] = [0, 210, 80]
        if pred is not None:
            image[pred & ~binary_erosion(pred, border_value=0)] = [240, 0, 70]
        x, y = n % 3 * 320, n // 3 * 300
        sheet.paste(Image.fromarray(image).resize((256, 256)), (x, y + 35))
        draw.text((x + 2, y + 2), f"{kind} {row['chip_id'][:18]}", fill="black")
        draw.text((x + 2, y + 16), f"TP={row['tp']} FP={row['fp']} FN={row['fn']}", fill="black")
        draw.text((x + 125, y + 16), "green=truth red=pred" if pred is not None else "truth; pred counts only", fill="black")
    sheet.save(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, help="onnx|checkpoint|path to ONNX or safetensors directory")
    parser.add_argument("--split", required=True, choices=("dev", "holdout", "transfer"))
    parser.add_argument("--selection-result", type=Path, help="Committed final DEV selection for transfer")
    parser.add_argument("--root", type=Path, default=Path("E:/BhuAayam-data/datasets/ramp"))
    parser.add_argument("--run-id", default=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    parser.add_argument("--provider", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--artifacts-dir", type=Path, help="New external directory for large execution artifacts")
    parser.add_argument("--size-bins", action="store_true", help="Per-truth pixel-area recall using matched indices")
    parser.add_argument("--holdout-role", choices=("baseline", "final_candidate"))
    parser.add_argument("--score-threshold", type=float, default=.5, help="DEV only; HOLDOUT stays preregistered .5")
    args = parser.parse_args()
    if not 0 < args.score_threshold < 1:
        parser.error("score threshold must be between 0 and 1")
    if args.split in ("holdout", "transfer") and args.score_threshold != .5:
        parser.error("Nondefault HOLDOUT threshold denied before slot reservation")
    if not __import__("re").fullmatch(r"[A-Za-z0-9_-]+", args.run_id):
        parser.error("run-id must be a simple new directory name")
    output = EVIDENCE / args.run_id
    if output.exists():
        raise FileExistsError("Run directory exists; preserve every attempt, never overwrite")
    path = model_path(args.model)
    model_sha = sha(path)
    split_path = EVIDENCE / "split/split.json"
    split = json.loads(split_path.read_bytes())
    split_sha = repo_sha(split_path)
    if args.split == "transfer":
        split, transfer = transfer_inputs(args)
        split_sha = hashlib.sha256(json.dumps(transfer, sort_keys=True).encode()).hexdigest()
    expected = split["splits"][args.split]
    if id_hash(expected["chip_ids"]) != expected["chip_ids_sha256"]:
        raise ValueError("Frozen split id hash differs")
    log = None
    if args.split == "holdout":
        log = holdout_reserve(args, split, model_sha, split_sha)
    elif args.split == "transfer":
        log = transfer_reserve(args, model_sha, split_sha)
    output.mkdir(parents=True)
    artifacts = args.artifacts_dir or output
    if artifacts != output:
        artifacts.mkdir(parents=True, exist_ok=False)
    started = time.perf_counter()
    try:
        import numpy as np
        from PIL import Image
        from pycocotools import mask as mask_api
        prod = production()
        installed = next(x for x in prod._manifest()["models"] if x["id"] == BASELINE)
        if installed["profileVersion"] != PROFILE:
            raise ValueError("Production tiling profile drift")
        if args.model in ("onnx", BASELINE) and model_sha != installed["sha256"]:
            raise ValueError("Installed ONNX hash differs from production registry")
        coco_dir = args.root / "coco" / args.split
        coco_path = coco_dir / "_annotations.coco.json"
        if args.split == "transfer":
            expected_coco = {"annotations_sha256": expected["coco_sha256"]}
        else:
            export_receipt = json.loads((EVIDENCE / "data/coco-export.json").read_bytes())
            expected_coco = next(x for x in export_receipt["splits"] if x["split"] == args.split)
        if sha(coco_path) != expected_coco["annotations_sha256"]:
            raise ValueError("Frozen COCO annotations changed")
        coco = json.loads(coco_path.read_bytes())
        if sorted(x["source_id"] for x in coco["images"]) != expected["chip_ids"]:
            raise ValueError("COCO identities differ from frozen split")
        native, providers = session(path, args.provider)
        native = threshold_session(native, args.score_threshold)
        by_image = defaultdict(list)
        for annotation in coco["annotations"]:
            by_image[annotation["image_id"]].append(annotation)
        rows, selected = [], []
        boundary = defaultdict(int)
        totals = defaultdict(int)
        matched_iou_sum = 0.
        size_counts = defaultdict(lambda: {"tp": 0, "fn": 0, "truth_buildings": 0})
        with (artifacts / "chip-results.jsonl").open("x", encoding="utf-8", buffering=1) as journal:
            for image in coco["images"]:
                tick = time.perf_counter()
                raster = Image.open(coco_dir / image["file_name"]).convert("RGB")
                if hashlib.sha256(np.asarray(raster).tobytes()).hexdigest() != image["rgb_pixel_sha256"]:
                    raise ValueError("Derivative source pixels changed")
                truth = []
                for a in by_image[image["id"]]:
                    rle = a["segmentation"]
                    truth.append(mask_api.decode(mask_api.frPyObjects(rle, *rle["size"])).astype(bool))
                truth_union = np.logical_or.reduce(truth) if truth else np.zeros((raster.height, raster.width), bool)
                predictions, raw_union, omissions, tiles = infer(prod, native, raster, image["source_image_sha256"])
                pred_union = np.logical_or.reduce(predictions) if predictions else np.zeros_like(truth_union)
                pairs = matched_pairs(truth, predictions)
                ious = [pair[2] for pair in pairs]
                if args.size_bins:
                    record_size_bins(by_image[image["id"]], pairs, size_counts)
                tp, fp, fn = len(ious), len(predictions) - len(ious), len(truth) - len(ious)
                bc = boundary_counts(truth_union, pred_union)
                for k, v in bc.items():
                    boundary[k] += v
                empty = len(truth) == 0
                row = {"chip_id": image["source_id"], "cluster_id": image["cluster_id"], "file_name": image["file_name"], "truth_buildings": len(truth), "predicted_buildings": len(predictions), "tp": tp, "fp": fp, "fn": fn, "matched_iou_sum": sum(ious), "object_f1": ratio(2 * tp, 2 * tp + fp + fn), "empty": empty, "false_buildings_on_empty": fp if empty else 0, "boundary": bc, "zero_pixel_truth_features": sum(not t.any() for t in truth), "omissions": omissions, "seconds": time.perf_counter() - tick, "tiles": tiles}
                journal.write(json.dumps(row) + "\n")
                rows.append(row)
                # Bound contact-sheet memory: only best/worst six, never all chips.
                selected = select_contact_rows(selected + [(row, truth_union, pred_union)])
                for key, value in {"tp": tp, "fp": fp, "fn": fn, "truth_buildings": len(truth), "predicted_buildings": len(predictions), "empty_chips": int(empty), "empty_chips_with_false_buildings": int(empty and fp > 0), "false_buildings_on_empty": fp if empty else 0, "zero_pixel_truth_features": row["zero_pixel_truth_features"], "raw_mask_intersection_pixels": int((truth_union & raw_union).sum()), "raw_mask_union_pixels": int((truth_union | raw_union).sum()), "inference_tiles": tiles}.items():
                    totals[key] += value
                matched_iou_sum += sum(ious)
                if len(rows) % 100 == 0:
                    print(json.dumps({"split": args.split, "completed": len(rows), "seconds": time.perf_counter() - started}), flush=True)
        contact_sheet(selected, coco_dir, artifacts / "best-worst.png")
        metrics = {"per_building": {"precision": ratio(totals["tp"], totals["predicted_buildings"]), "recall": ratio(totals["tp"], totals["truth_buildings"]), "tp": totals["tp"], "fp": totals["fp"], "fn": totals["fn"], "precision_denominator_predicted_buildings": totals["predicted_buildings"], "recall_denominator_publisher_buildings": totals["truth_buildings"], "match_iou_threshold": .5, "matching": "Maximum cardinality one-to-one, total IoU tie-break; actual production polygon-candidate masks; zero-pixel source features retained as unmatched"}, "mean_iou_of_matches": {"value": ratio(matched_iou_sum, totals["tp"]), "sum": matched_iou_sum, "denominator_matches": totals["tp"]}, "false_buildings_on_empty": {"buildings": totals["false_buildings_on_empty"], "denominator_empty_chips": totals["empty_chips"], "per_empty_chip": ratio(totals["false_buildings_on_empty"], totals["empty_chips"]), "empty_chips_with_false_buildings": totals["empty_chips_with_false_buildings"]}, "boundary_f1_2px": boundary_summary(boundary), "raw_foreground_iou": {"value": ratio(totals["raw_mask_intersection_pixels"], totals["raw_mask_union_pixels"]), "intersection_pixels": totals["raw_mask_intersection_pixels"], "union_pixels": totals["raw_mask_union_pixels"]}, "abstention": {"failed_chips": 0, "denominator_chips": len(rows), "rate": 0, "note": "Empty predictions are scored, not treated as abstention"}}
        result = {"schema": "building-evaluation/1", "status": "completed", "run_id": args.run_id, "at": utc(), "git_sha": git("rev-parse", "HEAD").decode().strip(), "evaluator_sha256": sha(Path(__file__)), "production_source_sha256": sha(Path(prod.__file__)), "split": args.split, "split_sha256": split_sha, "repository_hash_encoding": "UTF-8 bytes with CRLF normalized to LF, matching Git text blobs", "split_chip_ids_sha256": expected["chip_ids_sha256"], "coco_sha256": sha(coco_path), "model": {"path": path.as_posix(), "sha256": model_sha, "bytes": path.stat().st_size, "id": BASELINE if model_sha == installed["sha256"] else "candidate", "config_sha256": sha(path.parent / "config.json") if path.suffix == ".safetensors" else None}, "profile": {"version": PROFILE, "tiling": installed["preprocessing"]["tiling"], "object_threshold": args.score_threshold, "threshold_calibration": "DEV monotone logit shift; shifted scores are not serving confidences" if args.score_threshold != .5 else None, "mask_logit_threshold": 0, "production_polygons": {"min_pixels": 16, "simplification_pixels": .5, "max_components": 100, "max_vertices": 500}}, "coverage": {"requested_chips": expected["chips"], "completed_chips": len(rows), "zero_pixel_truth_features": totals["zero_pixel_truth_features"], "inference_tiles": totals["inference_tiles"]}, "metrics": metrics, "runtime": {"total_seconds": time.perf_counter() - started, "providers": providers, "python": sys.version, "versions": {k: importlib.metadata.version(k) for k in ("onnxruntime-gpu", "numpy", "pillow", "rasterio", "scipy", "pycocotools")}}, "artifacts": {"contact_sheet": str(artifacts / "best-worst.png"), "per_chip": str(artifacts / "chip-results.jsonl")}, "limitations": split["limitations"] + ["Publisher label completeness/occlusion uncertainty is not independently audited; no relabelling or ignore-mask invention.", "Results are roofprint candidates, not legal/registry or surveyed footprint truth."]}
        resolution = getattr(native, "input_resolution", 432)
        result["profile"]["input_resolution"] = resolution
        result["profile"]["version"] = building_profile(resolution)
        if args.size_bins:
            result["size_recall"] = size_recall(size_counts)
        with (output / "result.json").open("x", encoding="utf-8") as f:
            json.dump(result, f, separators=(",", ":"), allow_nan=False)
            f.write("\n")
        if log:
            append_log(log, "completed", args.run_id, result_sha256=sha(output / "result.json"))
        print(json.dumps(result), flush=True)
    except BaseException as error:
        if log:
            append_log(log, "failed", args.run_id, error_type=type(error).__name__, error=str(error))
        raise


if __name__ == "__main__":
    main()
