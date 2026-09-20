# T073 — Dense plotted block and spatial arrangement checks

Implemented locally on 20 September 2026 in the existing reference at localhost:3013. User clarification: flexibility means adjacent/overlapping buildings and road/parcel arrangements, rather than file-format variety. User visual acceptance remains separate from technical verification. No product data was seeded.

## Scene correction

The revised fictional Neem Gali block has 82 buildings and 82 plots in 120×115m, seven street corridors (narrow galis and one 8m collector), one small 128m² court, two trees, six focal floors, sixteen spaces and two utility alignments. Building union covers 75.52% of the extent. There are 68 valid shared-wall contacts and 13 union groups; every constituent building retains its own ID and exact polygon. Rooftop tanks and narrow-front balconies support the intended dense residential character. Minimal setbacks/paved ground replace the old landscaped specimen. The old T072 scene/package/generator is archived under `design/reference-map-v5/data/archive/t072-reference-v5/`.

Four positive-area findings are computed, with actual intersection/difference polygons and input geometry revisions:

| Finding | Objects | Area |
|---|---|---:|
| Building overlap | B02 / B03 | 9.48m² |
| Outside linked parcel | B01 / P01 | 16m² |
| Lane overlap | B01 / R03 | 16m² |
| Outside linked parcel | B03 / P03 | 9.48m² |

B02/B03's common vertical interval also yields 117.552m³. Some findings describe the same spatial patch against different source boundaries; their areas are not summed as independent land areas. B12 remains a missing-height case with no invented extrusion. Zero-area shared walls do not produce conflicts, and vertically disjoint building solids are distinguished from actual volume intersections.

## Generic arrangement behavior

`spatial-checks.js` runs for every load/import. It uses bundled polygon-clipping to recompute current building intersections, linked-parcel differences and road intersections, preserving concavities/holes and independent identities. Stale fixture finding codes are replaced while unrelated evidence issues remain. Frame mismatch, unknown vertical evidence and scope limits are explicit. Runtime calculation is independently compared to Shapely in the generator validator.

The renderer uses persistent red tint for supported positive spatial findings and exact selectable intersection patches. Unknown-Z overlaps get a footprint patch with unresolved-height wording rather than an invented solid conflict. Shared walls are ordinary boundaries. Overlapping buildings can be selected independently through search, the findings directory, or repeated canvas clicks. The new header findings list makes both the B01 lane case and B02/B03 pair discoverable. Floors, isolation, separation, section cuts, underground view and orthographic 2D remain available.

The parent imported a changed B02 geometry revision in the browser: moving its footprint removed the old B02/B03 overlap, computed its new parcel overflow, preserved the previous geometry revision and left the exact new coordinates unchanged. This is not a fixed arrangement or red flag tied to a particular demo ID.

## Verification and evidence

- 29 map/browser checks: `evidence/t073/map/results.json`. Includes actual selection, overlapping-ID click cycling, persistent red on unselected affected buildings, ordinary selection green, B12 flat/amber, unknown-Z and disjoint-height behavior. Zero page errors.
- 11 import/record/mobile checks: `evidence/t073/upload-results.json`. Dynamic counts, 14 hashes, corrupt package rejection and unavailable-road handling; no requests to the live app.
- 8 full-browser arrangement checks: `evidence/t073/spatial-browser-results.json`. Findings directory, independent selection, dynamic geometry revision and recomputed issues.
- 16 runtime geometry checks: `evidence/t073/spatial-runtime-results.txt`. Includes shared walls, identical polygons, vertical contact/disjoint/unknown heights, concavity/holes, MultiPolygon arithmetic, movement/revisions/frame limits and the independent fixture oracle. MultiPolygon arithmetic does not imply full MultiPolygon renderer support.
- Generator validator: strict schema, all 196 source feature round trips, source bytes/hashes/ZIP, all declared contacts/conflicts and union groups, plus 174 features through the existing pure GIS adapters. Max round-trip agreement error ~1.92e-9m is numerical agreement for fictional inputs, not survey accuracy. Download ZIP is deterministic.
- Parent inspected actual dense opening and the source/reference comparison. Captures: `evidence/t073/map/01-opening.png`, `11-building-overlap.png`, `12-selected-intersection.png`, `evidence/t073/findings-list.png`, `evidence/t073/reference-comparison.png`. Browser comparison lives at `design/reference-map-v5/comparison.html`.
- Visible in-app browser opened to `http://127.0.0.1:3013/?scene=dense#map`; accessibility snapshot confirmed 82 buildings, four findings and two 16m² checks on B01.

Local performance: Apple M3 / ANGLE Metal, headless Chromium 153, 1120×845 canvas DPR1. Opening 988 draw calls, 316,650 triangles. Direct continuous orbit over 2201ms: 65 intervals averaging 33.33ms / p95 33.4ms (~30Hz); CPU submission 4.19ms average / 5ms p95. Idle rendering stops. These are local observations, not hardware-independent guarantees.

## Scope boundary

These arrangements are supported by this geometry-driven reference; this does not establish universal native-solid, terrain or arbitrary-format support, nor product-wide integration. The production shared-viewport migration remains separate. Geometry findings are review evidence, not ownership decisions. Source originals/revisions and the previous synthetic fixture remain preserved; the empty live application is unchanged.
