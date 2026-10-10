# F3i UI design check

## Blocking

None in the changed UI. No browser draft reaches a served-registry dialog, no identifier is composed,
and the revision rows come from the actual preview read. No storing button was clicked.

## Design system

No new drift found. `UnitCardDialog.tsx:15-37,40-70` reuses the existing Dialog, Button, Skeleton,
ListedCards and IssueCardDialog. No new CSS, colours, fonts, icons, borders or shadows.
The empty answer is one sentence with the existing issue action only for an assigned canonical unit;
the unanswered view is one sentence with Close and no card or issue action.
These follow [content and states](../../../design-system/README.md#content-rules) and the existing
[component anatomy](../../../design-system/components.md#button).

## Checked, no issue

- `registryCard.ts:77-84`: served listed/none/unanswered cannot return draft. A failed refresh with a
  cached listing returns unanswered too. Not-served draft/closed decisions retain the prior behaviour.
- `UnitCardDialog.tsx:18-28`: the issue action reads the unit and floor from canonical recordedFloors;
  it never takes the browser code as registry truth. It opens the existing issue flow, unchanged.
- `prepare.ts:71` and `queries.ts:382-385`: the card read carries cardId and revision only; strict
  request parsing gates the screenshot mock. No form words or revision choices were redesigned.
- `mocked-1440-prepared.png`, `mocked-200pct-prepared.png` and corresponding `-rows.png`:
  preview revision and facts come from the actual read; unknown measurements and unassessed rights
  remain distinct. The archived R3 card read is explicitly labelled mocked.
- Keyboard: Enter opens the revision dialog, Prepare is reachable, Escape closes. Both footer
  controls are whole at 1440 and 200% (720 × 450 CSS px at device scale 2); body overflow is 0 px.
  Long rows scroll inside the existing dialog. No shared focus or contrast styles changed.
- Only the revision path was seen in a browser here; the five Part 2 decisions are pure-function
  tests plus component source review. No screen-reader or full contrast qualification is claimed.

The draft-related consumers outside this task are reported, not changed, in `step0.json`.
The old Register button gate can still prevent opening a no-card dialog without a browser code;
changing that gate is outside this task's owned paths.

## Scans

- `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` — exit 0.
  The standard scanner covers apps/web only, so its empty result alone does not qualify Studio.
- `node docs/evidence/gf-ai/ui/f2c/scan-studio.mjs staging` — exit 0; no candidates.

Manual review applied the same design rules to the changed Studio files. No follow-up design edit requested.
