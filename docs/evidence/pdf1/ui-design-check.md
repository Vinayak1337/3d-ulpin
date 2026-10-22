# PDF1 UI design check

## Blocking

None found in the changed Studio components.

## Design system

None found by source review. The mechanical scan covers `apps/web`, not Studio; its clean result alone
is not a Studio visual qualification.

## Checked, no issue

- `apps/studio/src/features/intake/BatchPage.tsx:103,123`: one selected PDF inspector, including in a mixed
  batch. PDF navigation uses existing soft buttons; `IntakeTray.tsx` is unchanged.
- `apps/studio/src/features/intake/BatchPdfSection.tsx:46`: existing `Batch.module.css` panel/stack classes
  and shared UI components; no new colours, fonts, radius, shadows, icons, theme or sample record values.
- `apps/studio/src/features/intake/BatchPdfSection.tsx:72`: one OCR write action, explicit page selection and
  unread remainder; native buttons are keyboard reachable and unavailable while the press is pending.
- `apps/studio/src/features/intake/BatchPdfSection.tsx:91,98`: runtime refusal announced through the shared
  warning banner; candidate passages open the existing page-region viewer with original revision/hash pins.
  Regions retain top-left page points. No OCR text becomes a room, level, unit or record field.
- Existing wrapping layouts and focus styles are reused. Actual browser focus/200% zoom and screenshot
  verification were not run; unit rendering is not a visual-runtime claim.

Rules: [principles/content/accessibility](../../design-system/README.md),
[component anatomy](../../design-system/components.md).

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` — exit 0, no candidates
(0 added lines in `apps/web`). Studio component review above supplements that limited scan.
