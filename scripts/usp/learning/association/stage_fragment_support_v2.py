"""Explicit future v2 staging; disabled preparation templates grant no execution."""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "services/geo"), str(Path(__file__).resolve().parent)]
import stage_fragment_adapter as shared
from geo.usp_learning.association import fragment_support_v2 as fragment

DATA_ROOT = Path("E:/BhuAayam-data/task-data/ml-distillation/teacher/fragment-support-pairs-v2-402ba4a9ecb0fc808f3c9534c6318cdf")
TRAINING = DATA_ROOT / fragment.DATA_NAME
TRAINING_SOURCES = {name: DATA_ROOT / name for name in fragment.SUPPORT_PINS}
TRAINING_SOURCES["train-teacher-fragments-v1.jsonl"] = shared.TRAINING
TRAINING_SOURCES["training-row-pins-v2.json"] = Path(
    "E:/BhuAayam-data/task-data/ml-distillation/coordinator/teacher-06-support-pairs-review-v1-5a1f206ca86c432ea89d363a89194037/training-row-pins-v2.json")


def stage(action, assignment_path, fit_root=None):
    return shared.stage(action, assignment_path, fit_root, fragment=fragment, training=TRAINING,
                        training_sources=TRAINING_SOURCES)


def phase_template(action):
    return shared.phase_template(action, fragment=fragment, entrypoint=Path(__file__).resolve())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("fit", "reload"))
    parser.add_argument("--assignment", type=Path, required=True)
    parser.add_argument("--fit-root", type=Path)
    args = parser.parse_args()
    stage(args.action, args.assignment, args.fit_root)
