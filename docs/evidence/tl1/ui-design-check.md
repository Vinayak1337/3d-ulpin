# TL1 — UI design check

## Blocking

None.

## Design system

None in the changed Studio component. The mechanical scanner covers `apps/web` only, so the Studio diff was also
read directly.

## Checked, no issue

- `apps/studio/src/features/intake/table/TableImportDialog.tsx:19`: the destination comes only from the server's
  409 details. Case and source IDs must be UUID-shaped, and the table ID must equal the source ID. Missing or
  malformed details retain the original refusal.
- `apps/studio/src/features/intake/table/TableImportDialog.tsx:79`: the existing warning banner and stack classes
  are reused. No new colours, fonts, styles, icons or primary action. Words are sentence case and say what happened
  and what to open ([content rules](../../../design-system/README.md#content-rules)).
- `apps/studio/src/features/intake/table/TableImportDialog.tsx:81`: a labelled router link uses the existing
  `tablePath` helper. It is keyboard reachable, inherits the existing link/focus styles and makes no upload or
  table-read request. The existing dialog focus management is unchanged
  ([accessibility](../../../design-system/README.md#accessibility)).
- Rendered-dialog regressions cover the link's exact destination, a 409 without details, malformed details and an
  unfinished read. The unfinished read keeps today's words rather than linking to a table page that is not ready.

Browser appearance, keyboard traversal and 200% zoom were not exercised: this task is offline only, with no running
Studio or API. No visual qualification is claimed.

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs 6323b054` — exit 0; no candidates.
