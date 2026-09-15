# Workspace manual verification — 15 September 2026

Baseline: `3e68c22`. Branch: `fix/workspace-manual-verification`.

Actual browser interactions used the local Next.js app at port 3013 and isolated `REPO_DATA=true` PostgreSQL, object storage and processing services. No mocked API or AI responses were used. The linked database and committed repository snapshot were not changed. Build/review actions added history only to the isolated runtime database.

Property: fictional 12 Lake View Road (`fdb6f855-f533-487c-9ac7-525944640b2b`). Source: `A-floor-plans.pdf` (`53f30f8a-f38d-4a70-9364-ab5854be8995`). These are authored demonstration plans, not survey evidence.

## Manual results

| Action | Observed result |
| --- | --- |
| Calibrate two picked points against the plan’s 20.00 m width | Scale saved; initial 0.024205 m/px, later 0.024077 m/px after another manual selection |
| Select coincident calibration points | Rejected with “Choose two different points on the original plan”; saved calibration retained |
| Clear button and Ctrl+Q | Drawing points and stale validation messages cleared; saved notes retained |
| Shift + left drag while calibrating | Plan and first selected point moved together; no extra point added |
| Reload and return to PDF page 1 | Calibration and notes restored |
| Open page 2 and try a metric measurement | Uncalibrated page rejected; page 1 calibration not reused |
| Open page=999 | Corrected to page 4 of 4 and URL page=4; no repeated correction after fix |
| Pick width endpoints | 19.97 m |
| Pick full boundary corners | 355.32 m² area and 75.49 m closed perimeter |
| Pick orthogonal arms | 90° |
| Enter reviewed demo levels 0.00–3.20 m with benchmark reference | 3.2 m height note |
| Draw crossing area boundary | Rejected; Ctrl+Q cleared error and drawing |
| Compare PDF with ground-floor image | Overlay, swipe, side-by-side and pixel difference rendered; swipe set to 75% |
| Select ground-floor image as primary | Same-source comparison cleared |
| Select PDF as secondary and advance its page | B page 2 of 4; primary ground-floor image unchanged |
| Build proposed details | Actual processor succeeded; revision 118 → 119, 20 supported spaces |
| Review and record | 25 proposed records, 165 boundary-contact findings; “Details recorded for this building” |
| Inspect 3D draft | Computed spatial volumes rendered from the resulting model |
| Reload after measurements | All five notes remained available |

The hand-picked area/perimeter differ slightly from the authored 20 × 18 m dimensions because of mouse endpoint placement; these are local notes, not authoritative geometry changes. Two-control calibration transforms and exact metric calculations are covered by automated tests, not claimed as manually verified here.

## Fixes

- Clear calibration errors when points are cleared or form inputs change.
- Permit Shift-drag and middle-button panning while drawing, reject non-primary drawing clicks and points outside raster bounds, and bound zoom.
- Clear in-progress selection/error when source bytes, page, mode or tool changes; reset inspector scroll for a new context.
- Add independent secondary PDF page controls and visible comparison loading/errors.
- Correct out-of-range PDF pages once, without repeated router updates.
- Show an honest loading state while opening a property workspace.
- Keep export blob alive long enough for the browser to consume it.

## Checks

`pnpm typecheck`, `pnpm test:ui` (20/20), and `pnpm build` passed after final code changes. The tests cover measurement math, page/hash calibration scope, invalid boundaries, identity routing, scene geometry and stale resource responses. Production build completed successfully.

## Captures

- [Calibration](calibration-persisted.png)
- [Measurements](measurements.png)
- [Independent comparison pages](compare-pages.png)
- [Pixel difference](compare-difference.png)
- [Recorded model and rendered 3D draft](build-recorded.png)

## Download verification — Safari follow-up

Measurement-note export dispatched `Page.downloadWillBegin` with filename `workspace-measurement-notes.json` and total size 7297 bytes, but this in-app browser then reported `Page.downloadProgress: canceled` with zero received bytes. File delivery remains canceled in the in-app browser.

Follow-up through native Safari computer use passed: created a 3.2 m height note from the authored demo levels, clicked Export measurement notes, accepted Safari’s local download prompt, and verified `/Users/vinayak/Downloads/workspace-measurement-notes.json` on disk. The 669-byte file parsed as JSON and contained the correct property/workspace ID, `height` tool, value `3.2`, unit `m`, benchmark/source reference, and local-note scope. The normal-browser download verification gap is closed; no application code change was needed for this follow-up. No claim of flawless behavior on every browser or arbitrary source document is made.

## Reproduce

Start the isolated services with `pnpm repo:init`, set `REPO_DATA=true` in your local environment, and run `pnpm dev`. Open `/properties/fdb6f855-f533-487c-9ac7-525944640b2b/workspace`. Select the floor-plan PDF, choose Calibrate, pick the two ends of the labeled 20.00 m width, enter 20 and its evidence note, then Apply calibration. Measure on that same page. Shift-drag pans during point selection; Ctrl+Q clears an unfinished drawing. Build details uses the dispatcher started by `pnpm dev`.
