"""Fixed offline Qwen objective; no corpus, threshold or production routing changes."""

from __future__ import annotations

from collections import Counter
import math
import random

import torch
import torch.nn.functional as F


def pair_plan(fields: list[dict], targets: list[dict], *, epochs: int = 3,
              accumulation: int = 8, seed: int = 17) -> dict:
    """Mean pair -> mean field -> mean family, partitioned into optimizer windows.

    For F families, n_f fields, T targets and K windows, a pair's backward
    multiplier is K/(F*n_f*T). The mean of K window objectives is exactly the
    full equal-family objective at fixed parameters. The final short window
    keeps this multiplier: renormalizing it would overweight its examples.
    Optimizer updates occur between windows, as in ordinary minibatch training.
    """
    if not fields or any(field["split"] != "train" for field in fields):
        raise ValueError("only training fields may enter the objective")
    if accumulation < 1 or epochs < 1 or not targets:
        raise ValueError("invalid accumulation, epochs or targets")
    counts = Counter(field["family"] for field in fields)
    pair_count = len(fields) * len(targets)
    windows = math.ceil(pair_count / accumulation)
    pairs = [{"fieldIndex": i, "targetIndex": j,
              "label": int(field["target"] == target["id"]),
              "objectiveWeight": 1 / (len(counts) * counts[field["family"]] * len(targets)),
              "backwardWeight": windows / (len(counts) * counts[field["family"]] * len(targets))}
             for i, field in enumerate(fields) for j, target in enumerate(targets)]
    rng = random.Random(seed)
    orders = []
    for _ in range(epochs):
        order = list(range(pair_count))
        rng.shuffle(order)
        orders.append([order[i:i + accumulation] for i in range(0, pair_count, accumulation)])
    return {"familyFieldCounts": dict(sorted(counts.items())), "pairs": pairs,
            "windowsPerEpoch": windows, "epochWindows": orders,
            "normalization": "K/(F*n_f*T) per pair; no extra division by window size, including final partial window"}


def margin_loss(logits: torch.Tensor, yes: int, no: int, label: int) -> torch.Tensor:
    """Float32 BCE on the model's native final-token yes-minus-no margin."""
    margin = logits[:, -1, yes].float() - logits[:, -1, no].float()
    return F.binary_cross_entropy_with_logits(
        margin, torch.full_like(margin, float(label)), pos_weight=margin.new_tensor(8.0))


def check_gradients(named_parameters: list[tuple[str, torch.nn.Parameter]]) -> dict:
    missing, nonfinite, nonzero = [], [], []
    for name, parameter in named_parameters:
        if parameter.grad is None:
            missing.append(name)
        elif not bool(torch.isfinite(parameter.grad).all()):
            nonfinite.append(name)
        elif bool(torch.count_nonzero(parameter.grad)):
            nonzero.append(name)
    # LoRA A can legitimately be zero on the first backward because B starts zero.
    if missing or nonfinite or not nonzero:
        raise RuntimeError(f"invalid adapter gradients: missing={missing}, nonfinite={nonfinite}, nonzero={len(nonzero)}")
    return {"parameterTensors": len(named_parameters), "nonzeroGradientTensors": len(nonzero),
            "zeroGradientTensors": len(named_parameters) - len(nonzero)}


def validate_adapter(model: torch.nn.Module) -> list[tuple[str, torch.nn.Parameter]]:
    named = [(name, p) for name, p in model.named_parameters() if p.requires_grad]
    expected = {f"base_model.model.model.layers.{layer}.self_attn.{projection}.lora_{part}.default.weight"
                for layer in range(28) for projection in ("q_proj", "v_proj") for part in ("A", "B")}
    if {name for name, _ in named} != expected or sum(p.numel() for _, p in named) != 1146880:
        raise ValueError("only rank-8 q/v adapters across all 28 blocks may be trainable")
    if any(p.dtype != torch.float32 for _, p in named):
        raise ValueError("FP32 adapter/master gradients required for FP16 GradScaler")
    if model.get_input_embeddings().weight.requires_grad or model.get_output_embeddings().weight.requires_grad:
        raise ValueError("base/output weights must remain frozen")
    return named
