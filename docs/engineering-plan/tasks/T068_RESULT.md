# T068 — Studio cleanup and integrated qualification

Implemented 20 September 2026 on the linked private-PC environment. T069 revised references were completed first; T063–T067 implementation followed one bounded task at a time. This result records engineering verification, not user visual acceptance, real Indian survey acceptance or statutory qualification.

## Removed obsolete presentation

The earlier T063 route-page replacements removed the previous officer/v2 presentation bodies and kept thin compatibility redirects into Studio. The final dependency audit starts at all 35 app entrypoints: all 91 remaining presentation TSX modules are reachable. Removed the permanently closed duplicate SearchDialog, its dead Shell state/handler/imports and 179 lines of unused shell styling. Retained shared geometry, evidence, correction, rights, history, exports and source APIs. See T068_WORKER_RESULT. No used capability was deleted to meet a file-count target.

README now points to the current Studio flow and labels historical walkthroughs accordingly. `docs/STUDIO_DEMO_GUIDE.md` provides the exact source-to-record workflow, formats/limits, resume behavior and remaining processing limits.

## Integrated result

- Final production build and TypeScript check passed. 78 parent regressions and 46 cleanup-worker regressions passed (overlapping suites, not additive coverage).
- Final `verify-hierarchy.mjs` passed eight browser groups, including automatic queue status refresh, responsive header/map/register/workspace, exact unit identity, retained documents/history/investigation and keyboard dialog focus return. No browser errors or API writes in this read-only layout run. Eight real-database queue checks passed.
- `verify-complete-journey.mjs` completed the already retained T066 source-only ML imagery draft via the ordinary UI: keep unsupported height unknown, review, reload the review, explicit fictional acknowledgement, record, then export. Package `5fd5efff-4f12-4173-a60f-eb2e852fd9a5`, feature `3395d7e2-897a-4001-b408-aeb998093f13`. The exact model contour, identifier and source revision survived recording. Placement is explicitly authored fictional test evidence, not real survey control. T066's historical unrecorded checkpoint remains unchanged; the later recording is this T068 result.
- All pre-existing area features and the T061 detailed case/model/source receipts remained unchanged. The final repeat run reused the committed receipt and performed zero API writes.
- Verified block JSON plus selected roof and selected 3D-unit ZIP exports. ZIPs contain valid PDF headers, canonical selected IDs and SHA-256-matching originals (2 roof sources, 11 unit-scope shared sources). T061 unit remains 69.992404514 m²; source contour/units/levels were not invented by the redesign.
- Review uncovered that the GIS review screen previously showed only findings/coverage counts. It now exposes the actual named findings, check coverage and original downloads before recording. Recorded previews no longer claim to be unrecorded. Final browser verification exercised those disclosures.
- Final preservation comparison passed against protected `.runtime/ux-preservation-before.json`: every existing immutable row remains present. Physical feature revisions 559→560 (the new fictional roof); registry revisions 322→322; unit revisions 1001→1001; original receipt rows 554→565 (T064/T066 intake). This hashes immutable receipt columns, not every object in storage; object byte checks are separately evidenced by downloads/exports.

Evidence: `docs/evidence/t068/{journey.json,preservation.json,01-review-before-record.png,03-recorded-review-evidence.png,block-register.json,roof-register.zip,unit-register.zip}`, final `docs/evidence/t067/results.json` and `queue-state.json`. Replay scripts are under `scripts/ux/`.

## Presentation review and handoff

Compared actual rendered app captures with revised reference images side by side in `design/officer-studio-v3/implementation.html`; original-to-revised reference gallery remains `index.html`. Actual Lake View geometry/counts differ from the fictional raster design specimen and are retained truthfully. Screenshots wait for scene readiness. Source originals in the supplied Downloads pack were not modified.

App left running at http://127.0.0.1:3000/studio/work; revised design viewer at http://127.0.0.1:3011/. No commit, push, deployment, data reset or repository snapshot refresh performed.

Remaining limits: raw GNSS/LAS/DEM processing is not supported by this intake; Nous document assistance's free-route live qualification remains open; the pinned local floor/building models have limited measured qualification, not general cadastral accuracy. Private-PC verification does not establish isolated hosted-fixture acceptance. Official identity issuance and multi-user/statutory workflows remain deferred. Visual acceptance belongs to the user.
