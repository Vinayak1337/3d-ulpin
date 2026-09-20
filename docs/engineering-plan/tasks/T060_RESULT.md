# T060 — Studio correctness and visual verification

Status: **Implemented** on `feat/visual-ml-completion`, starting from integrated
revision `da00fc1`. Implementation, browser verification and user acceptance are
separate states. The final small changes also passed a production browser rerun.

## Delivered

- Map list and canvas unit selection open the existing quick-unit card and write
  the exact property/floor/unit into the route. The Inspector callback is now
  required, so its former disconnected state cannot silently typecheck.
- Quick originals use map document URLs. Reload, Back/Forward and full-register
  handoff preserve the chosen source and unit. Opening a building original also
  retains an already-selected background unit/floor unless another is requested.
- The fixture Studio uses the shared ProductHeader, saved-record resolver,
  directory navigation and one SpatialDataProvider. Fixture references remain
  visibly synthetic and separate from persisted identities. Source-specific
  fixture exports remain available through the shared header.
- Saved SVG export is generated from the selected retained geometry, with source
  revision, canonical identity, attribution and scoped metadata. It no longer
  serializes unrelated shapes from the live map.
- Shared scene materials, foliage, lighting and exterior detail were refined;
  imported source geometry was not replaced or reshaped. Tablet map layers use a
  drawer rather than squeezing the scene between both rails. Compact action
  buttons retain accessible names; Escape closes layers and restores its opener.
- Browser scripts use full bundled Chromium by default, with an optional
  `STUDIO_BROWSER_CHANNEL` override. No installed Google Chrome or custom profile
  is required. On this Mac it uses the Apple M3 Metal renderer.

## Recorded verification

| Check | Result | Evidence |
|---|---|---|
| Focused Studio correctness, including final fixes | 7 groups passed | `docs/evidence/t060/correctness-final/results.json` |
| Existing Studio journey | 11 groups passed | `docs/evidence/t060/studio-original/results.json` |
| Draft/history/input/recovery continuation | 10 groups passed | `docs/evidence/t060/studio-continuation/results.json` |
| Actual saved Lake View journey | 6 groups passed | `docs/evidence/t060/saved-final/results.json` |
| Current reference-family capture | 8 views passed | `docs/evidence/t060/visual-metal/capture.json` |
| Focused Studio unit suite | 36/36 passed | `pnpm test:studio` |

The saved-data journey uses the real local dataset chooser and resolver without
mocked records. It checks canonical unit selection, the selected SVG's single
feature and original geometry/source metadata, rendered original evidence,
retained physical history, investigation UI and the 390px register/workspace
directory. It makes no API writes. Before/after context, dossier and original-byte
fingerprints are identical. The matching final source hash and identities are in
its JSON report.

The original Studio journey also performs one authorized upload into a new,
timestamped, explicitly synthetic verification workspace. Its 12,403-byte source
is retained as `e84621eb-67dd-40de-b3c4-5a742a4def29`, under case
`841d6813-9793-480e-8cb5-d9005cc5344f`; the downloaded original matches SHA-256
`6963fc54c441cce6af5228e2658f8c6a45cfd048ecd9f2773e734dca04ead78b`.
This proves source receipt and byte preservation; it does not claim that this
uploaded PDF completed a calibrated build/review/publication lifecycle.

## Qualifications and final follow-up

- The final production rerun passed all seven focused correctness groups,
  including background unit/floor preservation while opening a building original
  and tablet Layers Escape/focus restoration. The saved-data journey also passed
  all six groups against the final compact-header change, with no API writes,
  page errors or failed responses. Earlier captures remain useful visual evidence.
- An earlier saved-data run received a real, transient `503` from `/api/v1/areas`.
  The UI exposed retry controls. The successful final run had no API failures,
  but the earlier failure is retained in
  `docs/evidence/t060/saved/transient-areas-503.json` and `.png`; a successful retry
  is not proof that all intermittent service failures have been eliminated.
- The initial headless-shell 3D runs timed out under CPU SwiftShader. Their
  diagnostic reports remain in `correctness/` and `visual/`; accepted GPU results
  are the separate `*-metal/` directories.
- Mobile/touch checks are browser emulation. Physical-phone testing, formal
  screen-reader qualification and a complete current true-200%-browser-zoom
  matrix are not claimed. User visual approval is not inferred from captures.
- The reference illustrations remain art-direction targets, not surveyed
  geometry or a claim of pixel-identical photorealism. This task does not close
  city-scale streaming, every deferred adapter, clean-machine release recovery,
  or the entire multi-source live import-to-publication acceptance matrix.

See `docs/evidence/t060/verification-summary.json` for machine-readable current
checks and the explicitly outstanding verification items. ML work follows under
its own T061 plan; it is not counted as part of this frontend milestone.

### Saved Uttam contrast pass (20 September 2026)

This pass addresses the separate saved-data/Cesium scene family, not the authored
Three/R3F fixture scene. Unknown-height footprints now have dedicated matte slate
fills and darker boundaries instead of the pale plot-paving material. Their
original rings, courtyard holes and zero height remain unchanged. Recorded road
centerlines gain a two-pixel screen stroke at their existing coordinates; this is
diagram linework and does not establish road width. Layer visibility and opacity
still apply. The overview identifies unavailable heights and labels centerlines.
Other 3D building materials and source measurements are unchanged.

`pnpm test:spatial` passed 30/30, including a flat-footprint courtyard-hole
invariant; web TypeScript checking passed. React component review found no new
fetch, runtime or event-listener lifecycle. Compiler style is now
`municipal-architecture/3`; restart clears the saved-scene compilation cache.
The final production browser capture confirms the contrast improvement and
readable caption. User visual approval is still separate from this inspection.

Follow-up: the first after-build view exposed an existing projection/compiler bug:
both paths applied polygon-only topology validation to supported LineStrings,
silently excluding all 35 retained Uttam road centerlines at projection time.
Polygon-only topology checks no longer reject supported LineStrings; normalized
geometry validation and other source-kind restrictions remain. A regression failed before the fix
and now verifies road identity, every projected source vertex, zero display height
and tile compilation. The combined spatial/core-display suite passes 41/41.
A read-only run against the actual linked Uttam records confirms 113 buildings,
35 roads and 35 LineStrings reach the compiler, with 149 rendered entities including
the display ground. The final production browser check passes four groups:113 flat building features
and35 live Cesium road overlays; Roads toggles35→0→35 on the same camera/runtime;
source/context/descriptor hashes stay unchanged; no writes or browser/asset errors.
The caption now sits above the map legend without overlap. See
`docs/evidence/t060/uttam-final/results.json` and `03-roads-restored.png`; the earlier
overlapping caption capture remains in `pre-caption-fix/`.
