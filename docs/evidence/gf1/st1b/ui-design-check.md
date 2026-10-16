# ST1b UI design check

Change: `git diff 1064fcaf -- apps/studio`. Files read: `StreamedLayoutAnswer.tsx`, `streamed-question-model.ts`,
`layout-model.ts`, `table/types.ts`, `table/recipe-api.ts`.

## Blocking

None. Nothing new is shown on screen. The case revision the plan pins is read from the inventory's status record
(`caseRevision`); no value is hard-coded and no sample is copied.

## Design system

None. The large-file panel loses one loading skeleton and one error banner, both from the source-case read it no
longer makes. It keeps the status read's own skeleton and banner. Words, tokens, components and layout are unchanged.

## Checked, no issue

- One primary button ("Use this layout"); unchanged.
- The failed, stale and still-reading words are unchanged (ST1's report already raised the failed and stale words).
- The table page's recipe history renders the same tabular revisions; only its type narrows, after the existing
  runtime refusal.

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs HEAD`, exit 0 (the scan reads `apps/web` only).
