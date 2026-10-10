"""TRAIN-only RF-DETR fine-tune with standard Trainer, safe weights and DEV epoch scoring.

Publisher weights failed native rfdetr compatibility, so use their Transformers
implementation. This runner has no HOLDOUT path. All checkpoints are append-only.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import random
import re
import subprocess
import sys
import time
from typing import Any, Sequence, TextIO

import numpy as np
from PIL import Image
from pycocotools import mask as mask_api
import torch
from torch.nn import functional
from torch.utils.data import Dataset
from transformers import RfDetrForInstanceSegmentation, Trainer, TrainerCallback, TrainingArguments

from building_io import EVIDENCE, REPO, RUNS, configure_offline, read_json, sha, write_json
from prepare_extra_train import closed_chip_lists, refuse_closed_region
from rfdetr_loss import REVISION, repaired_loss, require_finite

BASE = Path("E:/BhuAayam-data/task-data/d07-rfdetr-train-prep-20261005/original")
ROOT = Path("E:/BhuAayam-data/datasets/ramp/coco/train")
BUDGET = 6 * 1024**3
Chip = tuple[Path, dict[str, Any], list[dict[str, Any]]]


def verified_train_coco() -> tuple[dict[str, Any], str]:
    path = ROOT / "_annotations.coco.json"
    receipt = read_json(EVIDENCE / "data/coco-export.json")
    expected = next(record for record in receipt["splits"] if record["split"] == "train")
    if sha(path) != expected["annotations_sha256"]:
        raise ValueError("Frozen TRAIN annotations drift")
    coco = read_json(path)
    split = read_json(EVIDENCE / "split/split.json")["splits"]["train"]
    if sorted(image["source_id"] for image in coco["images"]) != split["chip_ids"]:
        raise ValueError("TRAIN chip identities drift")
    return coco, split["chip_ids_sha256"]


def verified_extra_coco(root: Path) -> dict[str, Any]:
    """Extra TRAIN-only chips: never a closed region, never a DEV, holdout or transfer chip."""
    coco = read_json(root / "_annotations.coco.json")
    for region in sorted({image["region"] for image in coco["images"]}):
        refuse_closed_region(region)
    closed = {chip_id for chip_ids in closed_chip_lists().values() for chip_id in chip_ids}
    if any(image["source_id"] in closed for image in coco["images"]):
        raise ValueError("Extra TRAIN chip belongs to a closed DEV, holdout or transfer list")
    return coco


def smoke_images(images: list[dict[str, Any]], annotations: dict[int, list]) -> list[dict[str, Any]]:
    empty = [image for image in images if not annotations[image["id"]]][:2]
    dense = [image for image in images if len(annotations[image["id"]]) >= 15][:2]
    positive = [image for image in images if annotations[image["id"]] and image not in dense][:4]
    return empty + dense + positive


def load_chips(root: Path, coco: dict[str, Any], smoke: bool, keep_largest: bool) -> list[Chip]:
    annotations: dict[int, list] = defaultdict(list)
    for annotation in coco["annotations"]:
        annotations[annotation["image_id"]].append(annotation)
    images = coco["images"]
    if smoke:
        largest = max(images, key=lambda image: len(annotations[image["id"]]))
        images = smoke_images(images, annotations)
        if keep_largest and largest not in images:
            images.append(largest)
    return [(root, image, annotations[image["id"]]) for image in images]


def chip_counts(chips: list[Chip]) -> dict[str, int]:
    return {
        "chips": len(chips),
        "publisher_features": sum(len(annotations) for _, _, annotations in chips),
        "empty_chips": sum(not annotations for _, _, annotations in chips),
    }


def decode_targets(annotations: list[dict[str, Any]], width: int, height: int) -> tuple[torch.Tensor, torch.Tensor]:
    boxes = []
    masks = []
    for annotation in annotations:
        rle = annotation["segmentation"]
        raw = mask_api.decode(mask_api.frPyObjects(rle, *rle["size"]))
        resized = np.asarray(Image.fromarray(raw).resize((432, 432), Image.Resampling.NEAREST)).copy()
        masks.append(torch.from_numpy(resized))
        left, top, box_width, box_height = annotation["bbox"]
        boxes.append(
            [
                (left + box_width / 2) / width,
                (top + box_height / 2) / height,
                box_width / width,
                box_height / height,
            ]
        )
    box_tensor = torch.tensor(boxes, dtype=torch.float32).reshape(-1, 4)
    mask_tensor = torch.stack(masks) if masks else torch.empty((0, 432, 432), dtype=torch.uint8)
    return box_tensor, mask_tensor


def augment_flips(rgb: torch.Tensor, boxes: torch.Tensor, masks: torch.Tensor) -> tuple[torch.Tensor, ...]:
    if random.random() < 0.5:
        rgb = rgb.flip(-1)
        masks = masks.flip(-1)
        boxes[:, 0] = 1 - boxes[:, 0]
    if random.random() < 0.5:
        rgb = rgb.flip(-2)
        masks = masks.flip(-2)
        boxes[:, 1] = 1 - boxes[:, 1]
    return rgb, boxes, masks


def luma(rgb: torch.Tensor) -> torch.Tensor:
    return 0.299 * rgb[0:1] + 0.587 * rgb[1:2] + 0.114 * rgb[2:3]


def augment_colour(rgb: torch.Tensor, limit: float) -> torch.Tensor:
    """Brightness, then contrast, then saturation, each by a factor within 1 +- limit; labels are untouched."""
    brightness, contrast, saturation = (random.uniform(1 - limit, 1 + limit) for _ in range(3))
    rgb = (rgb * brightness).clamp(0, 1)
    mean = luma(rgb).mean()
    rgb = ((rgb - mean) * contrast + mean).clamp(0, 1)
    grey = luma(rgb)
    return ((rgb - grey) * saturation + grey).clamp(0, 1)


def tile_offset(tile: int, size: int, shift: tuple[float, float]) -> tuple[int, int]:
    """Signed left/top placement of a resized square in its tile: negative crops, positive pads."""
    sign = 1 if size < tile else -1
    return sign * round(shift[0] * abs(size - tile)), sign * round(shift[1] * abs(size - tile))


def scale_to_tile(planes: torch.Tensor, factor: float, shift: tuple[float, float], mode: str) -> torch.Tensor:
    """Resize square planes by the factor, then crop or zero-pad back to the original tile."""
    tile = planes.shape[-1]
    size = round(tile * factor)
    if not planes.shape[0]:
        return planes
    options = {"align_corners": False, "antialias": True} if mode == "bilinear" else {}
    resized = functional.interpolate(planes[None].float(), size=(size, size), mode=mode, **options)[0]
    left, top = tile_offset(tile, size, shift)
    if size >= tile:
        return resized[:, -top : tile - top, -left : tile - left].to(planes.dtype)
    canvas = torch.zeros_like(planes)
    canvas[:, top : top + size, left : left + size] = resized.to(planes.dtype)
    return canvas


def augment_scale(
    rgb: torch.Tensor, boxes: torch.Tensor, masks: torch.Tensor, scale_range: tuple[float, float]
) -> tuple[torch.Tensor, ...]:
    """Random zoom, then crop or pad to the tile; boxes and masks move with the image."""
    factor = random.uniform(*scale_range)
    shift = (random.random(), random.random())
    rgb = scale_to_tile(rgb, factor, shift, "bilinear")
    masks = scale_to_tile(masks, factor, shift, "nearest-exact")
    tile = masks.shape[-1]
    size = round(tile * factor)
    offset = torch.tensor(tile_offset(tile, size, shift) * 2, dtype=torch.float32)
    corners = torch.cat([boxes[:, :2] - boxes[:, 2:] / 2, boxes[:, :2] + boxes[:, 2:] / 2], dim=1)
    corners = ((corners * size + offset) / tile).clamp(0, 1)
    boxes = torch.cat([(corners[:, :2] + corners[:, 2:]) / 2, corners[:, 2:] - corners[:, :2]], dim=1)
    # Existing zero-pixel policy: an instance left with no pixel stays, with a zero mask and a zero box.
    boxes[masks.flatten(1).amax(1) == 0] = 0
    return rgb, boxes, masks


class RampTrain(Dataset):
    def __init__(
        self,
        smoke: bool = False,
        resolution: int = 432,
        extra_roots: Sequence[Path] = (),
        scale_range: tuple[float, float] | None = None,
        colour_jitter: float = 0.0,
    ) -> None:
        coco, split_hash = verified_train_coco()
        base = load_chips(ROOT, coco, smoke, resolution > 432)
        extras = [(root, load_chips(root, verified_extra_coco(root), smoke, True)) for root in extra_roots]
        self.chips = base + [chip for _, chips in extras for chip in chips]
        self.resolution = resolution
        self.smoke = smoke
        self.scale_range = scale_range
        self.colour_jitter = colour_jitter
        self.binding = {
            "split": "train",
            "coco_sha256": sha(ROOT / "_annotations.coco.json"),
            **chip_counts(base),
            "chip_ids": [image["source_id"] for _, image, _ in self.chips] if smoke else None,
            "split_chip_ids_sha256": split_hash,
        }
        if extras:
            self.binding["extra_train"] = [
                {"root": str(root), "coco_sha256": sha(root / "_annotations.coco.json"), **chip_counts(chips)}
                for root, chips in extras
            ]
            self.binding["total"] = chip_counts(self.chips)

    def __len__(self) -> int:
        return len(self.chips)

    def __getitem__(self, index: int) -> dict[str, Any]:
        root, item, annotations = self.chips[index]
        image = Image.open(root / item["file_name"]).convert("RGB")
        if hashlib.sha256(np.asarray(image).tobytes()).hexdigest() != item["rgb_pixel_sha256"]:
            raise ValueError("TRAIN source pixels drift")
        width, height = image.size
        if width > 512 or height > 512:
            raise ValueError("TRAIN chip exceeds production single tile; explicit tiling required")
        resized = np.asarray(image.resize((self.resolution, self.resolution), Image.Resampling.BILINEAR)).copy()
        rgb = torch.from_numpy(resized).permute(2, 0, 1).float() / 255
        # Preserve epoch4's 432-pixel supervision; criterion samples normalized coordinates independently.
        boxes, masks = decode_targets(annotations, width, height)
        # Keep zero-pixel publisher masks and their box/class supervision.
        if not self.smoke:
            rgb, boxes, masks = augment_flips(rgb, boxes, masks)
        if self.colour_jitter:
            rgb = augment_colour(rgb, self.colour_jitter)
        if self.scale_range:
            rgb, boxes, masks = augment_scale(rgb, boxes, masks, self.scale_range)
        mean = torch.tensor([0.485, 0.456, 0.406])[:, None, None]
        std = torch.tensor([0.229, 0.224, 0.225])[:, None, None]
        return {
            "pixel_values": (rgb - mean) / std,
            "labels": {"class_labels": torch.zeros(len(boxes), dtype=torch.int64), "boxes": boxes, "masks": masks},
        }


def collate(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "pixel_values": torch.stack([row["pixel_values"] for row in rows]),
        "labels": [row["labels"] for row in rows],
    }


class FiniteTrainer(Trainer):
    def __init__(self, *args: Any, journal: TextIO, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.journal = journal
        self.micro_losses: list[float] = []

    def compute_loss(
        self,
        model: Any,
        inputs: dict[str, Any],
        return_outputs: bool = False,
        num_items_in_batch: Any = None,
    ) -> Any:
        result = model(**inputs)
        require_finite(result.loss, result.loss_dict)
        if model.training:
            value = float(result.loss.detach())
            self.micro_losses.append(value)
            self.journal.write(
                json.dumps(
                    {
                        "event": "micro_step",
                        "optimizer_step": self.state.global_step,
                        "loss": value,
                        "at": datetime.now(timezone.utc).isoformat(),
                        "peak_reserved_bytes": torch.cuda.max_memory_reserved(),
                    }
                )
                + "\n"
            )
        return (result.loss, result) if return_outputs else result.loss


def stopping_delta(recipe: dict[str, Any]) -> float:
    """Recall patience is strict and F1 needs .001 unless the recipe states its own minimum improvement."""
    configured = recipe.get("early_stopping_min_delta")
    if configured is not None:
        return configured
    return 0.0 if recipe.get("early_stopping_metric") == "recall" else 0.001


def restore_dev_patience(recipe: dict[str, Any]) -> tuple[float, int]:
    if not recipe.get("resume"):
        return -1.0, 0
    previous = Path(recipe["resume"]).parent / "dev-selection.jsonl"
    if not previous.is_file():
        raise ValueError("Resume requires the original DEV selection journal")
    records = [json.loads(line) for line in previous.read_text().splitlines()]
    resume_epoch = int(read_json(Path(recipe["resume"]) / "trainer_state.json")["epoch"])
    if not any(record["epoch"] == resume_epoch for record in records):
        raise ValueError("Resume checkpoint must have its DEV score recorded")
    metric = "recall" if recipe.get("early_stopping_metric") == "recall" else "dev_f1"
    minimum_delta = stopping_delta(recipe)
    checkpoint_recipe = read_json(Path(recipe["resume"]) / "training-config.json")
    checkpoint_recipe["early_stopping_metric"] = recipe.get("early_stopping_metric", "f1")
    checkpoint_recipe["early_stopping_min_delta"] = recipe.get("early_stopping_min_delta")
    best, bad_epochs = restore_dev_patience(checkpoint_recipe)
    for record in records:
        if record["epoch"] > resume_epoch:
            continue
        improved = record[metric] > best + minimum_delta
        bad_epochs = 0 if improved else bad_epochs + 1
        if improved:
            best = record[metric]
    return best, bad_epochs


def offload_optimizer(optimizer: Any) -> list[tuple[dict, str, torch.device]]:
    original_devices = []
    for values in optimizer.state.values():
        for key, value in list(values.items()):
            if torch.is_tensor(value) and value.is_cuda:
                original_devices.append((values, key, value.device))
                values[key] = value.cpu()
    return original_devices


def evaluate_checkpoint(
    output: Path, checkpoint: Path, epoch: int, threshold: float = 0.5, size_bins: bool = False
) -> tuple[str, dict[str, Any]]:
    run_id = f"{output.name}-epoch{epoch:03d}-dev-t{round(threshold * 100):03d}"
    command = [
        sys.executable,
        "-B",
        "-u",
        str(REPO / "scripts/ml/eval_buildings.py"),
        "--model",
        str(checkpoint),
        "--split",
        "dev",
        "--provider",
        "cuda",
        "--run-id",
        run_id,
        "--score-threshold",
        str(threshold),
        "--artifacts-dir",
        str(output / f"epoch-{epoch:03d}-dev-t{round(threshold * 100):03d}"),
    ]
    if size_bins:
        command.append("--size-bins")
    with (output / f"epoch-{epoch:03d}-dev-t{round(threshold * 100):03d}.log").open("x") as log:
        subprocess.run(command, cwd=REPO, stdout=log, stderr=subprocess.STDOUT, check=True)
    return run_id, read_json(EVIDENCE / run_id / "result.json")


class DevEpochs(TrainerCallback):
    def __init__(self, output: Path, recipe: dict[str, Any], smoke: bool, duration_minutes: float) -> None:
        self.output = output
        self.recipe = recipe
        self.smoke = smoke
        self.start = time.monotonic()
        self.duration = duration_minutes * 60
        self.best_score, self.bad_epochs = restore_dev_patience(recipe)
        if self.bad_epochs >= 3:
            raise ValueError("DEV patience already exhausted; do not relaunch the same experiment")
        self.metric = recipe.get("early_stopping_metric", "f1")
        self.minimum_delta = stopping_delta(recipe)
        self.results: list[dict[str, Any]] = []
        self.trainer: FiniteTrainer | None = None

    def on_pre_optimizer_step(self, args: Any, state: Any, control: Any, model: Any = None, **kwargs: Any) -> None:
        if any(
            parameter.grad is not None and not torch.isfinite(parameter.grad).all() for parameter in model.parameters()
        ):
            raise FloatingPointError("Non-finite unscaled gradients: stop before optimizer")
        if torch.cuda.max_memory_reserved() > BUDGET:
            raise RuntimeError("Training exceeded 6 GiB reserved-memory budget")

    def save_checkpoint(self, model: Any, state: Any, epoch: int) -> Path:
        checkpoint = self.output / f"epoch-{epoch:03d}"
        checkpoint.mkdir(exist_ok=False)
        model.save_pretrained(checkpoint, safe_serialization=True)
        assert self.trainer is not None
        # Standard local Trainer state; no remote pickle/checkpoint is loaded.
        self.trainer._save_optimizer_and_scheduler(str(checkpoint))
        self.trainer._save_scaler(str(checkpoint))
        self.trainer._save_rng_state(str(checkpoint))
        state.save_to_json(str(checkpoint / "trainer_state.json"))
        write_json(checkpoint / "training-config.json", self.recipe)
        return checkpoint

    def record_dev(self, checkpoint: Path, epoch: int, run_id: str, result: dict[str, Any]) -> None:
        metrics = result["metrics"]["per_building"]
        score = 2 * metrics["tp"] / (2 * metrics["tp"] + metrics["fp"] + metrics["fn"])
        stopping_score = metrics["recall"] if self.metric == "recall" else score
        improved = stopping_score > self.best_score + self.minimum_delta
        self.bad_epochs = 0 if improved else self.bad_epochs + 1
        if improved:
            self.best_score = stopping_score
        entry = {
            "epoch": epoch,
            "checkpoint": str(checkpoint),
            "dev_run_id": run_id,
            "dev_f1": score,
            "precision": metrics["precision"],
            "recall": metrics["recall"],
            "empty_fp": result["metrics"]["false_buildings_on_empty"],
            "improved": improved,
            "bad_epochs": self.bad_epochs,
            "peak_reserved_bytes": torch.cuda.max_memory_reserved(),
            "early_stopping_metric": self.metric,
            "size_recall": result.get("size_recall"),
        }
        self.results.append(entry)
        with (self.output / "dev-selection.jsonl").open("a") as journal:
            journal.write(json.dumps(entry) + "\n")
        print(json.dumps({"event": "epoch_dev", **entry}), flush=True)

    def should_stop(self, epoch: int) -> bool:
        # Stop at a fully scored checkpoint, never mid-accumulation.
        deadline = time.monotonic() - self.start >= self.duration
        return self.bad_epochs >= 3 or epoch >= self.recipe.get("max_epochs", 12) or deadline

    def on_epoch_end(
        self,
        args: Any,
        state: Any,
        control: Any,
        model: Any = None,
        optimizer: Any = None,
        **kwargs: Any,
    ) -> Any:
        if self.smoke or round(state.epoch) < 1:
            return control
        epoch = round(state.epoch)
        checkpoint = self.save_checkpoint(model, state, epoch)
        model.to("cpu")
        devices = offload_optimizer(optimizer)
        torch.cuda.empty_cache()
        try:
            evaluations = []
            for threshold in self.recipe.get("dev_thresholds", [0.5]):
                run_id, result = evaluate_checkpoint(
                    self.output, checkpoint, epoch, threshold, self.recipe.get("size_bins", False)
                )
                evaluations.append(
                    {
                        "threshold": threshold,
                        "run_id": run_id,
                        "metrics": result["metrics"],
                        "size_recall": result.get("size_recall"),
                    }
                )
                if threshold == 0.5:
                    self.record_dev(checkpoint, epoch, run_id, result)
            write_json(self.output / f"epoch-{epoch:03d}-dev.json", {"epoch": epoch, "evaluations": evaluations})
        finally:
            model.to("cuda")
            for values, key, device in devices:
                values[key] = values[key].to(device)
        if self.should_stop(epoch):
            control.should_training_stop = True
        return control


def check_added_arguments(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    if args.init_weights and args.resume:
        parser.error("Choose a fresh start from weights or a resume, not both")
    if args.scale_range and not 0.5 <= args.scale_range[0] <= 1 <= args.scale_range[1] <= 2:
        parser.error("Scale range must bracket 1 within [0.5, 2]")
    if not 0 <= args.colour_jitter <= 0.5:
        parser.error("Colour jitter limit must lie in [0, 0.5]")
    if args.early_stopping_min_delta is not None and args.early_stopping_min_delta < 0:
        parser.error("The minimum improvement cannot be negative")
    if args.max_steps is not None and (args.max_steps < 1 or args.smoke):
        parser.error("The timing probe needs a positive step count and is separate from --smoke")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--duration-minutes", type=float, default=85)
    parser.add_argument("--resume", type=Path)
    parser.add_argument("--resolution", type=int, default=432)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--accumulation", type=int, default=4)
    parser.add_argument("--max-epochs", type=int, default=12)
    parser.add_argument("--checkpoint-backbone", action="store_true")
    parser.add_argument("--checkpoint-decoder", action="store_true")
    parser.add_argument("--size-bins", action="store_true")
    parser.add_argument("--early-stopping-metric", choices=("f1", "recall"), default="f1")
    parser.add_argument("--dev-thresholds", type=float, nargs="+", default=[0.5])
    parser.add_argument("--init-weights", type=Path, help="Start from these weights with a fresh optimizer")
    parser.add_argument("--extra-train-root", type=Path, nargs="+", default=[], help="Extra TRAIN-only COCO roots")
    parser.add_argument("--scale-range", type=float, nargs=2, metavar=("MIN", "MAX"), help="TRAIN zoom factors")
    parser.add_argument("--colour-jitter", type=float, default=0.0, help="TRAIN brightness/contrast/saturation limit")
    parser.add_argument("--early-stopping-min-delta", type=float, help="Smallest DEV improvement that resets patience")
    parser.add_argument("--max-steps", type=int, help="Timing probe: stop after this many optimizer steps")
    args = parser.parse_args()
    check_added_arguments(parser, args)
    if 0.5 not in args.dev_thresholds or any(not 0 < value < 1 for value in args.dev_thresholds):
        parser.error("DEV thresholds must include .5 and lie strictly between zero and one")
    if args.resolution < 432 or args.resolution % 24:
        parser.error("RF-DETR resolution must be at least 432 and divisible by 24")
    if args.batch_size * args.accumulation != 4 or min(args.batch_size, args.accumulation) < 1:
        parser.error("Preserve effective batch 4 with positive batch size and accumulation")
    if args.max_epochs < 1 or args.max_epochs > 12:
        parser.error("Maximum epochs must be between 1 and 12")
    if args.resolution > 432 and args.max_epochs > 8:
        parser.error("Higher-resolution B6 ceiling is 8 epochs")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.run_id):
        parser.error("Simple unique run-id required")
    return args


COMPARISON_NOTE = (
    "Versus epoch 4, resolution and the chunked mask loss both differ. The chunked loss is CPU-proven identical "
    "to upstream in values and gradients, so resolution is the principal factor."
)


EXTRA_DATA_NOTE = (
    "Versus epoch 4, the extra TRAIN regions and the scale/colour augmentation both differ and are not separated. "
    "The chunked mask loss is CPU-proven identical to upstream in values and gradients."
)


def augmentation_note(args: argparse.Namespace) -> str:
    note = "TRAIN horizontal/vertical flips only; smoke none"
    if args.colour_jitter:
        note += f"; then brightness/contrast/saturation factors within 1 +- {args.colour_jitter}"
    if args.scale_range:
        low, high = args.scale_range
        note += f"; then zoom factor in [{low}, {high}] with random crop or black pad back to the tile"
    return note


def stopping_note(args: argparse.Namespace) -> str:
    note = f"DEV {args.early_stopping_metric} at .5, patience 3"
    if args.early_stopping_min_delta is not None:
        note += f", min_delta {args.early_stopping_min_delta}"
    return note


def training_recipe(args: argparse.Namespace, dataset: RampTrain) -> dict[str, Any]:
    return {
        "framework": "Transformers Trainer / RF-DETR segmentation",
        "base": str(BASE),
        "base_sha256": sha(BASE / "model.safetensors"),
        "init_weights": str(args.init_weights) if args.init_weights else None,
        "init_weights_sha256": sha(args.init_weights / "model.safetensors") if args.init_weights else None,
        "seed": 26011,
        "batch_size": args.batch_size,
        "gradient_accumulation_steps": args.accumulation,
        "input_resolution": args.resolution,
        "target_mask_resolution": 432,
        "checkpoint_backbone": args.checkpoint_backbone,
        "checkpoint_decoder": args.checkpoint_decoder,
        "size_bins": args.size_bins,
        "learning_rate_heads": 1e-4,
        "learning_rate_backbone": 1e-5,
        "amp": "bf16",
        "max_epochs": args.max_epochs,
        "lr_scheduler": "constant",
        "early_stopping": stopping_note(args),
        "early_stopping_metric": args.early_stopping_metric,
        "early_stopping_min_delta": args.early_stopping_min_delta,
        "max_steps": args.max_steps,
        "dev_thresholds": args.dev_thresholds,
        "preprocessing": f"RGB Pillow bilinear {args.resolution}; ImageNet; source tiles <=512; stride384",
        "augmentation": augmentation_note(args),
        "zero_pixel_masks": "Retained; box/class and zero mask supervised; no relabel/drop",
        "loss_revision": REVISION,
        "comparison_note": EXTRA_DATA_NOTE if args.extra_train_root else COMPARISON_NOTE,
        "data": dataset.binding,
        "resume": str(args.resume) if args.resume else None,
        "git_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
        "smoke": args.smoke,
        "holdout_calls": 0,
        "duration_minutes": args.duration_minutes,
    }


def training_arguments(
    output: Path, smoke: bool, batch_size: int = 1, accumulation: int = 4, max_steps: int | None = None
) -> TrainingArguments:
    return TrainingArguments(
        output_dir=str(output / "trainer"),
        max_steps=50 if smoke else max_steps or -1,
        # Keep B3's Trainer default; callback independently enforces the requested B6 epoch ceiling.
        num_train_epochs=12,
        per_device_train_batch_size=batch_size,
        gradient_accumulation_steps=accumulation,
        learning_rate=1e-4,
        weight_decay=1e-4,
        lr_scheduler_type="constant",
        bf16=True,
        seed=26011,
        data_seed=26011,
        dataloader_num_workers=0,
        dataloader_pin_memory=False,
        remove_unused_columns=False,
        save_strategy="no",
        eval_strategy="no",
        logging_steps=10,
        report_to="none",
        disable_tqdm=True,
        max_grad_norm=0.1,
        logging_nan_inf_filter=False,
    )


def configure_resolution(
    model: Any, resolution: int, checkpoint_backbone: bool, checkpoint_decoder: bool = False
) -> None:
    from transformers.models.rf_detr.modeling_rf_detr import RfDetrDinov2Backbone

    config = model.config.backbone_config
    multiple = config.patch_size * config.num_windows
    if resolution < 432 or resolution % multiple:
        raise ValueError(f"Resolution must be at least 432 and divisible by patch/window multiple {multiple}")
    if model.config.to_dict().get("ulpin_input_resolution", resolution) != resolution:
        raise ValueError("Resume checkpoint resolution differs; do not silently change its recipe")
    model.config.ulpin_input_resolution = resolution
    if checkpoint_backbone:
        backbones = [module for module in model.modules() if isinstance(module, RfDetrDinov2Backbone)]
        if len(backbones) != 1:
            raise ValueError("Expected one HF RF-DETR DINOv2 backbone")
        backbones[0].gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    if checkpoint_decoder:
        from functools import partial
        from torch.utils.checkpoint import checkpoint

        model.model.model.decoder._set_gradient_checkpointing(
            enable=True, gradient_checkpointing_func=partial(checkpoint, use_reentrant=False, preserve_rng_state=True)
        )


def load_model_optimizer(
    resume: Path | None, resolution: int = 432, checkpoint_backbone: bool = False, checkpoint_decoder: bool = False
) -> tuple[Any, torch.optim.Optimizer]:
    model = RfDetrForInstanceSegmentation.from_pretrained(
        resume or BASE,
        local_files_only=True,
        use_safetensors=True,
        attn_implementation="eager",
    )
    if resume and model.config.to_dict().get("ulpin_input_resolution", 432) != resolution:
        raise ValueError("Resume checkpoint resolution differs; start a separately authorized experiment")
    configure_resolution(model, resolution, checkpoint_backbone, checkpoint_decoder)
    model.loss_function = repaired_loss()
    model.to("cuda")
    groups = [
        {"params": [value for name, value in model.named_parameters() if "backbone" not in name], "lr": 1e-4},
        {"params": [value for name, value in model.named_parameters() if "backbone" in name], "lr": 1e-5},
    ]
    return model, torch.optim.AdamW(groups, weight_decay=1e-4)


def training_result(trainer: FiniteTrainer, callback: DevEpochs, output: Path, seconds: float) -> dict[str, Any]:
    first = float(np.mean(trainer.micro_losses[:20]))
    last = float(np.mean(trainer.micro_losses[-20:]))
    status = "passed"
    if callback.smoke and last >= first:
        status = "failed_loss_not_falling"
    return {
        "status": status,
        "optimizer_steps": trainer.state.global_step,
        "input_resolution": callback.recipe["input_resolution"],
        "batch_size": callback.recipe["batch_size"],
        "gradient_accumulation_steps": callback.recipe["gradient_accumulation_steps"],
        "checkpoint_backbone": callback.recipe["checkpoint_backbone"],
        "checkpoint_decoder": callback.recipe["checkpoint_decoder"],
        "micro_steps": len(trainer.micro_losses),
        "first_20_mean_loss": first,
        "last_20_mean_loss": last,
        "peak_allocated_bytes": torch.cuda.max_memory_allocated(),
        "peak_reserved_bytes": torch.cuda.max_memory_reserved(),
        "budget_bytes": BUDGET,
        "seconds": seconds,
        "dev_epochs": callback.results,
        "holdout_calls": 0,
        "run_config_sha256": sha(output / "run-config.json"),
    }


def execute_training(args: argparse.Namespace, output: Path, dataset: RampTrain, recipe: dict[str, Any]) -> None:
    model, optimizer = load_model_optimizer(
        args.resume or args.init_weights, args.resolution, args.checkpoint_backbone, args.checkpoint_decoder
    )
    callback = DevEpochs(output, recipe, args.smoke, args.duration_minutes)
    with (output / "steps.jsonl").open("x", buffering=1) as journal:
        trainer = FiniteTrainer(
            model=model,
            args=training_arguments(output, args.smoke, args.batch_size, args.accumulation, args.max_steps),
            train_dataset=dataset,
            data_collator=collate,
            optimizers=(optimizer, None),
            callbacks=[callback],
            journal=journal,
        )
        callback.trainer = trainer
        started = time.monotonic()
        try:
            trainer.train(resume_from_checkpoint=str(args.resume) if args.resume else None)
            result = training_result(trainer, callback, output, time.monotonic() - started)
            model.save_pretrained(output / "segment-final", safe_serialization=True)
            write_json(output / "result.json", result)
            print(json.dumps(result), flush=True)
            if result["status"] != "passed":
                raise SystemExit(1)
        except BaseException as error:
            write_json(
                output / "failure.json",
                {
                    "error": str(error),
                    "type": type(error).__name__,
                    "optimizer_step": trainer.state.global_step,
                    "micro_steps": len(trainer.micro_losses),
                    "peak_reserved_bytes": torch.cuda.max_memory_reserved(),
                    "holdout_calls": 0,
                },
            )
            raise


def main() -> None:
    configure_offline()
    args = parse_arguments()
    output = RUNS / args.run_id
    output.mkdir(parents=True, exist_ok=True)
    if (output / "run-config.json").exists():
        raise FileExistsError("Preserve every run; use a new id")
    torch.set_num_threads(2)
    torch.manual_seed(26011)
    random.seed(26011)
    np.random.seed(26011)
    torch.cuda.set_per_process_memory_fraction(0.75)
    dataset = RampTrain(args.smoke, args.resolution, args.extra_train_root, args.scale_range, args.colour_jitter)
    recipe = training_recipe(args, dataset)
    write_json(output / "run-config.json", recipe)
    execute_training(args, output, dataset, recipe)


if __name__ == "__main__":
    main()
