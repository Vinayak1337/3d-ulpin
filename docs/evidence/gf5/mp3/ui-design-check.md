# UI design check — MP3

Base: `616f630a` (`staging`). Read the full map/scene diff and the design-system README and map-and-3D rules.
Evidence: `captured-before.json`, `captured-after.json`, `shots/before-*`, `shots/after-*`.

## Blocking

None introduced. MP2's blocking finding is repaired: the unknown-height footprint stays visible over imagery.
Its actual record is **candidate**, not reviewed; its existing ghost treatment and 0.05 m thickness are unchanged.
Ground pictures have no picking handler and cannot establish measurements, rights or registry admission.
See [honest geometry](../../../design-system/README.md#principles) and
[optional context](../../../design-system/map-and-3d.md#base-scene).

## Design system

Inherited, not changed:
- At 200% zoom, the candidate banner/search/attribution occupy much of the small canvas. The footprint outline
  remains visible around these panels at 30, 60 and 120 m. No horizontal page overflow was measured.
- At 500 m, existing scene fog hides both imagery and records (`shots/fog-diagnostic-500.png`). This is not the
  old picture-over-footprint defect. The before capture has the same fog. No camera or fog rule was changed.
- The candidate banner says all 80 candidates are waiting, although the current canonical read includes four
  with decisions. `features/review/candidates/CandidateBanner.tsx:12-18` is EV2's read-only path for this worker.
  Smallest future fix: count undecided candidates for the waiting sentence, using the existing candidate model.
- `UnitCardDialog.tsx:29-32` still falls back to a browser draft when the registry lists no card and a draft code
  exists. The map inspector does not enable a button from that draft. This fallback was explicitly left intact.

## Checked, no issue

- No CSS, colour, font, radius, icon or control added. No mockup values or samples appear in operational screens.
- Only canonical pictures default on. A supplemental aerial needs an explicit true preference; one switch remains.
- A real canvas click selects the footprint at 1440 and 200% zoom. Three probes at 30/60/120 m each pick it.
- At each distance, three consecutive requested frames have identical canvas pixel hashes: no observed flicker.
- At both sizes, the existing Imagery switch accepts keyboard focus and Space turns it off. Attribution stays
  sourced from the canonical read. A browser 404 double leaves 21 pictures and the existing failure hint states
  `1 of 22 images did not load` (read from Layers text, not the switch's accessible name).
- Map draft assignment import, state, callback, element and toast are gone. The inspector keeps the registry-card
  action and recorded-unit link; no new write route, browser-store write or competing identity authority added.
- Unknown height remains null in the input. The engine alone chooses image order; Studio passes no invented base.

## Scans

- `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` — exit 0; no candidates.
- `node docs/evidence/gf-ai/ui/f2c/scan-studio.mjs staging` — exit 0; no candidates.
- New code lines over 120 characters — 0. Existing long lines were not reformatted.

## Not qualified

No screen reader run; no live demo area with both supplemental aerial and retained pictures. The preference
combination is verified by the four pure-function regressions. No claim about continuously moving-camera pixel
identity: the ordered opaque pass removes depth competition, and stationary frames were measured at three distances.
