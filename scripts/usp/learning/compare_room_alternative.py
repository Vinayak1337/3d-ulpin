"""One frozen D07 development comparison; no training or production writes.

Use freeze/check with the private LiteRT environment. Run only through the
existing run_trial._run_worker supervisor, passing --worker after Job attachment.
Native classes remain intact; the shared metrics below do not remap the model.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import time

REPO = Path(__file__).resolve().parents[3]
IDS = ("cubicasa5k/high_quality_architectural/333", "cubicasa5k/high_quality/13812")
MODEL_SHA = "9192751390189bc959f1233abcb54872dc78ce6933c902d4e2c487d628d767a4"
BASE_FREEZE_SHA = "2d5ff979436935a99bdbbf38b773358921591d7c3a9f3591647d6bfa0aa21311"
BASE = Path("E:/BhuAayam-data/task-data/d07-vision-baseline-20261005/run-01")
SHARED = {"bedroom": (5, 4), "bath": (6, 2), "wall": (2, 10)}
BASE_ROOMS = (3, 4, 5, 6, 7, 9, 10, 11)
NATIVE_ROOMS = (1, 2, 3, 4, 5)
NAMES = ("background", "closet", "bathroom/washroom", "living/kitchen/dining",
         "bedroom", "hall", "balcony", "unused7", "unused8", "opening", "wall")


def pin(path):
    path = Path(path)
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return {"path": str(path.resolve()), "bytes": path.stat().st_size, "sha256": h.hexdigest()}


def checked(entry):
    path = Path(entry["path"])
    actual = pin(path)
    if (actual["bytes"], actual["sha256"]) != (entry["bytes"], entry["sha256"]):
        raise ValueError(f"pin mismatch: {path}")
    return path


def read(path):
    return json.loads(Path(path).read_bytes())


def save(path, value):
    with Path(path).open("x", encoding="utf-8", newline="\n") as f:
        json.dump(value, f, indent=2, allow_nan=False)
        f.write("\n")


def arrays(root):
    # The existing supervisor uses a stdlib base bootstrap; select this task's
    # wheels first rather than silently inheriting the supervisor's NumPy.
    sys.path.insert(0, str(root / "env/Lib/site-packages"))
    global np, Image, ImageOps
    import numpy as np
    from PIL import Image, ImageOps


def rgb(path):
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGBA")
        flat = Image.new("RGBA", image.size, "white")
        flat.alpha_composite(image)
        return flat.convert("RGB")


def resize(channel, height, width):
    """Half-pixel bilinear, no antialias, align_corners=False.

    Same coordinates as TF2 tf.image.resize; this is the existing production
    spatial_ml._resize_logits expression, retained locally to avoid GIS imports.
    Float round-off parity with TensorFlow kernels is not independently proven.
    """
    sh, sw = channel.shape
    y = np.maximum(0, (np.arange(height) + .5) * sh / height - .5)
    x = np.maximum(0, (np.arange(width) + .5) * sw / width - .5)
    y0, x0 = np.floor(y).astype(int), np.floor(x).astype(int)
    y1, x1 = np.minimum(y0 + 1, sh - 1), np.minimum(x0 + 1, sw - 1)
    dy, dx = (y - y0).astype(np.float32)[:, None], (x - x0).astype(np.float32)[None, :]
    return ((channel[y0[:, None], x0] * (1 - dx) + channel[y0[:, None], x1] * dx) * (1 - dy)
            + (channel[y1[:, None], x0] * (1 - dx) + channel[y1[:, None], x1] * dx) * dy)


def argmax_source(channels, height, width):
    best = np.full((height, width), -np.inf, np.float32)
    labels = np.zeros((height, width), np.uint8)
    for k, channel in enumerate(channels):
        values = resize(channel, height, width)
        change = values > best  # First class wins ties, matching argmax.
        labels[change], best[change] = k, values[change]
    return labels


def counts(truth, prediction):
    tp = int((truth & prediction).sum())
    fp = int((~truth & prediction).sum())
    fn = int((truth & ~prediction).sum())
    return ratios(tp, fp, fn)


def ratios(tp, fp, fn):
    def div(a, b):
        return a / b if b else None
    return {"tp": tp, "fp": fp, "fn": fn, "iou": div(tp, tp + fp + fn),
            "precision": div(tp, tp + fp), "recall": div(tp, tp + fn)}


def score(truth, prediction, candidate):
    classes = {name: counts(truth == old, prediction == (new if candidate else old))
               for name, (old, new) in SHARED.items()}
    room_ids = NATIVE_ROOMS if candidate else BASE_ROOMS
    return {"shared": classes,
            "roomInteriorCoverageDiagnostic": counts(np.isin(truth, BASE_ROOMS), np.isin(prediction, room_ids))}


def baseline_equivalence(item, folder):
    image = rgb(checked(item["source"]))
    width, height = image.size
    assert image.size == (item["transform"]["sourceWidth"], item["transform"]["sourceHeight"])
    assert item["transform"]["pixelRegion"] == [0, 0, width, height]
    assert item["transform"]["region"] == {"x": 0, "y": 0, "width": 1, "height": 1}
    ratio = 768 / max(image.size)
    processed = image.resize((round(width * ratio), round(height * ratio)), Image.Resampling.BILINEAR)
    assert np.array_equal(np.asarray(processed), np.asarray(Image.open(folder / "processing-raster.png")))
    with np.load(folder / "native-00.npz", allow_pickle=False) as archive:
        logits = archive["output0"][0, :, :processed.height, :processed.width]
    assert logits.shape == (12, processed.height, processed.width) and np.isfinite(logits).all()
    mask = logits.argmax(axis=0).astype(np.uint8)
    assert np.array_equal(mask, np.asarray(Image.open(folder / "processing-mask.png")))
    source_mask = np.asarray(Image.fromarray(mask).resize(image.size, Image.Resampling.NEAREST))
    assert np.array_equal(source_mask, np.asarray(Image.open(folder / "source-mask.png")))
    diagnostic = argmax_source(logits, height, width)
    assert np.array_equal(diagnostic, np.asarray(Image.open(folder / "source-logit-argmax.png")))
    assert item["transform"]["pixelToSource"] == [width / processed.width, 0, 0, 0, height / processed.height, 0]
    return {"originalBytesPinned": True, "fullSourceAndFrameEqual": True,
            "processingRgbPixelsEqual": True, "cachedNativeArgmaxEqual": True,
            "sourceNearestMaskEqual": True, "sourceBilinearLogitDiagnosticEqual": True,
            "currentV2MaskPolicyUnchanged": True, "newBaselineInvocations": 0}


def freeze(root):
    metadata = read(root / "model-metadata.json")
    assert metadata["invokeCount"] == 0 and metadata["allocated"]
    assert metadata["inputs"][0]["shape"] == [1, 512, 512, 3]
    assert sorted(t["shape"][-1] for t in metadata["outputs"]) == [3, 9]
    checked({**pin(root / "model.tflite"), "sha256": MODEL_SHA})
    checked({**pin(BASE / "frozen-config.json"), "sha256": BASE_FREEZE_SHA})
    cohort = REPO / "docs/orchestration/delivery-reset-20261004/vision-cohort.json"
    manifest = read(cohort)
    items = manifest["tasks"]["floor_plan"]["items"]
    assert next(i["id"] for i in items if i["category"] == "high_quality") == IDS[1]
    old = read(BASE / "results.json")
    assert old["freezeSha256"] == BASE_FREEZE_SHA
    production = read(REPO / "services/geo/ml-models.json")
    # The retained v1 mask is usable with v2 only when the exact weights and
    # mask preprocessing are unchanged; polygon correction is out of scope.
    models = production["models"] if isinstance(production, dict) else production
    model, = [m for m in models if m["id"] == "cubicasa5k-rooms-onnx-v1"]
    assert model["profileVersion"] == "cubicasa-rooms-768-bilinear-pad64-contours-v2"
    selected = []
    for identity in IDS:
        item, = [i for i in old["items"] if i["id"] == identity]
        original, = [i for i in items if i["id"] == identity]
        assert item["source"] == original["image"] and item["truthMask"] == original["targetMask"]
        assert original["split"] == "development"
        assert item["model"]["sha256"] == model["sha256"]
        assert item["model"]["profileVersion"] == "cubicasa-rooms-768-bilinear-pad64-v1"
        folder = BASE / identity.replace("/", "--")
        artifacts = []
        for name in ("processing-raster.png", "processing-mask.png", "source-mask.png", "source-logit-argmax.png", "native-00.npz"):
            entry = {"path": str(folder / name), **item["artifacts"][name]}
            checked(entry)
            artifacts.append(entry)
        checked(item["truthMask"])
        equivalent = baseline_equivalence(item, folder)
        selected.append({"id": identity, "source": item["source"], "truth": item["truthMask"],
                         "transform": item["transform"], "scoredPixels": item["scoredPixels"],
                         "baselineArtifacts": artifacts, "baselineEquivalence": equivalent})
    save(root / "frozen-comparison.json", {
        "task": "D07-ROOM-ALTERNATIVE", "atUtc": datetime.now(timezone.utc).isoformat(),
        "hypothesis": "Boundary-guided attention may improve supported room semantics on the same two development plans.",
        "candidate": "TF2DeepFloorplan published TFLite; repo b5860f2976cbb77100c4e7f6b1318a2ac3e4a818",
        "model": pin(root / "model.tflite"), "metadata": pin(root / "model-metadata.json"),
        "code": pin(__file__), "baselineConfig": pin(BASE / "frozen-config.json"),
        "baselineResults": pin(BASE / "results.json"), "cohort": pin(cohort),
        "productionDecoder": pin(REPO / "services/geo/geo/spatial_ml.py"),
        "productionManifest": pin(REPO / "services/geo/ml-models.json"),
        "environment": pin(root / "wheel-lock.json"), "items": selected,
        "inputProtocol": "Same full unchanged RGB source/GT/frame, no crop/rotation. Native candidate resize512 square, half-pixel bilinear/no antialias, float32 /255, NHWC. Direct uint8 PNG decode avoids matplotlib float-to-uint8 cast ambiguity in publisher CLI.",
        "outputProtocol": "Identify heads by 9/3 channels, require invoked1x512x512xC float32 finite. Bilinear logits to source BEFORE argmax. Boundary opening/wall overrides room (native9/10). Retain raw heads/masks; no floodfill/refinement/polygonization.",
        "coupledChanges": "Architecture/checkpoint/training provenance and native512 square versus baseline768 aspect-preserved/pad64. No causal isolation claim.",
        "nativeClasses": dict(enumerate(NAMES)), "sharedMetrics": SHARED,
        "scoring": "All original source pixels; no ignored classes. Bedroom and bath exact-name subsets, wall separate boundary diagnostic. Per-plan and pooled TP/FP/FN, IoU/precision/recall, shared3 macroIoU. Compare current nearest baseline and cached bilinear-logit diagnostic separately.",
        "coverageDiagnostic": {"truthAndBaselineRoomIds": BASE_ROOMS, "candidateRoomIds": NATIVE_ROOMS,
            "limitation": "Broad room-interior occupancy only; unmatched closet/storage,hall/hallway,balcony/outdoor,compound living/kitchen/dining,garage/other semantics remain unqualified. Not room instances or full ontology accuracy."},
        "continueToUnlabelledHaryanaOnlyIf": "Pooled shared3 meanIoU >= both baseline variants +0.02, no bedroom/bath per-plan IoU decline >0.02, and coverage IoU no decline. Diagnostic continuation criterion, no promotion/release threshold.",
        "bounds": {"cpuThreads": 2, "gpu": False, "jobMemoryBytes": 6*1024**3, "seconds": 120, "invokeCount": 2},
        "stop": "One comparison; no retries, fitting, threshold sweep, second candidate or unsupported-kernel repair.",
        "limitations": "Two previously opened foreign development plans, one conservative anonymous group; checkpoint/template overlap unaudited. R3D training claimed by port, no independent checkpoint training audit. Code GPL3, model/data-specific licence/release eligibility unresolved; no India/generalization/room-instance/metric/legal/release claims."})


def run(root):
    from ai_edge_litert.interpreter import Interpreter
    config = read(root / "frozen-comparison.json")
    for key in ("model", "metadata", "code", "baselineConfig", "baselineResults", "cohort",
                "productionDecoder", "productionManifest", "environment"):
        checked(config[key])
    output = root / "comparison"
    output.mkdir()  # Refuse an unchanged retry or overwrite.
    started = time.perf_counter()
    interpreter = Interpreter(model_path=str(checked(config["model"])), num_threads=2, experimental_delegates=[])
    interpreter.allocate_tensors()
    input_index, = [t["index"] for t in interpreter.get_input_details()]
    results = []
    for item in config["items"]:
        for entry in item["baselineArtifacts"]:
            checked(entry)
        image = rgb(checked(item["source"]))
        truth = np.asarray(Image.open(checked(item["truth"])))
        assert truth.shape == (image.height, image.width) and truth.size == item["scoredPixels"]
        assert truth.dtype == np.uint8 and int(truth.max()) <= 11
        tensor = np.stack([resize(c.astype(np.float32), 512, 512)
                           for c in np.asarray(image).transpose(2, 0, 1)], axis=-1)[None] / np.float32(255)
        assert tensor.dtype == np.float32 and np.isfinite(tensor).all() and 0 <= tensor.min() <= tensor.max() <= 1
        folder = output / item["id"].replace("/", "--")
        folder.mkdir()
        np.save(folder / "input.npy", tensor)
        interpreter.set_tensor(input_index, tensor)
        clock = time.perf_counter()
        interpreter.invoke()
        seconds = time.perf_counter() - clock
        heads = {}
        for details in interpreter.get_output_details():
            values = interpreter.get_tensor(details["index"])
            channels = values.shape[-1]
            assert channels in (3, 9) and values.shape == (1, 512, 512, channels)
            assert values.dtype == np.float32 and np.isfinite(values).all()
            heads[channels] = values
        assert set(heads) == {3, 9}
        np.savez_compressed(folder / "native.npz", room=heads[9], boundary=heads[3])
        room = argmax_source(heads[9][0].transpose(2, 0, 1), image.height, image.width)
        boundary = argmax_source(heads[3][0].transpose(2, 0, 1), image.height, image.width)
        fused = room.copy()
        fused[boundary == 1], fused[boundary == 2] = 9, 10
        for name, mask in (("room", room), ("boundary", boundary), ("fused", fused)):
            Image.fromarray(mask).save(folder / f"source-{name}.png")
        base = BASE / item["id"].replace("/", "--")
        results.append({"id": item["id"], "sourcePixels": int(truth.size), "invokeSeconds": seconds,
            "nativeShapes": {str(k): list(v.shape) for k, v in heads.items()},
            "candidate": score(truth, fused, True),
            "baseline": score(truth, np.asarray(Image.open(base / "source-mask.png")), False),
            "baselineLogitDiagnostic": score(truth, np.asarray(Image.open(base / "source-logit-argmax.png")), False),
            "nativeRoomPixels": dict(zip(NAMES[:9], map(int, np.bincount(room.ravel(), minlength=9)))),
            "fusedPixels": dict(zip(NAMES, map(int, np.bincount(fused.ravel(), minlength=11)))),
            "artifacts": [pin(p) for p in sorted(folder.iterdir())]})
    pooled = {}
    for route in ("candidate", "baseline", "baselineLogitDiagnostic"):
        classes = {name: ratios(*(sum(i[route]["shared"][name][n] for i in results) for n in ("tp", "fp", "fn"))) for name in SHARED}
        coverage = ratios(*(sum(i[route]["roomInteriorCoverageDiagnostic"][n] for i in results) for n in ("tp", "fp", "fn")))
        pooled[route] = {"shared": classes, "sharedMacroIoU": sum(v["iou"] for v in classes.values()) / 3,
                         "roomInteriorCoverageDiagnostic": coverage}
    continuation = all(pooled["candidate"]["sharedMacroIoU"] >= pooled[r]["sharedMacroIoU"] + .02
        and pooled["candidate"]["roomInteriorCoverageDiagnostic"]["iou"] >= pooled[r]["roomInteriorCoverageDiagnostic"]["iou"]
        and all(i["candidate"]["shared"][n]["iou"] >= i[r]["shared"][n]["iou"] - .02 for i in results for n in ("bedroom", "bath"))
        for r in ("baseline", "baselineLogitDiagnostic"))
    save(root / "results.json", {"task": config["task"], "freeze": pin(root / "frozen-comparison.json"),
        "status": "completed", "invokeCount": len(results), "baselineInvocations": 0,
        "elapsedSeconds": time.perf_counter() - started, "items": results, "pooled": pooled,
        "haryanaContinuationCriterionMet": continuation,
        "packages": {n: importlib.metadata.version(n) for n in ("ai-edge-litert", "numpy", "pillow")},
        "numpyOrigin": np.__file__, "gpu": False})
    print(json.dumps({"items": len(results), "pooled": pooled, "haryanaContinuationCriterionMet": continuation}))


def check(root):
    expected = np.array([[0, .25, .75, 1], [.5, .75, 1.25, 1.5],
                         [1.5, 1.75, 2.25, 2.5], [2, 2.25, 2.75, 3]], np.float32)
    assert np.array_equal(resize(np.array([[0, 1], [2, 3]], np.float32), 4, 4), expected)
    assert ratios(0, 0, 0)["iou"] is None
    truth = np.array([[5, 6, 2, 3, 9]], np.uint8)
    fused = np.array([[4, 2, 10, 3, 1]], np.uint8)
    assert all(v["iou"] == 1 for v in score(truth, fused, True)["shared"].values())
    assert fused.tolist() == [[4, 2, 10, 3, 1]]  # Scoring preserves compound/closet.
    try:
        checked({**pin(root / "model.tflite"), "sha256": "0"*64})
    except ValueError:
        pass
    else:
        raise AssertionError("corrupt pin accepted")
    print("PASS: half-pixel resize, undefined denominators, separate semantic subsets, corrupt pin refusal")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("freeze", "run", "check"))
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--worker", action="store_true")
    args = parser.parse_args()
    if args.action == "run" and not args.worker:
        parser.error("run requires the existing bounded supervisor")
    os.environ.update({"CUDA_VISIBLE_DEVICES": "", "PYTHONDONTWRITEBYTECODE": "1", "OMP_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2"})
    def deny_network(event, arguments):
        if event in {"socket.connect", "socket.getaddrinfo", "socket.bind", "socket.sendto"}:
            raise RuntimeError("Python network access denied during offline pilot")
    sys.addaudithook(deny_network)
    arrays(args.root)
    {"freeze": freeze, "run": run, "check": check}[args.action](args.root)


if __name__ == "__main__":
    main()
