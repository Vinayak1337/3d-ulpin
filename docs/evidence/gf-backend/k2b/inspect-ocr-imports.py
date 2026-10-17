"""Isolate runner imports after a direct attempt retained no exception text."""
from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path


def main() -> int:
    debug = Path("E:/BhuAayam-data/task-data/k2/ocr-debug")
    log = debug / "import-traceback-k2b.txt"
    with log.open("x", encoding="utf-8", buffering=1) as stream:
        sys.stderr = stream
        sys.stdout = stream
        print("Runner import preflight only; no page render or OCR execution.", flush=True)
        try:
            from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
            print("accelerator_options imported", flush=True)
            from docling.datamodel.base_models import ConversionStatus, InputFormat
            print("base_models imported", flush=True)
            from docling.datamodel.pipeline_options import OcrMode, PdfPipelineOptions, TesseractCliOcrOptions
            print("pipeline_options imported", flush=True)
            from docling.document_converter import DocumentConverter, ImageFormatOption
            print("document_converter imported", flush=True)
            print(json.dumps({"runnerImportsAvailable": True}), flush=True)
            return 0
        except Exception:
            traceback.print_exc(file=stream)
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
