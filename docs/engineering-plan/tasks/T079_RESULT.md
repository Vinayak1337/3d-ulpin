# T079 — Decluttered map and complete importable source showcase

Implemented solo on 21 September 2026. User-facing map remains `/studio/showcase`; the new downloadable fixture is `/reference/lake-view-complete.zip`. This milestone completes the map declutter and source-to-draft showcase, not the entire attached bulk recording roadmap. See [workflow audit](T079_WORKFLOW_AUDIT.md) for the explicit remaining integration work.

## Interface

- Batches / Map / Register are consistent navigation labels. Global links open directories; selected-building Open register remains contextual.
- The map gains the former permanent explorer width. Layers, properties and findings open on demand, one panel at a time. Removed the repeated conflict tray, minimap, map thumbnail and inert Workspace action. Selected property identity/data/findings remain visible. Engineering fields are expandable.
- Import is a three-step receipt with actual counts, computed findings and an explicit distinction between normalized and retained sources. Complete sample download and alternate fixtures remain accessible without a six-button wall. Users can replace a pending file.
- Keyboard floor/2D/3D search, map controls, responsive inspector, building modes and accepted register layout are preserved. Rights/parties remain separate from residents; floor-specific evidence includes downloadable original plans.
- Fixed small-screen icon-only download controls and shortcut wrapping. Replaced removed Three PCFSoftShadowMap constant with its already-used PCF fallback to remove the warning without changing shadow behavior.

## Source package

The 52-member ZIP contains 50 source files: 12 parsed/matched inputs and 38 supporting originals. It has 49 parcels/buildings, 184 floor geometries, 189 spaces (including explicitly unavailable schedule-only boundaries), 188 fictional residents, 234 separate fictional parties/rights, nine control points and 62,886 synthetic LiDAR ground/roof samples.

Actual format families: GeoJSON, GeoPackage, CSV, PDF, SVG, LAS 1.4/format 7, LAZ, GeoTIFF, JPEG, DOCX, MASTER v1, normalized v1 and validation reports. The provided Drive normalized field names/container shapes were freshly inspected; the field contract is `scripts/spatial/provided-v1-fields.json`. Geometry/main schema fields use the previously retained original provided JSON. All earlier source ZIPs and original Drive bytes remain unchanged.

The map uses source vectors/schedules through the shared canonical adapter and MapViewport. There is no normalized.json shortcut. LAS/LAZ/raster/plan originals are preserved with fingerprints; importing them does not fabricate extraction results or official records. Separate fictional rights link to a retained document and explicit party; invalid joins and control frames reject the draft. All old geometry coordinates/elevations match the prior reference-city fixture exactly.

[Showcase guide](../../LAKE_VIEW_SOURCE_SHOWCASE.md) documents exact presenter actions, source formats, regeneration and scope. The ZIP was downloaded through the product into `/Users/vinayak/Downloads/lake-view-complete.zip`; its SHA-256 matches the public source package. The B01 first-floor PDF downloaded through Evidence also matches its retained original bytes.

## Verification

- 48 source/canonical/reference integration tests passed; 15 geometry/record/floor-plate runtime tests passed. The three new fixture tests were repeated after final metadata regeneration. Production build and TypeScript checking passed.
- Independent binary readers verified 49 GeoPackage parcel shapes against GeoJSON, identical LAS/LAZ coordinate/class arrays, shared raster placement and roof elevations, all eight readable PDFs, readable DOCX, source-catalog fingerprints and the observed normalized field contract.
- Actual browser upload verified the computed 49 / 184 / 189 / 50 receipt and two review findings. Floor search resolves `DEMO-3D-ANCHOR-B01:1`, two residents and its distinct unreviewed lease. Evidence download bytes match. Map tools show only the selected tab. Mobile layout has no horizontal document overflow. The downloaded ZIP was re-uploaded in production; replacing it with invalid JSON showed a readable error and preserved the active map. Batches opened successfully against the recovered backend, with zero existing items and no seeding.
- Evidence is under `docs/engineering-plan/evidence/t079/`. Before/after browser capture comparison is `/reference/review-t079/index.html`; images are actual renders, not claimed pixel-identical reference reconstruction.

## Environment and remaining boundary

Recovered the existing Colima runtime with a graceful restart; PostgreSQL, private S3, Redis, processor and worker health checks passed. No volume reset, demo seed, original deletion, database import/recording or repository snapshot refresh. One production web server remains on port 3000, with the existing required local backend/dispatcher. No commit, push or deployment.

The complete ZIP is still a draft preview, not a durable saved batch. Connecting this mixed package to existing source storage, resumable processing, reviewed frame mapping and safe partial recording remains the next bounded task. General real-data matching, broad LAS/DEM extraction, arbitrary-format support and statutory identity issuance are not claimed. User visual acceptance remains open.
