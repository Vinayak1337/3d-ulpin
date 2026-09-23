# 14 · Adaptive ingestion and durable progressive 3D review

**Provider-plan update, 23 September 2026:** [20 - Sarvam gateway, credit pools and permanent credential retirement](20-model-gateway-and-budget-pools.md) is required for this feature's model integration. Use [02 - Astra Max lead and explicit worker delegation](02-lead-agent-execution.md) for development-worker selection. These instructions do not claim a live provider, funded account or passing new tests.

Owner **INGEST**. Baseline `f623cff897f91bb3ebd4c225f700ac263f7beb72`; revised 22 September 2026. Read [00](00-README.md), [01](01-shared-contracts-and-ownership.md), [12 FIND](12-rights-aware-spatial-findings.md), [19 gateway](19-india-contained-deployment.md), and display consumer in [99](99-ui-ux-and-integration.md). ER-04/05/07–11/16/21/24/25 are incorporated here. New paths/types remain implementation tasks, not available exports.

## A. User outcome and product value

Allow an officer to receive unfamiliar supported sources, clarify a reusable mapping, see valid selectable draft geometry before the whole batch finishes, resolve exceptions and record a coherent reviewed group. The technical advantage is reusable interpretation plus progressive useful results—not an SSE animation or a model retrained on each upload.

Example: source fields plot_no/roof_ht_ft/parent_plot map to preserved string identifiers, explicitly documented feet-to-metres conversion and exact parent keys. A contradictory declared unit enters review; a source-only document can be normalized without having coordinates. No invented floors make the scene look complete.

## B. Current implementation and gap analysis

[Source normalizer](../../apps/web/features/spatial/reference-import/source-normalizer.ts) expects a declared synthetic manifest/profile; it is not an arbitrary-schema importer. [Saved datasets](../../apps/web/lib/server/spatial-datasets.ts) persist that synthetic path separately. [Source intake](../../apps/web/lib/server/source-cases.ts) and [area routes](../../apps/web/lib/server/area-routes.ts) are the case/import seams to extend through FND.

[Processing](../../apps/web/lib/server/processing.ts), [dispatcher](../../scripts/dispatcher.ts), [tasks](../../services/geo/geo/tasks.py) and [JobStore](../../services/geo/geo/store.py) provide existing job infrastructure but need 01 fencing and new-operation budgets. [Compiler](../../apps/web/features/spatial/compiler/compile.ts) already emits 3D Tiles 1.1/GLBs. [Scene service](../../apps/web/lib/server/spatial-core-scene.ts) compiles current recorded data into a process cache; it is not a durable unrecorded/history producer. [Current AI provider](../../apps/web/lib/server/officer-ai-provider.ts) is Nous-specific; Sarvam is new governed adapter work.

Required additions are versioned recipes, shared resumable receipts, independent processing/display partitions, immutable draft-scene manifests, fenced result application, actual replay and coherent review. Do not remove current synthetic-store restrictions or present old current-data endpoints as this producer.

## C. Scope and non-goals

INGEST0: deterministic CSV/JSON/GeoJSON intake, typed mappings and explicit missing states. INGEST1: durable chunks, usable draft geometry, restart/pause/replay, and FIND-qualified review groups. INGEST-AI: bounded recipe suggestions through the gateway after deterministic end-to-end success. All require actual case/record integration, not mock queues.

Reuse existing modality processors only for qualified capabilities. Raw point-cloud/raster/IFC retention does not mean reconstruction. General CAD/BIM conversion, arbitrary binary understanding, per-import fine-tuning/RL, guessed cadastral rights and automatic publication are excluded. Rich D1 exterior geometry uses 99's external display adapter; it must not be flattened into extrusion inputs. Specialist ML and wider formats are separately tested extensions, not prerequisites for V0.

## D. HLD and end-to-end flow

Receive durable original → inspect source family → reuse qualified recipe or propose/clarify one → partition complete records → bounded existing worker queue → normalize observations → resolve identity/reference placement → persist draft assets/manifest → show selectable results and exceptions → FIND reconciles eligible neighbours → officer reviews coherent group → FND prepares/reviews/commits through existing authorities. SSE transports small committed notifications; the queue and geometry assets are separate.

## E. Targeted LLD

### 1. Receipt, stages and workload profiles

`IngestBatch` pins ID/version, actor, IntakeScope initially, original manifest, policy/budget, nullable case/importPackage binding, recipe refs and stage results. The batch ID is never used as an existing import-package UUID. Before binding, progress stays in Add files; after binding `/studio/imports/:importPackageId` resolves the batch server-side. Each source reports retained/parsed/normalized/placed/validated independently with reason/evidence; extraction success does not imply placement or review.

Use FND receiveUpload/shared upload state; batch-specific upload rows are bindings only. Persist upload ID/owner/version before bytes; multipart default 4 MiB, sequential part index/hash. Duplicate same part is idempotent, changed bytes for a part is 409. Finalization verifies complete manifest/count/whole-file hash and commits receipt before parsing. Repeated finalize returns receipt. Partial/expired receipts are privately retained or cleaned by policy, never presented as preserved complete originals. Input archives are officer-only, at most one level; reject traversal, symlinks, encrypted unsupported files, excessive members and expansion bombs. Bound streaming actual bytes, not Content-Length alone.

| Profile | Initial bounds / downstream consequence |
| --- | --- |
| P0 workflow | D0, ≤30 spaces and three processing chunks; this proves integration before scale |
| P1 structured batch | ≤64 MiB uploaded, ≤128 MiB expanded, ≤100 members, ≤20,000 structured records; per-member/parser limits may be smaller |
| P1 child work | ≤500 complete vector/table records, ≤50,000 positions and ≤60-second execution; tune downward before exceeding an existing parser/core limit |
| Current exterior publication | Existing compiler ≤2,000 visible entities, 50,000 input positions, 12,000 schematic facade bays, 80 MiB assets, one qualified engineering frame within its 5 km bound |
| Visible client workload | Start 25–100 exteriors, ≤30 detailed spaces, ≤25 MiB visible geometry; viewport loading, not all processed records resident |
| Optional later bulk profile | 256 MiB upload/512 MiB expanded/100,000 records only after measured partition/recovery tests; not enabled by raising constants alone |

Preflight validates every intended stage/profile and reports unsupported paths before expensive work. Parsing 20,000 rows does not authorize one 20,000-object publication or a 20,000-space legacy query. Oversized individual geometry cannot be arbitrarily split into new legal objects; retain and report unsupported or use a separately qualified display derivative. Unknown total uses counts without a percentage. Model calls/tokens, decoded pixels/pages, cumulative work, storage and concurrency have separate caps. Use PACK's page limits for document rendering.

### 2. Qualified recipe, no generated executable code

`MappingRecipe` stores ID/version, parser/version, source-family/provider/version, schema fingerprint, declared semantic/unit/reference metadata fingerprint, target contract version, allowlisted operations, exact-key joins, null handling, evidence/clarification decisions, development examples, held-out tests and proposed/needs_input/qualified/retired state.

Allowed recipe operations: copy/rename, explicit enum lookup, finite numeric/date parse, named unit conversion, bounded nesting and exact-key lookup. Preserve IDs as strings, Unicode/literal values and leading zeros. Do not run generated JS/Python/SQL, dynamic imports, URLs or shell commands. Coordinates transform only via FND's qualified reference operation; do not guess CRS from magnitudes. Keep original fields and source locators even when normalization rejects a row.

The mapper receives bounded metadata plus representative examples and target schemas through modelGateway. It returns a strict recipe proposal and unresolved questions citing input fields/metadata. One bounded repair; thereafter manual mapping with the same recipe schema. Start with 3–10 representative samples if useful, adding rare/null/outlier cases and an independent holdout. That count is not an accuracy threshold.

Automatically reuse only a qualified recipe whose source-family/version, schema AND supplied semantics match and invariants pass. Ask an officer only for semantic information unavailable from supplied evidence; group the question for the justified source family. Contradictory declared units, renamed/removed required fields, invalid values or join cardinality changes trigger needs_input. **An undocumented unit change with otherwise identical plausible values cannot always be detected.** Record semantic assurance unknown/provider-confirmation-required when metadata is absent; never promise universal drift detection. Per-record invariant checks continue after reuse. Source observation confidence and mapping confidence are separate.

Entity association follows normalization: exact namespace/source ID and evidenced parent binding first; ambiguous candidates remain unresolved. Flat 101 in two buildings never auto-joins. Duplicate source bytes do not imply duplicate submission intent or one property identity. No AI training during imports: recipe memory is the initial optimization. Later reviewed correction datasets are permission-qualified, versioned and evaluated outside the critical path; own outputs are not ground truth.

### 3. Processing chunks are not rendering tiles

`ChunkManifest` pins original source/hash, source slice/locator, parser/recipe, schema ref, complete-record boundaries, frame/reference pins, dependency refs, content hash and count. Source key → canonical mapping is independent of chunk order. Tables respect quoted multiline records; vector features keep rings/holes and geometry intact. Document sections/pages can remain evidence-only without coordinates. Raster/point-cloud processing uses qualified windows and required neighbour overlap; relationship-rich models need dependency closure or explicit unsupported status.

Normalize observations before constructing geometry; placement/validation are separate outputs. Shared context can be referenced once. Render clipping/LoD is presentation only, with the same canonical object key across tiles. No duplicate property identity on a tile boundary; missing components/dependencies prevent a complete assessment.

### 4. Durable draft-scene producer — mandatory for progressive claims

Proposed tables: `usp_ingest_batches`, `usp_ingest_recipes`, `usp_ingest_chunks`, `usp_ingest_dependencies`, `usp_ingest_assets`, `usp_ingest_scene_manifests`, `usp_ingest_review_groups`; batch upload bindings reference shared uploads. Assets and entity-index pages live in existing private object storage. Immutable manifest includes:

```ts
type DraftSceneManifest = {
  schemaVersion: 'usp-scene-manifest/1'; kind: 'draft';
  manifestId: string; version: number; previousManifestId: string | null;
  batchId: string; scope: SnapshotScope;
  entityIndexRef: AssetRef;
  assets: AssetDescriptor[];
  replacedAssetIds: string[]; removedEntityRefs: CoreRef[];
  coverage: { received: number | null; placed: number; needsInput: number;
              expectedDependencies: number | null; completedDependencies: number };
};
```

AssetRef/descriptor schema is owned by FND/INGEST: opaque asset ID, immutable SHA-256/bytes/media type, geometric frame/bounds, LoD, safe canonical selection refs and dependencies. No raw storage URL or private source text. This new manifest's metadata is not a claim of complete OGC compliance.

Worker stores immutable output and verifies hash first. A same-client SQL transaction conditionally accepts the current attempt, writes manifest/entity-index refs, advances batch pointer and appends `scene.manifest_published`; crash before commit leaves only unreferenced private output. One batch manifest version is serialized/CAS-protected; stale publication retries merge against current accepted chunk set instead of overwriting another chunk. Asset removal/replacement is explicit; complete manifest is authoritative even if deltas are missed.

UI consumes this producer through the existing MapViewport/scene adapter, not the recorded-only scene endpoint. Preserve one recorded snapshot alongside a labelled draft; do not auto-record it. Selected entity IDs survive refinement; removed/retired entities become explicit unavailable selection. Old manifests remain retrievable while referenced by review/history/packets; event retention is not asset deletion policy. Missing historical bytes produce unavailable/reset-required, never rebuild current geometry under an old digest. No published manifest may reference an uncommitted/missing asset.

For rich external geometry, invoke the qualified external asset adapter from 99 and keep source shape/metadata; analytical facts are separate. Do not make another viewer or fill missing height/floors merely to render a mesh. Illustrative decorations stay display-only and labelled.

### 5. Jobs, pause and reconciliation

Use 01 logical-job/attempt fence for every new worker state/result write, not only lease release. Chunk state pending/eligible/queued/running/normalized/needs_input/failed/cancelled, with independent placement/check outputs. Default two light slots and one heavy slot only if the host supports them; bound total dispatch and fairness by batch. Prioritize a representative visible region without starving other jobs. Queue wait is not execution time. Pause blocks new claims and permits active valid work to finish as retained draft; cancel fences all later result application. Retries do not duplicate accepted outputs.

FIND consumes exact normalized representation and neighbour manifests after dependencies are available. Scope reconciliation records expected/received/assessed/missing counts. A dependency cycle in processing is an explicit error or bounded coherent group, not an endless queue. A partial batch can render, but `review_ready` is per coherent group and only after the group's required checks/evidence complete. If FIND unavailable, use `preview_ready`/`checks_not_assessed`, never `review_ready` for spatial recording. A validated independent group may proceed; mutually dependent updates commit together through FND. Show unresolved global coverage even after one group records.

### 6. Replay and client application

Use [SSE standard](https://html.spec.whatwg.org/multipage/server-sent-events.html) framing with FND's durable commit-ordered outbox, not Redis pub/sub as sole history. `GET /batches/:id` returns status, current manifest and eventCursor from **one repeatable-read transaction**. Then replay strictly after that cursor. Every event names stream/decimal sequence, schema/type, batch/version, manifest ref and safe stage counts. Event types include batch.profiled, mapping.needs_input, mapping.qualified, chunk.normalized, chunk.needs_input, scene.manifest_published, assessment.updated, batch.review_ready, batch.paused and batch.failed. `tile.ready` may be advisory only; manifest is authority.

Authenticate browser streams with same-origin HttpOnly session (local operator in local mode), never URL tokens. Reauthorize subscription/replay and at least every 15-second heartbeat; reconnect max 10-minute connection lifetime, tested with proxy buffering disabled. Expired/unknown cursor sends stream.reset_required then closes. Client fetches fresh consistent status; no silent skip. Default replay window seven days, independent of persisted batch/artifacts. Bound event payload to 16 KiB and client pending notifications to 100; overrun coalesces to a fresh manifest, not dropped authoritative state.

Events never carry GLBs or full source rows. Fetch at most four authorized assets concurrently, verify version/hash metadata, apply one coherent manifest transaction on an animation frame, dispose replaced resources and ignore old-generation responses. On a version gap reload the complete manifest. Counts reflect durable accepted stages. Old A responses cannot replace current B; per-asset arrival does not trigger global dossier reload. Denied/missing asset is explicit and cannot expose broader source data. Polling durable status every 2–5 seconds is the defined fallback when SSE is unavailable; report streaming qualification unmet, not fake live success.

### 7. APIs

Prefix `/api/v1/usp/ingestion`; 01 guards/envelopes. `POST /batches` creates IntakeScope; `POST /batches/:id/uploads`, `PUT /uploads/:id/parts/:number`, `POST /uploads/:id/finalize` use shared receipt primitives. `POST /batches/:id/profile` returns profile/job; `POST /recipes/:id/qualify` requires recipe/version/evidenced decisions; `POST /batches/:id/start` returns 202. Explicit POST pause/resume/cancel and `/chunks/:id/retry` require expected versions. GET batch, `/batches/:id/events`, `/manifests/:id`, `/assets/:id` are current-access checked. POST `/batches/:id/review-groups` pins chosen targets/dependencies; POST `/review-groups/:id/prepare` creates an existing draft/review via FND after reconciliation. Recording remains the separate established commit action.

### 8. Governed AI calls, budgets and fallback

Consume H20 through the existing modelGateway. Use Sarvam 105B V1 for bounded mapping/text interpretation; document OCR uses a separately qualified asynchronous Vision path, not a raw LiDAR-to-JSON LLM. Qualified recipe reuse precedes new inference; record model/prompt/schema/source/price receipt references. A retry or repair shares the task's total attempts, deadline and monetary reservation budget across every key. An exhausted organisation disables its whole key group; throttling waits and never bypasses account limits. Provider/ledger failure retains received sources and accepted drafts and exposes manual mapping or needs-input. Do not add an independent key cycler, billing counter, network client or per-import trainer. Returned token fragments never directly update geometry.

## F. Exact implementation map

| File | Required change / owner |
| --- | --- |
| Existing source-normalizer/browser/synthetic saved-dataset path | Preserve qualified behavior; read-only reuse by INGEST |
| Existing source-cases/area-routes/processing/dispatcher/geo tasks/store | FND narrow receipt, draft-preparation, operation and fence hooks |
| Proposed `packages/contracts/src/usp/ingestion.ts` | INGEST batch/recipe/chunk/scene/review-group schemas; FND common refs |
| Proposed `apps/web/lib/server/usp/ingestion/{uploads,profile,recipes,chunks,reconcile,events,assets,manifests,routes}.ts`, `migrations/14-ingestion.ts` | INGEST durable producer and leaf APIs |
| Proposed `services/geo/geo/usp_ingestion.py` | INGEST deterministic parsers/transforms; no generated-code execution |
| Proposed `apps/web/features/usp/ingestion/{BatchReceipt,MappingReview,ProgressiveReview,useBatchEvents}.tsx` | INGEST leaf state/content; shared scene and selection remain UI-owned |
| [ImportWork](../../apps/web/features/officer/work/ImportWork.tsx), [AddFiles](../../apps/web/features/officer/workspace/AddFiles.tsx), shared viewport/cache | UI mounts actual draft producer and bounded manifest consumer |
| Proposed `tests/usp-ingestion.test.ts`, `tests/usp-ingestion-stream.test.ts`, `tests/usp-ingestion-integration.ts`, `tests/usp-draft-scene-integration.ts`, `services/geo/tests/test_usp_ingestion.py`, `tests/e2e/usp-ingestion.spec.ts` | INGEST producer/recovery/consumer acceptance with UI integration |

## G. UI placement and interaction

Add files → durable receipt → concise mapping comparison/question → bound import review with draft map and exception list → select actual object/source → prepare coherent review group. Show placed/received and needs-input counts; total unknown is not 0%/100%. Source-only records remain visible in a list. Loading/reconnect preserves selected identity and recorded state; failed chunks do not erase accepted tiles. Draft/current distinction is visible, not hidden in a tooltip. Mobile has one contextual sheet; logs remain expandable diagnostics. UI owns scene/camera/query and must not animate camera per event.

## H. Ownership and dependencies

`feat/usp-ingestion`; own INGEST files/migration/tests only. F0 fixtures, F1-min real receipt/job/storage, then I1 with UI producer/consumer test. FIND is mandatory only for completed spatial reconciliation. DEPLOY/modelGateway is mandatory for any AI network call; no key → deterministic/manual recipe remains usable. FND owns shared worker/provider/API hooks, DATA pack bytes/oracles and UI renderer/cache. No synthetic-store weakening, duplicate queue or alternate registry.

## I. Implementation sequence and bounded decisions

1. Import D0 CSV/GeoJSON through real receipt→mapping→normalized candidate, no AI.
2. Implement shared resumable upload, exact source slices/recipe reuse and stage/budget reporting.
3. Complete three fenced worker chunks and durable draft manifest; UI selects unrecorded geometry and reloads it after restart.
4. Test outbox/status race, reversed completion, tombstone and cursor reset; enable SSE only when this matches authoritative fresh state.
5. Add FIND dependency/review-group bridge and existing record workflow.
6. Add gateway recipe suggestion, representative/held-out tests and truthful semantic assurance; one bounded repair, then manual fallback.
7. Increase D3 workload only within measured profiles; D1 rich geometry uses the separately qualified asset lane. Add one D6 modality only after this journey passes.

## J. Data to use, expected outcomes and verification

**Before coding:** DATA supplies chunked D0 with three chunks, one unknown CRS, leading-zero IDs, quoted multiline CSV, a cross-chunk building/parent, one malformed row and contradictory declared unit. Assert accepted IDs/values against independent expected.json. First visible output must be a selectable persisted draft, not a progress counter.

**After core integration:** use [D3 existing Delhi inputs](../GOOGLE_UTTAM_NAGAR.md) for GeoJSON/WKT/CSV and [D4 DDA inventory](https://dda.gov.in/sites/default/files/Housing_Department/list_of_flats_and_garages_dda_premium_housing_scheme_2026.pdf) for independently structured document rows. Preserve source and page metadata; DDA rows must not produce invented polygons. Use [D1 complete sample](https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.1655100000500568) for a different asset family through [provider instructions](https://docs.3dbag.nl/en/delivery/webservices/); preserve roof surfaces and null floor count. Record source version/hash and access failure fallback per 00. Different cities remain different datasets.

Tests: reused recipe needs no per-record model calls; unit metadata contradiction is needs_input; deliberately undetectable semantic change is unknown assurance, not claimed detected. Hold out whole source layouts/families for adaptation evaluation, not adjacent chunks of the same CSV. Authored perturbations are labelled authored.

Kill worker, return old attempt after retry/cancel, disconnect SSE, race state/cursor reads, replace/remove tile, expire cursor, revoke access, exhaust byte/CPU/model budget and restart the application. Assert final entity set equals fresh manifest with no duplicate/lost/resurrected objects; missing neighbour prevents completed assessment; one valid group records without publishing unresolved data. Measure first-valid-preview, total time, calls/tokens, peak memory, resident bytes and request counts; do not assert speedup without measurement.

Run `pnpm typecheck`, `pnpm test:api`, `pnpm test:studio`; `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/t076-source-normalizer.test.ts tests/usp-ingestion.test.ts tests/usp-ingestion-stream.test.ts`; `pnpm exec tsx tests/usp-ingestion-integration.ts`; `pnpm exec tsx tests/usp-draft-scene-integration.ts`; `python -m pytest services/geo/tests/test_jobs.py services/geo/tests/test_usp_ingestion.py`; `pnpm exec playwright test tests/e2e/usp-ingestion.spec.ts`. Return real receipts/manifests and V7 evidence, not timer mocks. Tests listed as new must be created first.

**Additional H20 acceptance:** simulate two worker processes contending for the same final balance, account exhaustion across several keys, terminal retirement after restart, timeout with unknown charge, policy revocation and manual-mapping recovery. Prove a qualified source family reuses its recipe without another model call. Preserve the original INGEST recovery/replay tests; budget tests do not qualify scene rendering.

## K. Copy-paste assignment

> Implement INGEST using 00, 01, this file and the FIND/UI producer-consumer contracts. On feat/usp-ingestion obtain chunked D0, then attempt D3/D4 real source families and one D1 asset separately. Complete deterministic receipt→qualified mapping→fenced chunks→durable selectable draft→review-group→existing record workflow before AI or scale. Build immutable manifests/tombstones and consistent status+cursor replay; use 01 guards and 99's one shared viewport. Preserve original bytes, source meanings, unknowns and current recorded data. FND/UI own shared hooks; no alternate queue/renderer or per-import training. Execute J real-service failure/stream/geometry tests and return pack hashes, actual assets/receipts/timings and explicit unqualified capabilities. Use the stated fallbacks, not invented values or repeated human clarification. No deployment or main merge without authorization.
