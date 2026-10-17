TASK   B1 — RAMP vision sets, CUDA and preregistration            GATE GF-AI/building_mask
WORKS  Frozen Karnataka COCO/split, CUDA smoke and full DEV diagnostic; Bangladesh continues detached.
SEE IT python -m json.tool docs/evidence/gf-ai/building/b1/result.json
INPUTS Karnataka positive 0020b409-a333-4eb4-89c8-531b8110312a; difficult publisher-empty 0872f605-d786-46ec-b8f1-ca8fed38e730 (one false candidate).
GAPS   DEV targets unmet; pretrained overlap unknown; remaining Bangladesh COCO shards and native trainer qualification pending.

## Checkpoint / continuation

- All Karnataka originals and per-file pins are under `E:/BhuAayam-data/datasets/ramp`; stable manifest, split and COCO receipt hashes are in `result.json`. No HOLDOUT inference ran; no holdout log exists. Preregistration/split were committed at `7d33e221` before the single DEV run.
- Bangladesh downloader **PID 21896**, log **`E:/BhuAayam-data/datasets/ramp/download.log`**, confirmed alive. Windows detached-process launch retains execution after this session ends. At the recorded checkpoint Dhaka and Sylhet are complete, Chittagong is downloading, and Barishal/Jashore/Coxs Bazar follow automatically. Dhaka TRAIN-only COCO is complete. Do not launch a second downloader while this PID is alive.
- Only GPU work was the real Barishal TRAIN smoke and the single Karnataka DEV evaluation. No optimizer step or training. Smoke used Transformers RF-DETR with installed safetensors; pinned `rfdetr` imports, but its optional native training extras/checkpoint conversion remain B3 work.
- Source hashes/pixels/RLE were checked on real positive and difficult empty inputs. Publisher labels contain fewer features than the README/PDF claim; actual originals govern denominators. Zero-pixel features are retained, not padded/relabelled. Previously observed cells force DEV above the nominal target fraction; no holdout/seed search occurred.
- Diagnosed failures and bounded corrections: Azure legacy Range ignored → explicit `x-ms-range`/API version (resume receipt); Dhaka projected GeoTIFF → declared-CRS reprojection (Dhaka receipt); command time box during export → preserve PNGs and resume source-bound per-image journals. The contact sheet's undefined-empty-F1 ranking bug was fixed from saved DEV outputs with zero new model calls, preserving the original evaluation/artifacts.

## Checks

`$PY` = `E:/BhuAayam-data/ml/venv-vision/Scripts/python.exe`. Exact commands and exit codes, including diagnosed failed attempts, are in `result.json`. Successful: smoke, frozen/export-resume, source/split verification, three guard/ranking regressions, full DEV CUDA evaluation, saved-output contact-sheet correction, ranged resume, Dhaka projected export, `uv pip check`, `git diff --check`. No application/API route changed, so no route contract check applies.

## NEXT

1. Let detached acquisition finish; export Sylhet/Chittagong/Barishal/Jashore/Coxs Bazar via `$PY -B scripts/ml/prepare_ramp.py --bangladesh-region <region>_bangladesh`. Keep all Bangladesh shards TRAIN-only and geographically separate. Reconcile final manifest counts/hash when complete; no old task-data mutation.
2. Lead review, then B2's single logged installed-baseline HOLDOUT slot. Do not tune thresholds on HOLDOUT. B3 must qualify native RF-DETR trainer extras/checkpoint conversion, declare zero-pixel feature disposition, and retain or diagnose the old empty-mask loss repair only if that implementation still needs it.
3. Data-worker proposed source line (not applied to their files): **10 October 2026 — Acquired RAMP Karnataka v1.0 (DOI 10.34911/rdnt.5y2w17), 6,288 original GeoTIFF/GeoJSON pairs, 1,294,633,753 bytes including README/PDF, CC BY-NC 4.0; DevGlobal/TaQadam/B.O.T/Maxar/Radiant Earth attribution, test_only. Stable SHA manifest `E:/BhuAayam-data/datasets/ramp/manifest-karnataka.json`; spatial split/COCO/preregistration and measured DEV receipt `docs/evidence/gf-ai/building/b1/result.json`. Six Bangladesh regions acquiring via detached resumable PID 21896, TRAIN only. Operational launch clearance and checkpoint/RAMP overlap remain unqualified.**
