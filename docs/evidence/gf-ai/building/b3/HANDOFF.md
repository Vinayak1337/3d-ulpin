TASK   B2+B3 — RAMP building fine-tune            GATE GF-AI/building_mask
WORKS  Load epoch-004 and inspect cited baseline/DEV/final-HOLDOUT results; GPU released.
SEE IT E:/BhuAayam-data/ml/venv-vision/Scripts/python.exe -m json.tool docs/evidence/gf-ai/building/b3/result.json
INPUTS Karnataka publisher roofs; real dense TRAIN chip 0141cae2 and empty TRAIN chip 002715ff.
GAPS   Recall target unmet; ONNX raw parity failed; serving registration blocked.

DESIGN `building_io.py` shares offline configuration, hashes and append-only records.
       `train_buildings.py` uses standard Trainer with local empty-mask repair and DEV checkpoint scoring.
       `select_buildings.py` compares completed DEV receipts; `export_buildings.py` measures strict 20-chip parity.

The detached process stopped normally at its timebox after four epochs, not by crash or OOM.
All four checkpoints at the same three recorded thresholds were compared on DEV only.
Epoch 4 / threshold .5 was committed in `f42dafd5` before the final HOLDOUT reservation.
Both allowed HOLDOUT slots are now consumed. Never reopen them for a later candidate.

Weights, checkpoints, original execution records and large journals remain outside Git.
Compact result JSONs point to preserved original bytes; holdout completion hashes still verify.
The quality refactor matches all eight prior smoke TRAIN tensors exactly and keeps finite
loss/gradients on real empty and dense chips without optimizer updates.

`rfdetr-ramp-ka-seg-medium-b3-v1/model-card.json` records source/licence/hashes/config/metrics/failures.
`registration-request.json` is blocked, not an active model registration. The serving registry remains
outside G1's owned paths and is B4-owned. Do not promote the numerically unqualified ONNX graph.

NEXT: Lead/B4 must diagnose strict export parity before serving. One additional four-epoch
schedule is proposed, not started: same data/profile/LR/AMP, about 90 GPU minutes, success requires
both DEV thresholds, stop at four epochs/three non-improvements/nonfinite loss/>6 GiB.
No further HOLDOUT is available under the frozen protocol. Numbers and verification are in `result.json`
and `final-invariants.json`; the failed exporter exits 1, intentionally, rather than claiming parity.
