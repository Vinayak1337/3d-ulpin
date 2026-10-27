# RC1 — ui-design-check

Change: `apps/studio/src/features/review/candidates/` (`model.ts`, `CandidateCardView.tsx`, `model.test.ts`)
against `e9dcebde`.

## Blocking

None. Every number on the card is read from `planEstimate` in the canonical read; the Studio formats it to one
decimal and computes nothing. No sample value, no provenance label, no theme code.

## Design system

None found.

## Checked, no issue

- Tokens and shape: no new CSS. The section reuses `styles.section`, `styles.sectionTitle`, `DescriptionList` and
  `ul-help`, as the Limitations and Citations sections of the same card do.
- Copy: sentence case ("Estimated size", "Bounding extent", "Area"). Units shown (`m`, `m²`). The word
  "estimated" qualifies a value; it is not used as a status chip, so the fixed status list is untouched.
- Unknown stays distinct: `state: 'unknown'` prints the existing `<Unknown />` element for both facts, never 0 or a
  blank. A read without `planEstimate` (the demo's `18b5e74c`) prints no section at all.
- One fact in one place: the estimate's basis is the fixed sentence once; the candidate's own limitations and
  citations stay in their sections and are not repeated.
- No new controls, so keyboard order, focus and labels are unchanged; the section has an `aria-label`.
- Desktop, light only; no responsive or theme code touched.

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs e9dcebde` → exit 0 ("0 added line(s) in
apps/web. No candidates."; the scan covers `apps/web` only, so the Studio lines were checked by hand above).
