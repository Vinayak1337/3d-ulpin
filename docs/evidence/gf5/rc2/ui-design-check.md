# RC2 — ui-design-check

Change: `apps/studio/src/features/review/candidates/` (`model.ts`, `CandidateCardView.tsx`, `ReviewShell.tsx`,
`CandidateReviewPage.tsx`, `CandidateReview.module.css`, `model.test.ts`) against `39ed2dbb`.

## Blocking

None. The level line, the citation's source and place and the stated size are all read from the canonical read;
the Studio formats them and computes nothing. No sample value, no provenance label, no theme code.

## Design system

- The citation control is the evidence chip drawn by the card as its own `button.ul-evid` (same class, same
  `FileText` icon at 16, same `<b>` source and `<span>` place), not `EvidenceChip` from `@ulpin/ui`. Reason: the
  chip names its button by its text alone ("10946c4c p.2 …"), and this control has to say what it opens;
  `packages/ui` is not a path of this task. It should fold back once `EvidenceChip` takes a label. One place draws
  it (`CitationControl`), used by the Citations section and by the stated size.

## Checked, no issue

- Tokens and shape: one new class, `.stated` (`margin`, `font-size: 13px`, `line-height: 19px`,
  `overflow-wrap`), the same numbers as the `.mono` and help lines beside it; no colour, radius or shadow
  literal. Everything else reuses `styles.section`, `ul-row`, `ul-evid`, `ul-unknown` and `DescriptionList`.
- Copy: sentence case ("Stated on the sheet: …", "Not attached to a level", "Level not listed in this record ·
  5a1d717b", "Label unknown"). A level label that is not reviewed carries its state in words in brackets
  ("… (candidate)", "… (source supported)"); it is not a status chip, so the fixed status list is untouched.
- Unknown stays distinct: a room with no level, a level the record does not list and a level with no label are
  drawn with the card's existing `<Unknown>` element (italic, muted), never as a blank, a 0 or a made-up name.
  A card with no stated size prints no stated-size section at all.
- One fact in one place: the stated size is its own section directly above "Estimated size" and is not repeated
  in the estimate, the limitations or the citations; the estimate's words are unchanged.
- Controls: each citation is one `button` with an accessible name of the form "Open cited source 10946c4c at p.2
  · x 443.8, y 1196.9 · 71.3 × 79.8 pt". Tab reaches it and Enter opens the evidence viewer; Escape closes it
  (`keyboard.json`: room 38 Tab presses from the top of the page, roofprint 97; one control per citation). Focus
  ring is the shared `ul-evid` one; nothing new is hover-only.
- The evidence viewer is mounted once for the review (`EvidenceProvider` around the review columns), the same
  entry the workspace and register use; no second viewer or dialog was added.
- Desktop, light only; no responsive or theme code touched.

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs 39ed2dbb` → exit 0 ("Base 39ed2dbb; 0 added
line(s) in apps/web. No candidates."; the scan covers `apps/web` only, so the Studio lines were checked by hand
above and in the browser run recorded in `keyboard.json`).
