"""Fresh pixel-only private PDF region; no PDF objects or applicability decisions."""
from __future__ import annotations
import hashlib
import io
import math
from pathlib import Path

MAX_SOURCE = 16 * 1024**2
MAX_PIXELS = 1_600_000
MAX_SIDE = 1400
MAX_PNG = 8 * 1024**2
PDFIUM_HASH = "fb898a1f5ace57805834f390407500bdb6ef93eff326a252ad334a8aae809d8e"


class RegionError(Exception):
    pass


def recipe_hash(repo: Path) -> str:
    from packet_region_loader import recipe_hash as verified_recipe
    return verified_recipe(repo)


def pixel_transform(selection: dict) -> dict:
    frame, region = selection["frame"], selection["region"]
    width, height = frame["width"], frame["height"]
    if (not isinstance(region, list) or len(region) != 4 or
            any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in region) or
            not 0 <= region[0] < region[2] <= 1 or not 0 <= region[1] < region[3] <= 1):
        raise RegionError("PACKET_REGION_SELECTION")
    if (not all(math.isfinite(v) and 0 < v <= 14400 for v in (width, height)) or
            frame["rotation"] not in (0, 90, 180, 270)):
        raise RegionError("PACKET_REGION_FRAME_UNSUPPORTED")
    w, h = (region[2]-region[0])*width, (region[3]-region[1])*height
    if min(w, h) < 1 or max(w, h) > 2000:
        raise RegionError("PACKET_REGION_SELECTION_LIMIT")
    scale = min(3., (MAX_SIDE-2)/w, (MAX_SIDE-2)/h,
                (MAX_PIXELS-4)/(w+h+math.sqrt((w-h)**2+MAX_PIXELS*w*h)))
    canvas = [math.ceil(width*scale), math.ceil(height*scale)]
    pixels = [math.ceil(region[0]*canvas[0]), math.ceil(region[1]*canvas[1]),
              math.floor(region[2]*canvas[0]), math.floor(region[3]*canvas[1])]
    pw, ph = pixels[2]-pixels[0], pixels[3]-pixels[1]
    if min(pw, ph) < 1 or max(pw, ph) > MAX_SIDE or pw*ph > MAX_PIXELS:
        raise RegionError("PACKET_REGION_PIXEL_LIMIT")
    sx, sy = width/canvas[0], height/canvas[1]
    return {"canvasPixels": canvas, "pixelRegion": pixels,
            "pixelToDisplay": [sx, 0, 0, sy, pixels[0]*sx, pixels[1]*sy],
            "includedNormalizedRegion": [pixels[0]/canvas[0], pixels[1]/canvas[1],
                                         pixels[2]/canvas[0], pixels[3]/canvas[1]],
            "rounding": "inward_complete_pixels/1"}


def extract_region(original: bytes, expected_hash: str, page_number: int, selection: dict,
                   repo: Path) -> tuple[dict, bytes]:
    recipe = recipe_hash(repo)  # Require verified execution before native imports.
    import importlib.metadata
    import fitz
    import pypdfium2 as pdfium
    import pypdfium2_raw as raw
    from PIL import Image
    # Reuse the existing external-file/JavaScript admission check unchanged.
    from run_pdf_pages import _deny_external_files, PageError
    if not 0 < len(original) <= MAX_SOURCE:
        raise RegionError("PACKET_REGION_SOURCE_LIMIT")
    if hashlib.sha256(original).hexdigest() != expected_hash:
        raise RegionError("PACKET_REGION_SOURCE_INTEGRITY")
    if (any(importlib.metadata.version(name) != version for name, version in
            (("pypdfium2", "5.13.0"), ("PyMuPDF", "1.25.5"), ("Pillow", "12.3.0"))) or
            str(pdfium.PDFIUM_INFO) != "153.0.7999.0"):
        raise RegionError("PACKET_REGION_RUNTIME_VERSION")
    library = Path(raw.__file__).parent / "pdfium.dll"
    if not library.is_file() or hashlib.sha256(library.read_bytes()).hexdigest() != PDFIUM_HASH:
        raise RegionError("PACKET_REGION_RUNTIME_ASSET")
    if not original.startswith(b"%PDF-"):
        raise RegionError("PACKET_REGION_PDF_REQUIRED")
    transform = pixel_transform(selection)
    with fitz.open(stream=original, filetype="pdf") as document:
        if document.needs_pass or document.xref_get_key(-1, "Encrypt")[0] != "null":
            raise RegionError("PACKET_REGION_ENCRYPTED")
        if not 1 <= len(document) <= 8 or document.xref_length() > 50_000:
            raise RegionError("PACKET_REGION_DOCUMENT_LIMIT")
        if not 1 <= page_number <= len(document):
            raise RegionError("PACKET_REGION_PAGE_NOT_FOUND")
        try:
            _deny_external_files(document)
        except PageError:
            raise RegionError("PACKET_REGION_ACTIVE_OR_EXTERNAL_UNSUPPORTED") from None
        if document.xref_get_key(document.pdf_catalog(), "AcroForm")[0] != "null":
            raise RegionError("PACKET_REGION_FORMS_UNSUPPORTED")
        for xref in range(1, document.xref_length()):
            if document.xref_get_key(xref, "S")[1] in ("/Launch", "/GoToR", "/SubmitForm", "/ImportData", "/Rendition"):
                raise RegionError("PACKET_REGION_ACTIVE_OR_EXTERNAL_UNSUPPORTED")
        page = document[page_number-1]
        actual = {"frame": {"kind": "pdf_display_page_top_left_points", "rotation": page.rotation,
                            "width": float(page.rect.width), "height": float(page.rect.height)},
                  "mediaBox": list(page.mediabox), "cropBox": list(page.cropbox)}
        if any(actual[key] != selection[key] for key in actual):
            raise RegionError("PACKET_REGION_FRAME_MISMATCH")
        if (selection.get("coordinates") != "displayed_cropbox_normalized_top_left/1" or
                selection.get("boxConvention") != "pymupdf_page_rectangles/1" or
                selection.get("selectionAcknowledged") is not True):
            raise RegionError("PACKET_REGION_SELECTION")
    # Same hashed bytes go to PDFium. Forms/JS/XFA are never initialized.
    with pdfium.PdfDocument(original) as document:
        page = document[page_number-1]
        try:
            width, height = page.get_size()
            if abs(width-selection["frame"]["width"]) > 1e-5 or abs(height-selection["frame"]["height"]) > 1e-5:
                raise RegionError("PACKET_REGION_FRAME_UNSUPPORTED")
            left, top, right, bottom = transform["pixelRegion"]
            canvas_w, canvas_h = transform["canvasPixels"]
            bitmap = pdfium.PdfBitmap.new_native(right-left, bottom-top, format=raw.FPDFBitmap_BGR)
            try:
                bitmap.fill_rect((255, 255, 255, 255), 0, 0, bitmap.width, bitmap.height)
                # Only the inward-rounded region bitmap is allocated. No annotation
                # flag, form drawing, page copying or interpolation of neighbouring pixels.
                flags = raw.FPDF_RENDER_LIMITEDIMAGECACHE | raw.FPDF_RENDER_NO_SMOOTHTEXT | raw.FPDF_RENDER_NO_SMOOTHIMAGE | raw.FPDF_RENDER_NO_SMOOTHPATH
                raw.FPDF_RenderPageBitmap(bitmap, page, -left, -top, canvas_w, canvas_h, 0, flags)
                with bitmap.to_pil() as rendered:
                    rgb = rendered.convert("RGB")
                    try:
                        clean = Image.frombytes("RGB", rgb.size, rgb.tobytes())
                        try:
                            buffer = io.BytesIO()
                            clean.save(buffer, format="PNG")
                            png = buffer.getvalue()
                        finally:
                            clean.close()
                    finally:
                        rgb.close()
            finally:
                bitmap.close()
        finally:
            page.close()
    if len(png) > MAX_PNG:
        raise RegionError("PACKET_REGION_OUTPUT_LIMIT")
    result = {"version": "packet-region-local/1", "sourceSha256": expected_hash, "sourceBytes": len(original),
              "page": page_number, "selection": selection, "recipeSha256": recipe,
              "renderer": {"pypdfium2": "5.13.0", "pdfium": "153.0.7999.0", "pymupdf": "1.25.5", "pillow": "12.3.0", "pdfiumSha256": PDFIUM_HASH},
              "transform": transform, "output": {"sha256": hashlib.sha256(png).hexdigest(), "bytes": len(png),
                "pixels": [right-left, bottom-top], "format": "png", "metadataPolicy": "fresh_rgb_pixels_only/1",
                "annotations": "excluded", "applicability": "not_assessed"}}
    return result, png
