# UI design check: CC1 (cards-only confirmation from the batch page)

Change: `apps/studio/src/features/intake/run/{Confirm,IntakeRunPanel}.tsx` against `origin/staging`.

## Blocking

None. Every value on screen is read from a record: the count is the target page's `counts.recorded`, the list is
the target rows' own `locator`, in the stored target order. No sample value, no theme switch, no banned label.

## Design system

None found that needs a change.

## Checked, no issue

- `IntakeRunPanel.tsx` `CardsAction`: the line `<n> recorded buildings have no card yet.` (`role="status"`, as the
  existing chosen-count line) and one default (not primary) button `Make cards for the next 100`; the view keeps one
  primary button, the confirmation's. Shown only once a package of the batch is recorded and buildings are recorded
  without a card. Sentence case. Disabled while another command runs or the batch cannot be read.
- `Confirm.tsx` `CardsList`: states what will be made before anything is pressed (`cardsOnlyWords`), lists the
  buildings as an ordered list in the order their cards are made, identifiers in `ul-id`; focus moves to the
  statement when the list opens, so a keyboard user lands on it; `Back to recording packages` returns to the
  ordinary confirmation and is disabled while a confirmation is being stored or its outcome is unknown.
- The press label reads `Make these cards`; the acknowledgement stays the officer's own typed words; the sentence
  `Recording cannot be undone.` is left out because nothing is recorded; the card caveat (not ownership or a right)
  stays.
- No CSS added: existing `Run.module.css` classes (`stack`, `controls`, `list`, `target`) and their 2 px
  `:focus-visible` rule. Desktop and light only; readable at 200 % zoom as the surrounding panel.

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs origin/staging` exit 0, "No candidates" (the
scan covers `apps/web`; the Studio lines above were read by hand).
