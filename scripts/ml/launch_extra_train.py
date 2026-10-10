"""Detach one preregistered extra-data training run and leave one file that marks its end.

The recipe is read from the committed plan; this helper chooses no data and no setting. The detached process is
a supervisor: it starts the trainer, waits for it and writes ended.json with the exit code, so a crash leaves
the end marker too.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import subprocess
import sys
import time
from typing import Any, TextIO

from building_io import REPO, RUNS, read_json, sha, write_json
from eval_buildings import repo_sha
from launch_building_train import require_smoke

TRAINER = REPO / "scripts/ml/train_buildings.py"
PREREGISTRATION = REPO / "docs/evidence/gf-ai/preregistration.json"
DETACHED = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
END_FILE = "ended.json"


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--duration-minutes", type=float, required=True, help="No epoch starts after this")
    parser.add_argument("--smoke-result", type=Path, help="Passed 50-step smoke of the same recipe")
    parser.add_argument("--receipt", type=Path, help="New launch receipt inside the repository")
    parser.add_argument("--supervise", action="store_true", help="Internal: run the trainer and mark its end")
    args = parser.parse_args()
    if not args.supervise and not (args.smoke_result and args.receipt):
        parser.error("A launch needs --smoke-result and --receipt")
    return args


def committed_plan(path: Path) -> dict[str, Any]:
    """The plan and the preregistration must be exactly what HEAD holds before any launch."""
    for required in (path, PREREGISTRATION):
        relative = required.relative_to(REPO).as_posix()
        subprocess.run(["git", "ls-files", "--error-unmatch", relative], cwd=REPO, check=True, capture_output=True)
        subprocess.run(["git", "diff", "--quiet", "HEAD", "--", relative], cwd=REPO, check=True)
    return read_json(path)


def verified_input_hashes(plan: dict[str, Any]) -> dict[str, Any]:
    """Weights and both TRAIN COCO files must be the ones the plan pins."""
    recipe = plan["recipe"]
    data = plan["training_data"]
    found = {
        "init_weights_sha256": sha(Path(recipe["init_weights"]) / "model.safetensors"),
        "karnataka_train_coco_sha256": sha(Path(data["karnataka_train"]["root"]) / "_annotations.coco.json"),
        "extra_train_coco_sha256": [sha(Path(shard["root"]) / "_annotations.coco.json") for shard in data["extra"]],
    }
    pinned = {
        "init_weights_sha256": recipe["init_weights_sha256"],
        "karnataka_train_coco_sha256": data["karnataka_train"]["coco_sha256"],
        "extra_train_coco_sha256": [shard["coco_sha256"] for shard in data["extra"]],
    }
    if found != pinned:
        raise ValueError("Training inputs differ from the committed plan")
    return found


def train_command(plan: dict[str, Any], run_id: str, duration_minutes: float) -> list[str]:
    recipe = plan["recipe"]
    budget = plan["budget"]
    return [
        sys.executable,
        "-B",
        "-u",
        str(TRAINER),
        "--run-id",
        run_id,
        "--duration-minutes",
        str(duration_minutes),
        "--max-epochs",
        str(budget["max_epochs"]),
        "--early-stopping-metric",
        "recall",
        "--early-stopping-min-delta",
        str(budget["early_stop_min_delta"]),
        "--dev-thresholds",
        *[str(value) for value in plan["selection"]["dev_thresholds"]],
        "--size-bins",
        "--init-weights",
        recipe["init_weights"],
        "--extra-train-root",
        *[shard["root"] for shard in plan["training_data"]["extra"]],
        "--scale-range",
        *[str(value) for value in recipe["augmentation"]["scale_range"]],
        "--colour-jitter",
        str(recipe["augmentation"]["colour_jitter"]),
    ]


def supervise(args: argparse.Namespace) -> None:
    root = RUNS / args.run_id
    command = train_command(read_json(args.plan), args.run_id, args.duration_minutes)
    with (root / "training.log").open("x") as log:
        trainer = subprocess.Popen(
            command,
            cwd=REPO,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        write_json(root / "pids.json", {"supervisor": os.getpid(), "trainer": trainer.pid, "command": command})
        returncode = trainer.wait()
    write_json(
        root / END_FILE,
        {
            "returncode": returncode,
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "result_json": (root / "result.json").is_file(),
            "failure_json": (root / "failure.json").is_file(),
        },
    )


def spawn_detached(command: list[str], log: TextIO) -> tuple[subprocess.Popen, str]:
    """B4's detachment, leaving the launcher's job object when Windows allows it."""
    options = {"cwd": REPO, "stdin": subprocess.DEVNULL, "stdout": log, "stderr": subprocess.STDOUT, "close_fds": True}
    note = "DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP; close_fds=True; redirected stdio"
    try:
        flags = DETACHED | subprocess.CREATE_BREAKAWAY_FROM_JOB
        return subprocess.Popen(command, creationflags=flags, **options), note + "; CREATE_BREAKAWAY_FROM_JOB"
    except PermissionError:
        return subprocess.Popen(command, creationflags=DETACHED, **options), note + "; job refused breakaway"


def wait_for_start(root: Path, supervisor: subprocess.Popen, seconds: int = 600) -> None:
    deadline = time.monotonic() + seconds
    while not (root / "run-config.json").is_file():
        if supervisor.poll() is not None or time.monotonic() > deadline:
            raise RuntimeError(f"The trainer did not start; read {root / 'supervisor.log'} and training.log")
        time.sleep(2)


def launch(args: argparse.Namespace) -> dict[str, Any]:
    args.plan = args.plan.resolve()
    plan = committed_plan(args.plan)
    hashes = verified_input_hashes(plan)
    require_smoke(args.smoke_result)
    root = RUNS / args.run_id
    root.mkdir(parents=True, exist_ok=False)
    command = [sys.executable, "-B", "-u", str(Path(__file__).resolve()), "--supervise", "--plan", str(args.plan)]
    command += ["--run-id", args.run_id, "--duration-minutes", str(args.duration_minutes)]
    with (root / "supervisor.log").open("x") as log:
        supervisor, detached = spawn_detached(command, log)
    wait_for_start(root, supervisor)
    pids = read_json(root / "pids.json")
    return {
        "run_id": args.run_id,
        "pid": pids["trainer"],
        "supervisor_pid": pids["supervisor"],
        "command": pids["command"],
        "log": str(root / "training.log"),
        "end_file": str(root / END_FILE),
        "end_file_meaning": "Written by the supervisor when the trainer process exits for any reason",
        "detached": detached,
        "smoke_result": str(args.smoke_result),
        "smoke_sha256": sha(args.smoke_result),
        "trainer_sha256": repo_sha(TRAINER),
        "plan_sha256": repo_sha(args.plan),
        "preregistration_sha256": repo_sha(PREREGISTRATION),
        "repository_hash_encoding": "UTF-8 bytes with CRLF normalized to LF, matching Git text blobs",
        "run_config_sha256": sha(root / "run-config.json"),
        **hashes,
        "git_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
        "launched_at": datetime.now(timezone.utc).isoformat(),
        "tail_command": f"Get-Content '{root / 'training.log'}' -Tail 30 -Wait",
    }


def main() -> None:
    args = parse_arguments()
    if sys.platform != "win32":
        raise RuntimeError("This helper explicitly targets Windows detachment")
    if args.supervise:
        supervise(args)
        return
    receipt = launch(args)
    write_json(RUNS / args.run_id / "launch.json", receipt)
    write_json(args.receipt, receipt)


if __name__ == "__main__":
    main()
