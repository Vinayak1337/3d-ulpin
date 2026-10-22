# TS2 UI design check

Base: `staging`. Changed UI: `apps/studio/src/features/intake/IntakeTray.tsx`.

## Blocking

None.

## Design system

No new drift found in the changed lines.

## Checked, no issue

- `IntakeTray.tsx:59-60`: “Open the table” occupies the existing Next step cell; no columns or CSS change.
  It reuses the soft shared Button, not another primary action.
  [Content rules and composition](../../design-system/README.md#content-rules).
- `IntakeTray.tsx:59-60`: a native `button type="button"` with a filename-specific accessible name calls
  `choose(item)`. Native keyboard activation remains available; there is no custom key handler or tabindex.
  The shared stylesheet supplies the existing 2 px focus outline and 3 px offset.
  [Focus and accessibility](../../design-system/README.md#accessibility).
- Table eligibility comes from `itemTableSource`, the same helper used by the detail section, including
  workbook-parent sources. No filename-based format guess, new displayed record value or status word is added.
- The page still selects one detail. The actual table section renders in the regression tests, not a stand-in.
  CSV/XLSX opening exposes “Read as a table” but sends no requests. Workbook header rows remain unanswered.
- Existing tray horizontal scrolling and token-based styles are unchanged. No literal colours, fonts, icons,
  sample screen values or alternate theme were added.

Limits: source/component review only; no browser screenshot, keyboard traversal or 200% zoom run.
The mechanical scanner covers `apps/web`, not Studio; its empty result is not Studio visual qualification.

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` — exit 0, no candidates.
