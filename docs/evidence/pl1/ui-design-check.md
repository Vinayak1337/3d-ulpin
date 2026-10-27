# PL1 UI design check

## Blocking

None found in the changed Studio component.

## Design system

None found by source review. The mechanical scan covers `apps/web`, not Studio; its clean result alone is not a
Studio visual qualification.

## Checked, no issue

- `apps/studio/src/features/intake/BatchPdfSection.tsx`: existing `Batch.module.css` `question`/`stack` classes,
  shared `Button`, `Banner` and `Skeleton`; no new colours, fonts, radii, shadows, icons, theme code or sample
  values. One write action per view (soft button), disabled while a press runs or when nothing is left to read.
- Page choice is a native checkbox inside its label, so it is keyboard reachable and named by its page words.
- Every page says its own state from the job record (not read, waiting, reading, read with a passage count, or not
  read with the runtime's issues). Text completeness stays "unverified"; passages stay candidates with
  page-and-region citations opening the existing pinned viewer. No room, level, unit or record field is written.
- Refusals (runtime missing, page bound, byte bound, history bound) are said in words or through the shared
  warning banner; none is shown as an empty reading.
- Browser focus, 200 % zoom and screenshots were not run; unit rendering is not a visual-runtime claim.

Rules: [principles/content/accessibility](../../design-system/README.md),
[component anatomy](../../design-system/components.md).

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging`: exit 0, no candidates
(0 added lines in `apps/web`).
