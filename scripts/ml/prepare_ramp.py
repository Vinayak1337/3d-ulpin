"""Freeze a seeded geography split and source-preserving RAMP COCO instances.

Karnataka: 1000 m EPSG:6933 equal-area grid, whole cells; previously observed
24 chips' cells are DEV-only. Bangladesh: TRAIN only, separate export shards.
No label editing. Source feature -> pixel-centre raster -> one COCO RLE.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import random

import numpy as np
from PIL import Image
import rasterio
from rasterio.features import rasterize
from rasterio.warp import transform_geom
from pyproj import Transformer
from pycocotools import mask as mask_api

REPO = Path(__file__).resolve().parents[2]
EVIDENCE = REPO / "docs/evidence/gf-ai/building"
SEED = 26011
CELL_M = 1000


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def id_hash(ids):
    return hashlib.sha256(("\n".join(sorted(ids)) + "\n").encode()).hexdigest()


def save_new(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as f:
        json.dump(value, f, indent=2, allow_nan=False)
        f.write("\n")


def region_items(root, region, manifest):
    records = [x for x in manifest["files"] if x["region"] == region]
    by_path = {x["path"]: x for x in records}
    directory = root / "originals" / ("ramp_" + region)
    labels = sorted((directory / "labels").glob("*.geojson"))
    images = sorted((directory / "source").glob("*.tif"))
    if not images:
        images = sorted((directory / "images").glob("*.tif"))
    # Publisher uses 'source' in these collections; fail closed on missing pairs.
    image_map = {x.stem: x for x in images}
    if set(image_map) != {x.stem for x in labels} or not labels:
        raise ValueError(f"Incomplete/missing pairs in {region}: images={len(images)} labels={len(labels)}")
    items = []
    to_grid = Transformer.from_crs("EPSG:4326", "EPSG:6933", always_xy=True)
    for label in labels:
        image = image_map[label.stem]
        pins = [by_path[p.relative_to(root / "originals").as_posix()] for p in (image, label)]
        for p, pin in zip((image, label), pins):
            if p.stat().st_size != pin["size"] or sha(p) != pin["sha256"]:
                raise ValueError(f"Source integrity mismatch: {p}")
        doc = json.loads(label.read_bytes())
        if doc.get("type") != "FeatureCollection" or not isinstance(doc.get("features"), list) or "crs" in doc:
            raise ValueError(f"Not complete WGS84 GeoJSON: {label}")
        with rasterio.open(image) as ds:
            if not ds.crs or ds.count != 3 or ds.dtypes != ("uint8", "uint8", "uint8"):
                raise ValueError(f"Unknown frame or unsupported raster: {image}")
            # Reprojection operation is explicit, not inferred from coordinate ranges.
            lonlat = Transformer.from_crs(ds.crs, "EPSG:4326", always_xy=True)
            x, y = ds.transform * (ds.width / 2, ds.height / 2)
            lon, lat = lonlat.transform(x, y)
            gx, gy = to_grid.transform(lon, lat)
            cell = f"6933:{int(np.floor(gx / CELL_M))}:{int(np.floor(gy / CELL_M))}"
            items.append({"id": label.stem, "region": region, "cluster_id": cell, "centroid": [lon, lat], "source_crs": ds.crs.to_string(), "affine": list(ds.transform)[:6], "width": ds.width, "height": ds.height, "source_image": pins[0], "source_label": pins[1], "publisher_features": len(doc["features"]), "empty": not doc["features"]})
    return items


def freeze(items, root):
    groups = defaultdict(list)
    for item in items:
        groups[item["cluster_id"]].append(item)
    prior = json.loads(Path("E:/BhuAayam-data/task-data/d07-karnataka-baseline-20261005/frozen-config.json").read_bytes())
    observed = {x["id"].split("/")[-1] for x in prior["items"]}
    if not observed <= {x["id"] for x in items}:
        raise ValueError("Previously observed Karnataka chips not found")
    forced_dev = {x["cluster_id"] for x in items if x["id"] in observed}
    candidates = sorted(set(groups) - forced_dev)
    random.Random(SEED).shuffle(candidates)
    roles = {x: "dev" for x in forced_dev}
    totals = Counter(dev=sum(len(groups[x]) for x in forced_dev))
    targets = {"holdout": round(.20 * len(items)), "dev": round(.15 * len(items))}
    # A fixed single shuffled pass; no model/label-based choice or seed search.
    for role in ("holdout", "dev"):
        while candidates and totals[role] < targets[role]:
            cluster = candidates.pop(0)
            roles[cluster] = role
            totals[role] += len(groups[cluster])
    roles.update({x: "train" for x in candidates})
    for item in items:
        item["split"] = roles[item["cluster_id"]]
    splits = {}
    for role in ("train", "dev", "holdout"):
        selected = [x for x in items if x["split"] == role]
        ids = sorted(x["id"] for x in selected)
        clusters = sorted(x for x in groups if roles[x] == role)
        if not any(x["empty"] for x in selected):
            raise ValueError(f"No publisher-empty chip in {role}; record gap, never synthesize")
        splits[role] = {"chip_ids": ids, "chip_ids_sha256": id_hash(ids), "cluster_ids": clusters, "cluster_ids_sha256": id_hash(clusters), "chips": len(ids), "empty_chips": sum(x["empty"] for x in selected), "publisher_features": sum(x["publisher_features"] for x in selected)}
    stable_manifest = {"schema": "ramp-karnataka-original-manifest/1", "files": sorted({p["path"]: p for x in items for p in (x["source_image"], x["source_label"])}.values(), key=lambda x: x["path"])}
    for p in (root / "originals/ramp_karnataka_india").glob("*.md"):
        stable_manifest["files"].append(next(x for x in json.loads((root / "manifest.json").read_bytes())["files"] if x["local_path"] == p.as_posix()))
    pdf = root / "originals/ramp_karnataka_india/Documentation.pdf"
    stable_manifest["files"].append(next(x for x in json.loads((root / "manifest.json").read_bytes())["files"] if x["local_path"] == pdf.as_posix()))
    stable_manifest["files"].sort(key=lambda x: x["path"])
    manifest_path = root / "manifest-karnataka.json"
    save_new(manifest_path, stable_manifest)
    index_path = root / "coco/source-index-karnataka.json"
    save_new(index_path, {"items": sorted(items, key=lambda x: x["id"])})
    result = {"schema": "ramp-spatial-split/1", "created_at": datetime.now(timezone.utc).isoformat(), "seed": SEED, "grid": {"crs": "EPSG:6933", "cell_size_m": CELL_M, "origin": [0, 0], "assignment": "floor(projected georeferenced pixel-edge centroid / 1000)", "note": "Global equal-area WGS84 projection; approximately 1 km locally, not source CRS relabelling."}, "assignment": "Fixed shuffled whole cells, cumulative target 20% HOLDOUT then 15% DEV; remaining TRAIN. Prior observed cells reserved DEV before shuffle.", "prior_observed": {"chip_ids": sorted(observed), "dev_only_cluster_ids": sorted(forced_dev), "source": "d07-karnataka-baseline-20261005/frozen-config.json", "reason": "Never place already evaluated chips/cells in frozen holdout or training"}, "bangladesh": {"split": "train", "geography": "Bangladesh", "holdout_access": False}, "source_manifest": {"path": manifest_path.as_posix(), "sha256": sha(manifest_path)}, "splits": splits, "source_index": {"path": index_path.as_posix(), "sha256": sha(index_path)}, "limitations": ["No spatial buffer between adjacent cells; this measures held-out grid-cell performance, not independent acquisition/city performance.", "Installed checkpoint pretraining overlap cannot be ruled out.", "Publisher roof features are not surveyed ground footprints or independent property records."]}
    save_new(EVIDENCE / "split/split.json", result)
    to_ll = Transformer.from_crs("EPSG:6933", "EPSG:4326", always_xy=True)
    features = []
    for cluster, chips in sorted(groups.items()):
        _, ix, iy = cluster.split(":")
        x, y = int(ix) * CELL_M, int(iy) * CELL_M
        ring = [list(to_ll.transform(a, b)) for a, b in [(x, y), (x + CELL_M, y), (x + CELL_M, y + CELL_M), (x, y + CELL_M), (x, y)]]
        features.append({"type": "Feature", "id": cluster, "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": {"cluster_id": cluster, "split": roles[cluster], "chips": len(chips), "empty_chips": sum(x["empty"] for x in chips), "prior_observed": cluster in forced_dev}})
    save_new(EVIDENCE / "split/cluster-map.geojson", {"type": "FeatureCollection", "features": features})
    save_new(EVIDENCE / "data/ramp-summary.json", {"schema": "ramp-acquisition-summary/1", "use": "test_only", "licence": "CC-BY-NC-4.0", "attribution": stable_manifest["files"][0]["attribution"], "karnataka": {"chip_label_pairs": len(items), "files": len(stable_manifest["files"]), "total_bytes": sum(x["size"] for x in stable_manifest["files"]), "manifest": manifest_path.as_posix(), "manifest_sha256": sha(manifest_path)}, "live_manifest": {"path": (root / "manifest.json").as_posix(), "sha256_at_freeze": sha(root / "manifest.json"), "note": "Changes as detached Bangladesh TRAIN-only acquisition progresses; Karnataka pins above are immutable."}, "splits": {k: {x: v[x] for x in ("chips", "empty_chips", "publisher_features", "chip_ids_sha256")} for k, v in splits.items()}, "launch_clearance": "Noncommercial research only; CC BY-NC / upstream imagery terms require owner clearance before operational launch."})
    return result


def export(items, output, role):
    target = output / role
    target.mkdir(parents=True, exist_ok=True)
    annotation_path = target / "_annotations.coco.json"
    if annotation_path.exists():
        # Resume a multi-split export after one split completed. Never replace
        # frozen JSON; validate its source pins/order before reusing it.
        existing = json.loads(annotation_path.read_bytes())
        sources = sorted(items, key=lambda x: (x["region"], x["id"]))
        if len(existing["images"]) != len(sources) or len(existing["annotations"]) != sum(x["publisher_features"] for x in sources):
            raise ValueError("Completed export source counts differ")
        for image, source in zip(existing["images"], sources):
            if image["source_id"] != source["id"] or image["source_image_sha256"] != source["source_image"]["sha256"] or image["source_label_sha256"] != source["source_label"]["sha256"]:
                raise ValueError("Completed export source identity differs")
        print(json.dumps({"export": role, "reuse_frozen": True}), flush=True)
        return {"split": role, "images": len(existing["images"]), "instances": len(existing["annotations"]), "empty_chips": sum(x["empty"] for x in existing["images"]), "zero_pixel_features": len(existing["info"]["zero_pixel_features"]), "annotations_sha256": sha(annotation_path)}
    images, annotations, zero = [], [], []
    # Durable per-image export records survive a worker time box. Never replace
    # originals/PNGs or discard an interrupted export; resume checked records.
    journal_path = target / "export-progress.jsonl"
    cached = {}
    if journal_path.exists():
        for line in journal_path.read_text(encoding="utf-8").splitlines():
            record = json.loads(line)
            if record["method"] != "pixel-centre-declared-crs/2":
                raise ValueError("Partial export method differs; preserve and diagnose")
            cached[(record["image"]["region"], record["image"]["source_id"])] = record
    for image_id, item in enumerate(sorted(items, key=lambda x: (x["region"], x["id"])), 1):
        prior = cached.get((item["region"], item["id"]))
        if prior:
            image = prior["image"]
            if image["id"] != image_id or image["source_image_sha256"] != item["source_image"]["sha256"] or image["source_label_sha256"] != item["source_label"]["sha256"]:
                raise ValueError("Partial export source inventory/order changed")
            rgb = np.asarray(Image.open(target / image["file_name"]))
            if hashlib.sha256(rgb.tobytes()).hexdigest() != image["rgb_pixel_sha256"]:
                raise ValueError("Partial export RGB pixels changed")
            if any(a["id"] != len(annotations) + i + 1 for i, a in enumerate(prior["annotations"])):
                raise ValueError("Partial export instance order changed")
            images.append(image)
            annotations.extend(prior["annotations"])
            zero.extend(prior["zero"])
            continue
        annotation_start, zero_start = len(annotations), len(zero)
        image_path = Path(item["source_image"]["local_path"])
        label_path = Path(item["source_label"]["local_path"])
        doc = json.loads(label_path.read_bytes())
        with rasterio.open(image_path) as ds:
            rgb = ds.read().transpose(1, 2, 0)
            transform = ds.transform
            source_crs = ds.crs
            if not source_crs:
                raise ValueError("Unknown original raster CRS; never infer a zone")
        file_name = item["region"] + "--" + item["id"] + ".png"
        png = target / file_name
        if png.exists():
            if not np.array_equal(np.asarray(Image.open(png)), rgb):
                raise ValueError("Existing derivative differs")
        else:
            with png.open("xb") as f:
                Image.fromarray(rgb).save(f, format="PNG")
        images.append({"id": image_id, "file_name": file_name, "width": item["width"], "height": item["height"], "license": 1, "source_id": item["id"], "region": item["region"], "cluster_id": item["cluster_id"], "source_image_sha256": item["source_image"]["sha256"], "source_label_sha256": item["source_label"]["sha256"], "source_crs": item["source_crs"], "source_affine": item["affine"], "label_crs": "EPSG:4326 (RFC 7946)", "label_to_raster_operation": "identity" if source_crs.to_epsg() == 4326 else "rasterio.warp.transform_geom: EPSG:4326 to declared original raster CRS", "rgb_pixel_sha256": hashlib.sha256(rgb.tobytes()).hexdigest(), "empty": item["empty"]})
        for index, feature in enumerate(doc["features"]):
            if feature["geometry"]["type"] not in ("Polygon", "MultiPolygon") or feature.get("properties", {}).get("label") != "building":
                raise ValueError("Unsupported publisher feature; never silently drop/relabel")
            geometry = feature["geometry"]
            if source_crs.to_epsg() != 4326:
                # RFC 7946 label coordinates are WGS84; use ONLY the GeoTIFF's
                # declared CRS (Dhaka is EPSG:32646), never guess from ranges.
                geometry = transform_geom("EPSG:4326", source_crs, geometry, precision=-1)
            mask = rasterize([(geometry, 1)], out_shape=(item["height"], item["width"]), transform=transform, all_touched=False, dtype="uint8")
            # Same uncompressed column-major RLE as prepare_ramp_coco.py.
            flat = mask.ravel(order="F")
            changes = np.flatnonzero(flat[1:] != flat[:-1]) + 1
            counts = np.diff(np.concatenate(([0], changes, [flat.size]))).tolist()
            if flat[0]:
                counts.insert(0, 0)
            rle = {"size": list(mask.shape), "counts": counts}
            decoded = mask_api.decode(mask_api.frPyObjects(rle, *mask.shape))
            if not np.array_equal(mask, decoded):
                raise ValueError("COCO RLE roundtrip differs")
            yy, xx = np.nonzero(mask)
            bbox = [int(xx.min()), int(yy.min()), int(xx.max() - xx.min() + 1), int(yy.max() - yy.min() + 1)] if len(xx) else [0, 0, 0, 0]
            ann_id = len(annotations) + 1
            annotations.append({"id": ann_id, "image_id": image_id, "category_id": 1, "segmentation": rle, "area": int(mask.sum()), "bbox": bbox, "iscrowd": 0, "source_locator": f"{item['source_label']['sha256']}#features/{index}", "publisher_feature_id": feature.get("id"), "zero_pixel": not len(xx)})
            if not len(xx):
                zero.append({"chip_id": item["id"], "feature_index": index})
        with journal_path.open("a", encoding="utf-8") as checkpoint:
            checkpoint.write(json.dumps({"method": "pixel-centre-declared-crs/2", "image": images[-1], "annotations": annotations[annotation_start:], "zero": zero[zero_start:]}) + "\n")
        if image_id % 500 == 0:
            print(json.dumps({"export": role, "images": image_id, "instances": len(annotations)}), flush=True)
    value = {"info": {"description": "RAMP publisher-reviewed roof instances; test_only; no property/rights truth", "version": "1", "split": role, "rasterization": "Pixel-centre, source affine, exterior minus holes; WGS84 GeoJSON reprojected explicitly to each declared original GeoTIFF CRS with rasterio/PROJ; one instance per original feature, no relabelling", "zero_pixel_policy": "Retain source features with area/bbox zero; evaluator reports raster-unresolvable instances separately, trainer must declare disposition", "zero_pixel_features": zero}, "licenses": [{"id": 1, "name": "CC-BY-NC-4.0", "url": "https://creativecommons.org/licenses/by-nc/4.0/"}], "categories": [{"id": 1, "name": "building", "supercategory": "roofprint"}], "images": images, "annotations": annotations}
    save_new(target / "_annotations.coco.json", value)
    return {"split": role, "images": len(images), "instances": len(annotations), "empty_chips": sum(x["empty"] for x in images), "zero_pixel_features": len(zero), "annotations_sha256": sha(target / "_annotations.coco.json")}


def reject_transfer_training(region: str) -> None:
    prereg_path = REPO / "docs/evidence/gf-ai/preregistration.json"
    if prereg_path.is_file():
        transfer = json.loads(prereg_path.read_bytes()).get("building_mask_transfer", {})
        if transfer.get("status") == "frozen" and transfer.get("region") == region:
            raise ValueError("Region is frozen for transfer HOLDOUT, never TRAIN")


def transfer_shard(root: Path, region: str, target: Path, manifest: dict) -> dict:
    """Reserve a whole Bangladesh region as transfer-only, never a TRAIN shard."""
    if not region.endswith("_bangladesh"):
        raise ValueError("Transfer region must be in Bangladesh")
    target.mkdir(parents=True, exist_ok=False)
    items = region_items(root, region, manifest)
    save_new(target / "source-index.json", {"items": items})
    result = export(items, target / "coco", "transfer")
    result.update(region=region, role="transfer_holdout", source_hashes_verified=True)
    result["source_index"] = {"path": str(target / "source-index.json"), "sha256": sha(target / "source-index.json")}
    save_new(target / "export-result.json", result)
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", type=Path, default=Path("E:/BhuAayam-data/datasets/ramp"))
    p.add_argument("--bangladesh-region", help="Export one completed Bangladesh region as TRAIN-only shard")
    p.add_argument("--transfer-region", help="Export a new independent Bangladesh transfer holdout")
    p.add_argument("--transfer-root", type=Path, help="New external output directory; never an existing TRAIN shard")
    args = p.parse_args()
    root = args.root.resolve()
    manifest = json.loads((root / "manifest.json").read_bytes())
    if args.transfer_region:
        if args.bangladesh_region or not args.transfer_root:
            p.error("Transfer requires --transfer-root and forbids --bangladesh-region")
        print(json.dumps(transfer_shard(root, args.transfer_region, args.transfer_root, manifest)), flush=True)
        return
    if args.bangladesh_region:
        reject_transfer_training(args.bangladesh_region)
        if not args.bangladesh_region.endswith("_bangladesh"):
            raise ValueError("Bangladesh shard must be Bangladesh")
        items = region_items(root, args.bangladesh_region, manifest)
        result = export(items, root / "coco/bangladesh-train", args.bangladesh_region)
        receipt_path = root / "coco/bangladesh-train" / (args.bangladesh_region + "-result.json")
        if receipt_path.exists():
            if json.loads(receipt_path.read_bytes()) != result:
                raise ValueError("Completed Bangladesh export receipt differs")
        else:
            save_new(receipt_path, result)
    else:
        path = EVIDENCE / "split/split.json"
        if path.exists():
            frozen = json.loads(path.read_bytes())
            print("Reuse frozen split, never reassign", flush=True)
        else:
            items = region_items(root, "karnataka_india", manifest)
            if len(items) != 6288:
                raise ValueError(f"Karnataka inventory count differs: {len(items)}")
            frozen = freeze(items, root)
        index_path = Path(frozen["source_index"]["path"])
        if sha(index_path) != frozen["source_index"]["sha256"]:
            raise ValueError("Frozen source index changed")
        items = json.loads(index_path.read_bytes())["items"]
        results = [export([x for x in items if x["split"] == role], root / "coco", role) for role in ("train", "dev", "holdout")]
        receipt = {"splits": results, "source_hashes_verified": True, "rgb_pixels_preserved": True, "rle_roundtrip_verified": True, "source_features_preserved": True}
        receipt_path = EVIDENCE / "data/coco-export.json"
        if receipt_path.exists():
            if json.loads(receipt_path.read_bytes()) != receipt:
                raise ValueError("Frozen Karnataka export receipt differs")
        else:
            save_new(receipt_path, receipt)
        print(json.dumps(results), flush=True)


if __name__ == "__main__":
    main()
