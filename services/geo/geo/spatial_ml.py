"""Pinned, local image segmentation. Pixel proposals never authorize metric geometry."""
from __future__ import annotations

import base64
import hashlib
import importlib
import importlib.util
import io
import json
import logging
import math
import os
import re
import time
import traceback
import uuid
import warnings
from functools import lru_cache
from contextlib import closing
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from .validation import InputError

SCHEMA = "spatial-inference/1"
MAX_SOURCE_BYTES = 16 * 1024 * 1024
MAX_SOURCE_PIXELS = 40_000_000
MAX_BUILDING_EDGE = 2048
MAX_BUILDING_PIXELS = 4_000_000
BUILDING_TILE = 512
BUILDING_STRIDE = 384
MAX_COMPONENTS = 100
MAX_VERTICES = 500
ROOMS = ["background", "outdoor", "wall", "kitchen", "living_room", "bedroom", "bath", "hallway", "railing", "storage", "garage", "other_room"]
logger = logging.getLogger(__name__)


class SpatialInferenceError(InputError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _fail(code, message):
    raise SpatialInferenceError(code, message)


def _manifest():
    return json.loads((Path(__file__).resolve().parent.parent / "ml-models.json").read_text())


def _model_dir():
    service = Path(__file__).resolve().parent.parent
    workspace = service.parent.parent if service.parent.name == "services" else service
    return Path(os.environ.get("ML_MODEL_DIR", str(workspace / ".runtime" / "ml-models"))).expanduser()


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


@lru_cache(maxsize=8)
def _file_sha(path, size, modified_ns):
    digest = hashlib.sha256()
    with open(path, "rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _verified_path(model):
    path = _model_dir() / model["filename"]
    try:
        stat = path.stat()
        if not path.is_file() or stat.st_size != model["bytes"] or _file_sha(str(path), stat.st_size, stat.st_mtime_ns) != model["sha256"]:
            _fail("MODEL_MISMATCH", "Installed model does not match the pinned model hash. Reinstall the verified artifact.")
    except OSError:
        _fail("MODEL_UNAVAILABLE", "Local model is not installed. Run scripts/ml/setup-models.py before extraction.")
    return path, stat


def _runtime_dependency_error():
    # A wheel can be installed while its native shared libraries are missing.
    # Import it here so readiness cannot advertise a nonfunctional processor.
    for name in ("onnxruntime", "rasterio"):
        try:
            importlib.import_module(name)
        except Exception as error:
            logger.error("Spatial runtime dependency %s failed to load (%s)", name, type(error).__name__)
            return f"Local processor dependency {name} could not load ({type(error).__name__}). Install requirements-ml.txt and native runtime libraries, then rebuild the processor."
    return None


def spatial_ml_readiness():
    dependency_error = _runtime_dependency_error()
    rows = []
    for model in _manifest()["models"]:
        row = {key: model[key] for key in ("id", "name", "task", "sha256", "profileVersion", "license", "quality")}
        row["ready"] = False
        try:
            _verified_path(model)
            if dependency_error:
                _fail("DEPENDENCY_UNAVAILABLE", dependency_error)
            row["ready"] = True
        except SpatialInferenceError as error:
            row["reason"] = str(error)
        rows.append(row)
    return {"available": any(row["ready"] for row in rows), "models": rows}


def _validate_request(data):
    keys = {"schemaVersion", "inputFingerprint", "source", "page", "region", "task", "modelId", "expectedModelSha256", "expectedProfileVersion"}
    if not isinstance(data, dict) or set(data) - keys or data.get("schemaVersion") != SCHEMA:
        _fail("INVALID_INPUT", "Unsupported spatial inference request schema.")
    if not isinstance(data.get("inputFingerprint"), str) or not re.fullmatch(r"[a-f0-9]{64}", data["inputFingerprint"]):
        _fail("INVALID_INPUT", "A SHA-256 input fingerprint is required.")
    model = next((m for m in _manifest()["models"] if m["id"] == data.get("modelId")), None)
    if model is None or model["task"] != data.get("task"):
        _fail("INVALID_INPUT", "Select an installed model for the requested task.")
    if data.get("expectedModelSha256") != model["sha256"]:
        _fail("MODEL_MISMATCH", "The queued model revision differs from the pinned model. Start a fresh extraction.")
    if data.get("expectedProfileVersion") != model["profileVersion"]:
        _fail("MODEL_MISMATCH", "The queued preprocessing revision differs from the pinned profile. Start a fresh extraction.")
    source = data.get("source")
    if not isinstance(source, dict) or set(source) != {"id", "objectKey", "sha256", "bytes", "mimeType"}:
        _fail("INVALID_INPUT", "An immutable original source receipt is required.")
    if not isinstance(source["id"], str) or not source["id"] or len(source["id"]) > 128:
        _fail("INVALID_INPUT", "A source identity is required.")
    key = source["objectKey"]
    if not isinstance(key, str) or not key or len(key) > 1024 or "://" in key or ".." in key.split("/"):
        _fail("INVALID_INPUT", "A local object-store source key is required.")
    if not isinstance(source["sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", source["sha256"]):
        _fail("INVALID_INPUT", "The original source hash is required.")
    if isinstance(source["bytes"], bool) or not isinstance(source["bytes"], int) or not 1 <= source["bytes"] <= MAX_SOURCE_BYTES:
        _fail("RESOURCE_LIMIT", "Select an original source of at most 16 MiB.")
    if source["mimeType"] not in ("image/png", "image/jpeg", "application/pdf"):
        _fail("UNSUPPORTED_SOURCE", "Local segmentation supports PNG, JPEG or one selected PDF page.")
    page = data.get("page", 1)
    if isinstance(page, bool) or not isinstance(page, int) or not 1 <= page <= 100:
        _fail("INVALID_INPUT", "Select a page between 1 and 100.")
    if source["mimeType"] != "application/pdf" and page != 1:
        _fail("INVALID_INPUT", "An image source has only page 1.")
    region = data.get("region", {"x": 0, "y": 0, "width": 1, "height": 1})
    if not isinstance(region, dict) or set(region) != {"x", "y", "width", "height"}:
        _fail("INVALID_INPUT", "Select a normalized rectangular source region.")
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in region.values()):
        _fail("INVALID_INPUT", "Source crop coordinates must be finite numbers.")
    x, y, width, height = (region[k] for k in ("x", "y", "width", "height"))
    if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > 1 or y + height > 1:
        _fail("INVALID_INPUT", "The crop must lie within the selected source page.")
    return model, source, page, region


def _read_source(source, s3=None):
    from . import settings
    if s3 is None:
        import boto3
        from botocore.config import Config
        s3 = boto3.client("s3", endpoint_url=settings.S3_ENDPOINT, aws_access_key_id=settings.S3_ACCESS_KEY, aws_secret_access_key=settings.S3_SECRET_KEY, region_name=settings.S3_REGION, config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, connect_timeout=5, read_timeout=30, retries={"max_attempts": 2}))
    try:
        obj = s3.get_object(Bucket=settings.S3_BUCKET, Key=source["objectKey"])
        body = obj["Body"]
        try:
            raw = body.read(MAX_SOURCE_BYTES + 1)
        finally:
            body.close()
    except Exception:
        _fail("SOURCE_UNAVAILABLE", "The retained original could not be read from local storage.")
    if len(raw) != source["bytes"] or _sha(raw) != source["sha256"]:
        _fail("SOURCE_INTEGRITY", "Original source bytes differ from the queued size or checksum. No inference ran.")
    return raw


def _source_raster(raw, mime, page, region, task):
    extra = {}
    try:
        if mime == "application/pdf":
            if not raw.startswith(b"%PDF-"):
                _fail("UNSUPPORTED_SOURCE", "Source bytes do not match the declared PDF format.")
            if importlib.util.find_spec("pypdfium2") is None:
                _fail("MODEL_UNAVAILABLE", "Install the private PDF renderer from requirements-ml.txt.")
            import pypdfium2 as pdfium
            with closing(pdfium.PdfDocument(raw)) as document:
                if page > len(document):
                    _fail("INVALID_INPUT", "The selected PDF page is unavailable.")
                pdf_page = document[page - 1]
                try:
                    pw, ph = pdf_page.get_size()
                    if not math.isfinite(pw + ph) or min(pw, ph) <= 0:
                        _fail("UNSUPPORTED_SOURCE", "The PDF page has invalid dimensions.")
                    scale = min(2.0, 2000 / max(pw, ph))
                    bitmap = pdf_page.render(scale=scale)
                    try:
                        image = bitmap.to_pil().convert("RGB").copy()
                    finally:
                        bitmap.close()
                    extra = {"pdfPagePoints": [pw, ph], "pdfRenderScale": scale, "renderer": "pypdfium2"}
                finally:
                    pdf_page.close()
        else:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(raw)) as original:
                    expected = "PNG" if mime == "image/png" else "JPEG"
                    if original.format != expected or getattr(original, "n_frames", 1) != 1:
                        _fail("UNSUPPORTED_SOURCE", "Source bytes must match the declared single-image PNG/JPEG format.")
                    if original.width * original.height > MAX_SOURCE_PIXELS:
                        _fail("RESOURCE_LIMIT", "Source image exceeds 40 megapixels; select a bounded source image.")
                    original.load()
                    upright = ImageOps.exif_transpose(original)
                    # Flatten transparency onto white so hidden RGB bytes do not become visual evidence.
                    rgba = upright.convert("RGBA")
                    image = Image.new("RGBA", rgba.size, "white")
                    image.alpha_composite(rgba)
                    image = image.convert("RGB")
    except SpatialInferenceError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        _fail("UNSUPPORTED_SOURCE", "The source cannot be safely decoded as the selected image or PDF page.")
    except Exception:
        _fail("UNSUPPORTED_SOURCE", "The selected PDF page could not be rendered locally.")
    source_width, source_height = image.size
    x, y, width, height = (region[k] for k in ("x", "y", "width", "height"))
    box = [math.floor(x * source_width), math.floor(y * source_height), math.ceil((x + width) * source_width), math.ceil((y + height) * source_height)]
    image = image.crop(tuple(box))
    if min(image.size) < 16:
        _fail("RESOURCE_LIMIT", "Select a crop at least 16 pixels wide and high.")
    if task == "building" and (max(image.size) > MAX_BUILDING_EDGE or image.width * image.height > MAX_BUILDING_PIXELS):
        _fail("RESOURCE_LIMIT", "Select an aerial image no larger than 2048 pixels per edge and 4 million pixels in total.")
    if task == "floor-plan":
        ratio = 768 / max(image.size)
        image = image.resize((max(1, round(image.width * ratio)), max(1, round(image.height * ratio))), Image.Resampling.BILINEAR)
    transform = {"unit": "pixel", "coordinateConvention": "pixel-edge", "page": page, "sourceWidth": source_width, "sourceHeight": source_height, "region": region, "pixelRegion": box, "orientation": "exif-normalized" if mime != "application/pdf" else "PDF page rotation applied", "pixelToSource": [(box[2] - box[0]) / image.width, 0, box[0], 0, (box[3] - box[1]) / image.height, box[1]], **extra}
    return image, transform


@lru_cache(maxsize=1)
def _session(path, size, modified_ns):
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    return ort.InferenceSession(path, options, providers=["CPUExecutionProvider"])


def _resize_logits(values, height, width):
    """Half-pixel bilinear sampling; matches the qualified model postprocessors."""
    source_height, source_width = values.shape
    y = np.maximum(0, (np.arange(height) + .5) * source_height / height - .5)
    x = np.maximum(0, (np.arange(width) + .5) * source_width / width - .5)
    y0, x0 = np.floor(y).astype(int), np.floor(x).astype(int)
    y1, x1 = np.minimum(y0 + 1, source_height - 1), np.minimum(x0 + 1, source_width - 1)
    dy, dx = (y - y0).astype(np.float32)[:, None], (x - x0).astype(np.float32)[None, :]
    return (values[y0[:, None], x0] * (1 - dx) + values[y0[:, None], x1] * dx) * (1 - dy) + (values[y1[:, None], x0] * (1 - dx) + values[y1[:, None], x1] * dx) * dy


def _building_layout(image):
    def origins(length):
        if length <= BUILDING_TILE:
            return [0]
        starts = list(range(0, length - BUILDING_TILE + 1, BUILDING_STRIDE))
        if starts[-1] != length - BUILDING_TILE:
            starts.append(length - BUILDING_TILE)
        return starts
    return [{"x": x, "y": y, "width": min(BUILDING_TILE, image.width), "height": min(BUILDING_TILE, image.height), "tileToRaster": [1, 0, x, 0, 1, y]} for y in origins(image.height) for x in origins(image.width)]


def _building_tile(session, image):
    resized = image.resize((432, 432), Image.Resampling.BILINEAR)
    tensor = np.asarray(resized).transpose(2, 0, 1).astype(np.float32) / 255
    tensor = ((tensor - np.array([.485, .456, .406], np.float32)[:, None, None]) / np.array([.229, .224, .225], np.float32)[:, None, None])[None]
    logits, masks = session.run(None, {"image": tensor})
    if logits.shape != (1, 200, 1) or masks.shape[:2] != (1, 200) or not np.isfinite(logits).all() or not np.isfinite(masks).all():
        _fail("INFERENCE_FAILED", "The building model returned an invalid output shape or value.")
    confidence = 1 / (1 + np.exp(-np.clip(logits[0, :, 0], -80, 80)))
    labels = np.zeros((image.height, image.width), np.uint8)
    scores = np.zeros(labels.shape, np.float32)
    palette = {0: "background"}
    index = 0
    for query in np.argsort(-confidence, kind="stable"):
        if confidence[query] <= .5:
            break
        mask = _resize_logits(masks[0, query], image.height, image.width) > 0
        paint = mask & (labels == 0)
        if paint.any():
            index += 1
            labels[paint] = index
            scores[paint] = confidence[query]
            palette[index] = "building"
    return labels, scores, palette, "instance_sigmoid"


def _run_model(model, image):
    path, stat = _verified_path(model)
    session = _session(str(path), stat.st_size, stat.st_mtime_ns)
    if model["task"] == "floor-plan":
        width, height = image.size
        padded = Image.new("RGB", (((width + 63) // 64) * 64, ((height + 63) // 64) * 64), "white")
        padded.paste(image, (0, 0))
        tensor = np.asarray(padded).transpose(2, 0, 1).astype(np.float32)[None] / 127.5 - 1
        logits = session.run(None, {"image": tensor})[0][0, :, :height, :width]
        if logits.shape != (12, height, width) or not np.isfinite(logits).all():
            _fail("INFERENCE_FAILED", "The floor model returned an invalid output shape or value.")
        exp = np.exp(logits - logits.max(axis=0))
        probabilities = exp / exp.sum(axis=0)
        labels = logits.argmax(axis=0).astype(np.uint8)
        return labels, probabilities.max(axis=0), {i: name for i, name in enumerate(ROOMS)}, "mean_pixel_softmax"
    tiles = _building_layout(image)
    if len(tiles) == 1:
        return _building_tile(session, image)
    # Union on the unchanged source raster. Confidence max is commutative: tile
    # traversal cannot change a seam. Connected roofs may merge and require review.
    labels = np.zeros((image.height, image.width), np.uint8)
    scores = np.zeros(labels.shape, np.float32)
    for tile in tiles:
        x, y, width, height = (tile[key] for key in ("x", "y", "width", "height"))
        tile_labels, tile_scores, _, _ = _building_tile(session, image.crop((x, y, x + width, y + height)))
        foreground = tile_labels > 0
        labels[y:y + height, x:x + width] |= foreground.astype(np.uint8)
        np.maximum(scores[y:y + height, x:x + width], np.where(foreground, tile_scores, 0), out=scores[y:y + height, x:x + width])
    return labels, scores, {0: "background", 1: "building"}, "max_overlapping_instance_sigmoid"


def _components(labels, scores, palette, fingerprint):
    from rasterio.features import shapes, geometry_mask
    from rasterio.transform import Affine
    from shapely.geometry import shape, mapping
    components = []
    omitted = {"small": 0, "complex": 0, "invalid": 0, "capacity": 0}
    for geometry, value in shapes(labels, mask=labels > 0, connectivity=4):
        value = int(value)
        polygon = shape(geometry)
        if polygon.area < 16:
            omitted["small"] += 1
            continue
        polygon = polygon.simplify(.5, preserve_topology=True)
        if polygon.is_empty or not polygon.is_valid or polygon.geom_type not in ("Polygon", "MultiPolygon"):
            omitted["invalid"] += 1
            continue
        mapped = json.loads(json.dumps(mapping(polygon)))
        polygons = [mapped["coordinates"]] if mapped["type"] == "Polygon" else mapped["coordinates"]
        if sum(len(ring) for rings in polygons for ring in rings) > MAX_VERTICES:
            omitted["complex"] += 1
            continue
        left, top, right, bottom = polygon.bounds
        x0, y0 = max(0, int(math.floor(left))), max(0, int(math.floor(top)))
        x1, y1 = min(labels.shape[1], int(math.ceil(right))), min(labels.shape[0], int(math.ceil(bottom)))
        inside = geometry_mask([geometry], out_shape=(y1 - y0, x1 - x0), transform=Affine.translation(x0, y0), invert=True)
        selected = inside & (labels[y0:y1, x0:x1] == value)
        score = float(scores[y0:y1, x0:x1][selected].mean()) if selected.any() else 0.0
        identity = str(uuid.uuid5(uuid.NAMESPACE_URL, fingerprint + ":" + str(value) + ":" + json.dumps(mapped, sort_keys=True)))
        components.append({"id": identity, "className": palette[value], "score": round(score, 6), "geometry": mapped})
    components.sort(key=lambda c: (-shape(c["geometry"]).area, c["id"]))
    omitted["capacity"] = max(0, len(components) - MAX_COMPONENTS)
    return components[:MAX_COMPONENTS], omitted


def _artifact(image):
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    raw = stream.getvalue()
    if len(raw) > 8 * 1024 * 1024:
        _fail("RESOURCE_LIMIT", "The local segmentation artifact exceeds the 8 MiB output limit.")
    return {"sha256": _sha(raw), "width": image.width, "height": image.height, "bytes": len(raw), "base64": base64.b64encode(raw).decode("ascii"), "mimeType": "image/png"}


def infer_spatial(payload, s3=None):
    model, source, page, region = _validate_request(payload)
    _verified_path(model)
    dependency_error = _runtime_dependency_error()
    if dependency_error:
        _fail("DEPENDENCY_UNAVAILABLE", dependency_error)
    raw = _read_source(source, s3)
    image, transform = _source_raster(raw, source["mimeType"], page, region, model["task"])
    started = time.perf_counter()
    try:
        labels, scores, palette, score_kind = _run_model(model, image)
        elapsed = (time.perf_counter() - started) * 1000
        components, omissions = _components(labels, scores, palette, payload["inputFingerprint"])
    except SpatialInferenceError:
        raise
    except Exception as error:
        # Keep diagnostics private and bounded; never log source bytes, payloads,
        # exception text, credentials or full filesystem paths.
        frames = traceback.extract_tb(error.__traceback__)[-8:]
        logger.error("Local spatial inference failed (%s; frames=%s)", type(error).__name__, ",".join(f"{Path(frame.filename).name}:{frame.lineno}:{frame.name}" for frame in frames))
        _fail("INFERENCE_FAILED", "Local inference could not complete. No spatial facts were applied; retry a smaller selected region.")
    raster = _artifact(image)
    raster["transform"] = transform
    mask = _artifact(Image.fromarray(labels))
    import onnxruntime as ort
    receipt = {"sourceId": source["id"], "sourceSha256": source["sha256"], "inputFingerprint": payload["inputFingerprint"], "modelSha256": model["sha256"], "profileVersion": model["profileVersion"], "actualInference": True, "inferenceMs": round(elapsed, 3), "backend": "onnxruntime-cpu", "runtimeVersion": ort.__version__, "threads": 2, "preprocessing": model["preprocessing"], "scoreKind": score_kind, "scoresCalibrated": False, "evidenceState": "unresolved", "spatialAuthority": False, "coordinateUnit": "pixel", "maskEncoding": "class" if model["task"] == "floor-plan" else "instance", "maskPalette": palette, "foregroundPixels": int((labels > 0).sum()), "polygonization": {"method": "pixel-edge-4-connected", "simplificationPixels": .5, "minimumPixels": 16, "maxComponents": MAX_COMPONENTS, "maxVertices": MAX_VERTICES}, "omittedComponents": omissions, "quality": model["quality"], "limitations": ["Review every candidate against the source; false positives and missed regions occur.", "A room or roof region does not establish ownership, a legal unit, height, level or metric geometry.", "Named-frame calibration and independent placement evidence are required before metric application."]}
    if model["task"] == "building":
        tiles = _building_layout(image)
        tiled = len(tiles) > 1
        receipt["maskEncoding"] = "class" if tiled else "instance"
        receipt["tiling"] = {"enabled": tiled, "tileEdge": BUILDING_TILE, "stride": BUILDING_STRIDE, "edgeRule": "anchor final tile to far edge; no padding", "order": "row-major", "tiles": tiles, "seamRule": "binary foreground union; maximum accepted instance confidence at each pixel" if tiled else "single tile; higher-confidence instance wins overlapping pixels"}
        if tiled:
            receipt["limitations"].append("Overlap union can merge touching roofs or retain edge false positives. Review and separate connected candidates; tiled boundaries have not been independently accuracy-qualified.")
    return {"schemaVersion": SCHEMA, "inputFingerprint": payload["inputFingerprint"], "task": model["task"], "status": "succeeded" if components else "empty", "model": {key: model[key] for key in ("id", "sha256", "profileVersion", "license")}, "raster": raster, "mask": mask, "components": components, "receipt": receipt}
