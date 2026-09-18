# Ordered task backlog

Generated from `backlog.json`, plan version 1.2. Accepted execution tasks: 6/56. A mapping or detailed plan is not implementation evidence. Future plan paths are reserved until authored.

## E01 — Baseline and operating contract
Exit: A reproducible starting point and bounded first-slice requirements.

### T001 — Repository branch and fresh preservation baseline
**Status:** Accepted. **Release:** R1-renderer. **Suggested owner:** Architecture lead.

**Dependencies:** None; environment and authorization requirements still apply.

**Scope:** Re-establish the actual repository, test environment and preservation invariants before editing the product. A cloud checkout and isolated fixtures are valid; PC-only state is a separate gate.

**Outputs:** Fresh Git/environment manifest; allowed-file boundaries; source/ID/frame inventory; characterized test results.

**Acceptance:** Known branch and base revision; unrelated work untouched; baseline distinguishes pass, fail and blocked; test database is isolated.

**Excluded:** Product redesign, migrations against the live database, dependency upgrades and implicit reseeding.

**Earlier references:** schema:U01, renderer:R03.

**Detailed plan:** `tasks/T001_BASELINE_PLAN.md` — authored; inspect its status before execution.

### T002 — Reference, requirements and fixture acceptance contract
**Status:** Accepted. **Release:** R1-renderer. **Suggested owner:** Product/visual lead.

**Dependencies:** T001.

**Scope:** Reconcile current requirements and the recovered reference packs into named outcomes and capability-specific visual targets.

**Outputs:** Requirement IDs; reference hash/screen mapping; F01–F09 fixture specifications; declared device and camera suite.

**Acceptance:** Every primary screen has an anchor or an explicit design gap; dense and sparse inputs have honest targets; contradictory mockup numbers are not requirements.

**Excluded:** Recreating all UI screens or claiming original-chat completeness.

**Earlier references:** schema:U02, schema:U16, renderer:R01, renderer:R02, renderer:R04, renderer:R05.

**Detailed plan:** `tasks/T002_PLAN.md` — authored; inspect its status before execution.

### T003 — Architecture decisions and smallest proving experiments
**Status:** Accepted. **Release:** R1-renderer. **Suggested owner:** Architecture lead.

**Dependencies:** T002.

**Scope:** Resolve only choices that block the thin core: contract authority, legacy boundaries, frame meaning and renderer integration.

**Outputs:** Short ADRs; contract parity experiment design; keep/adapt/replace inventory; first-slice scope and dependency rules.

**Acceptance:** One contract authoring authority and one writer per record are nominated; exact unknowns have proving experiments and stop conditions.

**Excluded:** A new backend, mandatory microservices, a graph database, or committing to all future geometry kernels.

**Earlier references:** schema:U15, schema:U21, renderer:R03, renderer:R06.

**Detailed plan:** `tasks/T003_PLAN.md` — authored; inspect its status before execution.

## E02 — Thin unified model
Exit: Runtime-checked core contracts exercised by fixtures, not 53 new tables.

### T004 — Stable identity, vocabulary and typed relationships
**Status:** Accepted. **Release:** R1-renderer. **Suggested owner:** Architecture lead.

**Dependencies:** T003.

**Scope:** Define and exercise stable entities/revisions, aliases, non-exclusive memberships and relationships against tiny examples.

**Outputs:** Runtime-validated identity/relation contracts; legacy namespace rules; no-invention value states; fixture tests.

**Acceptance:** Rename and retile do not change IDs; a duplex can reference two levels; equal labels are not automatic matches; ambiguous legal/physical links remain unresolved.

**Excluded:** Automatic fuzzy deduplication or a complete legal registry workflow.

**Earlier references:** schema:U03, schema:U04, schema:U09, renderer:D01.

**Detailed plan:** `tasks/T004_PLAN.md` — authored; inspect its status before execution.

### T005 — Reusable sources, original assets and exact evidence links
**Status:** Accepted. **Release:** R1-renderer. **Suggested owner:** Data/backend.

**Dependencies:** T004.

**Scope:** Represent dataset and source revisions and exact source parts while reusing existing stored originals.

**Outputs:** Source/asset/source-part contracts; optional many-to-many evidence links; access and retention metadata.

**Acceptance:** One original can support multiple objects; zero documents is valid; removing one link cannot remove bytes still referenced elsewhere.

**Excluded:** Copying existing bytes per building, cloud migration or real personal-data ingestion.

**Earlier references:** schema:U05, schema:U11, schema:U12, renderer:D04.

**Detailed plan:** `tasks/T005_PLAN.md` — authored; inspect its status before execution.

### T006 — Frames, transforms and vertical-reference semantics
**Status:** Accepted. **Release:** R1-renderer. **Suggested owner:** Geometry lead.

**Dependencies:** T004.

**Scope:** Make units, axes, local origins and vertical meaning explicit; qualify the first supported transform profiles.

**Outputs:** Frame and operation contracts; source-to-analysis/render transform profiles; independent numeric test vectors.

**Acceptance:** Metres/feet and rotated local fixtures transform correctly; unresolved vertical ties block dependent 3D comparisons; geographic coverage is not a measurement frame.

**Excluded:** Relabeling SRIDs, rewriting historical geometry in place or implementing every geodetic operation.

**Earlier references:** schema:U06, renderer:D03.

**Detailed plan:** `tasks/T006_PLAN.md` — authored; inspect its status before execution.

### T007 — Geometry representations, quantities and capability checks
**Status:** In progress. **Release:** R1-renderer. **Suggested owner:** Geometry lead.

**Dependencies:** T005, T006.

**Scope:** Separate analytical and display geometry and implement validators for the first polygon/prism/asset-reference profiles.

**Outputs:** Discriminated representation and quantity contracts; purpose-specific readiness evaluator; TypeScript/Python conformance fixtures.

**Acceptance:** Holes and multipart geometry survive; unknown is not zero; renderability does not imply volume readiness; unsupported geometry is explicit.

**Excluded:** Arbitrary-solid Boolean operations or treating an external mesh parser as complete support.

**Earlier references:** schema:U03, schema:U07, schema:U09, schema:U10, schema:U11, renderer:D02, renderer:D07.

**Detailed plan:** `tasks/T007_PLAN.md` — authored; inspect its status before execution.

### T008 — Observations, source composition and coherent snapshots
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Architecture lead.

**Dependencies:** T007.

**Scope:** Define selected contributions without erasing conflicting facts and bind output to immutable input revisions.

**Outputs:** Observation/resolution/composition and publication contracts; deterministic input signatures; snapshot/permission rules.

**Acceptance:** A footprint, level schedule and unit source combine without invented evidence; a failed unrelated contribution does not erase valid output; worlds and revisions do not mix.

**Excluded:** A universal rule language, arbitrary uploaded code or a full publication service before its first consumer.

**Earlier references:** schema:U08, schema:U13, schema:U14, renderer:D05, renderer:C01.

**Detailed plan:** `tasks/T008_PLAN.md` — write just before execution.

## E03 — Compatibility and first normalization
Exit: Existing records and named input profiles use the new boundary without loss.

### T009 — Read-only legacy compatibility adapter
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Data/backend.

**Dependencies:** T008.

**Scope:** Expose existing physical features, registry records, sources and frames through the new contract without replacing current writers.

**Outputs:** Small read adapter and first internal consumer; explicit ID crosswalk; parity and unknown-value tests.

**Acceptance:** Existing IDs, original hashes and historical frame references remain resolvable; old routes keep working; physical and legal records are not collapsed by coincidence.

**Excluded:** Dual canonical databases, destructive backfills or swallowing unsupported legacy records.

**Earlier references:** schema:U01, schema:U04, schema:U15, renderer:D06.

**Detailed plan:** `tasks/T009_PLAN.md` — write just before execution.

### T010 — Minimal additive storage and one-writer migration rehearsal
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Data/backend.

**Dependencies:** T009.

**Scope:** Add only persistence required by a demonstrated missing relation or snapshot; test upgrade paths in an isolated database.

**Outputs:** Versioned migrations and ledger if needed; restart-safe backfill; writer-ownership table; compatibility/rollback experiment.

**Acceptance:** Fresh and existing databases are tested; rerun does not duplicate; failed migration leaves a defined recoverable state; old/new app compatibility is explicitly checked.

**Excluded:** Dropping legacy tables, overwriting repository volumes or an ad hoc live database reset.

**Earlier references:** schema:U05, schema:U15.

**Detailed plan:** `tasks/T010_PLAN.md` — write just before execution.

### T011 — First supported input profiles and retry-safe normalization
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Data/geometry.

**Dependencies:** T010.

**Scope:** Wrap the existing bounded GIS and schedule paths plus canonical interchange with the new contracts.

**Outputs:** Profile descriptors; operation-key semantics; per-item results; source preservation and adapter equivalence tests.

**Acceptance:** Same input/profile/mapping replay has no duplicate effect; changed mapping is tracked; unavailable profiles fail explicitly; existing safety bounds remain.

**Excluded:** All IFC/CAD/cloud formats or removing size limits to call the importer scalable.

**Earlier references:** schema:U02, schema:U08, schema:U17, schema:U19, renderer:D06.

**Detailed plan:** `tasks/T011_PLAN.md` — write just before execution.

## E04 — Mixed-source proving slice
Exit: The persisted two-block demonstration and negative tests pass.

### T012 — Persisted two-block multi-source demonstration
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Full-stack/geometry.

**Dependencies:** T011.

**Scope:** Exercise one real API/storage path from source receipt and composition to the linked two-block scene read model.

**Outputs:** Executable synthetic fixture; API integration test; expected object graph and analytical measurements; zero-document case.

**Acceptance:** One 80 m² synthetic building and 480 m³ exterior prism cross blocks without duplicate identity; its levels/units/parcel/utility sources stay traceable.

**Excluded:** Calling this an actual Uttam Nagar survey or pretending planning arithmetic is a executed test.

**Earlier references:** schema:U09, schema:U13, schema:U16, renderer:R04, renderer:D08.

**Detailed plan:** `tasks/T012_PLAN.md` — write just before execution.

### T013 — Foundation negatives, compatibility and acceptance gate
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Independent reviewer/QA.

**Dependencies:** T012.

**Scope:** Verify the foundation against negative and metamorphic cases before expanding the renderer.

**Outputs:** Foundation gate report; negative fixtures; old-route regression results; unresolved-risk decisions.

**Acceptance:** Unknown heights, mixed frames, repeated imports, conflicting sources and private fields behave correctly; no protected baseline invariant regresses.

**Excluded:** Waiving data loss or using a passing typecheck as complete integration proof.

**Earlier references:** schema:U16, schema:U20, schema:U21, renderer:D07, renderer:D08.

**Detailed plan:** `tasks/T013_PLAN.md` — write just before execution.

## E05 — Shared data/session/viewport architecture
Exit: One consistent selection/data boundary with independently releasable render resources.

### T014 — Shared revision-aware query and invalidation layer
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Frontend/data.

**Dependencies:** T013.

**Scope:** Deduplicate shared server reads and maintain coherent data by scope, entity and revision while preserving stale-response protection.

**Outputs:** Shared resource client/cache; keys and invalidation policy; race/cancel/navigation tests; migrated first consumers.

**Acceptance:** One pending fetch serves compatible subscribers; cancelling one subscriber does not break others; old responses cannot replace newer snapshots; permission changes clear affected data.

**Excluded:** Storing all server entities in Zustand or silently introducing an unbounded permanent cache.

**Earlier references:** New explicit user/architecture requirement.

**Detailed plan:** `tasks/T014_PLAN.md` — write just before execution.

### T015 — One map and inspection session
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Frontend.

**Dependencies:** T014.

**Scope:** Extend the existing state boundary for canonical selection, layers, view mode, camera return and selected level/unit.

**Outputs:** Session model, route synchronization and pure selectors; selection/undo-of-navigation tests.

**Acceptance:** Map/register/plan return to the same entity and unit; invalid/deleted IDs resolve explicitly; unloaded geometry does not clear a valid selection.

**Excluded:** A second competing global store or saving private dossiers in browser storage.

**Earlier references:** New explicit user/architecture requirement.

**Detailed plan:** `tasks/T015_PLAN.md` — write just before execution.

### T016 — Reusable viewport/controller and resource lifecycle boundary
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Rendering/frontend.

**Dependencies:** T015.

**Scope:** Separate camera/picking/scene lifecycle from page shells with one stable renderer-facing contract.

**Outputs:** Shared viewport/controller interface; integration of first two existing views; lifecycle and interaction characterization.

**Acceptance:** Page changes do not duplicate a full world; inactive contexts release or pause resources; held gestures survive unrelated React updates.

**Excluded:** An engine rewrite, a hidden screenshot replacing 3D, or specialized views owning different data truth.

**Earlier references:** renderer:C06.

**Detailed plan:** `tasks/T016_PLAN.md` — write just before execution.

## E06 — Scene compiler and first streamed renderer
Exit: A small real tiled viewport qualifies IDs, geometry, measurements and the pinned engine.

### T017 — Snapshot-to-geometry scene compiler
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Geometry/rendering.

**Dependencies:** T016.

**Scope:** Compile supported polygons, holes, building parts and declared height profiles into traceable display geometry.

**Outputs:** Deterministic compiler stages and manifests; analytical-to-display ID mapping; geometry conformance tests.

**Acceptance:** Concavity, holes and supported multipart extents are retained; fixed inputs give stable geometry signatures; unsupported shapes remain explicit.

**Excluded:** Browser-side re-parsing of every source or substituting bounding boxes for supplied geometry.

**Earlier references:** renderer:C01, renderer:C02.

**Detailed plan:** `tasks/T017_PLAN.md` — write just before execution.

### T018 — Road, ground and utility compiler profiles
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Geometry/rendering.

**Dependencies:** T017.

**Scope:** Produce first supported surfaces and utility profiles with neighbour context and explicit ground/depth meaning.

**Outputs:** Road/surface and utility compilation; declared width/profile policy; topology and seam fixtures.

**Acceptance:** Variable widths and junctions do not double physical area; unknown depth stays unknown; overhead crossings do not invent a network junction.

**Excluded:** Generating measured roads from arbitrary buffers or requiring a complete national terrain dataset.

**Earlier references:** schema:U10, renderer:C03.

**Detailed plan:** `tasks/T018_PLAN.md` — write just before execution.

### T019 — Deterministic materials and reusable architectural recipes
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Rendering/technical art.

**Dependencies:** T018.

**Scope:** Introduce versioned source-preserving, neutral and explicitly illustrative appearance profiles.

**Outputs:** Reusable material/part vocabulary; stable entity-based seeds; style versioning and derivation signatures.

**Acceptance:** Changing tile order does not randomize facades; metric texture scale is consistent; illustrative projections do not enter observed analytical geometry.

**Excluded:** Handcrafting locality-specific render code or adding observed balconies and rooms from a footprint.

**Earlier references:** renderer:C01, renderer:C04.

**Detailed plan:** `tasks/T019_PLAN.md` — write just before execution.

### T020 — First multi-tile delivery and stable feature metadata
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Streaming/rendering.

**Dependencies:** T019.

**Scope:** Package a small real multi-tile scene with bounded LOD, canonical-ID maps and a coherent immutable manifest.

**Outputs:** Tested glTF/3D Tiles delivery subset; local placement, bounds, coarse fallback and ID mapping tests.

**Acceptance:** A seam-spanning object picks as one entity; tile and LOD IDs are not property IDs; incomplete builds never replace the active manifest.

**Excluded:** National-scale claims, unbounded all-feature endpoints or optimizing tile size without measurements.

**Earlier references:** schema:U14, renderer:C05.

**Detailed plan:** `tasks/T020_PLAN.md` — write just before execution.

### T021 — Pinned renderer integration and compatibility qualification
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Rendering lead.

**Dependencies:** T020.

**Scope:** Load the shared compiled content in the existing product and qualify the actual Cesium/browser versions.

**Outputs:** Minimal streamed viewport; picking/material/clipping/loading checks; engine decision record.

**Acceptance:** Navigation, selection, materials and supported clipping work on the pinned stack; concrete blockers are demonstrated before considering another renderer.

**Excluded:** Declaring compatibility from current online documentation or migrating engines merely for a prettier demo.

**Earlier references:** renderer:C06, renderer:C08.

**Detailed plan:** `tasks/T021_PLAN.md` — write just before execution.

### T022 — Measurement probes and render-foundation gate
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Geometry/QA.

**Dependencies:** T021.

**Scope:** Resolve measurements against the selected analytical representation and verify display independence.

**Outputs:** Measurement probes; scale/section fixtures; exact-versus-approximate response contract; renderer-foundation acceptance.

**Acceptance:** LOD, camera and explosion do not change analytical quantities; local synthetic placement meets the declared tolerance; missing exact geometry returns unavailable or approximate explicitly.

**Excluded:** Measuring cadastral quantities from screen pixels or declaring source accuracy from decimal places.

**Earlier references:** schema:U07, schema:U20, renderer:C07, renderer:C08.

**Detailed plan:** `tasks/T022_PLAN.md` — write just before execution.

## E07 — Complete-neighbourhood visual quality
Exit: Full-map and diverse dataset views pass correctness and user visual acceptance.

### T023 — Complete reference-style neighbourhood through the pipeline
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Rendering/technical art.

**Dependencies:** T022.

**Scope:** Generate the entire coherent F01 neighbourhood through the common model/compiler instead of assembling a disconnected hero scene.

**Outputs:** Multi-tile complete-map candidate with coherent roads, buildings, context and a detailed selected building.

**Acceptance:** All visible content is produced through shared inputs/recipes; numerical records are internally consistent; multiple camera views reveal complete neighbourhood coverage.

**Excluded:** One attractive building being marked as the complete-map milestone.

**Earlier references:** renderer:V01.

**Detailed plan:** `tasks/T023_PLAN.md` — write just before execution.

### T024 — Architecture, facade and material fidelity refinement
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Rendering/technical art.

**Dependencies:** T023.

**Scope:** Improve silhouettes, roof/part variation, facade depth and material scale within the declared fidelity policy.

**Outputs:** One reusable recipe refinement at a time; paired scene-only comparisons; full-map regression captures.

**Acceptance:** Reverse and close-up views remain credible; narrow spaces retain modeled dimensions; sparse datasets receive a deliberate neutral fallback.

**Excluded:** Per-building special-case code or moving buildings to achieve a cleaner composition.

**Earlier references:** renderer:V02, renderer:V04.

**Detailed plan:** `tasks/T024_PLAN.md` — write just before execution.

### T025 — Grounding, lighting and alternate-view fidelity
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Rendering/technical art.

**Dependencies:** T024.

**Scope:** Tune streets, ground contact, lighting and 2D/section/underground presentation without hiding defects.

**Outputs:** Fixed camera/lighting profiles; moving-image captures; alternate-state baselines.

**Acceptance:** No floating/sunken geometry, severe texture shimmer or opaque exterior covering a cutaway; overlays distinguish horizontal clearance and depth.

**Excluded:** Bloom/blur hiding incorrect geometry or an unrelated 2D illustration.

**Earlier references:** renderer:V03, renderer:V04, renderer:V05.

**Detailed plan:** `tasks/T025_PLAN.md` — write just before execution.

### T026 — Dense, sloped, sparse and held-out visual transfer
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Data/QA.

**Dependencies:** T025.

**Scope:** Run the same pipeline on F02–F07 and a held-out shape family without locality-specific renderer edits.

**Outputs:** Dataset/quality-profile matrix; dense Uttam Nagar-style result; capability fallback and seam evidence.

**Acceptance:** No widening alleys or filling courtyards; missing evidence is explicit; general rules, not locality-specific branches, handle failures.

**Excluded:** Claiming the held-out data remained held out after tuning to it; replace the holdout after leakage.

**Earlier references:** renderer:R04, renderer:V06, renderer:S05.

**Detailed plan:** `tasks/T026_PLAN.md` — write just before execution.

### T027 — Full-map visual acceptance checkpoint
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** User visual review + QA.

**Dependencies:** T026.

**Scope:** Review actual unretouched browser output against the approved anchors and independent correctness checks.

**Outputs:** Per-view comparison and limitations; user acceptance/rejection record; pinned real-render regression baselines.

**Acceptance:** Every critical applicable scene dimension passes its approved target and the user accepts the scene; no average score hides geometry or interaction failures.

**Excluded:** Self-declaring user approval or calling a generated mockup runtime evidence.

**Earlier references:** renderer:R02, renderer:V07, renderer:V08.

**Detailed plan:** `tasks/T027_PLAN.md` — write just before execution.

## E08 — Cross-area reliability and bounded resources
Exit: R1: reusable renderer foundation with measured delivery and recovery.

### T028 — World coverage catalog and unloaded-entity resolution
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Backend/streaming.

**Dependencies:** T027.

**Scope:** Expand the early multi-tile manifest into permission/scenario-aware coverage discovery and canonical lookup.

**Outputs:** Bounded coverage/detail endpoints; full-identity resolver; pagination and overlap policy tests.

**Acceptance:** Search resolves an unloaded entity without loading the whole city; overlapping datasets require an explicit representation choice; unplaced records remain searchable.

**Excluded:** A universal global all-geometry response or existence inferred from GPU residency.

**Earlier references:** schema:U14, renderer:S01.

**Detailed plan:** `tasks/T028_PLAN.md` — write just before execution.

### T029 — Bounded loading, cancellation and CPU/GPU release
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Streaming/rendering.

**Dependencies:** T028.

**Scope:** Apply a measured budget across all active content and preserve useful fallback during travel.

**Outputs:** Priority loading/cache lifecycle; cancellation and decode/upload controls; teardown and memory-plateau traces.

**Acceptance:** Rapid travel cancels obsolete work; coarse context persists; multiple tilesets fit the combined budget; repeated route loops do not show unbounded resource growth.

**Excluded:** Treating hidden objects as unloaded or a per-tileset cache as a total process budget.

**Earlier references:** renderer:S02.

**Detailed plan:** `tasks/T029_PLAN.md` — write just before execution.

### T030 — Cross-area seam, topology and precision qualification
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Geometry/QA.

**Dependencies:** T029.

**Scope:** Verify neighbour-aware geometry and frame agreement across multiple authoring areas and render boundaries.

**Outputs:** Boundary fixtures, world-placement probes, duplicate-pick checks and declared geographic support profile.

**Acceptance:** No cracks/double roads/identity duplication at seams; supported frame changes preserve quantities; unsupported polar/antimeridian cases are rejected explicitly.

**Excluded:** Implying worldwide cadastral accuracy from a local Delhi test.

**Earlier references:** schema:U20, renderer:S03.

**Detailed plan:** `tasks/T030_PLAN.md` — write just before execution.

### T031 — Incremental rebuilds and atomic publication recovery
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Backend/streaming.

**Dependencies:** T030.

**Scope:** Implement durable build/update orchestration and switch coherent publications without cross-store half-states.

**Outputs:** Dependency invalidation graph; staged immutable assets; transactional publication pointer; job retry/failure recovery.

**Acceptance:** Interrupted work leaves the prior snapshot usable; duplicate deliveries have one recorded effect; evidence-only changes avoid unrelated mesh rebuilds; stale writers cannot overwrite new revisions.

**Excluded:** Claiming exactly-once delivery or a database transaction spanning object storage.

**Earlier references:** schema:U14, schema:U19, renderer:S04.

**Detailed plan:** `tasks/T031_PLAN.md` — write just before execution.

### T032 — Resource/failure benchmarks and renderer release gate
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** QA/performance.

**Dependencies:** T031.

**Scope:** Qualify a useful declared renderer release using measured visible workload and scale catalogs.

**Outputs:** Cold/warm timing, memory and failure reports; supported device/dataset profile; R1 decision.

**Acceptance:** Visual, identity, geometry and resource gates pass together; 10k then 100k catalog stress is explicitly scoped; untested million-feature capacity is deferred.

**Excluded:** Blocking all useful release on a 1M catalog or presenting catalog size as visible building capacity.

**Earlier references:** renderer:R05, renderer:S05, renderer:S06.

**Detailed plan:** `tasks/T032_PLAN.md` — write just before execution.

## E09 — Map interface rebuild
Exit: Map workflows meet the shared visual and state contract.

### T033 — Shared design tokens and map shell
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Frontend.

**Dependencies:** T032.

**Scope:** Build the reference-led map shell around the qualified renderer with shared accessible UI primitives.

**Outputs:** Tokens, shell/layout and common controls; reference-matched desktop states; loading/empty/error variants.

**Acceptance:** Actual 3D remains dominant; header and rail proportions match the agreed anchor; no primary action is clipped at supported viewports.

**Excluded:** Independent CSS themes per page or a new synthetic data store for visual convenience.

**Earlier references:** renderer:U01.

**Detailed plan:** `tasks/T033_PLAN.md` — write just before execution.

### T034 — Camera, layers and global-search interface
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Frontend.

**Dependencies:** T033.

**Scope:** Expose common navigation and filters without changing identity or analytical scope.

**Outputs:** Camera/layer/search controls and keyboard behaviour; unloaded-area selection flow.

**Acceptance:** 2D mode stays top-down; layer hiding does not turn an incomplete analysis into all-clear; ambiguous identifiers require a choice.

**Excluded:** Owner/resident search in public geometry metadata or assuming visible features are all features.

**Earlier references:** renderer:U02.

**Detailed plan:** `tasks/T034_PLAN.md` — write just before execution.

### T035 — Property inspector, findings and utility inspection
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Frontend/geometry.

**Dependencies:** T034.

**Scope:** Connect canonical selection to defined metrics, exact findings and useful utility sections.

**Outputs:** Contextual inspector and findings flow; geometry overlays; missing/evidence states.

**Acceptance:** Actual difference/intersection geometry is shown; overlapping findings are not double-counted; missing depth is not safe clearance.

**Excluded:** Replacing computed regions with whole-building highlights or prewritten metrics.

**Earlier references:** renderer:U03, renderer:U04.

**Detailed plan:** `tasks/T035_PLAN.md` — write just before execution.

### T036 — Map history, exports and responsive panels
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Frontend.

**Dependencies:** T035.

**Scope:** Add snapshot history and scoped exports with usable desktop/mobile panel behaviour.

**Outputs:** Read-only history mode; export manifest/scope; responsive drawers/sheets; permission checks.

**Acceptance:** History stays on one snapshot; export includes definitions and provenance; controls remain reachable with keyboard, zoom and a small viewport.

**Excluded:** Exporting private files because geometry is public or asserting physical-phone testing from emulation.

**Earlier references:** renderer:U05.

**Detailed plan:** `tasks/T036_PLAN.md` — write just before execution.

### T037 — Map interface acceptance gate
**Status:** Planned. **Release:** R2-product. **Suggested owner:** QA + user visual review.

**Dependencies:** T036.

**Scope:** Verify every promised map state against the same design and behavioral contract.

**Outputs:** UI-01–UI-07 evidence map; route/gesture/error regression; known limitations.

**Acceptance:** Map states meet visual, accessibility and interaction requirements without regressing renderer gates.

**Excluded:** Calling all screens finished from one hero screenshot.

**Earlier references:** renderer:U06.

**Detailed plan:** `tasks/T037_PLAN.md` — write just before execution.

## E10 — Building, floor, unit and evidence interfaces
Exit: Plan/model/table/source views agree on the same records and quantities.

### T038 — Building/register composition on the shared model
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Frontend.

**Dependencies:** T037.

**Scope:** Replace the register presentation while preserving the existing linked product workflow.

**Outputs:** Live building view, summary and record panels using canonical IDs and the shared resource layer.

**Acceptance:** Exterior-only and zero-document buildings are supported; navigation returns to the correct block and property.

**Excluded:** Inventing detailed units because the panel needs content.

**Earlier references:** renderer:I01.

**Detailed plan:** `tasks/T038_PLAN.md` — write just before execution.

### T039 — Floor/unit plans, shared spaces and section interactions
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Frontend/geometry.

**Dependencies:** T038.

**Scope:** Derive plan/model/table views from one selected representation and declared relations.

**Outputs:** Linked level/unit selector; shared plan geometry; section and explosion views; duplex/shared-space fixtures.

**Acceptance:** Same unit is selected everywhere; net/gross/footprint areas have explicit definitions; display explosion does not change levels or quantities.

**Excluded:** Independent floor layouts in SVG, PDF and 3D or a strict one-level-per-unit tree.

**Earlier references:** schema:U09, schema:U20, renderer:V05, renderer:I02, renderer:I03.

**Detailed plan:** `tasks/T039_PLAN.md` — write just before execution.

### T040 — Optional evidence viewers and access scopes
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Frontend/backend.

**Dependencies:** T039.

**Scope:** Attach and display exact source parts at building/level/unit scope without making evidence universally mandatory.

**Outputs:** Direct/inherited links; versioned viewers/thumbnails/downloads; attachment and unlink flows.

**Acceptance:** Correct source revision and locator are retained; removing one link leaves other consumers intact; private documents remain permission-scoped.

**Excluded:** Blob deletion without reference/retention checks or automatic legal acceptance of attached documents.

**Earlier references:** schema:U12, renderer:I04.

**Detailed plan:** `tasks/T040_PLAN.md` — write just before execution.

### T041 — Record history, issues and investigations
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Frontend/backend.

**Dependencies:** T040.

**Scope:** Expose existing review/investigation lifecycle and history with versioned evidence.

**Outputs:** History/issue/investigation pages; state transition and stale-decision tests.

**Acceptance:** Earlier revisions remain navigable; stale evidence cannot silently resolve an issue; source disagreement is not automatically a legal violation.

**Excluded:** Reinventing a competing workflow state machine for a new page.

**Earlier references:** renderer:I05.

**Detailed plan:** `tasks/T041_PLAN.md` — write just before execution.

### T042 — Inspection and zero-document acceptance gate
**Status:** Planned. **Release:** R2-product. **Suggested owner:** QA + user visual review.

**Dependencies:** T041.

**Scope:** Qualify register/floor/unit/source flows as one connected product surface.

**Outputs:** UI-08–UI-12 results; cross-view identity/quantity tests; responsive/keyboard checks.

**Acceptance:** The complete selection-to-source-to-return flow is coherent with missing, private and absent evidence.

**Excluded:** Passing only the model or only the table while the combined journey fails.

**Earlier references:** renderer:I06.

**Detailed plan:** `tasks/T042_PLAN.md` — write just before execution.

## E11 — Import, preparation, editing and review interfaces
Exit: A live source-to-record-to-finding journey and correction workflow pass.

### T043 — Import mapping, preview and reconciliation interface
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Frontend/backend.

**Dependencies:** T042.

**Scope:** Make implemented source profiles and candidate/commit stages visible without overstating support.

**Outputs:** Import/mapping wizard; per-feature status; duplicate/conflict/unsupported guidance.

**Acceptance:** User sees what was retained, parsed, normalized and usable; repeated imports do not duplicate; incomplete results are not branded fully imported.

**Excluded:** Advertising every possible source family because an upload accepts bytes.

**Earlier references:** renderer:E01.

**Detailed plan:** `tasks/T043_PLAN.md` — write just before execution.

### T044 — Source workspace calibration and placement
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Frontend/geometry.

**Dependencies:** T043.

**Scope:** Separate document viewing, scale calibration, geographic placement and vertical readiness in the workspace.

**Outputs:** Plan/source canvas; control-point and independent-check flow; linked candidate geometry.

**Acceptance:** Scale alone cannot authorize world placement; distorted scans expose residual failures; keyboard/cancel/clear preserve unrelated draft work.

**Excluded:** Treating two arbitrary dimensions as universal georeferencing.

**Earlier references:** renderer:E02.

**Detailed plan:** `tasks/T044_PLAN.md` — write just before execution.

### T045 — Versioned geometry edits, undo and conflict handling
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Full-stack/geometry.

**Dependencies:** T044.

**Scope:** Edit candidates through explicit commands and expected revisions with bounded undo/redo.

**Outputs:** Draft command model; validation, unsaved/recovery states and concurrent-edit tests.

**Acceptance:** Undo affects the correct draft; accepted/source geometry is untouched until the controlled operation; stale edits fail without overwriting newer changes.

**Excluded:** Storing renderer manipulations as authoritative edits or unbounded undo histories.

**Earlier references:** renderer:E03.

**Detailed plan:** `tasks/T045_PLAN.md` — write just before execution.

### T046 — Compare, build, review and publish workflow
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Full-stack.

**Dependencies:** T045.

**Scope:** Connect existing review semantics to the new composition and publication path.

**Outputs:** Before/candidate comparison; job and review states; safe publication with clear scope.

**Acceptance:** Build is not review and review is not legal issuance; failed/stale jobs do not replace accepted content; all published results are revision-bound.

**Excluded:** Publishing directly from AI output or partially loaded client state.

**Earlier references:** renderer:E04.

**Detailed plan:** `tasks/T046_PLAN.md` — write just before execution.

### T047 — End-to-end import/edit/workflow acceptance
**Status:** Planned. **Release:** R2-product. **Suggested owner:** QA.

**Dependencies:** T046.

**Scope:** Prove one repeatable live import and a safe correction path using the already qualified first profiles.

**Outputs:** UI-13–UI-16 results; upload-to-map-to-register-to-computed-finding journey; recovery test.

**Acceptance:** Original upload through actual running app works; its demonstrated capability and limits are explicit; correction preserves history and IDs.

**Excluded:** Blocking this gate on every future adapter or presenting an exterior-only import as automatic interior generation.

**Earlier references:** renderer:E06.

**Detailed plan:** `tasks/T047_PLAN.md` — write just before execution.

## E12 — Integrated product qualification
Exit: R2: reproducible supported product, not universal data-format or national coverage.

### T048 — Integrated regression and current evidence baseline
**Status:** Planned. **Release:** R2-product. **Suggested owner:** QA.

**Dependencies:** T047.

**Scope:** Re-run relevant functional, contract, numerical, visual and resource suites on one release candidate.

**Outputs:** Revision-pinned aggregate results; failures classified as new/pre-existing/environmental; regression ownership.

**Acceptance:** No inherited passing report is relabeled as current; all promised first-release profiles have actual qualifying results.

**Excluded:** Fixing tests by deleting assertions or broad screenshot rebaselining.

**Earlier references:** renderer:Q01.

**Detailed plan:** `tasks/T048_PLAN.md` — write just before execution.

### T049 — Security, input safety and source-use qualification
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Backend/security.

**Dependencies:** T048.

**Scope:** Verify the implemented local/operator threat boundary and data privacy before wider distribution.

**Outputs:** Hostile input tests; authorization/DTO/export review; log and source-attribution checks.

**Acceptance:** No secrets/party data leak via tiles, errors, logs or downloads; parsers remain bounded; external references cannot initiate uncontrolled fetches.

**Excluded:** Claiming production multi-user readiness without an implemented and tested identity/access system.

**Earlier references:** schema:U12, renderer:Q03.

**Detailed plan:** `tasks/T049_PLAN.md` — write just before execution.

### T050 — Real device, browser and accessibility qualification
**Status:** Planned. **Release:** R2-product. **Suggested owner:** QA/accessibility.

**Dependencies:** T049.

**Scope:** Verify the supported interaction/device profile rather than assuming emulation equals hardware.

**Outputs:** Held mouse gesture and physical-touch results where supported; keyboard/focus/zoom/reduced-motion checks.

**Acceptance:** Browser/device support is stated accurately; supported low-quality profiles preserve geometry truth; untested hardware is not marked passed.

**Excluded:** Universal compatibility promises or inaccessible drag-only actions.

**Earlier references:** renderer:Q02.

**Detailed plan:** `tasks/T050_PLAN.md` — write just before execution.

### T051 — Reproducible startup, restore and additive transfer
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Platform/QA.

**Dependencies:** T050.

**Scope:** Qualify setup and recovery with coherent database and source/derived assets.

**Outputs:** Fresh-environment and additive-upgrade rehearsal; backup/restore and rollback runbook; offline demo requirements.

**Acceptance:** Restore reproduces the selected publication and its sources; populated environments are not overwritten; missing services/network fail intelligibly.

**Excluded:** Deleting Docker volumes as a setup fix or calling data-bundle installation continuous sync.

**Earlier references:** renderer:Q04.

**Detailed plan:** `tasks/T051_PLAN.md` — write just before execution.

### T052 — Integrated product release and next backlog
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Architecture lead + user.

**Dependencies:** T051.

**Scope:** Release the declared supported subset and document its limits without making optional expansion a hidden blocker.

**Outputs:** R2 scope/acceptance record; remaining risks and future adapters; pinned regression baseline and rollout decision.

**Acceptance:** All must-pass gates for R2 are accepted; user-facing visual changes have approval; no data-loss/security blocker is waived.

**Excluded:** Automatically merging to main or deploying without applicable authorization.

**Earlier references:** renderer:Q06.

**Detailed plan:** `tasks/T052_PLAN.md` — write just before execution.

## E13 — Optional expansion track
Exit: R3 increments are elected later; they do not block R1/R2.

### T053 — Qualified BIM, city-model and CAD adapter increments
**Status:** Deferred. **Release:** R3-optional. **Suggested owner:** Data/geometry.

**Dependencies:** T052.

**Scope:** Choose one requested IFC/CityJSON/CAD version/profile at a time and expand only its declared capabilities.

**Outputs:** Per-adapter detailed task plans, placement/source-ID mappings, loss reports and fixtures.

**Acceptance:** Each chosen profile preserves supported semantics and reports unsupported ones; adding a parser requires no new map implementation.

**Excluded:** Universal lossless BIM/CAD support or legal-flat inference from IfcSpace.

**Earlier references:** schema:U07, schema:U18, renderer:E05, renderer:E06.

**Detailed plan:** `tasks/T053_PLAN.md` — write just before execution.

### T054 — Terrain, point-cloud and survey/bulk increments
**Status:** Deferred. **Release:** R3-optional. **Suggested owner:** Data/geometry.

**Dependencies:** T052.

**Scope:** Add useful coverage/survey profiles and their specialized resumable processing paths as separately scoped tasks.

**Outputs:** Asset catalog extensions; bounded adapters/derivations; no-data, datum, sampling and bulk-recovery tests.

**Acceptance:** Samples remain in suitable large assets; derived terrain/buildings have lineage; raw GNSS does not directly become parcel geometry.

**Excluded:** Mandatory point-per-row storage, automatic interiors from LiDAR or raw-sensor completeness claims.

**Earlier references:** schema:U07, schema:U11, schema:U19, renderer:E05, renderer:E06.

**Detailed plan:** `tasks/T054_PLAN.md` — write just before execution.

### T055 — Private parties, official integrations and multi-user expansion
**Status:** Deferred. **Release:** R3-optional. **Suggested owner:** Architecture/security.

**Dependencies:** T052.

**Scope:** Plan separately authorized occupancy/registry connectors, real authentication and any mobile/offline workflows.

**Outputs:** Data agreements and access requirements; distinct Party/Occupancy/RRR/account schemas; separate bounded implementation tasks.

**Acceptance:** Real residents are not demo fixtures; owners/occupants/logins stay separate; external integration and multi-user claims match actual authorization and tests.

**Excluded:** Making this a prerequisite for the local renderer or publicizing restricted infrastructure/person data.

**Earlier references:** schema:U12.

**Detailed plan:** `tasks/T055_PLAN.md` — write just before execution.

### T056 — Measured capacity and large-catalog expansion
**Status:** Deferred. **Release:** R3-optional. **Suggested owner:** Streaming/performance.

**Dependencies:** T052.

**Scope:** Increase scale only after the declared workload and bottlenecks are measured.

**Outputs:** 100k/1M catalog experiments where useful; visible-load benchmarks; resource/cost and operational capacity profile.

**Acceptance:** Reported capacity states exact workload, hardware, network and limits; source completeness is never inferred from synthetic object count.

**Excluded:** A mandatory 1M milestone before releasing useful R1/R2 functionality.

**Earlier references:** renderer:S05, renderer:Q05, renderer:Q06.

**Detailed plan:** `tasks/T056_PLAN.md` — write just before execution.

## Separate maintenance

### M001 — Delete previously authorized old proof directory
Status: Accepted. Exact target: `E:\Projects\3d-ulpin-proof-20260917`.

Only this exact resolved directory; reject reparse points/links and unexpected path resolution; preserve product repo, sources and other study directories.

Does not block product tasks. Plan: `tasks/M001_PROOF_CLEANUP_PLAN.md`.
