TASK   B5 — instance parity, inactive registration and recall diagnosis    GATE GF-AI/building_mask
WORKS  V2 passes all 20 chips; epoch4 is registered as an inactive candidate; DEV recall is attributed to size/edge/adjacency.
SEE IT `E:/BhuAayam-data/ml/venv-vision/Scripts/python.exe -B -c "import json; print(json.load(open('docs/evidence/gf-ai/building/b5/result.json'))['outcome'])"`
INPUTS Fixed 20 DEV chips, including empty `00b7c967-d761-43df-a996-aaba86e15107` and difficult `0020b409-a333-4eb4-89c8-531b8110312a`; all 13,156 Karnataka DEV publisher features.
GAPS   Recall still below target; occlusion unknown; no activation, installation, demo inference or independent new accuracy claim.
DESIGN `check_building_instances` reuses production painting/polygons then Hungarian-matches final masks, scores and pixel bounds; v1 remains failed. Existing manifest registration plus `_verified_path` enforces `active=false` before weights/source access. `diagnose_building_recall` combines saved counts, ambiguous-chip DEV replay, declared TIFF frames and original publisher geometry; shared evaluator helpers keep matching unchanged.
COMMITS `7a2cf87a` preregister v2; `85f90ac0` order-invariant check; `60de8150` inactive registration; this commit contains the recall diagnosis and final checks.
CHECKS `check_building_instances.py --run-id b5-instance-parity-20261010` and `diagnose_building_recall.py --run-id b5-recall-diagnosis-20261010`: exit 0, already finished; do not repeat. `test_check_building_instances.py` (2), `test_diagnose_building_recall.py` (3), `test_eval_buildings.py` (4), focused spatial-ML pytest (3), Ruff, four-file Black, new-line/helper bounds, saved-output invariants and `git diff --check`: exit 0. Exact commands in `result.json`.
NEXT   Lead reviews activation/licence scope; runtime owner installs the demo area before any imagery inference. One new mask-Dice emphasis experiment is proposed, not started; current GPU window is released. Karnataka HOLDOUT and Coxs Bazar remain permanently closed.

## Decisions and scope

- V2 was committed first: unchanged epoch4 **opset17**, CPU FP32, production .5.
  Counts match; no threshold exceptions. Minimum IoU .999345, max score delta
  .000092, zero source-pixel box movement. This qualifies single-chip instances,
  not raw v1, seams or full-held-out ONNX accuracy. V1 is embedded unchanged.
- Existing manifest is the registry; backend `spatialMlStatus` discovers it.
  Original entries remain intact. `active=false` previously did not block
  execution, so the weight-path guard now enforces it. No new service or API.
  Model card retains exact PyTorch-cuda DEV/HOLDOUT/transfer measurements.
- Existing DEV journals contain only chip totals, not feature matches/masks.
  580 chips use unambiguous saved counts; 854 partial chips replayed once on DEV.
  Every TP and prediction count matches the frozen receipt. Source bytes remain
  unchanged; metric areas are geodesic from declared TIFF frames, not nominal GSD.
- Below 40 m²: recall **.421** (1,811 TP / 4,300 truth), versus **.780** above it.
  Small truth is 32.68% of features but 56.05% of false negatives. Shared-edge
  recall .553 vs .666, with only 167 / 4,441 misses; raster-contact proxy .576
  vs .680. The small+shared-edge group has recall .263. Size is the stronger
  concentration; adjacency is associated, not the dominant explanation.
  Chip-edge distance has no monotonic deficit; occlusion has no publisher label.
- One proposal: standard `mask_dice_loss_coefficient` 5 → 10, explicitly changing
  both matching cost and weighted Dice supervision. Same data/profile/seed and
  safeguards; three epochs, about 55 GPU minutes, ≤6 GiB; DEV-only comparison,
  no inherited HOLDOUT/transfer claim. `proposed-experiment.json` defines success,
  cost and stops. No training was started.

Large outputs stay external. Formatting finished after interruption; no model
step was restarted. New isolated pytest venv leaves the vision venv untouched.
Git Bash path conversion was fixed via explicit read-only `sys.path` injection.
