# F3a UI design check

Scope: `apps/studio` changes on `task/f3a-recorded-units` against `staging`, read against
`docs/design-system/README.md` and the screenshots in this folder. Report only; nothing was edited for it.

## Blocking

None found. Every value in the new panel is read from the canonical building response. The populated
screens are intercepted controls and say so on the screenshot; the code shown is marked as a test value.
No number is derived from a label, nothing is drawn in the scene or on the plan, and no write control exists.

## Design system

- **Evidence viewer, not owned (`apps/studio/src/features/evidence/EvidenceViewer.tsx:19`):** the citation
  control opens the existing viewer with the cited source and the page-and-region locator, but against the
  live API the viewer falls back to its file view and prints the start of the PDF bytes (`05`). The
  [evidence rule](../../../../design-system/README.md#principles) wants the exact place in the source.
  Smallest fix, outside this task: read `/sources/{id}/pages` with the citation's `sourceSha256` and
  `sourceRevision`, and add a region locator. The demo runtime also answers 503 for document pages today.
- **Non-blocking, `apps/studio/src/features/intake/table/StaleNotice.tsx:7`:** the warning banner and the
  **Needs review** badge each bring a warning icon (`09`). The badge was asked for; the smallest change would
  be a banner without its own icon, which is a shared component.
- **Non-blocking, `apps/studio/src/features/review/recorded/CitationControls.tsx:14`:** the chip names the
  source by the first 8 characters of its id, as the candidate cards do, because the canonical citation
  carries no file name. It is not a copyable identifier.
- **Inherited, not changed:** at 200% zoom the three review columns above the panel narrow until the centre
  column has no width (`CandidateReview.module.css`, noted in F2c). The new panel sits below them at full
  width for that reason and keeps every label inside it (`06`).

## Checked, no issue

- `Recorded.module.css`, `Table.module.css`: `--ui-*` colour, type, spacing and radius tokens only; the unit
  block is a tinted fill without a border or shadow; no new theme, radius or icon set.
- `RecordedPanel.tsx`, `RecordedFloorItem.tsx`, `RecordedUnitItem.tsx`: status word **Reviewed** only where
  `recordState` is `reviewed`; heights, kind and area show the record's state as a word (Unknown) in the
  shared `ul-unknown` style, never 0 or blank; the gap sentence is the server's, shown once; the empty state
  is one plain sentence.
- `AssignedCode.tsx`: the exact code string in mono with a labelled copy button; no segment is given a
  meaning and the word ULPIN does not appear in the panel.
- `StaleNotice.tsx`, `RecipeReview.tsx`, `AnswerForm.tsx`: one notice built from the response, **Needs review**
  from the fixed vocabulary; Approve and the shared-reason control are absent for a stale result and the
  tables stay readable. `ColumnsTable.tsx`: the question badge reads **Needs review**.
- `SharedUnknown.tsx`, `RecipeConfirmation.tsx`: one labelled reason box, a count that reads correctly for
  one column, and no second primary action beside **Record the mapping**.
- Keyboard and zoom: the citation chips, copy button and form controls are buttons or fields in tab order;
  the chip shows a 2 px focus ring after keyboard focus at CSS 200% zoom. This is not a screen-reader or
  browser-native zoom certification.
- Screenshots opened: `02`, `03`, `04`, `05`, `06`, `07`, `09`.

Mechanical scan (the skill's script covers frozen `apps/web`; the F2c adaptation covers Studio):

- `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` — exit **0**, no candidates.
- `node docs/evidence/gf-ai/ui/f2c/scan-studio.mjs staging` — exit **0**, 746 added lines, no candidates.
