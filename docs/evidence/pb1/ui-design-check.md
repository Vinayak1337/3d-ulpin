# PB1 UI design check

Base: `6323b054`. Offline source and component-test review; no browser or runtime qualification.

## Blocking

None found in the changed Studio code.

## Design system

No source-level drift found. Browser keyboard/focus, contrast and 200% zoom still need the combined-build rehearsal;
these are not claimed as checked visually.

## Checked, no issue

- `apps/studio/src/features/intake/PlanReadingSection.tsx:10-36`: room count, scale and no-scale words come from the
  stored candidate result. An available scale names metres per page point/pixel. Photo OCR absence stays explicit.
  No room becomes a level, unit, map placement or registry fact.
  [Principles and content](../../design-system/README.md#principles).
- `apps/studio/src/features/intake/PlanReadingSection.tsx:39-49`: the overlay link exists only for a stored PNG;
  its object URL is revoked on unmount and its accessible name announces the new tab.
- `apps/studio/src/features/intake/PlanReadingSection.tsx:76-125`: existing section/help styles, native labelled
  select and soft Button; no new colours, fonts, icons, CSS, theme or primary action. Model absence removes the
  action and says why. Request uncertainty preserves the request key.
  [Composition](../../design-system/README.md#building-in-the-design-language).
- `apps/studio/src/features/intake/IntakeTray.tsx:41-44`: the item's reading appears once in its line; the separate
  detail is the action, not a repeated summary. Existing horizontal table scrolling is retained.
- `apps/studio/src/features/intake/BatchPdfSection.tsx:57-60`: only query invalidation changed; the existing OCR
  action, page choices and words remain unchanged.
- `apps/studio/src/features/intake/plan-reading.test.tsx`: no-scale/scaled words, conditional overlay, absent-model
  action suppression, one selected-page press and repeat suppression covered with explicit test-only controls.

Mechanical scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs 6323b054` — exit **0**.
The scanner covers `apps/web` only (0 added lines); all changed `apps/studio` files were reviewed manually above.
