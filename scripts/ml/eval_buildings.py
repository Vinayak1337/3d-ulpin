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

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[2]
EVIDENCE = REPO / "docs/evidence/gf-ai/building"
PREREG = REPO / "docs/evidence/gf-ai/preregistration.json"
PROFILE = "rfdetr-rgb432-tile512-stride384-threshold050-mask000-v2"
BASELINE = "rfdetr-satellite-buildings-onnx-v1"


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


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
        def run(self, _outputs, inputs):
            with torch.inference_mode():
                tensor = torch.from_numpy(inputs["image"]).to(provider if provider == "cuda" else "cpu")
                result = native(pixel_values=tensor)
            return result.logits.cpu().numpy(), result.pred_masks.cpu().numpy()
    return Adapter(), ["PyTorch-" + provider]


def infer(prod, native, image, fingerprint):
    import numpy as np
    layout = prod._building_layout(image)
    labels = np.zeros((image.height, image.width), np.uint8)
    scores = np.zeros(labels.shape, np.float32)
    if len(layout) == 1:
        labels, scores, palette, _ = prod._building_tile(native, image)
    else:
        for tile in layout:
            x, y, w, h = (tile[k] for k in ("x", "y", "width", "height"))
            tl, ts, _, _ = prod._building_tile(native, image.crop((x, y, x + w, y + h)))
            fg = tl > 0
            labels[y:y + h, x:x + w] |= fg.astype(np.uint8)
            np.maximum(scores[y:y + h, x:x + w], np.where(fg, ts, 0), out=scores[y:y + h, x:x + w])
        palette = {0: "background", 1: "building"}
    components, omissions = prod._components(labels, scores, palette, fingerprint)
    from rasterio.features import rasterize
    predictions = [rasterize([(x["geometry"], 1)], out_shape=labels.shape, dtype="uint8").astype(bool) for x in components]
    return predictions, labels > 0, omissions, len(layout)


def ratio(a, b):
    return a / b if b else None


def match(truth, predictions):
    import numpy as np
    from scipy.optimize import linear_sum_assignment
    ious = np.zeros((len(truth), len(predictions)), dtype=np.float64)
    for i, t in enumerate(truth):
        for j, p in enumerate(predictions):
            union = np.count_nonzero(t | p)
            ious[i, j] = np.count_nonzero(t & p) / union if union else 0
    if not ious.size:
        return []
    # Cardinality first, IoU tie-break second; ineligible edges cannot match.
    reward = np.where(ious >= .5, min(ious.shape) + 1 + ious, 0)
    ti, pi = linear_sum_assignment(reward, maximize=True)
    return [float(ious[i, j]) for i, j in zip(ti, pi) if ious[i, j] >= .5]


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
    parser.add_argument("--split", required=True, choices=("dev", "holdout"))
    parser.add_argument("--root", type=Path, default=Path("E:/BhuAayam-data/datasets/ramp"))
    parser.add_argument("--run-id", default=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    parser.add_argument("--provider", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--holdout-role", choices=("baseline", "final_candidate"))
    args = parser.parse_args()
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
    expected = split["splits"][args.split]
    if id_hash(expected["chip_ids"]) != expected["chip_ids_sha256"]:
        raise ValueError("Frozen split id hash differs")
    log = holdout_reserve(args, split, model_sha, split_sha) if args.split == "holdout" else None
    output.mkdir(parents=True)
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
        export_receipt = json.loads((EVIDENCE / "data/coco-export.json").read_bytes())
        expected_coco = next(x for x in export_receipt["splits"] if x["split"] == args.split)
        if sha(coco_path) != expected_coco["annotations_sha256"]:
            raise ValueError("Frozen COCO annotations changed")
        coco = json.loads(coco_path.read_bytes())
        if sorted(x["source_id"] for x in coco["images"]) != expected["chip_ids"]:
            raise ValueError("COCO identities differ from frozen split")
        native, providers = session(path, args.provider)
        by_image = defaultdict(list)
        for annotation in coco["annotations"]:
            by_image[annotation["image_id"]].append(annotation)
        rows, selected = [], []
        boundary = defaultdict(int)
        totals = defaultdict(int)
        matched_iou_sum = 0.
        with (output / "chip-results.jsonl").open("x", encoding="utf-8", buffering=1) as journal:
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
                ious = match(truth, predictions)
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
        contact_sheet(selected, coco_dir, output / "best-worst.png")
        metrics = {"per_building": {"precision": ratio(totals["tp"], totals["predicted_buildings"]), "recall": ratio(totals["tp"], totals["truth_buildings"]), "tp": totals["tp"], "fp": totals["fp"], "fn": totals["fn"], "precision_denominator_predicted_buildings": totals["predicted_buildings"], "recall_denominator_publisher_buildings": totals["truth_buildings"], "match_iou_threshold": .5, "matching": "Maximum cardinality one-to-one, total IoU tie-break; actual production polygon-candidate masks; zero-pixel source features retained as unmatched"}, "mean_iou_of_matches": {"value": ratio(matched_iou_sum, totals["tp"]), "sum": matched_iou_sum, "denominator_matches": totals["tp"]}, "false_buildings_on_empty": {"buildings": totals["false_buildings_on_empty"], "denominator_empty_chips": totals["empty_chips"], "per_empty_chip": ratio(totals["false_buildings_on_empty"], totals["empty_chips"]), "empty_chips_with_false_buildings": totals["empty_chips_with_false_buildings"]}, "boundary_f1_2px": boundary_summary(boundary), "raw_foreground_iou": {"value": ratio(totals["raw_mask_intersection_pixels"], totals["raw_mask_union_pixels"]), "intersection_pixels": totals["raw_mask_intersection_pixels"], "union_pixels": totals["raw_mask_union_pixels"]}, "abstention": {"failed_chips": 0, "denominator_chips": len(rows), "rate": 0, "note": "Empty predictions are scored, not treated as abstention"}}
        result = {"schema": "building-evaluation/1", "status": "completed", "run_id": args.run_id, "at": utc(), "git_sha": git("rev-parse", "HEAD").decode().strip(), "evaluator_sha256": sha(Path(__file__)), "production_source_sha256": sha(Path(prod.__file__)), "split": args.split, "split_sha256": split_sha, "repository_hash_encoding": "UTF-8 bytes with CRLF normalized to LF, matching Git text blobs", "split_chip_ids_sha256": expected["chip_ids_sha256"], "coco_sha256": sha(coco_path), "model": {"path": path.as_posix(), "sha256": model_sha, "bytes": path.stat().st_size, "id": BASELINE if model_sha == installed["sha256"] else "candidate", "config_sha256": sha(path.parent / "config.json") if path.suffix == ".safetensors" else None}, "profile": {"version": PROFILE, "tiling": installed["preprocessing"]["tiling"], "object_threshold": .5, "mask_logit_threshold": 0, "production_polygons": {"min_pixels": 16, "simplification_pixels": .5, "max_components": 100, "max_vertices": 500}}, "coverage": {"requested_chips": expected["chips"], "completed_chips": len(rows), "zero_pixel_truth_features": totals["zero_pixel_truth_features"], "inference_tiles": totals["inference_tiles"]}, "metrics": metrics, "runtime": {"total_seconds": time.perf_counter() - started, "providers": providers, "python": sys.version, "versions": {k: importlib.metadata.version(k) for k in ("onnxruntime-gpu", "numpy", "pillow", "rasterio", "scipy", "pycocotools")}}, "artifacts": {"contact_sheet": "best-worst.png", "per_chip": "chip-results.jsonl"}, "limitations": split["limitations"] + ["Publisher label completeness/occlusion uncertainty is not independently audited; no relabelling or ignore-mask invention.", "Results are roofprint candidates, not legal/registry or surveyed footprint truth."]}
        with (output / "result.json").open("x", encoding="utf-8") as f:
            json.dump(result, f, indent=2, allow_nan=False)
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
