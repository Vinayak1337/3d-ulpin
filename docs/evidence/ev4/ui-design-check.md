# UI design check — EV4

## Blocking
None found in the changed UI code.

## Design system
None found. The new copy explains the unavailable source in a sentence; it does not introduce a status badge.

## Checked, no issue
- `apps/studio/src/features/intake/evidence/EvidenceRead.tsx:42`: displays the server's reason, retaining coverage
  and unknown-count words. No sample values, CSS, icons, colours or fonts added.
- `apps/studio/src/features/intake/evidence/ConfirmEvidence.tsx:163`: unavailable files have no inclusion/exclusion
  or accept controls. Retained files keep their controls. A disabled confirmation has a visible explanation because
  the unchanged server requires every coverage item to be named with retained pins.
- Existing fieldsets, labels, shared buttons and wrapping layout are reused. No new focus or zoom behaviour was
  introduced. Browser keyboard/200% zoom checks were not run under the code-only scope; rendered markup is tested.
- Rules: [content and unknown values](../../design-system/README.md#content-rules),
  [accessibility](../../design-system/README.md#accessibility).

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` — exit 0, no candidates.
This scan covers only `apps/web`; the changed Studio components were reviewed manually.
