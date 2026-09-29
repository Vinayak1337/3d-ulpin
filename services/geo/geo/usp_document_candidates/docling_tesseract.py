"""Bounded, offline PDF-page OCR with source-page citations.

This optional adapter emits OCR observations only. It does not publish evidence,
replace native text, infer property facts, or assert transcription completeness.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

import fitz
from PIL import Image


MAX_SOURCE_BYTES = 16 * 1024**2
MAX_SOURCE_PAGES = 8
MAX_PAGE_SIDE_POINTS = 2_000
MAX_PIXELS = 1_600_000
MAX_IMAGE_SIDE = 1_400
MAX_PNG_BYTES = 8 * 1024**2
MAX_ITEMS = 64
MAX_ITEM_TEXT_BYTES = 2_048
MAX_TOTAL_TEXT_BYTES = 32 * 1024
MAX_RESULT_BYTES = 128 * 1024
MAX_ISSUES = 32

MODEL_REVISION = "8f39ad3c0b4c58e9c2d2c84a38465abf757272d8"
MODEL_HASHES = {
    "config.json": "fdea30805ce2f5666b147fca941dcdd27ad468e27d6ed21902207d3da056a97d",
    "preprocessor_config.json": "cd38cd59999e7a95d68e487fbe5132df3d4e5c32a0836add57e6126ba0c4eaf1",
    "model.safetensors": "00333a43451945aaf89db8ca9c0a17e75d1537c17db60fdb91aa95f4c7929e0c",
}
TESSERACT_SHA256 = "ea22b4adaa35ba9f449aaff9f111c97550ecd2220510cdce60c1503465a38357"
ENG_SHA256 = "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2"


class SourceOcrError(Exception):
    def __init__(self, code: str, *, unsupported: bool = False) -> None:
        super().__init__(code)
        self.code = code
        self.unsupported = unsupported


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _check_file(path: Path, expected: str) -> dict[str, Any]:
    if not path.is_file():
        raise SourceOcrError("missing_local_asset")
    observed = sha256_file(path)
    if observed != expected:
        raise SourceOcrError("local_asset_hash_mismatch")
    return {"bytes": path.stat().st_size, "sha256": observed}


def verify_assets(models: Path, tesseract: Path, tessdata: Path) -> dict[str, Any]:
    """Local, hash-pinned assets only; never asks a library to download them."""
    model = models / "docling-project--docling-layout-heron"
    return {
        "modelRepo": "docling-project/docling-layout-heron",
        "modelRevision": MODEL_REVISION,
        "modelFiles": {name: _check_file(model / name, expected)
                       for name, expected in MODEL_HASHES.items()},
        "tesseract": _check_file(tesseract, TESSERACT_SHA256),
        "engTraineddata": _check_file(tessdata / "eng.traineddata", ENG_SHA256),
        "osdAvailable": (tessdata / "osd.traineddata").is_file(),
    }


def verify_source(source: Path, expected_sha256: str) -> dict[str, Any]:
    if not source.is_file() or source.stat().st_size > MAX_SOURCE_BYTES:
        raise SourceOcrError("source_missing_or_over_byte_limit")
    if len(expected_sha256) != 64 or any(c not in "0123456789abcdef" for c in expected_sha256):
        raise SourceOcrError("invalid_expected_source_sha256")
    with source.open("rb") as stream:
        data = stream.read(MAX_SOURCE_BYTES + 1)
        if stream.read(1):
            raise SourceOcrError("source_missing_or_over_byte_limit")
    if len(data) > MAX_SOURCE_BYTES:
        raise SourceOcrError("source_missing_or_over_byte_limit")
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected_sha256:
        raise SourceOcrError("source_hash_mismatch")
    return {"bytes": len(data), "sha256": actual}


def _selection(page: fitz.Page, region: list[float] | None) -> tuple[fitz.Rect, list[float]]:
    rect = page.rect
    if (page.rotation != 0 or not all(math.isfinite(v) for v in rect)
            or abs(rect.x0) > 1e-7 or abs(rect.y0) > 1e-7
            or rect.width > MAX_PAGE_SIDE_POINTS or rect.height > MAX_PAGE_SIDE_POINTS):
        raise SourceOcrError("unsupported_pdf_page_frame", unsupported=True)
    if region is None:
        return rect, [rect.x0, rect.y0, rect.x1, rect.y1]
    if (len(region) != 4 or any(isinstance(v, bool) or not isinstance(v, (int, float))
                                or not math.isfinite(v) for v in region)):
        raise SourceOcrError("invalid_region")
    x0, y0, x1, y1 = region
    if not (0 <= x0 < x1 <= rect.x1 and 0 <= y0 < y1 <= rect.y1
            and x1 - x0 >= 1 and y1 - y0 >= 1):
        raise SourceOcrError("region_outside_supported_page")
    return fitz.Rect(x0, y0, x1, y1), [float(x0), float(y0), float(x1), float(y1)]


def render_pdf_selection(source: Path, expected_sha256: str, page_number: int,
                         region: list[float] | None, png_path: Path) -> dict[str, Any]:
    """Render once inside the supervised worker; expose its exact pixel affine."""
    # Open exactly the bytes we hash. A path hash followed by a second parser
    # open could cite a replacement file if the path changes between them.
    if not source.is_file() or source.stat().st_size > MAX_SOURCE_BYTES:
        raise SourceOcrError("source_missing_or_over_byte_limit")
    with source.open("rb") as stream:
        original = stream.read(MAX_SOURCE_BYTES + 1)
        if stream.read(1):
            raise SourceOcrError("source_missing_or_over_byte_limit")
    if len(original) > MAX_SOURCE_BYTES:
        raise SourceOcrError("source_missing_or_over_byte_limit")
    actual_sha256 = hashlib.sha256(original).hexdigest()
    if actual_sha256 != expected_sha256:
        raise SourceOcrError("source_hash_mismatch")
    verified = {"bytes": len(original), "sha256": actual_sha256}
    if isinstance(page_number, bool) or not isinstance(page_number, int) or page_number < 1:
        raise SourceOcrError("invalid_page_number")
    with fitz.open(stream=original, filetype="pdf") as document:
        if document.xref_length() > 50_000:
            raise SourceOcrError("pdf_object_count_unsupported", unsupported=True)
        if document.needs_pass:
            raise SourceOcrError("encrypted_pdf_unsupported", unsupported=True)
        if len(document) > MAX_SOURCE_PAGES or page_number > len(document):
            raise SourceOcrError("page_count_or_selection_unsupported", unsupported=True)
        page = document[page_number - 1]
        clip, selected = _selection(page, region)
        scale = min(3.0, MAX_IMAGE_SIDE / clip.width, MAX_IMAGE_SIDE / clip.height,
                    math.sqrt(MAX_PIXELS / (clip.width * clip.height)))
        if not math.isfinite(scale) or scale <= 0:
            raise SourceOcrError("invalid_render_scale")
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip,
                              colorspace=fitz.csRGB, alpha=False)
        if (pix.width * pix.height > MAX_PIXELS or max(pix.width, pix.height) > MAX_IMAGE_SIDE
                or pix.n != 3):
            raise SourceOcrError("render_pixel_limit_exceeded")
        png_bytes = pix.tobytes("png")
        if len(png_bytes) > MAX_PNG_BYTES:
            raise SourceOcrError("render_byte_limit_exceeded")
        png_path.write_bytes(png_bytes)
        with Image.open(png_path) as image:
            dpi = image.info.get("dpi")
            if not isinstance(dpi, tuple) or len(dpi) != 2 or min(dpi) <= 0:
                raise SourceOcrError("render_dpi_unavailable")
            dpi_x, dpi_y = float(dpi[0]), float(dpi[1])
        return {
            "source": verified,
            "pageNumber": page_number,
            "pageFrame": {"kind": "pdf_display_page_top_left_points", "rotation": 0,
                          "width": rect_value(page.rect.width), "height": rect_value(page.rect.height)},
            "requestedRegion": selected,
            "regionKind": "whole_page" if region is None else "selected_region",
            "render": {"scale": scale, "pixelOrigin": [pix.x, pix.y],
                       "pixels": [pix.width, pix.height], "dpi": [dpi_x, dpi_y],
                       "doclingPagePoints": [pix.width * 72 / dpi_x,
                                            pix.height * 72 / dpi_y],
                       "pngBytes": png_path.stat().st_size,
                       "pngSha256": sha256_file(png_path)},
        }


def rect_value(value: float) -> float:
    # Keep floats JSON-native without rounding source geometry.
    return float(value)


def source_page_box(box: Any, frame: dict[str, Any]) -> dict[str, Any]:
    """Map a Docling crop-page box through PNG DPI and MuPDF pixel origin."""
    render = frame["render"]
    width, height = render["doclingPagePoints"]
    origin = str(getattr(box.coord_origin, "value", box.coord_origin)).upper()
    if origin in ("BOTTOMLEFT", "COORDORIGIN.BOTTOMLEFT"):
        top, bottom = height - float(box.t), height - float(box.b)
    elif origin in ("TOPLEFT", "COORDORIGIN.TOPLEFT"):
        top, bottom = float(box.t), float(box.b)
    else:
        raise SourceOcrError("unsupported_ocr_box_origin", unsupported=True)
    left, right = float(box.l), float(box.r)
    values = (left, top, right, bottom)
    if (not all(math.isfinite(v) for v in values) or left < 0 or top < 0
            or right > width + 1e-5 or bottom > height + 1e-5
            or left >= right or top >= bottom):
        raise SourceOcrError("invalid_ocr_box")
    scale = render["scale"]
    px0, py0 = render["pixelOrigin"]
    dpi_x, dpi_y = render["dpi"]
    mapped = [
        (px0 + left * dpi_x / 72) / scale,
        (py0 + top * dpi_y / 72) / scale,
        (px0 + right * dpi_x / 72) / scale,
        (py0 + bottom * dpi_y / 72) / scale,
    ]
    page = frame["pageFrame"]
    tolerance = 1 / scale + 1e-5
    if (mapped[0] < -tolerance or mapped[1] < -tolerance
            or mapped[2] > page["width"] + tolerance
            or mapped[3] > page["height"] + tolerance):
        raise SourceOcrError("ocr_box_outside_source_page")
    return {"pageNumber": frame["pageNumber"],
            "frame": "pdf_display_page_top_left_points", "box": mapped,
            "derivedFrom": "docling_crop_page_box_via_png_dpi_and_mupdf_pixel_origin"}


def _append_issue(issues: list[str], code: str) -> None:
    if code not in issues and len(issues) < MAX_ISSUES:
        issues.append(code)


def collect_items(result: Any, frame: dict[str, Any], max_items: int) -> tuple[list[dict[str, Any]], list[str], bool]:
    """Drop uncitable/oversized items and mark the output partial."""
    if not 1 <= max_items <= MAX_ITEMS:
        raise SourceOcrError("invalid_item_limit")
    items: list[dict[str, Any]] = []
    issues: list[str] = []
    partial = False
    total_text = 0
    if result.document is None:
        return items, issues, partial
    for item, _level in result.document.iterate_items():
        value = getattr(item, "text", None)
        if not isinstance(value, str) or not value.strip():
            continue
        if len(items) >= max_items:
            _append_issue(issues, "item_limit_reached")
            partial = True
            break
        text_bytes = len(value.encode("utf-8"))
        if text_bytes > MAX_ITEM_TEXT_BYTES or total_text + text_bytes > MAX_TOTAL_TEXT_BYTES:
            _append_issue(issues, "text_byte_limit_reached")
            partial = True
            continue
        provenance = getattr(item, "prov", None) or []
        if not provenance or len(provenance) > 4:
            _append_issue(issues, "missing_or_excessive_item_provenance")
            partial = True
            continue
        boxes = []
        try:
            for prov in provenance:
                if prov.page_no != 1:
                    raise SourceOcrError("unexpected_crop_page_number", unsupported=True)
                boxes.append(source_page_box(prov.bbox, frame))
        except SourceOcrError as exc:
            _append_issue(issues, exc.code)
            partial = True
            continue
        label = str(getattr(item, "label", "text"))[:64]
        items.append({"text": value, "label": label, "sourcePageBoxes": boxes,
                      "method": "ocr:docling-tesseract-cli-full-page"})
        total_text += text_bytes
    return items, issues, partial


def encode_result_bounded(result: dict[str, Any]) -> bytes:
    payload = (json.dumps(result, ensure_ascii=False, allow_nan=False,
                          separators=(",", ":")) + "\n").encode("utf-8")
    if len(payload) > MAX_RESULT_BYTES:
        raise SourceOcrError("result_byte_limit_exceeded")
    return payload


def extract_source_page(source: Path, expected_sha256: str, page_number: int,
                        region: list[float] | None, png_path: Path,
                        models: Path, tesseract: Path, tessdata: Path,
                        max_items: int = MAX_ITEMS) -> dict[str, Any]:
    """Run one source-bound OCR selection inside an externally supervised tree."""
    from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
    from docling.datamodel.base_models import ConversionStatus, InputFormat
    from docling.datamodel.pipeline_options import OcrMode, PdfPipelineOptions, TesseractCliOcrOptions
    from docling.document_converter import DocumentConverter, ImageFormatOption

    assets = verify_assets(models, tesseract, tessdata)
    frame = render_pdf_selection(source, expected_sha256, page_number, region, png_path)
    options = PdfPipelineOptions(
        artifacts_path=models,
        accelerator_options=AcceleratorOptions(device=AcceleratorDevice.CPU, num_threads=2),
        document_timeout=540,
        do_ocr=True,
        ocr_options=TesseractCliOcrOptions(mode=OcrMode.FULL_PAGE, lang=["eng"], scale=1.0,
                                            tesseract_cmd=str(tesseract), path=str(tessdata)),
        do_table_structure=False,
        do_picture_classification=False,
        do_picture_description=False,
        do_chart_extraction=False,
        do_code_enrichment=False,
        do_formula_enrichment=False,
        enable_remote_services=False,
        allow_external_plugins=False,
        images_scale=1.0,
        generate_page_images=False,
        generate_picture_images=False,
    )
    converter = DocumentConverter(
        allowed_formats=[InputFormat.IMAGE],
        format_options={InputFormat.IMAGE: ImageFormatOption(pipeline_options=options)},
    )
    converted = converter.convert(png_path, raises_on_error=False, max_num_pages=1,
                                  max_file_size=MAX_PNG_BYTES, page_range=(1, 1))
    items, issues, output_partial = collect_items(converted, frame, max_items)
    if converted.status == ConversionStatus.SUCCESS and not items:
        _append_issue(issues, "no_ocr_text_emitted")
        output_partial = True
    if not assets["osdAvailable"]:
        _append_issue(issues, "orientation_script_detection_unavailable")
    for error in converted.errors[:8]:
        _append_issue(issues, "docling_error:" + str(error)[:160])
    tool_status = ("complete" if converted.status == ConversionStatus.SUCCESS
                   else "partial" if converted.status == ConversionStatus.PARTIAL_SUCCESS
                   else "failed")
    output_status = ("failed" if tool_status == "failed" else
                     "partial" if tool_status == "partial" or output_partial else "complete")
    return {
        "schemaVersion": "source-ocr-candidate/1",
        "sourceSha256": frame["source"]["sha256"],
        "sourceBytes": frame["source"]["bytes"],
        "sourcePage": frame["pageNumber"],
        "sourcePageFrame": frame["pageFrame"],
        "selection": {"kind": frame["regionKind"], "sourcePageBox": frame["requestedRegion"],
                      "rasterProcessing": "complete" if tool_status == "complete" else tool_status,
                      "textCompleteness": "unverified"},
        "render": frame["render"],
        "toolStatus": tool_status,
        "outputStatus": output_status,
        "method": "ocr:docling-slim-2.131.0:tesseract-cli-5.5.1:heron-pinned",
        "items": items,
        "issues": issues,
        "contentCaution": "OCR-derived observations; omitted or incorrect text is possible; no native-text or learning-label claim",
    }
