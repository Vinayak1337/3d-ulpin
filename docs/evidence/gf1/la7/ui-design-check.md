# LA7 UI design check

Base `origin/staging` (7a6fded0). Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs origin/staging`,
exit 0, no candidates (0 added lines in apps/web). Manual read of the changed Studio file `areaWindow.ts` and the
scene's `viewFootprint` (no markup):

## Blocking
None.

## Design system
None. No component, CSS or token changed; only the words of the status line while a view is still loading.

## Checked, no issue
- The loading line's count is the features read so far; the total is not shown beside it, so no partial count reads
  as final. Numbers use `toLocaleString('en-IN')` as before; the unit (buildings or features) is always shown.
- Sentence case, plain words. The proposal note follows the count while loading, as in LA5's three final cases.
- The line keeps `role="status"` and its place, so a screen reader hears the change to the final wording; nothing
  new to reach by keyboard.
- Desktop, light only; no theme code.
