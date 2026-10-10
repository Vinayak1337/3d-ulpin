"""Offline vector-plan candidates; source-aligned closures never write the registry.

PDF coordinates are unrotated MuPDF points (x right, y down). Wall masks,
opening bridges and literal floor associations remain reviewable candidates.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, field
import hashlib
import json
import math
from pathlib import Path
import re
from statistics import median
import time
from typing import Any, Literal, Protocol, TypeVar, cast

import fitz
from PIL import Image, ImageDraw, ImageFont
from shapely import affinity, set_precision
from shapely.geometry import LineString, Point, Polygon, box, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely.strtree import STRtree

JsonDict = dict[str, Any]
Parameters = Mapping[str, Any]
Coordinate = tuple[float, float]
Segment = tuple[Coordinate, Coordinate]
Axis = Literal[0, 1]
LayerMatcher = re.Pattern[str] | frozenset[str]


@dataclass(frozen=True)
class LayerProfile:
    """Explicit source-family layer semantics; no layerless geometry guessing."""

    name: str
    wall_hatch: LayerMatcher
    floor_slab: LayerMatcher
    built_outline: LayerMatcher
    column_window_quads: LayerMatcher
    diagnostic_wall_layers: tuple[str, ...] = ()

    def matches_architecture(self, layer: str) -> bool:
        return (
            matches_layer(self.built_outline, layer)
            or matches_layer(self.column_window_quads, layer)
            or layer in self.diagnostic_wall_layers
        )

    def matches_wall_layer(self, layer: str) -> bool:
        return matches_layer(self.wall_hatch, layer) or self.matches_architecture(layer)


def matches_layer(matcher: LayerMatcher, layer: str) -> bool:
    if isinstance(matcher, re.Pattern):
        return matcher.fullmatch(layer) is not None
    return layer in matcher


MAGNOLIA_CAD_LAYERS = LayerProfile(
    name="magnolia-cad/1",
    wall_hatch=re.compile(r"A- wall hatch", re.I),
    floor_slab=frozenset({"A- floor slab"}),
    built_outline=frozenset({"A- built"}),
    column_window_quads=frozenset({"A- Columns", "A- windows"}),
    diagnostic_wall_layers=("Wall", "A- built", "A- windows", "A- Columns"),
)

METHOD = "deterministic:vector-plan@1"
DEFAULTS: JsonDict = {
    "snapTolerancePdf": 0.12,
    # Retained receipt fields keep accepted parameter hashes reproducible.
    "minimumRegionAreaPdf2": 120.0,
    "minimumRegionWidthPdf": 12.0,
    "maximumRegionAspect": 15.0,
    "consistencyRelativeTolerance": 0.05,
    "scaleInlierRelativeTolerance": 0.02,
    "minimumScaleSupports": 4,
    "minimumScaleInlierFraction": 0.8,
    "wallLayers": list(MAGNOLIA_CAD_LAYERS.diagnostic_wall_layers),
    "curvePolicy": "exclude: door swings are not walls",
    "gapPolicy": "bounded collinear wall-end/junction closure; every bridge is a candidate",
    "maximumOpeningWidthM": 1.85,
    "minimumWallThicknessM": 0.07,
    "maximumWallThicknessM": 0.35,
    "minimumRoomAreaM2": 1.0,
    "minimumUnlabelledFaceInsideWallBandFraction": 0.5,
    "wallSeamBufferPdf": 0.12,
    "panelScaleAgreementTolerance": 0.02,
    "wallMaskProfile": "hatch-supported-paired-strips-and-junctions/2",
}
LIMITATIONS = [
    "All regions are candidates, including unlabelled closed faces; not a reviewed room inventory.",
    "Opening closures are bounded source-aligned hypotheses; every bridge requires officer review.",
    "Floor titles are literal panel associations only, "
    "not a reviewed level/unit/building association or surveyed frame.",
    "Metric geometry is drawing-derived, not an authorised measurement; written dimensions take precedence.",
    "Layer semantics and the closed-face size filter may omit spaces or retain non-room faces.",
]
SPACE_WORDS = re.compile(
    r"\b(?:BEDROOM|TOILET|KITCHEN|DINING|LIVING|BALCONY|DRESSER|STAIRCASE|TERRACE|SHAFT|LAWN|"
    r"LOBBY|HALL|STUDY|BATHROOM|STORE|UTILITY)\b",
    re.I,
)
FLOOR_TITLE = re.compile(r"(?:GROUND|FIRST|SECOND|TERRACE|BASEMENT|TYPICAL|\d+(?:ST|ND|RD|TH)) FLOOR PLAN", re.I)


@dataclass(frozen=True)
class AxisSegment:
    axis: Axis
    normal: float
    low: float
    high: float
    seqno: int


@dataclass
class WallEvidence:
    wall_parts: list[Polygon] = field(default_factory=list)
    axes: list[AxisSegment] = field(default_factory=list)
    slab_axes: list[AxisSegment] = field(default_factory=list)
    contours: list[LineString] = field(default_factory=list)
    outlines: list[Polygon] = field(default_factory=list)
    source_seqnos: set[int] = field(default_factory=set)
    rejected: Counter[str] = field(default_factory=Counter)


@dataclass(frozen=True)
class WallStrip:
    polygon: Polygon
    axis: Axis
    source_seqnos: list[int]


@dataclass(frozen=True)
class OpeningBridge:
    polygon: Polygon
    width_m: float
    axis: Axis
    source_seqnos: list[int]
    method: str = "extend_paired_wall_ends_to_existing_collinear_wall_or_junction"
    state: str = "candidate"


@dataclass(frozen=True)
class OutlineResult:
    outline: Polygon
    method: str
    excluded_exterior_faces: list[Polygon]


class PolygonItem(Protocol):
    @property
    def polygon(self) -> Polygon: ...


BoundsItem = TypeVar("BoundsItem", bound=PolygonItem)


@dataclass
class PageWork:
    panels: list[JsonDict] = field(default_factory=list)
    candidates: list[JsonDict] = field(default_factory=list)
    audit: list[JsonDict] = field(default_factory=list)
    assigned: set[tuple[int, int]] = field(default_factory=set)
    linework: JsonDict = field(default_factory=dict)
    scale: JsonDict = field(default_factory=lambda: unknown_scale())
    layer_profile_gap: bool = False


@dataclass(frozen=True)
class OverlayCanvas:
    page: fitz.Page
    pixmap: fitz.Pixmap
    image: Image.Image
    draw: ImageDraw.ImageDraw
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont
    zoom: float
    clip: fitz.Rect

    def point(self, coordinate: Sequence[float]) -> Coordinate:
        point = fitz.Point(*coordinate) * self.page.rotation_matrix
        return point.x * self.zoom - self.pixmap.x, point.y * self.zoom - self.pixmap.y


# Literal parsing and native source coordinates.


def digest(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def sha256_file(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def _numeric_fraction(text: str) -> float:
    return sum(
        float(part) if "/" not in part else int(part.split("/")[0]) / int(part.split("/")[1]) for part in text.split()
    )


def _imperial_length(text: str, literal: str) -> JsonDict | None:
    number = r"(?:\d+(?:\.\d+)?(?:\s+\d+/\d+)?|\d+/\d+)"
    match = re.fullmatch(rf"(?:(?P<feet>{number})\s*'\s*-?\s*)?(?:(?P<inch>{number})\s*\")?", text)
    if not match or not any(match.groupdict().values()):
        return None
    feet = _numeric_fraction(match["feet"]) if match["feet"] else 0.0
    inches = _numeric_fraction(match["inch"]) if match["inch"] else 0.0
    if match["feet"] and inches >= 12:
        raise ValueError("inch_component_out_of_range")
    metres = feet * 0.3048 + inches * 0.0254
    if metres <= 0:
        raise ValueError("nonpositive_length")
    return {
        "literal": literal,
        "metres": round(metres, 9),
        "sourceUnit": "ft_in",
        "conversion": "international_foot=0.3048m; inch=0.0254m",
        "error": None,
    }


def _metric_length(text: str, literal: str, default_unit: str | None) -> JsonDict | None:
    match = re.fullmatch(r"(\d+(?:[.,]\d+)?)\s*(mm|cm|m|metres?|meters?)?", text, re.I)
    if not match:
        return None
    unit = (match[2] or default_unit or "").lower()
    if unit not in {"mm", "cm", "m", "metre", "metres", "meter", "meters"}:
        return None
    metres = float(match[1].replace(",", ".")) * {"mm": 0.001, "cm": 0.01}.get(unit, 1)
    if metres <= 0:
        raise ValueError("nonpositive_length")
    return {
        "literal": literal,
        "metres": round(metres, 9),
        "sourceUnit": unit,
        "conversion": f"{unit}_to_m",
        "error": None,
    }


def parse_length(literal: str, default_metric_unit: str | None = None) -> JsonDict:
    """Preserve literals; SI foot/inch factors are exact (0.3048 / 0.0254)."""
    text = literal.strip().translate(str.maketrans({"′": "'", "’": "'", "″": '"', "“": '"', "”": '"'}))
    try:
        parsed = _imperial_length(text, literal) or _metric_length(text, literal, default_metric_unit)
        if parsed:
            return parsed
    except (ValueError, ZeroDivisionError):
        pass
    return {
        "literal": literal,
        "metres": None,
        "sourceUnit": "unknown",
        "conversion": None,
        "error": "unrecognised_or_ambiguous_length",
    }


def parse_dimensions(literal: str) -> JsonDict | None:
    text = literal.strip()
    if text.startswith("(") and text.endswith(")"):
        text = text[1:-1]
    parts = re.split(r"\s*[xX×]\s*", text)
    if len(parts) != 2 or not re.search(r"\d", parts[0]) or not re.search(r"\d", parts[1]):
        return None
    suffix = re.search(r"(mm|cm|m|metres?|meters?)\s*$", parts[1], re.I)
    dimensions = [parse_length(part, suffix[1] if suffix else None) for part in parts]
    valid = all(dimension["metres"] is not None for dimension in dimensions)
    return {
        "literal": literal,
        "dimensions": dimensions,
        "dimensionProductM2": round(math.prod(dimension["metres"] for dimension in dimensions), 9) if valid else None,
        "interpretation": "product_of_two_stated_lengths_not_a_literal_area",
        "parsed": valid,
    }


def _text_line(line: JsonDict, block_index: int, line_index: int) -> JsonDict:
    spans = line["spans"]
    return {
        "literal": "".join(span["text"] for span in spans),
        "bbox": list(line["bbox"]),
        "direction": list(line["dir"]),
        "size": max(span["size"] for span in spans),
        "locator": {"block": block_index, "line": line_index},
        "spans": [{"literal": span["text"], "bbox": list(span["bbox"])} for span in spans],
    }


def text_lines(page: fitz.Page) -> list[JsonDict]:
    # Text only: avoid decoding large embedded scans.
    blocks = page.get_text("dict", flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES)["blocks"]
    return [
        _text_line(line, block_index, line_index)
        for block_index, block in enumerate(blocks)
        for line_index, line in enumerate(block.get("lines", []))
        if line["spans"]
    ]


def item_segments(path: JsonDict) -> Iterator[Segment]:
    """Yield source straight lines, rectangles and quads, never fabricated edges."""
    for item in path["items"]:
        if item[0] == "l":
            yield tuple(item[1]), tuple(item[2])
        elif item[0] in {"qu", "re"}:
            rectangle = item[1]
            if item[0] == "qu":
                points = [rectangle.ul, rectangle.ur, rectangle.lr, rectangle.ll, rectangle.ul]
            else:
                points = [rectangle.tl, rectangle.tr, rectangle.br, rectangle.bl, rectangle.tl]
            yield from ((tuple(start), tuple(end)) for start, end in zip(points, points[1:]))


def in_scope(bbox: Sequence[float], regions: Sequence[Sequence[float]]) -> bool:
    # Source lines can have degenerate bboxes; do not construct invalid boxes.
    return not regions or any(
        region[0] <= bbox[0] <= bbox[2] <= region[2] and region[1] <= bbox[1] <= bbox[3] <= region[3]
        for region in regions
    )


def segment_axis(start: Sequence[float], end: Sequence[float]) -> Axis | None:
    if abs(start[1] - end[1]) < 0.02:
        return 0
    if abs(start[0] - end[0]) < 0.02:
        return 1
    return None


def polygon_parts(geometry: BaseGeometry) -> list[Polygon]:
    if geometry.geom_type == "MultiPolygon":
        return list(geometry.geoms)
    return [cast(Polygon, geometry)]


def classify(drawings: list[JsonDict], texts: list[JsonDict], page: fitz.Page) -> JsonDict:
    strokes = sum(len(drawing["items"]) for drawing in drawings if "s" in drawing["type"])
    pairs = sum(parse_dimensions(text["literal"]) is not None for text in texts)
    plan_heading = any(re.search(r"\bFLOOR\s+PLAN\b", text["literal"], re.I) for text in texts)
    if strokes < 20:
        kind = "not_vector"
        reason = "insufficient_vector_linework; native reader does not OCR or infer rooms from raster images"
    elif pairs or plan_heading:
        kind = "vector_plan"
        reason = "vector strokes and stated dimension pairs or literal FLOOR PLAN heading"
    else:
        kind = "vector_other"
        reason = "vector content without room dimension pairs or floor-plan heading"
    return {
        "kind": kind,
        "reason": reason,
        "drawingPaths": len(drawings),
        "strokeItems": strokes,
        "nativeTextLines": len(texts),
        "dimensionPairLines": pairs,
        "images": len(page.get_images()),
    }


# Dimension-layer linework and independent scale fitting.


def _invisible_path(path: JsonDict) -> str | None:
    if "s" not in path["type"] or (path.get("stroke_opacity") or 0) <= 0:
        return "no_visible_stroke"
    color = path.get("color")
    if color is None or min(color) > 0.95:
        return "white_or_missing_stroke"
    return None


def _architectural_rejection(path: JsonDict, profile: LayerProfile) -> str | None:
    layer = path.get("layer", "")
    if re.search(r"hatch|text|dim|grid|furn|tree|rein|ele[v ]|schedule|tag", layer, re.I):
        return "annotation_hatch_or_nonplan_layer"
    if not profile.matches_architecture(layer):
        return "not_in_architectural_layer_allowlist"
    return None


def _retain_source_segments(path: JsonDict, params: Parameters, counts: Counter[str]) -> list[LineString]:
    segments = []
    for start, end in item_segments(path):
        if math.dist(start, end) <= params["snapTolerancePdf"]:
            counts["short_segment"] += 1
            continue
        segment = LineString([start, end])
        segments.append(segment)
    counts["retained_paths" if segments else "no_retained_straight_segments"] += 1
    counts["excluded_curves"] += sum(item[0] == "c" for item in path["items"])
    return segments


def _linework_diagnostics(
    walls: list[LineString],
    dimensions: list[JsonDict],
    counts: Counter[str],
    layers: Counter[str],
    params: Parameters,
    profile: LayerProfile,
) -> JsonDict:
    wall_layers = list(profile.diagnostic_wall_layers)
    if not wall_layers:
        wall_layers = sorted(layer for layer in layers if profile.matches_architecture(layer))
    return {
        "profile": "named_architectural_layers",
        "wallLayers": wall_layers,
        "pathsByLayer": dict(layers),
        "filters": dict(counts),
        "sourceSegments": len(walls),
        "dimensionSegments": len(dimensions),
        "curvePolicy": params["curvePolicy"],
        "gapPolicy": params["gapPolicy"],
    }


def extract_linework(
    drawings: list[JsonDict],
    params: Parameters,
    profile: LayerProfile,
) -> tuple[list[LineString], list[JsonDict], JsonDict]:
    walls: list[LineString] = []
    dimensions: list[JsonDict] = []
    counts: Counter[str] = Counter()
    layers: Counter[str] = Counter()
    for path in drawings:
        layer = path.get("layer", "")
        layers[layer] += 1
        rejection = _invisible_path(path)
        if rejection:
            counts[rejection] += 1
            continue
        if re.search(r"dim", layer, re.I):
            dimensions.extend(
                {"a": start, "b": end, "seqno": path["seqno"], "layer": layer}
                for start, end in item_segments(path)
                if math.dist(start, end) > 0.01
            )
        rejection = _architectural_rejection(path, profile)
        if rejection:
            counts[rejection] += 1
            continue
        walls.extend(_retain_source_segments(path, params, counts))
    return walls, dimensions, _linework_diagnostics(walls, dimensions, counts, layers, params, profile)


def _dimension_axes(segments: list[JsonDict]) -> list[JsonDict]:
    axes = []
    for segment in segments:
        start, end = segment["a"], segment["b"]
        axis = segment_axis(start, end)
        if axis is not None:
            axes.append(
                {
                    **segment,
                    "axis": axis,
                    "low": min(start[axis], end[axis]),
                    "high": max(start[axis], end[axis]),
                    "normal": (start[1 - axis] + end[1 - axis]) / 2,
                }
            )
    return axes


def _text_axis(text: JsonDict) -> Axis | None:
    if abs(text["direction"][0]) > 0.99:
        return 0
    if abs(text["direction"][1]) > 0.99:
        return 1
    return None


def _tick_endpoints(line: JsonDict, axes: list[JsonDict]) -> tuple[JsonDict, JsonDict] | None:
    axis = line["axis"]
    ticks = [
        segment
        for segment in axes
        if segment["axis"] != axis
        and line["low"] < segment["normal"] < line["high"]
        and segment["low"] - 0.25 <= line["normal"] <= segment["high"] + 0.25
    ]
    left = [segment for segment in ticks if segment["normal"] - line["low"] < 4]
    right = [segment for segment in ticks if line["high"] - segment["normal"] < 4]
    if not left or not right:
        return None
    return (
        min(left, key=lambda segment: abs(segment["normal"] - line["low"])),
        min(right, key=lambda segment: abs(segment["normal"] - line["high"])),
    )


def _scale_match(
    text: JsonDict, parsed: JsonDict, line: JsonDict, axes: list[JsonDict], axis: Axis
) -> tuple[float, JsonDict] | None:
    length = line["high"] - line["low"]
    if line["axis"] != axis or length < 15:
        return None
    center = [(text["bbox"][0] + text["bbox"][2]) / 2, (text["bbox"][1] + text["bbox"][3]) / 2]
    offset = abs(line["normal"] - center[1 - axis])
    midpoint_error = abs((line["low"] + line["high"]) / 2 - center[axis])
    if offset > text["size"] * 1.8 or midpoint_error > max(text["size"], length * 0.04):
        return None
    ticks = _tick_endpoints(line, axes)
    if ticks is None:
        return None
    low, high = ticks
    drawn = high["normal"] - low["normal"]
    if drawn < 12:
        return None
    score = offset / text["size"] + midpoint_error / max(text["size"], length * 0.04)
    endpoints = [[low["normal"], line["normal"]], [high["normal"], line["normal"]]]
    if axis == 1:
        endpoints = [point[::-1] for point in endpoints]
    return score, {
        "literal": text["literal"],
        "bbox": text["bbox"],
        "axis": "x" if axis == 0 else "y",
        "statedMetres": parsed["metres"],
        "drawnPdfPoints": drawn,
        "ratio": parsed["metres"] / drawn,
        "endpointsPdf": endpoints,
        "drawingSeqnos": [line["seqno"], low["seqno"], high["seqno"]],
    }


def _scale_supports(texts: list[JsonDict], axes: list[JsonDict]) -> list[JsonDict]:
    supports = []
    for text in texts:
        parsed = parse_length(text["literal"])
        if parsed["metres"] is None or parsed["metres"] < 0.4:
            continue
        axis = _text_axis(text)
        if axis is None:
            continue
        matches = []
        for line in axes:
            match = _scale_match(text, parsed, line, axes, axis)
            if match is not None:
                matches.append(match)
        matches.sort(key=lambda match: (match[0], match[1]["drawingSeqnos"]))
        if matches and (len(matches) == 1 or matches[1][0] - matches[0][0] > 0.15):
            supports.append(matches[0][1])
    return supports


def _scale_consensus(supports: list[JsonDict], params: Parameters) -> tuple[float, list[JsonDict], bool]:
    initial = median(support["ratio"] for support in supports)
    inliers = [
        support for support in supports if abs(support["ratio"] / initial - 1) <= params["scaleInlierRelativeTolerance"]
    ]
    enough_axes = all(sum(support["axis"] == axis for support in inliers) >= 2 for axis in ["x", "y"])
    reliable = (
        len(inliers) >= params["minimumScaleSupports"]
        and enough_axes
        and len(inliers) / len(supports) >= params["minimumScaleInlierFraction"]
    )
    scale = initial
    if inliers:
        scale = sum(support["statedMetres"] * support["drawnPdfPoints"] for support in inliers) / sum(
            support["drawnPdfPoints"] ** 2 for support in inliers
        )
    for support in supports:
        support["inlier"] = support in inliers
        support["residualM"] = support["drawnPdfPoints"] * scale - support["statedMetres"]
        support["relativeResidual"] = support["residualM"] / support["statedMetres"]
    return scale, inliers, reliable


def _scale_statistics(
    scale: float, inliers: list[JsonDict], supports: list[JsonDict], reliable: bool, params: Parameters
) -> JsonDict:
    residuals = [support["relativeResidual"] for support in inliers]
    return {
        "state": "candidate" if reliable else "unknown",
        "metresPerPdfPoint": scale if reliable else None,
        "gap": None if reliable else "no_scale",
        "reason": None if reliable else "insufficient_consensus_or_axis_support",
        "inlierCount": len(inliers),
        "supportCount": len(supports),
        "medianAbsoluteRelativeResidual": median(abs(residual) for residual in residuals) if residuals else None,
        "rmsResidualM": math.sqrt(sum(support["residualM"] ** 2 for support in inliers) / len(inliers))
        if inliers
        else None,
        "inlierRelativeTolerance": params["scaleInlierRelativeTolerance"],
        "independentOfRoomDimensionPairs": True,
    }


def derive_scale(texts: list[JsonDict], dimension_segments: list[JsonDict], params: Parameters) -> JsonDict:
    """Fit source tick-to-tick dimensions, independently of room lengths/areas."""
    captions = [text["literal"] for text in texts if re.search(r"SCALE.*=", text["literal"], re.I)]
    scales = {re.sub(r"\s", "", caption).upper() for caption in captions}
    base = {
        "method": "dimension_layer_tick_intersections+robust_consensus+least_squares_through_origin",
        "state": "unknown",
        "metresPerPdfPoint": None,
        "printedScaleLiterals": captions,
        "supports": [],
        "gap": "no_scale",
    }
    if len(scales) > 1:
        return {**base, "reason": "multiple_printed_panel_scales; select a single-scale region"}
    supports = _scale_supports(texts, _dimension_axes(dimension_segments))
    base["supports"] = supports
    if len(supports) < params["minimumScaleSupports"]:
        return {**base, "reason": "insufficient_unambiguous_tick_to_tick_dimensions"}
    scale, inliers, reliable = _scale_consensus(supports, params)
    return {**base, **_scale_statistics(scale, inliers, supports, reliable, params)}


# Panel title bounds and literal name/dimension groups.


def label_line(text: JsonDict) -> bool:
    literal = text["literal"].strip()
    return bool(
        re.search(r"[A-Za-z]{3}", literal)
        and not re.search(r"[=\d'\"#()]|PLAN|SCALE|SECTION|SCHEDULE|DETAIL", literal, re.I)
    )


def _panel_columns(page: fitz.Page, texts: list[JsonDict], title: JsonDict) -> tuple[int, float, float]:
    row = sorted(
        [
            text
            for text in texts
            if abs(text["bbox"][1] - title["bbox"][1]) < title["size"]
            and re.search(r"\bPLAN$", text["literal"].strip(), re.I)
        ],
        key=lambda text: text["bbox"][0],
    )
    position = next(index for index, text in enumerate(row) if text is title)
    spacings = [
        right["bbox"][0] - left["bbox"][0]
        for left, right in zip(row, row[1:])
        if right["bbox"][0] - left["bbox"][0] > 30
    ]
    spacing = median(spacings) if spacings else page.rect.width / 3
    centres = [text["bbox"][0] + spacing / 3 for text in row]
    left = (centres[position - 1] + centres[position]) / 2 if position else centres[position] - spacing / 2
    right = centres[position] + spacing / 2
    if position + 1 < len(row):
        right = (centres[position] + centres[position + 1]) / 2
    return position, left, right


def _panel_vertical_bounds(texts: list[JsonDict], title: JsonDict, scales: list[JsonDict]) -> tuple[float, float]:
    previous = [
        text["bbox"][3]
        for text in texts
        if re.match(r"SCALE\s", text["literal"], re.I) and text["bbox"][3] < title["bbox"][1] - title["size"] * 5
    ]
    row_counts = Counter(round(height / title["size"]) for height in previous)
    previous_rows = [height for height in previous if row_counts[round(height / title["size"])] >= 2]
    top = max(previous_rows) + title["size"] / 2 if previous_rows else 0
    bottom = max([title["bbox"][3], *(scale["bbox"][3] for scale in scales)]) + title["size"] / 2
    return top, bottom


def _panel_from_title(
    page: fitz.Page, texts: list[JsonDict], title: JsonDict, regions: Sequence[Sequence[float]]
) -> JsonDict:
    position, left, right = _panel_columns(page, texts, title)
    scales = [
        text
        for text in texts
        if re.match(r"SCALE\s", text["literal"], re.I)
        and left <= text["bbox"][0] < right
        and 0 <= text["bbox"][1] - title["bbox"][3] <= title["size"] * 3
    ]
    top, bottom = _panel_vertical_bounds(texts, title, scales)
    bbox = [max(0, left), top, min(page.rect.width, right), min(page.rect.height, bottom)]
    if regions:
        overlaps = [box(*bbox).intersection(box(*region)) for region in regions if box(*bbox).intersects(box(*region))]
        if overlaps:
            bbox = list(unary_union(overlaps).bounds)
    return {
        "panelId": f"p{page.number + 1}-panel-{position + 1}",
        "floorLabel": title["literal"],
        "titleCitation": title,
        "scaleCitation": scales[0] if len(scales) == 1 else None,
        "panelBboxPdf": bbox,
        "bboxMethod": "title_row_separators_and_previous_scale_row",
        "state": "candidate",
        "limitations": ["title association is not reviewed level assignment"],
    }


def detect_panels(page: fitz.Page, texts: list[JsonDict], regions: Sequence[Sequence[float]]) -> list[JsonDict]:
    """Use title-row separators and prior scale rows, never guessed room edges."""
    return [
        _panel_from_title(page, texts, title, regions)
        for title in texts
        if FLOOR_TITLE.fullmatch(title["literal"].strip()) and in_scope(title["bbox"], regions)
    ]


def stated_scale(literal: str) -> float | None:
    match = re.fullmatch(r"SCALE\s*([0-9./]+)\s*\"\s*=\s*(.+)", literal.strip(), re.I)
    if not match:
        return None
    paper = parse_length(match[1] + '"')
    real = parse_length(match[2])
    if paper["metres"] and real["metres"]:
        paper_inches = paper["metres"] / 0.0254
        return real["metres"] / (paper_inches * 72)
    return None


def group_room_labels(texts: list[JsonDict]) -> list[JsonDict]:
    groups = []
    for name in texts:
        if not label_line(name):
            continue
        x0, y0, x1, y1 = name["bbox"]
        below = [
            text
            for text in texts
            if parse_dimensions(text["literal"]) is not None
            and 0 <= text["bbox"][1] - y1 <= name["size"] * 2
            and abs(text["bbox"][0] - x0) <= name["size"] * 2
            and abs(text["direction"][0] - name["direction"][0]) < 0.01
        ]
        below.sort(key=lambda text: (text["bbox"][1] - y1, abs(text["bbox"][0] - x0)))
        if not SPACE_WORDS.search(name["literal"]) and not below:
            continue
        dimension = below[0] if below else None
        groups.append(
            {
                "name": name,
                "dimensionLine": dimension,
                "statedDimensions": {**parse_dimensions(dimension["literal"]), "bbox": dimension["bbox"]}
                if dimension
                else None,
                "anchorPdf": [(x0 + x1) / 2, (y0 + y1) / 2],
                "anchorMethod": "centre_of_name_line_bbox; dimension_line_directly_below",
                "dimensionGroupingIssue": "ambiguous_dimension_lines" if len(below) > 1 else None,
            }
        )
    return groups


# Wall evidence -> paired strips -> bounded bridges -> outline -> room faces.


def _axis_segment(start: Coordinate, end: Coordinate, seqno: int, tolerance: float) -> AxisSegment | None:
    axis = segment_axis(start, end)
    if axis is None:
        return None
    return AxisSegment(
        axis,
        round(start[1 - axis] / tolerance) * tolerance,
        min(start[axis], end[axis]),
        max(start[axis], end[axis]),
        seqno,
    )


def _slab_contour_segments(path: JsonDict, evidence: WallEvidence, tolerance: float) -> None:
    for start, end in item_segments(path):
        if math.dist(start, end) <= tolerance:
            continue
        evidence.contours.append(LineString([start, end]))
        axis = _axis_segment(start, end, path["seqno"], tolerance)
        if axis is not None:
            evidence.slab_axes.append(axis)
    evidence.source_seqnos.add(path["seqno"])


def _closed_source_outline(segments: list[Segment], tolerance: float, factor: float) -> Polygon | None:
    if len(segments) < 3:
        return None
    connected = all(math.dist(end, start) < tolerance for (_, end), (start, _) in zip(segments, segments[1:]))
    if not connected or math.dist(segments[0][0], segments[-1][1]) >= tolerance:
        return None
    polygon = Polygon([segments[0][0]] + [end for _, end in segments])
    if polygon.is_valid and polygon.area * factor**2 > 10:
        return polygon
    return None


def _built_segments_and_outline(path: JsonDict, evidence: WallEvidence, tolerance: float, factor: float) -> None:
    segments = list(item_segments(path))
    outline = _closed_source_outline(segments, tolerance, factor)
    if outline is not None:
        evidence.outlines.append(outline)
    for start, end in segments:
        line = LineString([start, end])
        if line.length <= tolerance:
            continue
        evidence.contours.append(line)
        axis = _axis_segment(start, end, path["seqno"], tolerance)
        if axis is not None:
            evidence.axes.append(axis)
        evidence.source_seqnos.add(path["seqno"])


def _wall_thickness_matches(thickness: float, factor: float, params: Parameters) -> bool:
    return params["minimumWallThicknessM"] <= thickness * factor <= params["maximumWallThicknessM"]


def _column_window_quads(path: JsonDict, evidence: WallEvidence, factor: float, params: Parameters) -> None:
    for item in path["items"]:
        if item[0] != "qu":
            evidence.rejected["door_leaf_curve_or_nonquad"] += 1
            continue
        quad = item[1]
        polygon = Polygon([tuple(quad.ul), tuple(quad.ur), tuple(quad.lr), tuple(quad.ll)])
        thickness = min(polygon.bounds[2] - polygon.bounds[0], polygon.bounds[3] - polygon.bounds[1])
        if _wall_thickness_matches(thickness, factor, params):
            evidence.wall_parts.append(polygon)
            evidence.source_seqnos.add(path["seqno"])
        else:
            evidence.rejected["nonwall_thickness_door_leaf_mullion_or_roof_panel"] += 1


def collect_wall_evidence(
    paths: list[JsonDict], panel: JsonDict, factor: float, params: Parameters, extent: Polygon, profile: LayerProfile
) -> WallEvidence:
    evidence = WallEvidence()
    tolerance = params["snapTolerancePdf"]
    band = list(extent.buffer(params["maximumWallThicknessM"] / factor, join_style=2).bounds)
    for path in paths:
        if not in_scope(list(path["rect"]), [panel["panelBboxPdf"]]):
            continue
        layer = path.get("layer", "")
        if matches_layer(profile.floor_slab, layer):
            _slab_contour_segments(path, evidence, tolerance)
            continue
        if not in_scope(list(path["rect"]), [band]):
            evidence.rejected["outside_hatch_building_band"] += 1
            continue
        if matches_layer(profile.built_outline, layer):
            _built_segments_and_outline(path, evidence, tolerance, factor)
        elif matches_layer(profile.column_window_quads, layer) and path.get("color") and max(path["color"]) < 0.95:
            _column_window_quads(path, evidence, factor, params)
        else:
            evidence.rejected["nonarchitectural_or_hatch_support_only"] += 1
    return evidence


def _axis_box(axis: Axis, low: float, high: float, normal_low: float, normal_high: float) -> Polygon:
    if axis == 0:
        return box(low, normal_low, high, normal_high)
    return box(normal_low, low, normal_high, high)


def dedupe_by_bounds(items: list[BoundsItem], tolerance: float) -> list[BoundsItem]:
    """Keep the first source hypothesis at each precision-grid bound."""
    unique: dict[tuple[int, ...], BoundsItem] = {}
    for item in items:
        key = tuple(round(value / tolerance) for value in item.polygon.bounds)
        unique.setdefault(key, item)
    return list(unique.values())


def pair_wall_strips(evidence: WallEvidence, hatch_tree: STRtree, factor: float, params: Parameters) -> list[WallStrip]:
    axes = [*evidence.axes, *evidence.slab_axes]
    architectural_axis_count = len(evidence.axes)
    strips = []
    for index, first in enumerate(axes):
        for other_index, second in enumerate(axes[index + 1 :], start=index + 1):
            if first.axis != second.axis or not _wall_thickness_matches(
                abs(first.normal - second.normal), factor, params
            ):
                continue
            low, high = max(first.low, second.low), min(first.high, second.high)
            if high - low < 2:
                continue
            normal_low, normal_high = sorted([first.normal, second.normal])
            polygon = _axis_box(first.axis, low, high, normal_low, normal_high)
            both_slab = index >= architectural_axis_count and other_index >= architectural_axis_count
            if len(hatch_tree.query(polygon, predicate="intersects")) or both_slab:
                strips.append(WallStrip(polygon, first.axis, sorted({first.seqno, second.seqno})))
    return dedupe_by_bounds(strips, params["snapTolerancePdf"])


def _strip_extents(strip: WallStrip, axis: Axis) -> tuple[float, float, float, float]:
    x0, y0, x1, y1 = strip.polygon.bounds
    if axis == 0:
        return y0, y1, x0, x1
    return x0, x1, y0, y1


def _opening_bridge(source: WallStrip, target: WallStrip, factor: float, params: Parameters) -> OpeningBridge | None:
    normal_low, normal_high, low, high = _strip_extents(source, source.axis)
    target_normal_low, target_normal_high, target_low, target_high = _strip_extents(target, source.axis)
    overlap_low = max(normal_low, target_normal_low)
    overlap_high = min(normal_high, target_normal_high)
    if (overlap_high - overlap_low) * factor < params["minimumWallThicknessM"]:
        return None
    gap_low, gap_high = (high, target_low) if high < target_low else (target_high, low)
    width = (gap_high - gap_low) * factor
    if not params["snapTolerancePdf"] * factor < width <= params["maximumOpeningWidthM"]:
        return None
    polygon = _axis_box(source.axis, gap_low, gap_high, overlap_low, overlap_high)
    return OpeningBridge(polygon, width, source.axis, sorted(set(source.source_seqnos + target.source_seqnos)))


def opening_bridges(strips: list[WallStrip], factor: float, params: Parameters) -> list[OpeningBridge]:
    # Junction intersections are physical wall, not a reason to drop a closure.
    bridges = []
    for source in strips:
        for target in strips:
            bridge = _opening_bridge(source, target, factor, params)
            if bridge is not None:
                bridges.append(bridge)
    return dedupe_by_bounds(bridges, params["snapTolerancePdf"])


def build_wall_mask(
    wall_parts: list[Polygon], bridges: list[OpeningBridge], contours: list[LineString], params: Parameters
) -> BaseGeometry:
    tolerance = params["snapTolerancePdf"]
    parts = [
        *wall_parts,
        *(bridge.polygon for bridge in bridges),
        *(set_precision(line, tolerance).buffer(tolerance, cap_style=2, join_style=2) for line in contours),
    ]
    return unary_union([set_precision(part, tolerance) for part in parts]).buffer(
        params["wallSeamBufferPdf"], join_style=2
    )


def building_outline(
    mask: BaseGeometry, outlines: list[Polygon], extent: Polygon, groups: list[JsonDict], params: Parameters
) -> OutlineResult:
    tolerance = params["snapTolerancePdf"]
    if outlines:
        outline = set_precision(max(outlines, key=lambda polygon: polygon.area), tolerance)
        return OutlineResult(outline, "closed_source_A-built_outer_trace", [])
    main = max(polygon_parts(mask), key=lambda polygon: Polygon(polygon.exterior).area)
    shell = Polygon(main.exterior)
    faces = polygon_parts(shell.difference(mask))
    # Select source faces, never fabricate a text rectangle.
    exterior_faces = [
        polygon
        for polygon in faces
        if polygon.area > 0
        and polygon.intersection(extent).area / polygon.area < params["minimumUnlabelledFaceInsideWallBandFraction"]
        and not any(polygon.covers(Point(*group["anchorPdf"])) for group in groups)
    ]
    faces = [polygon for polygon in faces if polygon.area > 0 and polygon not in exterior_faces]
    building = unary_union([mask.intersection(extent.buffer(tolerance)), *faces])
    outline = Polygon(max(polygon_parts(building), key=lambda polygon: Polygon(polygon.exterior).area).exterior)
    return OutlineResult(outline, "source_barrier_shell_excluding_unlabelled_exterior_setback_faces", exterior_faces)


def room_faces(
    outline: Polygon, mask: BaseGeometry, factor: float, params: Parameters
) -> tuple[list[Polygon], Counter[str]]:
    rooms = []
    omissions: Counter[str] = Counter()
    for face in polygon_parts(outline.difference(mask)):
        if face.area * factor**2 < params["minimumRoomAreaM2"]:
            omissions["below_minimum_room_area"] += 1
        elif not face.is_valid:
            omissions["invalid_face"] += 1
        else:
            rooms.append(orient(face.simplify(params["snapTolerancePdf"] / 2, preserve_topology=True), sign=1))
    rooms.sort(key=lambda polygon: (polygon.bounds[1], polygon.bounds[0]))
    return rooms, omissions


def geometry_json(polygon: Polygon) -> JsonDict:
    return json.loads(json.dumps(mapping(orient(polygon, sign=1))))


def _barrier_components(mask: BaseGeometry) -> list[JsonDict]:
    return [
        {
            "bbox": list(polygon.bounds),
            "shellAreaPdf2": Polygon(polygon.exterior).area,
            "holeBboxes": [list(Polygon(hole).bounds) for hole in polygon.interiors],
        }
        for polygon in polygon_parts(mask)
    ]


def _bridge_json(bridge: OpeningBridge) -> JsonDict:
    return {
        "widthM": bridge.width_m,
        "axis": bridge.axis,
        "sourceSeqnos": bridge.source_seqnos,
        "method": bridge.method,
        "state": bridge.state,
        "polygonPdf": geometry_json(bridge.polygon),
    }


def _mask_anchor_diagnostics(mask: BaseGeometry, groups: list[JsonDict]) -> list[JsonDict]:
    return [
        {
            "literal": group["name"]["literal"],
            "anchorOnWallMask": mask.covers(Point(*group["anchorPdf"])),
        }
        for group in groups
    ]


def mask_diagnostics(
    evidence: WallEvidence,
    mask: BaseGeometry,
    result: OutlineResult,
    hatch: list[LineString],
    strips: list[WallStrip],
    bridges: list[OpeningBridge],
    groups: list[JsonDict],
    omissions: Counter[str],
    factor: float,
    params: Parameters,
) -> JsonDict:
    # A source outline and a barrier-shell outline have different omission keys.
    omitted = Counter()
    if not evidence.outlines:
        omitted["unlabelled_exterior_setback_faces"] = len(result.excluded_exterior_faces)
    omitted.update(omissions)
    return {
        "method": params["wallMaskProfile"],
        "minimumRoomAreaM2": params["minimumRoomAreaM2"],
        "minimumUnlabelledFaceInsideWallBandFraction": params["minimumUnlabelledFaceInsideWallBandFraction"],
        "maximumOpeningWidthM": params["maximumOpeningWidthM"],
        "snapTolerancePdf": params["snapTolerancePdf"],
        "seamBufferPdf": params["wallSeamBufferPdf"],
        "hatchSupportSegments": len(hatch),
        "pairedWallStrips": len(strips),
        "wallAreaM2": mask.intersection(result.outline).area * factor**2,
        "sourceDrawingSeqnos": sorted(evidence.source_seqnos),
        "filters": dict(evidence.rejected),
        "omittedFaces": dict(omitted),
        "barrierComponents": _barrier_components(mask),
        "outlineMethod": result.method,
        "buildingOutlinePdf": geometry_json(result.outline),
        "wallMaskPdf": json.loads(json.dumps(mapping(mask.intersection(result.outline)))),
        "maskAnchorDiagnostics": _mask_anchor_diagnostics(mask, groups),
        "bridges": [_bridge_json(bridge) for bridge in bridges],
    }


def mask_regions(
    drawings: list[JsonDict],
    panel: JsonDict,
    factor: float | None,
    params: Parameters,
    groups: list[JsonDict],
    profile: LayerProfile = MAGNOLIA_CAD_LAYERS,
) -> tuple[list[Polygon], Polygon | None, JsonDict]:
    """Compose source wall evidence; hatch strokes support occupancy, not room edges."""
    paths = [path for path in drawings if in_scope(list(path["rect"]), [panel["panelBboxPdf"]])]
    hatch = [
        LineString([start, end])
        for path in paths
        if matches_layer(profile.wall_hatch, path.get("layer", ""))
        for start, end in item_segments(path)
        if math.dist(start, end) > 0.1
    ]
    if not hatch or factor is None:
        gap = "no_scale" if factor is None else "no_hatch_supported_wall_mask"
        return [], None, {"gap": gap, "bridges": []}
    extent = unary_union(hatch).envelope
    evidence = collect_wall_evidence(paths, panel, factor, params, extent, profile)
    strips = pair_wall_strips(evidence, STRtree(hatch), factor, params)
    wall_parts = [*evidence.wall_parts, *(strip.polygon for strip in strips)]
    bridges = opening_bridges(strips, factor, params)
    mask = build_wall_mask(wall_parts, bridges, evidence.contours, params)
    if not polygon_parts(mask):
        return [], None, {"gap": "no_closed_building_barrier", "bridges": []}
    result = building_outline(mask, evidence.outlines, extent, groups, params)
    rooms, omissions = room_faces(result.outline, mask, factor, params)
    diagnostics = mask_diagnostics(evidence, mask, result, hatch, strips, bridges, groups, omissions, factor, params)
    return rooms, result.outline, diagnostics


# Candidate attachment, local frames, consistency and page orchestration.


def _unknown_consistency(reason: str) -> JsonDict:
    return {"status": "unknown", "reason": reason, "differenceM2": None}


def consistency(polygon: Polygon, dimensions: list[JsonDict], scale: float | None, tolerance: float) -> JsonDict:
    if scale is None:
        return _unknown_consistency("no_scale")
    if len(dimensions) != 1:
        return _unknown_consistency("no_stated_dimensions" if not dimensions else "multiple_dimension_labels")
    if not dimensions[0]["parsed"]:
        return _unknown_consistency("ambiguous_stated_dimensions")
    expected = dimensions[0]["dimensionProductM2"]
    area = polygon.area * scale**2
    bbox_lengths = sorted(
        [
            (polygon.bounds[2] - polygon.bounds[0]) * scale,
            (polygon.bounds[3] - polygon.bounds[1]) * scale,
        ]
    )
    stated = sorted(dimension["metres"] for dimension in dimensions[0]["dimensions"])
    axis_errors = [drawn - literal for drawn, literal in zip(bbox_lengths, stated)]
    relative = (area - expected) / expected
    # Door leaves/jambs can extend the bbox without changing face area materially.
    ok = abs(relative) <= tolerance
    bbox_ok = all(abs(error / literal) <= tolerance for error, literal in zip(axis_errors, stated))
    return {
        "status": "ok" if ok else "mismatch",
        "comparedQuantity": "area_vs_stated_length_product",
        "bboxDiagnosticStatus": "ok" if bbox_ok else "mismatch",
        "differenceM2": area - expected,
        "relativeAreaDifference": relative,
        "dimensionProductM2": expected,
        "drawnAreaM2": area,
        "drawnBboxLengthsM": bbox_lengths,
        "statedLengthsM": stated,
        "axisDifferencesM": axis_errors,
        "relativeTolerance": tolerance,
        "method": "polygon_area_vs_stated_length_product; separate_axis_bbox_diagnostic",
        "limitation": "length product assumes a rectangle; bbox includes door leaves/jambs and is diagnostic only",
    }


def unknown_scale() -> JsonDict:
    return {"state": "unknown", "metresPerPdfPoint": None, "method": None, "gap": "no_scale", "supports": []}


def _prepare_page(
    page: fitz.Page,
    drawings: list[JsonDict],
    texts: list[JsonDict],
    selected: list[JsonDict],
    classification: JsonDict,
    regions: Sequence[Sequence[float]],
    params: Parameters,
    profile: LayerProfile,
) -> tuple[PageWork, list[JsonDict], list[JsonDict]]:
    work = PageWork()
    dimensions: list[JsonDict] = []
    if classification["kind"] != "not_vector" and not any(
        profile.matches_wall_layer(drawing.get("layer", "")) for drawing in drawings
    ):
        work.layer_profile_gap = True
        return work, selected, dimensions
    if classification["kind"] == "vector_plan":
        _, dimensions, work.linework = extract_linework(drawings, params, profile)
        work.panels = detect_panels(page, texts, regions)
        if params.get("panelTitleSelection"):
            work.panels = [panel for panel in work.panels if panel["floorLabel"] in params["panelTitleSelection"]]
        if work.panels:
            selected = [
                text for text in selected if in_scope(text["bbox"], [panel["panelBboxPdf"] for panel in work.panels])
            ]
        work.scale = derive_scale(selected, dimensions, params)
    return work, selected, dimensions


def _fit_panel_scale(panel: JsonDict, texts: list[JsonDict], dimensions: list[JsonDict], params: Parameters) -> None:
    fit = derive_scale(texts, dimensions, params)
    factor = fit["metresPerPdfPoint"]
    citation = panel["scaleCitation"]
    theoretical = stated_scale(citation["literal"]) if citation else None
    difference = factor / theoretical - 1 if factor and theoretical else None
    status = "unknown"
    if difference is not None:
        status = "ok" if abs(difference) <= params["panelScaleAgreementTolerance"] else "mismatch"
    fit["statedScaleCrossCheck"] = {
        "literal": citation["literal"] if citation else None,
        "theoreticalMetresPerPdfPoint": theoretical,
        "fittedMetresPerPdfPoint": factor,
        "relativeDifference": difference,
        "relativeTolerance": params["panelScaleAgreementTolerance"],
        "status": status,
    }
    if difference is not None and abs(difference) > params["panelScaleAgreementTolerance"]:
        fit["metresPerPdfPoint"] = None
        fit["gap"] = "no_scale"
        fit["reason"] = "panel_scale_literal_disagrees_with_dimension_fit"
    panel["scale"] = fit


def _unattached_reason(hits: list[int], outline: Polygon | None, group: JsonDict) -> str:
    if hits:
        return "ambiguous_multiple_regions"
    if outline is None:
        return "no_scale_or_wall_mask"
    if not outline.covers(Point(*group["anchorPdf"])):
        return "anchor_outside_building_outline"
    return "anchor_on_wall_or_dropped_face"


def _attach_groups(
    panel: JsonDict, groups: list[JsonDict], polygons: list[Polygon], outline: Polygon | None, audit: list[JsonDict]
) -> list[list[JsonDict]]:
    by_face: list[list[JsonDict]] = [[] for _ in polygons]
    for group in groups:
        hits = [index for index, polygon in enumerate(polygons) if polygon.covers(Point(*group["anchorPdf"]))]
        item = {
            "panelId": panel["panelId"],
            "floorLabel": panel["floorLabel"],
            **group,
            "candidateRef": None,
            "status": "unattached",
            "reason": None,
        }
        if len(hits) == 1:
            by_face[hits[0]].append(item)
            item["status"] = "attached"
        else:
            item["reason"] = _unattached_reason(hits, outline, group)
        audit.append(item)
    return by_face


def _label_issue(labels: list[JsonDict]) -> str | None:
    if len(labels) > 1:
        return "merged_region"
    if not labels:
        return "unlabelled_region"
    return None


def _label_payload(attached: list[JsonDict]) -> JsonDict:
    labels = [group["name"] for group in attached]
    excluded = {"candidateRef", "status", "reason", "floorLabel", "panelId"}
    return {
        "label": labels[0]["literal"] if len(labels) == 1 else "unknown",
        "labelLiterals": [{"literal": text["literal"], "bbox": text["bbox"]} for text in labels],
        "labelState": "candidate" if len(labels) == 1 else "unknown",
        "statedDimensions": [group["statedDimensions"] for group in attached if group["statedDimensions"] is not None],
        "labelGroups": [{key: value for key, value in group.items() if key not in excluded} for group in attached],
        "issue": _label_issue(labels),
        "textLines": [
            text for group in attached for text in [group["name"], group["dimensionLine"]] if text is not None
        ],
    }


def _metric_payload(polygon: Polygon, panel: JsonDict) -> JsonDict:
    factor = panel["scale"]["metresPerPdfPoint"]
    origin = panel["originPdf"]
    metric = None
    frame = None
    if factor:
        metric = affinity.scale(
            affinity.translate(polygon, xoff=-origin[0], yoff=-origin[1]),
            xfact=factor,
            yfact=-factor,
            origin=(0, 0),
        )
        frame = {
            "kind": "panel_local",
            "originPdf": origin,
            "axes": ["page_right", "page_up"],
            "unit": "m",
            "metresPerPdfPoint": factor,
            "georeferenced": False,
        }
    return {
        "polygonPdf": geometry_json(polygon),
        "polygonMetres": geometry_json(metric) if metric is not None else None,
        "metricFrame": frame,
        "computedArea": {
            "value": polygon.area * factor**2 if factor else polygon.area,
            "unit": "m2" if factor else "pdf_point2",
            "state": "candidate",
            "method": METHOD,
        },
        "areaPdfPoint2": polygon.area,
    }


def _source_citation(polygon: Polygon, page_number: int, source: JsonDict) -> JsonDict:
    return {
        "sourceSha256": source["sha256"],
        "page": page_number,
        "bbox": list(polygon.bounds),
        "coordinateConvention": "unrotated_mupdf_points_top_left_x_right_y_down",
    }


def _candidate_payload(
    polygon: Polygon, attached: list[JsonDict], panel: JsonDict, citation: JsonDict, params: Parameters
) -> JsonDict:
    labels = _label_payload(attached)
    factor = panel["scale"]["metresPerPdfPoint"]
    gaps = ["no_scale"] if factor is None else []
    if labels["issue"]:
        gaps.append(labels["issue"])
    return {
        "floorLabel": panel["floorLabel"],
        "panelId": panel["panelId"],
        **_metric_payload(polygon, panel),
        **labels,
        "consistency": consistency(polygon, labels["statedDimensions"], factor, params["consistencyRelativeTolerance"]),
        "citation": citation,
        "gaps": gaps,
    }


def _candidate_envelope(payload: JsonDict, source: JsonDict, parameter_hash: str, output_ref: str) -> JsonDict:
    citation = payload["citation"]
    return {
        "task": "plan_rooms",
        "taskVersion": "2",
        "sourceParts": [citation],
        "inputManifest": source,
        "methodNameAndVersion": METHOD,
        "method": METHOD,
        "parameterHash": parameter_hash,
        "outputRef": output_ref,
        "floorLabel": payload["floorLabel"],
        "panelId": payload["panelId"],
        "confidenceOrError": {"confidence": None, "error": payload["consistency"], "calibrated": False},
        "coverage": {"page": citation["page"], "bbox": citation["bbox"], "kind": "building_interior_minus_wall_mask"},
        "limitations": list(LIMITATIONS),
        "state": "candidate",
        "issue": payload["issue"],
        "output": payload,
    }


def _process_panel(
    page: fitz.Page,
    drawings: list[JsonDict],
    selected: list[JsonDict],
    dimensions: list[JsonDict],
    panel: JsonDict,
    work: PageWork,
    source: JsonDict,
    parameter_hash: str,
    params: Parameters,
    profile: LayerProfile,
) -> None:
    texts = [text for text in selected if in_scope(text["bbox"], [panel["panelBboxPdf"]])]
    _fit_panel_scale(panel, texts, dimensions, params)
    groups = group_room_labels(texts)
    polygons, outline, topology = mask_regions(
        drawings, panel, panel["scale"]["metresPerPdfPoint"], params, groups, profile
    )
    panel["topology"] = topology
    panel["originPdf"] = [outline.bounds[0], outline.bounds[3]] if outline is not None else None
    panel["originMethod"] = "building_outline_bbox_lower_left; panel_local_not_georeferenced"
    by_face = _attach_groups(panel, groups, polygons, outline, work.audit)
    for polygon, attached in zip(polygons, by_face):
        output_ref = f"candidates.json#/pages/{page.number + 1}/candidates/{len(work.candidates)}"
        for item in attached:
            item["candidateRef"] = output_ref
        citation = _source_citation(polygon, page.number + 1, source)
        payload = _candidate_payload(polygon, attached, panel, citation, params)
        work.assigned.update((text["locator"]["block"], text["locator"]["line"]) for text in payload["textLines"])
        work.candidates.append(_candidate_envelope(payload, source, parameter_hash, output_ref))
    panel["summary"] = summarize(
        [candidate for candidate in work.candidates if candidate["panelId"] == panel["panelId"]],
        [entry for entry in work.audit if entry["panelId"] == panel["panelId"]],
    )


def _page_gaps(classification: JsonDict, panels: list[JsonDict], layer_profile_gap: bool) -> list[str]:
    if layer_profile_gap:
        return ["no_matching_layer_profile"]
    if classification["kind"] != "vector_plan":
        return [classification["kind"]]
    if not panels:
        return ["no_detected_floor_panels"]
    if all(panel["scale"]["metresPerPdfPoint"] is None for panel in panels):
        return ["no_scale"]
    return []


def _measurement_restrictions(texts: list[JsonDict]) -> list[JsonDict]:
    return [
        {"literal": text["literal"], "bbox": text["bbox"]} for text in texts if "NOT SCALE" in text["literal"].upper()
    ]


def _page_result(
    page: fitz.Page,
    texts: list[JsonDict],
    selected: list[JsonDict],
    classification: JsonDict,
    work: PageWork,
    regions: Sequence[Sequence[float]],
    start: float,
) -> JsonDict:
    unattached = [
        {
            **text,
            "parsedDimensions": parse_dimensions(text["literal"]),
            "reason": "not_part_of_attached_room_label_group",
        }
        for text in selected
        if (text["locator"]["block"], text["locator"]["line"]) not in work.assigned
    ]
    summary = summarize(work.candidates, work.audit)
    summary["unattachedTextLines"] = len(unattached)
    return {
        "page": page.number + 1,
        "pageSizePdf": [page.rect.width, page.rect.height],
        "rotation": page.rotation,
        "classification": classification,
        "scopePdfBboxes": regions or [panel["panelBboxPdf"] for panel in work.panels],
        "linework": work.linework,
        "scale": work.scale,
        "panels": work.panels,
        "labelAudit": work.audit,
        "candidates": work.candidates,
        "unattachedText": unattached,
        "sourceMeasurementRestrictions": _measurement_restrictions(texts),
        "gaps": _page_gaps(classification, work.panels, work.layer_profile_gap),
        "summary": summary,
        "runtimeSeconds": time.perf_counter() - start,
    }


def read_page(
    page: fitz.Page,
    source_manifest: JsonDict,
    parameter_hash: str,
    params: Parameters,
    regions: Sequence[Sequence[float]] | None = None,
    layer_profile: LayerProfile = MAGNOLIA_CAD_LAYERS,
) -> JsonDict:
    start = time.perf_counter()
    regions = regions or []
    drawings, texts = page.get_drawings(), text_lines(page)
    selected = [text for text in texts if in_scope(text["bbox"], regions)]
    classification = classify(drawings, texts, page)
    work, selected, dimensions = _prepare_page(
        page, drawings, texts, selected, classification, regions, params, layer_profile
    )
    for panel in work.panels:
        _process_panel(
            page, drawings, selected, dimensions, panel, work, source_manifest, parameter_hash, params, layer_profile
        )
    return _page_result(page, texts, selected, classification, work, regions, start)


def summarize(candidates: list[JsonDict], audit: list[JsonDict]) -> JsonDict:
    parsed = [
        candidate for candidate in candidates if any(dim["parsed"] for dim in candidate["output"]["statedDimensions"])
    ]
    ok = sum(candidate["output"]["consistency"]["status"] == "ok" for candidate in parsed)
    dimension_groups = [entry for entry in audit if entry["statedDimensions"] is not None]
    valid_groups = [entry for entry in dimension_groups if entry["statedDimensions"]["parsed"]]
    return {
        "roomsFound": len(candidates),
        "roomsWithParsedLabel": sum(candidate["output"]["labelState"] == "candidate" for candidate in candidates),
        "roomsWithStatedDims": len(parsed),
        "consistency": dict(Counter(candidate["output"]["consistency"]["status"] for candidate in candidates)),
        "roomNameLiterals": len(audit),
        "attachedRoomNames": sum(entry["status"] == "attached" for entry in audit),
        "unattachedRoomNames": sum(entry["status"] != "attached" for entry in audit),
        "allRoomNamesAccountedFor": all(
            (entry["status"] == "attached" and entry["candidateRef"] is not None)
            or (entry["status"] == "unattached" and entry["reason"] is not None)
            for entry in audit
        ),
        "roomsWithAnyStatedDimLiteral": len(dimension_groups),
        "roomNamesWithParsedDimensions": len(valid_groups),
        "attachedParsedDimensionGroups": sum(entry["status"] == "attached" for entry in valid_groups),
        "consistencyOkNumerator": ok,
        "consistencyParsedRoomDenominator": len(valid_groups),
        "consistencyOkFraction": ok / len(valid_groups) if valid_groups else None,
        "consistencyAllDimLiteralDenominator": len(dimension_groups),
        "consistencyOkFractionAllDimLiterals": ok / len(dimension_groups) if dimension_groups else None,
    }


# Small overlay steps share one explicit coordinate transform.


def _overlay_canvas(page: fitz.Page, result: JsonDict, max_side: int) -> OverlayCanvas:
    if result["classification"]["kind"] != "vector_plan":
        max_side = min(max_side, 640)
    scope = result["scopePdfBboxes"]
    clip = fitz.Rect(scope[0]) if scope else page.rect
    for region in scope[1:]:
        clip |= fitz.Rect(region)
    zoom = min(2.0, max_side / max(clip.width, clip.height))
    pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip, alpha=False, colorspace=fitz.csRGB)
    image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
    return OverlayCanvas(page, pixmap, image, ImageDraw.Draw(image), ImageFont.load_default(size=12), zoom, clip)


def _draw_candidates(canvas: OverlayCanvas, candidates: list[JsonDict]) -> None:
    for index, candidate in enumerate(candidates):
        value = candidate["output"]
        color = {"ok": "#137a46", "mismatch": "#d43b20", "unknown": "#707b8a"}[value["consistency"]["status"]]
        for ring in value["polygonPdf"]["coordinates"]:
            canvas.draw.line([canvas.point(point) for point in ring], fill=color, width=2)
        centroid = shape(value["polygonPdf"]).representative_point()
        position = canvas.point([centroid.x, centroid.y])
        label = f"{index + 1}: {value['label']}"
        if value.get("issue") == "merged_region":
            label = f"{index + 1}: MERGED " + " / ".join(text["literal"] for text in value["labelLiterals"])
        canvas.draw.text(position, label, fill=color, font=canvas.font, stroke_width=1, stroke_fill="white")


def _draw_panels(canvas: OverlayCanvas, panels: list[JsonDict]) -> None:
    for panel in panels:
        x, y = canvas.point(panel["titleCitation"]["bbox"][:2])
        canvas.draw.text(
            (x, y - 18),
            f"{panel['panelId']} | {panel['floorLabel']}",
            fill="#2155a3",
            font=canvas.font,
            stroke_width=1,
            stroke_fill="white",
        )
        if panel.get("originPdf"):
            x, y = canvas.point(panel["originPdf"])
            canvas.draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill="#2155a3")
            canvas.draw.text(
                (x + 4, y + 2), "panel origin", fill="#2155a3", font=canvas.font, stroke_width=1, stroke_fill="white"
            )


def _draw_unattached(canvas: OverlayCanvas, audit: list[JsonDict]) -> None:
    for group in audit:
        if group["status"] != "attached":
            x, y = canvas.point(group["anchorPdf"])
            canvas.draw.text(
                (x, y - 16),
                "UNATTACHED: " + group["name"]["literal"],
                fill="#ac2879",
                font=canvas.font,
                stroke_width=1,
                stroke_fill="white",
            )


def render_overlay(page: fitz.Page, result: JsonDict, output_path: Path, max_side: int = 1600) -> JsonDict:
    canvas = _overlay_canvas(page, result, max_side)
    _draw_candidates(canvas, result["candidates"])
    _draw_panels(canvas, result.get("panels", []))
    _draw_unattached(canvas, result.get("labelAudit", []))
    title = f"page {result['page']} | {result['classification']['kind']} | CANDIDATES (not reviewed)"
    canvas.draw.rectangle((0, 0, min(canvas.image.width, 650), 20), fill="white")
    canvas.draw.text((4, 3), title, fill="black", font=canvas.font)
    canvas.image.save(output_path, optimize=True)
    return {
        "file": output_path.name,
        "size": [canvas.pixmap.width, canvas.pixmap.height],
        "clipPdf": list(canvas.clip),
        "nonplanThumbnail": result["classification"]["kind"] != "vector_plan",
        "bytes": output_path.stat().st_size,
    }
