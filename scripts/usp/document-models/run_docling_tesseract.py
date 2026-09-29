#!/usr/bin/env python3
"""One bounded, offline Docling/Tesseract trial on the retained USGS crop."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import subprocess
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "services" / "geo"))
from run_trial import _run_worker


SOURCE_SHA256 = "fc554d896f7620149f0c540ad996efc6f0ff26405d8ab77ee7ed1169aaccadcf"
CROP_SHA256 = "5736f02aa05953d0364fdde5d78962325c0d6c448a9767628fd30104081ae30e"
MODEL_REVISION = "8f39ad3c0b4c58e9c2d2c84a38465abf757272d8"
MODEL_HASHES = {
    "config.json": "fdea30805ce2f5666b147fca941dcdd27ad468e27d6ed21902207d3da056a97d",
    "preprocessor_config.json": "cd38cd59999e7a95d68e487fbe5132df3d4e5c32a0836add57e6126ba0c4eaf1",
    "model.safetensors": "00333a43451945aaf89db8ca9c0a17e75d1537c17db60fdb91aa95f4c7929e0c",
}
TESSERACT_SHA256 = "ea22b4adaa35ba9f449aaff9f111c97550ecd2220510cdce60c1503465a38357"
ENG_SHA256 = "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2"
MAX_SECONDS = 600
MAX_MEMORY_BYTES = 6 * 1024**3


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _check(path: Path, expected: str) -> dict[str, Any]:
    observed = sha256(path)
    if observed != expected:
        raise ValueError(f"unexpected bytes at {path}: {observed}")
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": observed}


def _worker(args: argparse.Namespace) -> None:
    # The parent verifies all bytes and attaches this process to the Windows Job
    # before this entry point runs. The pipeline receives only local artifacts.
    from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
    from docling.datamodel.base_models import ConversionStatus, InputFormat
    from docling.datamodel.pipeline_options import OcrMode, PdfPipelineOptions, TesseractCliOcrOptions
    from docling.document_converter import DocumentConverter, ImageFormatOption

    options = PdfPipelineOptions(
        artifacts_path=args.models,
        accelerator_options=AcceleratorOptions(device=AcceleratorDevice.CPU, num_threads=2),
        document_timeout=540,
        do_ocr=True,
        ocr_options=TesseractCliOcrOptions(
            mode=OcrMode.FULL_PAGE,
            lang=["eng"],
            scale=1.0,
            tesseract_cmd=str(args.tesseract),
            path=str(args.tessdata),
        ),
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
    result = converter.convert(args.crop, raises_on_error=False,
                               max_num_pages=1, max_file_size=2 * 1024**2,
                               page_range=(1, 1))
    items = []
    if result.document is not None:
        for item, _level in result.document.iterate_items():
            text = getattr(item, "text", None)
            if not text:
                continue
            provenance = []
            for prov in getattr(item, "prov", []) or []:
                box = prov.bbox
                provenance.append({
                    "cropPageNumber": prov.page_no,
                    "bbox": {"left": box.l, "top": box.t, "right": box.r,
                             "bottom": box.b, "coordOrigin": str(box.coord_origin)},
                    "coordinateFrame": "Docling crop page points (72 per inch from PNG DPI)",
                })
            items.append({"label": str(item.label), "text": text,
                          "provenance": provenance})
    status = ("complete" if result.status == ConversionStatus.SUCCESS
              else "partial" if result.status == ConversionStatus.PARTIAL_SUCCESS
              else "failed")
    output = {
        "status": status,
        "doclingStatus": str(result.status),
        "method": "Docling 2.131.0 ImageFormatOption / Tesseract CLI full-page OCR / Heron layout",
        "items": items,
        "errors": [str(error) for error in result.errors],
    }
    (args.output / "conversion.json").write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--original", type=Path, required=True)
    parser.add_argument("--crop", type=Path, required=True)
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--tesseract", type=Path, required=True)
    parser.add_argument("--tessdata", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--worker", action="store_true")
    args = parser.parse_args()
    if args.worker:
        _worker(args)
        return
    repo = Path(__file__).resolve().parents[3]
    if args.output.resolve().is_relative_to(repo) or args.output.exists():
        parser.error("output must be a new directory outside Git")
    if args.crop.stat().st_size > 2 * 1024**2:
        parser.error("crop exceeds 2 MiB")
    with Image.open(args.crop) as image:
        if image.size != (1072, 181):
            parser.error("unexpected crop dimensions")
        dpi = image.info.get("dpi")
        if not isinstance(dpi, tuple) or len(dpi) != 2 or min(dpi) <= 0:
            parser.error("crop DPI metadata is missing")
    files = {
        "original": _check(args.original, SOURCE_SHA256),
        "crop": _check(args.crop, CROP_SHA256),
        "tesseract": _check(args.tesseract, TESSERACT_SHA256),
        "engTraineddata": _check(args.tessdata / "eng.traineddata", ENG_SHA256),
        "heron": {name: _check(args.models / "docling-project--docling-layout-heron" / name, value)
                  for name, value in MODEL_HASHES.items()},
    }
    args.output.mkdir(parents=True)
    packages = {name: importlib.metadata.version(name) for name in (
        "docling-slim", "docling-core", "docling-ibm-models", "docling-parse",
        "torch", "transformers", "PyMuPDF", "psutil")}
    script_args = [sys.executable, str(Path(__file__).resolve()), "--worker",
                   "--original", str(args.original), "--crop", str(args.crop),
                   "--models", str(args.models), "--tesseract", str(args.tesseract),
                   "--tessdata", str(args.tessdata), "--output", str(args.output)]
    os.environ["PATH"] = str(args.tesseract.parent) + os.pathsep + os.environ["PATH"]
    os.environ["TESSDATA_PREFIX"] = str(args.tessdata)
    preflight = subprocess.run([str(args.tesseract), "--list-langs"],
                              capture_output=True, text=True, timeout=10, check=True)
    if "eng" not in preflight.stdout.split():
        raise RuntimeError("pinned English tessdata is not discoverable")
    result = _run_worker(script_args, args.output / "worker.log", MAX_SECONDS, MAX_MEMORY_BYTES)
    conversion_path = args.output / "conversion.json"
    conversion = json.loads(conversion_path.read_text(encoding="utf-8")) if conversion_path.exists() else None
    receipt = {
        "schemaVersion": "ai-04f-docling-tesseract-v1",
        "createdUtc": datetime.now(timezone.utc).isoformat(),
        "source": {"pageNumber": 1, "cropNormalized": [0.09, 0.035, 0.39, 0.075],
                   "cropPdfPoints": [107.133, 52.325, 464.244, 112.125],
                   "cropPixels": [1072, 181], "cropDpi": list(dpi),
                   "doclingCropPagePoints": [1072 * 72 / dpi[0], 181 * 72 / dpi[1]],
                   "files": files},
        "model": {"repoId": "docling-project/docling-layout-heron", "revision": MODEL_REVISION,
                  "license": "Apache-2.0"},
        "versions": packages,
        "limits": {"cpuThreads": 2, "memoryBytes": MAX_MEMORY_BYTES,
                   "workerSeconds": MAX_SECONDS, "doclingDocumentSeconds": 540,
                   "maxCropBytes": 2 * 1024**2, "maxPages": 1},
        "worker": result,
        "conversion": conversion,
        "status": (conversion["status"] if conversion and result["exitCode"] == 0
                   and result["stopReason"] is None else "failed"),
        "conversionSha256": sha256(conversion_path) if conversion else None,
    }
    (args.output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": receipt["status"], "worker": result,
                      "receipt": str(args.output / "receipt.json")}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise
