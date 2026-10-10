# UI design check: F3d (cards from the registry, card verification page, draft notice)

Change checked: `task/f3d-cards-from-backend` against its branch point `83965a21` (the Studio files under
`features/review/recorded`, `features/identity`, `features/verify`, the two `CardDialog` call sites, `api/queries.ts`,
`app/router.tsx`). Screens were read in the code and in the screenshots beside this file, taken at 1440 px and at
200% zoom.

The scan script reads only `apps/web`, so it saw no line of this change. Its six patterns were also run by `grep`
over the 884 lines this change adds under `apps/studio`: no match.

## Blocking

None.

## Design system

1. **Status words outside the fixed list.** `features/review/recorded/cards.ts:29-35` (Revoked, Inconsistent,
   Expired, Valid until, Expiry not reported), `features/verify/verification.ts:58-65` (Not consistent, Superseded by
   a later revision, Consistent; also Passed, Failed, Not checked for a check) and `features/identity/localChain.ts`
   (Local chain consistent, broken, not checked). Rule: fixed status words,
   [Content rules](../../../design-system/README.md#content-rules). The F3d task file sets these words and each one
   names a state the server reports, for which the list has no word. Smallest fix: the design system adds the card
   lifecycle and verification words; no code change. Left for the lead to decide.
2. **Status without an icon.** `features/review/recorded/ListedCards.tsx:29`,
   `features/verify/CardVerificationPage.tsx:62` and `features/verify/VerifyPage.tsx:87` pass `icon={null}` to
   `Badge`. Rule: status text always with an icon and a
   word, [Visual foundations](../../../design-system/README.md#visual-foundations). The Studio already does this in
   twelve other places. Smallest fix: drop `icon={null}` at the three lines.
3. **Identifier not copyable.** `features/verify/CardVerificationPage.tsx:87` shows the card id in mono without a copy
   control. Rule: identifiers in mono and copyable, [Content rules](../../../design-system/README.md#content-rules).
   Smallest fix: show it with the `ul-code` copy control that `review/recorded/AssignedCode.tsx` uses.
4. **One fact stated twice on the draft card dialog.** `features/identity/CardDialog.tsx:14,63`: the notice above
   the card and the card's first row both say it is a draft on this device. Rule: no fact repeated on one screen,
   [Principles](../../../design-system/README.md#principles). Kept on purpose: printing isolates the card, so the
   notice does not reach the paper and the row does. Smallest fix: a print-only row, which needs a rule in
   `packages/ui` (read-only for this task).
5. **Literal sizes that were already there.** `features/verify/VerifyPage.module.css:11` (`font-size: 15px`, moved
   from `.danger` to `.small`, value unchanged) and `features/identity/CardDialog.tsx:52` (`gap: 24`, unchanged; the
   margin this change adds beside it uses `--ui-space-4`). Rule: `--ui-*` tokens only. Smallest fix: the matching
   text and space tokens; not done here because neither value is new.

## Checked, no issue

- Tokens: the new rules in `Recorded.module.css` and `VerifyPage.module.css` use `--ui-space-*`, `--ui-text-sm` and
  `--ui-font-sans`; no literal colour or font; no new radius, border, shadow or tinted fill.
- Components: `Banner`, `Badge`, `DataTable`, `DescriptionList`, `Dialog`, `Panel` and `Skeleton` from `@ulpin/ui`
  as they are; the verification page reuses the header and result banner of the existing verify page.
- Every value on screen is read from a response: revision, issue time, expiry, check states, reason codes, the
  snapshot time. The one fixed sentence (no official ULPIN issuance) is the card PDF's own, from the R3 evidence.
  Nothing is copied from the mockups.
- Unknown stays distinct: a missing issue time shows *Not reported*, a missing expiry *Unknown* or
  "Expiry not reported"; neither becomes a date, 0 or a blank. A refused read is a warning with the server's code,
  not an empty list.
- Times go through `formatDateTime`; no countdown. Sentence case throughout.
- One primary button per view: the card rows use default buttons; the register page keeps its one primary button.
- Light mode only; no theme code; no mobile variant added.
- Keyboard: every action is a link or a button in tab order; the links in a card row carry the revision in their
  accessible name; no icon-only control is added. Focus ring measured 2 px on "Open card PDF" at 200% zoom.
- 200% zoom (720 CSS px): no horizontal page scroll on the recorded unit or the verification page (0 px overflow);
  the card table scrolls inside its unit if it ever needs to.

## Scan

`node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs` (base `83965a21078f`): "0 added line(s) in
apps/web. No candidates." Exit 0.
