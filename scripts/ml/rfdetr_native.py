"""Diagnostic only: native RF-DETR 1.11.2 did not qualify for publisher-weight parity.

Retains the failed comparison, not an alternate training or serving route.
No backbone or building-channel weight is randomly reinitialised.
"""

from __future__ import annotations

import argparse
import importlib.metadata
import json
from pathlib import Path
from typing import Any

from safetensors.torch import load_file
import torch

from building_io import configure_offline, read_json, write_json
from export_buildings import tensor
from train_buildings import BASE, ROOT


def model_config(device: str = "cpu") -> Any:
    from rfdetr.config import RFDETRSegMediumConfig

    if importlib.metadata.version("rfdetr") != "1.11.2":
        raise RuntimeError("Native diagnostic requires pinned rfdetr 1.11.2")
    return RFDETRSegMediumConfig(
        pretrain_weights=None,
        num_classes=1,
        resolution=432,
        device=device,
        gradient_checkpointing=True,
    )


def load_satellite(model: Any, path: Path = BASE / "model.safetensors") -> list[str]:
    state = load_file(str(path))
    expected = model.state_dict()
    if set(expected) - set(state) != {"_kp_active_mask"} or set(state) - set(expected):
        raise ValueError("Satellite/native state keys drifted")
    state["_kp_active_mask"] = expected["_kp_active_mask"]
    expanded = []
    for key, value in list(state.items()):
        if value.shape == expected[key].shape:
            continue
        if "class_embed" not in key or value.shape[0] != 1 or expected[key].shape[0] != 2:
            raise ValueError("Unexpected weight shape: " + key)
        # Lowering only native background bias still failed strict parity.
        extra = torch.zeros_like(value)
        if key.endswith("bias"):
            extra.fill_(-10000.0)
        state[key] = torch.cat([value, extra], dim=0)
        expanded.append(key)
    model.load_state_dict(state, strict=True)
    return expanded


def diagnostic_inputs() -> list[dict[str, Any]]:
    coco = read_json(ROOT / "_annotations.coco.json")
    positive_ids = {annotation["image_id"] for annotation in coco["annotations"]}
    return [
        next(image for image in coco["images"] if image["id"] not in positive_ids),
        next(image for image in coco["images"] if image["id"] in positive_ids),
    ]


def compare_models(native: Any, publisher: Any, image: dict[str, Any], device: str) -> dict[str, Any]:
    pixels = torch.from_numpy(tensor(ROOT / image["file_name"])).to(device)
    with torch.inference_mode():
        actual = native(pixels)
        reference = publisher(pixel_values=pixels)
    differences = {
        "logits": float((actual["pred_logits"][..., :1] - reference.logits).abs().max()),
        "boxes": float((actual["pred_boxes"] - reference.pred_boxes).abs().max()),
        "masks": float((actual["pred_masks"] - reference.pred_masks).abs().max()),
    }
    return {"chip_id": image["source_id"], "max_abs_difference": differences}


def check_base(output: Path, device: str) -> None:
    from rfdetr.models.lwdetr import build_model_from_config
    from transformers import RfDetrForInstanceSegmentation

    torch.set_num_threads(2)
    torch.manual_seed(26011)
    if device == "cuda":
        torch.cuda.set_per_process_memory_fraction(0.75)
    native = build_model_from_config(model_config(device)).to(device).eval()
    expanded = load_satellite(native)
    publisher = (
        RfDetrForInstanceSegmentation.from_pretrained(
            BASE,
            local_files_only=True,
            use_safetensors=True,
            attn_implementation="eager",
        )
        .to(device)
        .eval()
    )
    rows = [compare_models(native, publisher, image, device) for image in diagnostic_inputs()]
    passed = all(value <= 0.002 for row in rows for value in row["max_abs_difference"].values())
    result = {
        "status": "passed" if passed else "failed",
        "device": device,
        "per_chip": rows,
        "split": "train",
        "expanded_class_heads": expanded,
        "background_slot_bias": -10000.0,
        "tolerance": 0.002,
        "holdout_calls": 0,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    write_json(output, result)
    print(json.dumps(result), flush=True)
    if not passed:
        raise SystemExit(1)


def main() -> None:
    configure_offline()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-base", type=Path, required=True)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    args = parser.parse_args()
    check_base(args.check_base, args.device)


if __name__ == "__main__":
    main()
