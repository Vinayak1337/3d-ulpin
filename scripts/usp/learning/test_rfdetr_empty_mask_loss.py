"""Tiny CPU loss/autograd regressions; no model, checkpoint, pixels or optimizer.

Run using the retained CPU-only Torch/Transformers5.17 interpreter.
"""
import copy
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import torch
from transformers.loss import loss_rf_detr

spec = importlib.util.spec_from_file_location("train_building_ramp", Path(__file__).with_name("train_building_ramp.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class ScalarEmptyMaskTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert torch.version.cuda is None, "Retained CPU-only runtime required; no GPU test"
        torch.set_num_threads(2)
        torch.set_num_interop_threads(1)
        cls.loss = staticmethod(runner.scalar_empty_rfdetr_loss(copy.deepcopy(runner.EMPTY_MASK_LOSS)))

    def inputs(self, empty):
        # 13 groups, one query each, one aux decoder and one encoder branch.
        # Four-pixel masks are tensors invented only for loss-contract control.
        config = SimpleNamespace(class_cost=1, bbox_cost=1, giou_cost=1,
            mask_point_sample_ratio=16, mask_class_loss_coefficient=2,
            mask_dice_loss_coefficient=2, num_labels=1, focal_alpha=.25,
            group_detr=13, auxiliary_loss=True, decoder_layers=2,
            class_loss_coefficient=1, bbox_loss_coefficient=5, giou_loss_coefficient=2)
        def branch():
            return (torch.full((1, 13, 1), -.5, requires_grad=True),
                torch.tensor([.5, .5, .5, .5]).repeat(1, 13, 1).requires_grad_(),
                torch.full((1, 13, 4, 4), .25, requires_grad=True))
        main, aux, encoder = branch(), branch(), branch()
        target = {"class_labels": torch.empty(0, dtype=torch.int64) if empty else torch.tensor([0]),
            "boxes": torch.empty((0, 4)) if empty else torch.tensor([[.5, .5, .5, .5]]),
            "masks": torch.empty((0, 4, 4)) if empty else torch.ones((1, 4, 4))}
        arguments = dict(logits=main[0], labels=[target], device=torch.device("cpu"),
            pred_boxes=main[1], pred_masks=main[2], config=config,
            outputs_class=torch.stack([aux[0], main[0]]),
            outputs_coord=torch.stack([aux[1], main[1]]),
            outputs_masks=torch.stack([aux[2], main[2]]),
            enc_outputs_class=encoder[0], enc_outputs_coord=encoder[1], enc_outputs_masks=encoder[2])
        return arguments, [main, aux, encoder]

    def test_empty_main_aux_encoder_keep_scalar_ce_and_mask_gradients(self):
        arguments, branches = self.inputs(True)
        total, terms, _ = self.loss(**arguments)
        self.assertEqual(total.shape, torch.Size([]))
        self.assertGreater(total.item(), 0, "Classification loss must survive empty mask branch")
        self.assertTrue(runner.finite_rfdetr_loss(total, terms, torch))
        for suffix in ["", "_0", "_enc"]:
            for name in ["loss_mask_ce", "loss_mask_dice"]:
                value = terms[name+suffix]
                self.assertEqual(value.shape, torch.Size([]))
                self.assertEqual(value.item(), 0)
                self.assertTrue(value.requires_grad)
        gradients = torch.autograd.grad(total, [b[2] for b in branches]+[b[0] for b in branches])
        for value in gradients[:3]:
            self.assertTrue(torch.isfinite(value).all())
            self.assertEqual(torch.count_nonzero(value).item(), 0)
        self.assertTrue(any(torch.count_nonzero(g).item() for g in gradients[3:]))
        # Actual original entry still has the observed broken empty shape.
        original_total, original_terms, _ = loss_rf_detr.RfDetrForSegmentationLoss(**arguments)
        self.assertEqual(original_total.numel(), 0)
        self.assertEqual(original_terms["loss_mask_ce"].shape, torch.Size([0, 4, 4]))
        # Global implementation is untouched; only private callable sees subclass.
        self.assertIs(self.loss.__code__, loss_rf_detr.RfDetrForSegmentationLoss.__code__)
        self.assertIsNot(self.loss.__globals__["RfDetrImageLoss"], loss_rf_detr.RfDetrImageLoss)

    def test_nonempty_full_loss_matches_original_values_and_gradients(self):
        arguments, branches = self.inputs(False)
        target_before = {k: v.clone() for k, v in arguments["labels"][0].items()}
        torch.manual_seed(42)
        expected_total, expected_terms, _ = loss_rf_detr.RfDetrForSegmentationLoss(**arguments)
        expected_gradients = torch.autograd.grad(expected_total, [b[2] for b in branches], retain_graph=True)
        torch.manual_seed(42)
        total, terms, _ = self.loss(**arguments)
        gradients = torch.autograd.grad(total, [b[2] for b in branches])
        torch.testing.assert_close(total, expected_total, rtol=0, atol=0)
        self.assertEqual(set(terms), set(expected_terms))
        for key in terms: torch.testing.assert_close(terms[key], expected_terms[key], rtol=0, atol=0)
        for actual, expected in zip(gradients, expected_gradients):
            torch.testing.assert_close(actual, expected, rtol=0, atol=0)
        for key, value in target_before.items():
            torch.testing.assert_close(arguments["labels"][0][key], value, rtol=0, atol=0)

    def test_nonfinite_component_or_total_still_stops_before_backward(self):
        for total, terms in [(torch.tensor(float("nan")), {"loss_ce": torch.tensor(1.)}),
            (torch.tensor(1.), {"loss_mask_ce": torch.tensor(float("inf"))}),
            (torch.empty((0, 4, 4)), {"loss_ce": torch.tensor(1.)})]:
            with self.assertRaisesRegex(ValueError, "stop before backward"):
                runner.require(runner.finite_rfdetr_loss(total, terms, torch),
                    "Nonfinite built-in loss; stop before backward and retain the attempt")

    def test_instance_restore_exception_source_and_historical_plan_binding(self):
        class Holder:
            @property
            def loss_function(self):
                return getattr(self, "_loss_function", loss_rf_detr.RfDetrForSegmentationLoss)
            @loss_function.setter
            def loss_function(self, value): self._loss_function = value
        for explicit in [False, True]:
            holder = Holder()
            if explicit: holder.loss_function = loss_rf_detr.RfDetrForSegmentationLoss
            with self.assertRaisesRegex(RuntimeError, "owned operation"):
                with runner.repaired_rfdetr_model_loss(holder, runner.EMPTY_MASK_LOSS):
                    self.assertIsNot(holder.loss_function, loss_rf_detr.RfDetrForSegmentationLoss)
                    raise RuntimeError("owned operation failed")
            self.assertIs(holder.loss_function, loss_rf_detr.RfDetrForSegmentationLoss)
            self.assertEqual(hasattr(holder, "_loss_function"), explicit)
        wrong = copy.deepcopy(runner.EMPTY_MASK_LOSS)
        wrong["sourcesCanonicalLfSha256"]["loss_rf_detr"] = "0"*64
        with self.assertRaisesRegex(ValueError, "source binding"):
            runner.scalar_empty_rfdetr_loss(wrong)
        read_bytes = Path.read_bytes
        def drift(path):
            data = read_bytes(path)
            return data+b"# changed source\n" if path == Path(loss_rf_detr.__file__) else data
        with patch.object(Path, "read_bytes", drift), self.assertRaisesRegex(ValueError, "source drift"):
            runner.scalar_empty_rfdetr_loss(runner.EMPTY_MASK_LOSS)
        historical = {"schemaVersion": runner.PILOT_VERSION, "task": "D07-RFDETR-PILOT-FIT",
            "trainingAuthorized": False, "state": "prepared_only"}
        with self.assertRaisesRegex(ValueError, "Historical pilot"):
            runner.validate_pilot(historical)
        with self.assertRaisesRegex(ValueError, "before imports"):
            runner.execute_trainer(historical, {})


if __name__ == "__main__":
    unittest.main()
