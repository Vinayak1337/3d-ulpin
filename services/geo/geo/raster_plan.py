"""Offline raster room proposals; OCR, geometry and metric authority remain separate."""
from __future__ import annotations

import hashlib
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw
from shapely.affinity import affine_transform
from shapely.geometry import Polygon, box, mapping, shape

from . import spatial_ml
from .usp_document_candidates import docling_tesseract as ocr
from .vector_plan import parse_dimensions, parse_length

JsonDict = dict[str, Any]
ROOM_CLASSES = frozenset(spatial_ml.ROOMS) - {"background", "outdoor", "wall", "railing"}


@dataclass(frozen=True)
class PlanSelection:
    source_id: str
    source: Path
    sha256: str
    page: int
    panel: str
    bbox: tuple[float, float, float, float]
    reason: str


@dataclass(frozen=True)
class OcrAssets:
    models: Path
    tesseract: Path
    tessdata: Path


@dataclass(frozen=True)
class DimensionLine:
    """Only independently verified dimension endpoints, never predicted room bounds."""
    reference: str
    start: tuple[float, float]
    end: tuple[float, float]
    text_bbox: tuple[float, float, float, float]
    endpoints_verified: bool


@dataclass(frozen=True)
class Segmentation:
    labels: np.ndarray
    image: Image.Image
    transform: JsonDict
    rooms: list[JsonDict]
    context: list[JsonDict]
    omissions: JsonDict
    diagnostics: JsonDict
    score_kind: str


def tiles(bounds: tuple[float, float, float, float], edge: float = 400) -> list[list[float]]:
    if not 1 <= edge <= ocr.MAX_PAGE_SIDE_POINTS or not all(math.isfinite(value) for value in bounds):
        raise ValueError("invalid_tile_frame")
    left, top, right, bottom = bounds
    if left < 0 or top < 0 or left >= right or top >= bottom:
        raise ValueError("invalid_tile_frame")
    columns = math.ceil((right - left) / edge)
    rows = math.ceil((bottom - top) / edge)
    return [[left + column * edge, top + row * edge,
             min(right, left + (column + 1) * edge), min(bottom, top + (row + 1) * edge)]
            for row in range(rows) for column in range(columns)]


def text_observations(receipts: list[JsonDict]) -> list[JsonDict]:
    result = []
    for tile_number, receipt in enumerate(receipts):
        for item_number, item in enumerate(receipt["items"]):
            boxes = [source_box["box"] for source_box in item["sourcePageBoxes"]]
            bounds = [min(bounds[0] for bounds in boxes), min(bounds[1] for bounds in boxes),
                      max(bounds[2] for bounds in boxes), max(bounds[3] for bounds in boxes)]
            result.append({"literal": item["text"], "bboxPt": bounds, "sourcePageBoxesPt": boxes,
                           "tile": tile_number, "item": item_number, "method": receipt["method"],
                           "statedDimensions": parse_dimensions(item["text"]),
                           "statedLength": parse_length(item["text"]), "state": "candidate"})
    return result


def line_axis(line: DimensionLine) -> str | None:
    if not line.endpoints_verified or not all(math.isfinite(value) for value in (*line.start, *line.end)):
        return None
    delta_x = abs(line.end[0] - line.start[0])
    delta_y = abs(line.end[1] - line.start[1])
    if delta_x > 1 and delta_y < 0.01:
        return "x"
    if delta_y > 1 and delta_x < 0.01:
        return "y"
    return None


def dimension_pairs(observations: list[JsonDict], lines: list[DimensionLine]) -> list[JsonDict]:
    pairs = []
    for index, observation in enumerate(observations):
        length = parse_length(observation["literal"])
        if length["metres"] is None:
            continue
        text_box = box(*observation["bboxPt"])
        matches = [line for line in lines if line_axis(line) and box(*line.text_bbox).covers(text_box)]
        if len(matches) != 1:
            continue
        line = matches[0]
        competing = [item for item in observations if box(*line.text_bbox).covers(box(*item["bboxPt"]))
                     and parse_length(item["literal"])["metres"] is not None]
        if len(competing) != 1:
            continue
        extent = math.dist(line.start, line.end)
        pairs.append({"observation": index, "literal": observation["literal"], "bboxPt": observation["bboxPt"],
                      "lineRef": line.reference, "startPt": line.start, "endPt": line.end,
                      "axis": line_axis(line), "metres": length["metres"], "points": extent,
                      "metresPerPoint": length["metres"] / extent})
    return pairs


def resolve_scale(observations: list[JsonDict], lines: list[DimensionLine]) -> JsonDict:
    pairs = dimension_pairs(observations, lines)
    reason = "no_verified_dimension_line_endpoints" if not lines else "insufficient_unambiguous_axis_pairs"
    if len(pairs) < 2 or {pair["axis"] for pair in pairs} != {"x", "y"}:
        return {"state": "no_scale", "metresPerPoint": None, "pairs": pairs, "reason": reason}
    scale = float(np.median([pair["metresPerPoint"] for pair in pairs]))
    residual = max(abs(pair["metresPerPoint"] / scale - 1) for pair in pairs)
    if residual > 0.02:
        return {"state": "no_scale", "metresPerPoint": None, "pairs": pairs,
                "reason": "conflicting_dimension_pair_scales", "maxRelativeResidual": residual}
    return {"state": "candidate", "metresPerPoint": scale, "pairs": pairs,
            "maxRelativeResidual": residual, "method": "deterministic:ocr-dimension-pair@1",
            "qualification": "panel-local diagnostic scale; not survey calibration"}


def installed_model() -> JsonDict:
    model = next(model for model in spatial_ml._manifest()["models"] if model["task"] == "floor-plan")
    if model["profileVersion"] != spatial_ml.FLOOR_POLYGON_PROFILE:
        raise ValueError("expected_installed_v2_profile")
    spatial_ml._verified_path(model)
    return model


def segment_bytes(raw: bytes, mime: str, page: int, region: JsonDict) -> Segmentation:
    model = installed_model()
    image, transform = spatial_ml._source_raster(raw, mime, page, region, "floor-plan")
    labels, scores, palette, score_kind = spatial_ml._run_model(model, image)
    components, omissions, diagnostics = spatial_ml._floor_components(
        labels, scores, palette, hashlib.sha256(raw).hexdigest())
    rooms = [component for component in components if component["className"] in ROOM_CLASSES]
    context = [component for component in components if component["className"] not in ROOM_CLASSES]
    return Segmentation(labels, image, transform, rooms, context, omissions, diagnostics, score_kind)


def segment_selection(selection: PlanSelection) -> Segmentation:
    import fitz

    raw = selection.source.read_bytes()
    if hashlib.sha256(raw).hexdigest() != selection.sha256:
        raise ValueError("source_hash_mismatch")
    with fitz.open(stream=raw, filetype="pdf") as document:
        frame = document[selection.page - 1].rect
        left, top, right, bottom = selection.bbox
        if not frame.contains(fitz.Rect(selection.bbox)):
            raise ValueError("selection_outside_page")
        region = {"x": left / frame.width, "y": top / frame.height,
                  "width": (right - left) / frame.width, "height": (bottom - top) / frame.height}
    return segment_bytes(raw, "application/pdf", selection.page, region)


def contour_to_page(component: JsonDict, transform: JsonDict) -> Polygon:
    coefficients = transform["pixelToSource"]
    return affine_transform(shape(component["geometry"]),
                            [coefficients[0], coefficients[1], coefficients[3], coefficients[4],
                             coefficients[2], coefficients[5]])


def contained_labels(polygon_pixels: Polygon, observations: list[JsonDict], render_scale: float) -> list[JsonDict]:
    labels = []
    for observation in observations:
        scaled = [coordinate * render_scale for coordinate in observation["bboxPt"]]
        if polygon_pixels.covers(box(*scaled)):
            labels.append(observation)
    return labels


def literal_class(literal: str) -> str | None:
    text = literal.strip().upper()
    rules = ((r"BED\s*ROOM", "bedroom"), (r"KITCHEN", "kitchen"), (r"TOILET|BATH", "bath"),
             (r"LIVING|DINING|FAMILY\s+LOUNGE", "living_room"), (r"STORE|STORAGE", "storage"),
             (r"HALLWAY|CORRIDOR|LOBBY", "hallway"), (r"GARAGE", "garage"))
    matches = {class_name for pattern, class_name in rules if re.search(pattern, text)}
    return next(iter(matches)) if len(matches) == 1 else None


def disagreements(class_name: str, labels: list[JsonDict]) -> list[JsonDict]:
    return [{"kind": "ocr_model_class_disagreement", "literal": label["literal"],
             "bboxPt": label["bboxPt"], "modelClass": class_name, "ocrClassHint": literal_class(label["literal"]),
             "resolution": "unresolved; neither observation overrides the other"}
            for label in labels if literal_class(label["literal"]) not in {None, class_name}]


def citation(selection: PlanSelection, bounds: tuple[float, float, float, float]) -> JsonDict:
    left, top, right, bottom = bounds
    return {"sourceId": selection.source_id, "sourceSha256": selection.sha256,
            "locator": {"kind": "region", "page": selection.page, "x": left, "y": top,
                        "width": right - left, "height": bottom - top, "unit": "pt"}}


def metric_geometry(polygon_pixels: Polygon, scale: JsonDict, render_scale: float) -> JsonDict | None:
    if scale["metresPerPoint"] is None:
        return None
    ratio = scale["metresPerPoint"] / render_scale
    metric = affine_transform(polygon_pixels, [ratio, 0, 0, -ratio, 0, 0])
    return {"geometry": mapping(metric), "areaM2": metric.area, "unit": "m",
            "frame": "page-top-left; x page-right, y page-up; no ENU placement", "state": "candidate"}


def room_proposal(component: JsonDict, segmentation: Segmentation, observations: list[JsonDict],
                  selection: PlanSelection, scale: JsonDict, index: int) -> JsonDict:
    polygon = contour_to_page(component, segmentation.transform)
    render_scale = segmentation.transform["pdfRenderScale"]
    labels = contained_labels(polygon, observations, render_scale)
    page_bounds = tuple(coordinate / render_scale for coordinate in polygon.bounds)
    method = f"model:cubicasa5k@{installed_model()['sha256']}"
    return {"localRef": f"{selection.panel}/rooms/{index}", "state": "candidate", "method": method,
            "className": component["className"], "confidence": component["score"], "scoresCalibrated": False,
            "confidenceKind": segmentation.score_kind,
            "level": {"state": "unknown", "value": None}, "geometryPagePixels": mapping(polygon),
            "pixelFrame": "pypdfium2 full-page raster; pixel-edge; x right, y down",
            "metric": metric_geometry(polygon, scale, render_scale), "scaleState": scale["state"],
            "containedOcrLiterals": labels, "disagreements": disagreements(component["className"], labels),
            "citations": [citation(selection, page_bounds)], "sourceComponentRef": component["id"]}


def candidate_refs(panel: str, count: int) -> list[JsonDict]:
    return [{"candidateId": f"p2:{panel}:room:{index}", "task": "plan_rooms", "taskVersion": "raster/1",
             "inputManifest": "selection.json", "outputRef": f"{panel}.json#/rooms/{index}", "state": "candidate"}
            for index in range(count)]


def overlay(segmentation: Segmentation, output: Path) -> None:
    image = segmentation.image.copy()
    draw = ImageDraw.Draw(image)
    for index, component in enumerate(segmentation.rooms):
        polygon = shape(component["geometry"])
        parts = [polygon] if polygon.geom_type == "Polygon" else list(polygon.geoms)
        for part in parts:
            for ring in [part.exterior, *part.interiors]:
                draw.line(list(ring.coords), fill="#d00000", width=2)
        draw.text(polygon.representative_point().coords[0], str(index), fill="#0030b0")
    image.save(output)


def ocr_accounting(rooms: list[JsonDict], observations: list[JsonDict]) -> JsonDict:
    attached = {(label["method"], label["tile"], label["item"])
                for room in rooms for label in room["containedOcrLiterals"]}
    return {"rooms": rooms, "ocrObservations": observations,
            "unattachedOcr": [observation for observation in observations
                              if (observation["method"], observation["tile"], observation["item"]) not in attached],
            "disagreements": [finding for room in rooms for finding in room["disagreements"]]}


def refresh_panel_ocr(previous: JsonDict, observations: list[JsonDict]) -> JsonDict:
    render_scale = previous["transform"]["pdfRenderScale"]
    rooms = []
    for room in previous["rooms"]:
        labels = contained_labels(shape(room["geometryPagePixels"]), observations, render_scale)
        rooms.append({**room, "containedOcrLiterals": labels, "confidenceKind": "mean_pixel_softmax",
                      "disagreements": disagreements(room["className"], labels)})
    return {**previous, **ocr_accounting(rooms, observations), "scale": resolve_scale(observations, [])}


def panel_result(selection: PlanSelection, segmentation: Segmentation, observations: list[JsonDict]) -> JsonDict:
    scale = resolve_scale(observations, [])
    rooms = [room_proposal(component, segmentation, observations, selection, scale, index)
             for index, component in enumerate(segmentation.rooms)]
    return {"schemaVersion": "raster-plan-candidates/1", "normalizedBuildingCandidateShape": "normalized-building/1",
            "panel": selection.panel, "selectionReason": selection.reason,
            "sourceCitation": citation(selection, selection.bbox), "level": {"value": None, "state": "unknown"},
            "method": f"model:cubicasa5k@{installed_model()['sha256']}", "state": "candidate",
            "model": installed_model(), "transform": segmentation.transform, "scale": scale, "rooms": rooms,
            "candidates": candidate_refs(selection.panel, len(rooms)), **ocr_accounting(rooms, observations),
            "context": segmentation.context, "omissions": segmentation.omissions,
            "floorRepresentation": segmentation.diagnostics, "gaps": ["no_scale", "level_association_unknown",
                                                                        "ocr_completeness_unverified"]}
