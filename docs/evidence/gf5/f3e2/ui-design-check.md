# UI design check: F3e2 (review and assign a code, issue a card, the inspector without browser drafts)

Change checked: `task/f3e2-assign-and-issue` against its branch point `9138678c` (26 files under `apps/studio`,
1,723 added lines). Screens were read in the code and in the screenshots beside this file, taken at 1440 x 900 and
at 200% zoom (720 x 450 CSS px, device scale 2). Every storing step in them is mocked; the files say so by name.

The scan script reads only `apps/web`, so it saw no line of this change. Its six patterns were also run by `grep`
over the added lines under `apps/studio`: one match, the word "placeholder" in a code comment
(`features/identity/UnitDecided.tsx`), which is not content.

Three findings of this check were fixed before this report, each in its own commit: the expiry was printed twice
after `Prepare` (`8b16e4a3`), the inspector drew an empty action bar for a space with no action (`a3338518`), and
the dialogs' stylesheet named 12 px and 15 px where tokens exist (`8f74a09a`).

## Blocking

None.

## Design system

1. **Ids the registry answers are mono and small, not copyable.** The binding, the plan id, the packet id and its
   sha256 (`features/identity/IssueParts.tsx:57-68`), and the review id and snapshot id of the review dialog, are
   printed as text. The task asks for "mono, small"; the rule is "identifiers in mono and copyable",
   [Content rules](../../../design-system/README.md#content-rules). Smallest fix:
   `features/identity/CopyableId.tsx` for the plan id and the packet id. Not done: it adds two more stops to a
   dialog whose point is one decision; a lead choice.
2. **The space inspector holds two actions for a unit with a listed card.** `Property Card` and the link
   `Open recorded unit` stack in the 320 px panel at 200% zoom and leave the rows 84 px of the 197 px the
   inspector gets (`live-31-zoom-200-inspector.png`; `browser-result.json`, `zoomInspector`). F3g measured 132 px
   with one action. Both actions are whole and every row is reached by scrolling; the building inspector has the
   same two-action footer and the same 84 px (F3g, finding 2). Smallest fix: print the link as a text link in the
   note above the actions when a card is listed. Not done here: the lead left the short-window layout of the
   inspector open.
3. **The browser's own words follow the unknown-outcome sentence.** After a lost answer the dialogs print "The
   result is unknown: no answer says whether the registry stored anything. Failed to fetch"
   (`mocked-05-assignment-unknown.png`, `mocked-16-prepare-unknown.png`, `mocked-19-card-unknown.png`). The last
   three words are the browser's, as `features/review/candidates/commands.ts` hands them on for every failed
   command. Smallest fix: leave them out when there is no server answer (`features/identity/outcome.ts:62`).
4. **Literal sizes without a token.** `features/identity/Registry.module.css` keeps `gap: 6px`, `min-height: 96px`
   and `max-width: 280px`; the same numbers stand in `features/review/candidates/CandidateReview.module.css:147`
   and `features/map/inspector/Inspector.module.css:18`. No token exists for them.
5. **Outside this change: the area switcher on the record page.** Opened by its address, the record page of
   Tower 3 shows "RAMP Karnataka imagery …" in the frame (`mocked-13-issue-form.png`); after a visit to the map
   it shows the area of the building (`live-28-arrival-at-recorded-unit.png`). `app/Frame.tsx`, not changed here.

## Checked, no issue

- Tokens: no literal colour or font family added; radii, borders and spacing of the new stylesheet are `--ui-*`
  tokens apart from finding 4.
- Components: both dialogs are the shared `Dialog` with `DescriptionList`, `Banner`, `Button` and the `ul-label`,
  `ul-help`, `ul-error` classes; a refused field carries `aria-invalid` and names its sentence by
  `aria-describedby`, and the refused expiry is announced (`role="alert"`).
- Status words: the inspector's header uses `StatusBadge` with Assigned, Reviewed, Needs review or Draft, read
  from the canonical record and the ledger (`live-27-inspector-recorded-unit.png`,
  `mocked-29-inspector-unit-without-code.png`). The preview's `mode` is printed in mono as answered.
- Values from records: what is decided (unit, floor, citation, record revision, code) is read from the canonical
  record and the register; the rows of the card are the preview's rows in the answered order, with the state and
  the reason code of a row that is not available under its value (`mocked-17-prepared-rows.png`). Both inputs
  open empty.
- Distinct states: no code reads "No code assigned"; a refusal (red, with the server's code) and an unknown
  outcome (amber, with `Read the record again`) are told apart (`mocked-03`, `mocked-05`, `mocked-08`,
  `mocked-16`, `mocked-18`, `mocked-19`); an entry that cannot be included is shown with its reason code and
  `Prepare` stops (`mocked-15-entry-not-includable.png`).
- One primary action per view: each dialog step has one (`Record review`, `Assign code`, `Prepare`, then
  `Issue card` or `Issue new revision`); the unit block has `Review and assign code`; the inspector has
  `Property Card`, and the link is the primary only when no card is listed.
- No fact twice: after `Prepare` the expiry is stated once, with the rows (`mocked-17`, `mocked-23`).
- Keyboard: Enter on the action opens each dialog and the first field takes the focus; Tab goes field, Cancel,
  primary action and round again, never out of the dialog; Escape closes and the focus returns to the action
  (`browser-result.json`, `keyboard`). The link of the inspector lands on the unit block, which takes the focus.
- 200% zoom: in both dialogs the body scrolls, every footer control lies whole inside the dialog and nothing
  widens it (0 px) (`mocked-10`, `mocked-11`, `mocked-25`, `mocked-26`; `browser-result.json`, `zoomReview`,
  `zoomIssue`).
- Light mode only; no theme code; no mobile variant added.

Not seen in a browser: the inspector of a space the registry lists no recorded unit for (its note, and no action
bar). The demo holds no such space.

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs 9138678c` → "0 added line(s) in apps/web. No
candidates.", exit 0.
