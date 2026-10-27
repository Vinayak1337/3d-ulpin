# P2 fixed installed-CubiCasa evaluation

Frozen before any P2 inference. Evaluate the installed, unchanged `floor.onnx` (SHA-256
`6ecc5c0ef58271effe877832dca38833107b35d26fcf7b1254fc60834c890520`) with the existing
`cubicasa-rooms-768-bilinear-pad64-contours-v2` profile on 100 publisher `test.txt` plans.
Selection: first 100 paths in publisher order, excluding prior feasibility plans
`high_quality_architectural/1191` and `high_quality_architectural/2536`. All selected paths
are in the architectural category; this is not a category-balanced or Indian evaluation.
They are disjoint from the retained publisher train/validation lists.

Immutable selection: `E:/BhuAayam-data/datasets/cubicasa5k/p2-test-20261011/selection.json`,
SHA-256 `83b48fd309647f60024f9c98e6fcbd161cfc1c47c39a5fc798fdb85148954eeb`.
Publisher test list and per-member original image/SVG hashes, CRCs, URLs and acquisition times
are retained there. No training, tuning, threshold search, model promotion or Indian accuracy claim.

Report pooled per-class intersection/union and IoU for all twelve room-mask classes. Absent
unions produce null, not zero. Compare full-source-resolution SVG class targets to installed-model
argmax masks resized back with nearest-neighbour sampling. Preserve the existing bilinear image
preprocessing. Use the pinned publisher label mapping, integer-rounded polygons, source element
order and small-wall exclusion. Count publisher interior `Space` annotations versus returned v2
interior-room polygons (exclude background/outdoor/wall/railing); report signed error and MAE.
Omitted contours remain explicit; connected same-class areas can merge. This count diagnostic
is not instance matching or legal-unit accuracy.

Foreign research `test_only`, mostly Finnish marketing floorplans. Attribution: Kalervo,
Ylioinas, Häikiö, Karhu and Kannala / Aalto University / CubiCasa (2019), Zenodo 2613548.
The dataset metadata specifies **CC-BY-NC-SA-4.0**; repository code/model documentation specifies
**CC-BY-NC-4.0**. Retain both, rather than relabelling the dataset. Source-family/site and
checkpoint-population overlap remain unaudited; this is a fixed diagnostic test slice, not a
new independent final holdout.

Acquisition checkpoint: an initial four-thread range download retained 35 complete pairs before
one short response failed closed. One bounded header/body inspection succeeded. Resume reduces
parallelism to two, requests smaller member ranges and reads bounded chunks. Existing originals
are CRC-checked and never overwritten; interrupted-file acquisition times remain unknown.
Stop if a further persistent network failure prevents completion; do not replace selected plans.
