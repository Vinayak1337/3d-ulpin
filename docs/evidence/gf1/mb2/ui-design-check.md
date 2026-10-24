# UI design check: MB2

Change: `git diff 7231538c` under `apps/studio/src/features/map/` (`WindowedArea.tsx`, `areaWindow.test.ts`).
The window inspector of a picked proposal says `Proposed in a batch, not yet confirmed.` and, when the window read
names its case, links `Open batch to confirm` to `/studio/work/cases/<caseId>/intake`.

## Blocking

None.

## Design system

None.

## Checked, no issue

- `WindowedArea.tsx:137-143`, values from records: the link is built only from `caseId` as the window read states
  it; with no `caseId` no link is drawn and no route is guessed. No sample content, nothing from the mockups.
- `WindowedArea.tsx:137-143`, one primary button per view
  ([README Composition](../../../design-system/README.md)): the batch link is a plain text link in the body; the
  footer keeps its one primary action, `Open register`, unchanged.
- Status words ([README](../../../design-system/README.md), fixed list): the new line is a sentence, not a status
  pill, and claims nothing official ("not yet confirmed"). Sentence case. The map key keeps
  `Proposed, not yet confirmed` for the same state, so the two read alike.
- Tokens and colour: no new CSS, no literal colour or font. The link takes `--ui-primary` from
  `packages/ui/src/styles/base.css:16` (links are a listed use of the accent).
- Keyboard and focus: a React Router `Link` renders an `<a href>`, reached by Tab, with the global 2 px
  `:focus-visible` outline (`packages/ui/src/styles/base.css:17`). The link text says where it goes.
- One inspector per selection: unchanged; the line sits inside the existing `InspectorShell` body.
- Recorded buildings: the line is drawn only when `displayState` is `unrecorded_proposal`; a recorded building's
  inspector is the same markup as before (test `links a proposal to the batch of its case ...`).
- Desktop, light only: no theme or responsive code touched. Text wraps inside the panel at 200 % zoom.

## Scan

`node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs 7231538c`: exit 0, "0 added line(s) in apps/web.
No candidates." The scan reads `apps/web` only; the Studio lines above were checked by hand against the rules.
