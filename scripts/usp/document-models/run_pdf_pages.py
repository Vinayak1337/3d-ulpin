#!/usr/bin/env python3
"""Supervised original-backed page metadata/raster; no OCR or model execution."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sys

SCRIPT = Path(__file__).resolve()
REPO = SCRIPT.parents[3]
sys.path.insert(0, str(REPO / "services" / "geo"))
MAX_SOURCE = 16 * 1024**2
MAX_RESULT = 128 * 1024
MEMORY = 2 * 1024**3


class PageError(Exception):
    pass


def _encode(value: dict) -> bytes:
    data = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    if len(data) > MAX_RESULT:
        raise PageError("DOCUMENT_PAGES_METADATA_LIMIT")
    return data


def _offline_worker() -> None:
    # MuPDF opens only the supplied in-memory original; it does not execute PDF
    # JavaScript or resolve hyperlinks. Also deny Python network APIs here.
    import socket
    def denied(*args, **kwargs):
        raise PageError("DOCUMENT_PAGES_EXTERNAL_RESOURCE_DENIED")
    socket.socket = denied
    socket.create_connection = denied
    socket.getaddrinfo = denied
    if os.name != "nt":
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (MEMORY, MEMORY))
        resource.setrlimit(resource.RLIMIT_CPU, (30, 30))


def _deny_external_files(document) -> None:
    """Reject file-backed streams/reference XObjects before invoking a rasterizer.

    Ordinary URI link annotations are inert: no link is followed or action run.
    Attachments are never opened; no JavaScript action is executed.
    """
    if document.xref_get_key(-1, "Encrypt")[0] != "null":
        raise PageError("DOCUMENT_PAGES_ENCRYPTED")
    for xref in range(1, document.xref_length()):
        if document.xref_get_key(xref, "S")[1] == "/JavaScript":
            raise PageError("DOCUMENT_PAGES_EXTERNAL_RESOURCE_UNSUPPORTED")
        # F is also a valid arbitrary dictionary/resource name. Only a stream's
        # F has external-file semantics; standalone Filespec declarations are
        # inert and must not be interpreted as an attempted filesystem read.
        if document.xref_is_stream(xref) and document.xref_get_key(xref, "F")[0] != "null":
            raise PageError("DOCUMENT_PAGES_EXTERNAL_RESOURCE_UNSUPPORTED")
        if document.xref_get_key(xref, "Ref/F")[0] != "null":
            raise PageError("DOCUMENT_PAGES_EXTERNAL_RESOURCE_UNSUPPORTED")


def inspect_pages(source: Path, expected_hash: str, offset: int, limit: int,
                  selected_page: int | None, output: Path) -> dict:
    import fitz
    from geo.usp_document_candidates.docling_tesseract import (
        render_pdf_selection, SourceOcrError, whole_page_view_scale, MAX_SOURCE_PAGES,
    )
    if not source.is_file() or not 0 < source.stat().st_size <= MAX_SOURCE:
        raise PageError("DOCUMENT_PAGES_SOURCE_LIMIT")
    with source.open("rb") as stream:
        original = stream.read(MAX_SOURCE + 1)
    if len(original) > MAX_SOURCE:
        raise PageError("DOCUMENT_PAGES_SOURCE_LIMIT")
    if hashlib.sha256(original).hexdigest() != expected_hash:
        raise PageError("DOCUMENT_PAGES_SOURCE_INTEGRITY")
    if not original.startswith(b"%PDF-"):
        raise PageError("DOCUMENT_PAGES_PDF_REQUIRED")
    with fitz.open(stream=original, filetype="pdf") as document:
        if document.needs_pass:
            raise PageError("DOCUMENT_PAGES_ENCRYPTED")
        if document.xref_length() > 50_000 or not 1 <= document.page_count <= 400:
            raise PageError("DOCUMENT_PAGES_PDF_LIMIT")
        _deny_external_files(document)
        count = document.page_count
        if selected_page is not None:
            if not 1 <= selected_page <= count:
                raise PageError("DOCUMENT_PAGE_NOT_FOUND")
            offset, limit = selected_page - 1, 1
        if not 0 <= offset < count or not 1 <= limit <= 50:
            raise PageError("DOCUMENT_PAGE_NOT_FOUND")
        pages = []
        for index in range(offset, min(count, offset + limit)):
            page = document[index]
            label = page.get_label() or None
            if label is not None and len(label) > 200:
                raise PageError("DOCUMENT_PAGES_LABEL_LIMIT")
            values = [*page.rect, *page.mediabox, *page.cropbox]
            if any(not math.isfinite(v) or abs(v) > 10_000_000 for v in values) or min(page.rect.width, page.rect.height) <= 0:
                raise PageError("DOCUMENT_PAGES_FRAME_UNSUPPORTED")
            support, reduced = "unsupported", None
            if count <= MAX_SOURCE_PAGES:
                try:
                    reduced = whole_page_view_scale(page)
                    support = "supported" if reduced is None else "reduced"
                except SourceOcrError:
                    pass
            pages.append({"page": index + 1, "label": label or f"Page {index + 1}", "sourceLabel": label,
                          "frame": {"kind": "pdf_display_page_top_left_points", "rotation": page.rotation,
                                    "width": float(page.rect.width), "height": float(page.rect.height)},
                          "mediaBox": list(page.mediabox), "cropBox": list(page.cropbox),
                          "boxConvention": "pymupdf_page_rectangles/1", "renderSupport": support,
                          **({} if reduced is None else {"reducedScalePxPerPt": reduced})})
    rendered = None
    if selected_page is not None:
        if pages[0]["renderSupport"] == "unsupported":
            raise PageError("DOCUMENT_PAGES_RENDER_PROFILE_UNSUPPORTED")
        # This picture is for viewing and goes to the HTTP answer only. It is the one caller that may draw
        # a page over the whole-page limit, reduced; nothing reads it back as an input.
        frame = render_pdf_selection(source, expected_hash, selected_page, None, output / "page.png",
                                     viewing=True)
        if frame["source"] != {"bytes": len(original), "sha256": expected_hash}:
            raise PageError("DOCUMENT_PAGES_SOURCE_INTEGRITY")
        image = frame["render"]
        rendered = {"page": selected_page, "sha256": image["pngSha256"], "bytes": image["pngBytes"],
                    "pixels": image["pixels"], "scale": image["scale"], "pixelOrigin": image["pixelOrigin"], "dpi": image["dpi"]}
        if pages[0]["renderSupport"] == "reduced":
            rendered["reduced"] = True
    return {"version": "document-pages-local/1", "sourceSha256": expected_hash, "sourceBytes": len(original),
            "pageCount": count, "offset": offset, "limit": limit, "pages": pages, "render": rendered}


def worker(args: argparse.Namespace) -> int:
    _offline_worker()
    try:
        result = inspect_pages(args.source, args.sha256, args.offset, args.limit, args.page, args.output)
        data = _encode(result)
    except Exception as error:
        code = str(error) if isinstance(error, PageError) else "DOCUMENT_PAGES_PARSE_FAILED"
        data = _encode({"version": "document-pages-failure/1", "code": code})
        (args.output / "result.json").write_bytes(data)
        return 1
    (args.output / "result.json").write_bytes(data)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--page", type=int)
    parser.add_argument("--seconds", type=int, default=25)
    parser.add_argument("--worker", action="store_true")
    args = parser.parse_args()
    if not (0 <= args.offset <= 399 and 1 <= args.limit <= 50 and 1 <= args.seconds <= 25
            and (args.page is None or 1 <= args.page <= 400)
            and len(args.sha256) == 64 and all(c in "0123456789abcdef" for c in args.sha256)):
        parser.error("unsupported page selection or bounds")
    if args.worker:
        return worker(args)
    # Reuse the accepted gated Windows Job/process-tree supervisor. It imports
    # reusable code only; no model loading, verification or inference is called.
    from run_trial import _run_worker
    args.output.mkdir(mode=0o700, parents=False, exist_ok=False)
    command = [sys.executable, str(SCRIPT), *sys.argv[1:], "--worker"]
    execution = _run_worker(command, args.output / "worker.log", args.seconds, MEMORY, 64 * 1024)
    result = args.output / "result.json"
    result_hash = None
    if result.is_file() and result.stat().st_size <= MAX_RESULT:
        result_hash = hashlib.sha256(result.read_bytes()).hexdigest()
    receipt = {"version": "document-pages-execution/1", "seconds": args.seconds, "memoryBytes": MEMORY,
               "worker": execution, "resultSha256": result_hash}
    (args.output / "receipt.json").write_bytes(_encode(receipt))
    return 0 if execution["exitCode"] == 0 and execution["stopReason"] is None and result_hash else 1


if __name__ == "__main__":
    raise SystemExit(main())
