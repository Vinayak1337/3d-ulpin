# PO1 UI design check

Base: `d51f5c7f` (the task's checkout base).

## Blocking

None found in the changed Studio code.

## Design system

No drift found by source review. No CSS, colours, fonts, icons or themes were added.
The mechanical scan covers `apps/web` only, so Studio was reviewed manually as well.

## Checked, no issue

- `apps/studio/src/features/intake/BatchPdfSection.tsx:114`: the long-PDF control is a labelled native
  number input with minimum, maximum, step, described bounds, invalid state and a status message.
  It adds no primary action; the existing OCR button is reused. See
  [accessibility](../../design-system/README.md#accessibility).
- `apps/studio/src/features/intake/BatchPdfSection.tsx:122`: page count comes from private source metadata;
  opening and pixel ceilings come from contracts. No sample record values are displayed. See
  [content rules](../../design-system/README.md#content-rules).
- `apps/studio/src/features/intake/BatchPdfSection.tsx:153`: candidate passages keep the existing
  revision/hash-pinned page-region opener; no record fields or rooms are made.
- `apps/studio/src/features/intake/pdf-reading.ts:53`: a long original offers an explicit single page;
  an original over the renderer bound is refused, not represented as partly read.
- `apps/studio/src/features/intake/upload-model.ts:107`: only the PDF page-limit forecast changes;
  unrelated file-kind sentences stay unchanged.
- Focus, light-only styling and wrapping use existing controls and classes. No focus override was added.

Browser keyboard/focus and 200% zoom were not exercised: this task permits no runtime.
The control and candidate opener were exercised by the Studio intake tests, not a browser rehearsal.

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs d51f5c7f` — exit 0;
zero added `apps/web` lines, no candidates.
