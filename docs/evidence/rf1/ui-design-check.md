# RF1 UI design check

Base: `b1a4bd80`. Scope: Studio intake layout controls and evidence confirmation.

## Blocking

None found.

## Design system

None found in the changed controls. No CSS, colours, fonts, icons, theme controls, geometry or measurement display changed.

## Checked, no issue

- `apps/studio/src/features/intake/evidence/ConfirmEvidence.tsx:79–90`: existing help/stack classes and shared buttons; refresh messages use `role="status"`, failed reads use `role="alert"`. The retry action says what it reads. Confirmation stays the sole primary action; failed reads block submission, not cancellation.
- `apps/studio/src/features/intake/evidence/confirm-refresh.ts`: changed readings name files, candidate keys or building locators. Repeated unchanged batch notifications do not erase the acknowledgement or repeat announcements. A changed reading clears the acknowledgement and requires another officer press. No automatic confirmation.
- `apps/studio/src/features/intake/evidence/confirm-model.ts`: candidate disappearance or changed evidence/building/outcome removes the selection with words; new candidates are not selected. Values come from the current evidence records.
- Layout eligibility changes only whether the existing labelled View layout button is offered. Archive provenance words are unchanged.
- Existing field labels, native keyboard controls, focus tokens, wrapping layout and light-only presentation are retained, following [content, focus and accessibility rules](../../design-system/README.md).

Mechanical scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs b1a4bd80` — exit 0, no candidates. Its implementation scans `apps/web` only; Studio changes were reviewed manually above. Mounted offline form tests exercise disabled confirmation, refresh messages and the explicit second press. Browser keyboard/200% zoom screenshots were not run: this task is offline-only.
