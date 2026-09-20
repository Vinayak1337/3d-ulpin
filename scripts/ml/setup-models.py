#!/usr/bin/env python3
"""Install verified local model artifacts; never download models during a request.

Qualified artifacts can be copied from another local checkout/delivery:
  python3 scripts/ml/setup-models.py --source-dir /path/to/qualified-models

Reproduce exports from pinned original code and checkpoint bytes in isolated build
environments (these heavyweight packages are not worker dependencies):
  floor: torch==2.8.0 onnx==1.19.1 gdown==5.2.0
  building: torch==2.14.0 transformers==5.17.0 onnx==1.19.1 onnxscript==0.7.0
  python3 scripts/ml/setup-models.py --build --model cubicasa5k-rooms-onnx-v1
  python3 scripts/ml/setup-models.py --build --model rfdetr-satellite-buildings-onnx-v1

Exports are version-sensitive. A changed exporter artifact is retained for parity
review and never silently registered under the previously qualified hash. The
original weights/code hashes stay fixed. No API key or paid service is used.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def checksum(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def matches(path, receipt):
    return path.is_file() and path.stat().st_size == receipt["bytes"] and checksum(path) == receipt["sha256"]


def download(receipt, target):
    if matches(target, receipt):
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + ".download")
    request = urllib.request.Request(receipt["url"], headers={"User-Agent": "3d-ulpin-local-model-setup/1"})
    with urllib.request.urlopen(request, timeout=90) as response, temporary.open("wb") as stream:
        remaining = receipt["bytes"]
        while remaining >= 0:
            chunk = response.read(min(1024 * 1024, remaining + 1))
            if not chunk:
                break
            stream.write(chunk)
            remaining -= len(chunk)
        if remaining < 0:
            raise ValueError("Source download exceeded its pinned byte length.")
    if not matches(temporary, receipt):
        raise ValueError("Source download failed its pinned checksum; it was not installed.")
    os.replace(temporary, target)


def require_versions(expected):
    from importlib.metadata import version, PackageNotFoundError
    mismatches = []
    for package, required in expected.items():
        try:
            actual = version(package).split("+")[0]
        except PackageNotFoundError:
            actual = "missing"
        if actual != required:
            mismatches.append(f"{package}=={required} (found {actual})")
    if mismatches:
        raise ValueError("Use an isolated export environment with: " + ", ".join(mismatches))


def export_floor(model, directory):
    require_versions({"torch": "2.8.0", "onnx": "1.19.1", "gdown": "5.2.0"})
    for source in model["sourceCode"]:
        download(source, directory / source["filename"])
    weights = directory / "cubicasa-weights.pkl"
    if not matches(weights, model["weights"]):
        import gdown
        temporary = weights.with_suffix(".download")
        gdown.download(id="1gRB7ez1e4H7a9Y09lLqRuna0luZO5VRK", output=str(temporary), quiet=True, use_cookies=False)
        if not matches(temporary, model["weights"]):
            raise ValueError("Original CubiCasa checkpoint failed its pinned checksum.")
        os.replace(temporary, weights)
    import torch
    torch.set_num_threads(2)
    sys.path.insert(0, str(directory))
    from floortrans.models.hg_furukawa_original import hg_furukawa_original
    original = hg_furukawa_original(51)
    original.conv4_ = torch.nn.Conv2d(256, 44, bias=True, kernel_size=1)
    original.upsample = torch.nn.ConvTranspose2d(44, 44, kernel_size=4, stride=4)
    state = torch.load(weights, map_location="cpu", weights_only=True)
    original.load_state_dict(state["model_state"], strict=True)
    original.eval()
    del state

    class Rooms(torch.nn.Module):
        def __init__(self, model):
            super().__init__()
            self.model = model

        def forward(self, image):
            return self.model(image)[:, 21:33]

    output = directory / model["filename"]
    with torch.inference_mode():
        torch.onnx.export(Rooms(original).eval(), torch.zeros(1, 3, 256, 256), str(output), input_names=["image"], output_names=["room_logits"], opset_version=17, dynamo=False, dynamic_axes={"image": {2: "height", 3: "width"}, "room_logits": {2: "height", 3: "width"}})
    return output


def export_building(model, directory):
    require_versions({"torch": "2.14.0", "transformers": "5.17.0", "onnx": "1.19.1", "onnxscript": "0.7.0"})
    source_directory = directory / "original"
    for source in model["sourceArtifacts"]:
        download(source, source_directory / source["filename"])
    import torch
    from transformers import RfDetrForInstanceSegmentation
    torch.set_num_threads(2)
    original = RfDetrForInstanceSegmentation.from_pretrained(source_directory, local_files_only=True, attn_implementation="eager").eval()

    class Building(torch.nn.Module):
        def __init__(self, model):
            super().__init__()
            self.model = model

        def forward(self, image):
            result = self.model(pixel_values=image, pixel_mask=torch.ones((1, 432, 432), dtype=torch.bool, device=image.device))
            return result.logits, result.pred_masks

    output = directory / model["filename"]
    with torch.inference_mode():
        torch.onnx.export(Building(original).eval(), torch.zeros(1, 3, 432, 432), str(output), input_names=["image"], output_names=["logits", "masks"], opset_version=18, dynamo=True, external_data=False)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source-dir", type=Path, help="Directory containing already-qualified ONNX files")
    parser.add_argument("--target", type=Path, default=ROOT / ".runtime" / "ml-models")
    parser.add_argument("--model", default="all", help="Exact manifest model ID, or all")
    parser.add_argument("--build", action="store_true", help="Download hash-pinned originals and reproduce an export in this build environment")
    parser.add_argument("--build-dir", type=Path, default=ROOT / ".runtime" / "ml-build")
    args = parser.parse_args()
    manifest = json.loads((ROOT / "services/geo/ml-models.json").read_text())
    models = [m for m in manifest["models"] if args.model in ("all", m["id"])]
    if not models:
        parser.error("Unknown model ID; inspect services/geo/ml-models.json.")
    args.target.mkdir(parents=True, exist_ok=True)
    for model in models:
        target = args.target / model["filename"]
        if matches(target, model):
            print(f"{model['id']}: verified, already installed")
            continue
        if target.exists():
            raise ValueError(f"Existing {target.name} does not match the pinned artifact. Preserve/move it before installing; it was not overwritten.")
        source = args.source_dir / model["filename"] if args.source_dir else None
        if args.build:
            directory = args.build_dir / model["id"]
            directory.mkdir(parents=True, exist_ok=True)
            source = (export_floor if model["task"] == "floor-plan" else export_building)(model, directory)
        if source is None or not matches(source, model):
            detail = f" Export is retained at {source}; qualify changed exporter bytes before updating the manifest." if source and source.exists() else " Supply --source-dir containing qualified artifacts, or use --build with the documented isolated exporter environment."
            raise ValueError(f"Qualified artifact unavailable for {model['id']}." + detail)
        temporary = target.with_name(target.name + ".install")
        shutil.copyfile(source, temporary)
        if not matches(temporary, model):
            raise ValueError("Model changed during the local copy; nothing was installed.")
        os.replace(temporary, target)
        print(f"{model['id']}: installed and SHA-256 verified ({model['bytes']} bytes)")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
