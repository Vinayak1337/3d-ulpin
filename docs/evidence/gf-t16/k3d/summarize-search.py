"""Summarize every retained native/OCR page; a keyword miss is not proof of absence."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re

PATTERN = re.compile(
    r"LEVEL|LVL|FFL|HEIGHT|FLOOR TO|SLAB|SECTION|ELEVATION|DIMENSION|SCALE|METRE|METER|FEET|INCH", re.I)


def searched_source(inventory: Path) -> dict:
    native = json.loads(inventory.read_text(encoding="utf-8"))
    folder = inventory.parent.name.replace("-native-01", "-ocr-01")
    stores = list((inventory.parent.parent / folder).glob("*.pages.json"))
    if len(stores) != 1:
        raise ValueError("Expected one completed page store")
    store = json.loads(stores[0].read_text(encoding="utf-8"))
    pages = []
    for page in native["pages"]:
        number = page["page"]
        text_path = inventory.parent / f"page-{number:02}-native.json"
        text = json.loads(text_path.read_text(encoding="utf-8"))
        observed = store["pages"][str(number)]
        lines = [{"literal": row["text"], "bbox": row["box"]} for row in observed["lines"]]
        pages.append({"page": number, "nativeLines": page["nativeLines"], "images": page["images"],
                      "method": observed.get("method", "native vector text"), "status": observed["status"],
                      "ocrLines": len(lines) if not page["nativeLines"] else 0,
                      "matches": [line for line in lines if PATTERN.search(line["literal"])],
                      "nativeKeywords": text["keywords"], "overview": page["overview"]})
    return {"source": native["source"], "sha256": native["sha256"], "pages": pages}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True, help="New private JSON, no overwrite")
    args = parser.parse_args()
    root = Path("E:/BhuAayam-data/task-data/k3d")
    sources = [searched_source(path) for path in sorted(root.glob("*-native-01/inventory.json"))]
    with args.out.open("x", encoding="utf-8") as output:
        json.dump({"sources": sources, "missMeaning": "No matching retained line, not an absence proof"}, output)
    for source in sources:
        print(Path(source["source"]).name)
        for page in source["pages"]:
            print(page["page"], page["nativeLines"], page["ocrLines"], page["status"], page["matches"])


if __name__ == "__main__":
    main()
