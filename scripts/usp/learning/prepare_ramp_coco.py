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
    args = parser.parse_args()
    cpus, peak = bounded_process()
    polygon_mask = load_polygon_helper(args.polygon_helper.resolve())
    train = json.loads(args.train_manifest.read_text())
    dev = json.loads(args.development_manifest.read_text())
    if train.get("fitAdmission") != "not_fit_admitted" or dev["partition"].get("developmentReserved") != 24:
        raise ValueError("Expected pending Barishal fit admission and all24 Karnataka development reservation")
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
                              "sourceManifest": pin(args.train_manifest if split == "train" else args.development_manifest),
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
                "developmentAllocation": "entire_reserved_Karnataka_group", "finalOrTestSelection": False,
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
