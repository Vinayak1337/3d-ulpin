"""Instance-local scalar empty-mask repair; upstream nonempty loss is unchanged."""
from pathlib import Path
from types import FunctionType
import hashlib

SOURCE_HASHES = {
    'loss_rf_detr': 'db5a352ca7c9c0e0cfc2af7af29e6d348ec72391b5b82b38fedf23f0b4d32ece',
    'loss_lw_detr': 'c7b271e3011dca508736fd8fec310a137e57da96b3dcdad2c60bc3d22ef5ce98',
}
REVISION = 'ulpin-rfdetr-empty-mask-scalar/1'


def repaired_loss():
    import transformers
    from transformers.loss import loss_rf_detr, loss_lw_detr
    if transformers.__version__ != '5.17.0':
        raise ValueError('Empty-mask repair version drift')
    for name, module in [('loss_rf_detr', loss_rf_detr), ('loss_lw_detr', loss_lw_detr)]:
        digest = hashlib.sha256(Path(module.__file__).read_bytes().replace(b'\r\n', b'\n')).hexdigest()
        if digest != SOURCE_HASHES[name]:
            raise ValueError('Empty-mask repair source drift: ' + name)
    original = loss_rf_detr.RfDetrForSegmentationLoss

    class ScalarEmptyMasks(loss_rf_detr.RfDetrImageLoss):
        def loss_masks(self, outputs, targets, indices, num_boxes):
            source = outputs['pred_masks'][self._get_source_permutation_idx(indices)]
            if source.numel() == 0:
                zero = source.sum()
                return {'loss_mask_ce': zero, 'loss_mask_dice': zero}
            return super().loss_masks(outputs, targets, indices, num_boxes)

    result = FunctionType(original.__code__,
        {**original.__globals__, 'RfDetrImageLoss': ScalarEmptyMasks},
        name=original.__name__, argdefs=original.__defaults__, closure=original.__closure__)
    result.__kwdefaults__ = original.__kwdefaults__
    return result


def require_finite(total, terms):
    import torch
    if total.ndim != 0 or not torch.isfinite(total) or any(v.ndim != 0 or not torch.isfinite(v) for v in terms.values()):
        raise FloatingPointError('Non-scalar/non-finite RF-DETR loss: stop before backward')
