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

## B2/B3 checkpoint (G1 owns GPU)

HOLDOUT attempt 1 is committed in `building/b2-installed-holdout-20261010`; **do not
run attempt 2** without the lead fixing the candidate. No holdout chip inspection
or tuning was performed. All B3 selection/export inputs are TRAIN or DEV only.

Run 1: PID **35896**, detached Windows process; directory
`E:/BhuAayam-data/ml/runs/b3-ka-run1-20261010/`. Tail from PowerShell:

```powershell
Get-Content 'E:/BhuAayam-data/ml/runs/b3-ka-run1-20261010/training.log' -Tail 30 -Wait
```

Training uses standard Transformers Trainer with the installed Apache-2.0
satellite safetensors, not the sealed harness. Native RF-DETR 1.11.2's criterion
already handles empty masks, but the publisher-compatible Transformers 5.17
criterion still needs `rfdetr_loss.py` (regression `test_rfdetr_empty_mask_loss.py`).
A direct native-weight compatibility test failed strict parity, including one
bounded background-slot comparison, so it is **not** a qualified native adapter.
The deviation from native rfdetr.train is explicit in the model card.

Karnataka TRAIN has 3,581 chips, including 880 empties; all publisher features
remain present. Training inputs are 256-pixel source chips (each is one production
tile), Pillow bilinear to 432, ImageNet normalisation, flips only. Batch 1,
accumulation 4, head LR 1e-4/backbone LR 1e-5, fixed seed 26011, **BF16 AMP**.
FP16 had finite scalar losses but overflowed unscaled gradients before update 1;
the single BF16 comparison passed 50 updates with falling loss under 6 GiB.
`requirements-vision-training.lock` adds train extras/ONNX without changing B1's
core pins. Model loading stays offline, safetensors only. Local trusted Trainer
optimizer/scheduler/RNG state is outside Git; never load a remote pickle.

Each epoch writes new `epoch-NNN/` safetensors + resumable Trainer state, briefly
offloads the parent model/optimizer to CPU, and runs `eval_buildings.py --split dev`
on CUDA. Only one process uses CUDA at a time. Selection/early stopping uses
production polygon F1 at .5 (patience 3, min_delta .001); stop after the first fully
scored epoch boundary beyond 85 minutes, or 12 epochs. `dev-selection.jsonl`
contains every epoch result. No partial accumulation-window resume is claimed.

After a completed epoch, compare three DEV thresholds (CPU while Run 1 owns GPU):

```bash
$PY -B scripts/ml/select_buildings.py --run-id b3-ka-run1-20261010 --selection-id NEW_ID
$PY -B scripts/ml/export_buildings.py --checkpoint E:/BhuAayam-data/ml/runs/b3-ka-run1-20261010/epoch-NNN --run-id NEW_EXPORT_ID
```

Threshold selection is provisional while training continues; require both gate
thresholds if any qualify, otherwise choose highest polygon F1. Non-.5 thresholds
are DEV-only and require the lead binding an updated final profile, never an
implicit holdout override. The serving registry/profile is untouched (B4).

Exporter is CPU-only, fixed 1x3x432x432; production outputs are logits/masks and a
retained debug graph exposes boxes for 20-DEV-chip parity. A static-grid PE wrapper
fixes unsupported traced antialiased bicubic without altering eager inference.
**Smoke-checkpoint export exists but strict raw-output parity failed**, and one
ORT-disable-optimisations comparison also failed; do not repeat smoke-export
attempts or relax tolerances. Export the selected candidate once; if it fails,
report max differences and resolve encoder-TopK/instance-order sensitivity with
the lead before serving. Smoke weights/export are not the chosen candidate.

Resume only after confirming PID is dead, using a NEW run-id and the latest fully
scored checkpoint; retain all old output bytes:

```bash
$PY -B scripts/ml/launch_building_train.py --run-id NEW_SEGMENT_ID --resume E:/BhuAayam-data/ml/runs/b3-ka-run1-20261010/epoch-NNN --smoke-result E:/BhuAayam-data/ml/runs/b3-ka-smoke-bf16-20261010/result.json
```

Do not start Run 2 or another GPU task concurrently. Bangladesh downloader is
separate CPU/network work; let it finish. Run 2 mixing regions is not started here.
