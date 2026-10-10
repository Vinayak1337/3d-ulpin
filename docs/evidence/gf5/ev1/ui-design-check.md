# EV1 UI design check

## Blocking

None.

## Design system

None in the changed viewer.

## Checked, no issue

- `apps/studio/src/features/evidence/CitedPageViewer.tsx:103-130`: the title explains the size rule;
  the body changes from “not shown yet” to “shown on its own” only after the private PNG answer.
  Sheet dimensions come from the listing, page number from provenance, hash prefix from the response header.
  The listing carries no whole-page size limit, so the viewer prints no limit.
  See [content rules](../../../design-system/README.md#content-rules).
- `CitedPageViewer.tsx:146-179`: the whole-page and region views share `PageWithRegion`, `regionOutline`
  and the existing `.region` style. The image uses the server's affine matrix and output dimensions.
  A refusal has no image and uses `PageRefusal` with the refusal code and “Try again”.
- `EvidenceViewer.module.css:34-36`: three compact rules reuse spacing and type tokens; no new colours,
  radii, shadows, themes, icons or component library.
  See [visual foundations](../../../design-system/README.md#visual-foundations).
- `citedPage.ts:9-30`: an unpinned citation uses only agreeing source metadata already read by the register.
  The viewer states that the citation names no revision. Absent or conflicting loaded pins have no default.
- `capture.mjs`: caption and label open through real register controls. Opening sends no POST;
  Tab reaches “Show the cited region” and Enter sends the read. Escape closes the dialog;
  the created object URL is then revoked. Card-list POST attempts are aborted before network dispatch.
- `before/`, `after/`: 1440 × 1000 physical pixels, plus desktop 200% emulation
  (720 × 500 CSS pixels, DPR 2). Dialogs stay inside the viewport and do not scroll horizontally.
  The picture and provenance at 200% require normal vertical dialog scrolling; detail shots retain both.
  The page-only case is a viewer-boundary capture with a real canonical locator and real register pins,
  not a claim that the current navigation exposes that locator.
  See [accessibility](../../../design-system/README.md#accessibility).

## Qualification limits

No screen-reader, contrast-tool or formal cumulative-layout-shift measurement was run.
Contrast and focus inherit the existing light-theme tokens and Button/Dialog components.
Cancellation is wired through the query's AbortSignal; the capture verifies completed-image URL cleanup,
not cancellation of an in-flight server worker.

## Mechanical scans

- `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` → exit 0, no candidates.
  This skill's scanner targets `apps/web`, so it sees no changed lines here.
- `node docs/evidence/gf-ai/ui/f2c/scan-studio.mjs staging` → exit 0, no candidates in Studio.

Manual review covers the Studio viewer and CSS that the legacy scanner does not inspect.
