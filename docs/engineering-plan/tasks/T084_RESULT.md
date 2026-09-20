# T084 — Saved-dataset ML and live hackathon walkthrough

Implemented locally on 21 September 2026, on the existing linked PostgreSQL/S3/Redis/private-worker services. No populated volumes or committed snapshots were refreshed. This is a bounded integration milestone, not completion of the full problem statement.

## Delivered

- Saved Lake View and Shiv Vihar packages now open **Prepare with ML** from the map. The Batches directory resumes their ML work and reports processing/failure/candidate states.
- PNG/JPEG/PDF source/page selection, up to 12 selections per batch; additional originals can be retained separately without changing the immutable package snapshot.
- Durable jobs reuse the private ONNX inference worker, with exact source/model/profile fingerprints, request replay protection, background status and new-attempt retry. Existing legacy inference remains supported.
- Retained original raster, prediction mask and selectable polygon overlay. Keep/reject decisions are appended as review history. Calibration and optional levels are explicit; absent height stays unknown.
- Documented controls transform retained pixel rings to the dataset's named metre frame. PostGIS validates polygons, computes areas and checks positive-area overlap among selected candidates. Optional supplied levels produce prism volume. These checks are not a full 3D cadastral topology test.
- Separate downloadable candidate/evidence JSON; source map/registry identities are not rewritten or automatically published.
- Live **Explain the workflow** tab: Retain → Extract → Inspect → Measure → Record boundary, actual counts/images, rotatable prism illustration and speaker notes. `/explain` retains the existing historical test walkthrough and interactive architecture, with a new link to live processing.

## Actual runs and review

Lake View retained floor plan `plans/B01-level-1.pdf`: CubiCasa, 24 regions, actual ONNX CPU inference. Aerial preview: RF-DETR, 10 regions; repeated through the browser workflow with the same 10-region result. These are candidates, not accuracy claims. The thin authored floor drawing produces poor/noisy semantic regions; the aerial model misses many supplied buildings. Both limitations are visible rather than replaced with invented output.

Browser-created candidate from the first building run: 369 m². Synthetic grid controls follow `from_origin(-26,204,1,1)` and the generator's byte-grid-equivalent JPEG. Explicitly authored 0–3 m levels illustrate 1107 m³ prism calculation; they are neither inferred nor measured building height. The review note flags boundary correction and qualification still required.

Shiv Vihar currently retains JSON records, without PNG/JPEG/PDF source originals. Its processing UI states this and offers evidence receipt; it makes no inference claim.

## Verification

- Production build and TypeScript passed.
- Unit/regression suite: 12 passed, 3 HTTP-only tests skipped in that invocation. Separate live HTTP suite: all 6 passed.
- Existing isolated legacy ML integration: all 8 checks passed. Caught and fixed loss of the `INFERENCE_TIMEOUT` error code during dispatcher integration.
- New isolated PostgreSQL/S3 lifecycle: additional source receipt/replay; worker operation mapping; running/completed state; unchanged source suitability; missing-height null; rejection/history; failed retry isolation. Temporary test schema and only newly created test objects removed.
- Actual retained inference integration: exact batch replay/no duplicates; changed request and dataset rejection; all 53 Lake View source objects verified; exact original ZIP hash; retained PNG hashes and scoped access; model/source/profile validation; review replay; wrong frame/raster/height evidence rejection; area/volume; unchanged canonical snapshot.
- Browser: source choice → queue → automatic result; overlay selection; calibration + height evidence → saved proposal; reload restores review/controls; live workflow and rotation; map entry point; Shiv Vihar missing-evidence state. Default desktop and 768 px responsive layouts inspected; no horizontal overflow at 768 px. No browser errors observed in the inspected workflow.
- Evidence: `../evidence/t084/integration.json`, `live-walkthrough.png`, `review.png`, `shiv-vihar-evidence-state.png`, `walkthrough-tablet.png`, `architecture.png`, and test logs.

## Boundaries and next work

T080 remains open: complete preparation of heterogeneous packages and guarded promotion of candidates into canonical geometry/record revisions. This milestone keeps candidates separate. It does not deliver general LAS/LAZ floor segmentation, DEM/GNSS registration, reconstructed underground ownership solids, comprehensive volumetric legal topology, Indian survey/model accuracy qualification, or statutory ID issuance. Native adapters accept bounded supported profiles; arbitrary files do not imply usable geometry.

The review screen currently lists the latest 60 jobs; full review history remains in the database. The prism is an explanatory projection of the actual candidate rings and supplied levels, not a second spatial map engine. Source bytes and all existing geometry/revision histories are preserved.
