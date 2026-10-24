"""Launch-gate measurement (B9 plan amendment 2): loss on the smoke's own TRAIN chips before and after its steps.

Only the TRAIN smoke chips are read: un-augmented, without gradients, with the same sampled points for both
weights. No DEV, holdout or transfer chip is touched and nothing is trained. A runtime sanity measurement with
no part in selection.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from train_buildings import RampTrain, configure_offline, load_model_optimizer

SEED = 26011


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before", type=Path, required=True, help="Weights the smoke started from")
    parser.add_argument("--after", type=Path, required=True, help="Weights the smoke wrote after its steps")
    parser.add_argument("--extra-train-root", type=Path, nargs="+", default=[], help="Extra TRAIN-only COCO roots")
    return parser.parse_args()


def chip_losses(weights: Path, dataset: RampTrain) -> list[float]:
    model, _ = load_model_optimizer(weights)
    model.train()
    losses = []
    for index in range(len(dataset)):
        row = dataset[index]
        labels = {key: value.to("cuda") for key, value in row["labels"].items()}
        torch.manual_seed(SEED + index)
        with torch.no_grad(), torch.autocast("cuda", dtype=torch.bfloat16):
            losses.append(float(model(pixel_values=row["pixel_values"][None].to("cuda"), labels=[labels]).loss))
    del model
    torch.cuda.empty_cache()
    return losses


def main() -> None:
    configure_offline()
    args = parse_arguments()
    torch.cuda.set_per_process_memory_fraction(0.75)
    dataset = RampTrain(smoke=True, extra_roots=args.extra_train_root)
    before = chip_losses(args.before, dataset)
    after = chip_losses(args.after, dataset)
    instances = [len(annotations) for _, _, annotations in dataset.chips]
    roofed = [(old, new) for old, new, count in zip(before, after, instances) if count]
    result = {
        "chips": len(dataset),
        "chip_ids": dataset.binding["chip_ids"],
        "instances": instances,
        "mean_loss_before": sum(before) / len(before),
        "mean_loss_after": sum(after) / len(after),
        "chips_with_roofs": len(roofed),
        "chips_with_roofs_and_lower_loss": sum(new < old for old, new in roofed),
        "before": before,
        "after": after,
        "peak_reserved_bytes": torch.cuda.max_memory_reserved(),
        "holdout_calls": 0,
    }
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
