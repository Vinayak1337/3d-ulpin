# LQ1a design check

## Blocking

No invented operational facts, heights, names, units or destinations in the changed product UI.
The live journey is blocked outside the owned UI; see `runtime.json`. Controls are not gate proof.

## Design system

- `BatchPage.tsx`: the prescribed layout approval and one-confirmation panels each have their own primary
  action. Only one selected file has a layout inspector; a sole file opens automatically.
- `LayoutQuestion.tsx` / `layout-model.ts`: stored field names and height meaning are preserved. Missing
  name/height say “not stated”; unavailable origin/destination say “not supplied by the record”. Unrepresented
  plan and destination members are named. Destination pin values are not printed as uncopiable identifiers.
- `Batch.module.css`: existing surface, border and radius tokens retained. Text wraps without shrinking;
  unused question-field grid removed. No new colour, font, shadow or theme.
- `IntakeTray.tsx`: absent reason and absent next action are empty, as the task specifies. Unknown size,
  count and extent remain “Not known”, never zero. Stored reasons remain verbatim.
- Existing shared frame header overflows the document at 200% zoom (also recorded by E3a). It is outside
  owned paths. The layout panel itself has no horizontal overflow: client and scroll width both 670 px.
- The run panel's counts and package details are its existing design. A5 only changes eligibility and the
  required zero-building sentences; no run-panel styling or other behavior was refactored.

## Checked, no issue

- Controlled browser report: `control-qualified.json`, separate from the disposable-stack live walk.
- Tab from “View layout” reaches “Approve layout”; Enter sends approval; visible outline is 2 px.
- 409 displays the prescribed changed-layout sentence and latest revision before another approval.
  Approved and executed layouts have no approval button. No-plan live panel has no authoring action.
- Contrast measured in Chromium: layout metadata 5.60:1, body and textarea 15.42:1, primary action 8.75:1.
- 200% CSS zoom: lines wrap, focus remains visible, approval is reachable by scrolling. The tray retains
  horizontal scrolling rather than crushing names. The mounted confirmation panel remains below it.
- Browser screenshots outside Git are named in `runtime.json`. Manual image review: no clipped layout
  lines or controls inside the owning panel; the shared frame overflow noted above is not hidden.
- Mechanical skill scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging`, exit 0,
  but its original scope is `apps/web` (zero lines). Studio retarget using the same rules:
  `node docs/evidence/gf1/e3a/studio-design-scan.mjs staging`, exit 0, 1,205 added Studio lines, no candidates.
