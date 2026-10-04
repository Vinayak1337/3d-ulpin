"""Reviewed host reader with the unchanged source-bound learner's shared stager.

Only host predecessor/history admission uses this checkout. Runtime sources,
generated command and clean execution HEAD still come from execution_repo.
"""
from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "services/geo"), str(REPO / "scripts/usp/learning"), str(Path(__file__).resolve().parent)]
from geo.usp_learning.association import fragment_rank_phase_adapter as phase


def frozen_stager(execution_repo, assignment):
    execution_repo = phase.checkpoint.checked_path(execution_repo)
    phase.checked_execution(assignment, "fit")
    relative = "scripts/usp/learning/association/stage_fragment_adapter.py"
    path = phase.checkpoint.checked_path(execution_repo / relative)
    raw = path.read_bytes().replace(b"\r\n", b"\n")
    phase.checkpoint.require(phase.sha(raw) == assignment["runtimeCodeCanonicalLfSha256"][relative], "rank_phase_host_stager_pin")
    # Host modules are already imported from this reviewed checkout. The shared
    # stager's own REPO remains the frozen learner; checked_sources also verifies
    # its clean HEAD and every committed runtime byte before any staging effect.
    spec = importlib.util.spec_from_file_location("rank_phase_frozen_stager", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    phase.checkpoint.require(module.REPO == execution_repo, "rank_phase_host_execution_repo")
    return module


def stage(assignment_path, execution_repo):
    assignment_path = phase.checkpoint.checked_path(assignment_path)
    assignment = phase.strict_json(assignment_path.read_bytes())
    module = frozen_stager(execution_repo, assignment)
    return module.stage("fit", assignment_path, fragment=phase)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assignment", type=Path, required=True)
    parser.add_argument("--execution-repo", type=Path, required=True)
    args = parser.parse_args()
    stage(args.assignment, args.execution_repo)
