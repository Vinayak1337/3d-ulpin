"""Render only the boxed UNIT-3B literal and outline its citation on the original page; no boundary inference."""
from __future__ import annotations

import hashlib
import json
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
OUTPUT = Path("E:/BhuAayam-data/task-data/k4c")
SOURCE = Path("E:/BhuAayam-data/datasets/rera-storeys/haryana-2831/haryana-2831-tower3-plan1.pdf")
SHA = "2b9f8803e179c515a694d046ba9c9e5394a79af59e3db75c1748c41fad04c865"
REGION = [596, 390, 644, 409]


def save_png(image, name: str) -> dict:
    path = OUTPUT / name
    data = image.tobytes("png")
    with path.open("xb") as stream:
        stream.write(data)
    return {"path": path.as_posix(), "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
            "pixels": [image.width, image.height]}


def render_page(document) -> list[dict]:
    import fitz
    page = document[0]
    rect = fitz.Rect(REGION)
    assert rect in page.rect and list(page.rect) == [0, 0, 2586, 1695]
    crop = save_png(page.get_pixmap(matrix=fitz.Matrix(4, 4), clip=rect, alpha=False), "unit-3b-label.png")
    crop.update({"region": REGION, "scale": 4, "purpose": "literal label citation only"})
    page.draw_rect(rect, color=(1, 0, 0), width=2, overlay=True)
    scale = 1400 / page.rect.width
    outline = save_png(page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False), "page-label-outline.png")
    outline.update({"outlinedRegion": REGION, "scale": scale, "purpose": "derivative citation overlay; not original"})
    return [crop, outline]


def main() -> None:
    import fitz
    target = ROOT / "docs/evidence/gf1/k4c/visual-evidence.json"
    assert not target.exists(), "Preserve prior evidence."
    tools = runpy.run_path(str(ROOT / "scripts/usp/document-models/run_pdf_pages.py"))
    tools["_offline_worker"]()
    data = SOURCE.read_bytes()
    assert hashlib.sha256(data).hexdigest() == SHA
    with fitz.open(stream=data, filetype="pdf") as document:
        tools["_deny_external_files"](document)
        artifacts = render_page(document)
    result = {"sourcePath": SOURCE.as_posix(), "sourceId": "5293cd72-2377-4deb-a51c-c76d11ccb429",
              "sourceRevision": 1, "sourceSha256": SHA, "sourceBytes": len(data), "page": 1,
              "frame": "pdf_display_page_top_left_points", "pageBox": [0, 0, 2586, 1695],
              "region": REGION, "artifacts": artifacts, "ocr": False, "network": False,
              "broadContext": "E:/BhuAayam-data/task-data/k4b/unit-cited-region.png",
              "claim": "sheet carries UNIT-3B; label citation only, not a unit boundary"}
    with target.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, separators=(",", ":"))
        stream.write("\n")


if __name__ == "__main__":
    main()
