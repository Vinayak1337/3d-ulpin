# Backend architecture and streaming decisions

Owner: LEAD; implementation: FND, INGEST and DATA. Adopted from the user's 26 September 2026 answers. This document resolves conflicts in the supplied hardening review and pasted suggestions; it does not turn their historical claims into verified results. Read it with H01, H14, H22, H28 and H29.

## Decisions and source normalization

- Implement backend plan tasks in separate worker worktrees. The lead hardens and integrates plans directly. Ordinary Codex tasks are reused by model; every Luna assignment uses xhigh or max. Fast is requested, with actual turn tier reported only when observable.
- Keep every public-portal capability in `full_product`: public tiles, search, records, verify, corrections, submissions and sign-in. Finale card verification remains the authorized same-device workflow. No public service activation or deployment is authorized.
- Adopt `packages/server` as the gradual backend destination and keep `packages/contracts` as the wire contract. `apps/studio`, its role-gated admin routes, `apps/global`, shared scene and shared UI are user-owned target boundaries. This plan chooses or changes no frontend framework, renderer, dependency or component. Do not create those apps as a backend scaffolding task.
- Keep existing clients and saved URLs working through thin adapters and compatibility exports. Freeze new frontend work in `apps/web`; permit assigned backend extraction and security fixes there. Do not bulk-move its server directory or delete it before consumers migrate.
- Require one bounded official Indian city/district layer for backend streaming and scale qualification in GF2. Larger 100k/1M ladders remain full product. Browser/GPU/frame-rate acceptance belongs to the frontend owner and cannot be inferred from backend results.
- Preserve `design-mockup/` and the supplied visual references byte-for-byte. Their example records and prototype code are not product data or implementation instructions.

The input Word file is the revised 26 September copy, SHA-256 `a0c70fa9479b34d3311d73eb2532268b48fa7b9659212cfe66a89ae81b24017e`. The three pasted notes describe successive proposals, not three cumulative specifications. Their `92e4d04`/unmerged-mockup statements are obsolete: normalization starts at integrated staging `0ba58c511371d1a2d5aeddee4a36f15bf78b6ed1`. The pasted source hashes are `fb1cdfef8dc14f82a49cb3e4d53bdc26a36b4c3a03e4124ffb68619bd5cc22f4` (Three.js proposal), `2605b0422d4f6856f328465b52254f073064875561988c4d4c0b1ffbc03516e4` (old staging audit), and `87492844d4b38fac6173aaedb48b781692715f715ca38318dd41037fa5c474c9` (Word-edit summary). Preserve the earlier `45d033...` D0/D1 receipt pin as historical evidence; never relabel it as a new runtime result. Reconcile the live integration head for each assignment.

Keep the stronger existing rules: opaque P3 identity with separate display location and reviewed anchors; CityJSON plus a provenance/rights sidecar; named vertical references; qualified solids only; source-supported topology findings with valid voids/setbacks; deterministic finding order; separate provider permission, residency and training qualification. Do not copy the review's stale scorecard, legal conclusions, blanket GPL licensing assurances, fixed implementation duration or unmeasured speed claims. Existing FND work is reused, not rebuilt from prose.

## One registry with qualified geographic projections

Canonical originals, native geometry, local reference frames, identities and revision history stay intact. A qualified global spatial index and display derivative may be added only with a documented transform: source/target CRS, axis order, units, vertical datum/reference, epoch where applicable, grid/model versions, control provenance and residuals/limitations. Three correspondences alone do not prove accuracy. Bounds, address, nearby parcels or a map centre never establish the CRS. Unknown placement remains useful in its named local frame; global placement and incompatible comparisons stay blocked.

Blocks scope acquisition, review and coverage, not separate registries. Namespace source-native keys by issuer/dataset/source family. Distinguish byte deduplication, upload-intent idempotency, source revision and canonical entity identity. Same bytes do not merge permissions or evidence associations. Partial/windowed imports cannot delete missing rows as though they were complete replacements. Cross-block or cross-tile fragments resolve to one canonical record; duplicate reconciliation uses reviewed H26 lineage.

Retain one job authority, conversion registry, provider gateway and reservation/budget mechanism. Add spatial indexes and publication views to the existing schema rather than introducing a second city database as authority. 3DCityDB remains an optional later exchange projection. Display geometry never becomes analytical ground truth by being tiled.

## Backend output profiles and tool qualification

| Output | Candidate | Qualification boundary |
| --- | --- | --- |
| Supported 3D geometry | pg2b3dm / 3D Tiles 1.1 | Pin executable/config; prove supported geometry, implicit/explicit hierarchy, transform, metadata and canonical record lookup. A generated feature index is not automatically a registry UUID. |
| Parcels, footprints, roads and coverage | Martin / MVT | Explicit allowlisted sources and least-privilege read role; automatic table/function publication disabled. Auth is enforced before any private cache lookup. |
| Official imagery and elevation rasters | TiTiler / COG | Restricted object identifiers, no arbitrary caller URL, bounded range reads and per-resource access. Override public cache/CORS defaults for private data. |
| Terrain and point clouds | Separately qualified processors | COG imagery is not quantized-mesh terrain. COPC/point-cloud and terrain outputs need their own supported-format, reference and resource evidence. |

These tools are candidates until a pinned source-to-output check passes. No frontend installation follows from this table. Default database connections, unlimited command runtimes, generated SQL, public cache settings or source URL fetches are not accepted defaults. Use explicit connection/roles, trusted query construction, isolated outputs, byte/CPU/time limits and private storage.

Upstream basis: [OGC 3D Tiles 1.1](https://docs.ogc.org/cs/22-025r4/22-025r4.html), [pg2b3dm](https://github.com/Geodan/pg2b3dm), [Martin configuration](https://maplibre.org/martin/config-file/), [Martin auth/cache guidance](https://maplibre.org/martin/run-with-nginx/), [TiTiler COG endpoints](https://developmentseed.org/titiler/endpoints/cog/) and [TiTiler application defaults](https://developmentseed.org/titiler/user_guide/getting_started/). Standards and available plugins do not establish project runtime support, incremental publication or city/state performance.

## Progressive delivery and stable publication

Raw multipart byte parts, semantic processing chunks and display cells are different units. Preserve bounded readers and existing admission limits; add a durable multipart/object-store receipt profile before admitting larger individual originals. Finalization verifies original bytes/hash/size and complete companions before conversion. Abort/retry/resume and orphan cleanup must not delete canonical originals or another upload's parts.

Private Studio delivery may advance from committed, authorized semantic chunks. Prepare immutable output assets and their identity/dependency maps first. Then atomically accept a generation manifest/catalog pointer with source revisions, converter/grid/transform versions, scope, policy version and fencing token, and append its outbox event. Emit SSE after commit. Object storage is outside the database transaction: incomplete outputs remain unreachable, and delayed cleanup handles orphans. A retry must not expose mixed generations or overwrite a newer result.

Define a versioned spatial cell scheme for each output profile; do not assume all MVT, raster and 3D formats have identical physical partitions. A change invalidates cells touching both old and new extents, required neighbours/halos and parent/overview dependencies. Deletion, identity changes, source revisions, transforms and access-policy changes all participate. Reuse unchanged content-addressed artifacts where possible; prove incremental behavior rather than assuming pg2b3dm provides it. Visual fragments may cross cells, but lookup and analytical queries must not duplicate canonical records.

Stale-but-still-authorized output may be retained during a benign rebuild with its exact revision stated. Revocation, retirement or lost access overrides that fallback: deny affected old artifact reads at the serving boundary, suppress stale job publication and invalidate relevant manifests/lookup caches. For a mixed artifact, withdraw it until a safe replacement exists. Cache purge alone is insufficient; already delivered bytes cannot be recalled.

For the deferred public product, an explicit officer release decision pins selected units, fields, geometry and permission. Build a sanitized released-only projection and separate asset set; atomically adopt one release generation for search, counts, records, verification and tiles. No live private-table views, officer caches/sessions, original-object URLs or private resolver fallback. Sharing client code or a coordinate convention never shares private records. This boundary is specified now, not implemented in the finale.

## Bounded backend acceptance

**GF-BACKEND:** observe current isolated service health and a source-to-job-to-record API flow from unchanged official bytes, with original hashes preserved and one meaningful retry/recovery case. Provide current commands, actual URL and environment ownership. The retired snapshot launcher is unavailable; no historical receipt supplies this pass.

**GF-STREAM:** pinned official inputs produce bounded, authorized generations whose assets, record maps, hashes and reference metadata agree. Observe a first accepted useful generation before a multi-chunk import completes, plus resume/idempotency, a stale completion and one affected-cell update. Check unavailable/invalid frames remain excluded from global output. Preserve source integrity and existing privacy checks without inventing operational test data.

**GF-SCALE-1:** before running, DATA and INGEST pin the city/district layer, geographical extent, actual feature/position count, original/expanded byte sizes, permissions, reference quality, hardware, concurrency, cold/warm procedure and numerical service budgets. Measure receipt/preparation time, first committed usable generation, completion, memory, storage and bounded viewport/record lookup latency. A large bounding box alone is not a scale corpus. A vector layer qualifies only its vector profile, never 3D city/interior capacity. No eligible source or unmet budget leaves the required gate open; never silently substitute an invented corpus or claim a state-scale result.

Frontend consumption, pick-to-record interaction and frame-rate evidence are separate integration requirements. Reuse directly relevant tests; do not add an exhaustive benchmark matrix or a new UI harness. All new runtime gates stay pending until qualified receipts exist.

## Execution order and ownership

1. **API-DOC-01**, Sol: publish the implemented OpenAPI specification and frontend/data guide from actual code, with schemas and honest runtime/data availability. Run alongside DATA-10.
2. **RUN-01**, Sol: qualify a guarded real-source local backend startup, health, import/job/read flow and recovery; provide API base URL and exact frontend startup instructions. Reuse an existing inspected official source independently of DATA-10 when possible.
3. **DATA-10**, Luna xhigh/max: acquire and pin an eligible large official layer, or document a concrete access/permission gap. Starts alongside API-DOC-01 and may continue alongside API-01; select by official availability rather than imposing a new locality.
4. **API-01**, Sol: establish a server-only package and extract a bounded existing backend slice with compatibility exports, current API behavior and existing checks preserved. No new UI, database replacement or second authority.
5. **INGEST-06**, Sol: durable large-original receipt and bounded admission, only where the selected source requires it.
6. **TILE-01**, Sol: one qualified source/output profile, canonical identity mapping, private generation/outbox semantics and versioned cell invalidation. Reuse the existing jobs/guards; no parallel tiling control plane.
7. **SCALE-01**, Sol with DATA: run GF-STREAM/GF-SCALE-1 on the pinned official corpus, record backend results and leave frontend evidence with its owner.
8. Continue remaining GF1–GF5 backend cards according to actual dependencies. Accepted code is not restarted. Public delivery remains FP-PUBLIC; larger scale ladders remain FP-SCALE.

Lead owns plan changes, shared-seam assignment, review and integration. Each worker uses its own worktree and branch from a pinned accepted staging commit, commits only owned files, returns checks and a completion callback, and stops. Another model/task reviews concrete implementation when warranted. No task edits `design-mockup`, frontend apps/components/styles, credentials, populated databases or another worker's changes. No push, public activation, live provider call or deployment is authorized by this plan.
