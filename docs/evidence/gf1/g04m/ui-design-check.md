# UI design check: G04M

Change: `git diff ecbf8b93` under `apps/studio/src/features/map/` (`MapWorkspace.tsx`, `inspector/BuildingInspector.tsx`,
`inspector/BuildingCard.tsx`, `inspector/cardState.ts`, `inspector/Inspector.module.css`) and
`apps/studio/src/features/intake/run/` (`api.ts`, `model.ts`, `useConfirmationCommand.ts`). A building picked on the
area map shows a "Property card" section in the inspector's overview when an intake target names it.

## Blocking

None.

## Design system

None.

## Checked, no issue

- Values from records (AGENTS.md data rules): every line is read from the target the by-feature read returns
  (readiness, reason, locator, stage, artefacts, caseId) or is a fixed sentence of the batch page
  (`cardsOnlyWords`, `readinessLabels`, `readinessWords`, `stageWords`, the acknowledgement help). No sample content,
  nothing from the mockups. A building no target names shows nothing (`BuildingCard.tsx:29`).
- One primary button per view ([README Composition](../../../design-system/README.md)): "Make the property card" and
  "Open the property card" are secondary buttons (`BuildingCard.tsx:52`, `:79`); the inspector footer keeps its one
  primary action. The dialog's close is a ghost button, as in `UnitCardDialog`.
- Tokens and shape: the new CSS uses `--ui-*` tokens only; the textarea copies the batch page's field
  (`Run.module.css` `.field`): border, `--ui-radius-8`, plain surface, no shadow, no tinted fill. The section is
  set off by the inspector's own `--ui-divider` rule.
- Status words: the readiness label is the batch page's fixed label in a sentence, not a new pill. Sentence case.
  Nothing claims ownership, a right or issuance; the dialog repeats that a card proves what the record cites only.
- Keyboard and focus: native textarea, buttons and `Link`, reached by Tab, with the global 2 px `:focus-visible`
  outline (`packages/ui/src/styles/base.css:17`). The textarea has a visible label and `aria-describedby` help; an
  error is `role="alert"`; the run's progress line is `role="status"`. The dialog is the shared `Dialog` (focus
  trap, Escape, focus returned to the opener).
- One inspector per selection: the section sits inside the existing `BuildingInspector` overview; the dialog opens
  over the map only when the officer asks or when the card this inspector watched being made is made.
- Desktop, light only: no theme or responsive code touched. Text wraps inside the panel at 200 % zoom
  (`overflow-wrap: anywhere` on the section's paragraphs).

## Scan

`node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs ecbf8b93`: exit 0, "0 added line(s) in apps/web.
No candidates." The scan reads `apps/web` only; the Studio lines above were checked by hand against the rules.
