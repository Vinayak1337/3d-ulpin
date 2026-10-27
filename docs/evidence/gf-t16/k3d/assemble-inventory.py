"""Publish compact metadata/pins only; originals and private rendered/word evidence stay outside Git."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

PRIVATE = Path("E:/BhuAayam-data/task-data/k3d")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_compact(path: Path, value: dict, replace: bool = False) -> None:
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    lines = []
    line = ""
    tokens = r'"(?:\\.|[^"\\])*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]:,]'
    for token in re.findall(tokens, raw):
        if len(token) > 120:
            raise ValueError("JSON atom exceeds line limit")
        if len(line) + len(token) > 120:
            lines.append(line)
            line = ""
        line += token
    lines.append(line)
    rendered = "\n".join(lines) + "\n"
    assert json.loads(rendered) == value
    with path.open("w" if replace else "x", encoding="utf-8", newline="\n") as output:
        output.write(rendered)


def inspect_source(inventory: Path) -> dict:
    raw = json.loads(inventory.read_text(encoding="utf-8"))
    source = Path(raw["source"])
    assert sha256(source) == raw["sha256"]
    directory = PRIVATE / inventory.parent.name.replace("-native-01", "-ocr-01")
    stores = list(directory.glob("*.pages.json"))
    assert len(stores) == 1
    store = json.loads(stores[0].read_text(encoding="utf-8"))
    assert store["source"]["sha256"] == raw["sha256"]
    pages = []
    for page in raw["pages"]:
        text = store["pages"][str(page["page"])]
        pages.append({"page": page["page"], "pagePt": page["framePt"][2:], "rotation": page["rotation"],
                      "type": "vector CAD drawing" if page["nativeLines"] else "scanned page",
                      "nativeLines": page["nativeLines"], "retainedLines": len(text["lines"]),
                      "status": text["status"], "origin": text["origin"]})
    return {"original": str(source).replace("\\", "/"), "sha256": raw["sha256"], "bytes": raw["bytes"],
            "pageCount": len(pages), "mediaType": "application/pdf", "immutable": True, "purpose": "test_only",
            "pages": pages, "nativeDirectory": inventory.parent.name, "pageStoreDirectory": directory.name,
            "pageStoreFile": stores[0].name, "pageStoreSha256": sha256(stores[0]),
            "ocrTiles": len(list(directory.glob("ocr-tiles/**/*.png")))}


def views() -> list[dict]:
    result = []
    for path in sorted(PRIVATE.glob("*.json")):
        receipt = json.loads(path.read_text(encoding="utf-8"))
        if "pngSha256" not in receipt:
            continue
        png = path.with_suffix(".png")
        assert sha256(png) == receipt["pngSha256"]
        result.append({"file": png.name, "sha256": receipt["pngSha256"], "sourceSha256": receipt["sha256"],
                       "page": receipt["page"], "regionPt": receipt["regionPt"], "receipt": path.name,
                       "rotationCounterclockwise": receipt.get("counterclockwiseRotation", 0)})
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--replace-authored-inventory", action="store_true")
    args = parser.parse_args()
    sources = [inspect_source(path) for path in sorted(PRIVATE.glob("*-native-01/inventory.json"))]
    value = {"task": "K3d", "privateRoot": PRIVATE.as_posix(), "originals": sources,
             "originalCount": len(sources), "pagesSearched": sum(source["pageCount"] for source in sources),
             "allPages": "Native text/dimension pass followed by existing CPU OCR on every text-free page",
             "absenceProof": False, "sourceBytesUnchanged": True, "views": views()}
    save_compact(args.out, value, args.replace_authored_inventory)
    print({"originals": value["originalCount"], "pages": value["pagesSearched"],
           "ocrTiles": sum(source["ocrTiles"] for source in sources), "views": len(value["views"])})


if __name__ == "__main__":
    main()
