# ST2 UI design check

Change: `git diff 133e0f18 -- apps/studio`. Files read: `StoppedRetry.tsx`, `IntakeTray.tsx`, `BatchPage.tsx`,
`retry-command.ts`.

## Blocking

None. Every word shown is either fixed copy or read from a record: the reason is the item's own `limitReason`
(unchanged column), the retry count is the route's `retry`, a refusal is the server's message. No sample value.

## Design system

None. The button is the existing `Button` `variant="soft"`, like "View layout" in the same cell, so the page keeps
one primary button. The status and alert lines are plain `p` with `role`, and the help line uses `ul-help`, as in
`LayoutQuestion.tsx`. No CSS, tokens or new components.

## Checked, no issue

- Keyboard: a native button in the tray's table; focus style from `@ulpin/ui`.
- The accessible name is "Try again: <file name>", which starts with the visible words (label in name), so rows
  with several stopped files can be told apart by a screen reader.
- While a request is out the button is disabled and reads "Trying again…"; an unknown outcome reads "Send same
  retry again" with a help line, matching the layout approval's wording.
- Sentence case throughout; no status word outside the fixed list is introduced.

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs origin/staging`, exit 0 (the scan reads `apps/web` only).
