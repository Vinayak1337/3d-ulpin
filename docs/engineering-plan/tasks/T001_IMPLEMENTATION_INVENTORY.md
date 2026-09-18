# T001: inherited implementation coverage, not task acceptance

Inspected base: `f082441`; adopted/tested continuation begins at `c4e6857`.
The existing product has real persistence and a useful shared spatial foundation.
Do not recreate these modules or infer completed backlog tasks from their names.

| Planned boundary | Existing implementation to keep | Qualification still needed |
|---|---|---|
| T004 identity | `spatial/types.ts` IDs, revisions, identifiers, many area IDs and relations; validator rejects duplicate IDs/cycles | Explicit lifecycle/aliases/lineage, typed relation endpoints and duplex/shared-space contract |
| T005 sources | Immutable legacy source UUIDs, optional evidence/attachments; original hashes/storage already exist | Reusable asset/part catalog, direct versus inherited links, retention policy and exact source semantics |
| T006 frames | Named engineering/geographic frames; WGS84 ENU-to-ECEF and independent equatorial vectors | Versioned unit/rotation/translation operations, native origins, vertical compatibility and overflow checks |
| T007 geometry | Bounded XY polygons/multipolygons/lines, holes/topology and area/prism calculation | Shared TypeScript/Python structural authority, qualified asset variants, capability and finite-output gates |
| T008 composition | Revision-bound spatial snapshot and derived publication hash | Selected observations/contribution rules, conflict resolution and coherent multi-source snapshot semantics |
| T009 compatibility | `data/legacy-adapter.ts` retains physical IDs, nullable source ordinals and separate geographic/metric geometry | Full original hashes/locators/native-frame metadata and linked registry/level/unit/history parity |
| T010–T013 proving slice | Existing PostGIS writers, replay/review controls, saved bundles and pure calibration fixtures | Real new-contract persistence/composition example across two authoring frames; calibration is not that test |
| T014 data access | Per-layout request cache; subscriber cancellation, stale-generation guards and invalidation tests | Revision/scope keys, eviction of all idle-entry paths and explicit permission-reset boundary |
| T015 session | Shared world-keyed selection, mode and camera | Route precedence, selected revision/level/unit, invalid-ID resolution and bounded read-only session creation |
| T016 viewport | One Cesium factory; AreaViewer/SpatialViewer compatibility facades and common viewport | Full legacy cross-page gesture/lifecycle parity, pointer-cancel/blur and stale-pick coverage |
| T017 compiler | Real deterministic GLB/3D Tiles generation, analytical-to-render IDs, holes and source-order tests | More independent geometry/profile cases and supported unknown-data fallbacks |
| T018 context | Given road/ground polygons compile | Qualified line/variable-width utility profiles, crossings and seam/topology policy |
| T019 style | Seeded synthetic architecture and material library | Reference-quality diversity/contact/shimmer review; supplied factual extents must remain unchanged |
| T020 delivery | Bounded several-tile coarse/detail calibration assets and canonical metadata | Actual cross-block publication, partial failure and durable atomic manifest switching |
| T021–T022 renderer | Pinned Cesium 1.145.0 loads real assets; navigation, panels, unit overlay and 2D browser flow tested | Actual canvas-feature picking, clipping/context loss, independent render-placement and full metric probes |

## Storage and test boundaries

`db.ts` owns the main migration entry point; its migration includes identifier
backfills. `area-db.ts` also inserts missing map-area records during migration.
These are not metadata-only operations. Existing ordinary area/registry readers
do not invoke the inspected migration entry point. Do not generalize that into a
claim that every HTTP GET is side-effect-free; processing reconciliation must be
inspected for each selected endpoint.

`verify-registry.ts` mutates the named Nandan demonstration. `verify-area.ts`
allocates and removes its own test rows but has fixed local endpoint assumptions.
`api-regression.ts --stale-race-only` controls the normal Compose worker through
the platform helper. `datasets/test-transfer.mjs` selects the fixed repository
environment/container. None is a safe substitute for the new scoped runner merely
because its name includes “verify” or “test”. The hosted baseline uses real copied
data with its own database, bucket, worker and server, and avoids global pause or
destructive named-demo paths.

## Review class and unresolved observations

This is source inspection and current named-test evidence, not independent review,
live private-PC data validation or complete formal verification. In particular,
the current browser test uses list selection for some identity checks; that is
not sufficient evidence for all canvas-picking requirements. The geometry helper's
finite input checks do not by themselves prove finite arithmetic output. Both
remain explicit obligations in their later bounded task plans.
