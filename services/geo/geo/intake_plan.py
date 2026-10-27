"""Bounded batch bridge to the existing raster plan reader, candidates only."""
from __future__ import annotations

import base64
import hashlib
import io
from pathlib import Path
from typing import Any

from . import raster_plan
from .validation import InputError

MODEL_ABSENT = "The plan reader's model is not installed in this build."
MAX_BYTES = 16 * 1024**2


def plan_readiness(_: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        model = raster_plan.installed_model()
        import onnxruntime  # noqa: F401
        import pypdfium2  # noqa: F401
        import rasterio  # noqa: F401
    except Exception:
        return {"available": False, "reason": MODEL_ABSENT, "modelSha256": None}
    return {"available": True, "reason": None, "modelSha256": model["sha256"]}


def checked_bytes(data: dict[str, Any]) -> bytes:
    encoded = data.get("base64", "")
    if not isinstance(encoded, str) or len(encoded) > ((MAX_BYTES + 2) // 3) * 4:
        raise InputError("The plan reader takes an original of at most 16 MiB.")
    raw = base64.b64decode(encoded, validate=True)
    if not raw or len(raw) > MAX_BYTES or hashlib.sha256(raw).hexdigest() != data.get("sourceSha256"):
        raise InputError("The plan original differs from its retained hash or size bound.")
    return raw


def requested_page(data: dict[str, Any]) -> tuple[str, int]:
    mime = data.get("mimeType")
    page = data.get("page")
    if mime not in {"image/jpeg", "image/png", "application/pdf"} or type(page) is not int or not 1 <= page <= 8:
        raise InputError("Choose a JPEG or PNG image, or one selected PDF page already read by OCR.")
    if mime != "application/pdf" and page != 1:
        raise InputError("An image has only page 1.")
    return mime, page


def assert_model(expected: str) -> None:
    try:
        model = raster_plan.installed_model()
    except (raster_plan.spatial_ml.SpatialInferenceError, ValueError, StopIteration, OSError):
        raise InputError(MODEL_ABSENT) from None
    if model["sha256"] != expected:
        raise InputError(MODEL_ABSENT)


def page_selection(data: dict[str, Any], segmented: raster_plan.Segmentation) -> raster_plan.PlanSelection:
    transform = segmented.transform
    bounds = transform.get("pdfPagePoints", [transform["sourceWidth"], transform["sourceHeight"]])
    if data["mimeType"] == "application/pdf":
        frame = data.get("ocrFrame")
        if (not isinstance(frame, dict) or frame.get("rotation") != 0
                or abs(frame.get("width", 0) - bounds[0]) > 0.01
                or abs(frame.get("height", 0) - bounds[1]) > 0.01):
            raise InputError("The plan raster differs from the selected OCR page frame.")
    return raster_plan.PlanSelection(data["sourceId"], Path("unused"), data["sourceSha256"], data["page"],
                                     f"{data['sourceId']}/page/{data['page']}", (0, 0, *bounds),
                                     "Officer requested candidate rooms; no level or world placement.")


def plan_overlay(segmented: raster_plan.Segmentation) -> dict[str, Any] | None:
    output = io.BytesIO()
    image = raster_plan.overlay_image(segmented)
    image.save(output, format="PNG")
    raw = output.getvalue()
    if len(raw) > 1024**2:
        return None
    return {"mediaType": "image/png", "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw), "base64": base64.b64encode(raw).decode("ascii"),
            "width": image.width, "height": image.height}


def photo_citations(result: dict[str, Any]) -> None:
    result["gaps"].append("image_ocr_unavailable")
    result["sourceCitation"]["locator"]["unit"] = "pixel"
    for room in result["rooms"]:
        room["pixelFrame"] = "EXIF-normalized full image; pixel-edge; x right, y down"
        for citation in room["citations"]:
            citation["locator"]["unit"] = "pixel"


def plan_reading(data: dict[str, Any]) -> dict[str, Any]:
    raw = checked_bytes(data)
    mime, page = requested_page(data)
    assert_model(data["expectedModelSha256"])
    segmented = raster_plan.segment_bytes(raw, mime, page, {"x": 0, "y": 0, "width": 1, "height": 1})
    selection = page_selection(data, segmented)
    # No verified dimension-line endpoints enter this batch step yet. DPI or room bounds never set scale.
    # Photos have no accepted page OCR in this path; never accept caller-supplied photo labels.
    observations = data.get("observations", []) if mime == "application/pdf" else []
    result = raster_plan.panel_result(selection, segmented, observations)
    result["candidates"] = [{**candidate, "inputManifest": f"job:{data['jobId']}", "outputRef": f"#/rooms/{index}"}
                            for index, candidate in enumerate(result["candidates"])]
    result["overlay"] = plan_overlay(segmented)
    if result["overlay"] is None:
        result["gaps"].append("overlay_byte_limit")
    if mime != "application/pdf":
        photo_citations(result)
    return result
