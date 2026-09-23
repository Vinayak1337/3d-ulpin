# Ordered task backlog

Generated from `backlog.json`, plan version 1.5. Accepted execution tasks: 9/93. A mapping or detailed plan is not implementation evidence. Future plan paths are reserved until authored.

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

**Recorded sequence:** `1`.

**Recorded execution state:** `completed`.

**Recorded evidence:** `tasks/T001_RESULT.md`, `evidence/T001-hosted-35354159342.json`, `evidence/T001-fixture-references.json`.

### T002 — Reference, requirements and fixture acceptance contract
**Status:** Accepted. **Release:** R1-renderer. **Suggested owner:** Product/visual lead.

**Dependencies:** T001.

**Scope:** Reconcile current requirements and the recovered reference packs into named outcomes and capability-specific visual targets.

**Outputs:** Requirement IDs; reference hash/screen mapping; F01–F09 fixture specifications; declared device and camera suite.

**Acceptance:** Every primary screen has an anchor or an explicit design gap; dense and sparse inputs have honest targets; contradictory mockup numbers are not requirements.

**Excluded:** Recreating all UI screens or claiming original-chat completeness.

**Earlier references:** schema:U02, schema:U16, renderer:R01, renderer:R02, renderer:R04, renderer:R05.

**Detailed plan:** `tasks/T002_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `2`.

**Recorded execution state:** `completed`.

**Recorded evidence:** `tasks/T002_RESULT.md`, `references/catalog.json`, `references/acceptance-contract.json`.

### T003 — Architecture decisions and smallest proving experiments
**Status:** Accepted. **Release:** R1-renderer. **Suggested owner:** Architecture lead.

**Dependencies:** T002.

**Scope:** Resolve only choices that block the thin core: contract authority, legacy boundaries, frame meaning and renderer integration.

**Outputs:** Short ADRs; contract parity experiment design; keep/adapt/replace inventory; first-slice scope and dependency rules.

**Acceptance:** One contract authoring authority and one writer per record are nominated; exact unknowns have proving experiments and stop conditions.

**Excluded:** A new backend, mandatory microservices, a graph database, or committing to all future geometry kernels.

**Earlier references:** schema:U15, schema:U21, renderer:R03, renderer:R06.

**Detailed plan:** `tasks/T003_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `3`.

**Recorded execution state:** `completed`.

**Recorded evidence:** `tasks/T003_RESULT.md`, `decisions/ADR-001-schema-authority.md`.

## E14 — User-prioritized 3D visual milestone
Exit: Supported normalized neighbourhoods use an improved common visual/inspection system before ML expansion.

### T057 — Normalized neighbourhood renderer and shared 3D interface
**Status:** Blocked. **Release:** R1-renderer. **Suggested owner:** Architecture and frontend lead.

**Dependencies:** T009.

**Scope:** User-prioritized complete-neighbourhood renderer/UI increment consuming existing normalized records.

**Outputs:** Read-only core-to-display scene, bounded derived delivery, shared explorer, improved materials/camera/panels and real browser checks.

**Acceptance:** Existing geometry, identity and quantities preserved; saved neighbourhood consumes common renderer; actual visual and interaction checks pass with user approval separate.

**Excluded:** ML extraction, universal bulk import, production authorization, DB publication pointers and replacing every existing workflow.

**Earlier references:** New explicit user/architecture requirement.

**Detailed plan:** `tasks/T057_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `10`.

**Recorded execution state:** `superseded_by_user_rejected_visuals`.

**Recorded evidence:** `tasks/T057_RESULT.md`, `../evidence/t057/README.md`.

### T058 — Studio-based interface, prepared sources and reference-matched neighbourhood
**Status:** Implemented. **Release:** R1-renderer. **Suggested owner:** Architecture and visual lead.

**Dependencies:** T009.

**Scope:** Adopt original City Studio, preserve functioning routes, prepare consistent fictional records and refine against original mockups.

**Outputs:** Studio route, shared viewport, prepared source bundle, working import and review interfaces, side-by-side evidence.

**Acceptance:** Runtime functionality verified and major source-reference gaps corrected; no fabricated user approval.

**Excluded:** ML, official identity issuance and replacing real source shapes with synthetic rectangles.

**Earlier references:** New explicit user/architecture requirement.

**Detailed plan:** `tasks/T058_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `58`.

**Recorded execution state:** `continuation_implemented_production_verified`.

**Recorded evidence:** `tasks/T058_RESULT.md`, `../evidence/t058/REVIEW.md`, `../evidence/t058/verification/results.json`, `tasks/T058_CONTINUATION_RESULT.md`, `../evidence/t058/continuation/verification/summary.json`, `../evidence/t058/continuation/REVIEW.md`.

### T059 — Unified Studio frontend completion and acceptance evidence
**Status:** Implemented. **Release:** R1-renderer. **Suggested owner:** Frontend / visual / QA.

**Dependencies:** T058.

**Scope:** Finish FE-A01?14: one Studio shell for prepared and saved data, same-page quick register, complete register/workspace/export paths, responsive behavior and current evidence.

**Outputs:** Unified routes and components; FE coverage ledger; current fixture and saved-data browser evidence; responsive captures.

**Acceptance:** FE-A01?14 implemented and current browser/build checks pass; source geometry remains honest; physical-device verification and user visual approval are recorded separately.

**Excluded:** ML, official identity issuance, production multi-user rollout and reshaping imported real geometry to imitate the synthetic reference.

**Earlier references:** New explicit user/architecture requirement.

**Detailed plan:** `tasks/T059_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `59`.

**Recorded execution state:** `implemented_current_browser_verified`.

**Recorded evidence:** `tasks/T059_RESULT.md`, `../frontend-completion/coverage.json`, `../evidence/t059/final/results.json`, `../evidence/t059/final/saved-data-results.json`, `../evidence/t059/final/capture.json`.

### T060 — Close reproduced Studio defects and refine reference visuals
**Status:** Implemented. **Release:** R1-renderer. **Suggested owner:** Frontend / visual / QA.

**Dependencies:** T059.

**Scope:** Reconcile both project chats, fix quick units/documents/shared navigation and scoped SVG, refine scene and tablet interaction, verify current application.

**Outputs:** Correctness fixes, scoped export regression, reference comparison, current saved/fixture browser checks.

**Acceptance:** Reproduced defects are fixed in current browser; supported source bytes and geometry remain unchanged; real-device and user acceptance are recorded separately.

**Excluded:** ML, official identity issuance, production multi-user rollout and reshaping imported real geometry to imitate the synthetic reference.

**Earlier references:** New explicit user/architecture requirement.

**Detailed plan:** `tasks/T060_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `60`.

**Recorded execution state:** `implemented_browser_verified_final_follow_up_recorded`.

**Recorded evidence:** `tasks/T060_RESULT.md`, `../evidence/t060/verification-summary.json`, `../evidence/t060/correctness-final/results.json`, `../evidence/t060/studio-original/results.json`, `../evidence/t060/studio-continuation/results.json`, `../evidence/t060/saved-final/results.json`, `../evidence/t060/visual-metal/capture.json`, `../evidence/t060/uttam-final/results.json`.

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

**Recorded sequence:** `4`.

**Recorded execution state:** `completed`.

**Recorded evidence:** `tasks/T004_RESULT.md`.

### T005 — Reusable sources, original assets and exact evidence links
**Status:** Accepted. **Release:** R1-renderer. **Suggested owner:** Data/backend.

**Dependencies:** T004.

**Scope:** Represent dataset and source revisions and exact source parts while reusing existing stored originals.

**Outputs:** Source/asset/source-part contracts; optional many-to-many evidence links; access and retention metadata.

**Acceptance:** One original can support multiple objects; zero documents is valid; removing one link cannot remove bytes still referenced elsewhere.

**Excluded:** Copying existing bytes per building, cloud migration or real personal-data ingestion.

**Earlier references:** schema:U05, schema:U11, schema:U12, renderer:D04.

**Detailed plan:** `tasks/T005_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `5`.

**Recorded execution state:** `completed`.

**Recorded evidence:** `tasks/T005_RESULT.md`.

### T006 — Frames, transforms and vertical-reference semantics
**Status:** Accepted. **Release:** R1-renderer. **Suggested owner:** Geometry lead.

**Dependencies:** T004.

**Scope:** Make units, axes, local origins and vertical meaning explicit; qualify the first supported transform profiles.

**Outputs:** Frame and operation contracts; source-to-analysis/render transform profiles; independent numeric test vectors.

**Acceptance:** Metres/feet and rotated local fixtures transform correctly; unresolved vertical ties block dependent 3D comparisons; geographic coverage is not a measurement frame.

**Excluded:** Relabeling SRIDs, rewriting historical geometry in place or implementing every geodetic operation.

**Earlier references:** schema:U06, renderer:D03.

**Detailed plan:** `tasks/T006_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `6`.

**Recorded execution state:** `completed`.

**Recorded evidence:** `tasks/T006_RESULT.md`.

### T007 — Geometry representations, quantities and capability checks
**Status:** Accepted. **Release:** R1-renderer. **Suggested owner:** Geometry lead.

**Dependencies:** T005, T006.

**Scope:** Separate analytical and display geometry and implement validators for the first polygon/prism/asset-reference profiles.

**Outputs:** Discriminated representation and quantity contracts; purpose-specific readiness evaluator; TypeScript/Python conformance fixtures.

**Acceptance:** Holes and multipart geometry survive; unknown is not zero; renderability does not imply volume readiness; unsupported geometry is explicit.

**Excluded:** Arbitrary-solid Boolean operations or treating an external mesh parser as complete support.

**Earlier references:** schema:U03, schema:U07, schema:U09, schema:U10, schema:U11, renderer:D02, renderer:D07.

**Detailed plan:** `tasks/T007_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `7`.

**Recorded execution state:** `completed`.

**Recorded evidence:** `tasks/T007_RESULT.md`.

### T008 — Observations, source composition and coherent snapshots
**Status:** Accepted. **Release:** R1-renderer. **Suggested owner:** Architecture lead.

**Dependencies:** T007.

**Scope:** Define selected contributions without erasing conflicting facts and bind output to immutable input revisions.

**Outputs:** Observation/resolution/composition and publication contracts; deterministic input signatures; snapshot/permission rules.

**Acceptance:** A footprint, level schedule and unit source combine without invented evidence; a failed unrelated contribution does not erase valid output; worlds and revisions do not mix.

**Excluded:** A universal rule language, arbitrary uploaded code or a full publication service before its first consumer.

**Earlier references:** schema:U08, schema:U13, schema:U14, renderer:D05, renderer:C01.

**Detailed plan:** `tasks/T008_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `8`.

**Recorded execution state:** `completed`.

**Recorded evidence:** `tasks/T008_RESULT.md`.

## E03 — Compatibility and first normalization
Exit: Existing records and named input profiles use the new boundary without loss.

### T009 — Read-only legacy compatibility adapter
**Status:** Accepted. **Release:** R1-renderer. **Suggested owner:** Data/backend.

**Dependencies:** T008.

**Scope:** Expose existing physical features, registry records, sources and frames through the new contract without replacing current writers.

**Outputs:** Small read adapter and first internal consumer; explicit ID crosswalk; parity and unknown-value tests.

**Acceptance:** Existing IDs, original hashes and historical frame references remain resolvable; old routes keep working; physical and legal records are not collapsed by coincidence.

**Excluded:** Dual canonical databases, destructive backfills or swallowing unsupported legacy records.

**Earlier references:** schema:U01, schema:U04, schema:U15, renderer:D06.

**Detailed plan:** `tasks/T009_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `9`.

**Recorded execution state:** `completed`.

**Recorded evidence:** `tasks/T009_RESULT.md`, `evidence/T009-live-read.json`.

### T010 — Minimal additive storage and one-writer migration rehearsal
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Data/backend.

**Dependencies:** T009.

**Scope:** Add only persistence required by a demonstrated missing relation or snapshot; test upgrade paths in an isolated database.

**Outputs:** Versioned migrations and ledger if needed; restart-safe backfill; writer-ownership table; compatibility/rollback experiment.

**Acceptance:** Fresh and existing databases are tested; rerun does not duplicate; failed migration leaves a defined recoverable state; old/new app compatibility is explicitly checked.

**Excluded:** Dropping legacy tables, overwriting repository volumes or an ad hoc live database reset.

**Earlier references:** schema:U05, schema:U15.

**Detailed plan:** `tasks/T010_PLAN.md` — write just before execution.

**Recorded sequence:** `11`.

**Recorded execution state:** `not_started`.

### T011 — First supported input profiles and retry-safe normalization
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Data/geometry.

**Dependencies:** T010.

**Scope:** Wrap the existing bounded GIS and schedule paths plus canonical interchange with the new contracts.

**Outputs:** Profile descriptors; operation-key semantics; per-item results; source preservation and adapter equivalence tests.

**Acceptance:** Same input/profile/mapping replay has no duplicate effect; changed mapping is tracked; unavailable profiles fail explicitly; existing safety bounds remain.

**Excluded:** All IFC/CAD/cloud formats or removing size limits to call the importer scalable.

**Earlier references:** schema:U02, schema:U08, schema:U17, schema:U19, renderer:D06.

**Detailed plan:** `tasks/T011_PLAN.md` — write just before execution.

**Recorded sequence:** `12`.

**Recorded execution state:** `not_started`.

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

**Recorded sequence:** `13`.

**Recorded execution state:** `not_started`.

### T013 — Foundation negatives, compatibility and acceptance gate
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Independent reviewer/QA.

**Dependencies:** T012.

**Scope:** Verify the foundation against negative and metamorphic cases before expanding the renderer.

**Outputs:** Foundation gate report; negative fixtures; old-route regression results; unresolved-risk decisions.

**Acceptance:** Unknown heights, mixed frames, repeated imports, conflicting sources and private fields behave correctly; no protected baseline invariant regresses.

**Excluded:** Waiving data loss or using a passing typecheck as complete integration proof.

**Earlier references:** schema:U16, schema:U20, schema:U21, renderer:D07, renderer:D08.

**Detailed plan:** `tasks/T013_PLAN.md` — write just before execution.

**Recorded sequence:** `14`.

**Recorded execution state:** `not_started`.

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

**Recorded sequence:** `15`.

**Recorded execution state:** `not_started`.

### T015 — One map and inspection session
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Frontend.

**Dependencies:** T014.

**Scope:** Extend the existing state boundary for canonical selection, layers, view mode, camera return and selected level/unit.

**Outputs:** Session model, route synchronization and pure selectors; selection/undo-of-navigation tests.

**Acceptance:** Map/register/plan return to the same entity and unit; invalid/deleted IDs resolve explicitly; unloaded geometry does not clear a valid selection.

**Excluded:** A second competing global store or saving private dossiers in browser storage.

**Earlier references:** New explicit user/architecture requirement.

**Detailed plan:** `tasks/T015_PLAN.md` — write just before execution.

**Recorded sequence:** `16`.

**Recorded execution state:** `not_started`.

### T016 — Reusable viewport/controller and resource lifecycle boundary
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Rendering/frontend.

**Dependencies:** T015.

**Scope:** Separate camera/picking/scene lifecycle from page shells with one stable renderer-facing contract.

**Outputs:** Shared viewport/controller interface; integration of first two existing views; lifecycle and interaction characterization.

**Acceptance:** Page changes do not duplicate a full world; inactive contexts release or pause resources; held gestures survive unrelated React updates.

**Excluded:** An engine rewrite, a hidden screenshot replacing 3D, or specialized views owning different data truth.

**Earlier references:** renderer:C06.

**Detailed plan:** `tasks/T016_PLAN.md` — write just before execution.

**Recorded sequence:** `17`.

**Recorded execution state:** `not_started`.

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

**Recorded sequence:** `18`.

**Recorded execution state:** `not_started`.

### T018 — Road, ground and utility compiler profiles
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Geometry/rendering.

**Dependencies:** T017.

**Scope:** Produce first supported surfaces and utility profiles with neighbour context and explicit ground/depth meaning.

**Outputs:** Road/surface and utility compilation; declared width/profile policy; topology and seam fixtures.

**Acceptance:** Variable widths and junctions do not double physical area; unknown depth stays unknown; overhead crossings do not invent a network junction.

**Excluded:** Generating measured roads from arbitrary buffers or requiring a complete national terrain dataset.

**Earlier references:** schema:U10, renderer:C03.

**Detailed plan:** `tasks/T018_PLAN.md` — write just before execution.

**Recorded sequence:** `19`.

**Recorded execution state:** `not_started`.

### T019 — Deterministic materials and reusable architectural recipes
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Rendering/technical art.

**Dependencies:** T018.

**Scope:** Introduce versioned source-preserving, neutral and explicitly illustrative appearance profiles.

**Outputs:** Reusable material/part vocabulary; stable entity-based seeds; style versioning and derivation signatures.

**Acceptance:** Changing tile order does not randomize facades; metric texture scale is consistent; illustrative projections do not enter observed analytical geometry.

**Excluded:** Handcrafting locality-specific render code or adding observed balconies and rooms from a footprint.

**Earlier references:** renderer:C01, renderer:C04.

**Detailed plan:** `tasks/T019_PLAN.md` — write just before execution.

**Recorded sequence:** `20`.

**Recorded execution state:** `not_started`.

### T020 — First multi-tile delivery and stable feature metadata
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Streaming/rendering.

**Dependencies:** T019.

**Scope:** Package a small real multi-tile scene with bounded LOD, canonical-ID maps and a coherent immutable manifest.

**Outputs:** Tested glTF/3D Tiles delivery subset; local placement, bounds, coarse fallback and ID mapping tests.

**Acceptance:** A seam-spanning object picks as one entity; tile and LOD IDs are not property IDs; incomplete builds never replace the active manifest.

**Excluded:** National-scale claims, unbounded all-feature endpoints or optimizing tile size without measurements.

**Earlier references:** schema:U14, renderer:C05.

**Detailed plan:** `tasks/T020_PLAN.md` — write just before execution.

**Recorded sequence:** `21`.

**Recorded execution state:** `not_started`.

### T021 — Pinned renderer integration and compatibility qualification
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Rendering lead.

**Dependencies:** T020.

**Scope:** Load the shared compiled content in the existing product and qualify the actual Cesium/browser versions.

**Outputs:** Minimal streamed viewport; picking/material/clipping/loading checks; engine decision record.

**Acceptance:** Navigation, selection, materials and supported clipping work on the pinned stack; concrete blockers are demonstrated before considering another renderer.

**Excluded:** Declaring compatibility from current online documentation or migrating engines merely for a prettier demo.

**Earlier references:** renderer:C06, renderer:C08.

**Detailed plan:** `tasks/T021_PLAN.md` — write just before execution.

**Recorded sequence:** `22`.

**Recorded execution state:** `not_started`.

### T022 — Measurement probes and render-foundation gate
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Geometry/QA.

**Dependencies:** T021.

**Scope:** Resolve measurements against the selected analytical representation and verify display independence.

**Outputs:** Measurement probes; scale/section fixtures; exact-versus-approximate response contract; renderer-foundation acceptance.

**Acceptance:** LOD, camera and explosion do not change analytical quantities; local synthetic placement meets the declared tolerance; missing exact geometry returns unavailable or approximate explicitly.

**Excluded:** Measuring cadastral quantities from screen pixels or declaring source accuracy from decimal places.

**Earlier references:** schema:U07, schema:U20, renderer:C07, renderer:C08.

**Detailed plan:** `tasks/T022_PLAN.md` — write just before execution.

**Recorded sequence:** `23`.

**Recorded execution state:** `not_started`.

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

**Recorded sequence:** `24`.

**Recorded execution state:** `not_started`.

### T024 — Architecture, facade and material fidelity refinement
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Rendering/technical art.

**Dependencies:** T023.

**Scope:** Improve silhouettes, roof/part variation, facade depth and material scale within the declared fidelity policy.

**Outputs:** One reusable recipe refinement at a time; paired scene-only comparisons; full-map regression captures.

**Acceptance:** Reverse and close-up views remain credible; narrow spaces retain modeled dimensions; sparse datasets receive a deliberate neutral fallback.

**Excluded:** Per-building special-case code or moving buildings to achieve a cleaner composition.

**Earlier references:** renderer:V02, renderer:V04.

**Detailed plan:** `tasks/T024_PLAN.md` — write just before execution.

**Recorded sequence:** `25`.

**Recorded execution state:** `not_started`.

### T025 — Grounding, lighting and alternate-view fidelity
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Rendering/technical art.

**Dependencies:** T024.

**Scope:** Tune streets, ground contact, lighting and 2D/section/underground presentation without hiding defects.

**Outputs:** Fixed camera/lighting profiles; moving-image captures; alternate-state baselines.

**Acceptance:** No floating/sunken geometry, severe texture shimmer or opaque exterior covering a cutaway; overlays distinguish horizontal clearance and depth.

**Excluded:** Bloom/blur hiding incorrect geometry or an unrelated 2D illustration.

**Earlier references:** renderer:V03, renderer:V04, renderer:V05.

**Detailed plan:** `tasks/T025_PLAN.md` — write just before execution.

**Recorded sequence:** `26`.

**Recorded execution state:** `not_started`.

### T026 — Dense, sloped, sparse and held-out visual transfer
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Data/QA.

**Dependencies:** T025.

**Scope:** Run the same pipeline on F02–F07 and a held-out shape family without locality-specific renderer edits.

**Outputs:** Dataset/quality-profile matrix; dense Uttam Nagar-style result; capability fallback and seam evidence.

**Acceptance:** No widening alleys or filling courtyards; missing evidence is explicit; general rules, not locality-specific branches, handle failures.

**Excluded:** Claiming the held-out data remained held out after tuning to it; replace the holdout after leakage.

**Earlier references:** renderer:R04, renderer:V06, renderer:S05.

**Detailed plan:** `tasks/T026_PLAN.md` — write just before execution.

**Recorded sequence:** `27`.

**Recorded execution state:** `not_started`.

### T027 — Full-map visual acceptance checkpoint
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** User visual review + QA.

**Dependencies:** T026.

**Scope:** Review actual unretouched browser output against the approved anchors and independent correctness checks.

**Outputs:** Per-view comparison and limitations; user acceptance/rejection record; pinned real-render regression baselines.

**Acceptance:** Every critical applicable scene dimension passes its approved target and the user accepts the scene; no average score hides geometry or interaction failures.

**Excluded:** Self-declaring user approval or calling a generated mockup runtime evidence.

**Earlier references:** renderer:R02, renderer:V07, renderer:V08.

**Detailed plan:** `tasks/T027_PLAN.md` — write just before execution.

**Recorded sequence:** `28`.

**Recorded execution state:** `not_started`.

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

**Recorded sequence:** `29`.

**Recorded execution state:** `not_started`.

### T029 — Bounded loading, cancellation and CPU/GPU release
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Streaming/rendering.

**Dependencies:** T028.

**Scope:** Apply a measured budget across all active content and preserve useful fallback during travel.

**Outputs:** Priority loading/cache lifecycle; cancellation and decode/upload controls; teardown and memory-plateau traces.

**Acceptance:** Rapid travel cancels obsolete work; coarse context persists; multiple tilesets fit the combined budget; repeated route loops do not show unbounded resource growth.

**Excluded:** Treating hidden objects as unloaded or a per-tileset cache as a total process budget.

**Earlier references:** renderer:S02.

**Detailed plan:** `tasks/T029_PLAN.md` — write just before execution.

**Recorded sequence:** `30`.

**Recorded execution state:** `not_started`.

### T030 — Cross-area seam, topology and precision qualification
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Geometry/QA.

**Dependencies:** T029.

**Scope:** Verify neighbour-aware geometry and frame agreement across multiple authoring areas and render boundaries.

**Outputs:** Boundary fixtures, world-placement probes, duplicate-pick checks and declared geographic support profile.

**Acceptance:** No cracks/double roads/identity duplication at seams; supported frame changes preserve quantities; unsupported polar/antimeridian cases are rejected explicitly.

**Excluded:** Implying worldwide cadastral accuracy from a local Delhi test.

**Earlier references:** schema:U20, renderer:S03.

**Detailed plan:** `tasks/T030_PLAN.md` — write just before execution.

**Recorded sequence:** `31`.

**Recorded execution state:** `not_started`.

### T031 — Incremental rebuilds and atomic publication recovery
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** Backend/streaming.

**Dependencies:** T030.

**Scope:** Implement durable build/update orchestration and switch coherent publications without cross-store half-states.

**Outputs:** Dependency invalidation graph; staged immutable assets; transactional publication pointer; job retry/failure recovery.

**Acceptance:** Interrupted work leaves the prior snapshot usable; duplicate deliveries have one recorded effect; evidence-only changes avoid unrelated mesh rebuilds; stale writers cannot overwrite new revisions.

**Excluded:** Claiming exactly-once delivery or a database transaction spanning object storage.

**Earlier references:** schema:U14, schema:U19, renderer:S04.

**Detailed plan:** `tasks/T031_PLAN.md` — write just before execution.

**Recorded sequence:** `32`.

**Recorded execution state:** `not_started`.

### T032 — Resource/failure benchmarks and renderer release gate
**Status:** Planned. **Release:** R1-renderer. **Suggested owner:** QA/performance.

**Dependencies:** T031.

**Scope:** Qualify a useful declared renderer release using measured visible workload and scale catalogs.

**Outputs:** Cold/warm timing, memory and failure reports; supported device/dataset profile; R1 decision.

**Acceptance:** Visual, identity, geometry and resource gates pass together; 10k then 100k catalog stress is explicitly scoped; untested million-feature capacity is deferred.

**Excluded:** Blocking all useful release on a 1M catalog or presenting catalog size as visible building capacity.

**Earlier references:** renderer:R05, renderer:S05, renderer:S06.

**Detailed plan:** `tasks/T032_PLAN.md` — write just before execution.

**Recorded sequence:** `33`.

**Recorded execution state:** `not_started`.

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

**Recorded sequence:** `34`.

**Recorded execution state:** `not_started`.

### T034 — Camera, layers and global-search interface
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Frontend.

**Dependencies:** T033.

**Scope:** Expose common navigation and filters without changing identity or analytical scope.

**Outputs:** Camera/layer/search controls and keyboard behaviour; unloaded-area selection flow.

**Acceptance:** 2D mode stays top-down; layer hiding does not turn an incomplete analysis into all-clear; ambiguous identifiers require a choice.

**Excluded:** Owner/resident search in public geometry metadata or assuming visible features are all features.

**Earlier references:** renderer:U02.

**Detailed plan:** `tasks/T034_PLAN.md` — write just before execution.

**Recorded sequence:** `35`.

**Recorded execution state:** `not_started`.

### T035 — Property inspector, findings and utility inspection
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Frontend/geometry.

**Dependencies:** T034.

**Scope:** Connect canonical selection to defined metrics, exact findings and useful utility sections.

**Outputs:** Contextual inspector and findings flow; geometry overlays; missing/evidence states.

**Acceptance:** Actual difference/intersection geometry is shown; overlapping findings are not double-counted; missing depth is not safe clearance.

**Excluded:** Replacing computed regions with whole-building highlights or prewritten metrics.

**Earlier references:** renderer:U03, renderer:U04.

**Detailed plan:** `tasks/T035_PLAN.md` — write just before execution.

**Recorded sequence:** `36`.

**Recorded execution state:** `not_started`.

### T036 — Map history, exports and responsive panels
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Frontend.

**Dependencies:** T035.

**Scope:** Add snapshot history and scoped exports with usable desktop/mobile panel behaviour.

**Outputs:** Read-only history mode; export manifest/scope; responsive drawers/sheets; permission checks.

**Acceptance:** History stays on one snapshot; export includes definitions and provenance; controls remain reachable with keyboard, zoom and a small viewport.

**Excluded:** Exporting private files because geometry is public or asserting physical-phone testing from emulation.

**Earlier references:** renderer:U05.

**Detailed plan:** `tasks/T036_PLAN.md` — write just before execution.

**Recorded sequence:** `37`.

**Recorded execution state:** `not_started`.

### T037 — Map interface acceptance gate
**Status:** Planned. **Release:** R2-product. **Suggested owner:** QA + user visual review.

**Dependencies:** T036.

**Scope:** Verify every promised map state against the same design and behavioral contract.

**Outputs:** UI-01–UI-07 evidence map; route/gesture/error regression; known limitations.

**Acceptance:** Map states meet visual, accessibility and interaction requirements without regressing renderer gates.

**Excluded:** Calling all screens finished from one hero screenshot.

**Earlier references:** renderer:U06.

**Detailed plan:** `tasks/T037_PLAN.md` — write just before execution.

**Recorded sequence:** `38`.

**Recorded execution state:** `not_started`.

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

**Recorded sequence:** `39`.

**Recorded execution state:** `not_started`.

### T039 — Floor/unit plans, shared spaces and section interactions
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Frontend/geometry.

**Dependencies:** T038.

**Scope:** Derive plan/model/table views from one selected representation and declared relations.

**Outputs:** Linked level/unit selector; shared plan geometry; section and explosion views; duplex/shared-space fixtures.

**Acceptance:** Same unit is selected everywhere; net/gross/footprint areas have explicit definitions; display explosion does not change levels or quantities.

**Excluded:** Independent floor layouts in SVG, PDF and 3D or a strict one-level-per-unit tree.

**Earlier references:** schema:U09, schema:U20, renderer:V05, renderer:I02, renderer:I03.

**Detailed plan:** `tasks/T039_PLAN.md` — write just before execution.

**Recorded sequence:** `40`.

**Recorded execution state:** `not_started`.

### T040 — Optional evidence viewers and access scopes
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Frontend/backend.

**Dependencies:** T039.

**Scope:** Attach and display exact source parts at building/level/unit scope without making evidence universally mandatory.

**Outputs:** Direct/inherited links; versioned viewers/thumbnails/downloads; attachment and unlink flows.

**Acceptance:** Correct source revision and locator are retained; removing one link leaves other consumers intact; private documents remain permission-scoped.

**Excluded:** Blob deletion without reference/retention checks or automatic legal acceptance of attached documents.

**Earlier references:** schema:U12, renderer:I04.

**Detailed plan:** `tasks/T040_PLAN.md` — write just before execution.

**Recorded sequence:** `41`.

**Recorded execution state:** `not_started`.

### T041 — Record history, issues and investigations
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Frontend/backend.

**Dependencies:** T040.

**Scope:** Expose existing review/investigation lifecycle and history with versioned evidence.

**Outputs:** History/issue/investigation pages; state transition and stale-decision tests.

**Acceptance:** Earlier revisions remain navigable; stale evidence cannot silently resolve an issue; source disagreement is not automatically a legal violation.

**Excluded:** Reinventing a competing workflow state machine for a new page.

**Earlier references:** renderer:I05.

**Detailed plan:** `tasks/T041_PLAN.md` — write just before execution.

**Recorded sequence:** `42`.

**Recorded execution state:** `not_started`.

### T042 — Inspection and zero-document acceptance gate
**Status:** Planned. **Release:** R2-product. **Suggested owner:** QA + user visual review.

**Dependencies:** T041.

**Scope:** Qualify register/floor/unit/source flows as one connected product surface.

**Outputs:** UI-08–UI-12 results; cross-view identity/quantity tests; responsive/keyboard checks.

**Acceptance:** The complete selection-to-source-to-return flow is coherent with missing, private and absent evidence.

**Excluded:** Passing only the model or only the table while the combined journey fails.

**Earlier references:** renderer:I06.

**Detailed plan:** `tasks/T042_PLAN.md` — write just before execution.

**Recorded sequence:** `43`.

**Recorded execution state:** `not_started`.

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

**Recorded sequence:** `44`.

**Recorded execution state:** `not_started`.

### T044 — Source workspace calibration and placement
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Frontend/geometry.

**Dependencies:** T043.

**Scope:** Separate document viewing, scale calibration, geographic placement and vertical readiness in the workspace.

**Outputs:** Plan/source canvas; control-point and independent-check flow; linked candidate geometry.

**Acceptance:** Scale alone cannot authorize world placement; distorted scans expose residual failures; keyboard/cancel/clear preserve unrelated draft work.

**Excluded:** Treating two arbitrary dimensions as universal georeferencing.

**Earlier references:** renderer:E02.

**Detailed plan:** `tasks/T044_PLAN.md` — write just before execution.

**Recorded sequence:** `45`.

**Recorded execution state:** `not_started`.

### T045 — Versioned geometry edits, undo and conflict handling
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Full-stack/geometry.

**Dependencies:** T044.

**Scope:** Edit candidates through explicit commands and expected revisions with bounded undo/redo.

**Outputs:** Draft command model; validation, unsaved/recovery states and concurrent-edit tests.

**Acceptance:** Undo affects the correct draft; accepted/source geometry is untouched until the controlled operation; stale edits fail without overwriting newer changes.

**Excluded:** Storing renderer manipulations as authoritative edits or unbounded undo histories.

**Earlier references:** renderer:E03.

**Detailed plan:** `tasks/T045_PLAN.md` — write just before execution.

**Recorded sequence:** `46`.

**Recorded execution state:** `not_started`.

### T046 — Compare, build, review and publish workflow
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Full-stack.

**Dependencies:** T045.

**Scope:** Connect existing review semantics to the new composition and publication path.

**Outputs:** Before/candidate comparison; job and review states; safe publication with clear scope.

**Acceptance:** Build is not review and review is not legal issuance; failed/stale jobs do not replace accepted content; all published results are revision-bound.

**Excluded:** Publishing directly from AI output or partially loaded client state.

**Earlier references:** renderer:E04.

**Detailed plan:** `tasks/T046_PLAN.md` — write just before execution.

**Recorded sequence:** `47`.

**Recorded execution state:** `not_started`.

### T047 — End-to-end import/edit/workflow acceptance
**Status:** Planned. **Release:** R2-product. **Suggested owner:** QA.

**Dependencies:** T046.

**Scope:** Prove one repeatable live import and a safe correction path using the already qualified first profiles.

**Outputs:** UI-13–UI-16 results; upload-to-map-to-register-to-computed-finding journey; recovery test.

**Acceptance:** Original upload through actual running app works; its demonstrated capability and limits are explicit; correction preserves history and IDs.

**Excluded:** Blocking this gate on every future adapter or presenting an exterior-only import as automatic interior generation.

**Earlier references:** renderer:E06.

**Detailed plan:** `tasks/T047_PLAN.md` — write just before execution.

**Recorded sequence:** `48`.

**Recorded execution state:** `not_started`.

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

**Recorded sequence:** `49`.

**Recorded execution state:** `not_started`.

### T049 — Security, input safety and source-use qualification
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Backend/security.

**Dependencies:** T048.

**Scope:** Verify the implemented local/operator threat boundary and data privacy before wider distribution.

**Outputs:** Hostile input tests; authorization/DTO/export review; log and source-attribution checks.

**Acceptance:** No secrets/party data leak via tiles, errors, logs or downloads; parsers remain bounded; external references cannot initiate uncontrolled fetches.

**Excluded:** Claiming production multi-user readiness without an implemented and tested identity/access system.

**Earlier references:** schema:U12, renderer:Q03.

**Detailed plan:** `tasks/T049_PLAN.md` — write just before execution.

**Recorded sequence:** `50`.

**Recorded execution state:** `not_started`.

### T050 — Real device, browser and accessibility qualification
**Status:** Planned. **Release:** R2-product. **Suggested owner:** QA/accessibility.

**Dependencies:** T049.

**Scope:** Verify the supported interaction/device profile rather than assuming emulation equals hardware.

**Outputs:** Held mouse gesture and physical-touch results where supported; keyboard/focus/zoom/reduced-motion checks.

**Acceptance:** Browser/device support is stated accurately; supported low-quality profiles preserve geometry truth; untested hardware is not marked passed.

**Excluded:** Universal compatibility promises or inaccessible drag-only actions.

**Earlier references:** renderer:Q02.

**Detailed plan:** `tasks/T050_PLAN.md` — write just before execution.

**Recorded sequence:** `51`.

**Recorded execution state:** `not_started`.

### T051 — Reproducible startup, restore and additive transfer
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Platform/QA.

**Dependencies:** T050.

**Scope:** Qualify setup and recovery with coherent database and source/derived assets.

**Outputs:** Fresh-environment and additive-upgrade rehearsal; backup/restore and rollback runbook; offline demo requirements.

**Acceptance:** Restore reproduces the selected publication and its sources; populated environments are not overwritten; missing services/network fail intelligibly.

**Excluded:** Deleting Docker volumes as a setup fix or calling data-bundle installation continuous sync.

**Earlier references:** renderer:Q04.

**Detailed plan:** `tasks/T051_PLAN.md` — write just before execution.

**Recorded sequence:** `52`.

**Recorded execution state:** `not_started`.

### T052 — Integrated product release and next backlog
**Status:** Planned. **Release:** R2-product. **Suggested owner:** Architecture lead + user.

**Dependencies:** T051.

**Scope:** Release the declared supported subset and document its limits without making optional expansion a hidden blocker.

**Outputs:** R2 scope/acceptance record; remaining risks and future adapters; pinned regression baseline and rollout decision.

**Acceptance:** All must-pass gates for R2 are accepted; user-facing visual changes have approval; no data-loss/security blocker is waived.

**Excluded:** Automatically merging to main or deploying without applicable authorization.

**Earlier references:** renderer:Q06.

**Detailed plan:** `tasks/T052_PLAN.md` — write just before execution.

**Recorded sequence:** `53`.

**Recorded execution state:** `not_started`.

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

**Recorded sequence:** `54`.

**Recorded execution state:** `not_started`.

### T054 — Terrain, point-cloud and survey/bulk increments
**Status:** Deferred. **Release:** R3-optional. **Suggested owner:** Data/geometry.

**Dependencies:** T052.

**Scope:** Add useful coverage/survey profiles and their specialized resumable processing paths as separately scoped tasks.

**Outputs:** Asset catalog extensions; bounded adapters/derivations; no-data, datum, sampling and bulk-recovery tests.

**Acceptance:** Samples remain in suitable large assets; derived terrain/buildings have lineage; raw GNSS does not directly become parcel geometry.

**Excluded:** Mandatory point-per-row storage, automatic interiors from LiDAR or raw-sensor completeness claims.

**Earlier references:** schema:U07, schema:U11, schema:U19, renderer:E05, renderer:E06.

**Detailed plan:** `tasks/T054_PLAN.md` — write just before execution.

**Recorded sequence:** `55`.

**Recorded execution state:** `not_started`.

### T055 — Private parties, official integrations and multi-user expansion
**Status:** Deferred. **Release:** R3-optional. **Suggested owner:** Architecture/security.

**Dependencies:** T052.

**Scope:** Plan separately authorized occupancy/registry connectors, real authentication and any mobile/offline workflows.

**Outputs:** Data agreements and access requirements; distinct Party/Occupancy/RRR/account schemas; separate bounded implementation tasks.

**Acceptance:** Real residents are not demo fixtures; owners/occupants/logins stay separate; external integration and multi-user claims match actual authorization and tests.

**Excluded:** Making this a prerequisite for the local renderer or publicizing restricted infrastructure/person data.

**Earlier references:** schema:U12.

**Detailed plan:** `tasks/T055_PLAN.md` — write just before execution.

**Recorded sequence:** `56`.

**Recorded execution state:** `not_started`.

### T056 — Measured capacity and large-catalog expansion
**Status:** Deferred. **Release:** R3-optional. **Suggested owner:** Streaming/performance.

**Dependencies:** T052.

**Scope:** Increase scale only after the declared workload and bottlenecks are measured.

**Outputs:** 100k/1M catalog experiments where useful; visible-load benchmarks; resource/cost and operational capacity profile.

**Acceptance:** Reported capacity states exact workload, hardware, network and limits; source completeness is never inferred from synthetic object count.

**Excluded:** A mandatory 1M milestone before releasing useful R1/R2 functionality.

**Earlier references:** renderer:S05, renderer:Q05, renderer:Q06.

**Detailed plan:** `tasks/T056_PLAN.md` — write just before execution.

**Recorded sequence:** `57`.

**Recorded execution state:** `not_started`.

### T061 — Local spatial extraction and reviewed bulk handoff
**Status:** Implemented. **Release:** R3-assistance. **Suggested owner:** Codex.

**Dependencies:** None; environment and authorization requirements still apply.

**Scope:** Pinned local building and floor-plan models, persisted per-source batches, exact raster review, calibrated candidates and ordinary preparation/area review handoff.

**Outputs:** Actual model evaluation, private inference runtime, immutable receipts and artifacts, review UI and source-to-draft verification.

**Acceptance:** Actual inference runs through retained originals and private jobs; masks and failures persist; calibration and review remain required; retry and replay preserve originals and identities.

**Excluded:** Paid provider fallback, legal or statutory acceptance, ownership prediction, national data coverage and universal input formats.

**Earlier references:** New explicit user/architecture requirement.

**Detailed plan:** `tasks/T061_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `61`.

**Recorded execution state:** `implemented_actual_model_workflow_browser_verified`.

**Recorded evidence:** `tasks/T061_RESULT.md`, `../evidence/t061/verification-summary.json`, `../evidence/t061/WORKFLOW_RESULT.md`, `../evidence/t061/workflow-result.json`, `../evidence/t061/atomic-footprint.json`, `../evidence/t061/models/evaluation.md`.

## E15 — Officer workflow simplification and Studio-only UI
Exit: Supported source-to-record journey is simple, resumable and uses only Studio presentation.

### T062 — Audit officer workflow and plan Studio-only simplification
**Status:** Implemented. **Release:** R2-officer-ux. **Suggested owner:** Fresh Astra 6 High worker; parent review.

**Dependencies:** None; environment and authorization requirements still apply.

**Scope:** Audit rendered workflow and all route/capability families against SIH 26011; document safe automation and ordered migration.

**Outputs:** Audit rendered workflow and all route/capability families against SIH 26011; document safe automation and ordered migration.

**Acceptance:** Planning record consistency and truthful requirement coverage.

**Excluded:** Official issuance, multi-user rollout, paid fallback, unsupported survey input expansion, deletion of source data.

**Earlier references:** New explicit user/architecture requirement.

**Detailed plan:** `tasks/T062_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `62`.

**Recorded execution state:** `audit_complete`.

**Recorded evidence:** `tasks/T062_RESULT.md`.

### T063 — Unify Studio entry points and officer directories
**Status:** Implemented. **Release:** R2-officer-ux. **Suggested owner:** Fresh Astra 6 High worker; parent review.

**Dependencies:** T062.

**Scope:** Make Studio default and sole normal route family; replace duplicate pages with compatibility redirects; improve default landing and searchable directories.

**Outputs:** Make Studio default and sole normal route family; replace duplicate pages with compatibility redirects; improve default landing and searchable directories.

**Acceptance:** Route/context tests including legacy aliases, fixture/canonical separation and duplicate query values; focused typecheck/build; browser default, directory search and Back/reload.

**Excluded:** Official issuance, multi-user rollout, paid fallback, unsupported survey input expansion, deletion of source data.

**Earlier references:** New explicit user/architecture requirement.

**Detailed plan:** `tasks/T063_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `63`.

**Recorded execution state:** `implemented_reviewed_browser_verified`.

**Recorded evidence:** `tasks/T063_RESULT.md`, `tasks/T063_WORKER_RESULT.md`, `../evidence/t063/results.json`.

### T064 — Inspect files and simplify GIS intake
**Status:** Implemented. **Release:** R2-officer-ux. **Suggested owner:** Fresh Astra 6 High worker; parent review.

**Dependencies:** T063.

**Scope:** Replace front-loaded technical GIS form with file-first inspection and safe metadata defaults.

**Outputs:** Replace front-loaded technical GIS form with file-first inspection and safe metadata defaults.

**Acceptance:** Projected native files, multiple layers, missing/conflicting CRS, malformed files and ID ambiguity; original-byte preservation; browser file-to-draft review; typecheck/build.

**Excluded:** Official issuance, multi-user rollout, paid fallback, unsupported survey input expansion, deletion of source data.

**Earlier references:** New explicit user/architecture requirement.

**Detailed plan:** `tasks/T064_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `64`.

**Recorded execution state:** `implemented_reviewed_browser_verified`.

**Recorded evidence:** `tasks/T064_RESULT.md`, `tasks/T064_WORKER_RESULT.md`, `../evidence/t064/results.json`.

### T065 — Resume and guide preparation from saved state
**Status:** Implemented. **Release:** R2-officer-ux. **Suggested owner:** Fresh Astra 6 High worker; parent review.

**Dependencies:** T064.

**Scope:** Persist continuation and show one useful next action; compact source-linked fact review and placement.

**Outputs:** Persist continuation and show one useful next action; compact source-linked fact review and placement.

**Acceptance:** Reload after upload/extraction/placement/build; stale/failed job; no duplicate model/record; browser Build-to-review and keyboard; targeted tests/build.

**Excluded:** Official issuance, multi-user rollout, paid fallback, unsupported survey input expansion, deletion of source data.

**Earlier references:** New explicit user/architecture requirement.

**Detailed plan:** `tasks/T065_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `65`.

**Recorded execution state:** `implemented_reviewed_browser_verified`.

**Recorded evidence:** `tasks/T065_RESULT.md`, `tasks/T065_WORKER_RESULT.md`, `../evidence/t065/results.json`, `../evidence/t065/worker-state.json`.

### T066 — Unify source intake and source-led extraction
**Status:** Implemented. **Release:** R2-officer-ux. **Suggested owner:** Fresh Astra 6 High worker; parent review.

**Dependencies:** T065.

**Scope:** Offer supported document uploads consistently and allow aerial building extraction before any building exists.

**Outputs:** Offer supported document uploads consistently and allow aerial building extraction before any building exists.

**Acceptance:** No existing building source-led journey, floor-plan path, partial/empty/error/retry/cancel, source/placement mismatch, idempotence and originals; actual local inference/browser; focused tests/build.

**Excluded:** Official issuance, multi-user rollout, paid fallback, unsupported survey input expansion, deletion of source data.

**Earlier references:** New explicit user/architecture requirement.

**Detailed plan:** `tasks/T066_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `66`.

**Recorded execution state:** `implemented_reviewed_browser_verified`.

**Recorded evidence:** `tasks/T066_RESULT.md`, `tasks/T066_WORKER_RESULT.md`, `../evidence/t066/browser/results.json`, `../evidence/t066/workflow/state.json`.

### T067 — Declutter Studio map register and workspace
**Status:** Implemented. **Release:** R2-officer-ux. **Suggested owner:** Fresh Astra 6 High worker; parent review.

**Dependencies:** T066.

**Scope:** Create consistent visual hierarchy and officer wording across maps, register, retained records and workspace.

**Outputs:** Create consistent visual hierarchy and officer wording across maps, register, retained records and workspace.

**Acceptance:** Desktop/tablet and keyboard/focus captures; floor/unit selection, findings, source/history/exports, advanced correction access; affected regression tests/build.

**Excluded:** Official issuance, multi-user rollout, paid fallback, unsupported survey input expansion, deletion of source data.

**Earlier references:** New explicit user/architecture requirement.

**Detailed plan:** `tasks/T067_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `67`.

**Recorded execution state:** `implemented`.

**Recorded evidence:** `tasks/T067_RESULT.md`, `tasks/T067_WORKER_RESULT.md`, `../../evidence/t067/results.json`, `../../evidence/t067/queue-state.json`.

### T068 — Delete obsolete presentations and qualify complete journey
**Status:** Implemented. **Release:** R2-officer-ux. **Suggested owner:** Fresh Astra 6 High worker; parent review.

**Dependencies:** T067.

**Scope:** Remove proven-unused presentation code and verify the integrated officer journey.

**Outputs:** Remove proven-unused presentation code and verify the integrated officer journey.

**Acceptance:** Production build; supported GIS/source-to-extraction-to-review-to-record-to-export journey, refresh and errors; original/identity preservation; route scan; final browser captures; record actual results and unqualified acceptance gates.

**Excluded:** Official issuance, multi-user rollout, paid fallback, unsupported survey input expansion, deletion of source data.

**Earlier references:** New explicit user/architecture requirement.

**Detailed plan:** `tasks/T068_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `68`.

**Recorded execution state:** `implemented`.

**Recorded evidence:** `tasks/T068_RESULT.md`, `tasks/T068_WORKER_RESULT.md`, `../../evidence/t068/journey.json`, `../../evidence/t068/preservation.json`, `../STUDIO_DEMO_GUIDE.md`.

### T069 — Correct supplied UI references before continuing implementation
**Status:** Implemented. **Release:** R2-officer-ux. **Suggested owner:** Parent design and review.

**Dependencies:** T063.

**Scope:** Audit the supplied image pack and produce coherent simplified reference mockups first, then update remaining implementation tasks.

**Outputs:** Corrected screen set and interaction specification with consistent fictional specimen.

**Acceptance:** Each generated design is visually reviewed against hierarchy, automation, truthful state and consistent workflow; originals remain untouched.

**Excluded:** Further app implementation until reference pass is complete; official issuance or survey claims.

**Earlier references:** New explicit user/architecture requirement.

**Detailed plan:** `tasks/T069_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `69`.

**Recorded execution state:** `six_reference_mockups_reviewed_and_viewer_verified`.

**Recorded evidence:** `tasks/T069_RESULT.md`, `../../design/officer-studio-v3/DESIGN_BRIEF.md`, `../../design/officer-studio-v3/REVIEW.md`.

## Historical tasks without an epic assignment

These records retain their supplied metadata; no epic or acceptance is inferred.

### T070 — Clear application data and built-in demo entry points
**Status:** Implemented.

**Dependencies:** None; environment and authorization requirements still apply.

**Scope:** User-authorized local linked application reset; verified private database and object backup, clear saved data and job queue, remove hardcoded demo navigation, verify empty app.

**Detailed plan:** `tasks/T070_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `70`.

**Recorded execution state:** `clean_local_app_verified`.

**Recorded evidence:** `tasks/T070_RESULT.md`, `../evidence/t070/verification.json`.

### T071 — Bulk-first UI references and normalized demo data contract
**Status:** Implemented.

**Dependencies:** T070.

**Scope:** Reference audit, Drive source inventory, canonical schema and isolated fictional fixture, interactive UI reference set with highly usable 3D map.

**Detailed plan:** `tasks/T071_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `71`.

**Recorded execution state:** `isolated_reference_prototype_verified_pending_user_visual_review`.

**Recorded evidence:** `tasks/T071_RESULT.md`, `../../design/bulk-studio-v4/README.md`, `../../design/bulk-studio-v4/REFERENCE_AUDIT.md`, `../evidence/t071/verification.json`.

### T072 — Recreate reference-quality 3D neighbourhood map
**Status:** Implemented.

**Dependencies:** T071.

**Scope:** Build separate synthetic reference neighbourhood, detailed renderer, uploadable source package and browser-verified usable map.

**Detailed plan:** `tasks/T072_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `72`.

**Recorded execution state:** `verified_local_prototype_visual_acceptance_pending`.

**Recorded result:** `tasks/T072_RESULT.md`.

**Recorded evidence:** `evidence/t072/map/results.json`, `evidence/t072/map/context-loss.json`, `evidence/t072/upload-results.json`, `evidence/t072/upload-contract-results.json`, `evidence/t072/reference-comparison.png`, `../../design/reference-map-v5/data/validation-report.json`.

### T073 — Dense plotted block and computed spatial conflicts
**Status:** Implemented.

**Dependencies:** T072.

**Scope:** Correct the isolated map with attached/overlapping buildings, dense streets and computed building/road/parcel conflicts.

**Detailed plan:** `tasks/T073_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `73`.

**Recorded execution state:** `dense_arrangements_verified_visual_review_pending`.

**Recorded result:** `tasks/T073_RESULT.md`.

**Recorded evidence:** `evidence/t073/map/results.json`, `evidence/t073/spatial-browser-results.json`, `evidence/t073/spatial-runtime-results.txt`, `evidence/t073/upload-results.json`, `evidence/t073/reference-comparison.png`.

### T074 — Audit all reference images and plan complete shared-schema replication
**Status:** Implemented.

**Dependencies:** T073.

**Scope:** Reference review and plan only: 35 paths / 17 unique images, current renderer/schema audit, interactive review gallery and sequential acceptance gates.

**Detailed plan:** `tasks/T074_REFERENCE_REPLICATION_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `74`.

**Recorded execution state:** `audit_complete_replication_not_implemented`.

**Recorded result:** `tasks/T074_RESULT.md`.

**Recorded evidence:** `evidence/t074/reference-image-inventory.json`, `evidence/t074/verification.json`, `tasks/T074_MAP_IMAGE_AUDIT.md`, `tasks/T074_REGISTER_WORKSPACE_AUDIT.md`, `tasks/T074_BOARD_IMAGE_AUDIT.md`, `tasks/T074_SCHEMA_RENDERER_AUDIT.md`.

### T075 — Unify reference import compatibility with canonical scene contract
**Status:** Implemented.

**Dependencies:** T074.

**Scope:** Pin adapters and renderer profiles at existing canonical boundary; test source-preserving import for independent fixtures including multipart, holes, rotated frames and nonzero elevations. No live demo seeding.

**Detailed plan:** `tasks/T075_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `75`.

**Planning reference:** `tasks/T074_REFERENCE_REPLICATION_PLAN.md`.

**Recorded execution state:** `canonical_adapter_verified`.

**Recorded result:** `tasks/T075_RESULT.md`.

**Recorded evidence:** `../../tests/t075-reference-adapter.test.ts`, `../../tests/t075-package.test.ts`, `../../tests/t075-presentation.test.ts`.

### T076 — Shared reference viewport and exact Block Map composition
**Status:** Implemented.

**Dependencies:** T075.

**Detailed plan:** `tasks/T076_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `76`.

**Recorded execution state:** `shared_runtime_verified_visual_superseded`.

**Recorded result:** `tasks/T076_RESULT.md`.

### T077 — Searchable identities, source normalization and shared register
**Status:** Implemented.

**Dependencies:** T076.

**Detailed plan:** `tasks/T077_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `77`.

**Recorded execution state:** `register_accepted_map_rejected_by_user`.

**Recorded result:** `tasks/T077_RESULT.md`.

### T078 — Reconstruct reference neighbourhood and remove map lag
**Status:** Implemented.

**Dependencies:** T077.

**Detailed plan:** `tasks/T078_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `78`.

**Recorded execution state:** `browser_verified_visual_review_open`.

**Recorded result:** `tasks/T078_RESULT.md`.

### T079 — Declutter map and generate complete reference-city source package
**Status:** Implemented.

**Dependencies:** T078.

**Detailed plan:** `tasks/T079_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `79`.

**Recorded execution state:** `source_draft_verified_recording_gap_open`.

**Recorded result:** `tasks/T079_RESULT.md`.

### T080 — Connect mixed-source receipts to durable batch review and scoped recording
**Status:** Planned.

**Dependencies:** T079.

**Scope note:** Use existing source storage/canonical services. Qualify frame mapping, source readback, resume/reimport identity and independent recording scope. See T079_WORKFLOW_AUDIT.md.

**Detailed plan:** No path recorded.

**Recorded sequence:** `80`.

**Recorded execution state:** `not_started`.

### T081 — Fix map navigation, import Shiv Vihar and audit statement coverage
**Status:** Implemented.

**Dependencies:** T079.

**Detailed plan:** `tasks/T081_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `81`.

**Recorded execution state:** `browser_verified_preview_and_coverage_limits_documented`.

**Recorded result:** `tasks/T081_RESULT.md`.

### T082 — List and directly reopen Lake View and Shiv Vihar
**Status:** Implemented.

**Dependencies:** T081.

**Detailed plan:** `tasks/T082_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `82`.

**Recorded execution state:** `directory_and_named_reload_browser_verified`.

**Recorded result:** `tasks/T082_RESULT.md`.

### T083 — Persist Lake View and Shiv Vihar with immutable originals and canonical snapshots
**Status:** Implemented.

**Dependencies:** T082.

**Detailed plan:** `tasks/T083_PLAN.md` — authored; inspect its status before execution.

**Recorded sequence:** `83`.

**Recorded execution state:** `database_object_storage_and_ui_save_verified`.

**Recorded result:** `tasks/T083_RESULT.md`.

### T084 — Saved-dataset ML processing and live hackathon walkthrough
**Status:** Implemented.

**Dependencies:** T083.

**Detailed plan:** `tasks/T084_PLAN.md` — authored; inspect its status before execution.

**Recorded execution state:** `real_inference_review_calibration_and_live_walkthrough_verified`.

**Recorded result:** `tasks/T084_RESULT.md`.

### T085 — Visual-only hackathon presentation
**Status:** Implemented.

**Dependencies:** T084.

**Detailed plan:** `tasks/T085_PLAN.md` — authored; inspect its status before execution.

**Recorded execution state:** `superseded_by_T086_actual_ml_presentation`.

**Recorded result:** `tasks/T085_RESULT.md`.

### T086 — Actual ML input, pixel mask and outline presentation
**Status:** Implemented.

**Dependencies:** T085.

**Detailed plan:** `tasks/T086_PLAN.md` — authored; inspect its status before execution.

**Recorded execution state:** `actual_artifacts_and_browser_visuals_verified`.

**Recorded result:** `tasks/T086_RESULT.md`.

### T087 — Label ML source purposes and simplify processing UI
**Status:** Implemented.

**Dependencies:** T086.

**Detailed plan:** `tasks/T087_PLAN.md` — authored; inspect its status before execution.

**Recorded execution state:** `source_routing_guards_and_browser_ui_verified`.

**Recorded result:** `tasks/T087_RESULT.md`.

### T088 — PDF page controls, result arrows and complete Lake View demo package
**Status:** Implemented.

**Dependencies:** T087.

**Detailed plan:** `tasks/T088_PLAN.md` — authored; inspect its status before execution.

**Recorded execution state:** `pdf_bounds_result_navigation_and_full_import_verified`.

**Recorded result:** `tasks/T088_RESULT.md`.

### T089 — Publish main and import fresh hosted demo through UI
**Status:** Implemented.

**Dependencies:** T088.

**Detailed plan:** `tasks/T089_PLAN.md` — authored; inspect its status before execution.

**Recorded execution state:** `main_deployed_fresh_browser_imports_and_actual_ml_verified`.

**Recorded result:** `tasks/T089_RESULT.md`.

### T090 — Source ULPIN mapping, persisted 3D identity and map clarity
**Status:** Implemented.

**Dependencies:** T089.

**Detailed plan:** `tasks/T090_PLAN.md` — authored; inspect its status before execution.

**Recorded execution state:** `persisted_identifiers_global_search_and_hosted_map_verified`.

**Recorded result:** `tasks/T090_RESULT.md`.

### T091 — Mobile scrolling and reachable map sidebars
**Status:** Implemented.

**Dependencies:** T090.

**Detailed plan:** `tasks/T091_PLAN.md` — authored; inspect its status before execution.

**Recorded execution state:** `responsive_browser_verified_and_hosted_build_deployed`.

**Recorded result:** `tasks/T091_RESULT.md`.

### T092 — Imported LiDAR, orthomosaic and DEM/DSM map views
**Status:** Implemented.

**Dependencies:** T091.

**Detailed plan:** `tasks/T092_PLAN.md` — authored; inspect its status before execution.

**Recorded execution state:** `binary_source_views_import_mobile_and_hosted_verified`.

**Recorded result:** `tasks/T092_RESULT.md`.

### T093 — Clear selectable 3D floor registry
**Status:** Implemented.

**Dependencies:** T092.

**Detailed plan:** `tasks/T093_PLAN.md` — authored; inspect its status before execution.

**Recorded execution state:** `local_mobile_geometry_tests_and_hosted_render_verified`.

**Recorded result:** `tasks/T093_RESULT.md`.

## Separate maintenance

### M001 — Delete previously authorized old proof directory
Status: Accepted. Exact target: `E:\Projects\3d-ulpin-proof-20260917`.

Only this exact resolved directory; reject reparse points/links and unexpected path resolution; preserve product repo, sources and other study directories.

Does not block product tasks. Plan: `tasks/M001_PROOF_CLEANUP_PLAN.md`.
