"""Numerical trainer checks only; these tensors are not operational source data."""

import unittest

import torch
import torch.nn.functional as F

from geo.usp_learning.lora import check_gradients, margin_loss, pair_plan


class LoraObjectiveTests(unittest.TestCase):
    def test_accumulated_gradients_equal_nested_family_objective(self):
        # Same 132-pair / 17-window shape as V8, with unequal mathematical groups.
        sizes = [5, 6, 6, 2, 3, 8, 4, 6, 1, 3]
        fields = [{"split": "train", "family": str(family), "target": "a" if i == 0 else None}
                  for family, count in enumerate(sizes) for i in range(count)]
        targets = [{"id": name} for name in ("a", "b", "c")]
        plan = pair_plan(fields, targets)
        self.assertEqual(len(plan["pairs"]), 132)
        self.assertEqual([len(w) for w in plan["epochWindows"][0]], [8] * 16 + [4])
        for windows in plan["epochWindows"]:
            self.assertEqual(sorted(i for window in windows for i in window), list(range(132)))
        x = torch.tensor(0.37, dtype=torch.float64, requires_grad=True)
        features = torch.linspace(-1.2, 2.1, 132, dtype=torch.float64)
        labels = torch.tensor([p["label"] for p in plan["pairs"]], dtype=torch.float64)
        losses = F.binary_cross_entropy_with_logits(x * features, labels, pos_weight=torch.tensor(8.0), reduction="none")
        # Independent nested oracle, not implemented with pair_plan's weights.
        family_means, offset = [], 0
        for count in sizes:
            family_means.append(losses[offset:offset + count * 3].reshape(count, 3).mean(1).mean())
            offset += count * 3
        oracle = torch.stack(family_means).mean()
        expected = torch.autograd.grad(oracle, x, retain_graph=True)[0]
        gradients = []
        for window in plan["epochWindows"][0]:
            loss = sum(losses[i] * plan["pairs"][i]["backwardWeight"] for i in window)
            gradients.append(torch.autograd.grad(loss, x, retain_graph=True)[0])
        torch.testing.assert_close(torch.stack(gradients).mean(), expected, rtol=1e-12, atol=1e-12)
        self.assertAlmostEqual(sum(p["objectiveWeight"] for p in plan["pairs"]), 1.0)

    def test_native_margin_positive_weight_and_all_negative_supervision(self):
        logits = torch.tensor([[[2.0, 5.0]]], dtype=torch.float16, requires_grad=True)
        positive = margin_loss(logits, yes=1, no=0, label=1)
        negative = margin_loss(logits, yes=1, no=0, label=0)
        self.assertEqual(positive.dtype, torch.float32)
        torch.testing.assert_close(positive, 8 * F.softplus(torch.tensor(-3.0)))
        torch.testing.assert_close(negative, F.softplus(torch.tensor(3.0)))
        negative.backward()
        self.assertGreater(logits.grad[0, 0, 1].item(), 0)
        self.assertLess(logits.grad[0, 0, 0].item(), 0)

    def test_margin_casts_before_subtraction(self):
        logits = torch.tensor([[[-65504.0, 65504.0]]], dtype=torch.float16, requires_grad=True)
        loss = margin_loss(logits, 1, 0, 0)
        self.assertTrue(torch.isfinite(loss))
        self.assertEqual(loss.item(), 131008.0)

    def test_gradient_guard_allows_zero_a_but_rejects_invalid_gradients(self):
        a, b = torch.nn.Parameter(torch.ones(2)), torch.nn.Parameter(torch.ones(2))
        a.grad, b.grad = torch.zeros(2), torch.ones(2)
        self.assertEqual(check_gradients([("a", a), ("b", b)])["zeroGradientTensors"], 1)
        for invalid in (None, torch.tensor([float("inf"), 1.0]), torch.tensor([float("nan"), 1.0]), torch.zeros(2)):
            b.grad = invalid
            with self.assertRaises(RuntimeError):
                check_gradients([("a", a), ("b", b)])

    def test_closed_splits_cannot_enter_training(self):
        for split in ("calibration", "evaluation", "diagnostic"):
            with self.assertRaises(ValueError):
                pair_plan([{"split": split, "family": "math", "target": None}], [{"id": "a"}])


if __name__ == "__main__":
    unittest.main()
