"""Resolution, source-mask supervision, and closed-region guard regressions."""

from __future__ import annotations

import json
import tempfile
import unittest
from collections import defaultdict
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import numpy as np
from PIL import Image
from transformers import RfDetrConfig

from eval_buildings import production, record_size_bins, size_recall, threshold_session
from launch_building_train import require_smoke
from prepare_ramp import reject_transfer_training
from train_buildings import BASE, DevEpochs, configure_resolution, load_model_optimizer, training_arguments


class RecordingSession:
    def __init__(self, resolution: int = 432) -> None:
        self.input_resolution = resolution
        self.tensor: np.ndarray | None = None

    def run(self, outputs: object, inputs: dict) -> tuple[np.ndarray, np.ndarray]:
        self.tensor = inputs["image"]
        return np.full((1, 200, 1), -100, np.float32), np.zeros((1, 200, 1, 1), np.float32)


class ResolutionTests(unittest.TestCase):
    def test_model_grid_keeps_publisher_position_parameters(self) -> None:
        config = RfDetrConfig.from_pretrained(BASE, local_files_only=True)
        model = SimpleNamespace(config=config)
        configure_resolution(model, 624, False)
        self.assertEqual(config.ulpin_input_resolution, 624)
        self.assertEqual(config.backbone_config.image_size, 432)
        self.assertEqual(config.group_detr, 13)
        with self.assertRaisesRegex(ValueError, "multiple24|multiple 24"):
            configure_resolution(model, 640, False)
        with self.assertRaisesRegex(ValueError, "Resume checkpoint resolution differs"):
            configure_resolution(model, 672, False)

    def test_legacy_resume_cannot_silently_change_resolution_before_cuda(self) -> None:
        config = RfDetrConfig.from_pretrained(BASE, local_files_only=True)
        model = SimpleNamespace(config=config, to=Mock())
        with patch("train_buildings.RfDetrForInstanceSegmentation.from_pretrained", return_value=model):
            with self.assertRaisesRegex(ValueError, "separately authorized"):
                load_model_optimizer(Path("legacy432"), 624)
        model.to.assert_not_called()

    def test_serving_resizes_original_once_and_keeps432_default(self) -> None:
        image = Image.fromarray(np.random.default_rng(26011).integers(0, 256, (256, 256, 3), dtype=np.uint8))
        prod = production()
        mean = np.asarray([0.485, 0.456, 0.406], np.float32)
        std = np.asarray([0.229, 0.224, 0.225], np.float32)
        for resolution in (432, 624, 672):
            session = RecordingSession(resolution)
            if resolution == 432:
                prod._building_tile(session, image)
            else:
                prod._building_tile(session, image, resolution)
            raw = np.asarray(image.resize((resolution, resolution), Image.Resampling.BILINEAR), np.float32) / 255
            expected = ((raw - mean) / std).transpose(2, 0, 1)[None]
            np.testing.assert_array_equal(session.tensor, expected)
        with self.assertRaisesRegex(Exception, "patch"):
            prod._building_tile(RecordingSession(), image, 640)

    def test_threshold_wrapper_preserves_resolution(self) -> None:
        self.assertEqual(threshold_session(RecordingSession(624), 0.3).input_resolution, 624)

    def test_size_bins_preserve_every_publisher_feature(self) -> None:
        annotations = [{"area": area} for area in (0, 15, 16, 63, 64, 127, 128, 255, 256, 511, 512, 1023, 1024)]
        counts = defaultdict(lambda: {"tp": 0, "fn": 0, "truth_buildings": 0})
        record_size_bins(annotations, [(2, 0, 0.5), (6, 1, 0.8), (12, 2, 1.0)], counts)
        bins = size_recall(counts)
        self.assertEqual(sum(row["truth_buildings"] for row in bins.values()), 13)
        self.assertEqual(sum(row["tp"] for row in bins.values()), 3)
        self.assertEqual(bins["[0,16)"]["recall"], 0)
        self.assertEqual(bins["[16,64)"]["recall"], 0.5)
        self.assertEqual(bins["[1024,inf)"]["recall"], 1)

    def test_constant_lr_and_effective_batch_remain_epoch4_recipe(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            args = training_arguments(Path(directory), False)
        self.assertEqual(args.num_train_epochs, 12)
        self.assertEqual(args.lr_scheduler_type.value, "constant")
        self.assertEqual(args.per_device_train_batch_size * args.gradient_accumulation_steps, 4)
        self.assertTrue(args.bf16)

    def test_epoch_ceiling_and_recall_patience_are_independent_of_trainer_default(self) -> None:
        callback = DevEpochs(Path("unused"), {"max_epochs": 8, "early_stopping_metric": "recall"}, False, 1000)
        self.assertFalse(callback.should_stop(7))
        self.assertTrue(callback.should_stop(8))
        self.assertEqual(callback.minimum_delta, 0)
        callback.bad_epochs = 3
        self.assertTrue(callback.should_stop(1))

    def test_smoke_must_match_resolution_and_recomputation(self) -> None:
        result = {
            "status": "passed",
            "optimizer_steps": 50,
            "last_20_mean_loss": 1,
            "first_20_mean_loss": 2,
            "peak_reserved_bytes": 1,
            "input_resolution": 624,
            "checkpoint_backbone": True,
            "checkpoint_decoder": False,
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "smoke.json"
            path.write_text(json.dumps(result), encoding="utf-8")
            require_smoke(path, 624, True)
            for resolution, decoder in ((672, False), (624, True)):
                with self.assertRaisesRegex(ValueError, "Matching-resolution"):
                    require_smoke(path, resolution, True, decoder)
            with self.assertRaisesRegex(ValueError, "Matching-resolution"):
                require_smoke(path, 624, True, False, 2, 2)

    def test_every_frozen_transfer_region_is_excluded_from_train(self) -> None:
        data = {
            "building_mask_transfer": {"status": "frozen", "region": "coxs_bazar_bangladesh"},
            "building_mask_transfer_2": {"status": "frozen", "region": "chittagong_bangladesh"},
        }
        with patch("prepare_ramp.json.loads", return_value=data):
            for region in ("coxs_bazar_bangladesh", "chittagong_bangladesh"):
                with self.assertRaisesRegex(ValueError, "never TRAIN"):
                    reject_transfer_training(region)
            reject_transfer_training("sylhet_bangladesh")


if __name__ == "__main__":
    unittest.main()
