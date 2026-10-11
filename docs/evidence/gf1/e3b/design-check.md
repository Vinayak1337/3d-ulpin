# Panel design check — E3b

## Blocking
None found. The acknowledgement starts empty, receives no suggestion, and is sent verbatim. Counts, package pins,
locators, reasons and links come from the API. No map geometry, ownership or identity claim is added.

## Design system
No unresolved token, shape or colour finding. Shared Panel, Button, CopyableId and the existing card path helpers
are reused. Package and case counts repeat only as the task explicitly requires. One primary confirmation press.
The list has an independently keyboard-reachable scroll region so its bounded page does not bury the confirmation.

Qualification: the targets response supplies finding codes/counts, not finding messages. No shared Studio vocabulary
exists for these area codes; the panel uses short words from the area's existing rules for the seven known codes,
and says words are not supplied for any other code. It does not infer severity. See step0.json.

## Checked, no issue
- `TargetList.tsx:22`: native labelled select and checkboxes; every target remains listed or cursor-reachable.
- `Confirm.tsx:30`: labelled textarea, unique helper id, empty initial words, 500-character server bound.
- `Run.module.css:90`: visible 2 px focus; measured Tab reach for list, ticks and acknowledgement. Three ticks
  were chosen with Space; Tab from the typed acknowledgement reached the press (walk-stream.json).
- Contrast measured from computed foreground/background: body/headings 15.42:1, help 5.60:1, primary 8.75:1.
- Chromium at CSS zoom 2: no horizontal page overflow; screenshot inspected. This is a 200% layout check,
  not a claim about every browser's native zoom. Buttons and copy controls keep their existing names.
- Progress shows stored stopped reasons without requiring expansion; recorded and carded are kept distinct.
- Screenshots: `E:/BhuAayam-data/task-data/e3b/captures/{before-press,zoom-200,first-card,reload,verification}.png`.

`node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` — exit 0;
the stock skill scans apps/web only.
`node docs/evidence/gf1/e3b/scan-panel.mjs staging` — exit 0; same scanner, retargeted in memory to the owned panel.
Manual reading of all panel files supplements the mechanical scan. No protected references or shared skill edited.
