"""Offline, source-preserving COCO export of fixed RAMP train/dev inventories.

Uncompressed COCO RLE retains one instance per publisher feature, including
multipart regions and holes. This exports data; it neither admits nor fits it.
"""
import os
os.environ.update(OMP_NUM_THREADS="2", OPENBLAS_NUM_THREADS="2", MKL_NUM_THREADS="2")
import argparse
import ctypes
import importlib.util
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from uuid import UUID

sys.dont_write_bytecode = True


def offline(event, _args):
    if event in {"socket.connect", "socket.bind", "socket.getaddrinfo"}:
        raise RuntimeError("COCO preparation is offline")


sys.addaudithook(offline)
import numpy as np
from PIL import Image


def pin(path):
    path = Path(path)
    data = path.read_bytes()
    return {"path": path.as_posix(), "bytes": len(data), "sha256": sha256(data).hexdigest()}


def checked(info):
    if pin(info["path"]) != {k: info[k] for k in ("path", "bytes", "sha256")}:
        raise ValueError(f"Source pin differs: {info['path']}")
    return Path(info["path"])


def save_json(path, value):
    with Path(path).open("x", encoding="utf-8", newline="\n") as output:
        json.dump(value, output, indent=2)
        output.write("\n")
    return pin(path)


def metadata_identity(source, split):
    """Exclude only the explicitly checked development observation fields."""
    stable = json.loads(json.dumps(source))
    if split == "valid":
        for key in ("status", "purpose", "partition", "developmentReservation", "developmentObservation"):
            stable.pop(key, None)
        for group in stable["groups"]:
            group.pop("split", None)
        stable["tasks"]["building"].pop("status", None)
        for item in stable["tasks"]["building"]["items"]:
            item.pop("pool", None)
            item.pop("split", None)
    encoded = json.dumps(stable, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()
    return sha256(encoded).hexdigest()


def validate_metadata(train, dev):
    # These hashes bind all original identities, assets, frames, terms and groups.
    if metadata_identity(train, "train") != "3698dfba9c0d3fdeb3bff9b58cc1cff2fd4bcd161df345610445fe9a44e94a28":
        raise ValueError("Fixed pending Barishal metadata differs")
    if metadata_identity(dev, "valid") != "ce5e5f5d3e5e778cb7920f264d49060c2129f155fb85e9c0a49576406d1935c2":
        raise ValueError("Fixed Karnataka source/group/asset metadata differs")
    partition = dev["partition"]
    if set(partition) != {"pool", "trainingAllocated", "developmentAllocated", "finalEvaluationAllocated", "unallocatedItems",
                          "protectedOrRetiredEvaluationReopened", "prior19DevelopmentItemsChanged", "globalSplitWrites",
                          "developmentReserved", "reservationStatus"}:
        raise ValueError("Unsupported development partition fields")
    reserved = (partition.get("developmentReserved"), partition.get("developmentAllocated")) == (24, 0)
    observed = (partition.get("developmentReserved"), partition.get("developmentAllocated")) == (0, 24)
    if not (reserved or observed):
        raise ValueError("Require ALL24 Karnataka reserved or observed solely for development")
    for key in ("trainingAllocated", "finalEvaluationAllocated", "unallocatedItems", "globalSplitWrites"):
        if partition.get(key) != 0:
            raise ValueError("Development group cannot enter training/final or become partial")
    for key in ("protectedOrRetiredEvaluationReopened", "prior19DevelopmentItemsChanged"):
        if partition.get(key) is not False:
            raise ValueError("Protected development/evaluation state differs")
    group_split = "development_reserved_pending_preflight" if reserved else "open_development"
    pool = "open-development-feasibility-reservation" if reserved else "open-development-feasibility"
    task_status = "development_reserved_pending_suitability_preflight" if reserved else "open_development_comparison_complete"
    status = "prepared_publisher_human_inventory_development_reserved_pending_preflight" if reserved else "prepared_publisher_human_inventory_open_development_comparison_complete"
    if partition.get("pool") != pool or dev.get("status") != status or dev["tasks"]["building"].get("status") != task_status:
        raise ValueError("Unsupported development metadata state")
    reservation_status = "pending_suitability_preflight_and_comparison_return" if reserved else "suitability_preflight_passed_comparison_complete"
    if partition.get("reservationStatus") != reservation_status:
        raise ValueError("Unsupported development observation transition")
    if any(g["split"] != group_split for g in dev["groups"]) or any(
        item["split"] != group_split or item["pool"] != pool for item in dev["tasks"]["building"]["items"]
    ):
        raise ValueError("All development items must retain the same explicit group role")
    if observed and any(dev["developmentReservation"].get(k) is not True for k in ("trainingExcluded", "finalEvaluationExcluded", "noFitOrPromotion")):
        raise ValueError("Observed development does not grant fit or promotion")
    return "reserved" if reserved else "observed"


def metadata_origin(raw, commit, logical_path):
    """Verify an immutable Git origin without using a later checkout state."""
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Source metadata requires an exact Git commit")
    repository = Path(__file__).resolve().parents[3]
    def git(*args):
        return subprocess.run(["git", "-C", str(repository), *args], check=True, capture_output=True, timeout=10).stdout
    if git("rev-parse", "--verify", commit + "^{commit}").decode().strip() != commit:
        raise ValueError("Source commit differs")
    blob = git("show", commit + ":" + logical_path)
    if json.loads(raw) != json.loads(blob):
        raise ValueError("Input metadata differs from its exact source commit")
    return {"commit": commit, "gitPath": logical_path, "blobOid": git("rev-parse", commit + ":" + logical_path).decode().strip(),
            "blobBytes": len(blob), "blobSha256": sha256(blob).hexdigest(),
            "inputBytes": len(raw), "inputSha256": sha256(raw).hexdigest(),
            "representation": "Exact input bytes retained; Git blob identity recorded separately; parsed JSON equality verified"}


def snapshot_metadata(directory, split, raw, origin):
    path = directory / ("input-" + split + ".json")
    with path.open("xb") as output:
        output.write(raw)
    os.chmod(path, 0o444)
    return {"sourceManifest": pin(path), "sourceOrigin": origin}


def rle_encode(mask):
    flat = mask.astype(np.uint8).ravel(order="F")
    boundaries = np.flatnonzero(flat[1:] != flat[:-1]) + 1
    counts = np.diff(np.concatenate(([0], boundaries, [flat.size]))).tolist()
    if flat[0]:
        counts.insert(0, 0)
    return {"size": list(mask.shape), "counts": counts}


def rle_decode(rle):
    height, width = rle["size"]
    counts = rle["counts"]
    if any(type(n) is not int or n < 0 for n in counts) or sum(counts) != height * width:
        raise ValueError("Invalid COCO uncompressed RLE")
    flat = np.repeat(np.arange(len(counts), dtype=np.uint8) % 2, counts)
    return flat.reshape((height, width), order="F").astype(bool)


def bounded_process():
    if os.name != "nt":
        raise RuntimeError("Use the retained Windows preparation runtime")
    kernel, psapi = ctypes.WinDLL("kernel32"), ctypes.WinDLL("psapi")
    kernel.GetCurrentProcess.restype = ctypes.c_void_p
    handle = kernel.GetCurrentProcess()
    kernel.GetProcessAffinityMask.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(ctypes.c_size_t)]
    kernel.SetProcessAffinityMask.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
    allowed, system = ctypes.c_size_t(), ctypes.c_size_t()
    if not kernel.GetProcessAffinityMask(handle, ctypes.byref(allowed), ctypes.byref(system)):
        raise RuntimeError("Cannot read process affinity")
    cpus = [i for i in range(64) if allowed.value & (1 << i)][:2]
    if not cpus or not kernel.SetProcessAffinityMask(handle, sum(1 << i for i in cpus)):
        raise RuntimeError("Cannot bound preparation to two CPUs")

    class Counters(ctypes.Structure):
        _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong)] + [
            (name, ctypes.c_size_t) for name in ("PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage", "QuotaPagedPoolUsage",
                                                "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage")]

    psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(Counters), ctypes.c_ulong]

    def peak():
        result = Counters()
        result.cb = ctypes.sizeof(result)
        if not psapi.GetProcessMemoryInfo(handle, ctypes.byref(result), result.cb):
            raise RuntimeError("Cannot measure working set")
        if result.PeakWorkingSetSize > 2 * 1024**3:
            raise MemoryError("Preparation exceeded 2 GiB")
        return result.PeakWorkingSetSize

    return cpus, peak


def load_polygon_helper(path):
    # Existing pinned deterministic transfer, without running its acquisition/main.
    for name, source in (("acquire_inputs", path.parent / "acquire_inputs.py"), ("ramp_polygon_helper", path)):
        spec = importlib.util.spec_from_file_location(name, source)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return module.polygon_mask


def feature_mask(feature, frame, height, width, polygon_mask):
    geometry = feature["geometry"]
    if feature.get("properties") != {"label": "building"} or geometry["type"] not in {"Polygon", "MultiPolygon"}:
        raise ValueError("Unsupported publisher feature; no relabelling or dropping")
    a, b, c, d, e, f = frame["pixelEdgeToLonLat"]
    matrix = np.array([[a, b], [d, e]])
    inverse, offset = np.linalg.inv(matrix), np.array([c, f])
    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    result = np.zeros((height, width), dtype=bool)
    pixel_polygons, holes = [], 0
    for rings in polygons:
        region_mask = np.zeros_like(result)
        pixel_rings = []
        for index, ring in enumerate(rings):
            world = np.asarray(ring, dtype=float)
            if world.ndim != 2 or world.shape[1] != 2 or len(world) < 4 or not np.isfinite(world).all() or not np.array_equal(world[0], world[-1]):
                raise ValueError("Unsupported or unclosed source ring")
            pixels = (world - offset) @ inverse.T
            region, selected = polygon_mask(pixels, width, height, center=0.5)
            ring_mask = np.zeros_like(result)
            ring_mask[region] = selected
            if index == 0:
                region_mask |= ring_mask
            else:
                region_mask &= ~ring_mask
                holes += 1
            pixel_rings.append(pixels.tolist())
        result |= region_mask
        pixel_polygons.append(pixel_rings)
    return result, pixel_polygons, holes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-manifest", type=Path, required=True)
    parser.add_argument("--development-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--polygon-helper", type=Path, required=True)
    parser.add_argument("--train-source-commit", required=True, help="Exact Git commit for the Barishal input metadata")
    parser.add_argument("--development-source-commit", required=True, help="Exact Git commit for the Karnataka input metadata")
    args = parser.parse_args()
    cpus, peak = bounded_process()
    train_raw, dev_raw = args.train_manifest.read_bytes(), args.development_manifest.read_bytes()
    train, dev = json.loads(train_raw), json.loads(dev_raw)
    development_state = validate_metadata(train, dev)
    origins = {"train": metadata_origin(train_raw, args.train_source_commit, "docs/orchestration/delivery-reset-20261004/data-building-train-pool-20261005.json"),
               "valid": metadata_origin(dev_raw, args.development_source_commit, "docs/orchestration/delivery-reset-20261004/data-building-shard-20261005.json")}
    polygon_mask = load_polygon_helper(args.polygon_helper.resolve())
    output = args.output.resolve()
    sources = [("train", train, "105001001597B000", 263), ("valid", dev, "104001002CA32300", 178)]
    for split, source, parent, count in sources:
        items = source["tasks"]["building"]["items"]
        if len(items) != 24 or {x["sourceSceneId"] for x in items} != {parent} or sum(x["publisherFeatureCount"] for x in items) != count:
            raise ValueError("Fixed input cohort differs")
        private_root = Path(source["privateRoot"]).resolve()
        if output == private_root or private_root in output.parents:
            raise ValueError("Output cannot be inside an original source root")
        if (output / split).exists():
            raise FileExistsError(f"Export already exists: {output / split}")
    output.mkdir(parents=True, exist_ok=True)
    if (output / "manifest.json").exists():
        raise FileExistsError("Export manifest exists")
    provenance = output / "provenance"
    provenance.mkdir()
    metadata_refs = {"train": snapshot_metadata(provenance, "train", train_raw, origins["train"]),
                     "valid": snapshot_metadata(provenance, "valid", dev_raw, origins["valid"])}
    category = {"id": 1, "name": "rooftop_building", "supercategory": "published_rooftop"}
    mapping, split_records, image_hashes, pixel_hashes = [], [], set(), set()
    image_id, annotation_id = 0, 0
    for split, source, parent, expected_features in sources:
        directory = output / split
        directory.mkdir()
        images, annotations, empty, positive_pixels = [], [], 0, 0
        for item in source["tasks"]["building"]["items"]:
            if item.get("labelStatus") != "independent_published_human_annotation":
                raise ValueError("Unannotated/provisional input cannot become empty truth")
            rgb_path, original_path, label_path = [checked(item[key]) for key in ("image", "originalImage", "rawLabel")]
            label = json.loads(label_path.read_text())
            if label.get("type") != "FeatureCollection" or not isinstance(label.get("features"), list) or "crs" in label:
                raise ValueError("Missing complete WGS84 publisher annotation")
            features = label["features"]
            if len(features) != item["publisherFeatureCount"] or bool(item["sourceEmpty"]) != (len(features) == 0):
                raise ValueError("Source empty/feature count differs")
            frame = item["frame"]
            if frame["crs"] != "EPSG:4326" or not frame["pixelIsArea"]:
                raise ValueError("Unexpected source frame")
            with Image.open(rgb_path) as image:
                rgb = np.array(image)
            with Image.open(original_path) as original:
                original_rgb = np.array(original)
                scale, tie = original.tag_v2[33550], original.tag_v2[33922]
                affine = [scale[0], 0, tie[3] - tie[0] * scale[0], 0, -scale[1], tie[4] + tie[1] * scale[1]]
                if affine != frame["pixelEdgeToLonLat"]:
                    raise ValueError("Original TIFF transform differs")
            height, width = item["height"], item["width"]
            pixel_hash = sha256(rgb.tobytes()).hexdigest()
            if rgb.shape != (height, width, 3) or rgb.dtype != np.uint8 or not np.array_equal(rgb, original_rgb) or pixel_hash != item["rgbPixelSha256"]:
                raise ValueError("RGB transform/source pixels differ")
            if item["originalImage"]["sha256"] in image_hashes or pixel_hash in pixel_hashes:
                raise ValueError("Repeated RGB frame across train/development")
            image_hashes.add(item["originalImage"]["sha256"])
            pixel_hashes.add(pixel_hash)
            image_id += 1
            source_uuid = item["id"].split("/")[-1]
            if str(UUID(source_uuid)) != source_uuid:
                raise ValueError("Noncanonical source UUID")
            file_name = source_uuid + ".png"
            with (directory / file_name).open("xb") as target:
                target.write(rgb_path.read_bytes())
            exported_image = pin(directory / file_name)
            if exported_image["sha256"] != item["image"]["sha256"]:
                raise ValueError("Export image bytes differ")
            images.append({"id": image_id, "file_name": file_name, "width": width, "height": height, "license": 1})
            pixel_vectors = json.loads(checked(item["pixelVectors"]).read_text())
            if pixel_vectors["frame"] != frame or pixel_vectors["sourceLabelSha256"] != item["rawLabel"]["sha256"] or len(pixel_vectors["features"]) != len(features):
                raise ValueError("Retained feature/frame mapping differs")
            union, instances = np.zeros((height, width), dtype=bool), []
            for index, feature in enumerate(features):
                mask, pixels, holes = feature_mask(feature, frame, height, width, polygon_mask)
                retained = pixel_vectors["features"][index]
                if retained["sourceFeatureIndex"] != index or retained["sourceGeometryType"] != feature["geometry"]["type"] or pixels != retained["pixelPolygons"]:
                    raise ValueError("Source-to-pixel feature mapping differs")
                segmentation = rle_encode(mask)
                if not np.array_equal(rle_decode(segmentation), mask):
                    raise ValueError("COCO RLE differs from source instance mask")
                yy, xx = np.nonzero(mask)
                if len(xx) == 0:
                    raise ValueError("Zero-pixel feature requires explicit trainer disposition; no invented pixel")
                bbox = [int(xx.min()), int(yy.min()), int(xx.max() - xx.min() + 1), int(yy.max() - yy.min() + 1)]
                annotation_id += 1
                annotations.append({"id": annotation_id, "image_id": image_id, "category_id": 1, "segmentation": segmentation,
                                    "area": int(mask.sum()), "bbox": bbox, "iscrowd": 0})
                instances.append({"annotationId": annotation_id, "sourceFeatureIndex": index, "publisherFeatureId": feature.get("id"),
                                  "sourceFeatureIdentity": item["rawLabel"]["sha256"] + f"#features/{index}",
                                  "sourceGeometryType": feature["geometry"]["type"], "multipartCount": len(pixels), "holeRingCount": holes,
                                  "maskPixels": int(mask.sum()), "maskPixelSha256": sha256(mask.astype(np.uint8).tobytes()).hexdigest()})
                union |= mask
            target_mask = np.array(Image.open(checked(item["targetMask"])))
            scoring = np.array(Image.open(checked(item["scoringMask"])))
            if not np.array_equal(union, target_mask == 1) or int(union.sum()) != item["positivePixels"] or not (scoring == 1).all():
                raise ValueError("Export instance union/source analysis mask differs")
            empty += int(len(features) == 0)
            positive_pixels += int(union.sum())
            mapping.append({"split": split, "imageId": image_id, "sourceId": item["id"], "sourceGroup": item["groupId"], "sourceParent": parent,
                            "image": exported_image, "originalImage": item["originalImage"], "sourceRgb": item["image"], "rgbPixelSha256": pixel_hash,
                            "rawLabel": item["rawLabel"], "sourceTargetMask": item["targetMask"], "sourceScoringMask": item["scoringMask"],
                            "frame": frame, "rgbTransform": item["rgbTransform"], "annotationStatus": "complete_publisher_human_labels",
                            "sourceEmpty": len(features) == 0, "publisherFeatureCount": len(features), "annotations": instances,
                            "scoringPolicy": item["scoringMaskStatus"], "clippedSourceRings": item["ringsClippedByImageBoundary"]})
            peak()
        if len(annotations) != expected_features:
            raise ValueError("Publisher instance count was changed")
        coco = {"info": {"description": "Published rooftop instances; pending fit admission; no property/base-footprint truth", "version": "1.0", "fit_admission": "not_fit_admitted"},
                "licenses": [{"id": 1, "name": "CC-BY-NC-4.0", "url": "https://creativecommons.org/licenses/by-nc/4.0/"}],
                "images": images, "annotations": annotations, "categories": [category]}
        coco_pin = save_json(directory / "_annotations.coco.json", coco)
        split_records.append({"split": split, "sourceParent": parent, "sourceGroup": source["groups"][0]["id"],
                              **metadata_refs[split],
                              "images": len(images), "instances": len(annotations), "sourceEmptyImages": empty, "unionPositivePixels": positive_pixels,
                              "annotations": coco_pin, "provenance": source.get("dataset", source.get("datasets", [None])[0])})
    loader = {"status": "not_available", "reason": "No compatible pycocotools in retained export runtime; JSON, per-instance RLE and union/pixel/frame checks passed"}
    if importlib.util.find_spec("pycocotools"):
        from pycocotools.coco import COCO
        loaded = 0
        for split in split_records:
            api = COCO(split["annotations"]["path"])
            for annotation in api.anns.values():
                if not np.array_equal(api.annToMask(annotation).astype(bool), rle_decode(annotation["segmentation"])):
                    raise ValueError("Compatible COCO API loader differs")
            loaded += len(api.anns)
        loader = {"status": "passed", "library": "pycocotools.COCO", "annotationsLoaded": loaded}
    manifest = {"schemaVersion": 1, "task": "D06-RAMP-COCO-PREP", "preparedAt": datetime.now(timezone.utc).isoformat(),
                "status": "exported_pending_fit_admission", "datasetRoot": output.as_posix(), "segmentation": "COCO uncompressed RLE, column-major, iscrowd0",
                "category": category, "fitAdmission": "not_fit_admitted", "trainAllocation": "candidate_train_group_only",
                "developmentAllocation": "entire_Karnataka_development_group", "developmentMetadataState": development_state, "finalOrTestSelection": False,
                "splits": split_records, "images": mapping, "sourceInstanceCount": annotation_id, "uniqueRgbFrames": len(pixel_hashes),
                "method": "Unchanged lossless RGB bytes; original TIFF affine; retained pixel-center polygon fill, exterior minus holes, one RLE per original feature clipped only to original frame",
                "checks": {"sourceAndExportRgbPixelsEqual": True, "allInstanceRleRoundtripsEqual": True, "allInstanceUnionsEqualSourceTargets": True,
                           "allFeatureIdentitiesAndPixelVectorsEqual": True, "nullOrUnannotatedTreatedAsEmpty": False, "libraryLoader": loader},
                "resources": {"cpuAffinityLogicalProcessors": cpus, "peakWorkingSetBytes": peak(), "memoryLimitBytes": 2 * 1024**3, "networkRequests": 0, "modelOrFitOrGpuCalls": 0},
                "code": pin(__file__), "retainedPolygonHelper": pin(args.polygon_helper),
                "limitations": ["Publisher human review is documented; local independent audit and RF-DETR pretraining overlap remain unknown.",
                                "Roofprints/partial or obscured features are not ground footprints, property, floors or independent physical-building IDs.",
                                "Source full-frame analysis/absent uncertainty policy and CC-BY-NC/upstream imagery terms remain; no labels were corrected or created."]}
    manifest_pin = save_json(output / "manifest.json", manifest)
    print(json.dumps({"manifest": manifest_pin, "images": image_id, "instances": annotation_id, "splits": [{k: s[k] for k in ("split", "images", "instances", "sourceEmptyImages", "unionPositivePixels")} for s in split_records], "loader": loader}))


if __name__ == "__main__":
    main()
