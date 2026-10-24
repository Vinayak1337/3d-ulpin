"""One real-input RF-DETR CUDA forward/backward, no optimizer or evaluation.

Loads only retained safetensors. Uses reviewed Barishal TRAIN-only roof instances;
never loads Karnataka holdout. Reports native CUDA peak and timed model pass.
"""
from __future__ import annotations
import os
os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", OMP_NUM_THREADS="2", MKL_NUM_THREADS="2")
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import time


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--checkpoint", type=Path, default=Path("E:/BhuAayam-data/task-data/d07-rfdetr-train-prep-20261005/original"))
    p.add_argument("--output", type=Path, default=Path("docs/evidence/gf-ai/building/environment/result.json"))
    args = p.parse_args()
    import numpy as np
    from PIL import Image
    from pycocotools import mask as mask_api
    import torch
    import rfdetr
    from transformers import RfDetrForInstanceSegmentation, RfDetrImageProcessor
    torch.set_num_threads(2)
    if not torch.cuda.is_available():
        raise RuntimeError("Native CUDA unavailable; diagnose once before WSL2 fallback")
    torch.cuda.set_per_process_memory_fraction(.75)
    torch.manual_seed(26011)
    root = Path("E:/BhuAayam-data/task-data/d06-ramp-coco-20261005/train")
    coco = json.loads((root / "_annotations.coco.json").read_bytes())
    source = next(x for x in coco["images"] if any(a["image_id"] == x["id"] for a in coco["annotations"]))
    image = Image.open(root / source["file_name"]).convert("RGB").resize((432, 432), Image.Resampling.BILINEAR)
    annotations, masks = [], []
    for a in coco["annotations"]:
        if a["image_id"] != source["id"]:
            continue
        height, width = a["segmentation"]["size"]
        raw_mask = mask_api.decode(mask_api.frPyObjects(a["segmentation"], height, width))
        resized_mask = np.asarray(Image.fromarray(raw_mask).resize((432, 432), Image.Resampling.NEAREST)).copy()
        masks.append(torch.as_tensor(resized_mask, dtype=torch.uint8))
        x, y, w, h = a["bbox"]
        annotations.append({"id": a["id"], "category_id": 0, "bbox": [x * 432 / width, y * 432 / height, w * 432 / width, h * 432 / height], "area": a["area"] * (432 / width) * (432 / height), "iscrowd": 0})
    processor = RfDetrImageProcessor.from_pretrained(args.checkpoint, local_files_only=True)
    batch = processor(images=image, annotations={"image_id": source["id"], "annotations": annotations}, return_segmentation_masks=False, do_resize=False, do_pad=False, return_tensors="pt")
    target = batch["labels"][0]
    target["masks"] = torch.stack(masks)
    labels = [{k: v.to("cuda") if hasattr(v, "to") else v for k, v in target.items()}]
    model = RfDetrForInstanceSegmentation.from_pretrained(args.checkpoint, local_files_only=True, attn_implementation="eager").to("cuda").train()
    pixel_values = batch["pixel_values"].to("cuda")
    torch.cuda.reset_peak_memory_stats()
    torch.cuda.synchronize()
    start = time.perf_counter()
    with torch.autocast("cuda", dtype=torch.float16):
        output = model(pixel_values=pixel_values, pixel_mask=torch.ones((1, 432, 432), dtype=torch.bool, device="cuda"), labels=labels)
    loss = output.loss
    if loss.ndim or not torch.isfinite(loss):
        raise RuntimeError("RF-DETR loss is non-scalar or non-finite")
    loss.backward()
    torch.cuda.synchronize()
    seconds = time.perf_counter() - start
    gradients = [x.grad for x in model.parameters() if x.grad is not None]
    finite = all(bool(torch.isfinite(x).all()) for x in gradients)
    peak = torch.cuda.max_memory_reserved()
    result = {"status": "passed" if finite and seconds < 60 and peak <= 6 * 1024**3 else "failed_bounds", "framework": "Transformers RF-DETR instance-segmentation (same installed checkpoint); rfdetr package imported", "gpu": torch.cuda.get_device_name(0), "cuda": torch.version.cuda, "versions": {k: importlib.metadata.version(k) for k in ("torch", "torchvision", "rfdetr", "transformers", "onnxruntime-gpu", "numpy", "pillow", "pycocotools")}, "input": {"path": (root / source["file_name"]).as_posix(), "sha256": hashlib.sha256((root / source["file_name"]).read_bytes()).hexdigest(), "instances": len(annotations), "allocation": "retained_Barishal_train_only"}, "model_sha256": hashlib.sha256((args.checkpoint / "model.safetensors").read_bytes()).hexdigest(), "forward_calls": 1, "backward_calls": 1, "optimizer_steps": 0, "holdout_calls": 0, "loss": float(loss.detach()), "finite_gradients": finite, "parameters_with_gradients": len(gradients), "forward_backward_seconds": seconds, "peak_allocated_bytes": torch.cuda.max_memory_allocated(), "peak_reserved_bytes": peak, "budget_bytes": 6 * 1024**3, "precision": "autocast_fp16; FP32 parameters/gradients", "python": __import__("sys").version}
    import subprocess
    repo = Path(__file__).resolve().parents[2]
    result.update({"git_sha": subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip(), "smoke_code_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "network_model_fetches": 0})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
        f.write("\n")
    print(json.dumps(result), flush=True)
    if result["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
