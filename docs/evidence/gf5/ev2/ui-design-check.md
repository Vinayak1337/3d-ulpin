# EV2 UI design check

Base: branch merge-base with `staging`; reviewed the full EV2 diff and final captures.

## Blocking

None. No invented source, revision, region or scale; no storing request sent.

## Design system

No change-specific drift found. No new CSS, colour, font, icon set or theme.

## Checked, no issue

- `evidence/citedPage.ts:43`: support and scale come from the listing. Missing or misplaced scale is refused.
  The reduced statement has units and no derived percentage or text-specific judgement.
- `evidence/CitedPageViewer.tsx:93-136`: whole sheet uses the existing point-frame placement and outline.
  The reduced statement and one region action follow it; the server-drawn region follows both with provenance.
  Page-only citations expose no region action. Supported and unsupported states keep their existing meaning.
- `evidence/EvidenceViewer.tsx:170`: an unpinned candidate explains why no page is shown; the original stays openable.
- `review/candidates/CandidateReviewPage.tsx:79` and `model.ts:193`: the existing register read supplies pins.
  The candidate's hash is retained and checked; missing or disagreeing pins never become revision 1.
- `review/candidates/CandidateCardView.tsx:101` and `packages/ui/src/components/EvidenceChip.tsx:30`:
  shared chip anatomy, same visible source/locator/icon/classes, optional button name only.
  Other buttons keep their visible-text name; static chips get no button name.
- Final captures: 1440 × 1000 and 720 × 500 CSS pixels at DPR 2, emulating 200% on the same physical display.
  All 20 dialogs fit horizontally with no horizontal scrolling. Vertical content remains scrollable.
  Tab/Enter opens candidate citations and requests Tower 3's region; Escape closes. Focus remains visible.
  Animations were disabled for final screenshots so the dialog's opening fade cannot obscure text.

Rules: [content and accessibility](../../../design-system/README.md#content-rules),
[component anatomy](../../../design-system/components.md#evidencechip).

Limits: no screen-reader session, contrast-tool measurement or native browser-zoom automation.
The mechanical scan covers legacy `apps/web` only; the Studio and shared chip were reviewed manually.

Command: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` — exit 0, no candidates.
