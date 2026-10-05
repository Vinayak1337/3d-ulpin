# D07-RFDETR-TRAIN-PREP

[Evidence and pinned recipe](rfdetr-train-prep-20261005.json). Uses the standard Transformers 5.17.0 `Trainer` and `RfDetrForInstanceSegmentation` supervised loss from the [primary implementation](https://raw.githubusercontent.com/huggingface/transformers/v5.17.0/src/transformers/models/rf_detr/modeling_rf_detr.py). No custom optimizer, training loop, weight mapper or loss.

## Use now

From any checkout, supply the absolute script path:

```text
python -B -I <absolute scripts/usp/learning/train_building_ramp.py> --config E:/BhuAayam-data/task-data/d07-rfdetr-train-prep-20261005/config.json --plan-only
```

This validates exact original checkpoint/config/processor hashes, the fixed 24 Barishal candidate training images and 24 Karnataka development images, COCO/RLE frames, provenance mapping, source groups and output isolation. It prints a pinned plan and pending prerequisites without importing Torch, Transformers or CUDA. The private final plan/check receipts record actual execution. The script preserves source category 1 `rooftop_building` and maps it in memory to the original model label 0 `building`; the one-class head remains unchanged. Research roof targets are not operational/cadastral footprint facts.

The matching safetensors original is retained at `E:/BhuAayam-data/task-data/d07-rfdetr-train-prep-20261005/original/model.safetensors`, 141,551,436 bytes, SHA-256 `f254c1400f780f7ea72a6bc588a2150bf8b4d8845ded7269655e26a275f41ac7`. Original config and processor bytes match the deployed ONNX lineage. The previously acquired native RF-DETR COCO base is retained as unselected history; it is different weights and is not used by this CLI.

## Before fitting

Create a new isolated task environment using the pinned top-level recipe in the evidence file; resolve compatible CUDA/platform wheels and freeze every transitive version/hash. Existing environment metadata was inspected read-only; `pycocotools` is missing. No packages were installed. The model owner must verify complete numerical loading, preprocessing parity and capacity on the RTX 3070 under effective guards. The inspected host environment/config is not a qualified Linux container image; the containment owner identified the missing compatible runtime and mounted-path adapter.

Execution adds `--execute --authorization <receipt.json> --authorization-sha256 <hash>`. The receipt must be issued for the current plan/code/config/data/model pins and root authorization. Required pinned evidence: measured residual, frozen eligible grouped supervision, same-checkpoint development baseline, Torch/ONNX preprocessing parity and environment lock. Its live preflight must bind the current process PID, exclusive GPU ownership and effective network/resource limits, with the preflight receipt hash. Missing authorization exits 2 before heavy imports. Offline flags and the Python audit hook supplement those guards; they do not establish native egress or GPU/resource containment.

After an authorized bounded fit, standard Trainer writes one final safetensors checkpoint and a compact unqualified result to a new owned output directory. Karnataka is evaluation only; no random split, final/test pool, teacher labels, head reinitialization, automatic checkpoint download or promotion. In-memory targets use standard pycocotools RLE decode and nearest mask resize; RGB uses Pillow bilinear 432 and the original processor normalization with resize disabled. Source originals/labels stay unchanged. Runtime mask execution, fitting, GPU capacity, Torch/ONNX parity and accuracy remain unrun.
