"""The chunked mask loss must equal upstream values and gradients on CPU control tensors."""

from __future__ import annotations

import unittest
from typing import Any
from unittest.mock import patch

import torch
from transformers.loss import loss_rf_detr

import rfdetr_loss

GROUPS = 3
TARGETS_PER_IMAGE = (3, 2, 5)
MASK_SIZE = 24
PRED_SIZE = 32


def matched_indices(generator: torch.Generator) -> list[tuple[torch.Tensor, torch.Tensor]]:
    indices = []
    for count in TARGETS_PER_IMAGE:
        source = torch.randperm(40, generator=generator)[: count * GROUPS]
        indices.append((source, torch.arange(count).repeat(GROUPS)))
    return indices


def synthetic_batch(dtype: torch.dtype) -> tuple[dict[str, Any], list, list]:
    generator = torch.Generator().manual_seed(26011)
    pred_masks = torch.randn(len(TARGETS_PER_IMAGE), 40, PRED_SIZE, PRED_SIZE, generator=generator)
    targets = []
    for count in TARGETS_PER_IMAGE:
        masks = (torch.rand(count, MASK_SIZE, MASK_SIZE, generator=generator) > 0.6).to(dtype)
        targets.append({"masks": masks})
    return {"pred_masks": pred_masks.requires_grad_()}, targets, matched_indices(generator)


def image_loss(cls: type) -> Any:
    return cls(
        matcher=None,
        num_classes=1,
        focal_alpha=0.25,
        losses=["masks"],
        group_detr=GROUPS,
        mask_point_sample_ratio=16,
    )


def run(cls: type, dtype: torch.dtype) -> tuple[dict[str, torch.Tensor], torch.Tensor]:
    outputs, targets, indices = synthetic_batch(dtype)
    torch.manual_seed(7)
    terms = image_loss(cls).loss_masks(outputs, targets, indices, 7.5)
    gradient = torch.autograd.grad(sum(terms.values()), outputs["pred_masks"])[0]
    return terms, gradient


class ChunkedMaskLossTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repaired = rfdetr_loss.repaired_loss().__globals__["RfDetrImageLoss"]

    def assert_equal_to_upstream(self, dtype: torch.dtype) -> None:
        expected, expected_gradient = run(loss_rf_detr.RfDetrImageLoss, torch.float32)
        actual, actual_gradient = run(self.repaired, dtype)
        self.assertEqual(sum(len(index[0]) for index in synthetic_batch(dtype)[2]), 30)
        for name in ("loss_mask_ce", "loss_mask_dice"):
            self.assertGreater(expected[name].item(), 0)
            torch.testing.assert_close(actual[name], expected[name], rtol=0, atol=1e-6)
        torch.testing.assert_close(actual_gradient, expected_gradient, rtol=0, atol=1e-6)
        self.assertGreater(actual_gradient.abs().sum().item(), 0)

    def test_uneven_chunks_match_upstream_values_and_gradients(self) -> None:
        for chunk in (7, 1, 64):
            with patch.object(rfdetr_loss, "MASK_LOSS_CHUNK", chunk):
                self.assert_equal_to_upstream(torch.float32)

    def test_uint8_targets_are_identical_to_float_targets(self) -> None:
        with patch.object(rfdetr_loss, "MASK_LOSS_CHUNK", 7):
            self.assert_equal_to_upstream(torch.uint8)

    def test_chunk_gather_follows_upstream_concatenation_order(self) -> None:
        _, targets, indices = synthetic_batch(torch.float32)
        full = torch.cat([t["masks"][j] for t, (_, j) in zip(targets, indices)], dim=0)
        for start, stop in ((0, 7), (7, 14), (28, 35), (5, 24)):
            torch.testing.assert_close(
                rfdetr_loss.gather_target_masks(targets, indices, start, stop), full[start:stop], rtol=0, atol=0
            )


if __name__ == "__main__":
    unittest.main()
