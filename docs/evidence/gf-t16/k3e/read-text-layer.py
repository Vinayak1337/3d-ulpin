"""Print one page's text layer from a hash-checked retained original with the vector reader's text helper."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "services" / "geo"))
import fitz
from geo.vector_plan import sha256_file, text_lines


def read_page(source: Path, page: int) -> list[dict[str, object]]:
    with fitz.open(source) as document:
        lines = text_lines(document[page - 1])
    return [{"literal": line["literal"], "bbox": line["bbox"]} for line in lines]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--page", type=int, required=True)
    args = parser.parse_args()
    if sha256_file(args.source) != args.sha256:
        raise SystemExit("The original does not match its pinned SHA-256.")
    lines = read_page(args.source, args.page)
    if sha256_file(args.source) != args.sha256:
        raise SystemExit("The original changed while it was read.")
    json.dump({"sha256": args.sha256, "page": args.page, "lines": lines}, sys.stdout, ensure_ascii=True)


if __name__ == "__main__":
    main()
