# CSV2 UI design check

## Blocking
None.

## Design system
None in the changed panel lines.

## Checked, no issue
- `apps/studio/src/features/intake/table/SourceHeader.tsx`: reading metadata stays in the existing wrapping caption row. Words come from the returned profile; older responses add no inferred claim.
- `apps/studio/src/features/intake/BatchTableSection.tsx`: the existing table section names the returned reading and offers the existing table route for TSV cards. No extra panel or primary action.
- No colours, fonts, icons, focus styles, geometry or record values were added. Existing keyboard controls and layout classes are unchanged.
- Static-render tests check semicolons/Windows-1252 wording, the other supported readings, and omission for older responses.
- Rules: [content and composition](../../design-system/README.md). Browser screenshots and 200% zoom were not run: this task is code-only.

Mechanical scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` — exit 0, no candidates. The scanner covers `apps/web`, so the Studio checks above are manual source review and static-render tests, not a claimed Studio visual scan.
