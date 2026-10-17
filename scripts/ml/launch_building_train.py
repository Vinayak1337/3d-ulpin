"""Detach one smoke-qualified Windows training segment with retained logs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

from building_io import REPO, RUNS, read_json, sha, write_json


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--smoke-result", type=Path, required=True)
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
    args = parser.parse_args()
    if sys.platform != "win32":
        raise RuntimeError("This helper explicitly targets Windows detachment")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.run_id):
        parser.error("Simple new run id required")
    if args.resolution < 432 or args.resolution % 24:
        parser.error("RF-DETR resolution must be at least 432 and divisible by 24")
    if args.batch_size * args.accumulation != 4 or min(args.batch_size, args.accumulation) < 1:
        parser.error("Preserve effective batch 4 with positive batch size and accumulation")
    if not 1 <= args.max_epochs <= 12 or (args.resolution > 432 and args.max_epochs > 8):
        parser.error("Maximum epochs must be 1..12; higher-resolution B6 ceiling is 8")
    return args


def require_smoke(
    path: Path,
    resolution: int = 432,
    checkpoint_backbone: bool = False,
    checkpoint_decoder: bool = False,
    batch_size: int = 1,
    accumulation: int = 4,
) -> None:
    smoke = read_json(path)
    qualified = smoke["status"] == "passed" and smoke["optimizer_steps"] == 50
    qualified = qualified and smoke["last_20_mean_loss"] < smoke["first_20_mean_loss"]
    qualified = qualified and smoke["peak_reserved_bytes"] <= 6 * 1024**3
    qualified = qualified and smoke.get("input_resolution", 432) == resolution
    qualified = qualified and smoke.get("checkpoint_backbone", False) == checkpoint_backbone
    qualified = qualified and smoke.get("checkpoint_decoder", False) == checkpoint_decoder
    qualified = qualified and smoke.get("batch_size", 1) == batch_size
    qualified = qualified and smoke.get("gradient_accumulation_steps", 4) == accumulation
    if not qualified:
        raise ValueError("Matching-resolution 50-step finite/falling smoke required before launch")


def train_command(args: argparse.Namespace) -> list[str]:
    script = REPO / "scripts/ml/train_buildings.py"
    command = [
        sys.executable,
        "-B",
        "-u",
        str(script),
        "--run-id",
        args.run_id,
        "--duration-minutes",
        str(args.duration_minutes),
        "--early-stopping-metric",
        args.early_stopping_metric,
        "--dev-thresholds",
        *[str(value) for value in args.dev_thresholds],
    ]
    command += [
        "--resolution",
        str(args.resolution),
        "--batch-size",
        str(args.batch_size),
        "--accumulation",
        str(args.accumulation),
        "--max-epochs",
        str(args.max_epochs),
    ]
    for option in ("checkpoint-backbone", "checkpoint-decoder", "size-bins"):
        if getattr(args, option.replace("-", "_")):
            command.append("--" + option)
    if args.resume:
        command += ["--resume", str(args.resume)]
    return command


def launch(args: argparse.Namespace, root: Path) -> dict[str, Any]:
    script = REPO / "scripts/ml/train_buildings.py"
    command = train_command(args)
    with (root / "training.log").open("x") as log:
        child = subprocess.Popen(
            command,
            cwd=REPO,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            close_fds=True,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
        )
    return {
        "pid": child.pid,
        "run_id": args.run_id,
        "command": command,
        "log": str(root / "training.log"),
        "detached": "DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP; close_fds=True; redirected stdio",
        "smoke_result": str(args.smoke_result),
        "smoke_sha256": sha(args.smoke_result),
        "trainer_sha256": sha(script),
        "git_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
        "tail_command": f"Get-Content '{root / 'training.log'}' -Tail 30 -Wait",
    }


def main() -> None:
    args = parse_arguments()
    require_smoke(
        args.smoke_result,
        args.resolution,
        args.checkpoint_backbone,
        args.checkpoint_decoder,
        args.batch_size,
        args.accumulation,
    )
    root = RUNS / args.run_id
    root.mkdir(parents=True, exist_ok=False)
    receipt = launch(args, root)
    write_json(root / "launch.json", receipt)
    print(json.dumps(receipt), flush=True)


if __name__ == "__main__":
    main()
