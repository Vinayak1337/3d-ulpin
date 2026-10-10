# UI design check: F3h (the recorded panel, a unit's cards across snapshots, the unknown outcome, the inspector)

Change checked: `task/f3h-recorded-panel-and-card-list` against its branch point `d6dbc207` (17 files under
`apps/studio`, 377 added lines). Screens were read in the code and in the screenshots beside this file, taken at
1440 x 900 and at 200% zoom (720 x 450 CSS px, device scale 2). Files named `live-` show the demo's own reads;
files named `mocked-` show answers given in place of the registry and carry a label that says so.

The scan script reads only `apps/web`, so it saw no line of this change. Its six patterns were also run by `grep`
over the added lines under `apps/studio`: no match.

Two findings of this check were fixed before this report, each in its own commit: two cards of one unit could not
be told apart in the list, by eye or by the names of their actions (`319dcd3e`), and the Card column that fixed it
cut the actions of the usual one-card list at 200% zoom, so it is drawn only when the rows belong to more than one
card (`edc86e88`).

## Blocking

None.

## Design system

1. **UNIT-3B still reads "Unknown" for Kind and Area.** The canonical read itself states `unknown` for both
   (`kind.state`, `areaM2.state`), so the panel prints the record's word (`live-01-recorded-floor-and-unit.png`;
   `before.json`). "Not recorded" is printed only where the record states `absent`, seen mocked
   (`mocked-05-no-identifier-and-not-recorded.png`). Nothing to change in the Studio; whether the record should
   say `absent` for a unit recorded from a label alone is the server's decision.
2. **A list of several cards scrolls inside its block at 200% zoom.** With the Card column the table is wider than
   the 720 px window; it scrolls sideways inside the unit and the page keeps its width (0 px overflow), so
   `Verification` is reached by scrolling the table (`mocked-08-zoom-200-cards-and-failed-reads.png`). The
   one-card list has no Card column and is whole (`live-04-zoom-200-cards-across-snapshots.png`). Smallest fix if
   it matters: stack the two actions of a row at narrow widths (`Recorded.module.css`, `.cardActions`).
3. **Copy controls add keyboard stops.** One per recorded floor (the identifier), three in the issue dialog after
   `Prepare` (binding, plan, packet) and three in the assignment dialog (review, snapshot, receipt). The rule is
   "identifiers in mono and copyable", [Content rules](../../../design-system/README.md#content-rules); the cost
   is a longer Tab path to the primary action. The sha256 of the packet stays text: it is a digest, not an id an
   officer pastes into a search.
4. **The inspector's text link is 12 px inside the note.** It takes the note's size and the link colour with an
   underline (`live-13-inspector-card-listed.png`). It is an inline link in a sentence, so the 24 px target rule
   does not apply to it, but it is smaller than the button it replaces. With one action the rows get 132 px of
   the 197 px the inspector has at 200% zoom, where two actions left 84 px (`browser-result.json`,
   `withCardZoomed`; F3e2, finding 2).
5. **"Reading the register…" is printed in the style of an unknown value.** While the register read is on its way
   the Identifier row shows that sentence in the italic of `ul-unknown`, like the two sentences for a failed read
   and a floor the read does not list. It is short-lived; a separate loading style would need a second branch in
   `RecordedFloorItem.tsx`.
6. **Outside this change: the area switcher on the record page.** Opened by its address, the record page of
   Tower 3 names another area in the frame (`mocked-07-cards-of-older-snapshots-and-failed-reads.png`).
   `app/Frame.tsx`; the task file says it is not here.

## Checked, no issue

- Tokens: no literal colour, font family or size added. The one new rule (`Registry.module.css`, `.answered
  :global(.ul-code)`) uses `--ui-space-1`.
- Components: the identifier and the answered ids use `CopyableId`, the Studio's control on the `ul-code` copy
  button of `packages/ui`; the card list stays the shared `DataTable` with `Badge`; the sentences under it are
  `ul-help`. No new component.
- Values from records: the identifier is the register read's `identifier` of the entry whose `id` is the floor's
  `registryFloorId`, printed whole and never composed; Kind and Area are the canonical read's values or its
  states in words; each card row's "Unit in its snapshot" is that row's own `snapshotState`. No value is typed
  into the code.
- Distinct states, none a zero: `absent` reads "Not recorded", `unknown` reads "Unknown", `withheld` and
  `conflicting` read by their own word, a field the read omits reads "Not reported"; a floor the register lists
  no entry for, a register that could not be read and a read on its way each have their own sentence
  (`mocked-05`; tests in `model.test.ts`).
- Nothing dropped silently: failed card reads are counted in one sentence under the list ("2 of 4 snapshots could
  not be read."), and snapshots the listing left out are named in a second (`mocked-07`). With no card listed,
  "No card has been issued for this unit." is said only when every snapshot was read.
- The unknown outcome: the amber banner prints the fixed sentence, alone for no answer and for a 502 without a
  body, with the server's code in brackets for a fault that has one; no browser or status words follow
  (`mocked-09`, `mocked-10`, `mocked-11`). A refusal stays red with the server's code and words.
- One primary action per view: with a card listed the inspector has `Property Card` and the unit link is text;
  with none listed `Open recorded unit` is the one button (`live-13`, `mocked-15`).
- Accessible names: each copy button names what it copies ("Copy binding id …"); the actions of a card row name
  the card and the revision; the Card cell carries the whole id as its title.
- Keyboard: every new control is a native button or link in document order; the copy check pressed the plan's
  button and read the answered plan id back from the clipboard (`browser-result.json`, `ids`).
- 200% zoom: no page is widened (0 px) in any scene; the dialog's footer controls and the inspector's action are
  whole (`browser-result.json`, `*Zoomed`).
- Light mode only; no theme code; no mobile variant added.

Not seen in a browser: a card row whose `snapshotState` is null (prints "Not reported"; covered by a test), a
listing that is truncated or has unreadable snapshots (the second sentence; covered by a test), and a 500 with a
code (covered by the test in `outcome.test.ts`; the screenshot uses the server's 503 `USP_POSTWRITE_MISSING`).

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs d6dbc207` → "Base d6dbc207; 0 added line(s)
in apps/web. No candidates.", exit 0.
