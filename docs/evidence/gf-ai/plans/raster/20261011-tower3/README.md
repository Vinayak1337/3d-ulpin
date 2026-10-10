# P2 — Tower 3 scanned rooms and installed CubiCasa evaluation

Task label `20261011`; exact acquisition and OCR UTC timestamps are in the original receipts.
CPU only, offline OCR/model execution; no API, DB, GPU, provider, training or runtime-configuration changes.
This supplies the GF-AI / GF-T16 **candidate prerequisite**, not a whole-gate pass or Indian accuracy claim.

## See it

Read-only artifact, citation, geometry-preservation and pooled-score verification:

```bash
E:/BhuAayam-data/task-data/d07-vision-baseline-20261005/env/Scripts/python.exe \
  scripts/plans/verify_raster_evidence.py --evidence docs/evidence/gf-ai/plans/raster/20261011-tower3
```

Open `tower3-current/t3-1-second-floor-overlay.png` or
`tower3-current/t3-2-typical-floor-02-overlay.png`. Red contours are model proposals;
blue numbers are local JSON indices, not registry identities. Stamps, text, furniture and
floor circulation produce false/split/merged candidates. The exact class mask is pinned privately.

## Tower 3 selection and results

The retained **plan 1 and plan 2** PDFs each have one scanned architectural sheet, with two main
floor panels. Neither is the separate site-plan PDF. Selection boxes and reasons are recorded in
`tower3-current/selection.json` and `scripts/plans/tower3-raster-selection.json`.
Area-only diagrams, schedules and the vertical section were excluded. Captions are source context,
not reviewed floor identities; all room levels stay `{value:null,state:"unknown"}`.

| Panel | Rooms | OCR observations, both methods | Disagreements | Scale |
| --- | ---: | ---: | ---: | --- |
| Plan 1, second-floor graphic | 56 | 342 | 2 | `no_scale` |
| Plan 1, refuge-floor graphic | 54 | 271 | 0 | `no_scale` |
| Plan 2, typical-floor 01 graphic | 55 | 246 | 1 | `no_scale` |
| Plan 2, typical-floor 02 graphic | 53 | 265 | 1 | `no_scale` |
| **Total** | **218** | **1,124** | **4** | metric geometry null |

Every room payload has a full-page raster pixel polygon, class, **uncalibrated** mean-pixel-softmax
confidence, contained literal OCR observations, method, page/point-bbox citation and unknown level.
`candidates` contains the strict `normalized-building/1` candidate-reference element shape; `rooms`
holds the referenced payload. IDs and JSON pointers are task-local, never building/level/space IDs.
Geometry coordinates and bbox derivatives are rounded to 0.01 pixel/point only for committed JSON;
full-precision polygons and observations are immutable and SHA-pinned under
`E:/BhuAayam-data/task-data/p2/20261011/tower3-publication01/`.

OCR was first run with the existing bounded render/TSV helpers, then through the **documented
supervised region runner** with its retained interpreter. All 28 tiles are at most 400 PDF points
per side. The runner uses Docling/Heron and Tesseract on CPU; all workers exited 0 with no stop reason.
It emitted 486 observations and marked **20/28 tiles partial**. Sparse TSV emitted 638 observations,
with confidence-filter omissions. Both methods' literal text and page-space boxes remain separate;
there is no precedence, transcript repair, completeness or unique-text-count claim. 235 observation
attachments are recorded; the rest remain explicitly unattached. Multi-box Docling observations
retain every original box, and attachment requires the enclosing box wholly inside a room.

The four retained disagreements come from TSV: `FAMILY LOUNGE` / model `hallway`, `KITCHEN |` /
model `hallway`, and two `BED ROOM`/`BEDROOM` observations / model `other_room`. Docling's absence
of a conflicting contained label is **not agreement**. Neither source overrides the other.

### Scale abstention and omissions

The existing `vector_plan.py` parser is reused without a default unit. 79 dimension-like OCR groups
were observed; **none** is an unambiguous explicit-unit pair. A few isolated explicit-unit literals
are railing-note fragments such as `1800MM`, not demonstrated dimension-line spans. OCR `1100M`
is retained literally, not silently repaired to `1100MM` or used for calibration.

The `DimensionLine` pairing path requires independently verified endpoints, unique text/line
association, support on both axes and agreement within 2%. No raster endpoint reader is qualified
on these scans; the real inputs supply no verified endpoints. All panels therefore abstain with
`no_verified_dimension_line_endpoints`, `no_scale`, null metric geometry and unknown level.
Printed scale, unitless numbers, room polygons and inferred dimensions are never substituted.

The unchanged installed v2 profile omits small/complex/capacity-limited predicted components.
Panel omission counts are preserved (2,560 small, 8 complex and 507 capacity groups in total);
these are **not missing-room truth counts**. The full class masks remain available. No contour,
label or threshold was tuned to reduce these findings.

## Installed CubiCasa: fixed 100-plan diagnostic

The selection was committed in `19b1c411` **before inference**; see `PREREGISTRATION.md`.
Only 12 validation pairs were previously retained. P2 downloaded the missing publisher test
members through bounded ZIP ranges, retaining 100 unchanged image/SVG pairs, 42,938,141 bytes.
`cubicasa-acquisition.json` records the official test list, member CRCs/SHA-256, URLs and dates.
The 5.47 GB full archive was not downloaded or whole-archive verified. Interrupted-file timestamps
remain unknown rather than invented. All selected plans are in the architectural category.

Weights: unchanged installed `floor.onnx`, SHA-256
`6ecc5c0ef58271effe877832dca38833107b35d26fcf7b1254fc60834c890520`.
Profile: `cubicasa-rooms-768-bilinear-pad64-contours-v2`; upstream code
`c34440266665a11f4484eb06cd2e4b7d72ad76c1`. 100 actual CPU inference calls completed in 106.589 s.
The retained D06 publisher SVG transfer and class mapping were reused, including integer rounding,
source element order and small-wall exclusion; exact target parity was checked on an existing
retained development target. SVG root dimensions are not an invented scaling transform: the
publisher loader clips source polygons to the image frame. Predicted masks are restored to the
source pixel frame with nearest-neighbour sampling for pooled IoU.

| Class | Pooled IoU |
| --- | ---: |
| background | 0.8919 |
| outdoor | 0.5415 |
| wall | 0.6899 |
| kitchen | 0.6065 |
| living_room | 0.6420 |
| bedroom | 0.6398 |
| bath | 0.5649 |
| hallway | 0.4384 |
| railing | 0.2110 |
| storage | 0.3394 |
| garage | 0.3700 |
| other_room | 0.3481 |

**Mean class IoU 0.523608; pixel accuracy 0.810994.** Interior room-count diagnostic:
publisher 1,164 versus returned v2 contours 4,174; mean signed error **+30.10**, MAE **30.10**,
exact counts on **2/100** plans. This large over-count is retained, not hidden or tuned away.
`high_quality_architectural/2035` has 6 source spaces / 6 returned contours;
`high_quality_architectural/1845` has 4 / 82. Count error compares source interior `Space`
annotations to returned interior contours, not matched instances or legal units. Full masks,
per-plan confusion matrices, targets and contour omissions remain private and hash-pinned.

Foreign research `test_only`, mostly Finnish marketing plans. Attribution: Kalervo, Ylioinas,
Häikiö, Karhu and Kannala / Aalto University / CubiCasa (2019), Zenodo 2613548.
Dataset **CC-BY-NC-SA-4.0** and repository code/model **CC-BY-NC-4.0** are distinct. No fine-tuning,
threshold search, Indian applicability or model promotion. Site/template/checkpoint-population
overlap is unaudited; the fixed publisher test slice is not a new independent final holdout.

## Design and execution lineage

- `raster_plan.py`: frozen `PlanSelection`, `OcrAssets`, `DimensionLine`, `Segmentation`; shared parser,
  conservative scale pairing, existing v2 segmentation, literal attachment and disagreement accounting.
- `read_raster_plan.py` + `raster_ocr.py`: fresh bounded outputs and the unchanged supervised region runner.
  `raster_replay.py` verifies completed source/model/profile/mask pins before continuation; it does not infer.
- `publish_raster_continuation.py`: joins recorded OCR observations, proving every full-precision room
  polygon is unchanged. `actualInference:false` and `actualOcr:false` describe publication, not the
  earlier actual executions. The original inference and runner receipts remain separately pinned.
- Acquisition, label-transfer and evaluation scripts are typed small functions. The verifier recomputes
  all 100 pooled confusion matrices/IoUs and room-count MAE without reopening inference or tuning.

`evaluation-code-continuity.json` and `inference-code-continuity.json` retain exact executed source
bytes reconstructed by reversing documented post-run changes; hashes match the executed receipts.
Core inference/preprocessing/contour and evaluation/label-transfer AST units are unchanged.
`publication-parity.json` proves all four post-review full-precision candidate documents are
byte-identical, with no excluded fields or rounded comparison. It also pins the historical
selection: only OCR-profile metadata was clarified; page/panel/exclusion scope is unchanged.
Historical receipts are not relabelled as current-code runs. Duplicate old compact publications
were preserved byte-for-byte privately; `historical-artifacts.json` maps them to their original pins.
Only current room JSON/overlays and the original small execution receipts remain in Git.

## Recovery and checks

The original root `result.json` and latest `post-review/result.json` contain exact check commands
and exit codes; no runtime gate is claimed from this README alone. Failure signatures and decisions:

1. Initial range download: one short HTTP body after 35 complete pairs. A bounded header/body probe
   succeeded; smaller member ranges, bounded chunk reads and two download threads completed the
   same frozen selection. Existing bytes were CRC-checked and never overwritten.
2. Retained old Tesseract returned Windows `3221225781` (`0xC0000135`). Dependency inspection found
   missing `libcurl.dll`; K2b's repaired runtime has the **same pinned executable**. P2 used that path
   read-only and pinned its DLLs; no shared runner or OCR configuration patch.
3. Initial SVG/image root-size equality preflight was too strict. The existing publisher transfer
   clips polygons, not rescales SVG metadata. Exact retained-target parity passed with that rule.
4. Missing pypdfium2 in the retained inference environment: added the existing production pin 4.30.0
   only to the new task-owned tools directory. Production environments/weights remained unchanged.
5. Checkout has no Node dependencies: contract checks used already-installed `tsx` and exact Zod 4.6.2
   read-only, with a private dependency resolver. Windows ESM paths require `file:///` URLs.
6. Inline diagnostics encountered Windows quoting, import and text-decoding errors; corrected
   harnesses ran once. These were not model/OCR failures and changed no extraction output.
7. Self-review found the publication command needed an exact-pin resolver for archived overlays.
   The fix was checked with one private-only publication, not new OCR/inference; all four candidate
   documents stayed byte-identical. Selection snapshots now distinguish historical scope from
   later OCR-profile metadata clarification.

Tower originals remain unchanged, Indian permission **unconfirmed**, approved revision unresolved.
The root source-provenance receipt links the original issuer/acquisition/licence/CRS metadata.
Review, canonical level choice and API ingestion belong to the lead/runtime owner next.
