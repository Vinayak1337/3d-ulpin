# City Studio — reference-led product entry

## Continued refinement

The continued T058 pass shares the actual building envelope across the district,
exploded register, elevation and plan-workspace preview. Property thumbnails are
identity-qualified, route changes are atomic, and source checking validates
original bytes and linked records rather than displaying a fixed success message.
Drafts now have independent floor-local storage and revision checks; legacy
building drafts are retained. Control-Q clears only the current drawing.
Invalid geometry and changed source revisions cannot silently enter the local
review queue. Missing rendering resources expose an explicit recoverable error
while retaining the selected property.

`pnpm test:studio:continuation` runs the additional browser regressions, including
intentional source/renderer failures, floor-draft reloads and touch cancellation.
It uses isolated browser storage and performs no backend writes. Current final
captures and verification are under `docs/evidence/t058/continuation`; the gallery
also shows what changed from the previously committed Studio pass.

## Open it

Run the project normally and open `/studio`. The plain `/` entry redirects here.
The current implementation is on `feat/studio-reference-rebuild`. The original
standalone `E:/Projects/ulpin-city-studio` remains unchanged as a comparison source.

`/studio-review/index.html` shows the original mockups, original Studio and actual
implementation captures side by side, with full-resolution images and a review
ledger. The source screenshots are **only** reference-gallery assets; they are
never used as a renderer backdrop or a false property preview.

## Routes and interaction

Map, register, documents, workspace, import, overview, export and help are
URL-addressable beneath `/studio`. A property ID or its prototype identifier can
follow the view. `floor`, `unit`, `doc`, `tab` and `mode` preserve the selected
record. Unknown properties/units are unavailable, not replaced with the demo
property. Browser history and reload are tested with an exact unit document.

One Studio GPU canvas is leased between the district, register and workspace
preview. These views do not allocate independent renderers. Camera memory is
separate from document/route selection. Normal property-list selection leaves the
camera in place; global search, overview selection and explicit Focus navigate.
Native held-drag, right-drag orbit, wheel, keyboard and touch-control bindings are
retained. Mobile verification is browser emulation, not a physical-phone test.

## Prepared data, not invented on demand

`fixtures/studio/reference-v2` contains the authored 62-building neighbourhood,
62 parcels, 239 floors, 478 units, ten roads, twenty utility alignments and three
computed demonstration findings. It also contains **903 pre-generated PDF
specimens**, packaged with records, floor layouts, GeoJSON, occupancy CSV,
findings and the normalized `ulpin-spatial/2` input/snapshot.

The renderer, register, floor plan and PDF generator use the same geometry source.
The prepared fixture is validated through the existing common identity, source,
frame, geometry and snapshot contracts. Source-asset downloads are allowlisted
and verified against SHA-256 and byte counts. Opening a document downloads its
prepared bytes; it does not silently create a new substitute document.

For the selected example, the footprint is **288 m²**, vertical extent **16 m**,
prism volume **4,608 m³** and parcel area **506.25 m²**. The **32 m²**
outside-parcel finding overlaps the **16 m²** road finding and must not be added
as independent areas. **1.8 m** is horizontal utility clearance; **2.6 m** is the
authored pipe-centre depth. Neither is a real survey finding.

All people, occupancy, identifiers and property records in this fixture are
fictional. No government seal, issued ULPIN, real ownership or model-inference
accuracy is asserted. The original 944-building Studio fixture remains in
`fixtures/studio/original-studio.json`; the new quarter is an explicit versioned
demonstration, not an alteration of an imported locality.

## Existing functionality and deliberate boundaries

Import uploads an original into the existing case/source API, receives its actual
source receipt and links to the existing processing workspace. File/profile/name
and destination determine a stable retry key. The visible upload receipt does
not claim successful automatic segmentation, processing or publication.

The plan workspace supports source inspection, exact unit selection, draft
distance/area/perimeter, calibration of draft measurements, floor comparison,
notes, draft export and revision-checked local draft storage. Its review queue is
explicitly **local**, not a backend registry approval. Source geometry is never
rewritten by a draft scale or measurement.

Existing saved neighbourhoods, registers and processing workflows remain at
`/blocks`, `/register` and `/workspace`, reachable through Import → Saved datasets.
Their Cesium-backed geospatial paths remain compatible; this task does not
replace arbitrary imported geometry with rectangular Studio buildings. ML and
bulk multi-source automation remain the later product milestone.

## Reproduce

The prepared bundle and materials are committed. Ordinary startup does not need
to regenerate the PDFs or download textures. With dependencies and the existing
local environment available:

```powershell
pnpm install --frozen-lockfile
pnpm test:studio
pnpm build
pnpm start
```

Version any intentional fixture/document changes before publishing a new source
set; already received source bytes are not overwritten. `pnpm studio:prepare` regenerates all documents,
normalized records and hashes together. Never regenerate just one representation
and leave the manifest stale. `pnpm test:studio` checks every stored PDF and data
asset against the manifest and independently specified example quantities.

`pnpm test:studio:browser` targets an already-running local server. By default it
does not upload new sources. `STUDIO_TEST_UPLOAD=1` explicitly enables a real
upload into a newly labelled synthetic verification workspace. Its receipt and
preservation checks must be retained; this is not a zero-write test.

## Rendering assets and versions

The source Studio uses R3F 9.7.0, Drei 10.7.8 and Three 0.186.0. React/React DOM are
exactly pinned to 19.2.8, the renderer-compatible version used by the original
Studio. Existing Next/Cesium contracts remain intact and their regressions are run.

Five bundled Poly Haven CC0 assets provide surface materials and daylight only;
their exact download addresses, license source and verified hashes are in
`apps/web/public/studio-materials/SOURCES.json`. They are not evidence or aerial
imagery of the authored neighbourhood. Trees, architecture and room geometry are
rendered, not image mockups. The shared short-range contact pass improves depth
without changing measured geometry.
