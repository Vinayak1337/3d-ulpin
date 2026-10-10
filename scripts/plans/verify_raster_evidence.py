"""Read-only artifact, citation and scoring checks; no inference or registry authority."""
from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image
from shapely.geometry import box, shape

from evaluate_cubicasa_test import class_confusion, class_metrics
from raster_common import pin


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def verify_pin(receipt: dict[str, Any]) -> None:
    actual = pin(Path(receipt["path"]))
    if actual["sha256"] != receipt["sha256"] or actual["bytes"] != receipt["bytes"]:
        raise ValueError("artifact_pin_mismatch")


def verify_room(room: dict[str, Any], source: dict[str, Any], render_scale: float) -> None:
    if room["state"] != "candidate" or room["scoresCalibrated"] or not 0 <= room["confidence"] <= 1:
        raise ValueError("candidate_confidence_contract")
    if room["level"] != {"value": None, "state": "unknown"} or room["metric"] is not None:
        raise ValueError("unresolved_level_or_metric_authority")
    polygon = shape(room["geometryPagePixels"])
    if not polygon.is_valid or polygon.is_empty or polygon.geom_type not in {"Polygon", "MultiPolygon"}:
        raise ValueError("invalid_room_polygon")
    citation = room["citations"][0]
    if citation["sourceId"] != source["sourceId"] or citation["sourceSha256"] != source["sourceSha256"]:
        raise ValueError("room_source_citation_mismatch")
    locator = citation["locator"]
    bounds = [coordinate / render_scale for coordinate in polygon.bounds]
    actual = [locator["x"], locator["y"], locator["x"] + locator["width"], locator["y"] + locator["height"]]
    if not np.allclose(bounds, actual, atol=1e-7, rtol=0):
        raise ValueError("room_bbox_affine_mismatch")
    for label in room["containedOcrLiterals"]:
        if not polygon.covers(box(*[coordinate * render_scale for coordinate in label["bboxPt"]])):
            raise ValueError("label_not_contained")


def verify_ocr_tiles(full: dict[str, Any]) -> None:
    panels = full.get("ocrLineage", {}).get("sourcePanels", [])
    for panel in panels:
        verify_pin(panel)
        directory = Path(panel["path"]).parent
        for tile in directory.glob("tile-*/ocr.json"):
            receipt = load(tile)
            frame = receipt["frame"]
            selected = frame["requestedRegion"]
            if max(selected[2] - selected[0], selected[3] - selected[1]) > 2000:
                raise ValueError("ocr_selection_over_bound")
            if pin(tile.parent / "render.png")["sha256"] != frame["render"]["pngSha256"]:
                raise ValueError("ocr_render_pin_mismatch")
            for key in ("runnerReceipt", "runnerResult", "runnerLog"):
                if key in receipt:
                    verify_pin(receipt[key])


def verify_panel(receipt: dict[str, Any]) -> dict[str, Any]:
    verify_pin(receipt["output"])
    verify_pin(receipt["fullPrecision"])
    verify_pin(receipt["overlay"])
    compact = load(Path(receipt["output"]["path"]))
    full = load(Path(receipt["fullPrecision"]["path"]))
    if full["scale"]["state"] != "no_scale" or full["scale"]["metresPerPoint"] is not None:
        raise ValueError("unexpected_tower3_scale_claim")
    if len(full["rooms"]) != len(compact["candidates"]) or compact["candidates"] != full["candidates"]:
        raise ValueError("candidate_reference_count_mismatch")
    for index, room in enumerate(full["rooms"]):
        verify_room(room, full["sourceCitation"], full["transform"]["pdfRenderScale"])
        if compact["rooms"][index]["method"] != room["method"]:
            raise ValueError("compact_candidate_method_mismatch")
    for artifact in receipt["artifacts"].values():
        verify_pin(artifact)
    verify_ocr_tiles(full)
    if "inferenceLineage" in full:
        verify_pin(full["inferenceLineage"]["sourcePanel"])
        original = load(Path(full["inferenceLineage"]["sourcePanel"]["path"]))
        if [room["geometryPagePixels"] for room in original["rooms"]] != [
                room["geometryPagePixels"] for room in full["rooms"]]:
            raise ValueError("replayed_geometry_changed")
    return {"panel": full["panel"], "rooms": len(full["rooms"]), "ocrObservations": len(full["ocrObservations"]),
            "disagreements": len(full["disagreements"]), "scale": "no_scale"}


def verify_evaluation(path: Path) -> dict[str, Any]:
    result = load(path)
    verify_pin(result["receipt"]["fullPrecision"])
    verify_pin(result["receipt"]["selection"])
    verify_pin(result["receipt"]["sourceManifest"])
    manifest = load(Path(result["receipt"]["sourceManifest"]["path"]))
    selection = load(Path(result["receipt"]["selection"]["path"]))
    if result["plans"] < 100 or [plan["id"] for plan in result["perPlan"]] != selection["ids"]:
        raise ValueError("evaluation_not_frozen_100")
    for plan in manifest["plans"]:
        for original in plan["files"].values():
            verify_pin(original)
    confusion = np.zeros((12, 12), dtype=np.int64)
    for row in result["perPlan"]:
        verify_pin(row["target"])
        verify_pin(row["prediction"])
        with Image.open(row["target"]["path"]) as target, Image.open(row["prediction"]["path"]) as prediction:
            confusion += class_confusion(np.asarray(target), np.asarray(prediction))
    measured = class_metrics(confusion, [metric["class"] for metric in result["perClass"]])
    if measured != result["perClass"]:
        raise ValueError("pooled_iou_recalculation_mismatch")
    mae = float(np.mean([abs(row["predictedRoomCount"] - row["publisherRoomCount"]) for row in result["perPlan"]]))
    if mae != result["roomCount"]["mae"]:
        raise ValueError("room_count_recalculation_mismatch")
    return {"plans": result["plans"], "perClassIoURecalculated": True, "roomCountMae": mae}


def source_units(text: str) -> dict[str, str]:
    units = {}
    for node in ast.parse(text).body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            units[node.name] = ast.dump(node, include_attributes=False)
        if isinstance(node, ast.ClassDef):
            for method in node.body:
                if isinstance(method, ast.FunctionDef):
                    units[f"{node.name}.{method.name}"] = ast.dump(method, include_attributes=False)
    return units


def verify_code_continuity(evidence: Path) -> None:
    inference = load(evidence / "inference-code-continuity.json")
    evaluation = load(evidence / "evaluation-code-continuity.json")
    checks = [inference, *evaluation["sourceChecks"]]
    for check in checks:
        retained = check["retainedExactSource"]
        verify_pin(retained)
        if retained["sha256"] != check["executed"]["sha256"]:
            raise ValueError("historical_executed_source_pin_mismatch")
        previous = Path(retained["path"]).read_text(encoding="utf-8")
        current = Path(check["current"]["path"]).read_text(encoding="utf-8")
        original_units = source_units(previous)
        current_units = source_units(current)
        names = check["unchangedAstUnits"] + check.get("unchangedAstMethods", [])
        if any(current_units.get(name) != original_units[name] for name in names):
            raise ValueError("executed_inference_or_evaluation_ast_changed")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args()
    raster = load(args.evidence / "tower3-current/result.json")
    panels = [verify_panel(panel) for panel in raster["panels"]]
    evaluation = verify_evaluation(args.evidence / "cubicasa-result.json")
    verify_code_continuity(args.evidence)
    print(json.dumps({"panels": panels, "evaluation": evaluation, "status": "passed"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
