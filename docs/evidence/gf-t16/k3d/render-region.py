"""Render a cited page-point region without modifying the source or shared runtime."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "services" / "geo"))
import fitz
from PIL import Image
from geo.vector_plan import sha256_file


def render(args: argparse.Namespace) -> dict:
    if args.out.exists() or args.out.with_suffix(".json").exists():
        raise ValueError("Retained region exists")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    before = sha256_file(args.source)
    with fitz.open(args.source) as document:
        page = document[args.page - 1]
        region = fitz.Rect(args.box)
        if not page.rect.contains(region) or region.is_empty:
            raise ValueError("Region outside page")
        pixmap = page.get_pixmap(matrix=fitz.Matrix(args.zoom, args.zoom), clip=region, alpha=False, annots=False)
        image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
        image = image.rotate(args.rotate, expand=True)
        image.save(args.out)
        receipt = {"source": str(args.source), "sha256": before, "page": args.page, "regionPt": args.box,
                   "zoom": args.zoom, "counterclockwiseRotation": args.rotate, "pixels": list(image.size),
                   "pngSha256": sha256_file(args.out)}
    if sha256_file(args.source) != before:
        raise ValueError("Original changed")
    with args.out.with_suffix(".json").open("x", encoding="utf-8") as output:
        json.dump(receipt, output, separators=(",", ":"))
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("page", type=int)
    parser.add_argument("box", nargs=4, type=float)
    parser.add_argument("--zoom", type=float, default=4)
    parser.add_argument("--rotate", type=int, choices=[0, 90, 180, 270], default=0)
    parser.add_argument("--out", type=Path, required=True)
    print(json.dumps(render(parser.parse_args())))


if __name__ == "__main__":
    main()
