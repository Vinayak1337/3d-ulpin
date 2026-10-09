"""Offline, deterministic vector-plan candidates; no registry or model calls.

PDF coordinates are unrotated MuPDF points (x right, y down). A snapped
polygon is a derivative, not surveyed geometry. Door gaps are NOT invented:
open/connected spaces may remain merged or unlabelled and require review.
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
from shapely.geometry import LineString, MultiPoint, Point, box, mapping
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
    "gapPolicy": "no doorway completion or dimension-derived rectangles",
}
LIMITATIONS = [
    "All regions are candidates, including unlabelled closed faces; not a reviewed room inventory.",
    "Connected door openings are not closed by inference; multiple labels can belong to one face.",
    "No level/unit/building association, rights, surveyed CRS, vertical reference or ownership is established.",
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
    return not regions or any(box(*r).covers(box(*bbox)) for r in regions)


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
    candidates, polygons, assigned = [], [], set()
    linework, topology = {}, {}
    scale = {"state": "unknown", "metresPerPdfPoint": None, "method": None, "gap": "no_scale", "supports": []}
    if classification["kind"] == "vector_plan":
        lines, dimension_segments, linework = extract_linework(drawings, all_text, params)
        polygons, topology = room_regions(lines, regions, params)
        scale = derive_scale(selected_text, dimension_segments, params)
    scale["scopePdfBboxes"] = regions or [list(page.rect)]
    factor = scale["metresPerPdfPoint"]
    for index, poly in enumerate(polygons):
        texts = []
        for ti, t in enumerate(selected_text):
            if poly.covers(box(*t["bbox"])):
                texts.append(t)
                assigned.add(ti)
        labels = [t for t in texts if label_line(t)]
        dims = [{**parsed, "bbox": t["bbox"]} for t in texts if (parsed := parse_dimensions(t["literal"]))]
        limits = list(LIMITATIONS)
        if len(labels) > 1:
            limits.append("multiple_label_lines: no single room label is asserted")
        if not factor:
            limits.append("no_scale")
        check = consistency(poly, dims, factor, params["consistencyRelativeTolerance"])
        bbox = list(poly.bounds)
        source_part = {"sourceSha256": source_manifest["sha256"], "page": page.number + 1, "bbox": bbox,
                       "coordinateConvention": "unrotated_mupdf_points_top_left_x_right_y_down"}
        payload = {
            "polygonPdf": geometry_json(poly), "polygonMetres": geometry_json(affinity.scale(poly, xfact=factor, yfact=-factor, origin=(0, 0))) if factor else None,
            "metricFrame": {"kind": "page_local", "originPdf": [0, 0], "axes": ["page_right", "page_up"], "unit": "m", "georeferenced": False} if factor else None,
            "label": labels[0]["literal"] if len(labels) == 1 else "unknown", "labelLiterals": [{"literal": t["literal"], "bbox": t["bbox"]} for t in labels],
            "labelState": "candidate" if len(labels) == 1 else "unknown", "statedDimensions": dims,
            "computedArea": {"value": poly.area * factor ** 2 if factor else poly.area, "unit": "m2" if factor else "pdf_point2", "state": "candidate", "method": METHOD},
            "areaPdfPoint2": poly.area, "textLines": texts, "consistency": check, "citation": source_part,
            "gaps": (["no_scale"] if factor is None else []) + (["unlabelled_region"] if not labels else ["multiple_label_lines"] if len(labels) > 1 else []),
        }
        candidates.append({"task": "plan_rooms", "taskVersion": "1", "sourceParts": [source_part],
                           "inputManifest": source_manifest, "methodNameAndVersion": METHOD, "method": METHOD,
                           "parameterHash": parameter_hash, "outputRef": f"candidates.json#/pages/{page.number + 1}/candidates/{index}",
                           "confidenceOrError": {"confidence": None, "error": check, "calibrated": False},
                           "coverage": {"page": page.number + 1, "bbox": bbox, "kind": "closed_source_linework_face"},
                           "limitations": limits, "state": "candidate", "output": payload})
    unattached = [{**t, "parsedDimensions": parse_dimensions(t["literal"]),
                   "reason": "not_fully_inside_a_retained_region"} for ti, t in enumerate(selected_text) if ti not in assigned]
    summary = {"roomsFound": len(candidates), "roomsWithParsedLabel": sum(c["output"]["labelState"] == "candidate" for c in candidates),
               "roomsWithStatedDims": sum(any(d["parsed"] for d in c["output"]["statedDimensions"]) for c in candidates),
               "consistency": dict(Counter(c["output"]["consistency"]["status"] for c in candidates)), "unattachedTextLines": len(unattached)}
    note = [t for t in all_text if "NOT SCALE" in t["literal"].upper()]
    return {"page": page.number + 1, "pageSizePdf": [page.rect.width, page.rect.height], "rotation": page.rotation,
            "classification": classification, "scopePdfBboxes": regions, "linework": linework, "topology": topology,
            "scale": scale, "candidates": candidates, "unattachedText": unattached,
            "outsideScopeText": [{"bbox": t["bbox"], "reason": "outside_selected_scope; literal_not_exported"} for t in all_text if not in_scope(t["bbox"], regions)],
            "sourceMeasurementRestrictions": [{"literal": t["literal"], "bbox": t["bbox"]} for t in note],
            "gaps": ([classification["kind"]] if classification["kind"] != "vector_plan" else []) + (["no_scale"] if factor is None else []),
            "summary": summary, "runtimeSeconds": time.perf_counter() - start}


def render_overlay(page, result, output_path, max_side=1600):
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
        label = f"{i + 1}: {value['label']}"
        draw.text((x, y), label, fill=color, font=font, stroke_width=1, stroke_fill="white")
    title = f"page {result['page']} | {result['classification']['kind']} | CANDIDATES (not reviewed)"
    draw.rectangle((0, 0, min(image.width, 650), 20), fill="white")
    draw.text((4, 3), title, fill="black", font=font)
    image.save(output_path, optimize=True)
    return {"file": Path(output_path).name, "size": [pix.width, pix.height], "clipPdf": list(clip), "bytes": Path(output_path).stat().st_size}
