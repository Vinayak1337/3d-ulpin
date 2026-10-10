"""Detach one preregistered extra-data training run and leave one file that marks its end.

The recipe is read from the committed plan; this helper chooses no data and no setting. The detached process is
a supervisor: it starts the trainer, waits for it and writes ended.json with the exit code, so a crash leaves
the end marker too. Every child starts with bytecode writing off.
"""

from __future__ import annotations

import argparse
import ctypes
from datetime import datetime, timezone
import os
from pathlib import Path
import subprocess
import sys
import time
from typing import Any, TextIO

from building_io import REPO, RUNS, read_json, sha, write_json
from eval_buildings import repo_sha

TRAINER = REPO / "scripts/ml/train_buildings.py"
PREREGISTRATION = REPO / "docs/evidence/gf-ai/preregistration.json"
DETACHED = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
END_FILE = "ended.json"
BYTECODE = "off: -B on every command and PYTHONDONTWRITEBYTECODE=1 in the child environment"


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--duration-minutes", type=float, required=True, help="No epoch starts after this")
    parser.add_argument("--smoke-result", type=Path, help="Committed smoke receipt holding the launch gate facts")
    parser.add_argument("--receipt", type=Path, help="New launch receipt inside the repository")
    parser.add_argument("--cpu-affinity-mask", type=lambda value: int(value, 0), help="Cores for the run, e.g. 0xFFFF")
    parser.add_argument("--supervise", action="store_true", help="Internal: run the trainer and mark its end")
    args = parser.parse_args()
    if not args.supervise and not (args.smoke_result and args.receipt):
        parser.error("A launch needs --smoke-result and --receipt")
    return args


def require_committed(*paths: Path) -> None:
    """The plan, the preregistration and the smoke receipt must be exactly what HEAD holds before any launch."""
    for required in paths:
        relative = required.relative_to(REPO).as_posix()
        subprocess.run(["git", "ls-files", "--error-unmatch", relative], cwd=REPO, check=True, capture_output=True)
        subprocess.run(["git", "diff", "--quiet", "HEAD", "--", relative], cwd=REPO, check=True)


def require_launch_gate(smoke: dict[str, Any], budget_bytes: int) -> dict[str, Any]:
    """Plan amendment 2: memory within budget, finite smoke losses, and a lower loss on the smoke's own chips.

    A runtime sanity gate with no part in selection. The same-chip facts are measured on the smoke's TRAIN
    chips, un-augmented and with the same sampled points, before and after the smoke steps.
    """
    gate = smoke["launch_gate"]
    same = gate["same_chips"]
    refusals = []
    if gate["peak_reserved_bytes"] > budget_bytes:
        refusals.append("peak reserved memory exceeds the budget")
    if gate["non_finite_chip_losses"] or not gate["smoke_chip_losses"]:
        refusals.append("a smoke step loss is not finite")
    if not same["mean_loss_after"] < same["mean_loss_before"]:
        refusals.append("mean loss on the same chips did not fall")
    roofed = same["chips_with_roofs"]
    if not roofed or 3 * same["chips_with_roofs_and_lower_loss"] < 2 * roofed:
        refusals.append("loss fell on fewer than two thirds of the chips with roofs")
    if refusals:
        raise ValueError("B9 launch gate refuses: " + "; ".join(refusals))
    return gate


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


def child_environment() -> dict[str, str]:
    """A plain start writes site-packages bytecode, which a runtime check elsewhere reads as drift."""
    return {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}


def pin_to_cores(mask: int) -> None:
    """Windows runs a windowless process on efficiency cores at about half speed; children inherit this mask."""
    kernel32 = ctypes.windll.kernel32
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    process = ctypes.c_void_p(kernel32.GetCurrentProcess())
    if not kernel32.SetProcessAffinityMask(process, ctypes.c_size_t(mask)):
        raise OSError("Windows refused the CPU affinity mask")


def supervise(args: argparse.Namespace) -> None:
    root = RUNS / args.run_id
    if args.cpu_affinity_mask:
        pin_to_cores(args.cpu_affinity_mask)
    command = train_command(read_json(args.plan), args.run_id, args.duration_minutes)
    with (root / "training.log").open("x") as log:
        trainer = subprocess.Popen(
            command,
            cwd=REPO,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW,
            env=child_environment(),
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
    options["env"] = child_environment()
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
    args.smoke_result = args.smoke_result.resolve()
    require_committed(args.plan, PREREGISTRATION, args.smoke_result)
    plan = read_json(args.plan)
    hashes = verified_input_hashes(plan)
    gate = require_launch_gate(read_json(args.smoke_result), plan["budget"]["reserved_memory_budget_bytes"])
    root = RUNS / args.run_id
    root.mkdir(parents=True, exist_ok=False)
    command = [sys.executable, "-B", "-u", str(Path(__file__).resolve()), "--supervise", "--plan", str(args.plan)]
    command += ["--run-id", args.run_id, "--duration-minutes", str(args.duration_minutes)]
    if args.cpu_affinity_mask:
        command += ["--cpu-affinity-mask", hex(args.cpu_affinity_mask)]
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
        "cpu_affinity_mask": hex(args.cpu_affinity_mask) if args.cpu_affinity_mask else None,
        "bytecode_writing": BYTECODE,
        "smoke_result": str(args.smoke_result),
        "smoke_sha256": repo_sha(args.smoke_result),
        "launch_gate": gate,
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
