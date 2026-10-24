"""Instance-local scalar empty-mask repair and chunked mask loss; the upstream objective is unchanged."""

from pathlib import Path
from types import FunctionType
import hashlib
from typing import Any, Callable

import torch

SOURCE_HASHES = {
    "loss_rf_detr": "db5a352ca7c9c0e0cfc2af7af29e6d348ec72391b5b82b38fedf23f0b4d32ece",
    "loss_lw_detr": "c7b271e3011dca508736fd8fec310a137e57da96b3dcdad2c60bc3d22ef5ce98",
}
REVISION = "ulpin-rfdetr-empty-mask-scalar-chunked/2"
MASK_LOSS_CHUNK = 64


def gather_target_masks(targets: list, indices: list, start: int, stop: int) -> torch.Tensor:
    """Matched target masks for flat pair positions [start, stop), in upstream concatenation order."""
    parts = []
    offset = 0
    for target, (_, matched) in zip(targets, indices):
        first = max(start - offset, 0)
        last = min(stop - offset, len(matched))
        if first < last:
            parts.append(target["masks"][matched[first:last]])
        offset += len(matched)
    return torch.cat(parts, dim=0)


def chunked_mask_terms(
    source_masks: torch.Tensor, targets: list, indices: list, num_boxes: Any, point_sample_ratio: int
) -> dict[str, torch.Tensor]:
    from transformers.loss.loss_rf_detr import (
        dice_loss,
        sample_point,
        sample_points_using_uncertainty,
        sigmoid_cross_entropy_loss,
    )

    source_masks = source_masks.unsqueeze(1)
    num_points = max(source_masks.shape[-2], source_masks.shape[-2] * source_masks.shape[-1] // point_sample_ratio)
    with torch.no_grad():
        point_coords = sample_points_using_uncertainty(source_masks, num_points, 3, 0.75)
    cross_entropy = []
    dice = []
    for start in range(0, source_masks.shape[0], MASK_LOSS_CHUNK):
        stop = start + MASK_LOSS_CHUNK
        coords = point_coords[start:stop]
        with torch.no_grad():
            target_masks = gather_target_masks(targets, indices, start, stop).unsqueeze(1).float()
            labels = sample_point(target_masks, coords, align_corners=False, mode="nearest").squeeze(1)
        logits = sample_point(source_masks[start:stop], coords, align_corners=False).squeeze(1)
        cross_entropy.append(sigmoid_cross_entropy_loss(logits, labels, 1))
        dice.append(dice_loss(logits, labels, 1))
    return {"loss_mask_ce": sum(cross_entropy) / num_boxes, "loss_mask_dice": sum(dice) / num_boxes}


def repaired_loss() -> Callable[..., Any]:
    import transformers
    from transformers.loss import loss_rf_detr, loss_lw_detr

    if transformers.__version__ != "5.17.0":
        raise ValueError("Empty-mask repair version drift")
    for name, module in [("loss_rf_detr", loss_rf_detr), ("loss_lw_detr", loss_lw_detr)]:
        digest = hashlib.sha256(Path(module.__file__).read_bytes().replace(b"\r\n", b"\n")).hexdigest()
        if digest != SOURCE_HASHES[name]:
            raise ValueError("Empty-mask repair source drift: " + name)
    original = loss_rf_detr.RfDetrForSegmentationLoss

    class ScalarEmptyMasks(loss_rf_detr.RfDetrImageLoss):
        def loss_masks(
            self, outputs: dict[str, Any], targets: list, indices: list, num_boxes: Any
        ) -> dict[str, torch.Tensor]:
            source = outputs["pred_masks"][self._get_source_permutation_idx(indices)]
            if source.numel() == 0:
                zero = source.sum()
                return {"loss_mask_ce": zero, "loss_mask_dice": zero}
            return chunked_mask_terms(source, targets, indices, num_boxes, self.mask_point_sample_ratio)

    result = FunctionType(
        original.__code__,
        {**original.__globals__, "RfDetrImageLoss": ScalarEmptyMasks},
        name=original.__name__,
        argdefs=original.__defaults__,
        closure=original.__closure__,
    )
    result.__kwdefaults__ = original.__kwdefaults__
    return result


def require_finite(total: torch.Tensor, terms: dict[str, torch.Tensor]) -> None:
    if (
        total.ndim != 0
        or not torch.isfinite(total)
        or any(value.ndim != 0 or not torch.isfinite(value) for value in terms.values())
    ):
        raise FloatingPointError("Non-scalar/non-finite RF-DETR loss: stop before backward")
