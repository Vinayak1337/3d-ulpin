"""Attribute frozen epoch4 DEV TP/FN to publisher geometry, replaying only ambiguous count-only chips."""

from __future__ import annotations

import argparse
from collections import defaultdict
import json
from pathlib import Path
import re
import subprocess
import time
from typing import Any

import numpy as np
from PIL import Image
from pycocotools import mask as mask_api
from pyproj import CRS, Geod, Transformer
import rasterio
from rasterio.transform import Affine
from scipy.ndimage import binary_dilation
from shapely import affinity, ops
from shapely.geometry import box, shape

from building_io import EVIDENCE, REPO, RUNS, configure_offline, read_json, sha, write_json
from eval_buildings import id_hash, infer, matched_pairs, production, session

DEV = Path("E:/BhuAayam-data/datasets/ramp/coco/dev")
ORIGINALS = Path("E:/BhuAayam-data/datasets/ramp/originals")
BASELINE = EVIDENCE / "b3-ka-run1-20261010-epoch004-dev-t050/result.json"
PIXEL_BINS = (0, 16, 64, 128, 256, 512, 1024)
METRE_BINS = (0, 10, 20, 40, 80, 160, 320)
EDGE_BINS = (0, 1, 4, 8, 16, 32, 64)


def inputs() -> tuple[dict, dict[str, dict], dict]:
    receipt = read_json(BASELINE)
    if receipt["split"] != "dev" or sha(DEV / "_annotations.coco.json") != receipt["coco_sha256"]:
        raise ValueError("Frozen DEV annotations differ")
    coco = read_json(DEV / "_annotations.coco.json")
    if id_hash([image["source_id"] for image in coco["images"]]) != receipt["split_chip_ids_sha256"]:
        raise ValueError("Frozen DEV identities differ")
    journal_path = Path(receipt["artifacts"]["per_chip"])
    rows = [json.loads(line) for line in journal_path.read_text().splitlines()]
    if len(rows) != len(coco["images"]):
        raise ValueError("Historical DEV journal is incomplete")
    historical = {row["chip_id"]: row for row in rows}
    if set(historical) != {image["source_id"] for image in coco["images"]}:
        raise ValueError("Historical journal identities differ")
    return coco, historical, receipt


def masks_for(annotations: list[dict]) -> list[np.ndarray]:
    masks = []
    for annotation in annotations:
        rle = annotation["segmentation"]
        mask = mask_api.decode(mask_api.frPyObjects(rle, *rle["size"])).astype(bool)
        if int(mask.sum()) != annotation["area"]:
            raise ValueError("Publisher COCO mask area drift")
        masks.append(mask)
    return masks


def source_metadata(chip: dict) -> tuple[dict, Affine, CRS]:
    folder = ORIGINALS / f"ramp_{chip['region']}"
    image_path = folder / "source" / f"{chip['source_id']}.tif"
    label_path = folder / "labels" / f"{chip['source_id']}.geojson"
    if sha(image_path) != chip["source_image_sha256"] or sha(label_path) != chip["source_label_sha256"]:
        raise ValueError("Original TIFF/GeoJSON hash differs; no geometry repair or guessing")
    with rasterio.open(image_path) as image:
        if image.crs is None or image.width != chip["width"] or image.height != chip["height"]:
            raise ValueError("Source CRS/grid missing or different")
        affine, crs = image.transform, CRS.from_user_input(image.crs)
    return read_json(label_path), affine, crs


def affine_geometry(geometry: Any, affine: Affine) -> Any:
    return affinity.affine_transform(geometry, [affine.a, affine.b, affine.d, affine.e, affine.c, affine.f])


def metric_area(pixel_geometry: Any, affine: Affine, crs: CRS) -> float:
    source_geometry = affine_geometry(pixel_geometry, affine)
    to_geographic = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    geographic = ops.transform(to_geographic.transform, source_geometry)
    area, _ = Geod(ellps="WGS84").geometry_area_perimeter(ops.orient(geographic, sign=1.0))
    return abs(float(area))


def feature_geometry(feature: dict, chip: dict, affine: Affine, crs: CRS) -> dict[str, Any]:
    original = shape(feature["geometry"])
    if not original.is_valid or original.geom_type not in ("Polygon", "MultiPolygon"):
        return {"polygon": None, "area_m2": None, "polygon_area_pixels": None, "edge_pixels": None}
    to_source = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    projected = ops.transform(to_source.transform, original)
    pixel = affine_geometry(projected, ~affine)
    clipped = pixel.intersection(box(0, 0, chip["width"], chip["height"]))
    if clipped.is_empty:
        area, distance = 0.0, None
    else:
        left, top, right, bottom = clipped.bounds
        distance = max(0.0, min(left, top, chip["width"] - right, chip["height"] - bottom))
        area = metric_area(clipped, affine, crs)
    return {"polygon": pixel, "area_m2": area, "polygon_area_pixels": float(clipped.area), "edge_pixels": distance}


def geometries_for(chip: dict, annotations: list[dict]) -> tuple[list[dict], set[str]]:
    document, affine, crs = source_metadata(chip)
    records = []
    property_keys: set[str] = set()
    for annotation in annotations:
        source_hash, locator = annotation["source_locator"].split("#features/")
        if source_hash != chip["source_label_sha256"]:
            raise ValueError("Publisher feature locator/hash differs")
        feature = document["features"][int(locator)]
        if feature.get("properties", {}).get("label") != "building":
            raise ValueError("Unexpected publisher category; never relabel")
        property_keys.update(feature.get("properties", {}))
        records.append(feature_geometry(feature, chip, affine, crs))
    return records, property_keys


def adjacency(records: list[dict], masks: list[np.ndarray]) -> list[dict[str, Any]]:
    all_valid = all(record["polygon"] is not None for record in records)
    information = [
        {"shared_edge": False if all_valid else None, "overlap": False if all_valid else None, "raster_touching": False}
        for _ in records
    ]
    dilated = [binary_dilation(mask) for mask in masks]
    for index, record in enumerate(records):
        for other_index in range(index + 1, len(records)):
            other = records[other_index]["polygon"]
            polygon = record["polygon"]
            if polygon is not None and other is not None:
                shared = polygon.boundary.intersection(other.boundary).length > 0
                overlap = polygon.intersection(other).area > 0
                for target in (index, other_index):
                    if shared:
                        information[target]["shared_edge"] = True
                    if overlap:
                        information[target]["overlap"] = True
            touching = bool(np.any(dilated[index] & masks[other_index]))
            for target in (index, other_index):
                information[target]["raster_touching"] |= touching
    return information


def attribution(
    chip: dict, annotations: list[dict], masks: list, historical: dict, native: Any
) -> tuple[set[int], str]:
    if historical["truth_buildings"] != len(annotations):
        raise ValueError("Historical truth count differs")
    if historical["tp"] == 0:
        return set(), "historical_all_fn"
    if historical["tp"] == len(annotations):
        return set(range(len(annotations))), "historical_all_tp"
    with Image.open(DEV / chip["file_name"]) as original:
        image = original.convert("RGB")
    import hashlib

    if hashlib.sha256(np.asarray(image).tobytes()).hexdigest() != chip["rgb_pixel_sha256"]:
        raise ValueError("DEV derivative pixels drift")
    predictions, _, _, _ = infer(production(), native, image, chip["source_image_sha256"])
    pairs = matched_pairs(masks, predictions)
    if len(pairs) != historical["tp"] or len(predictions) != historical["predicted_buildings"]:
        raise ValueError(
            f"Attribution replay differs from frozen DEV counts on {chip['source_id']}; stop, do not retry"
        )
    return {pair[0] for pair in pairs}, "partial_chip_dev_replay"


def interval(value: float | None, edges: tuple[int, ...]) -> str:
    if value is None:
        return "unknown"
    for lower, upper in zip(edges, edges[1:]):
        if lower <= value < upper:
            return f"[{lower},{upper})"
    return f"[{edges[-1]},inf)"


def bin_keys(row: dict) -> dict[str, str]:
    shared = "unknown" if row["shared_edge"] is None else str(row["shared_edge"]).lower()
    overlap = "unknown" if row["overlap"] is None else str(row["overlap"]).lower()
    return {
        "area_pixels": interval(row["area_pixels"], PIXEL_BINS),
        "area_m2": interval(row["area_m2"], METRE_BINS),
        "edge_pixels": interval(row["edge_pixels"], EDGE_BINS),
        "shared_edge": shared,
        "overlap": overlap,
        "raster_touching_4_neighbour_proxy": str(row["raster_touching"]).lower(),
        "occlusion": "unknown",
        "size_and_shared_edge": f"{interval(row['area_m2'], (0, 40))}|shared_edge={shared}",
    }


def add_bins(bins: dict, row: dict) -> None:
    for dimension, label in bin_keys(row).items():
        count = bins[dimension][label]
        count["tp" if row["matched"] else "fn"] += 1
        count["truth_buildings"] += 1


def bin_results(bins: dict) -> dict[str, dict]:
    return {
        dimension: {
            label: {**count, "recall": count["tp"] / count["truth_buildings"] if count["truth_buildings"] else None}
            for label, count in sorted(groups.items())
        }
        for dimension, groups in bins.items()
    }


def feature_rows(
    chip: dict, annotations: list[dict], records: list[dict], neighbours: list[dict], matched: set[int], method: str
) -> list[dict[str, Any]]:
    return [
        {
            "chip_id": chip["source_id"],
            "annotation_id": annotation["id"],
            "source_locator": annotation["source_locator"],
            "area_pixels": annotation["area"],
            "area_m2": record["area_m2"],
            "continuous_polygon_area_pixels": record["polygon_area_pixels"],
            "edge_pixels": record["edge_pixels"],
            "occlusion": "unknown",
            "matched": index in matched,
            "attribution_method": method,
            **neighbour,
        }
        for index, (annotation, record, neighbour) in enumerate(zip(annotations, records, neighbours))
    ]


def run(coco: dict, historical: dict, receipt: dict, artifact: Path) -> tuple[dict, dict]:
    annotations: dict[int, list] = defaultdict(list)
    for annotation in coco["annotations"]:
        annotations[annotation["image_id"]].append(annotation)
    checkpoint = Path(receipt["model"]["path"])
    if sha(checkpoint) != receipt["model"]["sha256"]:
        raise ValueError("Selected weights drift")
    if sha(checkpoint.parent / "config.json") != receipt["model"]["config_sha256"]:
        raise ValueError("Selected config drift")
    native, _ = session(checkpoint, "cuda")
    bins: dict = defaultdict(lambda: defaultdict(lambda: {"tp": 0, "fn": 0, "truth_buildings": 0}))
    counters: dict = {"partial_chip_dev_replays": 0, "journal_only_chips": 0, "processed_chips": 0}
    property_keys: set[str] = set()
    with (artifact / "truth-attribution.jsonl").open("x", encoding="utf-8") as journal:
        for chip in coco["images"]:
            truth = annotations[chip["id"]]
            masks = masks_for(truth)
            matched, method = attribution(chip, truth, masks, historical[chip["source_id"]], native)
            if truth:
                records, keys = geometries_for(chip, truth)
                property_keys.update(keys)
                neighbours = adjacency(records, masks)
                for row in feature_rows(chip, truth, records, neighbours, matched, method):
                    add_bins(bins, row)
                    journal.write(json.dumps(row, separators=(",", ":"), allow_nan=False) + "\n")
            counters["partial_chip_dev_replays" if method == "partial_chip_dev_replay" else "journal_only_chips"] += 1
            counters["processed_chips"] += 1
            if counters["processed_chips"] % 100 == 0:
                print(json.dumps(counters), flush=True)
    counters["observed_publisher_property_keys"] = sorted(property_keys)
    return bin_results(bins), counters


def gpu_memory() -> dict[str, int]:
    import torch

    return {"peak_cuda_reserved_bytes": torch.cuda.max_memory_reserved(), "budget_bytes": 6 * 1024**3}


def result_record(receipt: dict, bins: dict, counters: dict, artifact: Path, seconds: float) -> dict[str, Any]:
    count = bins["area_pixels"]
    tp, fn = sum(row["tp"] for row in count.values()), sum(row["fn"] for row in count.values())
    expected = receipt["metrics"]["per_building"]
    if tp != expected["tp"] or fn != expected["fn"]:
        raise ValueError("Attribution totals differ from frozen DEV metrics")
    return {
        "schema": "building-recall-diagnosis/1",
        "status": "completed",
        "split": "dev",
        "model_sha256": receipt["model"]["sha256"],
        "coco_sha256": receipt["coco_sha256"],
        "source_receipt": BASELINE.relative_to(REPO).as_posix(),
        "source_journal_sha256": sha(Path(receipt["artifacts"]["per_chip"])),
        **gpu_memory(),
        "tp": tp,
        "fn": fn,
        "truth_buildings": tp + fn,
        "recall": tp / (tp + fn),
        "bins": bins,
        "coverage": counters,
        "seconds": seconds,
        "artifact": artifact.as_posix(),
        "truth_attribution_sha256": sha(artifact / "truth-attribution.jsonl"),
        "definitions": {
            "area_pixels": "Publisher COCO mask pixel count; no area-based dropping, zero-pixel truth retained",
            "area_m2": "Original RFC7946 polygon clipped to declared TIFF chip; WGS84 ellipsoidal geodesic area",
            "edge_pixels": "Minimum clipped truth-polygon distance to a chip edge in source pixel-edge coordinates",
            "shared_edge": "Positive-length intersection of original publisher polygon boundaries, before clipping",
            "overlap": "Positive-area intersection of original publisher polygons, not an occlusion label",
            "raster_touching_4_neighbour_proxy": "Mask overlap or contact after 4-neighbour dilation; proxy only",
            "occlusion": "Unknown; publisher properties do not annotate it; no visual or invented labels",
        },
        "holdout_calls": 0,
        "transfer_calls": 0,
        "training_started": False,
        "git_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
    }


def main() -> None:
    configure_offline()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.run_id):
        parser.error("Simple unique run-id required")
    artifact = RUNS / args.run_id
    artifact.mkdir(exist_ok=False)
    evidence = EVIDENCE / args.run_id
    evidence.mkdir(exist_ok=False)
    coco, historical, receipt = inputs()
    started = time.perf_counter()
    try:
        bins, counters = run(coco, historical, receipt, artifact)
        result = result_record(receipt, bins, counters, artifact, time.perf_counter() - started)
    except Exception as error:
        failure = {"status": "failed", "error": str(error), "artifact": artifact.as_posix(), "holdout_calls": 0}
        write_json(artifact / "failure.json", failure)
        write_json(evidence / "failure.json", failure)
        raise
    write_json(artifact / "result.json", result)
    write_json(evidence / "result.json", result)
    print(json.dumps({"status": result["status"], "recall": result["recall"], "coverage": counters}))


if __name__ == "__main__":
    main()
