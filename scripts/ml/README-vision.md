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
are hash-checked on resume; transfer `.part` state uses HTTP Range. No original
is overwritten. One process owns the root; do not start another while its PID
is alive. After an interrupted process, confirm its PID is dead before clearing
only the generated `download.lock` (never any original or journal).

```bash
# Resume explicitly after stopping/confirming the old process is dead:
E:/BhuAayam-data/ml/venv-vision/Scripts/python.exe -u scripts/ml/ramp_download.py
# Freeze once, then export Karnataka (refuses to overwrite frozen COCO):
E:/BhuAayam-data/ml/venv-vision/Scripts/python.exe -B scripts/ml/prepare_ramp.py
# After a Bangladesh region is COMPLETE, export a TRAIN-only shard:
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
always use exact bytes. `plan_rooms` and `storeys` remain pending for their owners.
