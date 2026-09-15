# V2 Plan Workspace verification

Verified 15 September 2026 in an isolated headless Chromium session (`v2-workspace`). UI implementation follows the supplied V2 design pack, uses modular workspace components and scoped CSS, and retains the existing processor, fact-review, placement and registry APIs. The frontend-design skill, bundled Next.js guidance, and a bounded React best-practices review were applied.

## Scope and safeguards

The new start page can create an unassigned case, reopen retained cases, or choose a loaded property. Property workspaces provide Measure, Calibrate, Compare and Build Details modes in one canvas shell. PNG and PDF originals render from retained source URLs; native source geometry preserves its declared local frame. Source text remains available when a drawable plan is absent.

**Measurements and calibration are browser-local notes, not registry authority.** They are scoped by workspace, original source ID/hash and page. Known-distance calibration establishes scale only. Two documented controls support a named metre frame; using a calibrated trace as a preparation candidate still requires source association, review, placement and an actual build. The control-point mathematics is unit-tested; the browser build below used explicit native CSV geometry, not an inferred image trace.

**Compare is visual.** Side-by-side, fitted opacity overlay, swipe and pixel-difference display do not calculate clearance, surveyed overlap, or a metric discrepancy. Geometry from incompatible declared frames is separated. Light/dark image differences can include scan, text, sampling and registration changes.

**V2 currently has no entry to bounded Nous extraction.** Existing backend and legacy assistance remain separate; this verification makes no live or cached model-response claim. Native fact extraction and manual reviewed preparation are the implemented V2 path.

## Actual browser actions

1. Created unassigned case `27200fd5-13e4-45ec-9780-8bef1fa7b496` through **New workspace**. Retained two synthetic PNG originals and a two-page PDF through **Add documents**.
2. Selected two plan points before calibration. The UI refused the metre measurement and kept zero completed measurements.
3. Selected the printed dimension endpoints (800 source pixels), entered 10 m and a source explanation, and applied calibration. Traced the rectangle through canvas clicks. The UI displayed **60 m²**; the exported floating-point result was `59.999998340629745 m²` from screen-to-source coordinate conversion. Notes and calibration reopened after a full page reload.
4. Exercised side-by-side, opacity, swipe and pixel-difference controls. The authored right-edge change appeared visually; the interface expressly withheld a measured discrepancy claim.
5. Opened a retained two-page PDF. Page 1 rendered, its own calibration was applied, and switching to page 2 showed **Two points needed**. Page calibration did not leak to the next page or from the PNG original. The final production retest also entered unapplied distance/reason values, changed page and changed PDF→PNG: both fields reset to empty. Returning to PDF page 1 restored its saved 0.011111 m/px calibration and original saved explanation, not the unapplied test text.
6. Used the explicit assignment dialog to choose the new synthetic B by its actual identifier, review the selected originals and record a synthetic-only assignment reason. The UI copied three originals into its canonical preparation. The unassigned case remained intact, and local notes were not silently transferred.
7. Uploaded `synthetic-b-native-room.csv` through the UI. Five native candidates appeared: lower level, upper level, space name, floor name and boundary. Building before their review and placement was refused with a specific missing-input message.
8. Individually opened each fact's review dialog, retained its source reference and entered the review reason. Confirmed the exact area metre frame, zero offset and named synthetic benchmark using the CSV part as placement evidence.
9. **Build proposed 3D details** ran the actual worker and returned one supported space. **Review proposed records** returned three records and zero findings. Entered a review note and pressed **Record reviewed details**. The canvas visibly rendered the computed room.
10. Opened the same property's **Property register → Floors & Units**. The recorded row showed **16 m², 0–3 m, S001**. An independent agent also opened its unit deep link and confirmed **48 m³** and source evidence without changing it.
11. Exercised all measurement tools on the native room canvas: **area 16 m², distance 4 m, perimeter 16 m, angle 90°, point (24,4) m, height 3 m** from entered source levels 0–3 m in `BM-SYNTHETIC-V2-ONLY`. Exported the browser-local notes. The saved point marker rendering was corrected and then visibly verified in the rebuilt production UI, including its coordinate title and mobile display.
12. Opened the new B with an unrelated area query. After membership verification, both the page’s **Back to block** link and the shared **Block Map** navigation pointed to its correct owning area and retained B selection. The interface displayed a clear fallback explanation.
13. Dragged the native canvas and changed modes. The shifted view box remained (`20.770967431709753 -6.9080186104515695 4.96 4.96`), rather than resetting to its initial `21.52 -6.48 4.96 4.96`.

The initial measurement checks ran on development origin `127.0.0.1:3000`; the assignment/build/register and PDF checks ran on stable production origin `127.0.0.1:3002`. Browser-local notes are also origin-scoped. A PDF script interrupted during development hot reload was retried on production; the interrupted attempt is not counted as a pass.

## Retained isolated fixture

| Item | Identifier |
|---|---|
| Area | `e4eea7b8-f1f0-4ea0-bd82-29e0c2a740a3` |
| Area name | V2 redesign verification · synthetic |
| Canonical building B | `f29b8566-fe5f-4a46-85d0-8754a6fccf3e` |
| Building identifier | `3DU-74XTKVHWFG9TGBV0H9W31AEG53:B002` |
| Preparation package | `11b1ec96-ea8f-4e60-8387-4488b58501b3` |
| Detailed case | `192d8f16-c55a-453a-9cbd-21c34d9399bf` |
| Floor | `40c2bed9-ac78-4c06-b6aa-6cc78568543a` |
| Room | `5143128b-05e0-4f1d-b7cd-e2be16c9509e` |
| Room identifier | `3DU-74XTKVHWFG9TGBV0H9W31AEG53:S001` |
| Native room source | `32aed4a0-d86e-4e12-80a5-b51dd7e55189` |

The new building B identity was preserved. Earlier retained A/B/foreign Bronx records were not edited by this verification. Original PNG/PDF/CSV bytes were read back after the UI workflow and matched the authored fixtures exactly. Copied parts retain original case ID, source ID, hash, revision, profile, locator, timestamp and assignment reason. This read-only provenance check is separate from the actual UI actions above.

## Evidence and automated checks

The initial measurement and recorded-build captures document the workflow as it ran. The `*-final.png` captures show the later production polish, including corrected source-status wording, saved point markers and PDF form isolation.

- [Calibrated plan measurement](evidence/v2/workspace/measure-1366.png)
- [Actual computed room and recorded confirmation](evidence/v2/workspace/build-recorded-1366.png)
- [Reopened unit register](evidence/v2/workspace/recorded-register.png)
- [Mobile comparison canvas](evidence/v2/workspace/compare-mobile.png)
- [Final saved point marker](evidence/v2/workspace/point-marker-final.png)
- [Final pixel difference](evidence/v2/workspace/pixel-difference-final.png)
- [Restored saved PDF calibration](evidence/v2/workspace/pdf-calibration-restored-final.png) and [page 2 with reset unsubmitted fields](evidence/v2/workspace/pdf-page-reset-final.png)
- [Final mobile canvas](evidence/v2/workspace/native-mobile-final.png) and [controls](evidence/v2/workspace/native-controls-mobile-final.png)
- [Validated block fallback](evidence/v2/workspace/context-fallback-final.png)
- [Original-byte and lineage proof](evidence/v2/workspace/provenance-proof.json)
- [Exported plan measurement notes](evidence/v2/workspace/measurement-notes.json)
- [Exported six-tool native notes](evidence/v2/workspace/native-measurement-notes.json)

Additional captures are under `output/playwright/v2-workspace/`, including PDF page 2, overlay/swipe/difference, 1920 desktop, mobile controls and 125% equivalent viewport. Responsive checks used 1366×768, 1920×1080, 390×844 and 1093×614. The last is a **CSS viewport equivalent** to 1366×768 at 125%; it is not a claim of native browser zoom. Measured document widths equaled the tested 1920, 1366, 1093 and 390 viewport widths. The mobile layout uses source/control dialogs and keeps the canvas in view.

`pnpm typecheck` passed. Five focused tests passed with:

```sh
pnpm exec tsx --tsconfig apps/web/tsconfig.json --test apps/web/features/v2/workspace/measurement.test.ts
```

They cover scaled length/area/perimeter, rotated and translated control coordinates, original hash/page binding, missing/degenerate calibration, crossing boundaries, angle degeneracy, and display-Y inversion for native metre geometry. Production browser logs included ordinary unused-preload warnings and the intentionally refused missing-input build request; no browser application crash was observed.

The small existing `PreparationPlacement` and `PreparationBuild` controls and the low-level 3D renderer are reused. Their advanced editor is explicitly the legacy route. The new workspace is not the old page embedded inside a renamed shell.
