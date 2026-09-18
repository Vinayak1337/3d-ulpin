# T058 — adopt City Studio first, then match the supplied reference

Latest instruction: the user rejected T057's composition. Copy the actual
`E:/Projects/ulpin-city-studio` interface and working interactions/routing into
the product before improving its scene. Do not call the work finished from tests
alone. Capture the original Studio, original mockups and implementation at the
same dimensions and review them side by side.

## Boundaries

Work on `feat/studio-reference-rebuild`, based on `ee66106`. Preserve the original
Studio as the comparison baseline and leave existing databases, sources, original
routes and imported Uttam Nagar geometry intact. The standalone Studio is an
explicitly synthetic rectangular local scene, not a general cadastral importer.
Do not substitute bounding boxes for real imported footprints to fit its model.

The user-selected Studio includes a Three/R3F scene. Adopt that existing scene
and native-control lifecycle as the **shared Studio viewport**, rather than
reimplementing its UI around the rejected map-lab. Existing Cesium routes remain
compatibility routes for the supported geospatial workflows. The Studio's pinned
front-end dependencies require compatibility testing, but no stored-data migration.
All Studio map/register/detail
views must share the same scene/data authority and avoid unrelated thumbnails.
Do not claim every legacy route has been migrated to the new renderer.

## Ordered milestones

1. Copy the Studio source without credentials, build products or dependency
   directories. Record source hashes and fresh baseline captures. Integrate it
   into Next without the old officer header being drawn a second time. Keep the
   original composition, interactions, exact unit selection and documents.
2. Make map/register/source/plan/utility/export selection URL-addressable with
   refresh and Back/Forward parity. Unknown property/unit references must produce
   an explicit unavailable state, not silently select the showcase property.
   Existing import/data-management routes remain reachable and functional.
3. Prepare versioned synthetic demonstration records and document specimens in
   advance from one geometry generator. Include building/parcel/floor/unit IDs,
   occupancy, roads, utility elevations and computed findings; every specimen is
   visibly fictional, without official seals/signatures. Verify document bytes
   and identifiers against their manifest and expose them in the interface.
4. Compare the copied Studio at the same 1672x941 viewport with REF-15/16/17.
   Improve framing, architecture diversity/depth, roofs, tree silhouettes,
   ground/road contacts and material/lighting balance rather than only CSS.
   Any improved showcase geography is a separately labelled synthetic fixture.
5. Wire existing functional destinations without losing selected identity and
   expose prepared sources, plans, register records and findings. Test all visible
   controls; no inert mock buttons or success messages for unperformed writes.
6. Produce side-by-side browser comparisons and a discrepancy ledger for desktop
   map, close building, register, plan/evidence, utilities, dense view and mobile.
   Fix major mismatches before reporting completion. Preserve actual failures,
   distinguish automated correctness from visual review, and do not fabricate
   user approval or pixel identity.

## Verification

Run type/build and existing spatial/core regressions. New tests cover route
serialization, unavailable references, selection history, consistent shared room
geometry, source-manifest hashes, downloads, checks, canvas picking, held gestures,
2D state, keyboard/dialog focus and mobile panels. Screenshots must be of actual
rendered geometry, never a mockup used as a backdrop. Test original Studio parity
before further styling, then compare the final implementation and mockups side
by side. Retain a runnable local preview and push the feature branch.

## Acceptance

T057 is not reclassified as visually accepted. T058 needs both a functioning
Studio-based implementation and an honest visual comparison showing the major
reference composition/detail gaps addressed. ML is still deferred until this
visual milestone. Original/static evidence and new synthetic assets stay separate.

## Qualified implementation decisions

React/React DOM are pinned to 19.2.8 because the installed R3F 9.7.0 peer range
excludes the previously installed 19.3 release. The old Next/Cesium paths and their
tests still pass. This is a targeted compatibility change, not a broad upgrade.

The original Studio's 944-building source is preserved. The user-authorized
reference fixture contains 62 buildings and is normalized with the existing common
contracts. Its generated documents and own source hashes are kept together.
Three/R3F owns one canvas shared across the Studio map, register and plan preview.
Its specialised display shapes are not a parser for arbitrary imported geometry.

The source upload test writes one original PDF into a new explicitly named
synthetic verification workspace through the existing backend. All previously
fingerprinted rows remain present; the source table intentionally gains one row.
This is not falsely called a read-only run. Draft measurements/review are labelled
local-only and never report a registry publication that has not occurred.
