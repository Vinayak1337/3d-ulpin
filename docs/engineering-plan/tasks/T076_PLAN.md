# T076 — Shared reference viewport and exact Block Map composition

Status: implementing, 20 September 2026. Depends on completed T075 contract gate.

## Outcome and ownership

Move the existing pure Three scene into shared source, use it through the product MapViewport boundary and a generated browser entry, and reproduce the reference map shell. Keep the old Cesium profiles available. No hardcoded dataset identities and no restored live demos.

- Runtime worker owns `features/spatial/reference-runtime/{map.js,architecture.js,environment.js}`: multipart/base-height support, exact source shapes, bounded rendering, reference-like inspector/rails/labels and useful selection API. No package adapter changes.
- Parent owns contract browser integration, generated artifacts, Studio route/viewport adapter, header/routes, session persistence, docs and final browser review.

The renderer must accept the canonical-derived render DTO. Test both dense and independent datasets; preserve frame, revision, missing geometry and computed evidence. Local orbit camera state is distinct from geodetic Cesium camera state. Share source modules rather than a second fork of the renderer.

## Acceptance

Actual desktop/mobile browser captures, import through the UI, 2D/3D, search, layer toggles, selection and overlap picking, floor/space tools, north/fit/zoom, multipart/courtyard/nonzero-Z views, geometry preservation, diagnostics and coherent errors. Reference-sized side-by-side review documents visual gaps honestly. Follow with remaining map/register/workspace states in separate bounded tasks; this gate must not be mislabeled complete product replication.
