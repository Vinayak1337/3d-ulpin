# EN1 UI design check

## Blocking
None found in the changed Studio components.

## Design system
None found by source review. No CSS, colours, icons, fonts, theme or layout tokens were added.

## Checked, no issue
- `apps/studio/src/features/intake/table/SourceHeader.tsx:7`: the fallback is named plainly, with the risk of wrong
  labels and the unchanged original. Older readings say the encoding choice basis is Unknown; no publisher
  encoding is invented. [Content rules](../../design-system/README.md#content-rules).
- `apps/studio/src/features/intake/table/TableImportFields.tsx:51`: native labelled select, five supported choices,
  explicit BOM requirement and unsupported-encoding words. Existing input and field classes retain keyboard focus
  styling. [Accessibility](../../design-system/README.md#accessibility).
- `apps/studio/src/features/intake/table/RereadTable.tsx:57`: secondary action inside a native disclosure, disabled
  while pending or without a choice; existing refusal component and status announcement. No extra primary action
  or inspector. [Composition](../../design-system/README.md#building-in-the-design-language).
- `apps/studio/src/features/intake/table/TablePage.tsx:51`: the shared table page supplies the re-read for standalone
  and batch tables; no new original or parallel service.

Offline qualification only: the earlier full Studio intake set passed 269 tests. The final rerun hit host memory
and subprocess startup failures; its single-process comparison remained incomplete. Browser keyboard traversal
and 200% zoom were not witnessed. Re-run the Studio set on a healthy host, then rehearse the combined build.

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs d51f5c7f` — exit 0.
The mechanical scan covers `apps/web` only (zero added lines); changed Studio files were reviewed manually above.
