# K2c — backend candidate checkpoint

## TASK

Worker K1, exclusive demo runtime/DB owner. Branch `task/k2c-candidates`, based on
`staging@4ca735e9f7dd5259c30f618446aafb8dc408f105`. Runtime remains in `E:/Projects/ulpin-wt/k1`.
No merge, rebase, push, reset, reseed, volume removal, evaluation scoring or GPU inference.
GF-AI backend-side and GF-BACKEND are demonstrated only at the scope below: **no complete gate pass**.

## WORKS

- First commit refreshed 14 reviewed A2/B5 producer pins. Native regeneration was initially byte-identical;
  the LF checker passed before feature work. Subsequent contract additions were regenerated and pinned.
- Selected frozen Karnataka cluster `6933:7322:1640`: 22 chips with dense and empty context, using split/
  publisher-count metadata, not prediction performance. Site-decision §C records the rationale and restrictions.
- Installed all 22 unchanged GeoTIFF originals through the existing multipart import API. No publisher truth
  polygons, buildings, parcels, ownership, heights or controls were imported. All 22 product-API downloads
  match their retained original hashes. Canonical area exposes 22 cited, georeferenced image overlays.
- Activated `rfdetr-ramp-ka-seg-medium-b3-v1` only in the owned demo profile; registry default remains
  `active:false`. Two existing bounded CPU batches processed 22 originals once: 13 nonempty results,
  9 empty predictions and 80 roofprint candidates. These are output counts, **not accuracy metrics**.
- Canonical candidates retain source/model hashes, exact TIFF-affine placement, uncalibrated confidence and
  limitations. The ordinary footprint adapter retained one accepted source selection and one clipped-edge
  rejection, with reasons, actor/time and immutable draft receipt. The accepted draft building is still
  revision 0, candidate-only. Ordinary registry review is blocked; the qualification gate was not bypassed.
- Retained all 18 full-precision P1 Magnolia page-2 vector room candidates through the private officer API.
  Method `deterministic:vector-plan@1`, page+PDF-point bbox citations, plan-local frame/scale, literal labels
  and unknown levels are preserved. Registry and physical histories append revision 2; original package and
  earlier physical body remain unchanged; the newest physical body differs only by revision. No level, space,
  unit, ownership or placed geometry was generated.
- An explicit existing-level attachment is contract-tested with a labelled controlled fixture. Live Magnolia
  has no levels, so the API rejects attachment with 422. Exact retention replay creates no additional revision.
- One Tower page-1 region OCR retry failed; the bridge now preserves a closed failure class/message and attempt
  ID without arbitrary exception text, file paths, document text or user text. No further OCR execution.
- Final provenance audit keeps a caller-provided ML draft alias and outline role as candidates, not image-
  supported literals. Earlier receipts are retained; the current projection is separately saved.

## SEE IT

API base: `http://127.0.0.1:3194/api/v1`.

- Imagery/candidates: `/areas/cb24dc86-2b91-4793-9586-24e8a443b8d8/canonical`
- Accepted-source draft, **not registry-recorded**:
  `/buildings/a2ea9cd6-da0d-413a-9a48-03d7f25cd5e4/canonical`
- Magnolia rooms: `/buildings/e8777ffc-9409-4129-bacf-f680160d8795/canonical`
- Tower conflict remains unresolved: `/buildings/6f95d04e-2067-4ac8-a3c2-6cc21ea46325/canonical`
- Model availability: `/spatial-ml/status`

Receipts: `imagery-import.json`, `imagery-before-inference.json`, `roofprint-before-review.json`,
`roofprint-after-review.json`, `roofprint-draft.json`, `roofprint-building-current.json`,
`roofprint-recording.json`, `magnolia-before-rooms.json`, `magnolia-after-rooms.json`,
`rooms-request.json`, `rooms-receipt.json`, `ocr-result.json`, `canonical-check.json`.
Latest runtime: **`runtime-final-method.json`**. Earlier `runtime-final.json` and `runtime-final-latest.json`
are retained as prior provenance-audit checkpoints. API/dispatcher serve `395e7770`; image `ulpin-geo:demo-k2c-final` has exact processor/model-manifest
hashes matching this checkout. Later report/evidence changes require no restart. Leave it running.

## INPUTS

- Frozen membership: `docs/evidence/gf-ai/preregistration.json`, `building/split/split.json` and retained
  `E:/BhuAayam-data/datasets/ramp/coco/source-index-karnataka.json`. Import verifies the index pin and each
  original header/hash. `CC BY-NC 4.0`, Maxar upstream conditions, `test_only`, and unknown operational clearance
  remain explicit. No truth polygons or evaluation budget were imported/reopened.
- B5 registered ONNX: SHA-256 `dbf09254c6c7246f10139432e25de1f6d538aff0a680ab01c12a89fc7532affd`.
  Existing retained weights were copied only into the owned demo model directory; original weights unchanged.
- P1 full-precision derivative: SHA-256
  `b6d78b634bd4aa72e147bdf63c5873ebf277eaca40365c72b1576a9f3f024836`; original Magnolia PDF SHA-256
  `f8a55dc251facb1d0442e9a306db218356082f5d34a2c5071e9b0db64abb60b3`. The caller verifies derivative bytes;
  the command retains that declared pin and verifies current private original citation authority. It does not
  qualify the deterministic extraction as reviewed measurement or learning truth.
- Tower original SHA-256 `26c2d3101bfe676c8ac66f129439e066b603a555b3c55a35ba509befb707fad9`.
  Existing retained OCR environment/configuration and whole-page 2,000-point limit remain unchanged.

## GAPS

- **Required reviewed roofprint registry acceptance remains incomplete.** The existing package review returns
  422 `USP_GEOMETRY_PAYLOAD_UNQUALIFIED`. Source-selection review does not satisfy the requested complete
  unknown→candidate→reviewed physical/registry lineage. Zero physical records were committed from imagery.
- OCR attempt `521741ce-3527-4049-a0c9-43b13a6188f5`: observation `OCR_SUPERVISOR_FAILED`, worker exit 1,
  8.953 seconds, peak Job private bytes 1,001,758,720, no resource termination, zero text lines. Sanitized
  `KeyError`: `Worker exception; sensitive detail withheld`. Specific underlying key/cause remains unknown.
  Hindi assets are present, but the accepted runner uses English; no Hindi execution/accuracy claim.
- Magnolia level attachment is tested only, not demonstrated on live Magnolia. Its local rooms remain
  unplaced candidates, not reviewed registry spaces, legal units or a level schedule.
- Renderer imagery/candidate/plan-local styling is unowned. No `apps/studio`, `packages/scene` or training/
  evaluation scripts changed. Research imagery is not official operational evidence.
- No full GF-AI/GF-BACKEND gate pass or production human authentication is asserted.

## DESIGN

Reuse existing multipart intake, source/original storage, area workspace, job/batch authority, CPU model
session, footprint-draft receipt store and registry/physical histories. No new database schema, competing
importer, review store, snapshots or direct-DB product writes. Source grids are not invented calibration
controls. The existing area normalizer needed one explicit additional metre CRS, EPSG:6933, to preserve the
retained image area's display reference; source/area-of-use/extent validation and SQL analytical qualification
remain intact. Detailed bounded failures and repairs are in `recovery.md`.

Room retention and level association share one strict, idempotent officer command. Local-process actor/time
is attribution, not independently authenticated human review. Level selection reviews only the association;
local polygons are never silently transformed or adopted as placed registry geometry. Stored historical
claims, source packages and originals remain immutable.

## COMMITS

All contain the required worker co-author trailer; none pushed.

- `80567b4d` — producer pins after A2/B5
- `fea94e72` — unchanged imagery-only intake
- `8cd81ee8` — demo-only CPU activation and TIFF inference
- `fcd698fe` — canonical roof/room candidates and sanitized OCR
- `017dbdbc` — typed projection origins, diagnosed PostgreSQL 42725
- `03cb0c36` — preserve explicit equal-area reference through the existing normalizer
- `8f5f5415` — API inventory, original-file fallback, closed diagnostic contract and receipts
- `3138affe` — candidate alias/role state correction, prior runtime checkpoint
- `395e7770` — explicit candidate outline-role method, current served API code
- Final evidence-only checkpoint: `docs(backend): K2c candidate, imagery and OCR-detail evidence`
  (task branch HEAD; no runtime code change).

## CHECKS

Details and commands: `checks.json`. Final successful checks exit **0**:
backend typecheck; **23 focused TypeScript tests**, no failures/skips; **2 focused Python runtime invariants**;
LF API checker (**292 operations = 132 baseline + 160 added**, **327 named schemas**);
extended canonical verifier; demo doctor; added-code line/function/syntax audit; `git diff --check`.
The verifier covers 22 original hashes, current/exact-current ETags, unavailable history 404, cross-site 403,
stale candidate command 409, mismatched idempotency header 422, no-level attachment 422, immutable replay/
history, candidate provenance, null dimensions, and unchanged Tower conflict. Doctor is health/liveness,
not an OCR/model accuracy proof. The failed OCR capture exits **1**, explicitly separate from passing checks.
Evidence-only resume reran backend typecheck and the LF-export checker: both exit 0. Working/staged
`git diff --check` exits 0. No runtime, inference, OCR or DB work was performed on resume.

## NEXT

1. Lead reviews/integrates this branch and refreshes pins against any later staging producer changes.
2. Lead decides the reviewed-roofprint path. `packages/server/src/modules/areas/areas.ts:1247` calls
   `requireQualifiedGeometryRecords('FIND', 'area_feature', features)` before package review persists.
   `packages/server/src/modules/usp/geometry.ts:98–115` reads `id,revision,body` from `usp_analytic_geometry`
   under the FIND reader role, requires every requested ID and exact revision, and compares the complete
   canonical payload except envelope fields `id,siteId,identifier,revision` (`:93–97`). Any miss produces
   `USP_GEOMETRY_PAYLOAD_UNQUALIFIED` at `:115`; changing only a reviewed flag cannot satisfy it.
   The view (`database/sql/60-usp/09-geometry-schema.sql:88–99`) requires the latest qualification for that
   exact canonical revision, a matching `target_body_sha256`, no display-only/estimated target geometry,
   and `usp_geometry_receipt_eligible` (`:42–61`). That predicate reads `analyticEligible:true`,
   `geometryClass:evidence_linked`, `representation:physical_semantic|legal_space`,
   `qualification.state:qualified`, `qualification.targetBodySha256`, nonempty `qualification.sources`
   (each `source.ref.namespace:source_revision`, source ID, exact current family revision and SHA-256),
   and `qualification.receiptId`. Its matching `usp_command_receipts` row must have
   `operation:qualify_geometry`, `body.status:qualified`, exact `body.target`, `body.targetBodySha256`,
   identical `body.sources`, `body.checks.reference/topology/sourceIntegrity:passed`, and
   `body.review.verdict:accepted`. Qualification rows require `record_revision>0` (`:32`) and the insert
   guard pins current canonical bytes/revision (`:63–82`); this draft is revision 0. The lead must resolve
   that admission/qualification ordering through a supported product command, or separate non-analytical
   officer acceptance from analytical review. No DB annotations, gate bypass or repeat review is proposed.
3. Runner/adapter owner diagnoses the private `KeyError` under existing bounds before any new OCR authorisation.
4. Renderer owner consumes image overlays, roofprint confidence/limitations and plan-local room candidates.
   Magnolia attachment waits for a real reviewed level and explicit source association.
5. Preserve running demo, original inputs, retained environment, weights, storage containers and volumes.
   Do not rerun create-once acquisition/import/inference/room/OCR scripts or reopen spent holdouts.
