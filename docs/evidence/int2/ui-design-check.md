# INT2 UI design check

## Blocking
None in the merged Studio changes.

## Design system
None in the changed lines.

## Checked, no issue
- `apps/studio/src/features/intake/retain-batch.ts`: only 413/422 refusals switch to uploads.
  Original refusal words remain in the existing Reason row. No DOM, CSS or focus behavior changes.
- `apps/studio/src/features/intake/BatchTableSection.tsx`: TSV uses the existing table route;
  reading words come from the returned profile and use the existing section and link.
- `apps/studio/src/features/intake/table/SourceHeader.tsx`: the existing caption names only returned
  delimiter/encoding metadata. Older profiles produce no invented reading claim.
- Existing layout classes, keyboard controls and record-derived values remain unchanged.
- Static-render and transport tests pass in the full Studio suite: 611 passed, two existing skips.

Rules: [design system](../../design-system/README.md), content, composition and accessibility.
Command: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs e9c12699` — exit 0.
The mechanical scanner covers `apps/web`, not Studio. Studio findings above are source review and
static-render checks. No browser, screenshot or 200% zoom qualification is claimed.
