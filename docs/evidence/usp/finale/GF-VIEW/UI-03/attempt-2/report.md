# UI-03 attempt 2 — map composition and source semantics

**Scope:** UI-03 correction of the six findings in the lead's attempt-1 review. Codex desktop `gpt-6-sol/xhigh`, host `local`; original base `62a2802cb24c9760038a8c941c17b0b8677a6ab1`, attempt-1 result `ccffcf6eedf58e44e7be7f7e94cbc344840985c9`, final code `657e23fe16783270d58e96a214a15b08d046ba22`. No push, merge, deployment, provider call, or new operational source data. The lead's independent milestone review remains pending.

## Review findings

| Finding | Correction and evidence |
| --- | --- |
| R1 map composition | The area map now has explicit grid slots for toolbar, shared canvas, source world, level rail, legend, navigation, actions, and readout in `BlockPage.tsx`/`area-map.css`. The old absolute `MapPresentation` overlay and page-scoped stage/toolbar/world/bottom/finding CSS were removed. The on-demand panel and inspector retain their distinct inspection paths. Captures at 1440, 1024 and a 720 CSS-pixel viewport (1440 at 200% layout equivalent) are in the final manifest. Enter opens the Layers panel, Escape returns focus to its button at 1440 and 720. The 720 capture is a responsive zoom equivalent; browser chrome zoom itself was not instrumented. |
| R2 underground | A negative elevation alone no longer enables underground. `undergroundEligibility.ts` requires explicit ground-relative grade zero, the same saved scene vertical reference, a linked source record with evidence, geographic geometry, and finite ordered negative bounds. The UI checkbox, 2D detail list, 3D detail overlays, cutaway and stored preference use that result. Unqualified negative records and utilities cannot trigger below-grade display. The historical snapshot correctly leaves the switch disabled and the 3D cutaway false. Positive grade-qualified geometry remains untested without DATA-09. |
| R3 vertical references | The level rail reads each floor's own detail reference; a shared header reference appears only when every numeric level has that same supplied reference. Unreferenced numeric levels say so, and missing elevations stay unknown. No area-level fallback is used. The regression snapshot has no levels, so mixed-reference rendering is not empirically qualified. |
| R4 provenance | Demonstration areas and synthetic inspector records say **Test fixture**. Source-world choices reflect saved world status, including **Synthetic · test fixture**, **Observed**, **Planned**, and **Hypothetical**. The pinned Bronx area records `dataKind=real` and displays **Recorded source**; it was not relabelled as an Indian or official source. |
| R5 test inputs | Deleted `tests/usp-map-presentation.test.ts`, which contained authored source-like positive records. The browser regression reads only the immutable pinned historical snapshot and checks absent underground/readiness plus the retained routes. No positive source qualification is claimed. |
| R6 3D colours | `SavedSceneViewport` now leaves base road, parcel, public-land and other kind colours to the shared `TileLayer` adapter. Entity overrides are limited to explicit utility/finding modes; estimated and illustrative opacity stays separate. The historical scene verifies the neutral selected-building path but does not contain a full road/parcel colour matrix. |

### Replacement, retained, pending

- **Replaced:** the page's absolute map-control overlay, fixed presentation placement, unqualified underground decision, shared first-level datum, and fake source-like unit test.
- **Retained:** `useBlock`, `MapPlan`, the Cesium `SavedSceneViewport` and its external source path, `BlockRails` parcel/source/utility/document inspection, `FindingsTray`, `DataTools`, and the selected-property inspector. The shared product stylesheet still has inert legacy map selectors; no active page markup uses them.
- **Pending qualification:** DATA-09 Indian reference scene, explicit sourced ground/vertical transform and negative-level fixtures, mixed-datum level fixtures, 3D uncertainty hatch, numeric camera V-shot, real-source accuracy, GPU performance and independent milestone review. No GF-VIEW pass is claimed.

## Blocking

- The pinned snapshot is a historical Bronx regression, not DATA-09 or a current Indian operational source. It has no saved levels or qualified below-grade scene. It cannot pass H22 Z3, D0/D1 V1–V4, or real-source accuracy.
- `node scripts/check-build-server.mjs` exited 1 because an unrelated service occupied port 3000. The production build guard was respected; no build or deployment was run.
- The 720 CSS-pixel layout and focus audit is equivalent to a 1440 CSS-pixel viewport at 200% zoom for responsive layout. Actual browser zoom and browser chrome interaction remain unmeasured.

## Design system

- Active map slots use the repository `--ui-*` palette, shape and focus tokens and shared `Icon` component. The selection and question colours remain separate. Source labels, unknown geometry hatch and readout use saved values only.
- The worktree-adjusted `ui-design-check` scan examined 441 added web lines against its configured base and exited 0 with **No candidates**. Manual review identified the pending 3D hatch and camera checks above.

## Checked, no issue

- The [final pinned receipt](final/local-c536519a8455d8d6/runner-receipt.json) records code SHA `657e23fe16783270d58e96a214a15b08d046ba22`, all 12 guarded commands exit 0, and nonce-owned service cleanup exit 0. It verified dump SHA-256 `92cbdeb930c7b20f9a90f7857f92787ebe2562c65892ad835a758bdf1b6cfda8`, 497 pinned objects, exact restored tables, additive migration replay and unchanged protected data after browser use. Earlier failed assertion receipts and successful intermediate receipts remain in sibling `final/local-*` folders; none touched linked services.
- The [capture manifest](final/local-c536519a8455d8d6/screenshots/capture-manifest.json) records area and selected 2D views at 1440 × 900 and 1024 × 768, selected 3D scene-ready at 1440 × 900, findings mode, and 720 × 450 layout. The [720 layout metrics](final/local-c536519a8455d8d6/screenshots/layout-equivalent-200-percent-zoom.json) show the map column, canvas and grid each span all 720 CSS pixels. The browser asserted source label, URL selection preservation, unavailable readiness, disabled underground, closed cutaway, geometry visibility, panel keyboard operation and focus return.
- Selected 2D [capture](final/local-c536519a8455d8d6/screenshots/selected-1440.png) SHA-256 `0f58726d775543d85fd8450c5e950705e726aae7b3ff72c476f30eb7a56167c0`; selected 3D [capture](final/local-c536519a8455d8d6/screenshots/selected-3d-1440.png) `6ed6e44a4128247347d4afa07a6354a196a12551da7a7817163f7e2608a54d82`; [720 layout](final/local-c536519a8455d8d6/screenshots/selected-equivalent-200-percent-zoom.png) `9d859ab868e247fa24d624eb35d61495873abe4200c66877d90c5d41487438b8`; [findings](final/local-c536519a8455d8d6/screenshots/selected-findings-1440.png) `ae9f1d7c487e9df17daa4f02a0365f329b4381d24403c097a11e91eeea13a3ba`. The preserved attempt-1 [baseline](../attempt-1/baseline/local-39f7c3f8bffc7851/runner-receipt.json) used the same source dump and object manifest.
- `pnpm --filter @ulpin/web typecheck`, `pnpm lint:icons`, `node --check scripts/usp/ui/UI-03-isolated-preview.mjs`, and `git diff --check` exited 0. No ML runtime was used; a model hash is not applicable.

**Disposition:** review-ready correction and historical local regression pass. Finale release gates remain pending on qualified reference evidence and independent review.
