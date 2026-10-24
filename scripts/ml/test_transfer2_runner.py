"""Two-slot reservation guard and frozen protocol binding for the Chittagong transfer-2 runner."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

import eval_buildings
from eval_buildings import (
    id_hash,
    require_transfer2_protocol,
    require_transfer2_selection,
    reserve_transfer2_slot,
)

EPOCH4_SHA = "a" * 64
B6_SHA = "b" * 64
PREREG = {"reference": {"weights_sha256": EPOCH4_SHA}}


def records(log: Path) -> list[dict]:
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]


class ReservationGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.log = Path(self.directory.name) / "transfer-2-runs.jsonl"

    def reserve_both(self) -> None:
        reserve_transfer2_slot(self.log, "epoch4", "run-a", EPOCH4_SHA)
        reserve_transfer2_slot(self.log, "b6", "run-b", B6_SHA)

    def test_two_distinct_slots_are_reserved_with_their_model_hashes(self) -> None:
        self.reserve_both()
        started = records(self.log)
        self.assertEqual([row["slot"] for row in started], ["epoch4", "b6"])
        self.assertEqual([row["model_sha256"] for row in started], [EPOCH4_SHA, B6_SHA])
        self.assertEqual([row["attempt"] for row in started], [1, 2])

    def test_repeated_slot_is_refused_without_writing(self) -> None:
        reserve_transfer2_slot(self.log, "epoch4", "run-a", EPOCH4_SHA)
        with self.assertRaisesRegex(ValueError, "slot epoch4 already reserved"):
            reserve_transfer2_slot(self.log, "epoch4", "run-c", B6_SHA)
        self.assertEqual(len(records(self.log)), 1)
        self.assertFalse(self.log.with_suffix(".lock").exists())

    def test_third_attempt_is_refused_even_after_a_failed_run(self) -> None:
        self.reserve_both()
        eval_buildings.append_log(self.log, "failed", "run-a", error_type="OSError", error="interrupted")
        with self.assertRaisesRegex(ValueError, "both attempts already reserved"):
            reserve_transfer2_slot(self.log, "b6", "run-c", "c" * 64)
        self.assertEqual(len(records(self.log)), 3)

    def test_unknown_slot_and_shared_model_are_refused(self) -> None:
        with self.assertRaisesRegex(ValueError, "slot must be one of"):
            reserve_transfer2_slot(self.log, "extra", "run-a", EPOCH4_SHA)
        reserve_transfer2_slot(self.log, "epoch4", "run-a", EPOCH4_SHA)
        with self.assertRaisesRegex(ValueError, "one model cannot take both slots"):
            reserve_transfer2_slot(self.log, "b6", "run-b", EPOCH4_SHA)

    def test_leftover_lock_fails_closed(self) -> None:
        self.log.with_suffix(".lock").write_text("1", encoding="utf-8")
        with self.assertRaises(FileExistsError):
            reserve_transfer2_slot(self.log, "epoch4", "run-a", EPOCH4_SHA)
        self.assertFalse(self.log.exists())


class ProtocolBindingTests(unittest.TestCase):
    def test_epoch4_slot_must_use_the_preregistered_reference_weights(self) -> None:
        selection = Path("selection.json")
        data = json.dumps({"final_candidate_fixed": True, "model_sha256": B6_SHA}).encode()
        with patch.object(Path, "resolve", lambda self: self), patch.object(
            eval_buildings, "committed", return_value="commit"
        ), patch.object(Path, "read_bytes", return_value=data):
            self.assertEqual(require_transfer2_selection("epoch4", PREREG, EPOCH4_SHA, selection), "commit")
            self.assertEqual(require_transfer2_selection("b6", PREREG, B6_SHA, selection), "commit")
            with self.assertRaisesRegex(ValueError, "slot epoch4"):
                require_transfer2_selection("epoch4", PREREG, B6_SHA, selection)
            with self.assertRaisesRegex(ValueError, "slot b6"):
                require_transfer2_selection("b6", PREREG, EPOCH4_SHA, selection)
            with self.assertRaisesRegex(ValueError, "committed final B6"):
                require_transfer2_selection("b6", PREREG, B6_SHA, None)

    def test_unfixed_selection_is_refused(self) -> None:
        data = json.dumps({"final_candidate_fixed": False, "model_sha256": B6_SHA}).encode()
        with patch.object(Path, "resolve", lambda self: self), patch.object(
            eval_buildings, "committed", return_value="commit"
        ), patch.object(Path, "read_bytes", return_value=data):
            with self.assertRaisesRegex(ValueError, "not fixed"):
                require_transfer2_selection("b6", PREREG, B6_SHA, Path("selection.json"))

    def test_protocol_requires_pytorch_cuda_checkpoint_and_forces_size_bins(self) -> None:
        args = Namespace(provider="cuda", size_bins=False)
        require_transfer2_protocol(args, Path("model.safetensors"))
        self.assertTrue(args.size_bins)
        for path, provider in ((Path("model.onnx"), "cuda"), (Path("model.safetensors"), "cpu")):
            with self.assertRaisesRegex(ValueError, "safetensors checkpoint on --provider cuda"):
                require_transfer2_protocol(Namespace(provider=provider, size_bins=False), path)


class RunnerRefusalTests(unittest.TestCase):
    def test_refused_slot_stops_before_the_model_or_images_load(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            log = root / "transfer-2-runs.jsonl"
            reserve_transfer2_slot(log, "epoch4", "run-a", EPOCH4_SHA)
            reserve_transfer2_slot(log, "b6", "run-b", B6_SHA)
            model = root / "model.safetensors"
            model.write_bytes(b"weights")
            split = {"splits": {"transfer": {"chips": 1, "chip_ids": ["x"], "chip_ids_sha256": id_hash(["x"])}}}
            argv = ["eval_buildings.py", "--model", str(model), "--split", "transfer2", "--transfer2-slot", "b6"]
            argv += ["--provider", "cuda", "--run-id", "run-never", "--selection-result", str(root / "selection.json")]
            with patch.object(sys, "argv", argv), patch.object(eval_buildings, "TRANSFER2_LOG", log), patch.object(
                eval_buildings, "transfer_inputs", return_value=(split, {})
            ), patch.object(eval_buildings, "committed", return_value="commit"), patch.object(
                eval_buildings, "require_transfer2_selection", return_value="commit"
            ), patch.object(
                eval_buildings, "production"
            ) as production, patch.object(
                eval_buildings, "session"
            ) as session:
                with self.assertRaisesRegex(ValueError, "both attempts already reserved"):
                    eval_buildings.main()
            production.assert_not_called()
            session.assert_not_called()
            self.assertFalse((eval_buildings.EVIDENCE / "run-never").exists())
            self.assertEqual(len(records(log)), 2)


if __name__ == "__main__":
    unittest.main()
