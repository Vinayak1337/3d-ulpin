"""Thin entry to the existing guarded rank stager; positive reload only."""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(Path(__file__).resolve().parent), str(REPO / "services/geo")]
from stage_selector_baseline import stage as shared_stage, checked_stage_assignment
from geo.usp_learning.association.validation import require, strict_json


def stage(assignment):
    _, mode = checked_stage_assignment(strict_json(Path(assignment).read_bytes()))
    require(mode == "fragment-rank-reload", "separate_positive_rank_reload_required")
    return shared_stage(assignment)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assignment", type=Path, required=True)
    stage(parser.parse_args().assignment)
