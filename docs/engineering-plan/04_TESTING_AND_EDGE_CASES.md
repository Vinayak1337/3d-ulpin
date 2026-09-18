# Verification, edge cases and release gates
**Everything below is a planned test obligation, not a new application result.**

## 1. Test strategy: the smallest test that answers the real question
Use fast pure tests for IDs, quantities, profile validation, selections and fingerprints. Use shared contract fixtures to check TypeScript/Python parity. Use actual isolated PostgreSQL/PostGIS/object storage for transactions, migrations, uniqueness and source preservation. Use targeted browser journeys for wiring, request races and user interaction. Use actual browsers/devices and recorded workloads for renderer/resource claims.

Characterization tests record legacy behavior that must survive; requirements may deliberately replace an incorrect behavior, but that needs an explicit decision and expected outcome. Add an independent oracle before coding deterministic transformations/calculations. Property and metamorphic tests challenge invariants beyond a few examples. Example-based end-to-end tests prove complete journeys, not mathematical coverage.

Do not mock the dependency whose correctness is being asserted. A mocked API is useful for isolated UI states, not proof of a working import. A screenshot proves a particular image, not drag behavior, volume correctness, memory plateau or full format support. A headless run does not prove the user's physical GPU or phone performance.

## 2. Test layers and when they run
| Layer | Examples | Timing |
|---|---|---|
| Fast static/unit | Dependency directions, schema variants, pure geometry helpers, selector behavior | Every relevant change |
| Contract/property | Identical semantic fixtures across languages; replay/determinism/metamorphic invariants | Every contract/algorithm change |
| Isolated integration | Real persistence, source bytes, migration upgrade/rerun, idempotent jobs | Affected write-path changes |
| Browser | Navigation, late requests, selection, held gestures, dialogs, failed/empty states | Each affected interface/viewport task |
| Visual | Matched camera/lighting comparisons and approved real-render regressions | Shared scene/style changes and visual gates |
| Fault/resource | Worker kill, partial storage failure, context loss, repeated travel, bounded caches | First relevant mechanism, then qualification |
| Physical device/accessibility | Mouse/touch, keyboard/focus, zoom, reduced motion, declared quality tier | Before claiming that device/profile is supported |

Tests run inside the active task, not in one late QA phase. Final qualification reruns the integrated set; it is not permission to ignore earlier correctness.

## 3. Initial independent fixtures
The first two-block fixture uses explicit synthetic local frames and independently specified expected geometry. One 10 × 8 m building crossing the seam has 80 m² footprint and a 6 m prism height yields 480 m³ volume. The first test must verify actual transformed geometry and persisted identity, not only multiply those constants. A source offering the same roof outline instead of ground occupation is a different semantic role, not a passing equivalence case.

Keep the original F01–F09 fixture families: full reference-style neighbourhood; dense irregular area; slope/split levels; holes/multiparts/high-rise/sparse data; roads/bridges/utilities; equivalent source formats; seam/CRS torture cases; generated scale catalogs; held-out external shape. The first few use small authored geometry. Advanced real datasets and large catalogs are qualified only in their scoped tasks.

Hold out at least one dataset/shape family from visual tuning. If its failures lead to tuning, retain it as regression and choose a new held-out input for the next generalization claim. A synthetic dense fixture is not a replacement for eventually checking actual source geometry coverage.

## 4. Numerical oracles and invariants
A rigid transform in an exact local synthetic frame preserves physical area/volume. Unit conversion changes numeric representation correctly without changing the physical quantity. Reordering equivalent source items cannot change identity or seeded appearance. Import replay cannot duplicate effects. Adding an unrelated source must not invalidate unrelated geometry. Changing display LOD, camera or explosion cannot alter a fixed analytical result.

Define contact separately from positive area/volume overlap. Define union/difference/intersection results, not 'total area minus another total'. Do not add a road intersection to an overhang area when one region is contained in the other. Define horizontal distance, surface clearance, vertical separation and depth independently.

Every operation/profile selects tolerances based on units, algorithm and independent references. The earlier plan proposed <=1 mm analytical round-trip and <=1 cm near-inspection placement for exact synthetic fixtures. These remain provisional qualification targets, not promised survey accuracy. Source uncertainty, transform uncertainty, numeric tolerance and render quantization each need their own field and test.

## 5. Browser and visual gate
Record fixture/contract/compiler/style/snapshot revisions, browser/device, GPU/driver where obtainable, viewport, DPR, camera pose/projection and lighting. Capture actual browser output without post-processing. Compare scene-only content and whole interface separately. Review oblique, reverse oblique, top-down, selected-building close-up, narrow alley, wide district, section/underground and boundary travel.

Use the earlier proposed 0–5 anchored visual rubric only after T002 confirms it: every critical applicable dimension should reach the agreed comparable-quality target (initially 4), and no correctness blocker may be averaged away. Sparse inputs are judged against their approved neutral/limited representation; complete illustrative fixtures against the detailed reference. A generated reference image is not a coherent geometric specification for every unseen angle.

Once a real implementation view is accepted, pin it for screenshot regression. A changed snapshot needs a reasoned rebaseline and independent measurement/interaction checks. T027, T037 and T042 include actual user visual checkpoints. Engineering code completion is separate from that acceptance.

## 6. Initial performance protocol, not results
Use a declared desktop workload at 1920 × 1080 CSS pixels and specified DPR as one initial profile. Retain the earlier proposed warm median <=16.7 ms and p95 <=33.3 ms as targets to validate, not guarantees. Record cold and warm first useful geometry separately; <=5 seconds is only a proposed target under named network/storage conditions. Record time to high detail independently.

Start investigating a 512 MiB exterior-tile cache target plus explicitly budgeted temporary overflow, while accounting for all tilesets, textures, terrain, interiors and other resources. Cesium cache estimates are not a measurement of total GPU allocation. Repeated travel loops must settle to a documented resource plateau; no universal one-number memory claim.

Count catalog objects, loaded objects and visible geometry separately. Test 10k then 100k catalogs when useful, with bounded visible workload. Million-object catalog experiments are optional T056. Record failed/cancelled requests, decode/upload spikes, empty coverage, context-loss recovery and longest repeated stalls. Reduced-quality tiers may reduce visual detail, never analytical truth.

## 7. Gate evidence and release honesty
**Foundation gate T013:** protected legacy identity/source/frame invariants, selected composition, replay, unknowns and actual storage path pass. **Render foundation T022:** real tiles/IDs/navigation/measurement probes qualify. **Visual gate T027:** actual complete neighbourhood accepted. **Renderer release T032:** visual, precision, identity, resource and failure behavior pass together. **Product gate T052:** promised workflows, source profiles, device/access scope, restore and release controls pass.

Each gate records applicable scope and explicit exclusions. Future input profiles do not block a release that does not claim them. Conversely, classifying a feature as supported makes its negative tests and security obligations mandatory. A local single-operator release is not a tested production multi-user deployment.

## 8. Risk-based edge-case register
The following 70 cases are an initial structured register. Apply only relevant profiles to each task, link actual test names/results when implemented, and add newly discovered cases. This is not a promise that every possible failure is known in advance. The 28 earlier schema acceptance tests are mapped to these cases in `acceptance_traceability.json`.


### EC001 — Sources: Original bytes replaced by derivative
Expected: Original bytes, hash and revision-specific locator remain retrievable.

Test: API/asset integration. Tasks: T005, T011. Required when: First profiles. Status: Planned.

### EC002 — Sources: One source reused by multiple buildings or units
Expected: Share asset references and scoped links without duplicate storage or false attribution.

Test: Unit/API. Tasks: T005, T040. Required when: First profiles. Status: Planned.

### EC003 — Sources: Remove one attachment link while other references exist
Expected: Only the requested link changes; geometry and referenced original remain intact.

Test: API/storage. Tasks: T005, T040. Required when: First profiles. Status: Planned.

### EC004 — Safety: Traversal, symlink, archive bomb or excessive recursion
Expected: Reject unsafe extraction before side effects; account for declared and expanded limits.

Test: Adversarial integration. Tasks: T011, T049. Required when: Every file profile. Status: Planned.

### EC005 — Safety: XML/CAD/URL input tries an uncontrolled external fetch
Expected: No arbitrary file/network access; explicit safe-reference policy and structured failure.

Test: Adversarial integration. Tasks: T011, T049, T053. Required when: Every implemented external-reference profile. Status: Planned.

### EC006 — Adapters: Unknown version, XYZ/XYZM or unsupported geometry variant
Expected: Retain/reject with explicit profile/loss result; never silently drop a dimension.

Test: Contract/property. Tasks: T007, T011, T053. Required when: First profiles; richer dimensional support only when elected. Status: Planned.

### EC007 — Geometry: NaN, infinity, huge coordinates or malformed arrays
Expected: Reject finite/range/structure violations before geometry computation or allocation.

Test: Unit/fuzz. Tasks: T007, T011. Required when: First profiles. Status: Planned.

### EC008 — Frames: Swapped longitude/latitude or reflected axes
Expected: Use declared axes and reject ambiguous placement; known negative fixtures cannot pass by relabeling.

Test: Unit/property. Tasks: T006. Required when: First frames. Status: Planned.

### EC009 — Frames: Metres, feet and millimetres across source fields
Expected: Convert once with defined units; quantity scaling and physical interpretation agree.

Test: Unit/property. Tasks: T006, T007. Required when: First supported unit profiles. Status: Planned.

### EC010 — Frames: Already transformed coordinates are transformed again
Expected: Frame/revision references prevent double application; independent expected coordinates detect it.

Test: Unit/integration. Tasks: T006, T009. Required when: First frames. Status: Planned.

### EC011 — Frames: Unknown or incompatible vertical reference
Expected: Valid local/2D work remains usable; dependent world 3D/clearance result is unavailable, not zero offset.

Test: Unit/API. Tasks: T006, T007. Required when: First profiles. Status: Planned.

### EC012 — Frames: Two SRID-0 local origins treated as one frame
Expected: Transform through declared distinct frames before spatial comparison.

Test: Geometry integration. Tasks: T006, T012, T030. Required when: First multi-area slice. Status: Planned.

### EC013 — Plans: Scale-only, distorted or underdetermined plan calibration
Expected: Scale, geographic placement and vertical placement have separate gates and independent residual checks.

Test: Unit/browser. Tasks: T006, T044. Required when: Plan preparation. Status: Planned.

### EC014 — Geometry: Concave footprint, courtyard or multipart building
Expected: Retain supported holes/parts and quantities; do not replace by bounding box.

Test: Property/compiler. Tasks: T007, T017. Required when: First supported polygon profiles. Status: Planned.

### EC015 — Geometry: Tiny slivers, degeneracy, touching versus positive overlap
Expected: Use an explicit profile tolerance and contact/overlap definition; no silent repair or arbitrary deletion.

Test: Unit/property. Tasks: T007, T013, T022. Required when: First analytical operations. Status: Planned.

### EC016 — Geometry: Open mesh or visually closed but invalid solid
Expected: Rendering and valid-volume/intersection capability remain independent.

Test: Unit/geometry. Tasks: T007, T022, T053. Required when: First asset boundary; actual solid profile when elected. Status: Planned.

### EC017 — Semantics: Roof outline, ground occupation, approved envelope and parcel differ
Expected: Retain separate roles; compare only compatible meanings and purposes.

Test: Contract/domain. Tasks: T007, T008. Required when: First profiles. Status: Planned.

### EC018 — Missing data: Absent height, floor count, depth or final vertical bound
Expected: Show unknown and purpose-specific limits; never fabricate floors, infinite extents or safe clearance.

Test: Unit/API/browser. Tasks: T007, T013, T035. Required when: First profiles. Status: Planned.

### EC019 — Identity: Same source ID appears in two dataset namespaces
Expected: Namespaces are preserved; no false canonical collision.

Test: Unit/DB. Tasks: T004, T009, T011. Required when: First profiles. Status: Planned.

### EC020 — Identity: Equal names or close/overlapping geometry describe different things
Expected: Association remains explicit/source-backed; do not merge by proximity or label alone.

Test: Unit/property. Tasks: T004, T008. Required when: First profiles. Status: Planned.

### EC021 — Identity: External ID has leading zeros, aliases or ambiguity
Expected: Retain raw string, scheme/issuer and ambiguity; no numeric truncation or guessed official validity.

Test: Contract/API. Tasks: T004, T034. Required when: First profiles. Status: Planned.

### EC022 — Identity: Parcel/flat split, merge or rename
Expected: Stable identity survives renames; genuine splits/merges preserve lineage and retired IDs.

Test: Domain/history. Tasks: T004, T013. Required when: Core lifecycle; full edit workflows later. Status: Planned.

### EC023 — Buildings: Duplex, split-level, shared stair or repeated floor label
Expected: Use typed relationships; avoid duplicate counts and strict one-floor-per-unit assumptions.

Test: Domain/browser. Tasks: T004, T012, T039. Required when: First fixture plus inspection. Status: Planned.

### EC024 — Evidence: One plan supports multiple units/revisions
Expected: Exact page/row/object links remain scoped; changing one unit does not overwrite another fact.

Test: API/browser. Tasks: T005, T040. Required when: First sources plus inspection. Status: Planned.

### EC025 — Ingestion: Identical input and operation are replayed
Expected: One persisted effect and stable returned identity, with duplicate delivery acknowledged.

Test: API/DB. Tasks: T011, T012. Required when: First profiles. Status: Planned.

### EC026 — Ingestion: Same file hash but mapping, frame or profile changes
Expected: Create a tracked new interpretation; do not return a stale cached receipt.

Test: Unit/API. Tasks: T008, T011. Required when: First profiles. Status: Planned.

### EC027 — Concurrency: Concurrent duplicate imports race
Expected: Unique operation/identity constraints and transaction rules prevent duplicate effects.

Test: Real DB concurrency. Tasks: T010, T011. Required when: First write paths. Status: Planned.

### EC028 — Concurrency: A stale review or edit overwrites a newer revision
Expected: Expected-revision check rejects it and returns a recoverable conflict.

Test: Real DB/API. Tasks: T010, T031, T045. Required when: First write paths. Status: Planned.

### EC029 — Time/world: Observed, synthetic, future design or backdated correction mixed
Expected: Separate world, valid time, source time, recorded time and publication revision.

Test: Domain/API/history. Tasks: T008, T036, T041. Required when: First snapshots. Status: Planned.

### EC030 — Partial results: One bad contribution or interrupted acquisition hides missing items
Expected: Keep valid independent output, explicit item counts/completeness and failed roles.

Test: API/integration. Tasks: T011, T012, T031. Required when: First profiles. Status: Planned.

### EC031 — Environment: A test points to the populated operator database/volume
Expected: Preflight refuses destructive test execution; isolation verified by resource identity, not only port.

Test: Safety preflight. Tasks: T001, T010. Required when: All database tests. Status: Planned.

### EC032 — Migration: Interrupted/repeated backfill or upgrade of nonempty DB
Expected: Checkpoint/recover deterministically; retain IDs/hashes/history; compare counts and key mappings.

Test: Migration/restore. Tasks: T010, T051. Required when: First migration. Status: Planned.

### EC033 — Compatibility: Old client sees a new variant or revised meaning
Expected: Supported projection/version negotiation or explicit failure; no silent incorrect coercion.

Test: Consumer contract. Tasks: T007, T009, T010. Required when: First contract rollout. Status: Planned.

### EC034 — Cache: Two subscribers share a pending fetch and one cancels
Expected: Deduplication remains correct; independent consumer is not accidentally cancelled.

Test: Unit/browser race. Tasks: T014. Required when: Shared resource layer. Status: Planned.

### EC035 — Cache: Slow earlier response arrives after route or snapshot changes
Expected: Do not replace newer/current data; retain previous coherent snapshot during refresh where appropriate.

Test: Unit/browser race. Tasks: T014, T015. Required when: Shared resource layer. Status: Planned.

### EC036 — Privacy/cache: Access scope changes while requests/data are cached
Expected: Cancel/evict affected state and enforce access server-side; keying alone is insufficient.

Test: API/browser. Tasks: T014, T049. Required when: Any actual access-scoped profile. Status: Planned.

### EC037 — Selection: Selected mesh unloads or is replaced at another LOD
Expected: Retain canonical selection and lazy detail lookup; stale primitive picks are rejected.

Test: Browser/streaming. Tasks: T015, T020, T029. Required when: First tiled viewer. Status: Planned.

### EC038 — Selection: Map → register → unit → plan → back navigation
Expected: Entity, revision, selected level/unit and appropriate return camera remain coherent.

Test: End-to-end browser. Tasks: T015, T039, T042. Required when: Shared session plus inspection. Status: Planned.

### EC039 — Camera: Selecting a feature or fitting extent while in 2D
Expected: Camera remains top-down and visible mode matches actual projection.

Test: Browser interaction. Tasks: T016, T034. Required when: Shared viewport. Status: Planned.

### EC040 — Gestures: Held press then drag during React status updates
Expected: Movement/release listeners remain active; hold/drag/orbit and wheel-after-drag work.

Test: Browser + device. Tasks: T016, T021, T050. Required when: Shared viewport. Status: Planned.

### EC041 — Gestures: Pointer cancel, window blur or a drag interpreted as click
Expected: Recover control state and pointer capture; navigation does not trigger an unintended selection.

Test: Browser + device. Tasks: T016, T050. Required when: Shared viewport. Status: Planned.

### EC042 — Lifecycle: Hidden/remounted view retains buffers and event listeners
Expected: Pause/unmount/release correctly; no accumulating inactive full worlds.

Test: Browser/resource. Tasks: T016, T029. Required when: Shared viewport. Status: Planned.

### EC043 — Spatial identity: Building crosses two authoring blocks
Expected: One identity and full geometry with multiple memberships; no duplicated analytical quantities.

Test: Geometry/API. Tasks: T012, T030. Required when: First two-block fixture. Status: Planned.

### EC044 — Seams: Road/utility/terrain crosses tiles or tile packaging changes
Expected: Neighbour boundaries, continuity and physical width agree; fragments resolve to canonical objects.

Test: Compiler/browser. Tasks: T018, T020, T030. Required when: First tiled delivery. Status: Planned.

### EC045 — Topology: XY road crossing is grade separated or pipes are merely close
Expected: Do not invent connectivity; explicit system/network topology remains independent of projection.

Test: Geometry/domain. Tasks: T018, T030. Required when: Supported network profiles. Status: Planned.

### EC046 — Utilities: Pipe centre/crown/invert or diameter confused with restriction corridor
Expected: Use correct quantity and level reference; depth binds to the relevant surface revision.

Test: Unit/geometry. Tasks: T007, T018, T035. Required when: Supported utility profile. Status: Planned.

### EC047 — Findings: Road overlap is a subset of total parcel overhang
Expected: Do not sum overlapping regions as disjoint area; show exact result geometry and metric definitions.

Test: Unit/browser. Tasks: T022, T035. Required when: Supported finding operations. Status: Planned.

### EC048 — Display invariance: LOD, clipping, explosion, style or camera changes
Expected: Fixed analytical revision retains identity and numerical results within its declared computational tolerance.

Test: Metamorphic/browser. Tasks: T022, T039. Required when: All render modes. Status: Planned.

### EC049 — Determinism: Source order, unrelated record or tile ID changes
Expected: Stable entity/component seeds and input signatures preserve unchanged appearance/geometry.

Test: Property/compiler. Tasks: T019, T020. Required when: Scene compiler. Status: Planned.

### EC050 — Streaming: Child tile fails or arrives after rapid navigation
Expected: Keep valid coarse fallback, cancel stale work and avoid duplicate parent/child display.

Test: Browser/fault injection. Tasks: T020, T029. Required when: First tiled delivery. Status: Planned.

### EC051 — Publication: Assets upload but DB commit fails, or vice versa
Expected: No half-publication becomes active; validate staged assets and keep prior coherent pointer.

Test: Storage/DB fault injection. Tasks: T020, T031. Required when: First publication path. Status: Planned.

### EC052 — Workers: Worker is killed or job delivered again
Expected: Bounded retries/checkpoints and idempotent effects; incomplete run status/counts recover honestly.

Test: Worker fault injection. Tasks: T031. Required when: Durable build workers. Status: Planned.

### EC053 — Invalidation: Geometry changes versus PDF/occupancy/style-only change
Expected: Rebuild actual dependent geometry/tiles; stale review and display invalidation remain distinct.

Test: Unit/integration. Tasks: T008, T031. Required when: First revisioned derivatives. Status: Planned.

### EC054 — Coverages: Raster no-data or cloud samples mistaken for ground/building records
Expected: Preserve surface meaning/resolution/time and assets; no row-per-sample or fabricated completeness.

Test: Adapter/geometry. Tasks: T054. Required when: Only elected coverage/cloud profiles. Status: Planned.

### EC055 — Geography: Antimeridian, polar extent or unsupported analytical frame
Expected: Operate only within declared coverage; reject unsupported cases explicitly rather than distort.

Test: Catalog/geometry. Tasks: T030, T056. Required when: Declared geographic profile. Status: Planned.

### EC056 — Scale: Huge catalog mistaken for full visible workload
Expected: Bounded paging/coverage queries; separate catalog count, downloaded content and visible-frame capacity.

Test: API/performance. Tasks: T028, T032, T056. Required when: First coverage catalog. Status: Planned.

### EC057 — Renderer: Material/picking/clipping extension unsupported by pinned version
Expected: Qualified fixture fails the engine gate; choose supported profile or record a concrete alternative decision.

Test: Actual browser/engine. Tasks: T021. Required when: Pinned renderer qualification. Status: Planned.

### EC058 — Performance: Software GPU/headless results presented as physical-device performance
Expected: Record exact hardware/browser/DPR/workload; separate cold/warm and emulate/physical measurements.

Test: Benchmark protocol. Tasks: T032, T050. Required when: Every performance claim. Status: Planned.

### EC059 — Recovery: WebGL context loss, corrupt asset or expired source URL
Expected: Recover or expose a usable limited state; quarantine bad content without destroying canonical data.

Test: Browser/fault injection. Tasks: T021, T029, T049. Required when: Implemented runtime profile. Status: Planned.

### EC060 — Responsive UI: Small viewport, large text/zoom, keyboard or on-screen keyboard
Expected: Primary actions, panels and focus stay reachable; no trapped or hidden essential controls.

Test: Browser + device. Tasks: T033, T036, T050. Required when: Promised UI profiles. Status: Planned.

### EC061 — Accessibility: Status relies on color, drag alone or uncontrolled motion
Expected: Provide text/shape state, keyboard alternatives and reduced-motion behavior for essential actions.

Test: Accessibility/device. Tasks: T034, T039, T050. Required when: Promised UI profiles. Status: Planned.

### EC062 — Privacy/export: Tiles, logs, thumbnails or exports disclose private content
Expected: Use allowlisted geometry-safe fields and permissioned detail/source routes; no secrets in artifacts.

Test: Security/API. Tasks: T005, T020, T036, T049. Required when: Every source/derived output. Status: Planned.

### EC063 — History: Historical snapshot silently uses latest/private-unavailable source
Expected: Bind revision-specific evidence and permissions; unavailable or redacted content stays explicit.

Test: API/history. Tasks: T036, T040, T041. Required when: History and source viewers. Status: Planned.

### EC064 — Transfer: Installing a data bundle overwrites subsequent local edits
Expected: Preserve additive semantics and stop identity conflicts; installation is not continuous sync.

Test: Upgrade/integration. Tasks: T010, T051. Required when: Supported transfer path. Status: Planned.

### EC065 — Operations: Disk full, missing object or checksum mismatch
Expected: Fail safely with identifiable incomplete stage; do not fabricate replacement data or activate invalid content.

Test: Storage fault injection. Tasks: T011, T031, T051. Required when: Every persisted build/import. Status: Planned.

### EC066 — Resources: Multiple parsers/builds exhaust CPU/memory concurrently
Expected: Bounded concurrency, backpressure and cancellation with reconciled item/job status.

Test: Worker/performance. Tasks: T011, T029, T031, T054. Required when: Implemented async/bulk profiles. Status: Planned.

### EC067 — Editing: Undo/redo or reload modifies accepted/unrelated draft data
Expected: Undo is scoped to a known candidate revision; unsaved changes and recovery are explicit.

Test: Unit/browser/API. Tasks: T045. Required when: Draft editing. Status: Planned.

### EC068 — Visual QA: Blindly updating screenshots hides an actual regression
Expected: Require reasoned rebaseline and independent geometric/behavioral checks; preserve user visual decision.

Test: Review protocol. Tasks: T027, T037, T048. Required when: All visual changes. Status: Planned.

### EC069 — Source use: Service image is treated as geometry or redistribution rights are missing
Expected: Keep content type, acquisition scope and source-use restrictions explicit; no inferred legal/semantic capability.

Test: Adapter/review. Tasks: T002, T011, T049, T053. Required when: Every external source profile. Status: Planned.

### EC070 — Maintenance: Proof directory resolves outside target or includes junctions
Expected: Stop exact-path cleanup before traversal; product/source/study folders remain protected.

Test: Filesystem preflight. Tasks: M001. Required when: Only explicitly authorized proof cleanup. Status: Planned.
