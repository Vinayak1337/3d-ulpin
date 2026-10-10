"""Regression for recall patience being reset when a continuation journal starts at epoch five."""

from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from building_io import write_json
from train_buildings import restore_dev_patience


def checkpoint_metadata(parent: Path, epoch: int, resume: Path | None) -> Path:
    checkpoint = parent / f"epoch-{epoch:03d}"
    checkpoint.mkdir(parents=True)
    write_json(checkpoint / "trainer_state.json", {"epoch": float(epoch)})
    write_json(checkpoint / "training-config.json", {"resume": str(resume) if resume else None})
    return checkpoint


class ResumePatienceRegression(unittest.TestCase):
    def test_continuation_inherits_ancestor_recall_and_bad_epochs(self) -> None:
        with tempfile.TemporaryDirectory(dir="E:/BhuAayam-data/ml") as directory:
            root = Path(directory)
            original = checkpoint_metadata(root / "original", 4, None)
            continued = checkpoint_metadata(root / "continued", 5, original)
            recalls = (0.5792794162359379, 0.6562785041045911, 0.6582547886895713, 0.6624353906962602)
            records = [{"epoch": epoch, "recall": recall} for epoch, recall in enumerate(recalls, 1)]
            (original.parent / "dev-selection.jsonl").write_text(
                "".join(json.dumps(record) + "\n" for record in records)
            )
            (continued.parent / "dev-selection.jsonl").write_text(
                json.dumps({"epoch": 5, "recall": recalls[-1]}) + "\n"
            )
            best, bad_epochs = restore_dev_patience({"resume": str(continued), "early_stopping_metric": "recall"})
            self.assertEqual(best, recalls[-1])
            self.assertEqual(bad_epochs, 1)


if __name__ == "__main__":
    unittest.main()
