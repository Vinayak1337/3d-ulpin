"""Reuse the retained, pinned publisher SVG transfer; never use predicted targets."""
from __future__ import annotations

import ast
import importlib.util
import json
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from xml.etree import ElementTree

import numpy as np
from PIL import Image

from raster_common import pin

RETAINED = Path("E:/BhuAayam-data/task-data/d06-vision-cohort-20261005")
HELPER_SHA = "3ec067f20207b87b11ea2f1beb782fbca144bf97ac114016fed4dae4a0ca3695"
HOUSE_SHA = "df448596b5ef80892eeb771139c258e8845804c1ed182625176f11f4f58252d1"
SVG = "{http://www.w3.org/2000/svg}"


@dataclass(frozen=True)
class PublisherTarget:
    labels: np.ndarray
    room_counts: dict[int, int]
    small_walls_skipped: int


class LabelTransfer:
    def __init__(self) -> None:
        helper = RETAINED / "prepare_derivatives.py"
        house = RETAINED / "upstream-cubicasa/floortrans/loaders/house.py"
        if pin(helper)["sha256"] != HELPER_SHA or pin(house)["sha256"] != HOUSE_SHA:
            raise ValueError("retained_label_helper_pin_mismatch")
        spec = importlib.util.spec_from_file_location("p2_retained_derivatives", helper)
        if spec is None or spec.loader is None:
            raise ValueError("missing_label_helper")
        module = importlib.util.module_from_spec(spec)
        sys.path.insert(0, str(RETAINED))
        try:
            spec.loader.exec_module(module)
        finally:
            sys.path.pop(0)
        self.polygon_mask: Callable[..., Any] = module.polygon_mask
        tree = ast.parse(house.read_text(encoding="utf-8"))
        self.room_map = next(ast.literal_eval(node.value) for node in tree.body
                             if isinstance(node, ast.Assign)
                             and any(isinstance(target, ast.Name) and target.id == "rooms_selected"
                                     for target in node.targets))
        self.pins = {"transfer": pin(helper), "publisherMapping": pin(house)}

    def element_label(self, element: ElementTree.Element) -> int | None:
        role = element.get("id", "")
        kind = element.get("class", "")
        if role in {"Wall", "Railing"}:
            return self.room_map[role]
        if kind.startswith("Space "):
            return self.room_map.get(kind.split()[1], self.room_map["Undefined"])
        return None

    def points(self, element: ElementTree.Element) -> np.ndarray:
        polygon = element.find(SVG + "polygon")
        if polygon is None or element.get("transform"):
            raise ValueError("unsupported_publisher_polygon")
        tokens = polygon.get("points", "").split()
        points = np.rint(np.asarray([[float(value) for value in token.split(",")] for token in tokens]))
        if points.ndim != 2 or points.shape[1] != 2 or len(points) < 3 or not np.isfinite(points).all():
            raise ValueError("invalid_publisher_points")
        return points

    def target(self, path: Path, width: int, height: int) -> PublisherTarget:
        root = ElementTree.parse(path).getroot()
        # Publisher House clips integer polygons to the image; SVG root dimensions are not a rescale.
        labels = np.zeros((height, width), dtype=np.uint8)
        counts: Counter[int] = Counter()
        skipped = 0
        for element in root.iter(SVG + "g"):
            class_id = self.element_label(element)
            if class_id is None:
                continue
            points = self.points(element)
            if element.get("id") in {"Wall", "Railing"}:
                if np.ptp(points[:, 0]) < 4 or np.ptp(points[:, 1]) < 4:
                    skipped += 1
                    continue
                points[:, 0] = np.clip(points[:, 0], 0, width)
                points[:, 1] = np.clip(points[:, 1], 0, height)
            elif class_id not in {0, 1, 2, 8}:
                counts[class_id] += 1
            region, mask = self.polygon_mask(points, width, height)
            labels[region][mask] = class_id
        return PublisherTarget(labels, dict(counts), skipped)


def verify_retained_transfer(transfer: LabelTransfer) -> dict[str, Any]:
    path = RETAINED / "provenance/floor-derivatives.json"
    reference = json.loads(path.read_text(encoding="utf-8"))[0]
    target = transfer.target(Path(reference["files"]["model.svg"]["path"]), reference["width"], reference["height"])
    with Image.open(reference["mask"]["path"]) as image:
        expected = np.asarray(image)
        agreement = bool(np.array_equal(expected, target.labels))
    if not agreement:
        raise ValueError("retained_publisher_transfer_parity_failed")
    return {"id": reference["id"], "identicalPixels": agreement, "reference": reference["mask"],
            "qualification": "Reused development target only; no model inference or holdout tuning"}
