# LA5 UI design check

Base `staging` (f56303d9). Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging`, exit 0, no
candidates (0 added lines in apps/web). Manual read of the changed Studio file `areaWindow.ts`:

## Blocking
None.

## Design system
None. No component, CSS or token changed; only the words of the status line.

## Checked, no issue
- Every number in the line comes from the reads (drawn count, summary total); none is typed in. Numbers use
  `toLocaleString('en-IN')` as before; the unit (buildings or features) is always shown.
- Sentence case, plain words. The proposal note stays in all three cases.
- The line keeps `role="status"` and its place; nothing new to reach by keyboard.
- Desktop, light only; no theme code.
