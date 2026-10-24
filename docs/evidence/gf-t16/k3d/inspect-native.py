"""Read immutable PDF metadata and native literals with P1's existing text/dimension reader."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "services" / "geo"))
import fitz
from geo.vector_plan import parse_dimensions, parse_length, sha256_file, text_lines


def fresh_json(path: Path, value: Any) -> None:
    with path.open("x", encoding="utf-8") as output:
        json.dump(value, output, ensure_ascii=False, separators=(",", ":"))


def inspect_page(page: fitz.Page, directory: Path, number: int) -> dict[str, Any]:
    lines = text_lines(page)
    dimensions = [dict(line, parsed=parse_dimensions(line["literal"])) for line in lines
                  if parse_dimensions(line["literal"]) is not None]
    lengths = [dict(line, parsed=parse_length(line["literal"])) for line in lines
               if parse_length(line["literal"])["metres"] is not None]
    keywords = [line for line in lines if re.search(
        r"LVL|FFL|SECTION|ELEVATION|PLINTH|SLAB|CLEAR|FLOOR TO|HEIGHT|SCALE|LEVEL|\+\s*\d|±", line["literal"], re.I)]
    fresh_json(directory / f"page-{number:02}-native.json", {"lines": lines, "dimensions": dimensions,
                                                           "lengths": lengths, "keywords": keywords})
    scale = min(1.0, 1500 / max(page.rect.width, page.rect.height))
    png = directory / f"page-{number:02}-overview.png"
    if png.exists():
        raise ValueError("Overview already exists")
    page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False, annots=False).save(png)
    return {"page": number, "framePt": list(page.rect), "rotation": page.rotation,
            "nativeLines": len(lines), "images": len(page.get_images()), "overview": str(png),
            "keywords": keywords, "dimensionPairs": len(dimensions), "lengthLiterals": len(lengths)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    before = sha256_file(args.source)
    if before != args.expected_sha256:
        raise ValueError("Original hash mismatch")
    args.out.mkdir(parents=True, exist_ok=False)
    with fitz.open(args.source) as document:
        pages = [inspect_page(page, args.out, index + 1) for index, page in enumerate(document)]
    if sha256_file(args.source) != before:
        raise ValueError("Original changed")
    receipt = {"source": str(args.source), "sha256": before, "bytes": args.source.stat().st_size,
               "pages": pages, "originalUnchanged": True, "method": "geo.vector_plan.text_lines/parse_dimensions"}
    fresh_json(args.out / "inventory.json", receipt)
    print(json.dumps(receipt, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
