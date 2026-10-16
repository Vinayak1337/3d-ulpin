# ST1 UI design check

Change: `git diff staging...HEAD -- apps/studio` (base `239ed667`). Files read: `StreamedLayoutAnswer.tsx`,
`LayoutAnswer.tsx`, `LayoutQuestion.tsx`, `QuestionFields.tsx`, `layout-model.ts`, `question-model.ts`,
`streamed-question-model.ts`, `streamed-queries.ts`, `useLayoutCommand.ts`, `layout-command.ts`, `batch-queries.ts`.

## Blocking

None. No invented or sample value is shown: every field name, kind refusal and count on the large-file form is read
from the sealed streamed inventory (`latest.paths`, `latest.geometryTypes`) and the case read; no banned
provenance label; no theme switch.

## Design system

- `streamed-question-model.ts:20-25` — the `failed` and `stale` sentences say what happened but not what to do
  ([Content rules](../../../design-system/README.md#content-rules): "Errors say what happened and what to do").
  In practice the panel is rarely shown in these states: a failed or stale inventory rests the item as
  *Not understood*, which closes the question. The Studio has no control yet for the server's large-item retry
  route, so there is no action to name; smallest fix, if wanted: point to the file's row, which states why it
  stopped. Not changed here (report first).
- `layout-model.ts:44` — a large file's layout review shows `Area: not supplied by the record`, because a streamed
  receipt carries no destination. Accurate, and the existing "not supplied" wording; noted so the lead can
  decide whether the review should name the area the large file drafts into instead.

## Checked, no issue

- Tokens and shape: no CSS added; only the existing `ul-field`, `ul-label`, `ul-input`, `ul-help`, `ul-heading`
  classes, `Batch.module.css` `stack` / `fieldset`, and `@ulpin/ui` `Banner`, `Button`, `Skeleton`.
- One primary button per view: the large form has the one shared **Use this layout** button (`AnswerForm`).
- Copy: sentence case, plain words. The height sentence states the absence ("A height is not stated for large files
  yet; heights stay unknown."), never 0 or a blank. Inventory status sentences are explanations, not status
  chips, so the fixed status word list does not apply.
- Unknown kept distinct: no height operation and the review line reads `Height: not stated`.
- Keyboard and labels: native `select` elements with visible labels and `aria-label`, the shared `fieldset` with a
  visually hidden legend, refusals in `role="alert"`; the fieldset disables while sending. Nothing is icon-only.
- Zoom and layout: no fixed widths or new layout; the panel reuses the small file's stacked form.
- Desktop, light only: no theme or mobile variant added.
- Field names in select options are plain text, as on the small-file form (options cannot carry mono styling).

## Scan

`node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` — exit 0, "0 added line(s) in apps/web. No
candidates." The script covers `apps/web` only, so its six patterns (literal colour, literal font, icon set,
placeholder content, provenance label, theme switch) were also run over the added non-test lines of
`apps/studio/src/features/intake`: no candidates.
