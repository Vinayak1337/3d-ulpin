"""Reuse SHA-pinned completed model inference; OCR continuation never reruns its model."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np
from PIL import Image

from raster_common import pin

if TYPE_CHECKING:
    from geo.raster_plan import PlanSelection, Segmentation


@dataclass(frozen=True)
class ModelReplay:
    result: dict[str, Any]
    image: Image.Image
    labels: np.ndarray
    lineage: dict[str, Any]


def replay_model(selection: PlanSelection, receipt_path: Path) -> ModelReplay:
    from geo.raster_plan import citation, installed_model

    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    panel = next(panel for panel in receipt["panels"] if panel["panel"] == selection.panel)
    for artifact in [panel["fullPrecision"], *panel["artifacts"].values()]:
        if pin(Path(artifact["path"])) != artifact:
            raise ValueError("replay_model_artifact_pin_mismatch")
    result = json.loads(Path(panel["fullPrecision"]["path"]).read_text(encoding="utf-8"))
    if (result["sourceCitation"] != citation(selection, selection.bbox)
            or result["model"]["sha256"] != installed_model()["sha256"]
            or result["model"]["profileVersion"] != installed_model()["profileVersion"]):
        raise ValueError("replay_model_source_selection_or_profile_mismatch")
    with Image.open(panel["artifacts"]["raster.png"]["path"]) as original:
        image = original.convert("RGB").copy()
    with Image.open(panel["artifacts"]["mask.png"]["path"]) as original:
        labels = np.asarray(original).copy()
    return ModelReplay(result, image, labels, {"actualInference": False, "reusedCompletedInference": True,
                                              "sourceRun": pin(receipt_path), "sourcePanel": panel["fullPrecision"]})


def save_replay(replay: ModelReplay, destination: Path) -> dict[str, Any]:
    replay.image.save(destination / "raster.png")
    Image.fromarray(replay.labels).save(destination / "mask.png")
    return {name: pin(destination / name) for name in ("raster.png", "mask.png")}


def replay_segmentation(replay: ModelReplay) -> Segmentation:
    from geo.raster_plan import Segmentation
    from shapely.affinity import affine_transform
    from shapely.geometry import mapping, shape

    transform = replay.result["transform"]
    coefficients = transform["pixelToSource"]
    inverse = [1 / coefficients[0], 0, 0, 1 / coefficients[4],
               -coefficients[2] / coefficients[0], -coefficients[5] / coefficients[4]]
    rooms = [{"id": room["sourceComponentRef"], "className": room["className"], "score": room["confidence"],
              "geometry": mapping(affine_transform(shape(room["geometryPagePixels"]), inverse))}
             for room in replay.result["rooms"]]
    return Segmentation(replay.labels, replay.image, transform, rooms, replay.result["context"],
                        replay.result["omissions"], replay.result["floorRepresentation"], "mean_pixel_softmax")
