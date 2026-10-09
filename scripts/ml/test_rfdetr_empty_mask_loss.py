"""Pinned loss-contract regressions: CPU control tensors only, no GPU or held-out inputs."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
import unittest

import torch
from transformers.loss import loss_rf_detr

from rfdetr_loss import repaired_loss, require_finite


def branch() -> tuple[torch.Tensor, ...]:
    return (
        torch.full((1, 13, 1), -0.5, requires_grad=True),
        torch.tensor([0.5, 0.5, 0.5, 0.5]).repeat(1, 13, 1).requires_grad_(),
        torch.full((1, 13, 4, 4), 0.25, requires_grad=True),
    )


def loss_inputs(empty: bool) -> tuple[dict[str, Any], list]:
    config = SimpleNamespace(
        class_cost=1,
        bbox_cost=1,
        giou_cost=1,
        mask_point_sample_ratio=16,
        mask_class_loss_coefficient=2,
        mask_dice_loss_coefficient=2,
        num_labels=1,
        focal_alpha=0.25,
        group_detr=13,
        auxiliary_loss=True,
        decoder_layers=2,
        class_loss_coefficient=1,
        bbox_loss_coefficient=5,
        giou_loss_coefficient=2,
    )
    main, auxiliary, encoder = branch(), branch(), branch()
    target = {
        "class_labels": torch.empty(0, dtype=torch.int64) if empty else torch.tensor([0]),
        "boxes": torch.empty((0, 4)) if empty else torch.tensor([[0.5, 0.5, 0.5, 0.5]]),
        "masks": torch.empty((0, 4, 4)) if empty else torch.ones((1, 4, 4)),
    }
    arguments = dict(
        logits=main[0],
        labels=[target],
        device=torch.device("cpu"),
        pred_boxes=main[1],
        pred_masks=main[2],
        config=config,
        outputs_class=torch.stack([auxiliary[0], main[0]]),
        outputs_coord=torch.stack([auxiliary[1], main[1]]),
        outputs_masks=torch.stack([auxiliary[2], main[2]]),
        enc_outputs_class=encoder[0],
        enc_outputs_coord=encoder[1],
        enc_outputs_masks=encoder[2],
    )
    return arguments, [main, auxiliary, encoder]


class EmptyMaskLossTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        torch.set_num_threads(2)
        cls.loss = staticmethod(repaired_loss())

    def test_empty_main_aux_encoder_keep_scalar_classification_and_gradients(self) -> None:
        arguments, branches = loss_inputs(True)
        broken, terms, _ = loss_rf_detr.RfDetrForSegmentationLoss(**arguments)
        self.assertEqual(broken.numel(), 0, "Pinned upstream bug must still be present")
        self.assertEqual(terms["loss_mask_ce"].shape, torch.Size([0, 4, 4]))
        total, terms, _ = self.loss(**arguments)
        require_finite(total, terms)
        self.assertGreater(total.item(), 0, "Classification supervision survives empty masks")
        for suffix in ("", "_0", "_enc"):
            for name in ("loss_mask_ce", "loss_mask_dice"):
                self.assertEqual(terms[name + suffix].shape, torch.Size([]))
                self.assertEqual(terms[name + suffix].item(), 0)
        gradients = torch.autograd.grad(total, [part[2] for part in branches] + [part[0] for part in branches])
        for gradient in gradients[:3]:
            self.assertTrue(torch.isfinite(gradient).all())
            self.assertEqual(torch.count_nonzero(gradient).item(), 0)
        self.assertTrue(any(torch.count_nonzero(gradient).item() for gradient in gradients[3:]))
        self.assertIs(self.loss.__code__, loss_rf_detr.RfDetrForSegmentationLoss.__code__)
        self.assertIsNot(self.loss.__globals__["RfDetrImageLoss"], loss_rf_detr.RfDetrImageLoss)

    def test_nonempty_values_and_gradients_are_identical(self) -> None:
        arguments, branches = loss_inputs(False)
        torch.manual_seed(42)
        reference, reference_terms, _ = loss_rf_detr.RfDetrForSegmentationLoss(**arguments)
        reference_gradients = torch.autograd.grad(reference, [part[2] for part in branches], retain_graph=True)
        torch.manual_seed(42)
        total, terms, _ = self.loss(**arguments)
        gradients = torch.autograd.grad(total, [part[2] for part in branches])
        require_finite(total, terms)
        torch.testing.assert_close(total, reference, rtol=0, atol=0)
        for name in terms:
            torch.testing.assert_close(terms[name], reference_terms[name], rtol=0, atol=0)
        for actual, expected in zip(gradients, reference_gradients):
            torch.testing.assert_close(actual, expected, rtol=0, atol=0)

    def test_nonfinite_stops_before_backward(self) -> None:
        failures = [
            (torch.tensor(float("nan")), {}),
            (torch.tensor(1.0), {"loss_mask_ce": torch.tensor(float("inf"))}),
            (torch.empty((0, 4, 4)), {}),
        ]
        for loss, terms in failures:
            with self.assertRaises(FloatingPointError):
                require_finite(loss, terms)


if __name__ == "__main__":
    unittest.main()
