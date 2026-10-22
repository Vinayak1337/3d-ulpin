# EV2 UI design check

## Blocking
None.

## Design system
None in the task delta.

## Checked, no issue
- `apps/studio/src/features/intake/evidence/EvidenceRead.tsx:37`: the newer-reading notice comes from the API state,
  explains the officer action, and disappears after current confirmation. Existing `ul-help` styling; no new control.
- `apps/studio/src/features/intake/evidence/EvidenceByKey.tsx:70` and `confirm-model.ts:68`: locally remembered
  confirmations retain reading pins, so a newer reading is not hidden by an old candidate id. Nothing is confirmed
  or selected automatically.
- `confirm-model.ts:246`: recorded packages name their accepted review revision; the server still checks it.
  No new registry write action or bypass.
- Checked `docs/design-system/README.md` content rules, states and accessibility: sentence case, actionable words,
  no invented record content, unchanged keyboard controls and focus styling. Existing RF1 refresh still clears
  acknowledgement on changed inputs.

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs 70560f89` — exit 0, no candidates.
The scanner covers `apps/web`, not Studio; changed Studio code was reviewed manually.
Offline component tests cover the notice and re-confirmation. Browser keyboard, contrast and 200% zoom screenshots
were not run; no visual qualification is claimed.
