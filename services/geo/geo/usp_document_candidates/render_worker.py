"""Isolated bounded PDF region renderer for the offline document trial."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .granite import render_pdf_region


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--original", type=Path, required=True)
    parser.add_argument("--page", type=int, required=True)
    parser.add_argument("--bbox", required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    args = parser.parse_args()
    render = render_pdf_region(args.original, args.page, json.loads(args.bbox), args.image)
    args.result.write_text(json.dumps(render, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
