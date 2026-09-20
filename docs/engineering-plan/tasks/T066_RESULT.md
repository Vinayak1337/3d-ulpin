# T066 result — unified intake and source-led extraction

Implemented and parent-reviewed/browser-verified 20 September 2026. User acceptance remains separate.

`/studio/add-files` accepts supported GIS and document selections. Files are inspected or retained through existing bounded services. Document-only intake goes directly to saved source review without requiring a block/property; block, explicit source origin and retained metre frame are selected when spatial extraction needs them. PDF, PNG, JPEG, CSV, text and DOCX are supported consistently through receipt and later assignment. Unsupported/oversized inputs give per-file corrections; native documents are limited to 10 MiB and images/GIS to 16 MiB. Retried receipts preserve identity.

Imagery extraction now works in a source-only workspace with no placeholder feature. Local model output uses exact retained raster/contours, explicit reviewed controls and ordinary footprint draft review/recording. Full frame, area reference, original hash, part, raster, job and model guards prevent inappropriate control reuse. Matching previous building controls are restored read-only, including existing source-workspace receipts. Property linking is secondary.

## Parent evidence

- Final production build passed; app restarted from final build (including control reuse/limits).
- 15 focused tests and typecheck passed (worker report).
- `scripts/ux/verify-source-workflow.ts`: five actual linked-service qualification groups passed. New explicitly fictional source workspace, PNG + published attribution preserved byte-for-byte, local building inference succeeded with eight actual suggested regions, selected contour transformed without shape replacement, unknown height retained, same request returns same draft/identity, wrong frame rejected. Checkpoint `docs/evidence/t066/workflow/state.json`; no recording performed.
- `scripts/ux/verify-source-intake.mjs`: eight browser groups passed on final build. No-block document receipt/direct navigation; all six formats/original byte hashes/retry IDs; later context adopts same originals; actual retained inference and persisted controls restored; ordinary footprint review; mixed GIS/documents preserve context; compact tablet intake; oversized PDF preflight; no page errors. `docs/evidence/t066/browser/results.json` and screenshots.
- Actual images reviewed against corrected Add files/review references. Wider shared header/map/register changes remain T067.

Parent review fixed mixed-file new-area context, late property context defaults, unsupported-file continuation, redundant continuation clicks, unnecessary pre-upload block requirement, competing Assign action, advertised size mismatch and lost building controls. All source cases/drafts used for qualification are explicitly fictional, and published images retain attribution. No official identity or survey assertion is made. Building placement still requires an existing block with a valid projected named reference; raw GNSS/LAS/DEM expansion remains deferred.
