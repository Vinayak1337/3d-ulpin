"""Join cited OCR continuations onto completed room inference; no rerun or label precedence."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from raster_common import pin, require_fresh_directory, write_json
from read_raster_plan import compact_panel

REPO = Path(__file__).resolve().parents[2]
PRIVATE = Path("E:/BhuAayam-data/task-data/p2")


def load_panel(receipt: dict[str, Any]) -> dict[str, Any]:
    full = receipt["fullPrecision"]
    if pin(Path(full["path"])) != full:
        raise ValueError("continuation_input_pin_mismatch")
    return json.loads(Path(full["path"]).read_text(encoding="utf-8"))


def join_panel(prior: dict[str, Any], runner: dict[str, Any], full: Path, output: Path) -> dict[str, Any]:
    from geo.raster_plan import refresh_panel_ocr

    previous = load_panel(prior)
    continuation = load_panel(runner)
    if (previous["sourceCitation"] != continuation["sourceCitation"]
            or previous["model"] != continuation["model"] or previous["transform"] != continuation["transform"]):
        raise ValueError("continuation_source_model_or_frame_mismatch")
    observations = continuation["ocrObservations"] + previous["ocrObservations"]
    result = refresh_panel_ocr(continuation, observations)
    if [room["geometryPagePixels"] for room in result["rooms"]] != [
            room["geometryPagePixels"] for room in previous["rooms"]]:
        raise ValueError("continuation_must_not_change_model_geometry")
    result["ocrLineage"] = {"sourcePanels": [runner["fullPrecision"], prior["fullPrecision"]],
                            "precedence": "none; methods and literal observations remain separate",
                            "actualOcrInPublication": False}
    result["inferenceLineage"] = continuation["inferenceLineage"]
    result["gaps"].append("ocr_profiles_partial_and_not_equivalent")
    full_pin = write_json(full / f"{result['panel']}.json", result)
    compact = compact_panel(result, full_pin, runner["artifacts"])
    compact["ocrLineage"] = result["ocrLineage"]
    output_pin = write_json(output / f"{result['panel']}.json", compact)
    overlay = Path(runner["overlay"]["path"])
    if pin(overlay) != runner["overlay"]:
        raise ValueError("continuation_overlay_pin_mismatch")
    destination = output / overlay.name
    with destination.open("xb") as stream:
        stream.write(overlay.read_bytes())
    return {"panel": result["panel"], "rooms": len(result["rooms"]), "ocrObservations": len(observations),
            "disagreements": len(result["disagreements"]), "scaleState": result["scale"]["state"],
            "output": output_pin, "fullPrecision": full_pin, "overlay": pin(destination),
            "artifacts": runner["artifacts"], "ocrLineage": result["ocrLineage"],
            "inferenceLineage": result["inferenceLineage"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prior-run", type=Path, required=True)
    parser.add_argument("--runner-run", type=Path, required=True)
    parser.add_argument("--full-out", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(REPO / "services/geo"))
    prior = json.loads(args.prior_run.read_text(encoding="utf-8"))
    runner = json.loads(args.runner_run.read_text(encoding="utf-8"))
    full = require_fresh_directory(args.full_out, PRIVATE)
    output = require_fresh_directory(args.out, REPO / "docs/evidence/gf-ai/plans/raster")
    selection = json.loads(Path(runner["selection"]["path"]).read_text(encoding="utf-8"))
    write_json(output / "selection.json", selection)
    previous = {panel["panel"]: panel for panel in prior["panels"]}
    panels = [join_panel(previous[panel["panel"]], panel, full, output) for panel in runner["panels"]]
    receipt = {"schemaVersion": "p2-raster-publication/1", "panels": panels,
               "sourceRuns": [pin(args.prior_run), pin(args.runner_run)], "command": [sys.executable, *sys.argv],
               "classification": "test_only", "permission": "unconfirmed", "levelAssociation": "unknown",
               "actualInference": False, "actualOcr": False, "dbWrites": 0, "gpuCalls": 0, "providerCalls": 0,
               "code": {name: pin(REPO / name) for name in ("scripts/plans/publish_raster_continuation.py",
                                                          "scripts/plans/read_raster_plan.py",
                                                          "services/geo/geo/raster_plan.py")}}
    write_json(output / "result.json", receipt)
    print(json.dumps({"panels": [{key: panel[key] for key in ("panel", "rooms", "ocrObservations", "disagreements")}
                                 for panel in panels]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
