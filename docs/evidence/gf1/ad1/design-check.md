# AD1 design check

Change: `git diff staging...HEAD` under `apps/studio` — one new line of words on the area map (`drawnCountNote`) and
the explored building's record replacing its area summary in the scene (`withExploredBuilding`, no visible change).

## Blocking

None.

## Design system

None.

## Checked, no issue

- `apps/studio/src/features/map/MapWorkspace.tsx:163` — the note joins the existing `viewNotes` list and renders in
  the existing `styles.viewNote` span (`MapWorkspace.tsx:505`). No new component, CSS, token, colour, border or
  shadow.
- `apps/studio/src/features/map/footprints.ts:162-169` — the words come from real counts: recorded context features
  (`revision > 0`) and the ids handed to the scene. Nothing is hard-coded; with no recorded feature there is no note.
  A feature not drawn is counted ("1,660 of 1,661 recorded features are drawn."), never hidden.
- Sentence case, one sentence, no status word outside the fixed list, no provenance label
  ([content rules](../../../design-system/README.md)).
- Large counts use Indian digit grouping (`en-IN`), as the design system asks for large counts
  ([README.md:41](../../../design-system/README.md)). Below 1,00,000 this matches the screenshots: "All 2,148
  recorded features are drawn."
- The note is hidden while the canonical read is pending, so it never reports a partial count as the area's.
- Desktop, light only; no theme code; keyboard and focus unchanged (the note is text, not a control).
- Seen in the walk screenshots (outside Git): `E:/BhuAayam-data/task-data/ad1/b42f600aed95704f/buildings1661.png`,
  `demoArea2148.png`, `niagara.png`.

## Scan

`node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` — exit 0, "0 added line(s) in apps/web. No
candidates." (the scan reads `apps/web` only; the Studio lines above were checked by hand).
