"""Actual pinned loss contract regression, CPU tensors only (no GPU or holdout)."""
from types import SimpleNamespace
import unittest
import torch
from transformers.loss import loss_rf_detr
from rfdetr_loss import repaired_loss, require_finite


class EmptyMaskLossTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)
        cls.loss = staticmethod(repaired_loss())

    def inputs(self, empty):
        config = SimpleNamespace(class_cost=1, bbox_cost=1, giou_cost=1,
            mask_point_sample_ratio=16, mask_class_loss_coefficient=2,
            mask_dice_loss_coefficient=2, num_labels=1, focal_alpha=.25,
            group_detr=13, auxiliary_loss=True, decoder_layers=2,
            class_loss_coefficient=1, bbox_loss_coefficient=5, giou_loss_coefficient=2)
        def branch():
            return (torch.full((1,13,1),-.5,requires_grad=True),
                torch.tensor([.5,.5,.5,.5]).repeat(1,13,1).requires_grad_(),
                torch.full((1,13,4,4),.25,requires_grad=True))
        main, aux, enc = branch(), branch(), branch()
        target = {'class_labels':torch.empty(0,dtype=torch.int64) if empty else torch.tensor([0]),
            'boxes':torch.empty((0,4)) if empty else torch.tensor([[.5,.5,.5,.5]]),
            'masks':torch.empty((0,4,4)) if empty else torch.ones((1,4,4))}
        return dict(logits=main[0],labels=[target],device=torch.device('cpu'),
            pred_boxes=main[1],pred_masks=main[2],config=config,
            outputs_class=torch.stack([aux[0],main[0]]),
            outputs_coord=torch.stack([aux[1],main[1]]),
            outputs_masks=torch.stack([aux[2],main[2]]),
            enc_outputs_class=enc[0],enc_outputs_coord=enc[1],enc_outputs_masks=enc[2]), [main,aux,enc]

    def test_empty_main_aux_encoder_scalar_ce_and_gradients(self):
        args, branches = self.inputs(True)
        broken, terms, _ = loss_rf_detr.RfDetrForSegmentationLoss(**args)
        self.assertEqual(broken.numel(),0, 'Pinned upstream bug must still be present')
        self.assertEqual(terms['loss_mask_ce'].shape,torch.Size([0,4,4]))
        total, terms, _ = self.loss(**args)
        require_finite(total,terms)
        self.assertGreater(total.item(),0, 'Classification supervision survives empty masks')
        for suffix in ['', '_0', '_enc']:
            for name in ['loss_mask_ce','loss_mask_dice']:
                self.assertEqual(terms[name+suffix].shape,torch.Size([]))
                self.assertEqual(terms[name+suffix].item(),0)
        gradients = torch.autograd.grad(total,[b[2] for b in branches]+[b[0] for b in branches])
        for g in gradients[:3]:
            self.assertTrue(torch.isfinite(g).all())
            self.assertEqual(torch.count_nonzero(g).item(),0)
        self.assertTrue(any(torch.count_nonzero(g).item() for g in gradients[3:]))
        self.assertIs(self.loss.__code__,loss_rf_detr.RfDetrForSegmentationLoss.__code__)
        self.assertIsNot(self.loss.__globals__['RfDetrImageLoss'],loss_rf_detr.RfDetrImageLoss)

    def test_nonempty_values_and_gradients_are_identical(self):
        args, branches = self.inputs(False)
        torch.manual_seed(42)
        ref, ref_terms, _ = loss_rf_detr.RfDetrForSegmentationLoss(**args)
        ref_grad = torch.autograd.grad(ref,[b[2] for b in branches],retain_graph=True)
        torch.manual_seed(42)
        total, terms, _ = self.loss(**args)
        grad = torch.autograd.grad(total,[b[2] for b in branches])
        require_finite(total,terms)
        torch.testing.assert_close(total,ref,rtol=0,atol=0)
        for k in terms: torch.testing.assert_close(terms[k],ref_terms[k],rtol=0,atol=0)
        for a,b in zip(grad,ref_grad): torch.testing.assert_close(a,b,rtol=0,atol=0)

    def test_nonfinite_stops_before_backward(self):
        for loss,terms in [(torch.tensor(float('nan')),{}),(torch.tensor(1.),{'loss_mask_ce':torch.tensor(float('inf'))}),(torch.empty((0,4,4)),{})]:
            with self.assertRaises(FloatingPointError): require_finite(loss,terms)


if __name__ == '__main__':
    unittest.main()
