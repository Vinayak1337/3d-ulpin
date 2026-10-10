#!/usr/bin/env python3
"""K9e Step 0: one PDF page drawn whole at stated scales, each in its own process. CPU only; no OCR, no model.

  <python> -I -B docs/evidence/gf1/k9e/measure_whole_page.py --source <scratch copy> --sha256 <hash> \
      --output <new folder under task-data/k9e> --scales bound 0.5 0.4

"bound" is the renderer's own bounded scale for the whole page (its pixel limits, no page-side limit).
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "services" / "geo"))


def one(source: Path, expected: str, page_number: int, scale_text: str, output: Path) -> dict:
    import fitz
    import psutil
    from geo.usp_document_candidates import docling_tesseract as renderer
    original = source.read_bytes()
    if hashlib.sha256(original).hexdigest() != expected:
        raise SystemExit("source hash differs")
    started, cpu = time.perf_counter(), time.process_time()
    with fitz.open(stream=original, filetype="pdf") as document:
        page = document[page_number - 1]
        bound = renderer._bounded_render_scale(page.rect)
        scale = bound if scale_text == "bound" else float(scale_text)
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=page.rect, colorspace=fitz.csRGB, alpha=False)
        png = pix.tobytes("png")
        frame = [float(page.rect.width), float(page.rect.height)]
    wall, cpu = time.perf_counter() - started, time.process_time() - cpu
    name = f"page-{page_number}-at-{scale:.6f}.png"
    (output / name).write_bytes(png)
    return {"asked": scale_text, "scalePxPerPt": scale, "boundScalePxPerPt": bound, "framePt": frame,
            "pixels": [pix.width, pix.height], "totalPixels": pix.width * pix.height,
            "withinPixelBounds": (max(pix.width, pix.height) <= renderer.MAX_IMAGE_SIDE
                                  and pix.width * pix.height <= renderer.MAX_PIXELS),
            "pngBytes": len(png), "pngSha256": hashlib.sha256(png).hexdigest(), "file": name,
            "wallSeconds": round(wall, 3), "cpuSeconds": round(cpu, 3),
            "peakWorkingSetBytes": psutil.Process().memory_info().peak_wset}


def text_heights(source: Path, page_number: int) -> dict:
    """Glyph sizes of the page's own text layer, when it has one; nothing is read from pixels."""
    import fitz
    with fitz.open(source) as document:
        spans = [span for block in document[page_number - 1].get_text("dict")["blocks"]
                 for line in block.get("lines", []) for span in line["spans"] if span["text"].strip()]
    sizes = sorted(span["size"] for span in spans)
    if not sizes:
        return {"textLayerSpans": 0}
    return {"textLayerSpans": len(sizes), "smallestPt": sizes[0], "medianPt": sizes[len(sizes) // 2],
            "largestPt": sizes[-1]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--scales", nargs="+")
    parser.add_argument("--one")
    args = parser.parse_args()
    if args.one:
        print(json.dumps(one(args.source, args.sha256, args.page, args.one, args.output)))
        return 0
    args.output.mkdir(parents=True, exist_ok=False)
    rows = []
    for scale in args.scales:
        done = subprocess.run([sys.executable, "-I", "-B", str(Path(__file__).resolve()), "--source",
                               str(args.source), "--sha256", args.sha256, "--page", str(args.page),
                               "--output", str(args.output), "--one", scale],
                              capture_output=True, text=True, check=True, timeout=120)
        rows.append(json.loads(done.stdout))
    result = {"source": args.source.name, "sha256": args.sha256, "page": args.page,
              "textLayer": text_heights(args.source, args.page), "rows": rows}
    (args.output / "measure.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
