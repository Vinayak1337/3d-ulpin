"""Trainer regressions: continuation patience, and TRAIN augmentations that stay off unless asked for."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import patch

import torch

from building_io import write_json
from train_buildings import RampTrain, augment_scale, collate, restore_dev_patience

# Recorded from the staging trainer (9aad8da2) before the augmentation arguments existed.
PREVIOUS_TRAIN_BATCH = "dc6eb27927691735d59ddac000f7e448769af9a4f10d90e7956a219daa54614d"
PREVIOUS_SMOKE_BATCH = "d1629655847c499fb448dcefac4919fa020f6384b175eea6c8ff111614b4b984"
TILE = 432


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


def batch_digest(rows: list[dict]) -> str:
    batch = collate(rows)
    digest = hashlib.sha256(batch["pixel_values"].numpy().tobytes())
    for labels in batch["labels"]:
        for key in ("class_labels", "boxes", "masks"):
            digest.update(labels[key].numpy().tobytes())
    return digest.hexdigest()


def rectangle_chip(rectangles: list[tuple[int, int, int, int]]) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """A black tile with one white rectangle (left, top, right, bottom) per instance."""
    masks = torch.zeros((len(rectangles), TILE, TILE), dtype=torch.uint8)
    boxes = []
    for mask, (left, top, right, bottom) in zip(masks, rectangles):
        mask[top:bottom, left:right] = 1
        boxes.append([(left + right) / 2, (top + bottom) / 2, right - left, bottom - top])
    rgb = masks.amax(0).float().expand(3, TILE, TILE).clone()
    return rgb, torch.tensor(boxes) / TILE, masks


def pixel_extent(plane: torch.Tensor) -> torch.Tensor:
    """Edge coordinates (left, top, right, bottom) of the lit pixels of one plane."""
    rows, columns = torch.nonzero(plane, as_tuple=True)
    return torch.stack([columns.min(), rows.min(), columns.max() + 1, rows.max() + 1]).float()


def box_extent(box: torch.Tensor) -> torch.Tensor:
    return torch.cat([box[:2] - box[2:] / 2, box[:2] + box[2:] / 2]) * TILE


class TrainAugmentation(unittest.TestCase):
    def scaled(self, factor: float, shift: tuple[float, float]) -> tuple[torch.Tensor, ...]:
        chip = rectangle_chip([(40, 60, 120, 100), (300, 320, 420, 400)])
        with patch("train_buildings.random.random", side_effect=shift):
            return augment_scale(*chip, (factor, factor))

    def assert_aligned(self, rgb: torch.Tensor, boxes: torch.Tensor, masks: torch.Tensor) -> None:
        for box, mask in zip(boxes, masks):
            self.assertLessEqual((box_extent(box) - pixel_extent(mask)).abs().max().item(), 1.0)
        lit = pixel_extent(rgb[0] > 0.5)
        self.assertLessEqual((lit - pixel_extent(masks.amax(0))).abs().max().item(), 1.0)

    def test_zoom_in_keeps_box_mask_and_image_aligned_when_an_instance_is_clipped(self) -> None:
        rgb, boxes, masks = self.scaled(1.33, (0.0, 0.0))
        self.assertEqual(rgb.shape, (3, TILE, TILE))
        self.assertLess(masks[1].sum().item(), 120 * 80 * 1.33**2 / 2)
        self.assert_aligned(rgb, boxes, masks)

    def test_zoom_out_pads_and_keeps_box_mask_and_image_aligned(self) -> None:
        rgb, boxes, masks = self.scaled(0.75, (0.5, 0.5))
        self.assertEqual(masks.shape, (2, TILE, TILE))
        self.assertEqual(rgb[:, :54].abs().sum().item(), 0.0)
        self.assert_aligned(rgb, boxes, masks)

    def test_an_instance_cropped_out_leaves_the_targets_and_the_rest_keep_order_and_alignment(self) -> None:
        chip = rectangle_chip([(200, 200, 260, 250), (40, 60, 120, 100), (300, 320, 420, 400)])
        with patch("train_buildings.random.random", side_effect=(1.0, 1.0)):
            rgb, boxes, masks = augment_scale(*chip, (1.33, 1.33))
        self.assertEqual((len(boxes), len(masks)), (2, 2))
        self.assertLess(boxes[0, 0].item(), boxes[1, 0].item())
        self.assert_aligned(rgb, boxes, masks)

    def test_class_labels_follow_the_instances_that_remain(self) -> None:
        plain = RampTrain(smoke=True)[2]["labels"]
        with patch("train_buildings.random.random", side_effect=(1.0, 1.0)):
            cropped = RampTrain(smoke=True, scale_range=(1.33, 1.33))[2]["labels"]
        self.assertLess(len(cropped["boxes"]), len(plain["boxes"]))
        self.assertEqual(len(cropped["class_labels"]), len(cropped["boxes"]))
        self.assertEqual(len(cropped["masks"]), len(cropped["boxes"]))

    def test_a_publisher_zero_pixel_instance_keeps_its_moved_box_until_the_box_leaves_the_tile(self) -> None:
        rgb, boxes, masks = rectangle_chip([(40, 60, 120, 100), (0, 0, 0, 0)])
        boxes[1] = torch.tensor([216.0, 216.0, 4.0, 4.0]) / TILE
        with patch("train_buildings.random.random", side_effect=(0.5, 0.5)):
            _, kept_boxes, kept_masks = augment_scale(rgb, boxes.clone(), masks, (0.75, 0.75))
        self.assertEqual(len(kept_boxes), 2)
        self.assertEqual(kept_masks[1].sum().item(), 0)
        self.assertTrue(torch.allclose(kept_boxes[1] * TILE, torch.tensor([216.0, 216.0, 3.0, 3.0]), atol=1e-3))
        boxes[1] = torch.tensor([20.0, 20.0, 4.0, 4.0]) / TILE
        with patch("train_buildings.random.random", side_effect=(1.0, 1.0)):
            _, no_boxes, no_masks = augment_scale(rgb, boxes.clone(), masks, (1.33, 1.33))
        self.assertEqual((tuple(no_boxes.shape), tuple(no_masks.shape)), ((0, 4), (0, TILE, TILE)))

    def test_colour_jitter_changes_pixels_and_leaves_labels_unchanged(self) -> None:
        plain = RampTrain(smoke=True)[2]
        random.seed(26011)
        jittered = RampTrain(smoke=True, colour_jitter=0.2)[2]
        self.assertFalse(torch.equal(plain["pixel_values"], jittered["pixel_values"]))
        self.assertGreater(len(plain["labels"]["boxes"]), 0)
        for key in ("class_labels", "boxes", "masks"):
            self.assertTrue(torch.equal(plain["labels"][key], jittered["labels"][key]))

    def test_absent_arguments_reproduce_the_previous_batches(self) -> None:
        random.seed(26011)
        train = RampTrain()
        self.assertEqual(batch_digest([train[index] for index in range(4)]), PREVIOUS_TRAIN_BATCH)
        smoke = RampTrain(smoke=True)
        self.assertEqual(batch_digest([smoke[index] for index in range(len(smoke))]), PREVIOUS_SMOKE_BATCH)


if __name__ == "__main__":
    unittest.main()
