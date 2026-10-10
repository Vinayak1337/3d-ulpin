"""Static ONNX export and strict PyTorch parity on 20 DEV chips, CPU only.

Production graph has logits/masks; the same retained graph also exposes boxes
for numerical comparison. No graph with failed parity is qualified for serving.
"""

from __future__ import annotations

import argparse
from collections import Counter
import copy
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import time
from types import MethodType
from typing import Any

import numpy as np
from PIL import Image
import torch
from transformers import RfDetrForInstanceSegmentation

from building_io import EVIDENCE, REPO, RUNS, configure_offline, read_json, sha, write_json

OUTPUT_NAMES = ("logits", "masks", "boxes")
TOLERANCE = {"logits": 0.001, "masks": 0.001, "boxes": 0.0001}


def tensor(path: Path) -> np.ndarray:
    image = Image.open(path).convert("RGB")
    array = np.asarray(image.resize((432, 432), Image.Resampling.BILINEAR)).transpose(2, 0, 1)
    array = array.astype("float32") / 255
    mean = np.array([0.485, 0.456, 0.406], dtype="float32")[:, None, None]
    std = np.array([0.229, 0.224, 0.225], dtype="float32")[:, None, None]
    return ((array - mean) / std)[None].copy()


class Export(torch.nn.Module):
    def __init__(self, model: Any) -> None:
        super().__init__()
        self.model = model

    def forward(self, image: torch.Tensor) -> tuple[torch.Tensor, ...]:
        output = self.model(pixel_values=image)
        return output.logits, output.pred_masks, output.pred_boxes


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--ort-no-optimizations", action="store_true", help="Bounded ORT_DISABLE_ALL diagnosis")
    parser.add_argument("--reuse-parity-graph", type=Path, help="Diagnose retained exact graph bytes")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.run_id):
        parser.error("Simple new run-id required")
    return args


def dev_inputs() -> tuple[Path, list[dict[str, Any]], Counter]:
    root = Path("E:/BhuAayam-data/datasets/ramp/coco/dev")
    path = root / "_annotations.coco.json"
    receipt = read_json(EVIDENCE / "data/coco-export.json")
    expected = next(record for record in receipt["splits"] if record["split"] == "dev")
    if sha(path) != expected["annotations_sha256"]:
        raise ValueError("Frozen DEV annotations drift")
    coco = read_json(path)
    counts = Counter(annotation["image_id"] for annotation in coco["annotations"])
    empty = [image for image in coco["images"] if counts[image["id"]] == 0][:4]
    dense = [image for image in coco["images"] if counts[image["id"]] >= 15][:4]
    selected = empty + dense
    selected += [image for image in coco["images"] if image not in selected][: 20 - len(selected)]
    if len(selected) != 20:
        raise ValueError("Parity requires exactly 20 DEV chips")
    return root, selected, counts


def fixed_grid(embedding: Any, values: torch.Tensor, height: int, width: int) -> torch.Tensor:
    # Matches eager 432 path; upstream tracing otherwise resamples identical PE
    # using unsupported aten::_upsample_bicubic2d_aa. Never exported dynamically.
    return embedding.position_embeddings


def export_debug_graph(wrapper: Export, example: np.ndarray, output: Path) -> None:
    from transformers.models.rf_detr.modeling_rf_detr import RfDetrDinov2Embeddings

    embeddings = [module for module in wrapper.model.modules() if isinstance(module, RfDetrDinov2Embeddings)]
    if len(embeddings) != 1 or embeddings[0].position_embeddings.shape[1] != 1297:
        raise ValueError("Static 432 positional-embedding contract drift")
    embedding = embeddings[0]
    original = embedding.interpolate_pos_encoding
    embedding.interpolate_pos_encoding = MethodType(fixed_grid, embedding)
    try:
        with torch.inference_mode():
            torch.onnx.export(
                wrapper,
                torch.from_numpy(example),
                str(output),
                input_names=["image"],
                output_names=list(OUTPUT_NAMES),
                opset_version=17,
                dynamo=False,
                external_data=False,
            )
    finally:
        # References below use untouched eager semantics, not the export wrapper.
        embedding.interpolate_pos_encoding = original


def export_graphs(args: argparse.Namespace, wrapper: Export, example: np.ndarray, output: Path) -> tuple[Path, Path]:
    import onnx

    debug = output / "building-parity-boxes.onnx"
    if args.reuse_parity_graph:
        shutil.copyfile(args.reuse_parity_graph, debug)
    else:
        export_debug_graph(wrapper, example, debug)
    graph = onnx.load(str(debug))
    onnx.checker.check_model(graph)
    primary = copy.deepcopy(graph)
    del primary.graph.output[2:]
    production = output / "building.onnx"
    onnx.save(primary, str(production))
    onnx.checker.check_model(primary)
    return debug, production


def sessions(debug: Path, production: Path, no_optimizations: bool) -> tuple[Any, Any]:
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    if no_optimizations:
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    providers = ["CPUExecutionProvider"]
    return (
        ort.InferenceSession(str(debug), options, providers=providers),
        ort.InferenceSession(str(production), options, providers=providers),
    )


def compare_chip(wrapper: Export, session: Any, serving: Any, root: Path, chip: dict[str, Any]) -> dict[str, Any]:
    source = Image.open(root / chip["file_name"]).convert("RGB")
    if hashlib.sha256(np.asarray(source).tobytes()).hexdigest() != chip["rgb_pixel_sha256"]:
        raise ValueError("DEV source pixels drift")
    image = tensor(root / chip["file_name"])
    with torch.inference_mode():
        pytorch = [value.numpy() for value in wrapper(torch.from_numpy(image))]
    exported = session.run(None, {"image": image})
    actual = serving.run(None, {"image": image})
    differences = {
        name: float(np.max(np.abs(reference - candidate)))
        for name, reference, candidate in zip(OUTPUT_NAMES, pytorch, exported)
    }
    differences["production_vs_parity_logits"] = float(np.max(np.abs(actual[0] - exported[0])))
    differences["production_vs_parity_masks"] = float(np.max(np.abs(actual[1] - exported[1])))
    return {
        "chip_id": chip["source_id"],
        "max_abs_difference": differences,
        "mask_sign_disagreement_pixels": int(np.count_nonzero((pytorch[1] > 0) != (exported[1] > 0))),
    }


def parity_rows(wrapper: Export, session: Any, serving: Any, root: Path, selected: list, counts: Counter) -> list:
    rows = []
    for chip in selected:
        row = compare_chip(wrapper, session, serving, root, chip)
        row["publisher_features"] = counts[chip["id"]]
        row["empty"] = counts[chip["id"]] == 0
        rows.append(row)
    return rows


def parity_result(
    args: argparse.Namespace, debug: Path, production: Path, rows: list, seconds: float
) -> dict[str, Any]:
    maxima = {key: max(row["max_abs_difference"][key] for row in rows) for key in rows[0]["max_abs_difference"]}
    passed = all(maxima[name] <= limit for name, limit in TOLERANCE.items())
    passed = passed and maxima["production_vs_parity_logits"] <= 0.001
    passed = passed and maxima["production_vs_parity_masks"] <= 0.001
    return {
        "schema": "building-onnx-parity/1",
        "status": "passed" if passed else "failed",
        "checkpoint": str(args.checkpoint),
        "checkpoint_sha256": sha(args.checkpoint / "model.safetensors"),
        "onnx_path": str(production),
        "onnx_sha256": sha(production),
        "parity_graph": str(debug),
        "parity_graph_sha256": sha(debug),
        "box_comparison": "Identical graph parameters; third debug output only; production logits/masks also compared",
        "split": "dev",
        "dev_annotations_sha256": sha(Path("E:/BhuAayam-data/datasets/ramp/coco/dev/_annotations.coco.json")),
        "chips": 20,
        "profile": "RGB432/Pillow bilinear/ImageNet; production tile512 stride384",
        "max_abs_difference": maxima,
        "tolerance": TOLERANCE,
        "per_chip": rows,
        "seconds": seconds,
        "providers": ["CPUExecutionProvider"],
        "opset": 17,
        "static_input_shape": [1, 3, 432, 432],
        "ort_optimization": "ORT_DISABLE_ALL" if args.ort_no_optimizations else "ORT_ENABLE_ALL",
        "export_repair": "Instance-local fixed-grid PE; original restored before all PyTorch references",
        "holdout_calls": 0,
        "git_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
    }


def main() -> None:
    configure_offline()
    args = parse_arguments()
    output = RUNS / args.run_id
    output.mkdir(parents=True, exist_ok=False)
    torch.set_num_threads(2)
    torch.manual_seed(26011)
    root, selected, counts = dev_inputs()
    model = (
        RfDetrForInstanceSegmentation.from_pretrained(
            args.checkpoint,
            local_files_only=True,
            use_safetensors=True,
            attn_implementation="eager",
        )
        .cpu()
        .eval()
    )
    wrapper = Export(model).eval()
    started = time.monotonic()
    debug, production = export_graphs(args, wrapper, tensor(root / selected[0]["file_name"]), output)
    session, serving = sessions(debug, production, args.ort_no_optimizations)
    rows = parity_rows(wrapper, session, serving, root, selected, counts)
    result = parity_result(args, debug, production, rows, time.monotonic() - started)
    write_json(output / "result.json", result)
    evidence = EVIDENCE / args.run_id
    evidence.mkdir(exist_ok=False)
    write_json(evidence / "result.json", result)
    print(json.dumps({"status": result["status"], "max_abs_difference": result["max_abs_difference"]}), flush=True)
    if result["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
