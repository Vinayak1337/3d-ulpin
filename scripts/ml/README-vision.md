# B1 plain vision tools (Windows, no Docker)

## Environment

CPython 3.11.15 at `E:/BhuAayam-data/ml/venv-vision`; CUDA 12.8 PyTorch 2.8.0,
RF-DETR 1.11.2, Transformers 5.17.0, ONNX Runtime GPU 1.23.2. Exact resolved
versions, including the unchanged `services/geo/requirements.txt` dependencies,
are in `requirements-vision.lock`. Create a **new** venv only:

```bash
uv venv --python 3.11 E:/BhuAayam-data/ml/venv-vision
uv pip install --python E:/BhuAayam-data/ml/venv-vision/Scripts/python.exe --index-strategy unsafe-best-match -r scripts/ml/requirements-vision.lock
uv pip check --python E:/BhuAayam-data/ml/venv-vision/Scripts/python.exe
```

`smoke_vision.py` uses retained **Barishal TRAIN** imagery and the installed
checkpoint's local safetensors through Transformers RF-DETR. It runs one
supervised forward/backward, no optimizer, no holdout, with FP16 autocast and a
6 GiB cap. `rfdetr` imports successfully; native `rfdetr[train]` optional extras
and native-checkpoint conversion are B3 prerequisites, not qualified here.
Existing originals, historical environments and weights are read-only. Runtime
model loading is offline (`HF_HUB_OFFLINE=1`) and accepts no pickle checkpoints.

## Acquisition / export

`ramp_download.py` acquires Karnataka first, then all six Bangladesh collections.
It stores originals, paged publisher XML inventories, a per-file SHA journal,
and an atomic live manifest in `E:/BhuAayam-data/datasets/ramp`. Completed files
are hash-checked on resume; transfer `.part` state uses tested Azure `x-ms-range`
with service version `2023-11-03` (legacy anonymous requests ignored standard
Range without a version). No original
is overwritten. One process owns the root; do not start another while its PID
is alive. After an interrupted process, confirm its PID is dead before clearing
only the generated `download.lock` (never any original or journal).

```bash
# Resume explicitly after stopping/confirming the old process is dead:
E:/BhuAayam-data/ml/venv-vision/Scripts/python.exe -u scripts/ml/ramp_download.py
# Freeze once, then export Karnataka (reuses checked complete exports without
# overwriting them; interrupted exports resume source-bound progress journals):
E:/BhuAayam-data/ml/venv-vision/Scripts/python.exe -B scripts/ml/prepare_ramp.py
# Dhaka is already exported; after each other region is COMPLETE, export a TRAIN-only shard:
E:/BhuAayam-data/ml/venv-vision/Scripts/python.exe -B scripts/ml/prepare_ramp.py --bangladesh-region dhaka_bangladesh
```

Karnataka exports are `coco/{train,dev,holdout}/_annotations.coco.json`; each source
feature is an uncompressed COCO RLE, including multipart/hole geometry. Empty
chips are retained. Six source features rasterize to zero pixels: they are
preserved explicitly, not repaired/dropped. Training must declare their
handling. The frozen split uses 1,000 m EPSG:6933 cells, seed 26011, no seed search.
Previously evaluated cells stay DEV-only; therefore DEV is 22.81%, not the nominal
15%. HOLDOUT is 20.25%; TRAIN is 56.95%. There is no buffer between adjacent cells.
The downloaded labels contain 50,666 features vs the publisher documents' 51,335;
evaluation uses the originals, never synthetic padding or corrected labels.

## Evaluation

```bash
E:/BhuAayam-data/ml/venv-vision/Scripts/python.exe -B scripts/ml/eval_buildings.py --model onnx --split dev --provider cuda --run-id NEW_ID
E:/BhuAayam-data/ml/venv-vision/Scripts/python.exe -B scripts/ml/test_eval_buildings.py
```

CPU is the default and matches production's provider; CUDA must be explicitly
requested and cannot silently fall back. Both reuse production tile layout,
preprocessing, mask painting and candidate polygonisation. Candidate masks are
scored one-to-one against original publisher instances; full-chip union boundary
F1 includes empty-chip errors. Zero denominators remain null. Results include
hashes, denominators, per-chip journal and a best/worst PNG.

HOLDOUT requires committed, unchanged preregistration **and** split; slot 1 is
installed baseline, slot 2 final candidate. Every reservation is logged before
model load; failures/interruption consume a slot. B1 does **not** run HOLDOUT.
The preregistration's repository-file hash normalizes CRLF to LF, so integration
on Windows cannot accidentally break its Git identity. Original-file hashes
always use exact bytes. The B1 DEV sheet's initial ranking erroneously treated
undefined F1 on correctly empty chips as worst; the result now points to a
corrected source/truth/count sheet generated from saved DEV outputs, with zero
new model calls. Both artifacts and the regression receipt are retained. `plan_rooms` and `storeys` remain pending for their owners.

## B2/B3 final checkpoint (GPU released)

Run 1 (former PID 35896) stopped normally after four epochs at a fully scored
93-minute timebox boundary. No crash or OOM. Checkpoints and resumable Trainer
state remain at `E:/BhuAayam-data/ml/runs/b3-ka-run1-20261010/epoch-{001..004}/`.
The Bangladesh downloader also finished without failures. Run 2 was not started.

`b3/result.json` is the compact summary. `b3-final-dev-selection-20261010` compares
all four epochs at the same recorded thresholds (.3/.5/.7), preferring both gate
thresholds, otherwise production polygon F1. It selected epoch 4 at .5: DEV
precision .854, recall .662, 20 false buildings on 305 empty chips. Selection was
committed before the final HOLDOUT call. HOLDOUT precision .836, recall .649,
15 false buildings on 355 empty chips. **Both HOLDOUT slots are consumed; never
run another call.** No chip inspection or held-out tuning was performed.

Training uses standard Transformers Trainer and installed Apache-2.0 satellite
safetensors. The native rfdetr conversion did not qualify. Its pinned 1.11.2 mask
criterion is fixed, but publisher-compatible Transformers 5.17 still needs the
instance-local `rfdetr_loss.py` repair. Empty and zero-pixel labels are retained.
Karnataka TRAIN: 3,581 chips, 880 empties; RGB/Pillow bilinear 432, ImageNet, flips;
batch 1, accumulation 4, head/backbone LR 1e-4/1e-5, seed 26011, BF16 AMP. The
50-update smoke loss fell 27.92 -> 11.54 after one FP16 -> BF16 comparison.

`export_buildings.py` exports static 1x3x432x432 on CPU and compares all raw
logits/masks/boxes on 20 DEV chips. The graph checker passes, but **selected-model
strict parity failed** (mask max difference 70.30, box .221). The graph and weights
remain outside Git and are unqualified. No unchanged retries or tolerance changes.
The candidate model card and `registration-request.json` explicitly block serving;
`services/geo/ml-models.json` remains untouched and B4-owned.

`building_io.py` shares offline configuration, file hashes and append-only JSON;
training, selection and export helpers are typed and small. The code-quality
refactor matches the previous eight TRAIN tensors exactly; real empty and dense
chips still produce finite loss/gradients with no optimizer updates.

A four-extra-epoch schedule is proposed in `b3/result.json`, not started. The lead
must authorize any continuation. The GPU is free, and the exhausted HOLDOUT stays
closed even if a future candidate improves DEV. Per-chip journals and original
executed result bytes live under `E:/BhuAayam-data/ml/runs/`; evidence links and
hashes preserve their lineage. Git contains compact JSON and <=200 KB WebP sheets.
