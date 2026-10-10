TASK   B4 — building continuation, strict parity diagnosis and transfer    GATE GF-AI/building_mask
WORKS  Completed a safely stopped continuation, retained epoch4 on DEV, measured one independent-region transfer and the CPU fallback.
SEE IT `E:/BhuAayam-data/ml/venv-vision/Scripts/python.exe -B -c "import json; print(json.load(open('docs/evidence/gf-ai/building/b4/result.json'))['outcome'])"`
INPUTS Karnataka TRAIN/DEV; real empty DEV chip `00b7c967-d761-43df-a996-aaba86e15107`, difficult 11-feature chip `0020b409-a333-4eb4-89c8-531b8110312a`; whole RAMP Coxs Bazar transfer region.
GAPS   DEV and transfer recall miss the target; strict ONNX parity fails. PyTorch is measured, not served or CPU-vs-CUDA parity-qualified. Nothing registered/activated.
DESIGN `train_buildings.DevEpochs` checkpoints and serially scores DEV, restoring lineage recall patience; `select_buildings` compares unchanged epoch4 receipts; `eval_buildings.transfer_reserve` guards the committed one-shot protocol. CPU-only `diagnose_building_parity.IntermediateExport` exposes named tensors and measures the existing production adapter. No competing service.
COMMITS `2fc3896d` training; `bcac6551` preregistration; `0a2dd275` diagnosis/fallback; `a4c9aadf` transfer guard; `78719aa1` quality fixes; `061621cc` runbook; `15efe0c2` frozen selection; this commit records final evidence.
CHECKS Nine tests, Ruff, seven-file Black, new-helper style, dependencies and diff: exit 0. Strict opset16 parity: exit 1. Full legacy Black: exit 1; untouched formatting retained, not claimed passed.
NEXT   GPU released; no pending process or call. Lead/runtime owner reviews the failed gates and fallback prerequisites. Never repeat Karnataka HOLDOUT or Coxs Bazar transfer; no unchanged training relaunch after spent patience.

## Final state

- Detached continuation (former PID 38292) completed epochs 5–7 normally in about
  47 minutes. Recall at .5: .662435 → .614777 → .623974; bad epochs 1 → 2 → 3.
  Peak reserved memory 6,404,702,208 bytes, below 6 GiB. Checkpoints, optimizer,
  scheduler, RNG and journals remain at
  `E:/BhuAayam-data/ml/runs/b4-ka-continue-20261010/`.
- All seven epochs × .3/.5/.7 were compared on DEV with no additional selection
  inference. No setting met both targets. Epoch4/.5 retained: precision .854412,
  recall .662435, F1 .746275. Selection was committed before transfer.
- The sole Coxs Bazar transfer call completed all 2,375 chips: precision .830329,
  recall .355347; TP 9,029, FP 1,845, FN 16,380. False buildings 129 on 447 empty
  chips (44 affected); failed inputs 0. Cross-geography/test-only, **not an Indian
  accuracy claim**. Source checkpoint pretraining overlap remains unknown.
- B3 epoch4 alone retains its prior Karnataka result; epochs5–7 have no Karnataka
  or transfer claim. Karnataka's original preregistration and two-attempt ledger
  are unchanged. Both Karnataka and transfer evaluation budgets are closed.
- On one fixed difficult DEV chip, pre-TopK scores agree within .001 but two
  proposal ranks swap; decoder/mask differences amplify. All weights FP32,
  eval mode, static shapes, upstream mask-feature resizing checked. One distinct
  opset16/no-optimization comparison still fails the unchanged 20-chip tolerances.
  This diagnoses that chip, not every mismatch.
- PyTorch CPU resource measurement: roughly .22 s load and .53–.63 s per 256px
  source chip, peak working set about 1.02 GB. Windows/in-process/two threads;
  not a container/large-image/live API qualification. Integration requirements:
  `PYTORCH-FALLBACK.md`; serving files unchanged.

## Review records

`result.json`, `model-card.json`, `run-result.json`, `final-invariants.json`,
`parity-diagnosis.json`, `research.json`, `resume-key-check.json`, and sibling
`b4-final-dev-selection-20261010/`, `b4-final-transfer-20261010/`,
`b4-parity-opset16-20261010/`, `b4-pytorch-resource-20261010/`.

Large artifacts and exact final-result originals are outside Git. The transfer
WebP is a compact derivative of the retained original sheet; no new inference.
Integrity checks being passed does **not** mean accuracy or serving parity passed.
No push, merge, demo inference, data relabelling or activation was performed.
