"""One frozen Karnataka development diagnostic using the existing D07 evaluator.

No model/profile/label changes, threshold selection or held-out access. Run is
only for the existing gated Job supervisor; per-item watchdog protects partial
artifacts. Source inventory and owner integrity receipts supply the preflight.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time

# The gated child uses -I; parent -B and PYTHONDONTWRITEBYTECODE do not
# configure its interpreter flag. Set it before any dependency imports.
sys.dont_write_bytecode = True

REPO = Path(__file__).resolve().parents[3]
ENV = Path("E:/BhuAayam-data/task-data/d07-vision-baseline-20261005/env")
MODELS = Path("E:/Projects/3d-ulpin/.runtime/ml-models")
SOURCE = Path("E:/BhuAayam-data/task-data/data-building-shard-20261005")
INPUT_SHA = "4cb9eea381ba7c900de8fc17c3ff821276e3c9997cfd8abc29f92159f638509d"
RESERVATION_SHA = "05b10b5d8025ad97ff3e122bbf0ab686ce8f050ed5f8cf192a2c19913766fadc"
OWNER_SHA = "2d45390a3b58bf69b616e7a4e2369499b6a0ba71afa9ddab772fe390a4326bb7"
PUBLICATION_SHA = "afe84e4bad6a539bfa44bccfd208c045408031b3c8ed081b0d2c34bd0b032ba4"
GROUP = "ramp-MaxarODP-104001002CA32300"
BASELINE = Path("E:/BhuAayam-data/task-data/d07-karnataka-baseline-20261005")
BASELINE_FREEZE_SHA = "9b580000468c6db12e9d74a2ff25e68fa44eed289204e9fd73dd4461acbffe2c"
BASELINE_RESULTS_SHA = "57becbda6d0058e1e07cca834a29965c193ec60c598d040ef2531172980b0dc1"
RECALL_VERSION = "rfdetr-cached-confidence030-mask000/1"


def pin(path):
    path = Path(path)
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024*1024), b""):
            h.update(block)
    return {"path": str(path.resolve()), "bytes": path.stat().st_size, "sha256": h.hexdigest()}


def read(path):
    return json.loads(Path(path).read_bytes())


def save(path, value):
    with Path(path).open("x", encoding="utf-8", newline="\n") as f:
        json.dump(value, f, indent=2, allow_nan=False)
        f.write("\n")


def checked(entry):
    actual = pin(entry["path"])
    if (actual["bytes"], actual["sha256"]) != (entry["bytes"], entry["sha256"]):
        raise ValueError(f"Frozen pin changed: {entry['path']}")
    return Path(entry["path"])


def offline():
    os.environ.update({"OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2",
        "CUDA_VISIBLE_DEVICES": "", "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
        "PYTHONDONTWRITEBYTECODE": "1", "ML_MODEL_DIR": str(MODELS)})
    import psutil
    process = psutil.Process()
    process.cpu_affinity(process.cpu_affinity()[:2])
    if len(process.cpu_affinity()) > 2:
        raise RuntimeError("CPU affinity bound failed")
    denied = []
    events = {"socket.connect", "socket.getaddrinfo", "socket.gethostbyname", "socket.gethostbyaddr",
              "socket.bind", "socket.sendto", "socket.listen", "subprocess.Popen", "os.system", "os.posix_spawn"}
    def audit(event, arguments):
        if event in events:
            denied.append(event)
            if event == "subprocess.Popen":
                # Still deny before execution. Optional NumPy hardware probes
                # catch OSError and use their supported fallback on Windows.
                raise PermissionError("Offline D07 audit denied " + event)
            raise RuntimeError("Offline D07 audit denied " + event)
    sys.addaudithook(audit)
    # Audit fires before any packet/DNS/subprocess action. Flags alone are not
    # the control. This is a tested Python boundary, not an OS egress audit.
    for expected, operation in (
        ("socket.getaddrinfo", lambda: socket.getaddrinfo("offline-control.invalid", 9)),
        ("socket.connect", lambda: connect_control()),
        ("socket.sendto", lambda: udp_control()),
        ("subprocess.Popen", lambda: subprocess.run([sys.executable, "-c", "raise SystemExit(99)"], check=True))):
        before = len(denied)
        try:
            operation()
        except (RuntimeError, PermissionError):
            if denied[before:] != [expected]:
                raise
        else:
            raise RuntimeError("Network/subprocess denial control did not fire")
    return denied


def connect_control():
    with socket.socket() as probe:
        probe.connect(("127.0.0.1", 9))


def udp_control():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.sendto(b"denied-before-send", ("127.0.0.1", 9))


def evaluator():
    # Gated supervisor starts a stdlib base interpreter. Select the previously
    # verified ABI-compatible packages explicitly before native imports.
    sys.path[:0] = [str(ENV / "Lib/site-packages"), str(Path(__file__).parent)]
    import evaluate_vision_cohort as evaluate
    return evaluate


def freeze(root, denied):
    e = evaluator()
    import onnxruntime
    input_path = root / "accepted-input-inventory.json"
    raw = input_path.read_bytes()
    if len(raw) != 162561 or hashlib.sha256(raw).hexdigest() != INPUT_SHA:
        raise ValueError("Accepted exact Git inventory blob changed")
    cohort = json.loads(raw)
    reservation_path = root / "published-development-reservation.json"
    if pin(reservation_path)["sha256"] != RESERVATION_SHA:
        raise ValueError("Published development reservation changed")
    reservation = read(reservation_path)
    allocation = reservation["developmentReservation"]
    if (allocation["task"], allocation["groupId"], allocation["reservedItems"], allocation["allItemsTogether"],
        allocation["trainingExcluded"], allocation["finalEvaluationExcluded"]) != (
            "D07-KARNATAKA-BASELINE", GROUP, 24, True, True, True):
        raise ValueError("Development reservation scope mismatch")
    old_items = cohort["tasks"]["building"]["items"]
    items = reservation["tasks"]["building"]["items"]
    def without_allocation(item):
        return {k: v for k, v in item.items() if k not in {"pool", "split"}}
    if len(old_items) != len(items) or any(without_allocation(a) != without_allocation(b) for a, b in zip(old_items, items)):
        raise ValueError("Reservation changed source/label/frame/scoring entries")
    if any(i["split"] != "development_reserved_pending_preflight" or i["pool"] != "open-development-feasibility-reservation" for i in items):
        raise ValueError("Unexpected item allocation")
    owner_path = SOURCE / "verification.json"
    if pin(owner_path)["sha256"] != OWNER_SHA:
        raise ValueError("Owner integrity receipt changed")
    owner = read(owner_path)
    publication_path = SOURCE / "publication-verification.json"
    if pin(publication_path)["sha256"] != PUBLICATION_SHA:
        raise ValueError("Owner publication receipt changed")
    publication = read(publication_path)
    if owner["status"] != "passed" or publication["status"] != "passed":
        raise ValueError("Source qualification preflight failed")
    if len(items) != 24 or {i["groupId"] for i in items} != {GROUP}:
        raise ValueError("The whole scene must remain one 24-item development group")
    if sum(not i["sourceEmpty"] for i in items) != 19 or sum(i["sourceEmpty"] for i in items) != 5:
        raise ValueError("Unexpected positive/empty denominators")
    for item in items:
        if (item["width"], item["height"], item["scoredPixels"]) != (256, 256, 65536):
            raise ValueError("Unsupported source scoring frame")
        frame = item["frame"]
        a, b, c, d, f, g = frame["pixelEdgeToLonLat"]
        if frame["crs"] != "EPSG:4326" or b or d or a <= 0 or f >= 0 or not frame["pixelIsArea"]:
            raise ValueError("Unsupported source affine")
        if item["referenceParityDifferentPixels"] or item["labelStatus"] != "independent_published_human_annotation":
            raise ValueError("Publisher-label registration preflight failed")
        if item["rgbTransform"] != "Lossless uint8 RGB TIFF-to-PNG; no stretch/resample/crop":
            raise ValueError("Unexpected image derivative")
    model, = [m for m in e.production._manifest()["models"] if m["task"] == "building"]
    if model["profileVersion"] != "rfdetr-rgb432-tile512-stride384-threshold050-mask000-v2":
        raise ValueError("Production profile drift")
    model_path, stat = e.production._verified_path(model)  # One retained-weight pin, no session/inference.
    frozen = {"task": "D07-KARNATAKA-BASELINE", "atUtc": datetime.now(timezone.utc).isoformat(),
        "developmentOnly": True, "groupReservation": {"id": GROUP, "items": 24, "parentScene": "104001002CA32300",
            "allocation": "new_open_development_all24", "training": False, "finalEvaluation": False,
            "authority": "lead assignment; integrator owns shared reservation publication"},
        "inputInventory": pin(input_path), "acceptedSourceCommit": "addbf2399255a864d45f275ce57f6ad9c0687b1c",
        "publishedReservation": pin(reservation_path), "publishedAllocation": allocation,
        "ownerIntegrity": pin(owner_path), "ownerPublication": pin(SOURCE / "publication-verification.json"),
        "model": model, "modelPath": str(model_path), "modelDirectory": str(MODELS),
        "items": items, "sourcePolicy": cohort["datasets"], "sourceLimitations": cohort["limitations"],
        "sourcePins": [pin(p) for p in (Path(__file__), Path(e.__file__), REPO / "services/geo/geo/spatial_ml.py",
            REPO / "services/geo/geo/validation.py", REPO / "services/geo/ml-models.json",
            REPO / "scripts/usp/document-models/run_trial.py", root / "supervise.py")],
        "environment": {"path": str(ENV), "dependencies": e.dependencies(), "python": sys.version,
            "lock": pin(ENV.parent / "environment-lock.txt"),
            "packageOrigins": {"numpy": e.np.__file__, "onnxruntime": onnxruntime.__file__},
            "basePrefix": sys.base_prefix, "executable": sys.executable,
            "provider": "CPUExecutionProvider", "intraOpThreads": 2, "interOpThreads": 1},
        "isolation": {"control": "existing run_trial gated Windows Job plus tested Python socket/subprocess audit denial",
            "positiveNetworkAndSubprocessDenialControls": denied[:4], "allDeniedEvents": denied.copy(),
            "subprocessPolicy": "All subprocesses denied before execution with PermissionError; NumPy optional lscpu probe catches OSError and falls back. No allowed subprocesses.",
            "cpuAffinity": __import__("psutil").Process().cpu_affinity(), "offlineFlagsSupplementOnly": True,
            "osEgressAudit": False, "noExternalApiOrImplicitDownload": True},
        "bounds": {"cpuThreads": 2, "jobMemoryBytes": 6*1024**3, "totalSeconds": 1200, "perItemSeconds": 120, "gpu": False},
        "metrics": {"mask": "source-frame binary rooftop mask IoU/precision/recall and pooled/per-item confusion",
            "polygon": "unchanged production components, simplified0.5pixel/min16pixels/cap100/500vertices; center rasterization",
            "objects": "existing evaluator: maximum-cardinality one-to-one IoU>=0.5, totalIoU tie-break; raw publisher features clipped to full source domain; raw mask connected regions and final polygons scored separately",
            "mergeDiagnostic": "prediction intersects>=10% of at least two truth features; not independent physical-building identity",
            "emptyScenes": "keep all5; report foreground FP pixels/objects and sceneFP count; undefined IoU/recall remain null",
            "coverage": "completed/failed source items, native calls, ignored/outside objects, polygon omissions/loss and errors",
            "thresholds": "unchanged object sigmoid>0.5 / mask logit>0, profile432tile512stride384; no sweep or success threshold"},
        "scoringPolicy": "Full-frame scoringMask==1 (all256x256 pixels). Analysis policy, not publisher ignore truth; publisher ignore/per-feature ambiguity metadata absent. Raw masks and originals unchanged.",
        "qualifications": "Published human rooftop labels and source-registration receipt suitable for this bounded development feasibility comparison. No local relabelling required for this scope. Unknown RF-DETR pretraining overlap, source30cm/40cm conflict and EPSG4326 angular affine retained; no cadastral/rights/physical-building/global/final/release qualification.",
        "settings": {"requested": "gpt-6.1-sol/xhigh/default-standard1x", "observed": "unexposed", "permissions": "never/danger-full-access"}}
    save(root / "frozen-config.json", frozen)
    print(json.dumps({"preflight": "passed", "items": 24, "positive": 19, "empty": 5,
        "freeze": pin(root / "frozen-config.json"), "dependencies": e.dependencies(), "networkDenial": denied}), flush=True)


def run(root, denied):
    e = evaluator()
    frozen = read(root / "frozen-config.json")
    for entry in frozen["sourcePins"] + [frozen["inputInventory"], frozen["publishedReservation"],
        frozen["ownerIntegrity"], frozen["ownerPublication"], frozen["environment"]["lock"]]:
        checked(entry)
    if e.dependencies() != frozen["environment"]["dependencies"]:
        raise ValueError("Frozen runtime dependency drift")
    if frozen["model"] != next(m for m in e.production._manifest()["models"] if m["task"] == "building"):
        raise ValueError("Frozen model/profile drift")
    output = root / "raw"
    output.mkdir()  # Refuse unchanged retries/overwriting old predictions.
    started = time.perf_counter()
    results = []
    try:
        for item in frozen["items"]:
            if time.perf_counter() - started >= 1200:
                raise RuntimeError("total comparison deadline reached")
            save(root / f"started-{len(results):02d}.json", {"id": item["id"], "atUtc": datetime.now(timezone.utc).isoformat()})
            def expire():
                print("per_item_deadline_exceeded:" + item["id"], file=sys.stderr, flush=True)
                os._exit(3)
            timer = threading.Timer(min(120, 1200 - (time.perf_counter() - started)), expire)
            timer.daemon = True
            timer.start()
            try:
                result = e.evaluate(dict(item, category="Karnataka"), "building", frozen["model"],
                    output / item["id"].replace("/", "--"), pin(root / "frozen-config.json")["sha256"])
            finally:
                timer.cancel()
                timer.join()
            if result["providers"] != ["CPUExecutionProvider"]:
                raise ValueError("Unexpected execution provider")
            results.append(result)
            print(json.dumps({"id": item["id"], "completed": len(results), "seconds": result["totalItemSeconds"],
                "foregroundIoU": result["mask"]["classes"][1]["iou"], "empty": result["emptyTruth"]}), flush=True)
        aggregate = e.aggregate(results, ["background", "building"])
        empty = [i for i in results if i["emptyTruth"]]
        empty_fp = [i for i in empty if i["mask"]["classes"][1]["fp"]]
        summary = {"task": frozen["task"], "status": "completed", "freeze": pin(root / "frozen-config.json"),
            "items": results, "aggregate": aggregate, "coverage": {"requestedItems": 24, "completedItems": len(results),
                "positiveItems": sum(not i["emptyTruth"] for i in results), "emptyItems": len(empty),
                "nativeCalls": sum(i["nativeCalls"] for i in results), "totalSourcePixels": sum(i["scoredPixels"] for i in results),
                "publisherFeatures": sum(i["objects"]["publisherFeatures"] for i in results),
                "outsideScoringDomain": sum(i["objects"]["truthFeaturesOutsideScoringDomain"] for i in results)},
            "emptyScenes": {"items": len(empty), "itemsWithForegroundFalsePositives": len(empty_fp),
                "falsePositivePixels": sum(i["mask"]["classes"][1]["fp"] for i in empty),
                "falsePositiveMaskObjects": sum(i["objects"]["mask"]["fp"] for i in empty),
                "falsePositivePolygonObjects": sum(i["objects"]["polygons"]["fp"] for i in empty),
                "idsWithForegroundFalsePositives": [i["id"] for i in empty_fp]},
            "omissions": {key: sum(i["polygonization"]["omissions"][key] for i in results) for key in ("small", "complex", "invalid", "capacity")},
            "runtime": {"bodySeconds": time.perf_counter() - started, "gpu": False, "provider": "CPUExecutionProvider",
                "networkAuditEvents": denied, "osEgressAudit": False},
            "qualification": frozen["qualifications"]}
        save(root / "results.json", summary)
        print(json.dumps({"completed": len(results), "aggregate": aggregate, "emptyScenes": summary["emptyScenes"]}), flush=True)
    finally:
        e.production._session.cache_clear()


def cached_evaluator():
    e = evaluator()
    def refuse(*args, **kwargs):
        raise RuntimeError("Cached recall comparison prohibits model/session/weight loading")
    e.production._session = refuse
    e.production._verified_path = refuse
    return e


def freeze_recall(root, denied):
    e = cached_evaluator()
    for name, expected in (("frozen-config.json", BASELINE_FREEZE_SHA), ("results.json", BASELINE_RESULTS_SHA)):
        if pin(BASELINE / name)["sha256"] != expected:
            raise ValueError("Immutable baseline changed")
    parent = read(BASELINE / "frozen-config.json")
    baseline = read(BASELINE / "results.json")
    # These are execution inputs, not a repeated review of the original TIFFs.
    native = []
    for source, result in zip(parent["items"], baseline["items"], strict=True):
        if source["id"] != result["id"] or (source["width"], source["height"]) != (256, 256):
            raise ValueError("Baseline input/order/frame mismatch")
        for key in ("image", "targetMask", "scoringMask", "rawLabel"):
            checked(source[key])
        entry = dict(result["artifacts"]["native-00.npz"], path=str(BASELINE / "raw" / source["id"].replace("/", "--") / "native-00.npz"))
        checked(entry)
        with e.np.load(entry["path"], allow_pickle=False) as arrays:
            if arrays["output0"].shape != (1, 200, 1) or arrays["output1"].shape != (1, 200, 108, 108):
                raise ValueError("Complete pre-filter query arrays required")
        expected_tile = [{"x": 0, "y": 0, "width": 256, "height": 256, "tileToRaster": [1, 0, 0, 0, 1, 0]}]
        if result["tiling"] != expected_tile:
            raise ValueError("Cached replay requires the recorded single unpadded tile")
        native.append(entry)
    diagnosis = read(root / "diagnosis.json")
    support = [roof for roof in diagnosis["findings"][0]["roofs"] if not roof["baselineFinalMatched"]
               and .3 < roof["queryConfidence"] <= .5 and roof["bestRawQueryPixelIoU"] >= .5]
    if not support:
        raise ValueError("No retained evidence for the single proposed confidence change")
    value = {"task": "D07-KARNATAKA-RECALL", "atUtc": datetime.now(timezone.utc).isoformat(),
        "experimentalVersion": RECALL_VERSION, "baselineCommit": "397474d670e29229867bed83a71b892c7461b3d2",
        "baselineFreeze": pin(BASELINE / "frozen-config.json"), "baselineResults": pin(BASELINE / "results.json"),
        "diagnosis": pin(root / "diagnosis.json"), "items": parent["items"], "cachedNative": native,
        "sourcePins": [pin(p) for p in (Path(__file__), Path(e.__file__), REPO / "services/geo/geo/spatial_ml.py",
            root / "supervise.py", root / "diagnose.py")],
        "environment": parent["environment"], "model": parent["model"], "sourceLimitations": parent["sourceLimitations"],
        "change": {"factor": "object confidence cutoff", "baseline": .5, "experimental": .3,
            "preserved": "All200 native queries;432 model input/native108 masks; mask logit>0; stable descending score painting only unassigned pixels; source256 frames/labels/full scoring; unchanged components/limits/matching",
            "hypothesis": "A useful rooftop query (confidence0.3322,pixelIoU0.80794,label1198pixels) is censored at0.5. A fixed0.30 cutoff may recover some missed roofs; tiny/lower-confidence/domain/annotation errors remain. This is one changed cutoff, not a sweep.",
            "choiceBasis": "Largest one-decimal cutoff below the highest-confidence filtered query that supports an unmatched roof in the two-case diagnosis. No alternative threshold was scored before this freeze.",
            "upstream": {"url": "https://rfdetr.roboflow.com/latest/reference/rfdetr/", "checkedOn": "2026-10-05",
                "claim": "RFDETR.predict exposes float threshold with default0.5;0.30 is this isolated development experiment, not an upstream recommended satellite threshold."}},
        "decision": {"baselineMaskRecall": baseline["aggregate"]["mask"]["classes"][1]["recall"],
            "baselineMaskPrecision": baseline["aggregate"]["mask"]["classes"][1]["precision"],
            "baselinePolygonMatched": 67, "baselinePolygonObjectPrecision": 67/110,
            "baselineEmptyLabelledFpScenes": 1, "baselineCapacityOmissions": 0,
            "rule": "Recall mechanism supported only if mask recall increases and final polygon matches exceed67. If both precisions stay>=baseline, empty-labelled FP scenes<=1 and capacity omissions==0, classify development_metrics_improved; otherwise recall_gain_with_cost. Without both recall gains classify no_supported_recall_gain. Always report all pixel/object/empty/geometry costs; no promotion, fit or final/generalization claim."},
        "bounds": parent["bounds"], "allocation": parent["groupReservation"],
        "isolation": {"newNativeModelCalls": 0, "modelSessionAndWeightCallsFailClosed": True,
            "nativeOrOsEgressBoundary": "Not established for fresh RF-DETR. Existing audited Qwen launcher has fixed roles/staged scopes; no global/ACL/runtime changes performed. Pure cached-output comparison only.",
            "pythonAuditDenials": denied.copy(), "job": "existing gated Job/CPU affinity/resource cap; not an egress boundary"}}
    save(root / "frozen-recall-config.json", value)
    print(json.dumps({"freeze": pin(root / "frozen-recall-config.json"), "cachedItems": len(native), "newNativeModelCalls": 0}), flush=True)


def cached_masks(e, logits, masks, threshold, width, height):
    # Exact production score/mask/painting operations, with only the declared
    # confidence cutoff changed. No preprocessing or model/session call.
    np = e.np
    if logits.shape != (1, 200, 1) or masks.shape != (1, 200, 108, 108) or not np.isfinite(logits).all() or not np.isfinite(masks).all():
        raise ValueError("Invalid complete cached query arrays")
    confidence = 1 / (1 + np.exp(-np.clip(logits[0, :, 0], -80, 80)))
    labels = np.zeros((height, width), np.uint8)
    scores = np.zeros(labels.shape, np.float32)
    palette = {0: "background"}
    index = 0
    for query in np.argsort(-confidence, kind="stable"):
        if confidence[query] <= threshold:
            break
        mask = e.production._resize_logits(masks[0, query], height, width) > 0
        paint = mask & (labels == 0)
        if paint.any():
            index += 1
            labels[paint] = index
            scores[paint] = confidence[query]
            palette[index] = "building"
    return labels, scores, palette


def replay_recall(root, denied):
    e = cached_evaluator()
    f = read(root / "frozen-recall-config.json")
    for entry in f["sourcePins"] + [f["baselineFreeze"], f["baselineResults"], f["diagnosis"], f["environment"]["lock"]]:
        checked(entry)
    if f["experimentalVersion"] != RECALL_VERSION or f["change"]["experimental"] != .3 or e.dependencies() != f["environment"]["dependencies"]:
        raise ValueError("Frozen experimental configuration/runtime drift")
    baseline = read(f["baselineResults"]["path"])
    output = root / "cached-replay"
    output.mkdir()  # One alternative only; preserve any partial attempt.
    results = []
    start = time.perf_counter()
    for source, old, native in zip(f["items"], baseline["items"], f["cachedNative"], strict=True):
        item_start = time.perf_counter()
        save(root / f"started-{len(results):02d}.json", {"id": source["id"], "atUtc": datetime.now(timezone.utc).isoformat()})
        def expire():
            print("cached_item_deadline_exceeded:" + source["id"], file=sys.stderr, flush=True)
            os._exit(3)
        remaining = 1200 - (time.perf_counter() - start)
        if remaining <= 0:
            raise RuntimeError("Cached comparison deadline reached")
        timer = threading.Timer(min(120, remaining), expire)
        timer.daemon = True
        timer.start()
        try:
            folder = output / source["id"].replace("/", "--")
            folder.mkdir()
            for key in ("image", "targetMask", "scoringMask", "rawLabel"):
                e.read_pinned(source[key])
            checked(native)
            with e.np.load(native["path"], allow_pickle=False) as arrays:
                labels, scores, palette = cached_masks(e, arrays["output0"], arrays["output1"], .3, 256, 256)
            truth = e.np.asarray(e.Image.open(source["targetMask"]["path"])).copy()
            valid = e.np.asarray(e.Image.open(source["scoringMask"]["path"])) == 1
            if truth.shape != (256, 256) or not valid.all():
                raise ValueError("Unchanged full source scoring domain required")
            components, omissions = e.production._components(labels, scores, palette, source["image"]["sha256"])
            transformed = e.source_components(components, old["transform"])
            mask = (labels > 0).astype(e.np.uint8)
            polygon_mask = e.polygon_mask(transformed, 256, 256, ["background", "building"])
            objects, domain, outside = e.building_truth_objects(source, valid)
            raw_objects = [p.intersection(domain) for p in e.mask_objects(mask)]
            poly_objects = [e.shape(p["geometry"]).intersection(domain) for p in transformed]
            result = {"id": source["id"], "groupId": source["groupId"], "task": "building", "experimentalVersion": RECALL_VERSION,
                "freezeSha256": pin(root / "frozen-recall-config.json")["sha256"], "cachedNative": native,
                "newNativeCalls": 0, "transform": old["transform"], "source": source["image"], "truthMask": source["targetMask"],
                "scoredPixels": int(valid.sum()), "ignoredPixels": 0, "positiveTruthPixelsInIgnoredRegion": 0,
                "emptyTruth": old["emptyTruth"], "mask": e.class_metrics(e.confusion(truth, mask, valid, 2), ["background", "building"]),
                "polygons": e.class_metrics(e.confusion(truth, polygon_mask, valid, 2), ["background", "building"]),
                "objects": {"mask": e.match_objects(objects, [p for p in raw_objects if p.area]),
                    "polygons": e.match_objects(objects, [p for p in poly_objects if p.area]), "publisherFeatures": source["publisherFeatureCount"],
                    "truthFeaturesOutsideScoringDomain": outside},
                "polygonization": {"omissions": omissions, "returnedComponents": len(components),
                    "changedScoredPixels": int((mask != polygon_mask).sum()),
                    "removedForegroundPixels": int(((mask > 0) & (polygon_mask == 0)).sum()),
                    "addedForegroundPixels": int(((mask == 0) & (polygon_mask > 0)).sum())}}
            e.Image.fromarray(labels).save(folder / "instance-mask.png")
            e.Image.fromarray(mask).save(folder / "source-mask.png")
            e.Image.fromarray(polygon_mask).save(folder / "source-polygon-mask.png")
            e.np.save(folder / "confidence.npy", scores)
            save(folder / "polygons.json", {"processing": components, "source": transformed, "transform": old["transform"], "omissions": omissions})
            result["artifacts"] = {p.name: pin(p) for p in sorted(folder.iterdir())}
            result["totalItemSeconds"] = time.perf_counter() - item_start
            save(folder / "result.json", result)
            results.append(result)
        finally:
            timer.cancel()
            timer.join()
    aggregate = e.aggregate(results, ["background", "building"])
    empty = [i for i in results if i["emptyTruth"]]
    empty_fp = sum(bool(i["mask"]["classes"][1]["fp"]) for i in empty)
    omissions = {k: sum(i["polygonization"]["omissions"][k] for i in results) for k in ("small", "complex", "invalid", "capacity")}
    recall_gain = aggregate["mask"]["classes"][1]["recall"] > f["decision"]["baselineMaskRecall"] and aggregate["objects"]["polygons"]["tp"] > 67
    no_cost = (aggregate["mask"]["classes"][1]["precision"] >= f["decision"]["baselineMaskPrecision"]
        and aggregate["objects"]["polygons"]["precision"] >= 67/110 and empty_fp <= 1 and omissions["capacity"] == 0)
    summary = {"task": f["task"], "status": "completed_cached_comparison", "experimentalVersion": RECALL_VERSION,
        "freeze": pin(root / "frozen-recall-config.json"), "items": results, "aggregate": aggregate,
        "emptyLabelledScenes": {"items": len(empty), "fpScenes": empty_fp,
            "fpPixels": sum(i["mask"]["classes"][1]["fp"] for i in empty),
            "fpPolygonObjects": sum(i["objects"]["polygons"]["fp"] for i in empty)},
        "omissions": omissions, "decision": "development_metrics_improved" if recall_gain and no_cost else ("recall_gain_with_cost" if recall_gain else "no_supported_recall_gain"),
        "runtime": {"bodySeconds": time.perf_counter() - start, "newNativeModelCalls": 0, "cachedQueryFiles": len(results),
            "pythonAuditDenials": denied, "nativeOrOsEgressBoundary": False}}
    save(root / "recall-results.json", summary)
    print(json.dumps({k: v for k, v in summary.items() if k != "items"}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("freeze", "run", "freeze-recall", "replay-recall"))
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--worker", action="store_true")
    args = parser.parse_args()
    if not args.worker:
        parser.error("Use the existing gated Job supervisor")
    denied = offline()
    {"freeze": freeze, "run": run, "freeze-recall": freeze_recall, "replay-recall": replay_recall}[args.action](args.root, denied)


if __name__ == "__main__":
    main()
