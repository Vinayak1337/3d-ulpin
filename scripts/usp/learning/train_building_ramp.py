#!/usr/bin/env python3
"""Plan continuation of the exact deployed RF-DETR source with standard Transformers Trainer.

Plan-only uses stdlib, reads hashes/COCO metadata, and never imports Torch or CUDA.
Fitting requires a separate root authorization and effective resource handoff.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import struct
import sys

VERSION = "ramp-transformers-training-plan/1"
BASE_SHA = "f254c1400f780f7ea72a6bc588a2150bf8b4d8845ded7269655e26a275f41ac7"
BASE_BYTES = 141551436
CONFIG_SHA = "41aeed5933ae681d700978ded204c67ec756c775bbaa466ae3b0b11122b5f5c7"
PROCESSOR_SHA = "54287bdd487c98a439f9c8c8039b69544dce6fc1735dca50ca4de4d5bbf27382"
PACKAGES = {"torch": "2.14.0", "torchvision": "0.29.0", "transformers": "5.17.0",
            "accelerate": "1.15.0", "pycocotools": "2.0.11", "pillow": "12.3.0",
            "safetensors": "0.8.0", "numpy": "2.5.3", "scipy": "1.18.1"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path, limit=32 * 1024**2):
    path = Path(path)
    require(path.is_file() and path.stat().st_size <= limit, f"Missing/oversized JSON: {path}")
    def invalid(value):
        raise ValueError(f"Non-finite JSON: {value}")
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f"Duplicate JSON key: {key}")
            result[key] = value
        return result
    return json.loads(path.read_bytes(), parse_constant=invalid, object_pairs_hook=unique_pairs)


def file_pin(path, max_bytes=512 * 1024**2):
    path = Path(path).resolve(strict=True)
    require(path.is_file() and 0 < path.stat().st_size <= max_bytes, f"Invalid artifact size: {path}")
    with path.open("rb") as stream:
        sha = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": sha}


def check_pin(pin):
    require(set(pin) == {"path", "bytes", "sha256"}, "Artifact requires path/bytes/sha256")
    actual = file_pin(pin["path"])
    require(actual["bytes"] == pin["bytes"] and actual["sha256"] == pin["sha256"], f"Artifact drift: {pin['path']}")
    return Path(actual["path"])


def contained(path, root):
    path = Path(path).resolve(strict=True)
    require(path.is_relative_to(root), f"Path escapes dataset: {path}")
    return path


def validate_pool(root, split, annotation_pin):
    path = check_pin(annotation_pin)
    require(path == root / split / "_annotations.coco.json", "Unexpected COCO split path")
    coco = read_json(path)
    require(len(coco["categories"]) == 1 and coco["categories"][0]["id"] == 1 and coco["categories"][0]["name"] == "rooftop_building", "Expected one rooftop_building category, id1")
    images = coco["images"]
    require(len(images) == 24, f"Expected the fixed 24 {split} images")
    indexed = {}
    pins = []
    for image in images:
        image_id = image["id"]
        require(isinstance(image_id, int) and image_id not in indexed, "Duplicate/invalid image ID")
        require(isinstance(image["file_name"], str) and Path(image["file_name"]).name == image["file_name"], "Expected local PNG filename")
        image_path = contained(root / split / image["file_name"], root / split)
        with image_path.open("rb") as stream:
            head = stream.read(24)
        require(head[:16] == b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR", "Expected lossless PNG")
        width, height = struct.unpack(">II", head[16:24])
        require([width, height] == [image["width"], image["height"]] and 0 < width * height <= 4_000_000, "Image frame mismatch/too large")
        indexed[image_id] = image
        pins.append(file_pin(image_path, 16 * 1024**2))
    require(len({p["sha256"] for p in pins}) == len(pins), "Repeated image bytes inside pool")
    seen = set()
    for ann in coco["annotations"]:
        require(isinstance(ann["id"], int) and ann["id"] not in seen, "Duplicate/invalid annotation ID")
        seen.add(ann["id"])
        require(ann["image_id"] in indexed and ann["category_id"] == 1 and ann["iscrowd"] == 0, "Annotation identity/class/crowd mismatch")
        image = indexed[ann["image_id"]]
        x, y, w, h = ann["bbox"]
        require(all(isinstance(v, (int, float)) and math.isfinite(v) for v in [x, y, w, h, ann["area"]]), "Invalid bbox/area")
        require(0 <= x < x+w <= image["width"] and 0 <= y < y+h <= image["height"] and 0 < ann["area"] <= w*h, "Out-of-frame bbox/area")
        rle = ann["segmentation"]
        require(isinstance(rle, dict) and rle["size"] == [image["height"], image["width"]], "Expected source-frame RLE, preserving holes")
        require(isinstance(rle["counts"], (str, list)) and len(rle["counts"]) > 0, "Invalid RLE counts")
        if isinstance(rle["counts"], list):
            require(all(isinstance(v, int) and v >= 0 for v in rle["counts"]) and sum(rle["counts"]) == image["width"]*image["height"], "Incomplete RLE")
    return {"split": split, "annotationPin": annotation_pin, "imagePins": pins, "images": len(images), "instances": len(seen)}


def build_plan(config_path):
    config_path = Path(config_path).resolve(strict=True)
    config = read_json(config_path, 1024**2)
    require(config["schemaVersion"] == VERSION and config["modelScope"] == "exact_deployed_transformers_source", "Wrong plan/model scope")
    weights = check_pin(config["weights"])
    require(config["weights"]["sha256"] == BASE_SHA and config["weights"]["bytes"] == BASE_BYTES, "Only the exact deployed model source checkpoint is supported")
    model_config = check_pin(config["modelConfig"])
    processor_config = check_pin(config["processorConfig"])
    require(model_config == weights.parent / "config.json" and processor_config == weights.parent / "preprocessor_config.json", "Original model/processor files must be beside checkpoint")
    require(config["modelConfig"]["sha256"] == CONFIG_SHA and config["processorConfig"]["sha256"] == PROCESSOR_SHA, "Checkpoint configuration drift")
    architecture = read_json(model_config)
    require(architecture["architectures"] == ["RfDetrForInstanceSegmentation"] and architecture["id2label"] == {"0": "building"} and architecture["label2id"] == {"building": 0}, "Existing one-class head must remain unchanged")
    root = Path(config["datasetRoot"]).resolve(strict=True)
    require(not (root / "test").exists(), "A final/test directory is forbidden in this preparation pool")
    manifest_path = check_pin(config["datasetManifest"])
    require(manifest_path.parent == root, "Dataset manifest must be adjacent to pools")
    pools = [validate_pool(root, s, config[key]) for s, key in [("train", "trainAnnotations"), ("valid", "developmentAnnotations")]]
    require(not ({p["sha256"] for p in pools[0]["imagePins"]} & {p["sha256"] for p in pools[1]["imagePins"]}), "Train/development image overlap")
    # The data owner pins source identities, label provenance, conservative site groups and ambiguity policy.
    # A separate frozen eligibility receipt is required at execution; export alone grants no fit admission.
    manifest = read_json(manifest_path)
    require(manifest["task"] == "D06-RAMP-COCO-PREP" and manifest["fitAdmission"] == "not_fit_admitted" and manifest["finalOrTestSelection"] is False, "Expected prepared research pools, not implicit fit/final admission")
    require([s["split"] for s in manifest["splits"]] == ["train", "valid"] and manifest["splits"][0]["sourceParent"] == "105001001597B000" and manifest["splits"][1]["sourceParent"] == "104001002CA32300", "Fixed source groups changed")
    require(manifest["splits"][0]["sourceGroup"] != manifest["splits"][1]["sourceGroup"], "Source group overlap")
    require(all(s["annotations"] == config[k] for s, k in zip(manifest["splits"], ["trainAnnotations", "developmentAnnotations"])), "COCO pins differ from provenance manifest")
    mapped = {(row["split"], row["imageId"]): row for row in manifest["images"]}
    require(len(mapped) == 48, "Expected complete source provenance for every exported image")
    for pool, source_split in zip(pools, manifest["splits"]):
        coco = read_json(pool["annotationPin"]["path"])
        for image, image_pin in zip(coco["images"], pool["imagePins"]):
            row = mapped[(pool["split"], image["id"])]
            require(row["sourceGroup"] == source_split["sourceGroup"] and row["sourceParent"] == source_split["sourceParent"], "Source grouping drift")
            require(row["image"]["sha256"] == image_pin["sha256"] and row["image"]["bytes"] == image_pin["bytes"] and Path(row["image"]["path"]).resolve() == Path(image_pin["path"]), "Image differs from retained source mapping")
    require(config["trainSource"] == "ramp-barishal" and config["developmentSource"] == "ramp-karnataka", "Pool roles cannot be swapped")
    require(config["libraryVersion"] == "5.17.0", "Unreviewed Transformers version")
    require(isinstance(config["seed"], int) and 0 <= config["seed"] < 2**32, "Invalid seed")
    epochs = config["epochs"]
    require(isinstance(epochs, int) and 1 <= epochs <= 5, "Preparation supports one bounded experiment of 1–5 epochs")
    output = Path(config["outputDir"]).resolve()
    protected = [root, weights.parent, config_path.parent]
    require(all(not output.is_relative_to(p) and not p.is_relative_to(output) for p in protected), "Output overlaps retained data/config/weights")
    versions = {}
    for name in PACKAGES:
        try: versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError: versions[name] = None
    kwargs = {"output_dir": str(output), "num_train_epochs": epochs, "per_device_train_batch_size": 1,
              "per_device_eval_batch_size": 1, "gradient_accumulation_steps": 4,
              "learning_rate": 1e-4, "weight_decay": 1e-4, "seed": config["seed"], "data_seed": config["seed"],
              "dataloader_num_workers": 0, "remove_unused_columns": False, "eval_strategy": "epoch",
              "save_strategy": "no", "prediction_loss_only": True, "report_to": "none", "push_to_hub": False,
              "fp16": True, "gradient_checkpointing": True, "optim": "adamw_torch", "logging_steps": 1,
              "label_names": ["labels"], "use_cpu": False, "torch_compile": False}
    plan = {"schemaVersion": VERSION, "scriptPin": file_pin(__file__), "configPin": file_pin(config_path), "datasetManifest": config["datasetManifest"],
            "weights": config["weights"], "modelConfig": config["modelConfig"], "processorConfig": config["processorConfig"],
            "modelScope": config["modelScope"], "libraryVersion": "5.17.0",
            "pools": pools, "trainSource": config["trainSource"], "developmentSource": config["developmentSource"],
            "trainingArguments": kwargs, "classMapping": {"cocoCategory1": "rooftop_building", "modelLabel0": "building", "mappingScope": "explicit research roof target; no cadastral/operational footprint truth"},
            "initialHead": "Original one-class config/weights retained; no num_labels override, ignore_mismatched_sizes or head reinitialization.",
            "checkpointLoading": "Publisher safetensors/config pins match deployed ONNX source; source-verified supervised loss; numerical model/ONNX parity and capacity unexecuted.",
            "preprocessing": "RGB Pillow bilinear square432 then original processor rescale/ImageNet normalization with resize disabled. Targets: standard pycocotools RLE decode, Pillow nearest masks, scaled source boxes; originals untouched. No inference profile/threshold change.",
            "installedPackageMetadata": versions, "trainingAuthorized": False,
            "blockers": ["Root measured-residual authorization", "Frozen eligible source-group supervision and category/head baseline",
                         "Unchanged source-checkpoint open-development baseline and Torch/ONNX preprocessing parity", "Single model/GPU ownership transfer",
                         "Effective network/resource preflight for this exact training process", "Isolated resolved dependency lock and safe matching checkpoint loading"]}
    encoded = json.dumps(plan, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    plan["planSha256"] = hashlib.sha256(encoded).hexdigest()
    return plan, manifest


def check_gate(path, expected_sha, plan):
    require(path is not None and expected_sha is not None, "Execution blocked: a root authorization/handoff receipt and exact hash are required")
    require(file_pin(path)["sha256"] == expected_sha, "Authorization receipt hash mismatch")
    gate = read_json(path, 1024**2)
    require(gate["schemaVersion"] == "ramp-training-authorization/1" and gate["planSha256"] == plan["planSha256"], "Authorization belongs to another plan")
    require(gate["rootThreadId"] == "01a0ed8a-4383-79c3-a0ae-35c1e969ef66" and gate["rootAuthorized"] is True, "Root has not authorized fitting")
    for name in ["measuredResidual", "frozenEligibleGroupedSupervision", "sameCheckpointDevelopmentBaseline", "torchOnnxPreprocessingParity", "environmentLock"]:
        check_pin(gate[name])
    preflight = gate["preflight"]
    require(preflight["pid"] == os.getpid() and preflight["gpuOwnerTransferred"] is True, "No live exclusive resource handoff for this process")
    require(preflight["effectiveNetworkDenied"] is True and preflight["effectiveResourceLimits"] is True, "Effective network/resource guard not verified")
    check_pin(preflight["receipt"])
    require(all(plan["installedPackageMetadata"][p] and plan["installedPackageMetadata"][p].split("+")[0] == v for p, v in PACKAGES.items()), "Install the isolated pinned recipe and freeze dependencies before execution")
    return gate


def execute(plan, gate):
    # This layer supplements the required external process guard; it does not claim
    # to enforce OS/CUDA limits or block native egress by itself.
    os.environ.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1",
                       "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2", "WANDB_MODE": "disabled"})
    def offline(event, args):
        if event in {"socket.connect", "socket.getaddrinfo", "socket.bind", "socket.sendto", "subprocess.Popen", "os.system"}:
            raise RuntimeError("Training is local and offline; network/child launch refused")
    sys.addaudithook(offline)
    import torch
    import numpy as np
    from PIL import Image
    from pycocotools import mask as coco_mask
    from transformers import RfDetrForInstanceSegmentation, RfDetrImageProcessor, Trainer, TrainingArguments, set_seed
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    require(torch.cuda.is_available() and torch.cuda.device_count() == 1, "Preflight must expose exactly one authorized GPU")
    output = Path(plan["trainingArguments"]["output_dir"])
    output.mkdir(parents=True, exist_ok=False)
    (output / "plan.json").write_text(json.dumps(plan, indent=2)+"\n")
    set_seed(plan["trainingArguments"]["seed"])
    original = str(Path(plan["weights"]["path"]).parent)
    model, loading = RfDetrForInstanceSegmentation.from_pretrained(original, local_files_only=True, use_safetensors=True, attn_implementation="eager", output_loading_info=True)
    require(not any(loading.get(k) for k in ["missing_keys", "unexpected_keys", "mismatched_keys", "error_msgs"]), "Matching checkpoint failed complete load; no random replacement allowed")
    require(model.config.id2label == {0: "building"} and model.config.num_labels == 1, "Original classification head changed")
    processor = RfDetrImageProcessor.from_pretrained(original, local_files_only=True)

    class CocoPool:
        """Small source adapter only; losses, optimizer, evaluation and fitting belong to Trainer."""
        def __init__(self, pool):
            self.path = Path(pool["annotationPin"]["path"])
            data = read_json(self.path)
            self.images = data["images"]
            self.annotations = {image["id"]: [] for image in self.images}
            for ann in data["annotations"]: self.annotations[ann["image_id"]].append(ann)

        def __len__(self): return len(self.images)

        def __getitem__(self, index):
            source = self.images[index]
            with Image.open(self.path.parent / source["file_name"]) as image:
                rgb = image.convert("RGB").resize((432, 432), Image.Resampling.BILINEAR)
            sx, sy = 432/source["width"], 432/source["height"]
            annotations, masks = [], []
            for original_ann in self.annotations[source["id"]]:
                rle = original_ann["segmentation"]
                if isinstance(rle["counts"], list): rle = coco_mask.frPyObjects(rle, source["height"], source["width"])
                decoded = coco_mask.decode(rle)
                mask = np.asarray(Image.fromarray(decoded).resize((432, 432), Image.Resampling.NEAREST)).copy()
                require(mask.shape == (432, 432) and mask.any(), "Resize erased an instance; retain source and revise the bounded preparation rather than dropping it")
                masks.append(torch.as_tensor(mask, dtype=torch.uint8))
                x, y, w, h = original_ann["bbox"]
                annotations.append({"id": original_ann["id"], "image_id": source["id"], "category_id": 0,
                                    "iscrowd": 0, "bbox": [x*sx, y*sy, w*sx, h*sy], "area": int(mask.sum())})
            encoded = processor(images=rgb, annotations={"image_id": source["id"], "annotations": annotations},
                                return_segmentation_masks=False, do_resize=False, do_pad=False, return_tensors="pt")
            target = encoded["labels"][0]
            require(len(target["class_labels"]) == len(annotations), "Processor discarded source instances")
            target["masks"] = torch.stack(masks) if masks else torch.zeros((0, 432, 432), dtype=torch.uint8)
            return {"pixel_values": encoded["pixel_values"][0], "labels": target}

    def collate(batch):
        return {"pixel_values": torch.stack([b["pixel_values"] for b in batch]),
                "pixel_mask": torch.ones((len(batch), 432, 432), dtype=torch.bool), "labels": [b["labels"] for b in batch]}

    trainer = Trainer(model=model, args=TrainingArguments(**plan["trainingArguments"]),
                      train_dataset=CocoPool(plan["pools"][0]), eval_dataset=CocoPool(plan["pools"][1]),
                      data_collator=collate, processing_class=processor)
    fitted = trainer.train()
    require(math.isfinite(fitted.metrics["train_loss"]), "Non-finite training loss; keep the failed run for diagnosis")
    trainer.save_model(str(output / "checkpoint"))
    selected = output / "checkpoint" / "model.safetensors"
    result = {"schemaVersion": "ramp-training-result/1", "planSha256": plan["planSha256"],
              "state": "fit_completed_unqualified", "selectedCheckpoint": file_pin(selected),
              "metrics": fitted.metrics, "developmentLossHistory": trainer.state.log_history,
              "trainingConfig": plan["trainingArguments"], "heldOutTestOpened": False,
              "promotion": False, "accuracyQualification": False}
    (output / "result.json").write_text(json.dumps(result, indent=2, allow_nan=False)+"\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--plan-only", action="store_true", help="Default; no Torch/Transformers/CUDA import or fitting")
    mode.add_argument("--execute", action="store_true")
    parser.add_argument("--authorization", type=Path)
    parser.add_argument("--authorization-sha256")
    args = parser.parse_args()
    plan, _ = build_plan(args.config)
    if args.execute:
        gate = check_gate(args.authorization, args.authorization_sha256, plan)
        print(json.dumps(execute(plan, gate), indent=2))
    else:
        print(json.dumps(plan, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, TypeError) as error:
        print(json.dumps({"state": "blocked", "error": str(error)}), file=sys.stderr)
        raise SystemExit(2)
