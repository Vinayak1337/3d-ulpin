# K2d — reviewed-roofprint prerequisites and bounded OCR diagnosis

## TASK

GF-AI backend / GF-BACKEND slice, `task/k2d-roofprint-review`, base
`a8fe388843592311073ea697f069ba436eae698f`; worktree `E:/Projects/ulpin-wt/k1`.
Started 10 October 2026, 09:06:16 IST; 60-minute maximum. This checkpoint is **blocked on prerequisites**,
not a reviewed-roofprint lifecycle or full gate pass. No merge, rebase, push, reset, reseed or GPU use.

## WORKS

- Reviewed T1-prep Surat and P2 CubiCasa catalogue additions and refreshed the one changed producer pin.
  They remain development/test-only, with permission/licence/foreign-evaluation limitations preserved.
  Wire schemas did not change; OpenAPI/client were not regenerated.
- Isolated A4/A5 receipt mismatch to three checkout LF/CRLF differences. Recorded hashes match exact
  reconstructed LF bytes; retain historical receipts and pins. The existing K2b export normalizer also
  respects historically CRLF-pinned receipts. Fresh API checker passes 292 operations / 327 schemas.
- Observed ordinary roofprint review and commit once: review 422 `USP_GEOMETRY_PAYLOAD_UNQUALIFIED`,
  commit 409 `STALE_REVISION` because review did not persist. Package and canonical JSON remain identical.
  No gate bypass, non-analytic acceptance kind, direct DB write or fabricated qualification receipt.
- Same Tower 3 page-1 region ran once under existing 90-second / 6-GiB / 2-MiB-log bounds.
  Full traceback remains private. `KeyError: 'text'` is identified at upstream Docling's TSV reader, line 251.
  Missing OSD asset is explicitly logged; active tessdata also lacks `configs/tsv`. No asset repair or retry.
- `_model_active` now follows any explicitly configured `activeProfiles` member, not a hard-coded demo name.
  Default inactive registrations remain inactive. Manifest policy is unchanged: Karnataka is demo-only/CPU.
  One focused regression plus three checks against the served module pass without inference.

## SEE IT

Existing loopback API remains running: `http://127.0.0.1:3194/api/v1`.

- `GET /buildings/a2ea9cd6-da0d-413a-9a48-03d7f25cd5e4/canonical`: unrecorded roofprint candidate,
  revision 0; null height/base/storeys, no levels/parcels, no analytical qualification.
- `GET /areas/cb24dc86-2b91-4793-9586-24e8a443b8d8/canonical`: 22 unchanged image originals,
  80 roofprint candidates; the prior accepted/rejected source selections remain, not registry acceptance.
- Magnolia's 18 rooms remain unplaced with no levels; Tower retains the exact prior G+41/G+42 conflict.
- `roofprint-before.json`, `roofprint-after.json`, `admission-result.json`, `diagnosis.json`,
  `canonical-check-final.json`, `runtime-final.json` are the owned receipts in this directory.

## INPUTS

K2c's existing draft package `dae9326f-ec09-4e4c-89c5-c413bf8ed9b8`, building above and exact-source
Karnataka TIFF reference. Read-only API verification rechecked all 22 original SHA-256 hashes.
No truth polygons, evaluation budget, scoring, training or additional roofprint inference were opened.
Tower source SHA-256 `26c2d3101bfe676c8ac66f129439e066b603a555b3c55a35ba509befb707fad9`,
page 1, region `[280,860,960,2580]`, unchanged native OCR/model environment and English configuration.
Only new owned runtime debug/overlay/image files were added; retained assets/configuration stay unchanged.

## GAPS

- Required `unknown → candidate → reviewed` registry footprint lineage is **not complete**.
  No positive canonical revision, accepted qualification, measurement authority or ownership/parcel claim.
- No second new rejection was made: stopped after the required ordinary admission prerequisite failed.
  Existing rejected source component remains in history and outside the pending candidate outcomes;
  that is K2c evidence, not a new K2d demonstration.
- No executable `qualify_geometry` producer/route was found. The existing helper is documented as a future
  qualified-processor hook; SQL requires an accepted exact-target receipt that a caller label cannot create.
- OCR still fails with zero retained items. `text` is a static column name, not document text.
  Missing OSD is proven. Missing TSV config is observed and a plausible reason for a non-TSV dataframe;
  exact native stdout was discarded upstream, so TSV asset causality is not independently proven.
  No owned code defect was sufficiently established to justify an OCR code patch/regression/retry.
- Hindi assets present does not establish Hindi execution/accuracy. Doctor proves availability/ownership,
  not extraction accuracy or a complete GF-AI/GF-BACKEND gate.

## DESIGN

- Admission uses only existing `POST /import-packages/{id}/review` and `/commit` commands. Both failures
  are retained without DB annotation. Immutable source/model/receipt lineage and the qualification gate remain.
- `areas.ts:1247` requires qualified FIND geometry **before** review persistence. Commit prerequisite is
  `areas.ts:1325–1330`; the refusal is consequential, not proof of an unrelated revision defect.
- `usp/geometry.ts:98–114` compares exact ID/revision and complete canonical payload under the existing
  analytical role. Failure is at line 114. `recordGeometryQualificationTx`, lines 76–89, requires a current
  positive revision; it is not called by an executable producer in the inspected repository.
- SQL `60-usp/09-geometry-schema.sql:32,42–82,88–99` requires positive record revision, exact canonical
  hash, current source-revision hashes and an accepted `qualify_geometry` command receipt with passed
  reference/topology/source-integrity checks. Declared TIFF CRS/affine is image georeference, not survey control.
- Private bounded OCR log shows upstream `docling/models/stages/ocr/tesseract_ocr_cli_model.py:251`
  reading `df_result["text"]`. Line 228 requests the `tsv` configuration. Absolute traceback paths,
  arbitrary error messages and extracted document text were not copied into public evidence.
- Processor update recreates only owned geo/worker services, retains all earlier images/overlays and storage,
  and does not restart native API/dispatcher. Exact served source hashes match the checkout.
  API startup checkpoint remains `395e7770`; the unchanged server TypeScript does not require a restart.

## COMMITS

- `730ebb78` — `chore(api): refresh producer pins after T1-prep/P2/A4`.
- `6693790b` — configured activation predicate/regression and prerequisite observations.
- Final evidence-only checkpoint contains this report, final verification, processor and runtime receipts.
  Every commit carries the required worker coauthor; none was pushed.

## CHECKS

Exit 0: LF-export unchanged `scripts/api/check.py` (292 operations / 327 schemas),
`pnpm typecheck:backend`, 23 focused TS tests, extended read-only `verify-canonical.ts`,
one isolated Python regression, three served profile-predicate assertions, `platform:doctor --profile demo`,
new-code line/function/syntax audit and working/staged `git diff --check`.
Test-generated historical K1 examples were restored to their exact HEAD content.

Expected non-passes: ordinary review 422, ordinary commit 409; direct OCR worker and supervisor exit 1,
10.25 seconds, no resource termination. These are not disguised as passing extractions or gate evidence.
External logs: `E:/BhuAayam-data/task-data/k2d/`; full OCR traceback stays in the user-specified private
runtime debug root. No extraction text/traceback is committed.

## NEXT

1. Lead decides a supported admission-before-qualification ordering and supplies an executable qualification
   producer without relaxing the exact-payload/receipt gate. Do not repeat the failing command or manufacture
   a positive revision. Only then validate topology and original/model/receipt hashes, establish an actual
   officer verdict with the requested image-resolution limitation, retain measurement authority withheld,
   and demonstrate a second rejection plus immutable history.
2. Asset/runtime owner must authorise an isolated complete native tessdata prefix (official OSD and TSV
   config assets) or a proven owned adapter repair. Preserve existing environment/config/assets. Validate
   exact native TSV behavior under bounded private diagnostics before authorising one materially different
   OCR comparison. No blind retry/crop sweep or claims of successful Hindi/OCR fields.
3. Lead reviews/integrates the commits and reconciles pins against any newer staging additions. Preserve the
   running demo, originals, GPU owner, storage and all prior evidence. Do not rerun create-once mutation scripts.
