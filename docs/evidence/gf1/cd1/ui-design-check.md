# CD1 UI design check

## Blocking

None. No invented value, sample content, theme switch or copied reference content. Each original's name and byte
count are read from the dropped file; issuer stays not stated (`provenance.origin: not_stated`).

## Design system

- `AddFilesDialog.tsx`: the Detected column says `Original · batch` for a file kept as an original and `Table` for a
  CSV or XLSX (was `Document or table`). The Mapping action reads `Retain files`, as does the batch dialog title in
  `IntakeDropDialog.tsx`, because the batch now holds files that are not maps. Sentence case, no new status word.
- The drop help sentence now states what happens to every other file: `Every other file is kept unchanged as an
  original in the batch.` (was `other files need a case upload`).
- `Not imported` stays only for a row that failed its check or is still being read; it is never the answer for a
  file's kind.

## Checked, no issue

- No new component, token, CSS, icon or colour; the shared Dialog, DataTable and Button are reused unchanged.
- One primary action per view is unchanged (Continue / Start import; Retain files and open batch).
- The `Keep this page open until the upload finishes.` line now shows whenever any file goes through `/uploads`,
  which since this task includes small non-map originals.
- Keyboard order, focus and zoom are unchanged: no layout or element was added; only words and routing changed.

Skill scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs origin/staging` - exit 0, no candidates
(scans only `apps/web`). Same rules retargeted at `apps/studio`:
`node docs/evidence/gf1/e3a/studio-design-scan.mjs origin/staging` - exit 0, 83 added lines, no candidates.
No browser run (code and tests only for this task).
