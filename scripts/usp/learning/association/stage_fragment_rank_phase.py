"""Independently assigned 20-update phase through the existing bounded stager."""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(Path(__file__).resolve().parent), str(REPO / "services/geo")]
from stage_fragment_adapter import stage as shared_stage
from geo.usp_learning.association import fragment_rank_phase_adapter as phase
from geo.usp_learning.association.validation import strict_json


def stage(assignment):
    record = strict_json(Path(assignment).read_bytes())
    authority = phase.BALANCED_AUTHORITY if record.get("version") == phase.BALANCED_VERSIONS["fit"][0] else phase
    return shared_stage("fit", assignment, fragment=authority)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assignment", type=Path, required=True)
    stage(parser.parse_args().assignment)
