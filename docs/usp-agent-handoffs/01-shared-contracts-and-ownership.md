# Shared contracts, ownership and foundation implementation

Owner **FND**. Application baseline `f623cff897f91bb3ebd4c225f700ac263f7beb72`. Revised 22 September 2026. Read [00](00-README.md). These are adopted implementation requirements, not existing exports or passed tests. The historical audit is not required reading. Implement F0 → F1-min → the V0 slice before broad F1-feature/F2 work.

## 1. Preserve the existing authorities

Keep Next.js, PostgreSQL/PostGIS, private S3-compatible storage, the dispatcher and Python/Celery. Registry records remain recorded-property authority; cases/import packages remain draft authorities. [Saved spatial datasets](../../apps/web/lib/server/spatial-dataset-db.ts) remain immutable synthetic packages, not an alternative production register.

Reuse [core refs/values](../../packages/contracts/src/spatial/core/scalars.ts), [identity](../../packages/contracts/src/spatial/core/identity.ts), [sources](../../packages/contracts/src/spatial/core/source-schema.ts), [frames](../../packages/contracts/src/spatial/core/frame-schema.ts), [geometry](../../packages/contracts/src/spatial/core/geometry-schema.ts), [snapshots](../../packages/contracts/src/spatial/core/snapshot.ts) and the [legacy adapter](../../apps/web/features/spatial/data/core-legacy-adapter.ts). Preserve literal IDs, leading zeros, namespace, source revision, typed locator, quantity definition and source classification. `unknown`, `withheld`, `not_applicable` and `conflicting` never become zero or an empty-success result.

Official parcel ULPIN, physical building, level and independently defined space are distinct. One building can relate to several parcels; one parcel to several buildings; one space to several floors. Display mesh IDs, floor labels and source row positions are not property IDs. Retain source key → canonical ref mappings; never merge on a party name or flat label alone.

## 2. F0 schemas, scope and request/result contracts

Proposed new files: `packages/contracts/src/usp/{common,ports,index}.ts`, `apps/web/lib/server/usp/{targets,snapshots,commands,jobs,access,principal,audit,outbox,migrations,routes}.ts`, `tests/fixtures/usp-common.ts`. FND owns them. Publish strict Zod schemas, inferred TS types and serialized fixtures together; consumers import them rather than reconstructing interfaces from prose. Export only modules that exist. No future-service stubs returning empty success.

```ts
type TargetPin = CoreRevisionRef;
type IntakeScope = { kind: 'intake'; workspaceId: string; version: number };
type SnapshotScope = {
  kind: 'snapshot'; scopeId: string; world: CoreRef;
  manifestId: string; snapshotDigest: string;
  stage: 'draft' | 'recorded' | 'retained';
};
type UspScope = IntakeScope | SnapshotScope;
type Principal = {
  subject: string; roles: string[]; entitlementVersion: string;
  mode: 'local_demo' | 'india_private' | 'public_interoperability';
};
type RequestContext = {
  requestId: string; principal: Principal;
  accessViewId: string; policyVersion: string;
};
type MutationGuard =
  | { mode: 'create'; requestKey: string }
  | { mode: 'update'; requestKey: string; expectedVersion: number;
      expectedManifestId?: string };
type ServiceResult<T> =
  | { state: 'available'; data: T }
  | { state: 'pending'; jobId: string }
  | { state: 'not_assessed'; reasonCode: string }
  | { state: 'unavailable'; reasonCode: string };
```

All context/principal/access-view values are derived server-side. A caller's scope is a lookup request, not a grant. Intake supports unassigned uploads and missing-space submissions with `target:null`; never fabricate a world or digest. A spatial calculation requires SnapshotScope. A new resource uses create guard, not a fictitious revision zero; update guard uses the actual resource version. Actions dependent on property/evidence state also require `expectedManifestId` and relevant target pins. These are separate versions.

`ResolvedTarget` contains pin, SnapshotScope, backing, kind, label, identifier assertions, representation refs, evidence pointers, record state and capability results. Backing is a strict union: registry `{siteId,recordId}`, area feature `{areaId,featureId}`, retained dataset `{datasetId,objectId}`, or case draft `{caseId,candidateId}`. Validate each against its actual store. A source-only row may be a retained draft candidate with no geometry; it is not a recorded registry unit. Never create a new property master solely to satisfy a DTO.

`EvidencePointer` contains exact source revision, nullable asset/source-part revision, typed locator, purpose, direct/inherited origin and target ref. Preserve legacy locator text alongside a validated typed derivative. Verbatim/whole-source locators do not authorize arbitrary cropping. Identifier assertions retain scheme, literal value, known issuer, source and assertion/review state; absent issuer stays absent.

### Port signatures and ownership

Every method below returns a Promise; schema names in angle brackets are implemented in F0 or registered by the owning feature before consumption. Context is always the first argument.

| Port | Request → result | Owner / constraints |
| --- | --- | --- |
| `resolveTarget` | `{pin,scope:SnapshotScope}` → `ServiceResult<ResolvedTarget>` | FND; exact membership, historical revision and access, never latest fallback |
| `captureSnapshot` | `{scopeId,world,stage,selection}` → `ServiceResult<SnapshotManifest>` | FND; consistent read, section 3 |
| `readScope` | `{scope:SnapshotScope,cursor:null|string,limit:1..100}` → `{items,nextCursor,manifestId,coverage}` | FND; manifest-pinned population and current access |
| `readEvidence` | `{pointer,action:'preview'|'extract'|'original',scope}` → `ServiceResult<AuthorizedAsset>` | FND; target/source/part/asset policy; no secret object keys in HTTP output |
| `receiveUpload` | `{scope:IntakeScope,name,mediaType,expectedBytes,guard}` → `{uploadId,version}` | FND metadata/storage adapter; binary parts are separately streamed |
| `promoteUpload` | `{uploadId,hash,scanReceiptId,destinationCaseId,intentKey,guard}` → `{sourceRevision,receiptId}` | FND; same bytes/hash, idempotent linkage, no implicit association approval |
| `commitProposal` | `{kind:'registry'|'relationship',proposalId,reviewId,scope,guard}` → `CommitReceipt` | FND transaction bridge; registered feature handler only |
| `enqueueJob` | `{operation,scope,inputManifestId,payloadRef,budgetProfile,guard}` → `{jobId,version}` | FND; registered operation, authorized immutable payload |
| `readJob` | `{jobId}` → `JobProjection` | FND; stage/progress/attempt/error/result ref, not secrets |
| `controlJob` | `{jobId,action:'pause'|'resume'|'cancel'|'retry',guard}` → `JobProjection` | FND; state rules in section 5 |
| `appendOutbox` | `(tx,event)` → `{streamId,sequence}` | FND; same transaction, decimal sequence string |
| `modelGateway` | `{taskKind,evidenceRefs,input,outputSchemaId,budget,policyVersion}` → `ServiceResult<ModelResult>` | DEPLOY implements; FND wires; task-specific validators remain with INGEST/ASSIST |
| `scanAsset` | `{uploadId,assetHash}` → hash-bound scan receipt | DEPLOY; clean/rejected/quarantined/unavailable |
| `sendReceipt` | `{notificationId,deliveryKey,audience,templateId}` → accepted/rejected/unknown delivery result | DEPLOY transport; CITIZEN content/state; no exactly-once claim |

Optional `findings`, `rightsGraph`, `evidenceRequests`, `history` ports use `ServiceResult` and include `inputManifestId`, data-version pins and coverage when available. Findings/rights use their owning feature schemas, not circular imports into common.ts. FND owns registration and default `not_assessed`; each producer owns its implementation. `state:'available',data:[]` means an actually completed bounded read with no matches, not missing functionality.

HTTP success envelope: `{data,meta:{schemaVersion:'usp/1',requestId,scope}}`; scope may be intake and therefore has no snapshot digest. Pending work returns HTTP 202 with a job ref. Error envelope: `{error:{code,message,retryable,requestId,details?}}`. Use 400 malformed, 401 unauthenticated, non-enumerable 404 for inaccessible resources, 403 where safe, 409 stale/idempotency conflict, 413 resource limit, 422 unsupported semantics, 429 throttled, 503 unavailable. Do not leak source names, roles, raw provider bodies or stack traces. Permission errors are not `not_assessed` payloads that disclose hidden resources.

Idempotency ledger key is `(server subject, scope identity, operation, requestKey)`, with canonical payload hash and final receipt. Same key/same payload returns the original receipt after authorization; different payload is 409. Body actor/role is rejected. Large resource bytes are represented by verified hash, not repeated inside the command hash. For `:ref` URLs use one base64url codec for canonical UTF-8 `{namespace,id}` JSON, max 1 KiB decoded, round-trip validation. It is not a secret. Existing UUID routes stay unchanged.

## 3. Immutable snapshot membership and historical reads

Proposed `SnapshotManifest` stores schema/version, manifest ID/digest, scope/world/stage, immutable sorted target set, geometry/quantity/source-part/source-link/relationship/review pins, frame and transformation versions, relevant validity/as-of context, feature policy versions, membership definition and coverage. Include all dependencies used to compute the result, not only property revision. Source classification and registry review state stay orthogonal.

Capture membership and revision bodies/pointers under one repeatable-read transaction. If an existing table lacks immutable history, preserve the read's actual body in a private immutable snapshot blob; label it snapshot capture, not an invented historical survey. Such blobs are historical evidence, never a new mutable master. Never keep a database transaction open across model calls, parsing, asset rendering or user review.

Canonical hashing uses the established stable encoding with sorted set-like collections, unchanged ordered coordinates/locators and finite numbers. Store actual manifest bytes and hash. Derived/public projections have their own access-view and policy versions; do not publish private constituent IDs/counts by exposing a complete internal manifest.

Cursor binds manifest ID, filter hash, sort keys, last key, access-view version and expiry using server authentication. Pagination reads the frozen member set; a newer live scope does not change page two. Missing snapshot/expired cursor returns 409 `SNAPSHOT_UNAVAILABLE`/`CURSOR_EXPIRED` and an explicit restart instruction. Revoked access denies or requires an authorized fresh view, rather than serving old grants. Target/relationship/source changes invalidate dependent calculations by manifest comparison even if an event was missed.

Exact historical reads resolve pinned versions only. Current source bytes, placement or rights cannot replace missing historical parts. HISTORY and PACK may return an incomplete historical result with explicit reasons; they cannot label it complete.

## 4. Same-client commands, receipts and outbox

[commitRegistryReview](../../apps/web/lib/server/registry.ts) owns its transaction at baseline. FND extracts its body into proposed `commitRegistryReviewTx(client,id,acknowledgement)` while retaining the existing public wrapper and all locks, evidence checks, expected revisions and warning acknowledgements. Do not call the wrapper from inside an outer transaction.

The coordinated command opens one transaction, acquires existing recording lock, then site/draft/review locks in the established order; any multi-resource extension locks IDs in sorted order. It checks command guard and all dependency pins, invokes the transaction-aware handler, queries actual resulting revision pins on that client, inserts immutable `CommitReceipt`, audit and outbox, then commits. A receipt includes command key/hash, before/after pins, reviewed proposal ID, resulting manifest reference and event cursor. Do not report pre-commit review payload revisions as new record revisions.

All coordinated helpers receive the same PoolClient; no hidden pool.query/read helper may escape that transaction. An object-store write cannot join the SQL transaction: write an immutable temporary output first, verify bytes, then register it in SQL. Failure leaves a quarantined orphan eligible for delayed cleanup, not a partially published record. Never delete an object that a committed manifest references.

FND defines registered transaction handlers for compatible registry updates and RIGHTS' technically accepted assertion store. Unsupported commands return 422 without pretending registry publication occurred. FIND owns a minimal scoped-case envelope for parcel-only results, with optional link to existing building investigation; FND provides transaction/access adapters. No fabricated building ID and no second general case-management platform.

`usp_streams` allocates per-stream sequence under a row lock held through commit; `usp_outbox` stores stream, sequence, event schema/type, resource scope, manifest, correlation and minimal safe payload. For multiple streams, lock sorted stream IDs. Global sequence allocation before commit is not a replay cursor. Existing UUID activity events remain history, not ordered replay. Each consumer deduplicates `(streamId,sequence)`; ingest SSE and citizen notifications read committed events only.

## 5. Logical jobs, fencing and cancellation

Keep existing `jobs` and broker; proposed `usp_job_attempts`/operation metadata supplement rather than replace them. Register new operations with input/result schemas, deadline, resource requirements and completion handler. F0 includes exact serialized examples; unknown operation is rejected. PayloadRef points to private immutable input rather than giant queue messages.

Job projection separates queued, running, needs_input, succeeded, failed, paused and cancelled, with progress counts that may have unknown total. Attempt records contain attempt number/fencing token, owner, lease expiry, input manifest/hash and start/completion clocks. SQL is the authoritative result-acceptance gate; Redis claim/release alone is insufficient.

Claim advances the fence atomically. Heartbeat and completion require matching active fence/owner and unexpired lease; expired or cancelled work cannot apply even if a stale worker returns later. SQL result application rechecks input dependencies, logical status and current fence, stores accepted output references and event in one transaction. Duplicate accepted completion returns the same result receipt. Superseded input results may be retained as historical draft artifacts but cannot replace current output.

Pause stops new claims; an already running valid attempt may finish into a retained draft, but cannot auto-record. Cancel advances the fence and prevents any future application; originals and recorded history remain. Retry is explicit after exhausted automatic attempts and advances the fence under expected job version. Resume is for paused work, not resurrecting cancelled jobs. Default new child-task target: ≤60 seconds execution under the existing 110/120-second worker limits, 180-second lease with ≤30-second heartbeat; final values are configured together and tested. Queue wait, download, model and execution clocks are distinct. Default transient retries: three attempts with bounded exponential backoff; semantic invalidity enters needs_input without looping.

## 6. Geometry capability matrix and representation integrity

| Profile | Required behavior | Compatibility boundary |
| --- | --- | --- |
| Retained asset | Bytes/metadata/source can be inspected | No geometry or measurement claim |
| Display mesh / provider tiles | Preserve source surfaces, transforms, LoD and stable identity map | Not analytical volume/rights authority; 99 handles viewer integration |
| Analytical planar polygon | Core Polygon/MultiPolygon, holes, named metric frame | Measure only after supported topology validation; legacy simple ring is not interchangeable |
| Analytical prism | Valid polygon + exact lower/upper + vertical reference | Positive volume only for compatible reference and supported geometry |
| Multiple components | One semantic space ID referencing several exact prism representations | Do not use union footprint × total height; handle overlap once, or reject invalid internal overlap |

Existing simple-ring registry storage/query does not establish hole/compound support. First V0 records use supported simple units; courtyard/multipart/duplex cases also exercise round-trip retention and explicit unsupported results. Before analytical compound publication, FND qualifies persistence using immutable core representation references and existing identity bindings; incompatible legacy mirrors stay unavailable, not lossy. This is an extension of geometry representation, not a second set of property IDs. FIND provides qualified polygon/prism/component operations consumed by HISTORY/IMPACT. No feature independently implements substitute booleans.

Missing axis order, CRS, ground reference, vertical datum or transformation grid produces needs_input/unsupported_transform, not guessed alignment. Local-frame inspection can proceed without global placement. Datum-preserving display can be qualified separately; datum-unverified geometry cannot enter cross-source measurement. Numerical epsilon is not survey uncertainty. Generated roof/facade details, screen-space road strokes and exploded-floor offsets cannot affect source geometry, reported quantities, readiness or checks.

## 7. Access, derivatives and public release

F1-min preserves loopback/Origin guards and derives a local operator server-side. F2 is a separate gate: maintained pinned OIDC/session library, authorization code + PKCE, validated issuer/audience/signature/expiry, exact redirect allowlist, CSRF protection and Secure HttpOnly sessions. No custom password/crypto framework. Missing configuration fails closed. Test principals never become public runtime headers.

Roles: anonymous sees only released projections; contributor sees own submissions/files; scoped reviewer and recorder have separate grants; administrator has configuration rights, not automatic document access; workers receive bounded resource/action capability. Required capabilities include `property.read`, `evidence.preview`, `evidence.extract`, `evidence.original`, `proposal.create`, `proposal.review`, `record.commit`, `scope.assess`, `release.approve`, `deployment.inspect`.

**Private derivative:** each preview/generation/download is authorized against current target AND contributing source/part/asset grants, purpose and deployment policy. Revocation blocks future access.

**Separately released derivative:** `ReleaseDecision` pins exact derivative hash/asset version, source lineage, approved redaction/applicability decisions, audience, reviewer, policy version, expiry and active/revoked state. The releasing actor needs release approval plus relevant source rights. Later public viewers need the active release/audience grant, not access to private originals. No release is inferred from a summary, successful extraction or inherited public parent. Source supersession marks release for policy review but never rewrites its bytes; access/legal revocation invalidates affected releases. Check at download and cache boundaries. Bytes already received by an authorized user cannot be recalled.

Inventory all APIs, source/scene/ML routes, SSR pages and static/cache paths before F2. A guarded new API does not protect an old dossier/download route. Keep unqualified paths inaccessible externally; never remove localOnly globally. Public finder and MCP use allowlisted released projections, not sanitized full dossier objects. Include non-enumeration and revoked-grant tests.

## 8. Selection, cache and shared UI contract

UI owns restorable URL selection and presentation state. Server snapshots own facts. Proposed `SelectionContext` is a discriminated state: none, pending, valid `{generation,scope,target,buildingRef?,floorRef?,spaceRef?,evidence?}`, or invalid `{generation,reasonCode,requested}`. Every selection/scope/world/entitlement change advances generation. Explicit invalid unit/area/world/source cannot fall back to a wider building action. Retired IDs open historical context or explicit unavailable state.

Cache key: method/endpoint + scope/stage/world + exact manifest/target revision + parameters + accessViewId/entitlementVersion/policyVersion. Snapshotless intake reads use workspace/version. Abort pending old-generation reads or suppress their delivery; revoked sessions cannot repopulate caches after clearing. Asset-ready events invalidate only that asset/manifest consumer. Record/source/relationship changes invalidate dependency-matching reads; do not globally reload all dossiers for each tile. Server authorization remains mandatory.

Reuse [resource cache](../../apps/web/features/spatial/data/resource-cache.ts), [sessions](../../apps/web/features/spatial/data/session.ts), [store](../../apps/web/features/officer/shared/store.tsx), [useBlock](../../apps/web/features/officer/block/useBlock.ts) and existing viewport boundaries. One active 3D viewport per focused workspace; no feature-specific provider/Canvas/global store. Private records/tokens/packets stay out of localStorage. Filters may hide a selection with an explicit reveal/clear action; they may not substitute another property.

## 9. Ownership, migrations and implementation map

| Paths / integration seam | Sole writer |
| --- | --- |
| `packages/contracts/src/usp/{common,ports,index}.ts`, [contracts index](../../packages/contracts/src/index.ts) | FND |
| Proposed `lib/server/usp/{targets,snapshots,commands,jobs,principal,access,audit,outbox,migrations,routes}.ts` | FND |
| [db.ts](../../apps/web/lib/server/db.ts), [registry.ts](../../apps/web/lib/server/registry.ts), legacy receipt/resolver/investigation adapters | FND; preserve public wrapper semantics |
| [processing.ts](../../apps/web/lib/server/processing.ts), [dispatcher](../../scripts/dispatcher.ts), [geo API](../../services/geo/geo/api.py), [tasks](../../services/geo/geo/tasks.py), [store](../../services/geo/geo/store.py) | FND; registered feature leaf operations owned by their features |
| Proposed `app/api/v1/usp/[...path]/route.ts`, `app/mcp/route.ts`; existing API guards | FND |
| [config](../../apps/web/lib/server/config.ts), [compose](../../compose.yaml), [geo Dockerfile](../../services/geo/Dockerfile), [geo settings](../../services/geo/geo/settings.py), [legacy AI provider](../../apps/web/lib/server/officer-ai-provider.ts), package/requirements/lock files | FND applies bounded dependency/provider patches; DEPLOY owns new adapter/reference-stack files |
| [Studio route](../../apps/web/app/studio/%5B%5B...view%5D%5D/page.tsx), layouts, Shell, ProductHeader, all shared map/cache/store/parent widgets, public page mounts | UI; integrates FND-supplied SSR access patch |
| Proposed `contracts/src/usp/<feature>.ts`, `lib/server/usp/<feature>/**`, `features/usp/<feature>/**`, feature tests and migration | Named feature owner; others consume ports |
| Proposed `fixtures/usp/**`, `scripts/usp/data/**` | DATA; feature owners supply expected cases through a patch request |

Reuse the current pool/query/transaction; no second ORM/pool. Add versioned migration ledger with advisory lock through existing `pnpm db:migrate`; a failed migration is not marked applied. Feature-owned migrations are registered by FND in dependency order, not merely numeric order. Test empty DB, populated baseline, rerun and upgrade from partially enabled features. New tables store feature state, immutable manifests/receipts and bindings, not duplicate mutable property masters. Prefixes: `usp_packet_*`, `usp_readiness_*`, `usp_finding_*`, `usp_citizen_*`, `usp_ingest_*`, `usp_history_*`, `usp_rights_*`, `usp_impact_*`, `usp_assist_*`, `usp_deployment_*`. Rollback disables feature routes/workers and preserves evidence; destructive down-migrations and snapshot refresh are not recovery defaults.

## 10. Data, bounded steps and acceptance

Use D0 and D1 from [00](00-README.md). F0 fixture examples must cover an unassigned intake, valid snapshot, invalid cross-building unit, same ID text in different namespaces, unknown quantity, unavailable provider, pending job, stale update and released derivative from a restricted source. DATA owns acquisition; FND supplies manifest schema and source-ref mapping. No local PC acquisition is assumed to exist.

1. Freeze only the interfaces V0 needs, plus tagged unavailable outcomes for future ports. Add proposed `tests/usp-contract-producers.test.ts` importing actual producer/consumer schemas.
2. Implement F1-min exact D0 reads and snapshot capture. Two consumers must resolve the same target/source pins. Add `tests/usp-snapshot-consistency.test.ts` for concurrent membership/source/relationship changes and page-two stability.
3. Extract same-client commit helper; inject failure before/after receipt/outbox insertion. Add `tests/usp-command-atomicity-integration.ts`; assert all effects or none and post-write revision pins.
4. Fence worker results, cancel/retry and expired attempts through real SQL/Redis. Add `tests/usp-job-fencing-integration.ts`; a late old result must never publish.
5. Connect V0 with UI/PACK; no general public auth platform prerequisite. Add migration rerun/access/invalid-selection tests.
6. Extend per-feature adapters only for active consumers; F2 and environment qualification remain separate.

Run `pnpm typecheck`, `pnpm test:api`, `pnpm test:registry`, `pnpm test:register-scope`, relevant core tests and proposed tests using the runners in 00. Include malicious principal headers, permission revocation during pending reads, approved public derivative without source access, revoked release, object-store/SQL failure, rollback, cursor expiry and nested-transaction regression. Protocol schemas passing closes F0 only; F1 needs real services and V0 needs actual browser/evidence output.

## 11. Copy-paste FND assignment

> Read 00, this file, root/web AGENTS and the linked baseline services; check actual branch drift. Implement F0 then F1-min on an isolated feat/usp-foundation branch, using D0 and one D1 frame example. Own only FND paths. Publish strict shared schemas/serialized fixtures, exact intake/snapshot and target/evidence adapters, same-client command/receipt/outbox helpers, fenced logical jobs, permission/release rules and additive migrations. Preserve original IDs, bytes, local restrictions and existing public wrappers. UI owns frontend/SSR mounts; DATA owns pack files; send them concrete patches instead of creating duplicate mechanisms. Complete and test the live V0 seam before extending F1-feature or F2. Execute section 10 negative/integration tests and return actual commits, schemas, pack hashes, receipts, rollback/replay evidence and remaining capability gates. Do not ask humans to invent technical defaults, claim mocks prove integration, activate public services or merge main without authorization.
