# F3c UI design check

Scope: `apps/studio/src/features/intake/table` changes on `task/f3c-unanswered-origin` against `staging`, read
against `docs/design-system/README.md` and the screenshots in this folder. Report only.

## Blocking

None found. Every value is read from a response; intercepted states carry the label on the screenshot and the
two live screenshots (`04`, `05`) do not. No write control was added or changed; 0 non-GET requests left the browser.

## Design system

- **Non-blocking, `LearnerPanel.tsx` totals line:** the total of unanswered fields sums the per-chunk counts, as
  the task asks. Every chunk of a layout covers the same columns, so a 16-column table over 3 chunks reads 48
  (`01-unanswered-learner.png`). It is labelled "Unanswered" beside the distinct "open questions" count, which is
  the number to read as columns; whether the sum is the right total is the lead's call.
- **Non-blocking, `LearnerPanel.tsx` old-chunk note:** kept, narrowed to chunks with no unanswered count and no
  teacher call, because for those the stored teacher fields really are fallback columns.
- **Inherited, live:** the TNHB table's field methods are `model:sarvam-105b@…`, not `manual:…`, so its 90 columns
  still read **teacher/memory** and **0 %** (`05`). They are shown as stored; they turn into "No answer" when the
  runtime serves A3e.

- **Non-blocking, fixture:** in `02-mixed-columns.png` four student rows read 0 %. That is the confidence the
  intercepted control stores for them (taken from the F3a control), not a no-answer row; real student rows are
  unchanged by this task. The "Intercepted" label sits over the last visible row's question cell.

## Checked, no issue

- `ColumnsTable.tsx`: From for no answer is the **Needs review** badge (the existing question badge) and
  "No answer · <reason in words>"; Confidence is a dash with visually hidden "No confidence: nobody answered",
  so nothing reads 0 %. A reason code not in the word list is shown as the literal code (`model.test.ts`).
- `LearnerPanel.tsx`: **Unanswered** shows the count, or "Not reported" in the same numeric column, never 0 for a
  chunk without the count; the totals say "Not reported for N of M chunks" beside the sum of the rest. The per-chunk
  needs-input column says what it counts. Open questions are the review's joined list (90 live, not 4,590).
- `Table.module.css` untouched; no new colour, radius, icon or status word. Keyboard order and focus unchanged.
- Screenshots opened: `01-unanswered-columns`, `02-mixed-columns`, `03-old-shape-learner`, `04-live-tnhb-totals`.

Mechanical scans:

- `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` — exit **0**, no candidates.
- `node docs/evidence/gf-ai/ui/f2c/scan-studio.mjs staging` — exit **0**, no candidates.
