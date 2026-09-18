# Architecture and thin data-contract plan
**Proposed target boundaries. The current repository must be revalidated in T001.**

## 1. Context and deployments
Use C4-style context and container views to explain the product, then add component views only where they clarify a difficult boundary. The C4 creator's guidance permits using only the useful levels rather than drawing every class [S05]. The following is a textual responsibility model, not a claim that new deployments have been created.

The initial actor is the local operator preparing and inspecting permitted spatial/property information. Inputs come from acquired files, supported services, manual/synthetic fixtures and optional evidence. Outputs are navigable scenes, linked registers, purpose-specific computed findings and source-preserving exports. Official data issuers and external services are sources, not automatically connected product components.

Keep the existing web/API application, PostgreSQL/PostGIS, object storage, private Python geometry services and Redis/Celery-style worker boundary described in the recovered project. No new broker or separate graph database is required to model linked entities. Use existing service boundaries; make logical modules clear inside them.

## 2. Logical pipeline and ownership
```text
permitted inputs
    → immutable source assets + acquisition receipt
    → profile-specific parsing and observations
    → candidate association, frames and purpose-specific validation
    → selected composition / canonical revisions
    → geometry preparation and deterministic scene compilation
    → staged immutable display assets + validated publication manifest
    → one shared viewport + linked application views
```

| Module | Owns | Must not own |
|---|---|---|
| Input profiles/adapters | Parsing, source locators, native metadata, limits and loss reports | User approval, legal ownership or rendering style |
| Source catalog | Dataset/assets/revisions/source parts and access/retention metadata | A new copy of every original per building |
| Entity and identity | Stable IDs, aliases, typed relationships and lifecycle | Mutable labels as identity or tile membership as ownership |
| Frames/geometry | Supported transformations, validity and defined quantities | Geographic guesses or illustration becoming measurement |
| Composition/review | Compatible selected observations, candidate revisions and decisions | Silently dropping disagreement or AI self-approval |
| Registry compatibility | Existing record/history views and explicit physical/legal crosswalks | A competing second registry |
| Scene compiler | Derived geometry/materials/LODs and stable feature maps | Reinterpreting source files or inventing accepted facts |
| Publication/catalog | Coherent snapshots, coverage and asset discovery | Loading the world into one response |
| Client resource/session | Revision-scoped server reads, selection and view state | Private blobs in navigation storage or independent quantity definitions |
| Shared viewport | Camera, picking, scene resources and capability-driven views | Persisted authority or page-specific data normalization |

Dependency rule: pure domain types and invariants do not import browser, database or worker implementations. Application services depend on repository/geometry/asset ports. Existing infrastructure implements those ports. Page-specific components consume shared application interfaces and view models. Introduce folders incrementally; moving all files before a useful change is not required.

## 3. Current boundaries to inspect before editing
The recovered source paths include `packages/contracts/src/{area,index,registry,officer}.ts`; `apps/web/lib/server/{db,area-db,registry-db,officer-db}.ts`; `services/geo/geo/{area,native_gis,native_schedule}.py`; `apps/web/components/AreaViewer.tsx`; and `apps/web/features/officer/{block,scene,shared}`. These are navigation pointers, not guarantees that the future code remains unchanged.

The existing block and property views already reuse AreaViewer. The shared officer store already holds navigation/preferences, while inspected resource hooks held request state per instance. Preserve these useful boundaries; add common session/resource semantics rather than declaring all reuse absent. Existing local/geographic geometry, sources, revisions and fingerprint safeguards also remain valuable [P01].

A candidate new logical layout is `contracts/unified`, `domain/{identity,sources,geometry,composition}`, `scene/{compiler,publication}` and `features/shared/{resource,session,viewport}` within the current workspace structure. T003 must fit it to actual package conventions. These names are not a directive to create empty folders or unused packages.

## 4. Thin contract: six connected concerns
| Concern | Minimum contract | First implemented scope |
|---|---|---|
| Identity | EntityRef, EntityRevisionRef, typed relation, external identifier, membership and lifecycle | Existing physical/registry mapping, cross-block identity, building-level-space relations and aliases |
| Source | Dataset/AssetRevisionRef, SourcePartRef, evidence link and access class | Reuse retained originals and exact GIS/CSV/page/object locators; zero documents valid |
| Frames | FrameRef, axis/unit/vertical meaning, declared operation and applicability | Current local/UTM/geographic frames and tested local transforms; unresolved states retained |
| Geometry | RepresentationRef, semantic role, discriminated payload, quantity definition and capability assessment | Supported polygon/multipart/prism profiles and typed external asset references |
| Interpretation | Observation, resolution decision, composition binding and derivation signature | Selected footprint/levels/units/parcel/utility contributions with conflicts preserved |
| Publication | World/scenario, immutable manifest, selected revisions, render-to-entity mapping | Small coherent selected scene first; large coverage catalogs later |

Do not turn these concerns into one giant JSON object or six duplicated storage systems. Reuse existing tables and source bytes when appropriate; introduce only demonstrated missing persisted relationships. A logical schema catalog does not prescribe table count.

### Authoritative schema and compatibility
The first proposal is one machine-readable contract source with generated or synchronized TypeScript/Python validators/types. A restricted JSON Schema-based profile is a candidate, not a preselected package upgrade. T003/T007 must prove parity for unions, enums, nullability, finite numbers, unknown variants, references and structured failures before locking tooling. Domain validation remains separate from structural validation.

Preserve current `ulpin-canonical/2` consumers through explicit version adapters. The recovered `ulpin-unified/3-draft-2026-09-18` name is a draft label, not a deployed endpoint. Do not claim compatibility by erasing richer fields or flattening unsupported geometry; an older consumer gets an explicit supported projection or a capability error.

### Value and capability semantics
Represent known, unknown, not-applicable, conflicting and withheld states where meaningful. Do not encode all of them as zero or empty string. A height of zero is a number, not missing data. A source's reported area can coexist with a computed area if their definitions/methods differ.

Purpose-specific capability results are derived by trusted validation against named revisions. Examples: source viewable, locally displayable, globally placeable, exterior available, interiors available, measurable 2D, supported 3D quantity, reviewed operation. Attaching a PDF must not change `canComputeVolume`; an arbitrary client boolean cannot grant capability.

### Exact identity, not optimistic matching
Keep source namespace/feature ID, canonical entity ID, official/external assertion and render primitive ID separate. Retain raw and normalized external identifier strings, issuer and validity. A source-feature link is evidence for correspondence, not proof that two physical/legal things are the same.

An ID crosswalk can point to related records without merging them. Splits/merges require decisions, lineage and retirement rules. Queries must return ambiguity when warranted. Do not make authoritative identity depend on a floor label, geometry hash, block number or source array order.

### Coordinate pipeline
Retain source-native geometry, use declared operations into suitable analytical frames, index geographic coverage, and place local render coordinates with explicit world transforms. A local affine matrix is not a complete replacement for geodetic transformations, which may be chained operations with other parameters [S07].

A shared horizontal CRS does not reconcile vertical datums. Floors at +3 m or pipes at 2 m depth require their reference origin/surface. Keep ground, roof/top surface and other elevation meanings distinct. Do not compare two arbitrary SRID-0 local geometries merely because their database columns use the same SRID. Keep source uncertainty, transformation error, numeric tolerance and render simplification separate.

### Optional people and evidence
Documents can be linked zero-to-many at building, level or unit scope. One source can support several targets using exact locators. Direct and inherited context links differ. Unlinking evidence is not permission to erase the original or the geometry.

Reserve separate Party, Occupancy, recorded-right and application-account concepts. The first renderer does not require populated people tables. Public/geometry-safe DTOs contain only allowed opaque IDs and display metadata. Production multi-user identity and official data connectors are separate elective work, not already guaranteed by a local operator mode.

## 5. UI state and resource architecture
The authoritative server read model is keyed by world/snapshot plus entity/representation revision and access scope. Navigation/session owns selected entity/level/unit IDs, view mode, filters and return-camera context. Renderer caches own tiles, buffers, textures, meshes and transient picks. Draft editors own explicit versioned candidate commands; they do not overwrite the selected accepted model.

When one building updates, invalidate its details and dependent quantities/publications according to revision. Do not replace an unrelated selected entity with a late response. A permission or operator-scope change cancels and clears affected pending and cached content. Cache keying alone is not authorization; the server enforces access.

Keep one primary world renderer. Reuse the same compiled assets and identities for an isolated register preview when useful; pause/unmount inactive views. A 2D map mode derives from the same geometry. A calibrated document canvas is a specialized work surface with an explicit transform, not a competing map dataset.

## 6. Rendering and delivery boundary
Use glTF/GLB and a tested 3D Tiles profile as candidate derived formats. 3D Tiles addresses hierarchical delivery, not cadastral authority or guaranteed appearance. Cesium's documented tileset controls inform loading/cache instrumentation, but exact behaviour must be tested against the installed engine and chosen extensions [S06].

The compiler reads a pinned composition and emits manifests containing source/geometry/style/compiler revisions, hashes, transforms, feature/component maps and geometric-error/capability metadata. Stable procedural seeds derive from entity/component IDs. Adding another record, changing a PDF link or repacking tiles cannot randomly change facades.

Selected interiors are on-demand content. Clipping/section/explosion is presentation state unless a distinct analytical section operation is requested. Coarse visual geometry may identify the feature; exact quantities resolve against the named analytical representation. Private source information must not be placed in tile metadata merely for convenience.

## 7. Migration and rollout
First add a read adapter and test it with actual legacy samples. Nominate existing services as writers during the transition. Add schema and backfill only when a demonstrated relation cannot be expressed safely through existing records. Rehearse on isolated data, then compare counts, identities, hash references, geometry roles, frame metadata and history.

Use explicit migration IDs and applied-state tracking. Separate reversible application routing from irreversible persisted effects. Do not drop a column/table or delete an original as part of an initial UI switch. Keep an old route or feature flag until the replacement's relevant workflow has parity. Revert application consumers only when the stored data remains compatible; otherwise use a forward repair and a rehearsed recovery path.

Publish assets before activating their validated manifest. Use a database transaction for internal snapshot metadata/pointer changes, not a fictional transaction with object storage. Keep the last coherent publication available on failures. A local data bundle remains an additive transfer mechanism, not automatic continuous synchronization of everyone's edits.

## 8. Architecture checks to automate
Check forbidden dependency directions, cross-language schema fixtures, preserved legacy IDs, frame-aware operations, stable derivation signatures, public DTO field allowlists, shared-view identity selectors and one-writer ownership. Start with inexpensive static/import tests and fixtures; do not build a bespoke enterprise governance framework to enforce ten practical rules.
