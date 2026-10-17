"""Locate RF-DETR export divergence on one fixed DEV image, without GPU or holdout access."""

from __future__ import annotations

import argparse
from functools import partial
import json
from pathlib import Path
import re
import subprocess
import time
from typing import Any

import numpy as np
import onnxruntime as ort
import torch
from transformers import RfDetrForInstanceSegmentation

from building_io import EVIDENCE, REPO, RUNS, configure_offline, sha, write_json
from export_buildings import Export, dev_inputs, export_debug_graph, tensor

POINTS = (
    "backbone",
    "encoder_scores",
    "proposal_coordinates",
    "decoder",
    "mask_features_before_upsampling",
    "mask_features_after_upsampling",
    "logits",
    "masks",
    "boxes",
    "postprocessed_masks",
)


class IntermediateExport(Export):
    def __init__(self, model: Any) -> None:
        super().__init__(model)
        self.captured: dict[str, torch.Tensor] = {}
        core = model.model.model
        core.backbone.register_forward_hook(partial(self.capture, "backbone"))
        core.enc_out_class_embed[0].register_forward_hook(partial(self.capture, "encoder_scores"))
        core.decoder.register_forward_hook(partial(self.capture, "decoder"))
        core.decoder.register_forward_pre_hook(self.capture_decoder_input, with_kwargs=True)
        model.blocks[0].register_forward_pre_hook(self.capture_upsampled)

    def capture(self, name: str, module: Any, arguments: Any, output: Any) -> None:
        if name == "backbone":
            self.captured[name] = output[0]
            self.captured["mask_features_before_upsampling"] = output[0]
        elif name == "decoder":
            self.captured[name] = output.last_hidden_state
        elif name not in self.captured:
            # The classifier is called again on selected queries; retain pre-TopK scores.
            self.captured[name] = output

    def capture_decoder_input(self, module: Any, arguments: Any, keywords: dict[str, Any]) -> None:
        self.captured["proposal_coordinates"] = keywords["reference_points"]

    def capture_upsampled(self, module: Any, arguments: Any) -> None:
        self.captured["mask_features_after_upsampling"] = arguments[0]

    def forward(self, image: torch.Tensor) -> tuple[torch.Tensor, ...]:
        self.captured = {}
        output = self.model(pixel_values=image)
        self.captured.update(logits=output.logits, masks=output.pred_masks, boxes=output.pred_boxes)
        self.captured["postprocessed_masks"] = torch.nn.functional.interpolate(
            output.pred_masks, size=(256, 256), mode="bilinear", align_corners=False
        )
        return tuple(self.captured[name] for name in POINTS)


def export_intermediates(wrapper: IntermediateExport, image: np.ndarray, path: Path) -> None:
    # Reuse the exact static positional-embedding repair from the production exporter.
    export_debug_graph(wrapper, image, path, POINTS)


def compare(reference: list[np.ndarray], candidate: list[np.ndarray]) -> list[dict[str, Any]]:
    rows = []
    for name, expected, actual in zip(POINTS, reference, candidate):
        difference = np.abs(expected - actual)
        rows.append(
            {
                "point": name,
                "shape": list(expected.shape),
                "max_abs": float(difference.max()),
                "mean_abs": float(difference.mean()),
                "over_1e3": int(np.count_nonzero(difference > 0.001)),
            }
        )
    return rows


def intermediate_result(
    args: argparse.Namespace,
    output: Path,
    graph: Path,
    chip: dict[str, Any],
    model: Any,
    reference: list[np.ndarray],
    actual: list[np.ndarray],
) -> dict[str, Any]:
    return {
        "schema": "building-intermediate-parity/1",
        "chip_id": chip["source_id"],
        "checkpoint_sha256": sha(args.checkpoint / "model.safetensors"),
        "dev_annotations_sha256": sha(Path("E:/BhuAayam-data/datasets/ramp/coco/dev/_annotations.coco.json")),
        "input_rgb_pixel_sha256": chip["rgb_pixel_sha256"],
        "git_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
        "graph_sha256": sha(graph),
        "dtype": sorted({str(parameter.dtype) for parameter in model.parameters()}),
        "training_modules": sum(module.training for module in model.modules()),
        "cpu_only": True,
        "split": "dev",
        "opset": 17,
        "points": compare(reference, actual),
        "artifacts": str(output),
        "holdout_calls": 0,
    }


def run(args: argparse.Namespace, output: Path) -> dict[str, Any]:
    root, selected, _ = dev_inputs()
    chip = selected[args.chip_index]
    image = tensor(root / chip["file_name"])
    model = (
        RfDetrForInstanceSegmentation.from_pretrained(
            args.checkpoint, local_files_only=True, use_safetensors=True, attn_implementation="eager"
        )
        .float()
        .cpu()
        .eval()
    )
    wrapper = IntermediateExport(model).eval()
    graph = output / "intermediates.onnx"
    export_intermediates(wrapper, image, graph)
    with torch.inference_mode():
        reference = [value.numpy().copy() for value in wrapper(torch.from_numpy(image))]
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(graph), options, providers=["CPUExecutionProvider"])
    actual = session.run(None, {"image": image})
    np.savez_compressed(output / "pytorch.npz", **dict(zip(POINTS, reference)))
    np.savez_compressed(output / "onnx.npz", **dict(zip(POINTS, actual)))
    return intermediate_result(args, output, graph, chip, model, reference, actual)


def fallback_result(
    args: argparse.Namespace, load_seconds: float, rows: list[dict[str, Any]], resource: dict[str, int | None]
) -> dict[str, Any]:
    return {
        "schema": "building-pytorch-fallback/1",
        "status": "measured_not_served",
        "checkpoint_sha256": sha(args.checkpoint / "model.safetensors"),
        "config_sha256": sha(args.checkpoint / "config.json"),
        "providers": ["PyTorch-cpu"],
        "load_seconds": load_seconds,
        "cpu_threads": 2,
        "inference": "FP32/eval/inference_mode",
        "production_tiling_and_polygonization_reused": True,
        "inputs": rows,
        "process_memory_bytes": resource,
        "api_route_built": False,
        "holdout_calls": 0,
        "git_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
        "limitations": ["Windows CPU, concurrent GPU training; not live API or Linux-container latency"],
    }


def measure_fallback(args: argparse.Namespace) -> dict[str, Any]:
    from PIL import Image
    import psutil
    from eval_buildings import infer, model_path, production, session

    root, selected, counts = dev_inputs()
    process = psutil.Process()
    resource: dict[str, int | None] = {"before_model_rss": process.memory_info().rss}
    started = time.perf_counter()
    native, _ = session(model_path(str(args.checkpoint)), "cpu")
    resource["model_loaded_rss"] = process.memory_info().rss
    load_seconds = time.perf_counter() - started
    prod = production()
    rows = []
    for index in (4, 8):
        chip = selected[index]
        image = Image.open(root / chip["file_name"]).convert("RGB")
        started = time.perf_counter()
        predictions, foreground, omissions, tiles = infer(prod, native, image, chip["source_image_sha256"])
        rows.append(
            {
                "chip_id": chip["source_id"],
                "publisher_features": counts[chip["id"]],
                "candidate_roofs": len(predictions),
                "foreground_pixels": int(foreground.sum()),
                "omissions": omissions,
                "tiles": tiles,
                "seconds": time.perf_counter() - started,
            }
        )
    memory = process.memory_info()
    resource.update(final_rss=memory.rss, peak_working_set=getattr(memory, "peak_wset", None))
    return fallback_result(args, load_seconds, rows, resource)


def main() -> None:
    configure_offline()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--chip-index", type=int, choices=range(20), default=0)
    parser.add_argument("--measure-fallback", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.run_id):
        parser.error("Simple unique run-id required")
    torch.set_num_threads(2)
    torch.manual_seed(26011)
    output = RUNS / args.run_id
    output.mkdir(exist_ok=False)
    result = measure_fallback(args) if args.measure_fallback else run(args, output)
    write_json(output / "result.json", result)
    evidence = EVIDENCE / args.run_id
    evidence.mkdir(exist_ok=False)
    write_json(evidence / "result.json", result)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
