"""D07 development diagnostics using the unchanged production ONNX profile.

Predictions, frozen configuration and detailed counts belong outside Git.
This evaluator does not fit, download models or establish a release threshold.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import threading
import time

import numpy as np
from PIL import Image
import psutil
from rasterio.features import rasterize, shapes
from scipy.ndimage import binary_erosion, distance_transform_edt
from scipy.optimize import linear_sum_assignment
from shapely.affinity import affine_transform
from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "services" / "geo"))
from geo import spatial_ml as production

ROOM_IDS = (3, 4, 5, 6, 7, 9, 10, 11)
FULL_REGION = {"x": 0, "y": 0, "width": 1, "height": 1}


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def write_json(path, value):
    with Path(path).open("x", encoding="utf-8", newline="\n") as f:
        json.dump(value, f, indent=2, allow_nan=False)
        f.write("\n")


def read_pinned(pin):
    path = Path(pin["path"])
    if path.stat().st_size != pin["bytes"] or sha(path) != pin["sha256"]:
        raise ValueError(f"Changed cohort file: {path}")
    return path.read_bytes()


def ratios(tp, fp, fn):
    def divide(a, b):
        return a / b if b else None
    return {"tp": int(tp), "fp": int(fp), "fn": int(fn),
            "iou": divide(tp, tp + fp + fn), "precision": divide(tp, tp + fp),
            "recall": divide(tp, tp + fn)}


def confusion(truth, pred, valid, n):
    return np.bincount((truth[valid].astype(int) * n + pred[valid]),
                       minlength=n * n).reshape(n, n)


def class_metrics(counts, names):
    result = []
    for k, name in enumerate(names):
        tp = int(counts[k, k])
        row = ratios(tp, int(counts[:, k].sum()) - tp,
                     int(counts[k].sum()) - tp)
        result.append({"id": k, "name": name, "truthPixels": int(counts[k].sum()),
                       "predictedPixels": int(counts[:, k].sum()), **row})
    present = [r["iou"] for r in result if r["truthPixels"]]
    return {"confusion": counts.tolist(), "classes": result,
            "presentClassMeanIoU": float(np.mean(present)) if present else None,
            "pixelAccuracy": float(np.trace(counts) / counts.sum()) if counts.sum() else None}


def mask_objects(mask, class_id=1):
    # Connected regions are a proxy for rooms, not independent legal units.
    selected = mask == class_id
    return [shape(g) for g, _ in shapes(selected.astype(np.uint8), mask=selected,
                                        connectivity=4)]


def match_objects(truth, pred):
    """Maximum-cardinality one-to-one IoU >= .5; total IoU breaks ties."""
    overlap = np.zeros((len(truth), len(pred)), dtype=float)
    merges = 0
    for j, p in enumerate(pred):
        substantial = 0
        for i, t in enumerate(truth):
            intersection = t.intersection(p).area
            overlap[i, j] = intersection / (t.area + p.area - intersection)
            substantial += intersection / t.area >= .1
        merges += substantial >= 2
    matched = []
    if overlap.size:
        eligible = overlap >= .5
        rows, cols = linear_sum_assignment(np.where(eligible, 1000 + overlap, 0), maximize=True)
        matched = [{"truth": int(i), "prediction": int(j), "iou": float(overlap[i, j])}
                   for i, j in zip(rows, cols) if eligible[i, j]]
    return {**ratios(len(matched), len(pred) - len(matched), len(truth) - len(matched)),
            "truthObjects": len(truth), "predictedObjects": len(pred),
            "mergeCandidates": int(merges), "matches": matched}


def boundary_error(truth, pred, class_id):
    t, p = truth == class_id, pred == class_id
    tb = t & ~binary_erosion(t, border_value=0)
    pb = p & ~binary_erosion(p, border_value=0)
    if not tb.any() or not pb.any():
        return {"distanceSum": 0., "boundarySamples": 0,
                "meanSymmetricPixels": None, "missingPrediction": bool(tb.any() and not pb.any())}
    total = float(distance_transform_edt(~pb)[tb].sum() + distance_transform_edt(~tb)[pb].sum())
    count = int(tb.sum() + pb.sum())
    return {"distanceSum": total, "boundarySamples": count, "meanSymmetricPixels": total / count,
            "missingPrediction": False}


def source_components(components, transform):
    a, b, c, d, e, f = transform["pixelToSource"]
    return [{**p, "geometry": mapping(affine_transform(shape(p["geometry"]), [a, b, d, e, c, f]))}
            for p in components]


def polygon_mask(components, width, height, names):
    if not components:
        return np.zeros((height, width), dtype=np.uint8)
    return rasterize([(p["geometry"], names.index(p["className"])) for p in components],
                     out_shape=(height, width), fill=0, dtype="uint8")


def building_truth_objects(item, valid):
    # Transform existing publisher vectors; never regenerate/replace D06 truth masks.
    features = json.loads(read_pinned(item["rawLabel"]))["features"]
    a, b, c, d, e, f = item["frame"]["pixelEdgeToLonLat"]
    if b != 0 or d != 0:
        raise ValueError("This cohort expects the recorded axis-aligned source affine")
    domain = unary_union(mask_objects(valid.astype(np.uint8)))
    truth, outside = [], 0
    for feature in features:
        g = shape(feature["geometry"])
        if g.geom_type not in ("Polygon", "MultiPolygon") or not g.is_valid:
            raise ValueError("Excluded/nonpolygon/invalid label reached eligible cohort")
        pixel = affine_transform(g, [1 / a, 0, 0, 1 / e, -c / a, -f / e]).intersection(domain)
        if pixel.area:
            truth.append(pixel)
        else:
            outside += 1
    return truth, domain, outside


def dependencies():
    return {p: importlib.metadata.version(p) for p in
            ("numpy", "Pillow", "onnxruntime", "rasterio", "Shapely", "scipy", "psutil")}


def freeze(args, cohort):
    models = production._manifest()["models"]
    for key, task in (("floor_plan", "floor-plan"), ("building", "building")):
        model = next(m for m in models if m["task"] == task)
        for field in ("id", "sha256", "profileVersion"):
            if model[field] != cohort["tasks"][key]["model"][field]:
                raise ValueError("D06 and production model identities differ")
        production._verified_path(model)
    value = {"task": "D07", "developmentOnly": True, "cohortPath": str(args.cohort),
             "cohortSha256": sha(args.cohort), "items": {k: [i["id"] for i in v["items"]]
                                                       for k, v in cohort["tasks"].items()},
             "groups": cohort["groups"], "exclusions": cohort["exclusions"],
             "modelDirectory": str(args.models), "models": models,
             "sourcePins": {str(p.relative_to(REPO)): sha(p) for p in
                            (Path(__file__), REPO / "services/geo/geo/spatial_ml.py",
                             REPO / "services/geo/geo/validation.py", REPO / "services/geo/ml-models.json")},
             "dependencies": dependencies(), "provider": "CPUExecutionProvider", "intraOpThreads": 2,
             "interOpThreads": 1, "timeoutSeconds": 900, "memoryCeilingBytes": 6 * 1024**3,
             "comparison": {
                 "frame": "source pixel edges; unchanged full upright image; no metre inference",
                 "productionMask": "floor cropped argmax mapped by nearest to original; building unchanged source raster",
                 "floorLogitDiagnostic": "crop padding; production half-pixel bilinear resize each logit to source, then argmax; secondary only",
                 "polygonMask": "production simplified/capped components mapped via pixelToSource, center rasterization in returned order",
                 "truth": "use unchanged D06 categorical masks, never bilinear class IDs",
                 "buildingValidity": "scoringMask==1 applied to both masks and object geometry; all-zero RGB is analysis ignore, not publisher NoData",
                 "objects": "IoU >=0.5; maximum cardinality one-to-one, total IoU tie-break; unmatched predictions FP, truth FN",
                 "buildingObjects": "publisher polygon features transformed/clipped to valid domain; retain partial/small features; no label re-rasterization",
                 "floorObjects": "same-class four-connected mask regions for room IDs3,4,5,6,7,9,10,11; proxy, not publisher room-instance/legal-unit truth",
                 "mergeCandidate": "prediction intersects >=10% area of at least two same-class truth objects; diagnostic, may be split/sliver artifact",
                 "boundary": "4-neighbor inner boundaries; symmetric mean Euclidean source-pixel distance; missing predicted class reported separately",
                 "aggregation": "pooled confusion/counts plus per-image/category/AOI; per-present-truth-class IoU, report absent-class false positives",
                 "emptyScenes": "both kept; undefined IoU/recall stay null, all predicted positive pixels/objects count FP",
                 "thresholds": "production object sigmoid>0.5, mask logits>0; floor argmax; min polygon16 processing pixels, simplify0.5pixel, cap100/500vertices",
                 "decision": "diagnostic reuse/correction/adaptation recommendation only; no promotion/pass target or sweep"
             }, "settings": {"requested": "gpt-6.1-sol/xhigh/default-standard1x", "actualTurnSettings": "unexposed",
                              "permissions": "provided never/danger-full-access"}}
    write_json(args.output / "frozen-config.json", value)
    print(json.dumps({"freezeSha256": sha(args.output / "frozen-config.json"), "inputs": 19}), flush=True)


def evaluate(item, task, model, folder, freeze_hash):
    folder.mkdir()
    source = read_pinned(item["image"])
    read_pinned(item["targetMask"])
    truth = np.asarray(Image.open(item["targetMask"]["path"])).copy()
    if "scoringMask" in item:
        read_pinned(item["scoringMask"])
        valid = np.asarray(Image.open(item["scoringMask"]["path"])) == 1
    else:
        valid = np.ones(truth.shape, bool)
    width, height = item["width"], item["height"]
    if truth.shape != (height, width) or valid.shape != truth.shape:
        raise ValueError("Cohort shape mismatch")
    image, transform = production._source_raster(source, "image/png", 1, FULL_REGION, model["task"])
    if (transform["sourceWidth"], transform["sourceHeight"]) != (width, height):
        raise ValueError("Source rotation/dimensions differ from annotation frame")
    # Retain native outputs from the actual production call, without second inference.
    model_path, model_stat = production._verified_path(model)
    original_session = production._session
    captured = []
    class Capture:
        def __init__(self, session):
            self.session = session
        def run(self, names, inputs):
            outputs = self.session.run(names, inputs)
            np.savez_compressed(folder / f"native-{len(captured):02d}.npz",
                                **{f"output{i}": v for i, v in enumerate(outputs)})
            captured.append(outputs[0] if task == "floor_plan" else None)
            return outputs
    production._session = lambda *a: Capture(original_session(*a))
    start = time.perf_counter()
    try:
        labels, scores, palette, score_kind = production._run_model(model, image)
    finally:
        production._session = original_session
    inference_seconds = time.perf_counter() - start
    names = production.ROOMS if task == "floor_plan" else ["background", "building"]
    image.save(folder / "processing-raster.png")
    Image.fromarray(labels).save(folder / "processing-mask.png")
    np.save(folder / "confidence.npy", scores)
    components, omissions = production._components(labels, scores, palette, item["image"]["sha256"])
    components_source = source_components(components, transform)
    processing_classes = labels if task == "floor_plan" else (labels > 0).astype(np.uint8)
    prediction = np.asarray(Image.fromarray(processing_classes).resize((width, height), Image.Resampling.NEAREST))
    poly_prediction = polygon_mask(components_source, width, height, names)
    Image.fromarray(prediction).save(folder / "source-mask.png")
    Image.fromarray(poly_prediction).save(folder / "source-polygon-mask.png")
    write_json(folder / "polygons.json", {"processing": components, "source": components_source,
                                        "transform": transform, "omissions": omissions})
    result = {"id": item["id"], "task": task, "groupId": item["groupId"],
              "category": item.get("category"), "freezeSha256": freeze_hash,
              "source": item["image"], "truthMask": item["targetMask"],
              "transform": transform, "model": {k: model[k] for k in ("id", "sha256", "profileVersion")},
              "providers": original_session(str(model_path), model_stat.st_size,
                                             model_stat.st_mtime_ns).get_providers(),
              "scoreKind": score_kind,
              "inferenceAndNativeRetentionSeconds": inference_seconds, "nativeCalls": len(captured),
              "scoredPixels": int(valid.sum()), "ignoredPixels": int((~valid).sum()),
              "positiveTruthPixelsInIgnoredRegion": int(((truth > 0) & ~valid).sum()),
              "positivePredictionPixelsInIgnoredRegion": int(((prediction > 0) & ~valid).sum()),
              "mask": class_metrics(confusion(truth, prediction, valid, len(names)), names),
              "polygons": class_metrics(confusion(truth, poly_prediction, valid, len(names)), names),
              "polygonization": {"omissions": omissions, "returnedComponents": len(components),
                                  "changedScoredPixels": int(((prediction != poly_prediction) & valid).sum()),
                                  "removedForegroundPixels": int(((prediction > 0) & (poly_prediction == 0) & valid).sum()),
                                  "addedForegroundPixels": int(((prediction == 0) & (poly_prediction > 0) & valid).sum())}}
    if task == "floor_plan":
        logits = captured[0][0, :, :image.height, :image.width]
        best = np.full((height, width), -np.inf, np.float32)
        diagnostic = np.zeros((height, width), np.uint8)
        for k, channel in enumerate(logits):
            resized = production._resize_logits(channel, height, width)
            change = resized > best
            diagnostic[change], best[change] = k, resized[change]
        Image.fromarray(diagnostic).save(folder / "source-logit-argmax.png")
        result["logitDiagnostic"] = class_metrics(confusion(truth, diagnostic, valid, 12), names)
        result["boundary"] = {names[k]: boundary_error(truth, prediction, k)
                              for k in range(12) if (truth == k).any()}
        result["roomComponentProxy"] = {names[k]: {
            "mask": match_objects(mask_objects(truth, k), mask_objects(prediction, k)),
            "polygons": match_objects(mask_objects(truth, k),
                                      [shape(p["geometry"]) for p in components_source if p["className"] == names[k]])}
            for k in ROOM_IDS}
    else:
        objects, domain, outside = building_truth_objects(item, valid)
        raw_objects = [p.intersection(domain) for p in mask_objects(prediction)]
        raw_objects = [p for p in raw_objects if p.area]
        polygon_objects = [shape(p["geometry"]).intersection(domain) for p in components_source]
        polygon_objects = [p for p in polygon_objects if p.area]
        result["objects"] = {"mask": match_objects(objects, raw_objects),
                             "polygons": match_objects(objects, polygon_objects),
                             "truthFeaturesOutsideScoringDomain": outside,
                             "publisherFeatures": item["publisherFeatureCount"]}
        result["emptyTruth"] = not bool(((truth > 0) & valid).any())
        result["tiling"] = production._building_layout(image)
    result["totalItemSeconds"] = time.perf_counter() - start
    result["artifacts"] = {p.name: {"bytes": p.stat().st_size, "sha256": sha(p)}
                           for p in sorted(folder.iterdir()) if p.is_file()}
    write_json(folder / "result.json", result)
    return result


def aggregate(items, names):
    output = {kind: class_metrics(sum((np.array(i[kind]["confusion"]) for i in items),
                                     np.zeros((len(names), len(names)), dtype=np.int64)), names)
              for kind in ("mask", "polygons")}
    output["items"] = len(items)
    output["ignoredPixels"] = sum(i["ignoredPixels"] for i in items)
    output["positiveTruthPixelsInIgnoredRegion"] = sum(i["positiveTruthPixelsInIgnoredRegion"] for i in items)
    output["polygonizationChangedPixels"] = sum(i["polygonization"]["changedScoredPixels"] for i in items)
    if len(names) == 2:
        output["objects"] = {}
        for kind in ("mask", "polygons"):
            values = [i["objects"][kind] for i in items]
            output["objects"][kind] = {**ratios(*(sum(v[k] for v in values) for k in ("tp", "fp", "fn"))),
                                      "mergeCandidates": sum(v["mergeCandidates"] for v in values)}
        output["emptySceneItems"] = [i["id"] for i in items if i["emptyTruth"]]
    return output


def controls():
    truth = np.array([[0, 1], [1, 0]], np.uint8)
    valid = np.array([[1, 1], [0, 1]], bool)
    assert confusion(truth, np.zeros_like(truth), valid, 2).tolist() == [[2, 0], [1, 0]]
    assert match_objects([box(0, 0, 2, 2), box(2, 0, 4, 2)], [box(0, 0, 4, 2)])["fn"] == 1
    assert match_objects([], [box(0, 0, 1, 1)])["fp"] == 1
    assert ratios(0, 0, 0)["iou"] is None
    transformed = source_components([{"geometry": mapping(box(0, 0, 2, 1))}],
                                    {"pixelToSource": [2, 0, 3, 0, 4, 5]})
    assert shape(transformed[0]["geometry"]).bounds == (3., 5., 7., 9.)
    print("PASS: scoring exclusion, one-to-one merge/empty matching, undefined ratios, source affine")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("freeze", "run", "check"))
    parser.add_argument("--cohort", type=Path)
    parser.add_argument("--models", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.action == "check":
        controls()
        return
    os.environ["ML_MODEL_DIR"] = str(args.models)
    cohort = json.loads(args.cohort.read_text(encoding="utf-8"))
    args.output.mkdir(parents=True, exist_ok=True)
    if args.action == "freeze":
        freeze(args, cohort)
        return
    frozen = json.loads((args.output / "frozen-config.json").read_text())
    freeze_hash = sha(args.output / "frozen-config.json")
    if sha(args.cohort) != frozen["cohortSha256"] or dependencies() != frozen["dependencies"]:
        raise ValueError("Changed frozen cohort/environment")
    for path, expected in frozen["sourcePins"].items():
        if sha(REPO / path) != expected:
            raise ValueError(f"Changed execution source: {path}")
    if str(args.models) != frozen["modelDirectory"]:
        raise ValueError("Changed model directory")
    started, peak, stop = time.perf_counter(), [0], threading.Event()
    process = psutil.Process()
    def monitor():
        while not stop.is_set():
            peak[0] = max(peak[0], process.memory_info().rss)
            if peak[0] > frozen["memoryCeilingBytes"] or time.perf_counter() - started > frozen["timeoutSeconds"]:
                print("D07 resource ceiling exceeded", file=sys.stderr, flush=True)
                os._exit(3)
            stop.wait(.1)
    observer = threading.Thread(target=monitor, daemon=True)
    observer.start()
    all_results = []
    models = production._manifest()["models"]
    try:
        for task, spec in cohort["tasks"].items():
            model = next(m for m in models if m["id"] == spec["model"]["id"])
            if model != next(m for m in frozen["models"] if m["id"] == model["id"]):
                raise ValueError("Changed model profile")
            for item in spec["items"]:
                folder = args.output / item["id"].replace("/", "--")
                if folder.exists():
                    result = json.loads((folder / "result.json").read_text())
                    if result["freezeSha256"] != freeze_hash:
                        raise ValueError("Existing result has another configuration")
                    for name, pin in result["artifacts"].items():
                        if sha(folder / name) != pin["sha256"]:
                            raise ValueError("Changed retained prediction")
                    print(f"retained {item['id']}", flush=True)
                else:
                    result = evaluate(item, task, model, folder, freeze_hash)
                    print(json.dumps({"id": item["id"], "seconds": result["totalItemSeconds"],
                                      "iou": result["mask"]["presentClassMeanIoU"]}), flush=True)
                all_results.append(result)
        summary = {"task": "D07", "freezeSha256": freeze_hash, "items": all_results,
                   "aggregate": {}, "groups": {}, "runtime": {
                       "seconds": time.perf_counter() - started, "sampledPeakRSSBytes": peak[0],
                       "provider": "CPUExecutionProvider", "gpuUsed": False, "dependencies": dependencies()}}
        for task in cohort["tasks"]:
            selected = [r for r in all_results if r["task"] == task]
            names = production.ROOMS if task == "floor_plan" else ["background", "building"]
            summary["aggregate"][task] = aggregate(selected, names)
            for group in sorted({r["category"] or r["groupId"] for r in selected}):
                summary["groups"][group] = aggregate([r for r in selected if (r["category"] or r["groupId"]) == group], names)
        write_json(args.output / "results.json", summary)
        print(json.dumps({"complete": len(all_results), "runtime": summary["runtime"]}), flush=True)
    finally:
        stop.set()
        observer.join()
        production._session.cache_clear()


if __name__ == "__main__":
    main()
