# Decisions, risks, changes and source register

## 1. Decision status
The user's requested outcomes and latest instruction to plan one task at a time are controlling requirements. The implementation details below are proposed defaults pending their named qualification tasks. They are not claimed as already deployed changes.

| Decision | Proposed default | Revisit only when |
|---|---|---|
| ADR-001 Product foundation | Evolve the existing persisted `3d-ulpin` product; no standalone demo replacement | Actual capability/parity evidence shows a bounded component must be replaced. |
| ADR-002 Module boundary | Domain-led modules within current web/geometry/worker deployments | Measured ownership/deployment requirements justify an extracted service. |
| ADR-003 Contract authority | One versioned machine-readable source and cross-language conformance fixtures | The schema/validator parity experiment reveals a specific limitation. |
| ADR-004 Data authority | One authoritative writer per record; projections are rebuildable readers | A planned transition needs a tightly bounded, tested ownership handover. |
| ADR-005 Geometry | Preserve originals and multiple explicit representations; analytical truth separate from display | A qualified new representation/profile is added, not a convenience coercion. |
| ADR-006 Coordinates | Explicit frames, vertical references and operation versions | New source/region requirements require another supported transform profile. |
| ADR-007 Identity | Stable canonical IDs, typed relations and external namespaces | A real split/merge changes the object lifecycle through recorded lineage. |
| ADR-008 Renderer | Cesium first, using the current product boundary and tested derived assets | An identical fixture demonstrates an unmet required material/picking/clipping/resource gate. |
| ADR-009 Client state | Shared resource cache, one inspection session, separately bounded GPU resources | A real interaction/latency requirement justifies a documented refinement. |
| ADR-010 Releases | R1 renderer, R2 integrated supported product, elective R3 expansion | The user explicitly changes product priorities or chooses a new supported profile. |
| ADR-011 Plan/status | New `backlog.json` is authoritative after adoption; legacy boards are read-only | An intentional tracker migration preserves IDs, dependencies and status ownership. |
| ADR-012 Evidence | Small reproducible test/result manifests; targeted visual captures | A task specifically needs a larger trace/recording to answer a measured question. |

Significant choices use the ADR template with real alternatives and consequences. Do not create one ADR per trivial helper or UI spacing value.

## 2. Risk register and bounded responses
| Risk | Consequence | Early control | Owner/task | Stop condition |
|---|---|---|---|---|
| Historical baseline mistaken for current code | Wrong branch or overwritten work | Fresh status/HEAD/worktree and instruction read | Lead, T001 | Unresolved dirty/concurrent work ownership. |
| Plan inflates into universal schema project | No visible product progress | Thin profiles plus immediate legacy consumer and two-block slice | Lead, T003/T013 | A first map waits on every future parser/party table. |
| Physical/legal/source identities collapsed | Broken register and incorrect associations | Explicit ID namespace/crosswalk and ambiguity tests | Data, T004/T009 | Automatic merge by name/proximity is required. |
| Unknown height/reference hidden by default | Attractive but false geometry/metrics | Independent capability states and frame tests | Geometry, T006/T007 | Unknown becomes zero or an invented surveyed value. |
| Appearance changes occupied geometry | Incorrect clearances/areas | Analytical/display separation and metamorphic tests | Rendering, T019/T022 | Style/LOD/explosion changes authoritative quantities. |
| City-specific visual code | Next dataset fails | Common compiler/recipes and holdout testing | Rendering, T026 | New locality needs source-code special cases. |
| Independent page stores/maps | Selection, sources and camera drift | Shared resource/session/viewport boundary | Frontend, T014–T016 | Views disagree about canonical entity/revision. |
| Shared cache leaks or races | Wrong/private record shown | Scope keys, subscriber cancellation, server access checks | Frontend/security, T014/T049 | Old/private response replaces permitted current state. |
| Partial publication across stores | Inconsistent rendered/record state | Staged immutable assets and validated DB pointer | Backend, T020/T031 | A failed build replaces last usable publication. |
| Migration loses source/history | Irrecoverable data loss | Isolated upgrade/backfill/restore and one-writer policy | Data, T010/T051 | Required invariant cannot be compared or restored. |
| GPU/decoder budget ignored | Stalls or crashes during demo | Real workload, bounded loading and plateau tests | Rendering, T029/T032 | Repeated travel grows without bound. |
| Passing static mockup mistaken for runtime | User gets another unusable UI | Actual browser captures, held gestures and multiple angles | QA, T021/T027 | Canvas is an image or interactions are not verified. |
| Untrusted source triggers side effects | Data/host compromise or resource exhaustion | Bounded parsers, safe references and negative tests | Security, T011/T049 | Arbitrary network/code/file access required. |
| Public source mixed with restricted documents | Private data exposed | Explicit source/derivative access boundary and DTO allowlists | Security, T005/T049 | Private fields appear in public/geometry-safe outputs. |
| Proof cleanup expands to source data | Lost project evidence/originals | Literal exact-path maintenance task | Lead, M001 | Path/link resolution differs from authorized directory. |
| Hardware or format support overclaimed | Unrepeatable demonstration | Capability matrix with pass/fail/blocked evidence | QA, all gates | A claimed supported profile has no actual qualifying run. |

Risk handling is qualitative and consequence-based. No invented probabilities, risk-free claims or arbitrary weighted score is needed. Task plans add specific mitigations and tests; this table is not a substitute for them.

## 3. Important corrections to the previous execution outline
The earlier 12-step summary is retained as the E01–E12 product sequence, but broad parents are decomposed into 52 core execution tasks. Four optional expansion briefs form E13. The proof deletion is separate M001, not a mandatory predecessor of all engineering.

The 21 original schema tasks and 60 original renderer tasks are preserved under different namespaces. A source task may split across a minimal contract, later consumer and optional profile. That means its broad original scope is not 'complete' when just the first contract exists. The crosswalk records each obligation instead of counting mapped tasks as finished.

Basic streaming, canonical-ID maps and failure-safe publication must exist before full visual tuning. The later world/scale stage extends those foundations; it is not the first time tiling appears. A million-object stress experiment and all future input adapters are explicitly removed as hidden first-release prerequisites. Elected supported profiles still need their own tests.

The current user request supersedes any earlier request to start host changes immediately: this turn produces a plan only. Previously approved proof deletion is retained with its exact path for later execution. This package does not claim to update the user's repository or old task workbook.

## 4. What remains unknown until execution
Actual current branch/code changes; installed dependencies and migration state; safe isolated test-resource configuration; full baseline test outcomes; supported pinned renderer extensions; independent transform/geometry error budgets for real inputs; coherent source coverage for a selected dense Uttam Nagar extent; required texture/asset licenses; target hardware performance; and exact implementation costs for optional formats.

No timeline, price, model-credit budget or completion percentage is promised without measuring throughput. Re-estimate after the first accepted foundation slice using real review/test effort. A detailed task plan may expose a necessary split; that is controlled refinement, not failure to follow the roadmap.

## 5. Project source register
**P01 — recovered current-context handoff:** `3D_ULPIN_Recovered_Context_and_Next_Steps.md`, 18 September 2026. Last-known local commit and inspected module boundaries; not a live check or verbatim transcript. Latest user messages supersede its older unresolved cleanup/authorization statements.

**P02 — unified-schema plan:** `3D_ULPIN_Unified_Schema_Plan_Pack.zip`, including schema tasks, input catalog and acceptance cases. Supplies 21 old schema tasks, 25 input families, the thin-model rationale and multi-source/two-block fixture expectations. Its proposed logical records are not executable migrations or deployed parsers.

**P03 — renderer-first plan:** `3D_ULPIN_Renderer_First_Plan_Pack.zip`, including 60 old tasks, 16 UI gates, 17 proposed benchmarks and reference manifest. Supplies the reusable full-neighbourhood priority and separation of visual/geometry/resource gates. Numerical benchmarks were proposals, not passed results.

**P04 — recovered reference archives:** `images(1).zip`, `3D_ULPIN_V2_DESIGN_PACK.zip`, `3D_ULPIN_REMAINING_12_UI_SCREENS.zip`. Actual image review for implementation acceptance is a named task; this planning turn does not claim a fresh detailed review of every source image. Some images are generated/static concept renders, not application screenshots.

Relevant extracted old records are preserved byte-for-byte under `legacy/`; `legacy/SOURCE_MANIFEST.json` records hashes and archive origins. The original archives and worksheet are not overwritten or silently reclassified.

## 6. Primary engineering references consulted on 18 September 2026
These sources inform methods or technical boundaries. They do not certify this implementation or supply its numerical performance results.

**S01 — Google Engineering Practices, Small CLs.** Small coherent changes with their tests support reviewable incremental work.
`https://google.github.io/eng-practices/review/developer/small-cls.html`

**S02 — Michael Nygard, Documenting Architecture Decisions.** Lightweight records retain context, decision, status and consequences, including supersession.
`https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions`

**S03 — Pramod Sadalage and Martin Fowler, Evolutionary Database Design.** Versioned small migrations and isolated development environments inform the compatibility/upgrade policy.
`https://martinfowler.com/articles/evodb.html`

**S04 — Google Engineering Practices, What to look for in a code review.** Review design, functionality, complexity and tests rather than relying on compilation alone.
`https://google.github.io/eng-practices/review/reviewer/looking-for.html`

**S05 — Simon Brown, C4 model diagrams.** Use context/container views and additional detail only where useful.
`https://c4model.com/diagrams`

**S06 — OGC 3D Tiles and Cesium3DTileset documentation.** Delivery and runtime controls are distinct from appearance, canonical records and measured device performance.
`https://www.ogc.org/standards/3dtiles/`
`https://cesium.com/learn/cesiumjs/ref-doc/Cesium3DTileset.html`

**S07 — PROJ geodetic transformations.** Coordinate operations can be pipelines rather than one universal affine matrix; exact installed capabilities require testing.
`https://proj.org/en/stable/usage/transformation.html`
