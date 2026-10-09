"""Offline, deterministic vector-plan candidates; no registry or model calls.

PDF coordinates are unrotated MuPDF points (x right, y down). A snapped
polygon is a derivative, not surveyed geometry. Wall masks and bounded source-
aligned opening closures are candidates. Every bridge is exported for review.
"""
from __future__ import annotations

from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re
from statistics import median
import time

import fitz
from PIL import Image, ImageDraw, ImageFont
import shapely
from shapely import affinity, set_precision
from shapely.geometry import LineString, MultiPoint, Point, Polygon, box, mapping
from shapely.strtree import STRtree
from shapely.geometry.polygon import orient
from shapely.ops import polygonize_full, snap, unary_union

METHOD = "deterministic:vector-plan@1"
DEFAULTS = {
    "snapTolerancePdf": 0.12,
    "minimumRegionAreaPdf2": 120.0,
    "minimumRegionWidthPdf": 12.0,
    "maximumRegionAspect": 15.0,
    "consistencyRelativeTolerance": 0.05,
    "scaleInlierRelativeTolerance": 0.02,
    "minimumScaleSupports": 4,
    "minimumScaleInlierFraction": 0.8,
    "wallLayers": ["Wall", "A- built", "A- windows", "A- Columns"],
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
    "Floor titles are literal panel associations only, not a reviewed level/unit/building association or surveyed frame.",
    "Metric geometry is drawing-derived, not an authorised measurement; written dimensions take precedence.",
    "Layer semantics and the closed-face size filter may omit spaces or retain non-room faces.",
]


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode()).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_length(literal: str, default_metric_unit: str | None = None) -> dict:
    """Keep the literal; SI foot/inch factors are exact (0.3048 / 0.0254)."""
    text = literal.strip().translate(str.maketrans({"′": "'", "’": "'", "″": '"', "“": '"', "”": '"'}))
    number = r"(?:\d+(?:\.\d+)?(?:\s+\d+/\d+)?|\d+/\d+)"

    def value(s):
        parts = s.split()
        return sum(float(p) if "/" not in p else int(p.split("/")[0]) / int(p.split("/")[1]) for p in parts)

    try:
        imperial = re.fullmatch(rf"(?:(?P<feet>{number})\s*'\s*-?\s*)?(?:(?P<inch>{number})\s*\")?", text)
        if imperial and any(imperial.groupdict().values()):
            feet = value(imperial["feet"]) if imperial["feet"] else 0.0
            inches = value(imperial["inch"]) if imperial["inch"] else 0.0
            if imperial["feet"] and inches >= 12:
                raise ValueError("inch_component_out_of_range")
            metres = feet * 0.3048 + inches * 0.0254
            if metres <= 0:
                raise ValueError("nonpositive_length")
            return {"literal": literal, "metres": round(metres, 9), "sourceUnit": "ft_in",
                    "conversion": "international_foot=0.3048m; inch=0.0254m", "error": None}
        metric = re.fullmatch(r"(\d+(?:[.,]\d+)?)\s*(mm|cm|m|metres?|meters?)?", text, re.I)
        if metric:
            unit = (metric[2] or default_metric_unit or "").lower()
            if unit in {"mm", "cm", "m", "metre", "metres", "meter", "meters"}:
                metres = float(metric[1].replace(",", ".")) * {"mm": .001, "cm": .01}.get(unit, 1)
                if metres <= 0:
                    raise ValueError("nonpositive_length")
                return {"literal": literal, "metres": round(metres, 9), "sourceUnit": unit,
                        "conversion": f"{unit}_to_m", "error": None}
    except (ValueError, ZeroDivisionError):
        pass
    return {"literal": literal, "metres": None, "sourceUnit": "unknown", "conversion": None,
            "error": "unrecognised_or_ambiguous_length"}


def parse_dimensions(literal: str) -> dict | None:
    text = literal.strip()
    if text.startswith("(") and text.endswith(")"):
        text = text[1:-1]
    parts = re.split(r"\s*[xX×]\s*", text)
    if len(parts) != 2 or not re.search(r"\d", parts[0]) or not re.search(r"\d", parts[1]):
        return None
    # A suffix can qualify both metric values, never an unqualified imperial value.
    suffix = re.search(r"(mm|cm|m|metres?|meters?)\s*$", parts[1], re.I)
    dims = [parse_length(p, suffix[1] if suffix else None) for p in parts]
    valid = all(d["metres"] is not None for d in dims)
    return {"literal": literal, "dimensions": dims,
            "dimensionProductM2": round(math.prod(d["metres"] for d in dims), 9) if valid else None,
            "interpretation": "product_of_two_stated_lengths_not_a_literal_area", "parsed": valid}


def text_lines(page) -> list[dict]:
    result = []
    # Text only: avoid decoding large embedded scans in get_text('dict').
    for bi, block in enumerate(page.get_text("dict", flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES)["blocks"]):
        for li, line in enumerate(block.get("lines", [])):
            spans = line["spans"]
            if not spans:
                continue
            result.append({"literal": "".join(s["text"] for s in spans), "bbox": list(line["bbox"]),
                           "direction": list(line["dir"]), "size": max(s["size"] for s in spans),
                           "locator": {"block": bi, "line": li},
                           "spans": [{"literal": s["text"], "bbox": list(s["bbox"])} for s in spans]})
    return result


def item_segments(path):
    """Only source straight lines, rectangles and quads; no fabricated edges."""
    for item in path["items"]:
        if item[0] == "l":
            yield tuple(item[1]), tuple(item[2])
        elif item[0] in {"qu", "re"}:
            r = item[1]
            points = [r.ul, r.ur, r.lr, r.ll, r.ul] if item[0] == "qu" else [r.tl, r.tr, r.br, r.bl, r.tl]
            yield from ((tuple(a), tuple(b)) for a, b in zip(points, points[1:]))


def in_scope(bbox, regions):
    # Drawing-line bboxes can have zero width/height. Shapely box() makes an
    # invalid polygon for those; compare bounds rather than lose source edges.
    return not regions or any(r[0] <= bbox[0] <= bbox[2] <= r[2] and
                              r[1] <= bbox[1] <= bbox[3] <= r[3] for r in regions)


def classify(drawings, texts, page) -> dict:
    strokes = sum(len(d["items"]) for d in drawings if "s" in d["type"])
    pairs = sum(parse_dimensions(t["literal"]) is not None for t in texts)
    plan_heading = any(re.search(r"\bFLOOR\s+PLAN\b", t["literal"], re.I) for t in texts)
    if strokes < 20:
        kind = "not_vector"
        reason = "insufficient_vector_linework; native reader does not OCR or infer rooms from raster images"
    elif pairs or plan_heading:
        kind, reason = "vector_plan", "vector strokes and stated dimension pairs or literal FLOOR PLAN heading"
    else:
        kind, reason = "vector_other", "vector content without room dimension pairs or floor-plan heading"
    return {"kind": kind, "reason": reason, "drawingPaths": len(drawings), "strokeItems": strokes,
            "nativeTextLines": len(texts), "dimensionPairLines": pairs, "images": len(page.get_images())}


def extract_linework(drawings, texts, params) -> tuple[list, list, dict]:
    walls, dimensions = [], []
    counts = Counter()
    layers = Counter()
    named = any(d.get("layer") in params["wallLayers"] for d in drawings)
    for path in drawings:
        layer = path.get("layer", "")
        layers[layer] += 1
        if "s" not in path["type"] or (path.get("stroke_opacity") or 0) <= 0:
            counts["no_visible_stroke"] += 1
            continue
        color = path.get("color")
        if color is None or min(color) > .95:
            counts["white_or_missing_stroke"] += 1
            continue
        is_dimension = bool(re.search(r"dim", layer, re.I))
        if is_dimension:
            dimensions.extend({"a": a, "b": b, "seqno": path["seqno"], "layer": layer}
                              for a, b in item_segments(path) if math.dist(a, b) > .01)
        if re.search(r"hatch|text|dim|grid|furn|tree|rein|ele[v ]|schedule|tag", layer, re.I):
            counts["annotation_hatch_or_nonplan_layer"] += 1
            continue
        if named and layer not in params["wallLayers"]:
            counts["not_in_architectural_layer_allowlist"] += 1
            continue
        if not named and (path["width"] < .3 or path.get("dashes") != "[] 0" or max(color) > .5):
            counts["fallback_thin_dashed_or_pale_stroke"] += 1
            continue
        retained = 0
        for a, b in item_segments(path):
            if math.dist(a, b) <= params["snapTolerancePdf"]:
                counts["short_segment"] += 1
                continue
            segment = LineString([a, b])
            # For layerless PDFs exclude strokes wholly in native text glyph boxes.
            if not named and any(box(*t["bbox"]).covers(segment) for t in texts):
                counts["stroke_inside_native_text_bbox"] += 1
                continue
            walls.append(segment)
            retained += 1
        counts["retained_paths" if retained else "no_retained_straight_segments"] += 1
        counts["excluded_curves"] += sum(i[0] == "c" for i in path["items"])
    return walls, dimensions, {"profile": "named_architectural_layers" if named else "conservative_layerless_strokes",
                               "wallLayers": params["wallLayers"] if named else [], "pathsByLayer": dict(layers),
                               "filters": dict(counts), "sourceSegments": len(walls),
                               "dimensionSegments": len(dimensions), "curvePolicy": params["curvePolicy"],
                               "gapPolicy": params["gapPolicy"]}


def room_regions(lines, regions, params):
    if not lines:
        return [], {"closedFaces": 0, "retainedFaces": 0, "gap": "no_wall_linework"}
    tolerance = params["snapTolerancePdf"]
    # Quantise a derivative only, then node/snap within tolerance and polygonize.
    network = unary_union([set_precision(line, tolerance) for line in lines])
    if network.is_empty:
        return [], {"closedFaces": 0, "retainedFaces": 0, "gap": "all_segments_collapsed_by_snap"}
    vertices = MultiPoint([xy for line in network.geoms for xy in line.coords]) if network.geom_type == "MultiLineString" else MultiPoint(list(network.coords))
    network = unary_union(snap(network, vertices, tolerance))
    faces, cuts, dangles, invalid = polygonize_full(network)
    retained, reasons = [], Counter()
    for poly in faces.geoms:
        x0, y0, x1, y1 = poly.bounds
        widths = [x1 - x0, y1 - y0]
        if not in_scope(poly.bounds, regions):
            reasons["outside_selected_scope"] += 1
        elif poly.area < params["minimumRegionAreaPdf2"] or min(widths) < params["minimumRegionWidthPdf"]:
            reasons["small_or_narrow_closed_face"] += 1
        elif max(widths) / min(widths) > params["maximumRegionAspect"]:
            reasons["sliver_aspect"] += 1
        elif not poly.is_valid:
            reasons["invalid_polygon"] += 1
        else:
            retained.append(orient(poly, sign=1))
    retained.sort(key=lambda g: (g.bounds[1], g.bounds[0], g.area))
    return retained, {"method": "precision_grid+shapely.snap+node+polygonize_full", "snapTolerancePdf": tolerance,
                      "maximumGridVertexDisplacementPdf": tolerance / math.sqrt(2),
                      "closedFaces": len(faces.geoms), "retainedFaces": len(retained), "omitted": dict(reasons),
                      "cutEdges": len(cuts.geoms), "dangles": len(dangles.geoms), "invalidRings": len(invalid.geoms)}


def derive_scale(texts, dimension_segments, params):
    """Associate literal dimensions to nearby tick-to-tick lines, never room areas.

    Use perpendicular extension/tick intersections rather than line overshoots.
    Geometric association happens BEFORE comparing scale ratios. Different
    printed panel scales cause abstention unless the caller selects one scope.
    """
    captions = [t["literal"] for t in texts if re.search(r"SCALE.*=", t["literal"], re.I)]
    scales = set(re.sub(r"\s", "", t).upper() for t in captions)
    base = {"method": "dimension_layer_tick_intersections+robust_consensus+least_squares_through_origin",
            "state": "unknown", "metresPerPdfPoint": None, "printedScaleLiterals": captions,
            "supports": [], "gap": "no_scale"}
    if len(scales) > 1:
        return {**base, "reason": "multiple_printed_panel_scales; select a single-scale region"}
    axes = []
    for s in dimension_segments:
        a, b = s["a"], s["b"]
        axis = 0 if abs(a[1] - b[1]) < .02 else 1 if abs(a[0] - b[0]) < .02 else None
        if axis is not None:
            axes.append({**s, "axis": axis, "low": min(a[axis], b[axis]), "high": max(a[axis], b[axis]),
                         "normal": (a[1 - axis] + b[1 - axis]) / 2})
    supports = []
    for t in texts:
        parsed = parse_length(t["literal"])
        if parsed["metres"] is None or parsed["metres"] < .4:
            continue
        axis = 0 if abs(t["direction"][0]) > .99 else 1 if abs(t["direction"][1]) > .99 else None
        if axis is None:
            continue
        cx, cy = (t["bbox"][0] + t["bbox"][2]) / 2, (t["bbox"][1] + t["bbox"][3]) / 2
        center, normal = [cx, cy][axis], [cx, cy][1 - axis]
        matches = []
        for line in axes:
            length = line["high"] - line["low"]
            if line["axis"] != axis or length < 15:
                continue
            offset = abs(line["normal"] - normal)
            midpoint_error = abs((line["low"] + line["high"]) / 2 - center)
            if offset > t["size"] * 1.8 or midpoint_error > max(t["size"], length * .04):
                continue
            ticks = [s for s in axes if s["axis"] != axis
                     and line["low"] < s["normal"] < line["high"]
                     and s["low"] - .25 <= line["normal"] <= s["high"] + .25]
            left = [s for s in ticks if s["normal"] - line["low"] < 4]
            right = [s for s in ticks if line["high"] - s["normal"] < 4]
            if not left or not right:
                continue
            lo = min(left, key=lambda s: abs(s["normal"] - line["low"]))
            hi = min(right, key=lambda s: abs(s["normal"] - line["high"]))
            drawn = hi["normal"] - lo["normal"]
            if drawn < 12:
                continue
            score = offset / t["size"] + midpoint_error / max(t["size"], length * .04)
            endpoints = [[lo["normal"], line["normal"]], [hi["normal"], line["normal"]]]
            if axis == 1:
                endpoints = [p[::-1] for p in endpoints]
            matches.append((score, {"literal": t["literal"], "bbox": t["bbox"], "axis": "x" if axis == 0 else "y",
                                    "statedMetres": parsed["metres"], "drawnPdfPoints": drawn,
                                    "ratio": parsed["metres"] / drawn, "endpointsPdf": endpoints,
                                    "drawingSeqnos": [line["seqno"], lo["seqno"], hi["seqno"]]}))
        matches.sort(key=lambda m: (m[0], m[1]["drawingSeqnos"]))
        if matches and (len(matches) == 1 or matches[1][0] - matches[0][0] > .15):
            supports.append(matches[0][1])
    base["supports"] = supports
    if len(supports) < params["minimumScaleSupports"]:
        return {**base, "reason": "insufficient_unambiguous_tick_to_tick_dimensions"}
    initial = median(s["ratio"] for s in supports)
    inliers = [s for s in supports if abs(s["ratio"] / initial - 1) <= params["scaleInlierRelativeTolerance"]]
    enough_axes = all(sum(s["axis"] == axis for s in inliers) >= 2 for axis in ["x", "y"])
    reliable = (len(inliers) >= params["minimumScaleSupports"] and enough_axes
                and len(inliers) / len(supports) >= params["minimumScaleInlierFraction"])
    scale = sum(s["statedMetres"] * s["drawnPdfPoints"] for s in inliers) / sum(s["drawnPdfPoints"] ** 2 for s in inliers) if inliers else initial
    for s in supports:
        s["inlier"] = s in inliers
        s["residualM"] = s["drawnPdfPoints"] * scale - s["statedMetres"]
        s["relativeResidual"] = s["residualM"] / s["statedMetres"]
    residuals = [s["relativeResidual"] for s in inliers]
    return {**base, "state": "candidate" if reliable else "unknown", "metresPerPdfPoint": scale if reliable else None,
            "gap": None if reliable else "no_scale", "reason": None if reliable else "insufficient_consensus_or_axis_support",
            "inlierCount": len(inliers), "supportCount": len(supports),
            "medianAbsoluteRelativeResidual": median(abs(r) for r in residuals) if residuals else None,
            "rmsResidualM": math.sqrt(sum(s["residualM"] ** 2 for s in inliers) / len(inliers)) if inliers else None,
            "inlierRelativeTolerance": params["scaleInlierRelativeTolerance"], "independentOfRoomDimensionPairs": True}


def label_line(t):
    s = t["literal"].strip()
    return bool(re.search(r"[A-Za-z]{3}", s) and not re.search(r"[=\d'\"#()]|PLAN|SCALE|SECTION|SCHEDULE|DETAIL", s, re.I))


def detect_panels(page, texts, regions):
    """Title/scale anchors delimit title-row bands; source walls refine the bbox.

    Column centre estimate = title's left + one third inter-title spacing. The
    boundaries are halfway to neighbouring caption centres, never room edges.
    All titles (including SITE PLAN) contribute separators; only FLOOR PLAN
    titles become panels. An explicit ROI can restrict which panels are read.
    """
    plans = [t for t in texts if re.fullmatch(r"(?:GROUND|FIRST|SECOND|TERRACE|BASEMENT|TYPICAL|\d+(?:ST|ND|RD|TH)) FLOOR PLAN", t["literal"].strip(), re.I)]
    panels = []
    for title in plans:
        if not in_scope(title["bbox"], regions):
            continue
        row = sorted([t for t in texts if abs(t["bbox"][1] - title["bbox"][1]) < title["size"]
                      and re.search(r"\bPLAN$", t["literal"].strip(), re.I)], key=lambda t: t["bbox"][0])
        position = next(i for i, t in enumerate(row) if t is title)
        spacings = [b["bbox"][0] - a["bbox"][0] for a, b in zip(row, row[1:]) if b["bbox"][0] - a["bbox"][0] > 30]
        spacing = median(spacings) if spacings else page.rect.width / 3
        centres = [t["bbox"][0] + spacing / 3 for t in row]
        left = (centres[position - 1] + centres[position]) / 2 if position else centres[position] - spacing / 2
        right = (centres[position] + centres[position + 1]) / 2 if position + 1 < len(row) else centres[position] + spacing / 2
        scales = [t for t in texts if re.match(r"SCALE\s", t["literal"], re.I)
                  and left <= t["bbox"][0] < right and 0 <= t["bbox"][1] - title["bbox"][3] <= title["size"] * 3]
        previous = [t["bbox"][3] for t in texts if re.match(r"SCALE\s", t["literal"], re.I)
                    and t["bbox"][3] < title["bbox"][1] - title["size"] * 5]
        row_counts = Counter(round(y / title["size"]) for y in previous)
        previous_rows = [y for y in previous if row_counts[round(y / title["size"])] >= 2]
        top = max(previous_rows) + title["size"] / 2 if previous_rows else 0
        bottom = max([title["bbox"][3], *(s["bbox"][3] for s in scales)]) + title["size"] / 2
        bbox = [max(0, left), top, min(page.rect.width, right), min(page.rect.height, bottom)]
        # A caller's ROI restricts, but does not manufacture, panel boundaries.
        if regions:
            overlaps = [box(*bbox).intersection(box(*r)) for r in regions if box(*bbox).intersects(box(*r))]
            if overlaps:
                bbox = list(unary_union(overlaps).bounds)
        panels.append({"panelId": f"p{page.number + 1}-panel-{position + 1}", "floorLabel": title["literal"],
                       "titleCitation": title, "scaleCitation": scales[0] if len(scales) == 1 else None,
                       "panelBboxPdf": bbox, "bboxMethod": "title_row_separators_and_previous_scale_row",
                       "state": "candidate", "limitations": ["title association is not reviewed level assignment"]})
    return panels


def stated_scale(literal):
    match = re.fullmatch(r"SCALE\s*([0-9./]+)\s*\"\s*=\s*(.+)", literal.strip(), re.I)
    if not match:
        return None
    paper = parse_length(match[1] + '"')
    real = parse_length(match[2])
    if paper["metres"] and real["metres"]:
        paper_inches = paper["metres"] / .0254
        return real["metres"] / (paper_inches * 72)
    return None


SPACE_WORDS = re.compile(r"\b(?:BEDROOM|TOILET|KITCHEN|DINING|LIVING|BALCONY|DRESSER|STAIRCASE|TERRACE|SHAFT|LAWN|LOBBY|HALL|STUDY|BATHROOM|STORE|UTILITY)\b", re.I)


def group_room_labels(texts):
    groups = []
    for name in texts:
        if not label_line(name):
            continue
        x0, y0, x1, y1 = name["bbox"]
        below = [t for t in texts if parse_dimensions(t["literal"]) is not None
                 and 0 <= t["bbox"][1] - y1 <= name["size"] * 2
                 and abs(t["bbox"][0] - x0) <= name["size"] * 2
                 and abs(t["direction"][0] - name["direction"][0]) < .01]
        below.sort(key=lambda t: (t["bbox"][1] - y1, abs(t["bbox"][0] - x0)))
        if not SPACE_WORDS.search(name["literal"]) and not below:
            continue
        dim = below[0] if below else None
        groups.append({"name": name, "dimensionLine": dim,
                       "statedDimensions": {**parse_dimensions(dim["literal"]), "bbox": dim["bbox"]} if dim else None,
                       "anchorPdf": [(x0 + x1) / 2, (y0 + y1) / 2],
                       "anchorMethod": "centre_of_name_line_bbox; dimension_line_directly_below",
                       "dimensionGroupingIssue": "ambiguous_dimension_lines" if len(below) > 1 else None})
    return groups


def mask_regions(drawings, panel, factor, params, groups):
    """Vector wall mask: supported paired strips, solid quads, logged bridges.

    Hatch work votes for physical strips, but never becomes a room edge. Door
    leaves, furniture, stair treads and dimensions are excluded. Source slab/
    railing contours can close an outdoor terrace; outside setback faces are
    not promoted to rooms. Neither labels nor dimension products set a wall.
    """
    paths = [d for d in drawings if in_scope(list(d["rect"]), [panel["panelBboxPdf"]])]
    hatch = [LineString([a, b]) for d in paths if re.fullmatch(r"A- wall hatch", d.get("layer", ""), re.I)
             for a, b in item_segments(d) if math.dist(a, b) > .1]
    if not hatch or factor is None:
        return [], None, {"gap": "no_scale" if factor is None else "no_hatch_supported_wall_mask", "bridges": []}
    tolerance = params["snapTolerancePdf"]
    extent = unary_union(hatch).envelope
    tree = STRtree(hatch)
    wall_parts, strips, axes, slab_axes, contours, refs, outlines = [], [], [], [], [], set(), []
    rejected = Counter()
    for d in paths:
        layer = d.get("layer", "")
        if layer == "A- floor slab":
            # Source slab/railing edge contours, not staircase-layer treads.
            for a, b in item_segments(d):
                if math.dist(a, b) <= tolerance:
                    continue
                contours.append(LineString([a, b]))
                axis = 0 if abs(a[1] - b[1]) < .02 else 1 if abs(a[0] - b[0]) < .02 else None
                if axis is not None:
                    slab_axes.append((axis, round(a[1 - axis] / tolerance) * tolerance, min(a[axis], b[axis]), max(a[axis], b[axis]), d["seqno"]))
            refs.add(d["seqno"])
            continue
        if not in_scope(list(d["rect"]), [list(extent.buffer(params["maximumWallThicknessM"] / factor, join_style=2).bounds)]):
            rejected["outside_hatch_building_band"] += 1
            continue
        if layer == "A- built":
            segments = list(item_segments(d))
            if len(segments) >= 3 and all(math.dist(b, c) < tolerance for (_, b), (c, _) in zip(segments, segments[1:])) and math.dist(segments[0][0], segments[-1][1]) < tolerance:
                g = Polygon([segments[0][0]] + [b for a, b in segments])
                if g.is_valid and g.area * factor ** 2 > 10:
                    outlines.append(g)
            for a, b in segments:
                line = LineString([a, b])
                if line.length <= tolerance:
                    continue
                contours.append(line)
                axis = 0 if abs(a[1] - b[1]) < .02 else 1 if abs(a[0] - b[0]) < .02 else None
                if axis is not None:
                    axes.append((axis, round(a[1 - axis] / tolerance) * tolerance,
                                 min(a[axis], b[axis]), max(a[axis], b[axis]), d["seqno"]))
                refs.add(d["seqno"])
        elif layer in {"A- Columns", "A- windows"} and d.get("color") and max(d["color"]) < .95:
            for item in d["items"]:
                if item[0] != "qu":
                    rejected["door_leaf_curve_or_nonquad"] += 1
                    continue
                q = item[1]
                g = Polygon([tuple(q.ul), tuple(q.ur), tuple(q.lr), tuple(q.ll)])
                if params["minimumWallThicknessM"] <= min(g.bounds[2] - g.bounds[0], g.bounds[3] - g.bounds[1]) * factor <= params["maximumWallThicknessM"]:
                    wall_parts.append(g)
                    refs.add(d["seqno"])
                else:
                    rejected["nonwall_thickness_door_leaf_mullion_or_roof_panel"] += 1
        else:
            rejected["nonarchitectural_or_hatch_support_only"] += 1
    architectural_axis_count = len(axes)
    axes.extend(slab_axes)
    for i, a in enumerate(axes):
        for j, b in enumerate(axes[i + 1:], start=i + 1):
            if a[0] != b[0] or not params["minimumWallThicknessM"] <= abs(a[1] - b[1]) * factor <= params["maximumWallThicknessM"]:
                continue
            lo, hi = max(a[2], b[2]), min(a[3], b[3])
            if hi - lo < 2:
                continue
            normals = sorted([a[1], b[1]])
            g = box(lo, normals[0], hi, normals[1]) if a[0] == 0 else box(normals[0], lo, normals[1], hi)
            if len(tree.query(g, predicate="intersects")) or (i >= architectural_axis_count and j >= architectural_axis_count):
                strips.append({"polygon": g, "axis": a[0], "sourceSeqnos": sorted(set([a[4], b[4]]))})
    unique = {}
    for strip in strips:
        key = tuple(round(v / tolerance) for v in strip["polygon"].bounds)
        unique.setdefault(key, strip)
    strips = list(unique.values())
    wall_parts.extend(s["polygon"] for s in strips)
    bridge_options = {}
    # A paired wall strip may end at a perpendicular existing wall/column.
    # Completing its axis to that physical junction is also a collinear gap.
    for source in strips:
        a = source["polygon"]
        x0, y0, x1, y1 = a.bounds
        axis = source["axis"]
        nlo, nhi = (y0, y1) if axis == 0 else (x0, x1)
        alo, ahi = (x0, x1) if axis == 0 else (y0, y1)
        for target in strips:
            u0, v0, u1, v1 = target["polygon"].bounds
            bnlo, bnhi = (v0, v1) if axis == 0 else (u0, u1)
            blo, bhi = (u0, u1) if axis == 0 else (v0, v1)
            overlap_lo, overlap_hi = max(nlo, bnlo), min(nhi, bnhi)
            if (overlap_hi - overlap_lo) * factor < params["minimumWallThicknessM"]:
                continue
            lo, hi = (ahi, blo) if ahi < blo else (bhi, alo)
            width = (hi - lo) * factor
            if not tolerance * factor < width <= params["maximumOpeningWidthM"]:
                continue
            g = box(lo, overlap_lo, hi, overlap_hi) if axis == 0 else box(overlap_lo, lo, overlap_hi, hi)
            # Union with the existing mask: intersections at a junction are
            # physical wall, not a reason to discard the opening completion.
            key = tuple(round(v / tolerance) for v in g.bounds)
            bridge_options.setdefault(key, {"polygon": g, "widthM": width, "axis": axis,
                                           "sourceSeqnos": sorted(set(source["sourceSeqnos"] + target["sourceSeqnos"])),
                                           "method": "extend_paired_wall_ends_to_existing_collinear_wall_or_junction", "state": "candidate"})
    bridges = list(bridge_options.values())
    mask = unary_union([set_precision(g, tolerance) for g in [*wall_parts, *(b["polygon"] for b in bridges),
                         *(set_precision(line, tolerance).buffer(tolerance, cap_style=2, join_style=2) for line in contours)]]).buffer(params["wallSeamBufferPdf"], join_style=2)
    pieces = list(mask.geoms) if mask.geom_type == "MultiPolygon" else [mask]
    if not pieces:
        return [], None, {"gap": "no_closed_building_barrier", "bridges": []}
    if outlines:
        outline = set_precision(max(outlines, key=lambda g: g.area), tolerance)
        outline_method = "closed_source_A-built_outer_trace"
    else:
        main = max(pieces, key=lambda g: Polygon(g.exterior).area)
        shell = Polygon(main.exterior)
        free = shell.difference(mask)
        faces = list(free.geoms) if free.geom_type == "MultiPolygon" else [free]
        # Slab contours also delineate exterior setbacks. Only source-wall-band
        # faces or faces with a literal named-space anchor establish this panel's
        # outline. This selects source faces, never fabricates a text rectangle.
        exterior_faces = [g for g in faces if g.area > 0 and
                          g.intersection(extent).area / g.area < params["minimumUnlabelledFaceInsideWallBandFraction"] and
                          not any(g.covers(Point(*group["anchorPdf"])) for group in groups)]
        faces = [g for g in faces if g.area > 0 and g not in exterior_faces]
        building = unary_union([mask.intersection(extent.buffer(tolerance)), *faces])
        parts = list(building.geoms) if building.geom_type == "MultiPolygon" else [building]
        outline = Polygon(max(parts, key=lambda g: Polygon(g.exterior).area).exterior)
        outline_method = "source_barrier_shell_excluding_unlabelled_exterior_setback_faces"
    free = outline.difference(mask)
    faces = list(free.geoms) if free.geom_type == "MultiPolygon" else [free]
    rooms, omissions = [], Counter()
    if not outlines:
        omissions["unlabelled_exterior_setback_faces"] = len(exterior_faces)
    for face in faces:
        if face.area * factor ** 2 < params["minimumRoomAreaM2"]:
            omissions["below_minimum_room_area"] += 1
        elif not face.is_valid:
            omissions["invalid_face"] += 1
        else:
            rooms.append(orient(face.simplify(tolerance / 2, preserve_topology=True), sign=1))
    rooms.sort(key=lambda g: (g.bounds[1], g.bounds[0]))
    return rooms, outline, {"method": params["wallMaskProfile"], "minimumRoomAreaM2": params["minimumRoomAreaM2"],
                           "minimumUnlabelledFaceInsideWallBandFraction": params["minimumUnlabelledFaceInsideWallBandFraction"],
                           "maximumOpeningWidthM": params["maximumOpeningWidthM"], "snapTolerancePdf": tolerance,
                           "seamBufferPdf": params["wallSeamBufferPdf"], "hatchSupportSegments": len(hatch),
                           "pairedWallStrips": len(strips), "wallAreaM2": mask.intersection(outline).area * factor ** 2,
                           "sourceDrawingSeqnos": sorted(refs), "filters": dict(rejected), "omittedFaces": dict(omissions),
                           "barrierComponents": [{"bbox": list(g.bounds), "shellAreaPdf2": Polygon(g.exterior).area, "holeBboxes": [list(Polygon(h).bounds) for h in g.interiors]} for g in pieces],
                           "outlineMethod": outline_method, "buildingOutlinePdf": geometry_json(outline),
                           "wallMaskPdf": json.loads(json.dumps(mapping(mask.intersection(outline)))),
                           "maskAnchorDiagnostics": [{"literal": group["name"]["literal"], "anchorOnWallMask": mask.covers(Point(*group["anchorPdf"]))} for group in groups],
                           "bridges": [{**{k: v for k, v in b.items() if k != "polygon"}, "polygonPdf": geometry_json(b["polygon"])} for b in bridges]}


def geometry_json(poly):
    return json.loads(json.dumps(mapping(orient(poly, sign=1))))


def consistency(poly, dims, scale, tolerance):
    if scale is None:
        return {"status": "unknown", "reason": "no_scale", "differenceM2": None}
    if len(dims) != 1:
        return {"status": "unknown", "reason": "no_stated_dimensions" if not dims else "multiple_dimension_labels", "differenceM2": None}
    if not dims[0]["parsed"]:
        return {"status": "unknown", "reason": "ambiguous_stated_dimensions", "differenceM2": None}
    expected = dims[0]["dimensionProductM2"]
    area = poly.area * scale ** 2
    bbox_lengths = sorted([(poly.bounds[2] - poly.bounds[0]) * scale, (poly.bounds[3] - poly.bounds[1]) * scale])
    stated = sorted(d["metres"] for d in dims[0]["dimensions"])
    axis_errors = [a - b for a, b in zip(bbox_lengths, stated)]
    relative = (area - expected) / expected
    # A source door leaf / jamb can extend the bbox without changing usable
    # face area materially. Do not silently assume a rectangular room boundary.
    ok = abs(relative) <= tolerance
    bbox_ok = all(abs(a / b) <= tolerance for a, b in zip(axis_errors, stated))
    return {"status": "ok" if ok else "mismatch", "comparedQuantity": "area_vs_stated_length_product",
            "bboxDiagnosticStatus": "ok" if bbox_ok else "mismatch", "differenceM2": area - expected,
            "relativeAreaDifference": relative, "dimensionProductM2": expected, "drawnAreaM2": area,
            "drawnBboxLengthsM": bbox_lengths, "statedLengthsM": stated, "axisDifferencesM": axis_errors,
            "relativeTolerance": tolerance, "method": "polygon_area_vs_stated_length_product; separate_axis_bbox_diagnostic",
            "limitation": "length product assumes a rectangle; bbox includes door leaves/jambs and is diagnostic only"}


def read_page(page, source_manifest, parameter_hash, params, regions=None):
    start = time.perf_counter()
    regions = regions or []
    drawings, all_text = page.get_drawings(), text_lines(page)
    selected_text = [t for t in all_text if in_scope(t["bbox"], regions)]
    classification = classify(drawings, all_text, page)
    candidates, panels, audit, assigned = [], [], [], set()
    linework = {}
    scale = {"state": "unknown", "metresPerPdfPoint": None, "method": None, "gap": "no_scale", "supports": []}
    if classification["kind"] == "vector_plan":
        _, dimension_segments, linework = extract_linework(drawings, all_text, params)
        panels = detect_panels(page, all_text, regions)
        if params.get("panelTitleSelection"):
            panels = [p for p in panels if p["floorLabel"] in params["panelTitleSelection"]]
        if panels:
            selected_text = [t for t in selected_text if in_scope(t["bbox"], [p["panelBboxPdf"] for p in panels])]
        scale = derive_scale(selected_text, dimension_segments, params)
    for panel in panels:
        texts = [t for t in selected_text if in_scope(t["bbox"], [panel["panelBboxPdf"]])]
        panel["scale"] = derive_scale(texts, dimension_segments, params)
        factor = panel["scale"]["metresPerPdfPoint"]
        theoretical = stated_scale(panel["scaleCitation"]["literal"]) if panel["scaleCitation"] else None
        difference = factor / theoretical - 1 if factor and theoretical else None
        panel["scale"]["statedScaleCrossCheck"] = {"literal": panel["scaleCitation"]["literal"] if panel["scaleCitation"] else None,
                "theoreticalMetresPerPdfPoint": theoretical, "fittedMetresPerPdfPoint": factor,
                "relativeDifference": difference, "relativeTolerance": params["panelScaleAgreementTolerance"],
                "status": "ok" if difference is not None and abs(difference) <= params["panelScaleAgreementTolerance"] else "mismatch" if difference is not None else "unknown"}
        if difference is not None and abs(difference) > params["panelScaleAgreementTolerance"]:
            panel["scale"]["metresPerPdfPoint"] = factor = None
            panel["scale"]["gap"] = "no_scale"
            panel["scale"]["reason"] = "panel_scale_literal_disagrees_with_dimension_fit"
        groups = group_room_labels(texts)
        polys, outline, topology = mask_regions(drawings, panel, factor, params, groups)
        panel["topology"] = topology
        origin = [outline.bounds[0], outline.bounds[3]] if outline is not None else None
        panel["originPdf"] = origin
        panel["originMethod"] = "building_outline_bbox_lower_left; panel_local_not_georeferenced"
        by_face = [[] for _ in polys]
        for group in groups:
            hits = [i for i, poly in enumerate(polys) if poly.covers(Point(*group["anchorPdf"]))]
            item = {"panelId": panel["panelId"], "floorLabel": panel["floorLabel"], **group,
                    "candidateRef": None, "status": "unattached", "reason": None}
            if len(hits) == 1:
                by_face[hits[0]].append(item)
                item["status"] = "attached"
            else:
                item["reason"] = "ambiguous_multiple_regions" if hits else "no_scale_or_wall_mask" if outline is None else "anchor_outside_building_outline" if not outline.covers(Point(*group["anchorPdf"])) else "anchor_on_wall_or_dropped_face"
            audit.append(item)
        for poly, attached in zip(polys, by_face):
            index = len(candidates)
            output_ref = f"candidates.json#/pages/{page.number + 1}/candidates/{index}"
            for item in attached:
                item["candidateRef"] = output_ref
            labels = [g["name"] for g in attached]
            dims = [g["statedDimensions"] for g in attached if g["statedDimensions"] is not None]
            text_refs = [t for g in attached for t in [g["name"], g["dimensionLine"]] if t is not None]
            assigned.update((t["locator"]["block"], t["locator"]["line"]) for t in text_refs)
            check = consistency(poly, dims, factor, params["consistencyRelativeTolerance"])
            bbox = list(poly.bounds)
            source_part = {"sourceSha256": source_manifest["sha256"], "page": page.number + 1, "bbox": bbox,
                           "coordinateConvention": "unrotated_mupdf_points_top_left_x_right_y_down"}
            metric = affinity.scale(affinity.translate(poly, xoff=-origin[0], yoff=-origin[1]), xfact=factor, yfact=-factor, origin=(0, 0)) if factor else None
            payload = {"floorLabel": panel["floorLabel"], "panelId": panel["panelId"],
                       "polygonPdf": geometry_json(poly), "polygonMetres": geometry_json(metric) if metric is not None else None,
                       "metricFrame": {"kind": "panel_local", "originPdf": origin, "axes": ["page_right", "page_up"],
                                       "unit": "m", "metresPerPdfPoint": factor, "georeferenced": False} if factor else None,
                       "label": labels[0]["literal"] if len(labels) == 1 else "unknown",
                       "labelLiterals": [{"literal": t["literal"], "bbox": t["bbox"]} for t in labels],
                       "labelState": "candidate" if len(labels) == 1 else "unknown", "statedDimensions": dims,
                       "labelGroups": [{k: v for k, v in g.items() if k not in {"candidateRef", "status", "reason", "floorLabel", "panelId"}} for g in attached],
                       "issue": "merged_region" if len(labels) > 1 else "unlabelled_region" if not labels else None,
                       "computedArea": {"value": poly.area * factor ** 2 if factor else poly.area, "unit": "m2" if factor else "pdf_point2", "state": "candidate", "method": METHOD},
                       "areaPdfPoint2": poly.area, "textLines": text_refs, "consistency": check, "citation": source_part,
                       "gaps": (["no_scale"] if factor is None else []) + (["merged_region"] if len(labels) > 1 else ["unlabelled_region"] if not labels else [])}
            candidates.append({"task": "plan_rooms", "taskVersion": "2", "sourceParts": [source_part],
                "inputManifest": source_manifest, "methodNameAndVersion": METHOD, "method": METHOD,
                "parameterHash": parameter_hash, "outputRef": output_ref, "floorLabel": panel["floorLabel"], "panelId": panel["panelId"],
                "confidenceOrError": {"confidence": None, "error": check, "calibrated": False},
                "coverage": {"page": page.number + 1, "bbox": bbox, "kind": "building_interior_minus_wall_mask"},
                "limitations": list(LIMITATIONS), "state": "candidate", "issue": payload["issue"], "output": payload})
        panel_candidates = [c for c in candidates if c["panelId"] == panel["panelId"]]
        panel["summary"] = summarize(panel_candidates, [a for a in audit if a["panelId"] == panel["panelId"]])
    unattached = [{**t, "parsedDimensions": parse_dimensions(t["literal"]), "reason": "not_part_of_attached_room_label_group"}
                  for t in selected_text if (t["locator"]["block"], t["locator"]["line"]) not in assigned]
    summary = summarize(candidates, audit)
    summary["unattachedTextLines"] = len(unattached)
    note = [t for t in all_text if "NOT SCALE" in t["literal"].upper()]
    return {"page": page.number + 1, "pageSizePdf": [page.rect.width, page.rect.height], "rotation": page.rotation,
            "classification": classification, "scopePdfBboxes": regions or [p["panelBboxPdf"] for p in panels], "linework": linework,
            "scale": scale, "panels": panels, "labelAudit": audit, "candidates": candidates, "unattachedText": unattached,
            "sourceMeasurementRestrictions": [{"literal": t["literal"], "bbox": t["bbox"]} for t in note],
            "gaps": ([classification["kind"]] if classification["kind"] != "vector_plan" else ["no_detected_floor_panels"] if not panels else ["no_scale"] if all(p["scale"]["metresPerPdfPoint"] is None for p in panels) else []),
            "summary": summary, "runtimeSeconds": time.perf_counter() - start}


def summarize(candidates, audit):
    parsed = [c for c in candidates if any(d["parsed"] for d in c["output"]["statedDimensions"])]
    ok = sum(c["output"]["consistency"]["status"] == "ok" for c in parsed)
    dimension_groups = [a for a in audit if a["statedDimensions"] is not None]
    valid_groups = [a for a in dimension_groups if a["statedDimensions"]["parsed"]]
    return {"roomsFound": len(candidates), "roomsWithParsedLabel": sum(c["output"]["labelState"] == "candidate" for c in candidates),
            "roomsWithStatedDims": len(parsed), "consistency": dict(Counter(c["output"]["consistency"]["status"] for c in candidates)),
            "roomNameLiterals": len(audit), "attachedRoomNames": sum(a["status"] == "attached" for a in audit),
            "unattachedRoomNames": sum(a["status"] != "attached" for a in audit),
            "allRoomNamesAccountedFor": all((a["status"] == "attached" and a["candidateRef"] is not None) or (a["status"] == "unattached" and a["reason"] is not None) for a in audit),
            "roomsWithAnyStatedDimLiteral": len(dimension_groups), "roomNamesWithParsedDimensions": len(valid_groups),
            "attachedParsedDimensionGroups": sum(a["status"] == "attached" for a in valid_groups),
            "consistencyOkNumerator": ok, "consistencyParsedRoomDenominator": len(valid_groups),
            "consistencyOkFraction": ok / len(valid_groups) if valid_groups else None,
            "consistencyAllDimLiteralDenominator": len(dimension_groups),
            "consistencyOkFractionAllDimLiterals": ok / len(dimension_groups) if dimension_groups else None}


def render_overlay(page, result, output_path, max_side=1600):
    # Non-plan pages have no polygons to inspect: retain a small diagnostic
    # thumbnail rather than a near-full-size copy of a scanned original.
    if result["classification"]["kind"] != "vector_plan":
        max_side = min(max_side, 640)
    scope = result["scopePdfBboxes"]
    clip = fitz.Rect(scope[0]) if scope else page.rect
    for r in scope[1:]:
        clip |= fitz.Rect(r)
    zoom = min(2.0, max_side / max(clip.width, clip.height))
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip, alpha=False, colorspace=fitz.csRGB)
    image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=12)

    def point(xy):
        p = fitz.Point(*xy) * page.rotation_matrix
        return p.x * zoom - pix.x, p.y * zoom - pix.y

    for i, candidate in enumerate(result["candidates"]):
        value = candidate["output"]
        status = value["consistency"]["status"]
        color = {"ok": "#137a46", "mismatch": "#d43b20", "unknown": "#707b8a"}[status]
        for ring in value["polygonPdf"]["coordinates"]:
            draw.line([point(p) for p in ring], fill=color, width=2)
        centroid = shapely.geometry.shape(value["polygonPdf"]).representative_point()
        x, y = point([centroid.x, centroid.y])
        label = f"{i + 1}: {value['label']}" if value.get("issue") != "merged_region" else f"{i + 1}: MERGED " + " / ".join(t["literal"] for t in value["labelLiterals"])
        draw.text((x, y), label, fill=color, font=font, stroke_width=1, stroke_fill="white")
    for panel in result.get("panels", []):
        px, py = point(panel["titleCitation"]["bbox"][:2])
        draw.text((px, py - 18), f"{panel['panelId']} | {panel['floorLabel']}", fill="#2155a3", font=font, stroke_width=1, stroke_fill="white")
        if panel.get("originPdf"):
            ox, oy = point(panel["originPdf"])
            draw.ellipse((ox - 3, oy - 3, ox + 3, oy + 3), fill="#2155a3")
            draw.text((ox + 4, oy + 2), "panel origin", fill="#2155a3", font=font, stroke_width=1, stroke_fill="white")
    for group in result.get("labelAudit", []):
        if group["status"] != "attached":
            gx, gy = point(group["anchorPdf"])
            draw.text((gx, gy - 16), "UNATTACHED: " + group["name"]["literal"], fill="#ac2879", font=font, stroke_width=1, stroke_fill="white")
    title = f"page {result['page']} | {result['classification']['kind']} | CANDIDATES (not reviewed)"
    draw.rectangle((0, 0, min(image.width, 650), 20), fill="white")
    draw.text((4, 3), title, fill="black", font=font)
    image.save(output_path, optimize=True)
    return {"file": Path(output_path).name, "size": [pix.width, pix.height], "clipPdf": list(clip),
            "nonplanThumbnail": result["classification"]["kind"] != "vector_plan", "bytes": Path(output_path).stat().st_size}
