# UP1 — UI design check

## Blocking

None found in the changed Studio components. No invented record values, provenance labels, theme or model claims.

## Design system

No new tokens, CSS, colours, icons, borders or shadows. The changes reuse `Dialog`, `DataTable`, `Button`, `Banner`
and the existing batch layout. No design-system edits are requested.

## Checked, no issue

- `IntakeDropDialog.tsx:37–43`: names the forecast as an estimate from name/size, distinguishes reading from
  placement/recording, and leaves the retention action independent of reader eligibility.
- `IntakeDropDialog.tsx:51–66`: reader ceilings have units; upload counts use Indian digit grouping and bytes.
- `BatchUploadProgress.tsx:51–65`: unfinished files stay visible with retry/cancel buttons. Enrolled rows leave
  this progress area instead of duplicating the tray. Buttons retain shared keyboard/focus styling.
- `BatchUploadProgress.tsx:38–42`: the live announcement changes at file boundaries, not for every byte update.
- No inspector, primary action, theme variant or display geometry was added. Unknown file kinds stay unknown.

This is a source/DOM review, not a browser contrast, keyboard or 200% zoom qualification. Those browser checks and
live transport/frame-time measurement remain for the authorized rehearsal.

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` — exit 0, no candidates.
The scanner covers `apps/web` only (zero added lines there); the Studio review above was manual.
