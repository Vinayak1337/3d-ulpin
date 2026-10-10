"""Bounded offline visual derivatives, not OCR, extraction or the product page-render profile."""
from __future__ import annotations

import hashlib
import json
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
OUTPUT = Path("E:/BhuAayam-data/task-data/k4b")
SOURCE = Path("E:/BhuAayam-data/datasets/rera-storeys/haryana-2831/haryana-2831-tower3-plan1.pdf")
SHA = "2b9f8803e179c515a694d046ba9c9e5394a79af59e3db75c1748c41fad04c865"
REGIONS = {"unit-cited-region": [206.88, 254.25, 1241.28, 559.35], "level-caption": [850, 875, 1020, 910]}


def render(page, name: str, box: list[float]) -> dict:
    import fitz
    path = OUTPUT / f"{name}.png"
    if path.exists():
        raise FileExistsError("Keep visual evidence immutable.")
    region = fitz.Rect(box)
    assert region in page.rect and not region.is_empty
    scale = min(2.0, 1400 / max(region.width, region.height))
    image = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=region, alpha=False)
    assert image.width * image.height <= 1_600_000 and max(image.width, image.height) <= 1401
    data = image.tobytes("png")
    with path.open("xb") as stream:
        stream.write(data)
    return {"path": str(path), "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
            "pixels": [image.width, image.height], "scale": scale, "region": box,
            "frame": "pdf_display_page_top_left_points", "sourceSha256": SHA, "page": 1}


def main() -> None:
    import fitz
    receipt = ROOT / "docs/evidence/gf1/k4b/visual-evidence.json"
    assert not receipt.exists()
    tools = runpy.run_path(str(ROOT / "scripts/usp/document-models/run_pdf_pages.py"))
    tools["_offline_worker"]()
    metadata = tools["inspect_pages"](SOURCE, SHA, 0, 1, None, OUTPUT)
    assert metadata["pageCount"] == 1
    with fitz.open(stream=SOURCE.read_bytes(), filetype="pdf") as document:
        artifacts = [render(document[0], "whole-page-offline", list(document[0].rect))]
        artifacts.extend(render(document[0], name, box) for name, box in REGIONS.items())
    result = {"source": str(SOURCE), "sourceSha256": SHA, "sourceBytes": SOURCE.stat().st_size,
              "metadata": metadata, "artifacts": artifacts, "ocr": False, "network": False,
              "productWholePageRender": "unsupported: source width exceeds unchanged 2000-point profile",
              "fallback": "bounded offline visual-only MuPDF render; no product frame-limit change"}
    with receipt.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, indent=2)
        stream.write("\n")
    print("Rendered three immutable visual derivatives; no source/model/runtime mutation.")


if __name__ == "__main__":
    main()
