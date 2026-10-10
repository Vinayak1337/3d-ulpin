# F2c UI design check

Scope: `apps/studio/src/features/review/candidates/`, against `staging` (`db8c014d`).
Reviewed the changed components, existing shared dialog, state chips and ten 1440×900 captures.

## Blocking

None. No invented operational data, copied mockup values, new provenance labels or theme switching.

## Design system

No new drift in the changed controls. Existing tokens, buttons, light surfaces and reason dialog are reused.

Existing limitation outside this slice: `apps/studio/src/app/Frame.module.css:19` keeps a 200 px search minimum,
with non-wrapping navigation and area controls. At the 200% equivalent viewport, the header scroll width is
1078 CSS px for a 720 CSS px viewport; the candidate canvas also becomes narrow.
The new Reject control and dialog remain visible and usable. Recommend a separate header/review reflow task,
not a broad layout change here ([accessibility](../../../../design-system/README.md#accessibility)).

## Checked, no issue

- `DecisionSheet.tsx:33`: each success branch is one sentence, uses Recorded/Draft wording, and does not imply
  registry admission ([content rules](../../../../design-system/README.md#content-rules)).
- `RoomDecisions.tsx:63`: one primary action, secondary Reject, the existing required-reason dialog, and the
  server's message through `refusalOf`; no second dialog or error component.
- `model.ts:95`, `RoofprintDecisions.tsx:30`, `RoomDecisions.tsx:57`: recorded reviews hide all candidate decision
  controls; rejected records retain a neutral Rejected outcome chip, never an accepted Reviewed chip.
- `CandidateCardView.tsx:85` and `HistoryPanel.tsx:17`: outcome, reason, actor and IST time come from records.
- Keyboard: Enter opens Reject, Tab wraps within the shared dialog, Escape cancels and returns focus to Reject.
  Focus remains visible. Zoom-equivalent 200% checked at 720×450 CSS px with device scale 2; no write submitted.
- Screens 04, 05, 07 and 08 carry visible Intercepted labels; the live Magnolia canonical record is unchanged.
  Its three reviewed level labels were read live. Candidate geometry and placement remain explicitly limited.

## Mechanical scan

`node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` — exit 0, but the existing skill scans
only `apps/web` (zero changed lines there). Re-ran the same scanner in memory with its root set to the current
worktree and `apps/web` replaced by `apps/studio`. The protected skill was not edited.
`node docs/evidence/gf-ai/ui/f2c/scan-studio.mjs staging` — exit 0, 174 added lines, no candidates.
