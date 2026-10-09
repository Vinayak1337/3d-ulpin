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
    args = parser.parse_args()
    if sys.platform != "win32":
        raise RuntimeError("This helper explicitly targets Windows detachment")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.run_id):
        parser.error("Simple new run id required")
    return args


def require_smoke(path: Path) -> None:
    smoke = read_json(path)
    qualified = smoke["status"] == "passed" and smoke["optimizer_steps"] == 50
    qualified = qualified and smoke["last_20_mean_loss"] < smoke["first_20_mean_loss"]
    qualified = qualified and smoke["peak_reserved_bytes"] <= 6 * 1024**3
    if not qualified:
        raise ValueError("50-step finite/falling smoke required before launch")


def launch(args: argparse.Namespace, root: Path) -> dict[str, Any]:
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
    ]
    if args.resume:
        command += ["--resume", str(args.resume)]
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
    require_smoke(args.smoke_result)
    root = RUNS / args.run_id
    root.mkdir(parents=True, exist_ok=False)
    receipt = launch(args, root)
    write_json(root / "launch.json", receipt)
    print(json.dumps(receipt), flush=True)


if __name__ == "__main__":
    main()
