# B6 — higher-resolution building recall: capacity blocker

## TASK

GF-AI/building_mask, `task/b6-resolution` from `staging` `9436cffb`, in `E:/Projects/ulpin-wt/b3`.
**Partial return, not an accuracy rejection or completed training task.** Sole GPU work has stopped; GPU released.

## WORKS

- Configurable direct RGB training/serving resolution, valid multiples of 24, effective batch 4.
- Keep publisher starting weights, original positional parameters, constant LR, BF16, seed, losses and flips.
- Retain epoch 4's 432-pixel target masks; image-dependent predictions and point sampling follow resolution.
- Optional standard HF non-reentrant backbone/decoder recomputation, preserved RNG.
- DEV size-bin accounting uses unchanged source-mask truth matching and retains zero-pixel features.
- Eight-epoch ceiling and strict recall patience 3 stop only at fully scored checkpoints.
- Matching-resolution/batch/recomputation 50-step smoke is required before detached launch.
- Chittagong transfer-2 is committed and frozen. TRAIN export rejects both frozen transfer regions.

## SEE IT

- `docs/evidence/gf-ai/building/b6/result.json`: status and exact unfinished stages.
- `b6/capacity-plan.json`: failure signatures, bounded comparisons, stop decisions.
- `b6/final-invariants.json`, `b6/checks.json`: hashes, two real TRAIN checks, lean verification.
- `docs/evidence/gf-ai/preregistration.json`: `building_mask_transfer_2`.
- External failed-run configs, journals and traces: `E:/BhuAayam-data/ml/runs/b6-smoke-*/`.
- External transfer preparation: `E:/BhuAayam-data/ml/datasets/b6-chittagong-transfer2-20261010/`.
- Zero-inference integrity recheck:

```text
E:/BhuAayam-data/ml/venv-vision/Scripts/python.exe -B E:/BhuAayam-data/ml/runs/b6-final-verification-20261010.py
```

Omit `--record`: the original record exists and exclusive-create intentionally denies overwriting it.
The readable repository receipt uses forward-slash paths; the original compact execution receipt stays external.

## INPUTS

Karnataka TRAIN remains 3,581 chips, 28,328 features, 880 empty chips, with its original COCO and split hashes.
The smoke includes two empties, difficult labels and the largest TRAIN chip:
`fe8af002-5d39-457e-84b1-06308a6971c6`, 76 publisher features.

Chittagong is the smallest complete never-used eligible Bangladesh region by manifest bytes (1,078,209,732).
Excluded: Coxs Bazar (closed transfer), Barishal (prior TRAIN smoke), Dhaka (prior TRAIN export).
Jashore and Sylhet are larger. No predictions or accuracy affected region selection.

Prepared whole-region truth: **5,229 chips / 35,421 features / 1,282 empties / 9 zero-pixel features**.
Its README claims 38,096 buildings; preserve actual originals, not the extra 2,675 implied by the README.
It is Tier 1 publisher-reviewed roof truth, CC-BY-NC-4.0, test-only, not surveyed rights/registry truth.
There is no exact original-image byte overlap with 23,592 prior project-region originals and no raster-footprint
intersection with Coxs Bazar. README acquisition IDs differ. Upstream pretraining overlap remains unknown.

## GAPS

All four capacity runs failed safely under the 6 GiB cap:

| Run | RGB / targets | Recompute | Completed optimizer steps | Peak reserved bytes |
| --- | --- | --- | ---: | ---: |
| Initial 672 | 672 / 672 (implementation defect) | backbone | 0 | 6,190,792,704 |
| Corrected 672 | 672 / 432 | backbone | 0 | 5,792,333,824 |
| Bounded 624 | 624 / 432 | backbone | 4 | 6,253,707,264 |
| Memory comparison 672 | 672 / 432 | backbone + decoder | 0 | 5,945,425,920 |

The failure is dense target-mask concatenation: 76 features × 13 matching groups × 432² × float32 needs
737,538,048 bytes (704 MiB) for the concatenated tensor, in addition to resident targets/graphs/optimizer.
The initial erroneous target upscaling requested 1.66 GiB. Correcting it and decoder recomputation did not qualify.
These are allocation-cap OOMs, not completed measurements above the budget. No failed run ID was relaunched.

**No resolution qualified. 576 and smaller compatible grids were not tested; the hardware maximum is unknown.**
No full training, per-epoch DEV inference, fresh-region evaluation, ONNX export, new parity or registration occurred.
The four optimizer updates belong only to the failed 624 smoke, not to a selected model or reusable candidate.

The paired transfer-2 runner/reservation guard is **not implemented**. The existing `--split transfer` CLI still binds
closed B4 Coxs Bazar; do not use it for Chittagong. Both new slots remain untouched in `transfer-2-runs.jsonl`.
There are no two evaluation commits to order behind preregistration, because neither evaluation was performed.

## DESIGN

Only capacity inputs used TRAIN. No tuning from closed Karnataka HOLDOUT or Coxs Bazar.
Mask Dice remains 5; no proposal/matching objective changes, label dropping, allocator changes or precision tricks.
Model-compatible grids are multiples of `patch_size 12 × num_windows 2`; 640 is invalid.
The 672/624/576 bracket was bounded, not proof of a global maximum. Preserve all failed run IDs and records.

Serving now receives input resolution from the registry shape, defaulting to the same 432 transform.
Mocked seams and direct tensor comparisons confirm default behavior, not renewed ONNX parity/accuracy claims.
B5's original graph/result/card/registry are unchanged and remain scoped to their original implementation.
A future larger-resolution graph needs adapted export and a new hash-bound parity protocol before registration.

## COMMITS

- `3b379942` — `feat(ml): configurable input resolution with accumulation`.
- `fc0d6aaa` — `docs(ml): preregister paired transfer-2 comparison`, before any new-region evaluation.
- Final evidence commit: `docs(ml): record B6 memory blocker and transfer-2 reservation`.

No push, merge, rebase, activation, installation, runtime/database change or other-checkout edit.

## CHECKS

23 ML unit tests pass (9 new resolution/guard/accounting tests); 5 focused geo serving/readiness cases pass.
Ruff passes on touched Python; Black passes on the 3 new/formatted scripts; no full legacy Black claim.
Typed new helpers are at most 40 lines; new/added lines at most 120 columns; `git diff --check` passes.
Real empty and 76-feature TRAIN inputs have verified source pixels, finite 672 RGB, and exactly unchanged targets.
Saved-failure integrity recheck performs no inference or optimizer update. Original split, closed ledgers,
loss repair, registry, B5 parity/card and earlier preregistration sections stay unchanged.

## NEXT

1. Lead reviews the memory blocker and chooses whether to authorize a new bounded memory-only comparison or
   smaller-resolution capacity plan. Do not repeat these failed runs or continue an unqualified full training.
2. If capacity qualifies, start a **new publisher-base** run with recorded recipe and GPU window; maximum 8 epochs,
   recall patience 3, DEV size bins each epoch. Keep the rejected Dice experiment unstarted.
3. Freeze the finished DEV-selected weights/config/profile and receipts in a commit. Implement/test the paired
   fail-closed reservation guard; only then evaluate epoch 4 and B6 once each on the frozen Chittagong inventory.
4. Require strictly higher recall on DEV and transfer-2, and candidate precision ≥0.75 on both. These are transfer
   claims, never a new Karnataka HOLDOUT claim. Export/parity/inactive registration only if B6 wins.

**Retain epoch 4, inactive/test-only/uncalibrated. No worker process or model installation is pending.**

## Outcome (B6b, recorded 10 October 2026)

- Chunked mask loss (loss-identical on CPU) let 672 train within the 6 GiB cap; run `b6b-train-r672` stopped at epoch 6 on recall patience.
- **B6 is rejected on DEV.** Best epoch 3: recall 0.640, precision 0.866. Epoch 4 (B3, 432 px) has recall 0.662, precision 0.854.
  The preregistered rule needs strictly higher DEV recall first, so transfer-2 never ran.
- Small-roof bins did not improve either (128-256 px 0.352 vs 0.395; 64-128 px 0.257 vs 0.298; 16-64 px 0.106 vs 0.127).
- Transfer-2: 0 evaluations; both slots (`epoch4`, `b6`) unspent. Keep epoch 4 as the demo candidate.
- B6 checkpoints stay outside Git, are not registered and are not exported.
- Revisit only with a different principal factor after a fresh diagnosis. Details: `b6/b6-decision.json`.
