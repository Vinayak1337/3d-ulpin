"""Measure a boxed unit label on the retained Tower 3 plan sheet the way K4c measured UNIT-3B.

The sheet is one embedded image with no text layer, so a label is found from a point a person picked inside
it and its characters are read by eye. `control` must reproduce the recorded UNIT-3B region before `measure`
looks at another label. A label drawn like UNIT-3B gives a candidate page region for an officer to confirm;
any other gives `no_candidate` with the reason and what was measured. Nothing here sends a request or writes
a record.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import runpy
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
SOURCE = Path("E:/BhuAayam-data/datasets/rera-storeys/haryana-2831/haryana-2831-tower3-plan1.pdf")
SOURCE_ID = "5293cd72-2377-4deb-a51c-c76d11ccb429"
SOURCE_REVISION = 1
SOURCE_SHA256 = "2b9f8803e179c515a694d046ba9c9e5394a79af59e3db75c1748c41fad04c865"
PAGE = 1
PAGE_BOX = (0.0, 0.0, 2586.0, 1695.0)
FRAME = "pdf_display_page_top_left_points"
OUTPUT = Path("E:/BhuAayam-data/task-data/r5b")

# K4c rendered the recorded UNIT-3B region at 4 times and reported the ink margins below (left, top, right,
# bottom, in points): docs/evidence/gf1/k4c/render-label.py:30 and REPORT.md:8-12.
SCALE = 4
K4C_MARGINS_PT = (5.0, 5.0, 6.0, 4.25)
K4C_CROP_SHA256 = "3c9e7914f428fa0ea160874814498584ffc410cfb4642cbe6a1aba1049eb9923"
RECORDED_UNIT_3B = (596.0, 390.0, 644.0, 409.0)
# A pixel is ink when its grey level is below this. K4c did not record its level; the middle of the grey scale
# reproduces its four margins, and so does every level from 108 to 144 (--ink-below shows the others).
INK_BELOW = 128
# Outside the label box and its soft edge, the region must hold nothing darker than paper.
PAPER_FROM = 224
SOFT_EDGE_PT = 0.5
# Half-size, in points, of the window searched around a seed.
REACH_PT = (48, 24)
CONTEXT_PT = (90.0, 60.0)
# A point inside each boxed label, read off the retained K4b wide crop; it locates the label and nothing else.
SEEDS = {"UNIT-3B": (619, 399), "UNIT-3A": (1105, 405)}

Box = tuple[float, float, float, float]
Mask = list[list[bool]]


class RegionError(Exception):
    """The sheet, the control or the label does not allow a region to be given."""


def open_sheet() -> Any:
    """Open the retained original from memory, hash-checked, behind the product reader's offline guards."""
    import fitz
    reader = runpy.run_path(str(REPO / "scripts/usp/document-models/run_pdf_pages.py"))
    reader["_offline_worker"]()
    data = SOURCE.read_bytes()
    if hashlib.sha256(data).hexdigest() != SOURCE_SHA256:
        raise RegionError("SOURCE_HASH_MISMATCH")
    document = fitz.open(stream=data, filetype="pdf")
    reader["_deny_external_files"](document)
    if document.page_count != 1 or tuple(document[0].rect) != PAGE_BOX:
        raise RegionError("PAGE_BOX_MISMATCH")
    return document


def render(page: Any, box: Box) -> Any:
    import fitz
    return page.get_pixmap(matrix=fitz.Matrix(SCALE, SCALE), clip=fitz.Rect(box), alpha=False)


def darker_than(pixmap: Any, level: int) -> Mask:
    import fitz
    grey = fitz.Pixmap(fitz.csGRAY, pixmap)
    rows = (grey.samples[top:top + grey.width] for top in range(0, grey.height * grey.stride, grey.stride))
    return [[value < level for value in row] for row in rows]


def ink_boxes(mask: Mask) -> list[Box]:
    """Boxes, in pixels, of the groups of ink pixels that touch each other (corners count)."""
    seen = [[False] * len(row) for row in mask]
    return [grow(mask, seen, x, y) for y, row in enumerate(mask) for x, ink in enumerate(row)
            if ink and not seen[y][x]]


def grow(mask: Mask, seen: Mask, x: int, y: int) -> Box:
    stack = [(x, y)]
    seen[y][x] = True
    left, top, right, bottom = x, y, x, y
    while stack:
        x, y = stack.pop()
        left, top, right, bottom = min(left, x), min(top, y), max(right, x), max(bottom, y)
        for near_y in range(max(y - 1, 0), min(y + 2, len(mask))):
            for near_x in range(max(x - 1, 0), min(x + 2, len(mask[0]))):
                if mask[near_y][near_x] and not seen[near_y][near_x]:
                    seen[near_y][near_x] = True
                    stack.append((near_x, near_y))
    return (left, top, right + 1, bottom + 1)


def encloses(outer: Box, inner: Box) -> bool:
    return outer != inner and outer[0] <= inner[0] and outer[1] <= inner[1] \
        and outer[2] >= inner[2] and outer[3] >= inner[3]


def frame_groups(boxes: list[Box], seed: tuple[float, float]) -> list[Box]:
    """Ink groups whose box holds the seed and another group: the frame drawn around the characters."""
    return [box for box in boxes if box[0] <= seed[0] < box[2] and box[1] <= seed[1] < box[3]
            and any(encloses(box, other) for other in boxes)]


def search_window(seed: tuple[int, int]) -> Box:
    return (max(seed[0] - REACH_PT[0], PAGE_BOX[0]), max(seed[1] - REACH_PT[1], PAGE_BOX[1]),
            min(seed[0] + REACH_PT[0], PAGE_BOX[2]), min(seed[1] + REACH_PT[1], PAGE_BOX[3]))


def label_groups(page: Any, seed: tuple[int, int], ink_below: int) -> list[Box]:
    """Boxes, in page points, of the frame groups at the seed; a label drawn like UNIT-3B gives exactly one."""
    window = search_window(seed)
    mask = darker_than(render(page, window), ink_below)
    seed_pixel = ((seed[0] - window[0]) * SCALE, (seed[1] - window[1]) * SCALE)
    groups = frame_groups(ink_boxes(mask), seed_pixel)
    if any(box[0] == 0 or box[1] == 0 or box[2] == len(mask[0]) or box[3] == len(mask) for box in groups):
        raise RegionError("LABEL_FRAME_REACHES_THE_SEARCH_WINDOW")
    return [(window[0] + box[0] / SCALE, window[1] + box[1] / SCALE,
             window[0] + box[2] / SCALE, window[1] + box[3] / SCALE) for box in groups]


def around(boxes: list[Box]) -> Box:
    return (min(box[0] for box in boxes), min(box[1] for box in boxes),
            max(box[2] for box in boxes), max(box[3] for box in boxes))


def widen(ink: Box) -> Box:
    left, top, right, bottom = K4C_MARGINS_PT
    return (ink[0] - left, ink[1] - top, ink[2] + right, ink[3] + bottom)


def stray_marks(page: Any, region: Box, ink: Box) -> Box | None:
    """The box, in page points, of anything darker than paper outside the label box and its soft edge."""
    inside = [(ink[0] - SOFT_EDGE_PT - region[0]) * SCALE, (ink[1] - SOFT_EDGE_PT - region[1]) * SCALE,
              (ink[2] + SOFT_EDGE_PT - region[0]) * SCALE, (ink[3] + SOFT_EDGE_PT - region[1]) * SCALE]
    marks = darker_than(render(page, region), PAPER_FROM)
    strays = [(x, y, x + 1, y + 1) for y, row in enumerate(marks) for x, mark in enumerate(row)
              if mark and not (inside[0] <= x < inside[2] and inside[1] <= y < inside[3])]
    if not strays:
        return None
    box = around(strays)
    return (region[0] + box[0] / SCALE, region[1] + box[1] / SCALE,
            region[0] + box[2] / SCALE, region[1] + box[3] / SCALE)


def measure(page: Any, seed: tuple[int, int], ink_below: int) -> dict[str, Any]:
    """The label box and its widened region; `reason` says why they are not offered when it is not None."""
    groups = label_groups(page, seed, ink_below)
    result = {"seedPt": list(seed), "inkBelow": ink_below, "inkGroupsPt": [list(box) for box in groups]}
    if not groups:
        return {**result, "reason": "NO_LABEL_FRAME_AT_SEED"}
    ink = around(groups)
    region = widen(ink)
    strays = stray_marks(page, region, ink)
    reading = {"inkBoxPt": list(ink), "regionPt": list(region), "strayMarksPt": strays and list(strays)}
    if len(groups) > 1:
        return {**result, "reason": "LABEL_FRAME_IS_NOT_ONE_INK_GROUP", "ifTheGroupsAreOneLabel": reading}
    return {**result, **reading, "reason": "OTHER_INK_IN_REGION" if strays else None}


def control(page: Any, ink_below: int) -> dict[str, Any]:
    """Reproduce the recorded UNIT-3B region and the retained K4c crop from the sheet."""
    crop = render(page, RECORDED_UNIT_3B).tobytes("png")
    same_crop = hashlib.sha256(crop).hexdigest() == K4C_CROP_SHA256
    measured = measure(page, SEEDS["UNIT-3B"], ink_below)
    same_region = measured["reason"] is None and measured["regionPt"] == list(RECORDED_UNIT_3B)
    difference = [got - recorded for got, recorded in zip(measured.get("regionPt", []), RECORDED_UNIT_3B)]
    return {"label": "UNIT-3B", "recordedPt": list(RECORDED_UNIT_3B), "measured": measured,
            "differencePt": difference, "cropSameAsK4c": same_crop, "matches": same_crop and same_region}


def save_png(pixmap: Any, name: str) -> dict[str, Any]:
    """Write a new private picture; an existing one is kept and must already hold the same bytes."""
    data = pixmap.tobytes("png")
    path = OUTPUT / name
    OUTPUT.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise RegionError("RETAINED_PICTURE_DIFFERS")
    else:
        with path.open("xb") as stream:
            stream.write(data)
    return {"path": path.as_posix(), "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
            "pixels": [pixmap.width, pixmap.height], "scale": SCALE}


def pictures(page: Any, name: str, region: Box) -> list[dict[str, Any]]:
    """The tight crop, then the surroundings with the region outlined on the in-memory copy only."""
    import fitz
    crop = save_png(render(page, region), f"{name}-label.png")
    surroundings = (region[0] - CONTEXT_PT[0], region[1] - CONTEXT_PT[1],
                    region[2] + CONTEXT_PT[0], region[3] + CONTEXT_PT[1])
    page.draw_rect(fitz.Rect(region), color=(1, 0, 0), width=0.5, overlay=True)
    outlined = save_png(render(page, surroundings), f"{name}-outlined.png")
    return [{**crop, "regionPt": list(region), "purpose": "the region as a renderer would crop it"},
            {**outlined, "regionPt": list(surroundings), "purpose": "surroundings, region outlined; not original"}]


def candidate(page: Any, label: str, ink_below: int) -> dict[str, Any]:
    """Measure another label by the same code, only after the control has matched."""
    checked = control(page, ink_below)
    if not checked["matches"]:
        raise RegionError("CONTROL_MISMATCH")
    measured = measure(page, SEEDS[label], ink_below)
    reading = measured.get("ifTheGroupsAreOneLabel", measured)
    name = f"{label.lower()}-ink{ink_below}"
    shots = pictures(page, name, tuple(reading["regionPt"])) if "regionPt" in reading else []
    return {"state": "candidate" if measured["reason"] is None else "no_candidate", "label": label,
            "literalReadBy": "eye, from the saved crop; the sheet has no text layer and no OCR was run",
            "sourceId": SOURCE_ID, "sourceRevision": SOURCE_REVISION, "sourceSha256": SOURCE_SHA256,
            "page": PAGE, "frame": FRAME, "pageBoxPt": list(PAGE_BOX), "marginsPt": list(K4C_MARGINS_PT),
            **measured, "pictures": shots, "control": checked}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["control", "measure"])
    parser.add_argument("label", nargs="?", choices=sorted(set(SEEDS) - {"UNIT-3B"}))
    parser.add_argument("--ink-below", type=int, default=INK_BELOW)
    arguments = parser.parse_args()
    if (arguments.action == "measure") != (arguments.label is not None):
        parser.error("Use: control | measure <label>")
    with open_sheet() as document:
        try:
            result = control(document[0], arguments.ink_below) if arguments.action == "control" \
                else candidate(document[0], arguments.label, arguments.ink_below)
        except RegionError as error:
            sys.exit(str(error))
    print(json.dumps(result, separators=(",", ":")))
    if not result.get("matches", result.get("state") == "candidate"):
        sys.exit(1)


if __name__ == "__main__":
    main()
