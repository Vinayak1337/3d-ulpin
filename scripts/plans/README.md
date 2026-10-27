# P1 — offline vector-plan room candidates (wall-mask continuation)

CPU only; no API, Docker, GPU, model or provider:

```bash
E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe -m pip install -r scripts/plans/requirements.lock
E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe scripts/plans/read_vector_plan.py E:/BhuAayam-data/task-data/association-sources-20260929/bihar-magnolia-sanctioned-layout-original.pdf --pages 2 --panel-title 'GROUND FLOOR PLAN' --panel-title 'FIRST FLOOR PLAN' --panel-title 'SECOND FLOOR PLAN' --provenance scripts/plans/source-provenance.json --out docs/evidence/gf-ai/plans/vector/my-new-run/bihar
E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe scripts/plans/read_vector_plan.py E:/BhuAayam-data/task-data/association-sources-20260929/haryana-2831-tower3-plan1.pdf --pages 1 --provenance scripts/plans/source-provenance.json --out docs/evidence/gf-ai/plans/vector/my-new-run/tower3
E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe scripts/plans/verify_vector_evidence.py docs/evidence/gf-ai/plans/vector/my-new-run/bihar docs/evidence/gf-ai/plans/vector/my-new-run/tower3
PYTHONPATH=services/geo E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe -m unittest geo.test_vector_plan
```

`--out` and `--full-out` must be new/empty. The latter defaults to
`E:/BhuAayam-data/task-data/p1-vector-plan/<run-id>/<input>/`. Full-precision
JSON stays outside Git, SHA-256/byte-pinned by each compact evidence file.
Committed coordinates are rounded to **0.01 PDF point / 1 mm**, no indentation.
All comparisons and counts run on full precision **before** rounding. Use
`--full-out` to choose another new private directory, never an existing original.

Pages are actual 1-based PDF pages. Panel selection uses **exact title literals**,
not reviewed integer levels. No bbox is hard-coded for the Bihar panels.
Optional `--region PAGE:X0,Y0,X1,Y1` restricts a title-derived scope; crop edges
never become room boundaries. `--max-opening-m` records a different explicit
closure bound (default 1.85 m); it is not a tuning loop.

## Named CAD layer profile (structure review)

`LayerProfile` is a frozen dataclass in `services/geo/geo/vector_plan.py`. Its
wall-hatch, floor-slab, built-outline and column/window-quad selectors are
compiled full-match regexes or immutable name sets. `MAGNOLIA_CAD_LAYERS`
(`magnolia-cad/1`) declares the supplied drawing's layer convention in one place.
`read_page(..., layer_profile=...)` accepts an explicit source-family profile.
The CLI uses this default and records `layerProfileName` in `result.json`.

A vector page with **no matching wall layer** returns
`no_matching_layer_profile`, zero rooms and unknown scale. There is **no
layerless/thick-line guessing fallback**. A matched profile without reliable
scale or hatch support still abstains with its existing reason. Regexes and
name sets are dispatch rules, not inferred semantics or source facts.

The pipeline now uses typed `WallEvidence`, `AxisSegment`, `WallStrip`,
`OpeningBridge` and `OutlineResult` values between collection, pairing,
closure, mask, outline and face extraction. Source-literal dictionaries remain
at the existing JSON boundary; no alternate registry schema was introduced.
Legacy parameter-receipt fields are retained solely to reproduce the accepted
parameter hashes; the unused edge-polygonization implementation was removed.

The structure-review proof is in
`docs/evidence/gf-ai/plans/vector/20261010-p1-structure/post-merge/result.json`.
It compares
SHA-pinned **full precision**, canonicalising object-key order and excluding
only `/codeSha256` and `/pages/*/runtimeSeconds` from candidates; consistency
has **no excluded fields**. Neither compared document contains timestamps.
Fresh result receipts, with timing/code/profile metadata, are pinned separately.

## Detection, geometry and attachment

- Detect `GROUND/FIRST/SECOND/TERRACE/... FLOOR PLAN` and the nearby scale line
  below it. Title-row spacing and the preceding scale-caption row delimit the
  inspection bands. Source architectural wall geometry defines/refines each
  building outline. `panelId` is a deterministic **source locator**, not an
  allocated registry identity; `floorLabel` stays the literal title.
- Scale: nearby dimension-layer lines and perpendicular tick/extension
  intersections, not room dimensions or area targets. Each panel gets its own
  least-squares consensus: >=4 supports, >=2 per axis, >=80% within 2%. All
  supports/residuals are retained. The panel's printed scale is independently
  parsed using 72 pt/in and checked within 2%; disagreement abstains.
- Wall mask: fill **paired architectural wall lines supported by source wall
  hatching**, plus thick column/window quads. Hatches vote for wall occupancy;
  the individual diagonal strokes do not split rooms. Named source slab/railing
  paired edges and contours bound balcony/terrace spaces. Furniture, stair
  treads, dimensions, door leaves and curves are excluded.
- Extend paired wall ends along their source axis to an existing aligned wall
  or junction, up to **1.85 m** (covers the source's broad open circulation
  connections). Every bridge exports its polygon, width, source drawing seqnos
  and `state:candidate`. Never resize a room to its literal dimensions.
  Wall thickness is 0.07–0.35 m; snap grid 0.12 pt; seam buffer 0.12 pt.
- Rooms = source-derived building outline **minus the wall mask**. Drop faces
  below **1 m2**, with counts. A closed source exterior trace is preferred;
  otherwise use the wall-barrier shell and exclude unlabelled setback faces
  mostly outside the hatch-supported building band (declared fraction 0.5).
  Named balcony/terrace faces stay eligible. Remaining unlabelled interiors
  stay unlabelled candidates; no type is guessed.
- Group name line + dimension line directly below (within two font heights and
  two font widths of the same left alignment). Anchor = centre of the **name
  bbox**, not furniture or a nearest room. Attach to exactly one polygon by
  point-in-polygon. Two names produce `issue:merged_region`, both literals,
  `label:unknown`, `state:candidate`. Names without a region have an explicit
  reason in `labelAudit` and in the consistency report.
- Frame: source MuPDF points (x right, y down); metric polygon is translated
  about the panel **building-outline bbox lower-left** then scaled with y up.
  Origin and extraction method are recorded. This is candidate drawing-local
  geometry, **not georeferenced or surveyed**; no scene placement is authorised.

`candidates.json` is `vector-plan-candidates/2`. Every proposal retains the
DomainCandidate fields from standards §5, `taskVersion:2`, the required
`method:deterministic:vector-plan@1`, explicit wall-mask profile `/2`, source
hash, parameter hash and code hash. `outputRef` is a local JSON pointer.
Candidates additionally carry `panelId`, `floorLabel`, label groups, polygons,
computed area, dimension literals, consistency and citations. No registry
write or officer acceptance occurs. The backend can ingest proposals later,
with level choice/review separate from title association.

## Interpretation / measured scope

The supplied Bihar original has one vector architecture sheet on **page 2**,
containing the ground/first/second panels. The lead accepted these three panels
instead of three PDF pages in the continuation. Page 1 is a site layout;
pages 3–6 and Tower 3 are scanned. No raster reading was added.

Stated-vs-drawn `ok/mismatch` compares **polygon area** against the product of
**two stated lengths**, at the unchanged **5%** tolerance; bbox length errors
are separate diagnostics. A length product is not a literal stated area.
The first-floor master bedroom has a real area discrepancy and is kept red.
Stairs/dressers/terrace have no stated dimension pair: consistency is correctly
`unknown`, not a failure invented into an `ok`.

`5'11'` in the balcony's source label is malformed. It remains null; no apostrophe
is silently changed to an inch mark. Reports distinguish attached numerical
comparisons, **all parseable stated-dimension groups including unattached
ones**, and **all dimension literals including malformed ones**. This prevents
inflating the target by dropping difficult labels.

The catalogue remains `test_only`, permission **unconfirmed**. Bihar's literal
`NOT SCALE THE DRAWING` restriction is retained: written dimensions take
precedence. These outputs are local development evidence, not authorised
measurement, ownership, legal unit/level association, public redistribution,
or independently reviewed room-count accuracy. Geometry extraction remains
qualified only on this source family; unsupported wall-layer conventions or
unreliable scale yield honest gaps, not inferred rooms.

## P2 — offline raster plans and installed CubiCasa

`services/geo/geo/raster_plan.py` reuses the P1 literal dimension parser and the
unchanged `spatial_ml.py` v2 contour path. `read_raster_plan.py` calls the existing
supervised region OCR runner with the retained OCR interpreter. It never changes
OCR configuration, uses CPU only and does not touch the runtime/DB.

The explicit four-panel selection is `tower3-raster-selection.json`; it cites two
retained Haryana floor-plan sheets, not the site plan, area diagrams or section.
Rooms retain full-page raster pixel geometry and PDF-point bbox citations.
Dimension-line endpoints must be independently verified and uniquely associated
with explicit-unit text on both axes before scale is accepted. No endpoint reader
is qualified on these scans: all four panels correctly retain `no_scale` and null
metric geometry. Printed scales, unitless numbers and predicted room extents do
not supply a calibration. Levels remain unknown until a reviewer chooses them.

Run with **new** directories only (Bash; semicolon is the Windows Python path separator):

```bash
PY=E:/BhuAayam-data/task-data/d07-vision-baseline-20261005/env/Scripts/python.exe
export PYTHONPATH='E:/BhuAayam-data/task-data/p2/20261011/tools;services/geo'
export CUDA_VISIBLE_DEVICES=''
MODEL=E:/Projects/3d-ulpin/.runtime/ml-models
TESS=E:/BhuAayam-data/task-data/k2/tesseract-runtime-k2b/Library/bin/tesseract.exe
"$PY" scripts/plans/read_raster_plan.py --models "$MODEL" --tesseract "$TESS" \
  --full-out E:/BhuAayam-data/task-data/p2/my-new-run/full \
  --out docs/evidence/gf-ai/plans/raster/my-new-run/tower3
```

K2b's repaired Tesseract binary is hash-identical to the retained executable;
its DLLs are pinned separately. The old runtime lacks `libcurl.dll`. This is an
explicit read-only command override, not an OCR configuration or runner patch.
The P2 tools directory supplies PyMuPDF 1.25.5 and pypdfium2 4.30.0 to the existing
CPU environment; production dependencies and model weights were not changed.

`--resume-ocr` reuses only hash-checked successful region-runner tiles from a P2
private output. `--resume-model` accepts a completed P2 run receipt and reuses its
exact mask and polygons; the continuation states `actualInference:false` rather
than claiming a rerun. `publish_raster_continuation.py` combines recorded Docling
and earlier sparse-TSV observations without assigning precedence or rewriting
literals; it proves the model geometry stayed unchanged.

`acquire_cubicasa_test.py` retains only missing publisher test members, with a
fixed selection before inference. `cubicasa_labels.py` reuses the pinned D06 SVG
transfer and publisher mapping. `evaluate_cubicasa_test.py` evaluates the
unchanged installed model; no training or threshold tuning. `publish_raster_sources.py`
publishes compact per-member provenance. Dataset CC-BY-NC-SA-4.0 and code/model
CC-BY-NC-4.0 remain distinct; all plans are foreign `test_only` research data.

Current evidence and exact execution/check receipts:
`docs/evidence/gf-ai/plans/raster/20261011-tower3/README.md`.
The primary `tower3-current/*.json` files have strict `normalized-building/1`
candidate-reference elements and separate cited room payloads. No canonical
building/level/space identity, API admission or officer acceptance is created.
