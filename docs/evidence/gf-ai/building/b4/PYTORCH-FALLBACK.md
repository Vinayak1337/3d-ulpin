# B4 — measured PyTorch fallback, not a served model

The strict ONNX export remains unqualified. `b4-pytorch-fallback-20261010/result.json`
measures the existing FP32/eval PyTorch adapter with the unchanged production
preprocessing, tiling, painting and polygonization on two real DEV chips.
It is an in-process CPU measurement while training owns the GPU, not API latency
or an accuracy/serving qualification. It does not use Karnataka HOLDOUT.
The additional `b4-pytorch-resource-20261010/result.json` records model-load time,
RSS before/after loading, final RSS and peak working set using `psutil`. The
process peak includes Python/framework overhead and two source-chip calls; it is
not a full-image capacity or concurrent-job benchmark. No model was moved onto
the training GPU for these measurements. CPU-vs-CUDA raw parity is not qualified.

## Existing path and minimum integration work (not built here)

- `services/geo/geo/api.py` exposes private `/internal/spatial-ml/status`; the existing
  job path dispatches `spatial-inference`. No new public route or queue is needed.
- `services/geo/geo/spatial_ml.py::_run_model` currently constructs an ONNX session.
  Add an explicitly selected, cached safetensors/config-backed PyTorch adapter there,
  equivalent to `scripts/ml/eval_buildings.py::session`, returning the same logits/masks.
  Keep the existing `_building_tile`, `_resize_logits`, `_components`, source validation,
  CPU thread limit and resource limits; reject remote code and implicit model downloads.
- Pin checkpoint AND config hashes and byte sizes in the existing model manifest; extend
  readiness to actually import/check the selected backend. Keep the old ONNX model entry.
- The receipt currently hard-codes `backend=onnxruntime-cpu` and ORT version. Report
  `PyTorch-cpu`, Torch/Transformers versions and the actual pinned profile for that backend.
  Keep candidates uncalibrated, pixel-space and non-authoritative.
- The processor Dockerfile installs `requirements.txt` and `requirements-ml.txt`; the
  latter has ONNX and PDFium, not Torch/Transformers. Add bounded CPU-only pinned packages
  and immutable local checkpoint/config mounts through the runtime owner. The measured
  environment is Torch 2.8.0 / Transformers 5.17.0; an unrelated learning requirements file
  is not proof the live spatial processor can run this model.
- `packages/server/src/modules/spatial/spatial-ml.ts` already discovers model readiness,
  queues through the one job authority and validates `spatial-inference/1`. Reuse that
  contract and review path; only a necessary receipt/backend-version change belongs there.
- Do not activate before owner licence clearance (RAMP CC-BY-NC/upstream imagery terms),
  model review, CPU resource checks and the demo area's K2 installation. No registry,
  Docker, application or serving code was changed by B4.

## Decision

The first structural mismatch is encoder proposal rank assignment, not upsampling:
FP32 scores swap the same two selected proposals at ranks 60/61. Learned query
features bind by rank, so this propagates beyond a harmless output permutation.
Changing to opset 16 and explicit LayerNorm reductions with ORT optimizations disabled
fixes that particular chip's swap but causes another chip's mismatch; strict parity
still fails. Tolerances and the PyTorch reference were not changed.

Stop further export trials in this session. A future deterministic encoder-ranking
inference profile would need a new DEV comparison and transfer-qualified model card;
it cannot inherit B3's Karnataka HOLDOUT result. B4's single Coxs Bazar transfer
slot is consumed, so any future candidate needs a separately approved independent
transfer protocol. Do not mask the gap by aligning,
rounding or ignoring raw outputs solely to obtain a passing parity receipt.
