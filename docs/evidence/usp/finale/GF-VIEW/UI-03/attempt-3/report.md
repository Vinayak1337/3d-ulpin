# UI-03 attempt 3 — signed source elevations and zoom controls

**Scope:** focused correction of UI03-R2b and UI03-R1b from the lead's attempt-2 review. Codex desktop `gpt-6-sol/xhigh`, host `local`. Original base `62a2802cb24c9760038a8c941c17b0b8677a6ab1`; continuation/result base `65cc57fd5b8d42015c1e8d9a81b46166809510dc`; corrected code `3c882b0dec484d5fb9e8c23f98d49ee19faf297f`. No push, merge, deployment, provider call, source acquisition or new source-like fixture. Prior attempts and receipts remain intact.

## Findings resolved

| Finding | Correction | Verification limit |
| --- | --- | --- |
| R2b | Removed the frontend-only `ground-relative:` regex and its eligibility module. The underground switch is disabled and states **No scene ground tie**; a stale saved underground preference is cleared. The map no longer treats a negative signed elevation as underground or uses it to suppress source inspection. Selected detail geometry reaches the 2D map irrespective of sign. A 3D detail overlay requires the exact saved vertical reference to equal the active frame and refuses this route's relative display frame. No datum is relabelled or transformed. Cutaway stays closed. | The protected historical snapshot contains no qualified positive/negative detailed-scene pair. The sign-independent code path is traced below; positive placement accuracy needs sourced reference evidence. |
| R1b | At 760 CSS px and below, the map toolbar is a single horizontally scrollable row, navigation becomes horizontal in a separate grid cell, level content has a bounded scroll region, and lower actions have their own row. The legend is keyboard scrollable. The first 720×450 capture after the fix shows navigation, the full “Levels not supplied” message and lower actions without overlap. | This is a 720 CSS-pixel responsive equivalent for a 1440 viewport at 200% zoom. Browser chrome zoom itself was not instrumented. |

### Source and reference trace

- `packages/contracts/src/officer.ts` exposes `DetailedSceneRecord` with optional `lower`, `upper` and a **string** `verticalReference`. `apps/web/lib/server/officer.ts` constructs these from `r.geometry` and `site.frame.benchmark`; it does not supply a sourced ground-surface relation. The core frame schema does define a structured `surface_relative` variant, but this dossier/scene route does not carry that typed relation. A nonempty evidence array or a benchmark name cannot establish grade zero.
- `apps/web/features/spatial/data/core-display.ts` declares `DISPLAY_REFERENCE = "relative-display-plane-not-surveyed-ground"` for this shared scene. In [BlockPage.tsx](../../../../../../../apps/web/features/officer/block/BlockPage.tsx), selected `block.details` now reach `MapPlan` without a sign filter. `MapPlan` draws the saved local geometry and retains the record selection; the source and record panels remain available.
- In [SavedSceneViewport.tsx](../../../../../../../apps/web/features/studio/product/SavedSceneViewport.tsx), an otherwise valid detail of either sign enters a 3D overlay only when its reference exactly matches the active frame and that frame is not `DISPLAY_REFERENCE`. If that tie is absent, the source record remains available in 2D/inspection and a selected detail gets an explanatory 3D notice. No unqualified source interval is assigned the display datum. The unavailable underground control produces no cutaway or surface hiding.

The attempt-2 R3/R4/R5/R6 corrections remain intact. Existing source/document/GIS/raster/point-cloud inspection routes, `useBlock`, `MapPlan`, Cesium runtime, on-demand panels, registry and protected originals were retained.

## Blocking

- DATA-09 has not supplied a qualified Indian reference scene or a source-ground tie for this map. Positive below-grade mode, mixed-reference records, real-source accuracy, H22 Z3 and finale GF-VIEW remain unqualified. The 3D uncertainty hatch and numeric fixed-camera V-shot remain pending.
- The production build guard, `node scripts/check-build-server.mjs`, exited 1 because an unrelated service occupies port 3000. No build was run over that server.
- The lead's Astra review and this Sol implementation are the same model family. Independent milestone review remains pending; no GF pass is claimed.

## Design system

- The rearranged map uses the repository `--ui-*` tokens. The toolbar has visible focus, keyboard scrolling and no fixed absolute offsets at the tested zoom-equivalent width. Level/legend content remains scrollable rather than hidden under navigation or actions.
- The worktree-adjusted `ui-design-check` scan exited 0 with **No candidates**; icon lint also exited 0. No unrelated screen or shared backend seam was changed.

## Checked, no issue

- The final [guarded receipt](final/local-6c6e32c270b8f2d7/runner-receipt.json) pins code SHA `3c882b0dec484d5fb9e8c23f98d49ee19faf297f` and records 12 command exits of 0, including browser captures and nonce-owned service cleanup. The same protected dump SHA-256 `92cbdeb930c7b20f9a90f7857f92787ebe2562c65892ad835a758bdf1b6cfda8` and 497 pinned objects passed original, restore, migration-replay and post-browser integrity checks. No linked service or populated volume was reset. The earlier strict-locator test failure is preserved in the sibling `local-5d775b0d823fca23` receipt.
- The [720 control-occlusion receipt](final/local-6c6e32c270b8f2d7/screenshots/control-occlusion-equivalent-200-percent-zoom.json) records all 16 tested controls inside the viewport with their center point unobscured. Browser assertions also exercised keyboard focus revealing **Fit block** in the scrolling toolbar, keyboard scrolling of the legend, Layers open/Escape/focus return, source label and URL retention, disabled underground and false 3D cutaway. The [capture manifest](final/local-6c6e32c270b8f2d7/screenshots/capture-manifest.json) includes 1440×900 and 1024×768 2D views, 1440×900 scene-ready 3D and the 720×450 responsive view.
- Selected 2D [capture](final/local-6c6e32c270b8f2d7/screenshots/selected-1440.png) SHA-256 `208bb06a93fad828a636c374b56a59d73faf2debdb25a9f013dd1dbbc47d609d`; selected 3D [capture](final/local-6c6e32c270b8f2d7/screenshots/selected-3d-1440.png) `2d3a3e9012195147de7e13a11ca35c08ce27845919742433264a0fae63c88da2`; corrected [720 view](final/local-6c6e32c270b8f2d7/screenshots/selected-equivalent-200-percent-zoom.png) `04e6a027727b5458795caa40b3b96eb1d2fe774d8e94b85353dc92c227c6a2b5`.
- `pnpm --filter @ulpin/web typecheck`, `pnpm lint:icons`, `node --check scripts/usp/ui/UI-03-isolated-preview.mjs`, worktree design scan and `git diff --check` exited 0. No ML runtime was used; a model hash is not applicable.

**Disposition:** focused UI-03 corrections and unchanged-snapshot regression passed locally. Qualified source, GPU and independent milestone gates remain open.
