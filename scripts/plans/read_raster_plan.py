"""Run retained OCR and installed v2 contours offline, without runtime/DB writes."""
from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import sys
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from raster_common import pin, require_fresh_directory, write_json
from raster_ocr import OcrRunner, observe_tile
from raster_replay import replay_model, replay_segmentation, save_replay

if TYPE_CHECKING:
    from geo.raster_plan import OcrAssets, PlanSelection

REPO = Path(__file__).resolve().parents[2]
PRIVATE = Path("E:/BhuAayam-data/task-data/p2")
OCR_ROOT = Path("E:/BhuAayam-data/task-data/desktop-ai04f-docling-tesseract")


def load_selections(path: Path) -> tuple[dict[str, Any], list[PlanSelection]]:
    from geo.raster_plan import PlanSelection

    manifest = json.loads(path.read_text(encoding="utf-8"))
    selections = []
    for panel in manifest["panels"]:
        source = Path(panel["source"])
        if pin(source)["sha256"] != panel["sha256"]:
            raise ValueError("selected_source_hash_mismatch")
        selections.append(PlanSelection(panel["sourceId"], source, panel["sha256"], panel["page"],
                                        panel["panel"], tuple(panel["bbox"]), panel["reason"]))
    return manifest, selections


def round_numbers(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, 2)
    if isinstance(value, list):
        return [round_numbers(item) for item in value]
    if isinstance(value, tuple):
        return [round_numbers(item) for item in value]
    if isinstance(value, dict):
        return {key: round_numbers(item) for key, item in value.items()}
    return value


def compact_room(room: dict[str, Any]) -> dict[str, Any]:
    geometry_fields = {"geometryPagePixels", "citations"}
    result = {key: round_numbers(value) if key in geometry_fields else value for key, value in room.items()}
    result["containedOcrLiterals"] = compact_observations(room["containedOcrLiterals"])
    if room["metric"] is not None:
        result["metric"] = room["metric"]
    return result


def compact_observations(observations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{**observation, "bboxPt": round_numbers(observation["bboxPt"]),
             "sourcePageBoxesPt": round_numbers(observation.get("sourcePageBoxesPt", [observation["bboxPt"]]))}
            for observation in observations]


def compact_panel(result: dict[str, Any], full_pin: dict[str, Any], artifacts: dict[str, Any]) -> dict[str, Any]:
    fields = ("schemaVersion", "normalizedBuildingCandidateShape", "panel", "selectionReason", "sourceCitation",
              "level", "method", "state", "transform", "scale", "candidates", "gaps", "omissions")
    compact = {key: result[key] for key in fields}
    compact["inferenceLineage"] = result["inferenceLineage"]
    compact.update(rooms=[compact_room(room) for room in result["rooms"]],
                   ocrObservations=compact_observations(result["ocrObservations"]),
                   disagreements=round_numbers(result["disagreements"]),
                   unattachedOcrCount=len(result["unattachedOcr"]),
                   omittedMaskPixels=result["floorRepresentation"]["omittedMaskPixels"],
                   completePolygons=result["floorRepresentation"]["completePolygons"],
                   fullPrecision=full_pin, artifacts=artifacts)
    return compact


def observe_or_resume(selection: PlanSelection, region: list[float], assets: OcrAssets, runner: OcrRunner,
                      destination: Path, previous: Path | None) -> dict[str, Any]:
    from geo import raster_plan

    receipt_path = previous / selection.panel / destination.name / "ocr.json" if previous else None
    if receipt_path is None or not receipt_path.exists():
        return observe_tile(selection, region, assets, runner, destination)
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    frame = receipt["frame"]
    if (frame["source"]["sha256"] != selection.sha256 or frame["pageNumber"] != selection.page
            or frame["requestedRegion"] != region or receipt["method"] != raster_plan.ocr.DOCLING_METHOD):
        raise ValueError("resume_ocr_source_or_selection_mismatch")
    png = receipt_path.parent / "render.png"
    if pin(png)["sha256"] != frame["render"]["pngSha256"]:
        raise ValueError("resume_ocr_render_hash_mismatch")
    for key in ("runnerReceipt", "runnerResult", "runnerLog"):
        if pin(Path(receipt[key]["path"])) != receipt[key]:
            raise ValueError("resume_runner_artifact_hash_mismatch")
    destination.mkdir()
    with (destination / "render.png").open("xb") as stream:
        stream.write(png.read_bytes())
    return {**receipt, "reusedFrom": pin(receipt_path)}


def run_panel(selection: PlanSelection, assets: OcrAssets, runner: OcrRunner, tile_edge: float,
              full: Path, compact: Path, previous: Path | None, model_receipt: Path | None) -> dict[str, Any]:
    from PIL import Image
    from geo import raster_plan

    panel_dir = full / selection.panel
    panel_dir.mkdir()
    started = time.perf_counter()
    receipts = []
    for index, region in enumerate(raster_plan.tiles(selection.bbox, tile_edge)):
        receipt = observe_or_resume(selection, region, assets, runner, panel_dir / f"tile-{index:02d}", previous)
        write_json(panel_dir / f"tile-{index:02d}" / "ocr.json", receipt)
        receipts.append(receipt)
    observations = raster_plan.text_observations(receipts)
    if model_receipt is not None:
        replay = replay_model(selection, model_receipt)
        result = raster_plan.refresh_panel_ocr(replay.result, observations)
        result["inferenceLineage"] = replay.lineage
        segmentation = replay_segmentation(replay)
        artifacts = save_replay(replay, panel_dir)
    else:
        segmentation = raster_plan.segment_selection(selection)
        result = raster_plan.panel_result(selection, segmentation, observations)
        result["inferenceLineage"] = {"actualInference": True, "reusedCompletedInference": False}
        segmentation.image.save(panel_dir / "raster.png")
        Image.fromarray(segmentation.labels).save(panel_dir / "mask.png")
        artifacts = {name: pin(panel_dir / name) for name in ("raster.png", "mask.png")}
    raster_plan.overlay(segmentation, compact / f"{selection.panel}-overlay.png")
    full_pin = write_json(panel_dir / "candidates.json", result)
    output_pin = write_json(compact / f"{selection.panel}.json", compact_panel(result, full_pin, artifacts))
    return {"panel": selection.panel, "tiles": len(receipts), "ocrObservations": len(observations),
            "rooms": len(result["rooms"]), "disagreements": len(result["disagreements"]),
            "scaleState": result["scale"]["state"], "seconds": round(time.perf_counter() - started, 3),
            "partialOcrTiles": sum(receipt["partial"] for receipt in receipts),
            "inferenceLineage": result["inferenceLineage"],
            "output": output_pin, "fullPrecision": full_pin,
            "overlay": pin(compact / f"{selection.panel}-overlay.png"), "artifacts": artifacts}


def runtime_receipt(selection: Path, panels: list[dict[str, Any]], asset_pins: dict[str, Any]) -> dict[str, Any]:
    from geo.raster_plan import installed_model

    dependencies = ("onnxruntime", "rasterio", "Shapely", "PyMuPDF", "pypdfium2", "numpy", "Pillow")
    files = ("services/geo/geo/raster_plan.py", "services/geo/geo/spatial_ml.py",
             "services/geo/geo/vector_plan.py", "services/geo/geo/usp_document_candidates/docling_tesseract.py",
             "services/geo/ml-models.json", "scripts/plans/read_raster_plan.py", "scripts/plans/raster_common.py",
             "scripts/plans/raster_ocr.py", "scripts/plans/raster_replay.py",
             "scripts/usp/document-models/run_source_ocr.py")
    return {"schemaVersion": "p2-raster-run/1", "command": [sys.executable, *sys.argv],
            "selection": pin(selection), "panels": panels, "model": installed_model(),
            "backend": "onnxruntime-cpu", "scoresCalibrated": False, "cudaVisibleDevices": "",
            "ocrAssets": asset_pins, "python": sys.version.split()[0],
            "dependencies": {name: importlib.metadata.version(name) for name in dependencies},
            "code": {name: pin(REPO / name) for name in files}, "classification": "test_only",
            "permission": "unconfirmed", "dbWrites": 0, "gpuCalls": 0, "providerCalls": 0,
            "levelAssociation": "unknown", "spatialAuthority": False, "textCompleteness": "unverified"}


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection", type=Path, default=REPO / "scripts/plans/tower3-raster-selection.json")
    parser.add_argument("--full-out", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--ocr-root", type=Path, default=OCR_ROOT)
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--tesseract", type=Path, help="Explicit retained runtime override; never modifies OCR config")
    parser.add_argument("--resume-ocr", type=Path, help="Reuse pinned successful tiles from an interrupted P2 run")
    parser.add_argument("--resume-model", type=Path, help="Reuse a completed SHA-pinned P2 model-run receipt")
    parser.add_argument("--ocr-python", type=Path, default=OCR_ROOT / "venv/Scripts/python.exe")
    return parser.parse_args()


def main() -> int:
    args = arguments()
    os.environ.update(CUDA_VISIBLE_DEVICES="", ML_MODEL_DIR=str(args.models), HF_HUB_OFFLINE="1",
                      TRANSFORMERS_OFFLINE="1", OMP_NUM_THREADS="2")
    sys.path.insert(0, str(REPO / "services/geo"))
    from geo.raster_plan import OcrAssets, installed_model, ocr

    installed_model()
    manifest, selections = load_selections(args.selection)
    executable = args.tesseract or args.ocr_root / "tesseract/Library/bin/tesseract.exe"
    assets = OcrAssets(args.ocr_root / "models", executable, args.ocr_root / "tesseract/Library/share/tessdata")
    os.environ["PATH"] = str(executable.parent) + os.pathsep + os.environ["PATH"]
    asset_pins = ocr.verify_assets(assets.models, assets.tesseract, assets.tessdata)
    asset_pins["runtimeDlls"] = {path.name: pin(path) for path in executable.parent.glob("*.dll")}
    full = require_fresh_directory(args.full_out, PRIVATE)
    compact = require_fresh_directory(args.out, REPO / "docs/evidence/gf-ai/plans/raster")
    write_json(compact / "selection.json", manifest)
    if args.resume_ocr and not args.resume_ocr.resolve().is_relative_to(PRIVATE.resolve()):
        raise ValueError("resume OCR must be inside the task-owned private root")
    runner = OcrRunner(args.ocr_python, REPO / "scripts/usp/document-models/run_source_ocr.py")
    panels = [run_panel(selection, assets, runner, manifest["ocr"]["tileEdgePt"], full, compact,
                        args.resume_ocr, args.resume_model) for selection in selections]
    write_json(compact / "result.json", runtime_receipt(args.selection, panels, asset_pins))
    print(json.dumps({"panels": panels}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
