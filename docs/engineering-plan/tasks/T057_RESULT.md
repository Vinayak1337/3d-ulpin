# T057 — normalized 3D explorer implementation and verification

Status: **Verify — local technical checks passed; user visual approval pending**.
The implementation remains on `feat/unified-spatial-foundation`. This is the
user-prioritized visual milestone after T009, not acceptance of all remaining
bulk-ingestion, registry-interface, national-scale or ML requirements.

## Delivered path

The existing Block Map now links to **Enhanced 3D**. The same explorer/runtime
renders the garden and dense calibration fixtures or an existing normalized area.
Saved data passes through the read-only T009 bridge, a renderer-only projection,
the common GLB/3D Tiles compiler and the same shared canvas/session.

The saved Google Uttam Nagar fictional scenario contains 15 building features and
36 road/context features. These are the selected existing records, not a complete
house inventory. Public source footprints remain in their original geometry and
coordinate records; supplied fictional heights/floor counts drive labelled
massing/detail. Unknown heights remain flat selectable footprints. Unplaced
interiors stay available in the existing property register and are not guessed.

The inspector uses batch calculations from the original analytical core. Display
ground, diagram-width line strokes, textures, roof fittings and other illustrative
detail do not change its area/volume or create official property identifiers.
Relative display height is explicitly not a surveyed vertical datum. Missing
analytical volume is unavailable, not replaced by the display extrusion's volume.

## Visual and interaction changes

The common renderer has warmer material variation, filtered procedural material
textures, improved roofs/parapets/windows/rails, synthetic-road markings and
clearer lighting/ground contact. Source-preserving dense buildings suppress
outward decorative balconies. Selection has a projected roof outline/label,
properly sized focus, north/reverse/fit/2D controls and optional shadows.

The shared interface has reorganized property measurements, source provenance,
floor/record navigation, property search, previous/next selection and separate
mobile layers/inspector drawers. Switching panels retains the same canvas and
canonical selection. Refresh failure retains the previous coherent scene and
offers retry. Google/OpenStreetMap credits are derived from retained source
attribution, not only guessed from an area's name.

## Qualification completed locally

| Check | Actual result |
|---|---|
| Core contracts, bridge and new display tests | 295 passed |
| Existing spatial regression | 29 passed |
| Existing UI regression | 20 passed |
| Generated-schema drift and Python parity | Passed for all current corpus families |
| Production TypeScript/Next build | Passed; existing minification-disabled warning remains |
| Existing browser suite | 10 groups passed |
| New normalized-neighbourhood browser | 7 groups passed on software WebGL |
| Installed Chrome on the PC | The same 7 groups passed; reported NVIDIA RTX 3070 / D3D11 |
| Three live normalized areas | Direct/HTTP digests agreed; stale expected digests returned 409 |
| Protected DB tables before/after | Identical fingerprints across six current/history/source tables |

The browser verifies genuine GLB requests and actual canvas picking after selecting
another object, not just a list click. It also checks 2D, reverse view, dense input,
saved analytical metrics, same-canvas panel navigation, source credits and 390px
panels. One explicitly injected HTTP503 tests failed refresh/recovery; unrelated
HTTP failures and page exceptions remain failures. The exact renderer backend is
in the hardware receipt. This is not a quantified GPU-capacity benchmark, and the
mobile viewport is emulation rather than a physical-phone test.

## Defects found and corrected during verification

- Metre-scale self-shadow striping required a guarded, isolated bias adapter for
  the pinned Cesium engine 26.3.0. The browser asserts that adapter's profile. It
  touches a private engine setting and must be requalified on an engine upgrade.
- A throttled post-render label could miss the only frame after a camera command.
  Actual picking failed at the stale displayed coordinate. Updating every rendered
  position with an equality guard corrected the behaviour without relaxing the test.
- The privacy-preserving DB projection stripped source attribution along with
  arbitrary properties. Its SQL now restores only bounded attribution/license
  strings; other private properties stay excluded. The live browser credit check
  failed before this correction and passed afterward.

## Delivery and resource boundaries

The new routes are loopback/same-origin, private/no-store and read-only. Asset paths
are validated and bound to area, world, read digest and compiler publication ID.
The in-memory cache has three entries, a 96 MiB declared-byte budget and a 20-minute
TTL; this is not an exact process-RSS limit. Compilation rejects more than 2,000
visible entities, 50,000 vertices or 12,000 decorative facade bays, and bounds tile
bytes. Those are a qualified neighbourhood profile, not a city-scale claim.

No migration, seed, original replacement, property write or DB publication-pointer
activation was issued. The full isolated workflow now includes the saved-data
browser and post-browser preservation checks; its hosted run status must be read
from the actual workflow rather than inferred from this local report.

Evidence: `docs/evidence/t057/` contains the scoped browser/graphics/preservation
receipts and selected actual captures. ML inference/segmentation has not been
started. The next checkpoint is the user's review of this live visual baseline;
the older remaining workflow and ML requirements are still unaccepted.
