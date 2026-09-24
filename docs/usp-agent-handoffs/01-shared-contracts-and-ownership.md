# Shared contracts, ownership and foundation implementation

**Current continuation note, 23 September 2026:** [02 - implementation lead, role tiers and worker delegation](02-lead-agent-execution.md) governs development workers. [20 - Sarvam gateway, credit pools and permanent credential retirement](20-model-gateway-and-budget-pools.md) specifies DEPLOY-owned runtime inference, money reservations, shared organisation wallets and one-way key retirement. Current [ports](../../packages/contracts/src/usp/ports.ts), [domain types](../../packages/contracts/src/usp/domain.ts) and [FND interfaces](../evidence/usp/fnd/INTERFACES.md) have advanced beyond the historical F0a note below. Their existence does not qualify the provider gateway; inspect actual bindings/tests rather than recreate these modules.

Owner **FND**. Historical application baseline `f623cff897f91bb3ebd4c225f700ac263f7beb72`; plan revised 24 September 2026. Read [00](00-README.md), the [finale release/data/test authority](28-data-acquisition-and-finale-tests.md), and [proposed identifier/exchange profile](26-identifiers-and-standard-exchange.md). For `finale_v1`, implement GF0 data/contracts → GF1 identity/exchange → GF2 qualified domain AI/spaces/geometry → GF3 checks/impact → GF4 card/QR → GF5 evidence/rehearsal. F0/F1-min/V0 below name earlier foundation checkpoints, not a new prerequisite ordering that restarts accepted work. Full-product learner, public dashboard, MCP, enrichment and scale remain planned without blocking the finale lane.

Current planning base is integrated `staging@45d033baae7ec4e5a572d82459b0062c70a12c95` (24 September 2026). The continuation branch and PR #13 below are historical integration context. Verify the head before implementation and assess accepted coverage against [actual D0 evidence](../evidence/usp/fnd/d0/README.md); do not recreate it because a historical step says to.

## Historical F0a checkpoint — reconcile with current implementation

On `feat/usp-foundation-f0`, code commit `1894f2e94e3f4f113fb4431afaf69018dcb730c3` implements [common schemas](../../packages/contracts/src/usp/common.ts), the [reference codec](../../packages/contracts/src/usp/reference-codec.ts), [data-pack schema](../../packages/contracts/src/usp/data-pack.ts), opt-in [module entry](../../packages/contracts/src/usp/index.ts), [serialized fixture producer](../../tests/fixtures/usp-common.ts), [contract tests](../../tests/usp-foundation.test.ts), [data tests](../../tests/usp-data-pack.test.ts) and the offline [pack-byte verifier](../../scripts/usp/data/verify-pack.ts). Reuse these; do not generate competing versions from the prose below. Root package exports are unchanged; import the opt-in USP module explicitly until FND deliberately exposes it through the root.

**Verified:** [run 35796807605](https://github.com/Vinayak1337/3d-ulpin/actions/runs/35796807605) passed 64 new tests, explicit starter TypeScript checking, application typecheck, byte verification and 370 existing Studio/core/scope/Uttam/repository-mode tests. This is schema/fixture verification, not a real service producer/consumer, DB, browser or rendering pass.

**Remaining at the original F0a checkpoint, not a current code inventory:** resolved-target/authorized-asset result contracts, full constituent SnapshotManifest and command/job/receipt/release DTOs, the typed ports module and actual registered producer bindings; then exact target/evidence/membership/access reads, transactions, storage, migration and worker integration. No new endpoint, DB table, model provider, scanner, authentication system or live outbox was installed by F0a. Do not advertise a port merely because its request schema exists. The `contract-smoke` fixture was not the complete D0 neighbourhood. Current D0/D1 preparation and qualification are recorded separately; reuse those receipts and assess remaining D4/data work through H28.

**Concrete wire decisions:** `EvidencePointer` uses `sourceRevision`, nullable `assetRevision`, nullable `partRevision`, `locator`, `purpose`, `origin`, `target`, and optional `legacyLocator`. Reuse core source namespaces, purpose enums and literal IDs. `TargetPin` retains the existing core's legitimate revision-zero draft support; newly versioned resources and update guards require positive versions. `parseUsp` performs the bounded plain-JSON check before schema parsing. Data/scene/input manifest IDs have distinct TypeScript brands, not a new runtime ID format. Brands/DTO validation do not prove identity membership, authorization, source applicability or current revisions: the F1 adapters must perform those checks.

FND held the bounded DATA role only for `fixtures/usp/D0/contract-smoke` and the verifier. The next designated FND owner may continue these shared contracts; DATA owns further packs. There is no parallel hidden writer. Remaining requirements below are unchanged design obligations unless explicitly listed as implemented above.

## 1. Existing authorities and invariants

Keep Next.js, PostgreSQL/PostGIS, private S3-compatible storage, dispatcher and Python/Celery. Registry remains recorded-property authority; cases/import packages remain draft authorities. [Saved spatial datasets](../../apps/web/lib/server/spatial-dataset-db.ts) retain immutable synthetic/revision-one constraints. No second property master, queue or ORM.

Reuse [core refs/values](../../packages/contracts/src/spatial/core/scalars.ts), [identity](../../packages/contracts/src/spatial/core/identity.ts), [sources](../../packages/contracts/src/spatial/core/source-schema.ts), [frames](../../packages/contracts/src/spatial/core/frame-schema.ts), [geometry](../../packages/contracts/src/spatial/core/geometry-schema.ts), [snapshots](../../packages/contracts/src/spatial/core/snapshot.ts) and [legacy adapter](../../apps/web/features/spatial/data/core-legacy-adapter.ts). Preserve literal IDs/leading zeros, source versions, locators, units/quantity definitions and classification. Unknown, withheld, not_applicable and conflicting never become zero/empty success.

Official parcel ULPIN, physical building, level and independent space differ. One building may span parcels; one parcel may contain buildings; one space may occupy floors. Mesh ID, floor label, party name and row position are not property identity. Preserve namespace/source-key→canonical mappings and ambiguity. Do not allocate official identifiers or merge records merely to satisfy a DTO.

GF1 adds the reviewed `P3/1` project-code allocation and lifecycle in [26](26-identifiers-and-standard-exchange.md). Keep the immutable registry UUID, proposed code and sourced optional official parcel assertions in distinct fields. The code is opaque and immutable; human labels, parcel associations and component levels are revisioned. No official anchor is a valid partial state, not a fabricated parent ULPIN. The check pair detects input errors but does not certify title or issuance. Only same-client reviewed commands assign, cancel or retire a code or atomically record split/merge successors. Historical aliases resolve to their retained status and cannot be used as current facts.

## 2. F0 common types and explicit service contracts

FND destinations: `packages/contracts/src/usp/{common,ports,index}.ts`; `apps/web/lib/server/usp/{targets,snapshots,commands,jobs,uploads,access,principal,audit,outbox,migrations,routes}.ts`; `tests/fixtures/usp-common.ts`. See the implementation note for the subset now present. Publish strict Zod schemas, inferred TS types and serialized producer/consumer fixtures together. Export only implemented modules; unavailable adapters return explicit states, not fake successful data.

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
  requestId: string; principal: Principal; accessViewId: string; policyVersion: string;
};
type MutationGuard =
  | { mode: 'create'; requestKey: string }
  | { mode: 'update'; requestKey: string; expectedVersion: number; expectedManifestId?: string };
type ServiceResult<T> =
  | { state: 'available'; data: T }
  | { state: 'pending'; jobId: string }
  | { state: 'not_assessed'; reasonCode: string }
  | { state: 'unavailable'; reasonCode: string };
type AssetRef = { assetId: string; version: number; sha256: string };
type ProposalSelection =
  | { target: TargetPin; targets?: never }
  | { targets: TargetPin[]; target?: never };
```

All principal/access context is server-derived. Caller scope is a request, not a grant. Intake permits target:null for unassigned sources/submissions; no fake world/digest. Spatial calculations require SnapshotScope. Creation uses a create guard, not fabricated revision zero. Updates require actual resource version; property-dependent actions additionally require current data manifest and target pins. Intake job inputManifestId refers to an immutable upload/input manifest, not an invented spatial snapshot.

`ResolvedTarget` contains exact pin/scope, backing, kind, label, identifier assertions, representation refs, evidence pointers, record state and capabilities. Backing union: registry `{siteId,recordId}`, area_feature `{areaId,featureId}`, retained_dataset `{datasetId,objectId}`, case_draft `{caseId,candidateId}`. Validate against the actual authority. Source-only rows may be retained draft candidates without geometry, not recorded registry units.

`EvidencePointer` pins source revision, nullable asset/source-part revision, typed locator, purpose, direct/inherited origin and target. Keep original legacy locator text alongside any validated typed derivative. Whole-source/verbatim locators do not authorize arbitrary extracts. Identifier assertions retain scheme, literal value, known issuer, source and review/assertion state.

**Schema ownership:** FND owns common opaque AssetRef and SnapshotScope; INGEST owns its scene AssetDescriptor/DraftSceneManifest; UI owns the renderer adapter, not a competing manifest schema. A render-manifest ID and its underlying data SnapshotScope.manifestId are distinct. Use namespaced/branded ID types in implementation to prevent accidental interchange. Hash canonical manifest content excluding its own ID/digest fields; do not create self-referential hashes.

| Port (context first, Promise result) | Request → result | Sole implementation/wiring rule |
| --- | --- | --- |
| resolveTarget | `{pin,scope:SnapshotScope}` → ServiceResult<ResolvedTarget> | FND exact membership/revision/access, no latest fallback |
| captureSnapshot | `{scopeId,world,stage,selection}` → ServiceResult<SnapshotManifest> | FND consistent membership/constituents |
| readScope | `{scope,cursor,limit:1..100}` → `{items,nextCursor,manifestId,coverage}` | FND frozen population and current access |
| readEvidence | `{pointer,action:'preview'|'extract'|'original',scope}` → ServiceResult<AuthorizedAsset> | FND target AND source/part/asset checks |
| receiveUpload | `{scope:IntakeScope,name,mediaType,expectedBytes,guard}` → `{uploadId,version}` | FND durable receipt before bytes/extraction |
| writeUploadPart / finalizeUpload | `{uploadId,partNumber,partHash,bytes,guard}` / `{uploadId,parts,wholeHash,guard}` → receipt | FND shared bounded primitives; INGEST/CITIZEN expose their leaf routes |
| readUpload | `{uploadId,action:'status'|'safe_preview'|'download'}` → authorized projection/asset | FND ownership/policy; unsafe/quarantined originals never served inline; safe preview only after qualification |
| promoteUpload | `{uploadId,hash,scanReceiptId,destinationCaseId,intentKey,guard}` → `{sourceRevision,receiptId}` | FND same bytes, intent-idempotent linkage; no association approval |
| prepareProposal | `{kind:'registry'|'relationship',scope:SnapshotScope,changes,evidence,guard} & ProposalSelection` → `{proposalId,version,state:'draft'}` | FND registered draft-preparation bridge; same-client helper for coordinated acceptance |
| commitProposal | `{kind,proposalId,reviewId,scope,guard}` → CommitReceipt | FND reviewed same-client command, never automatic from upload |
| enqueueJob | `{operation,scope,inputManifestId,payloadRef,budgetProfile,guard}` → `{jobId,version}` | FND registered immutable input and operation |
| readJob / controlJob | `{jobId}` / `{jobId,action:'pause'|'resume'|'cancel'|'retry',guard}` → JobProjection | FND logical state/fencing |
| appendOutbox | `(tx,event)` → `{streamId,sequence}` | FND same transaction, decimal sequence |
| modelGateway | `{taskKind,evidenceRefs,input,outputSchemaId,budget,policyVersion}` → ServiceResult<ModelResult> | DEPLOY adapter; FND port/wiring; consumer semantic validation |
| scanAsset | `{uploadId,assetHash}` → hash-bound scan receipt | DEPLOY clean/rejected/quarantined/unavailable |
| sendReceipt | `{notificationId,deliveryKey,audience,templateId}` → accepted/rejected/unknown | DEPLOY transport; CITIZEN content/reconciliation |

ProposalSelection requires exactly one target or nonempty bounded targets (initial max 100); reject duplicates/mixed scopes. CITIZEN uses target; INGEST coherent groups use targets. An unresolved intake cannot prepare a spatial proposal. `changes` is a strict kind-discriminated command schema published by FND, not arbitrary JSON patch to database rows. Reuse existing validated draft inputs; unsupported geometry/relationship operations return 422. A new unidentified space remains a missing-space proposal until the qualified identity-allocation workflow exists; do not invent a target pin.

FND's public preparation wrapper opens a transaction; its `prepareProposalTx(client,ctx,command)` helper lets CITIZEN acceptance or INGEST group linkage occur on the same client with draft receipt/outbox. Do not call an independently committing wrapper inside another transaction. The analogous reviewed commit is defined in section 4. A draft receipt is never a recorded receipt.

Optional findings/rightsGraph/evidenceRequests/history ports use ServiceResult plus inputManifestId, version pins and coverage. Feature producers own detail schemas; FND registers them without circular imports into common.ts. An empty available list means an actual bounded completed read. Missing producer means not_assessed. Model, scanner and mail clients are DEPLOY-owned, not reimplemented per consumer.

HTTP success: `{data,meta:{schemaVersion:'usp/1',requestId,scope}}`; intake legitimately has no snapshotDigest. Pending →202/job ref. Errors: `{error:{code,message,retryable,requestId,details?}}`, with 400 malformed,401 unauthenticated, non-enumerable404 for inaccessible resources,403 where safe,409 stale/idempotency conflict,413 limit,422 unsupported semantics,429 throttled,503 unavailable. No raw provider body/private filename/stack trace in errors. Permission denial must not leak hidden records via a not_assessed payload. F0a provides the safe error shape without `details`; add only an explicitly typed, non-disclosing detail schema with the actual route, never arbitrary debug JSON.

Idempotency key is `(subject,scope identity,operation,requestKey)` with canonical payload hash and durable receipt. Same payload returns original receipt after current authorization; changed payload is409. Hash verified binary content hashes instead of copying entire files into commands. Body actor/role is rejected. Route ref codec: base64url canonical UTF-8 `{namespace,id}` JSON, max1 KiB decoded, strict round-trip validation; not a bearer secret. Preserve existing UUID routes.

### Runtime model adapter integration (H20)

Reuse and evolve the actual `UspModelGatewayRequestSchema`/result and `UspPorts.modelGateway`, not another client. FND owns compatible task/receipt/async-job envelopes, deployment permissions and additive migration registration; DEPLOY owns price versions, organisation pools, per-key attribution, atomic reservations, usage reconciliation, shared throttles and retirement tombstones described in H20. INGEST/ASSIST pass exact authorised inputs, not keys, model URLs or caller-supplied balances. Snapshot/input/scene and provider-job identities remain distinct. Billing settlement occurs even when stale output cannot be applied; missing ledger/retirement state fails closed for new paid calls. No SQL transaction spans a provider call. Test two keys sharing one wallet, simultaneous reservations, unknown outcomes, restore/re-enrolment and permission-safe settings before live qualification.

## 3. Immutable snapshots and historical reads

SnapshotManifest pins immutable sorted membership, target/geometry/quantity/source/source-part/link/relationship/review versions, frames/transforms, scope/world/stage, policies, validity/as-of context, selection definition and coverage. Property revision alone is insufficient. Source classification and recording state are independent.

Capture members and their exact bodies/pointers under one repeatable-read transaction. Where baseline history is absent, retain the actual captured body in a private immutable snapshot blob; do not invent backdated history or create a new mutable master. Bound capture using the selected feature profile. Do not hold a transaction across parsing/model/rendering/user review. Store actual manifest bytes/hash with deterministic ordering of set-like collections; preserve ordered coordinates/locators unchanged.

Cursor authenticates manifest, filters/sort, last key, access-view version and expiry. Page two reads the same frozen membership, not newer live records. Missing manifest/expired cursor returns409 with explicit refresh; revoked access denies or requires a fresh authorized projection. Public manifests are separately scoped projections, not private member IDs/counts. Current state changes invalidate dependent results by full manifest comparison even if an event was missed.

Exact historical reads never substitute current source bytes, transforms or rights. Missing constituent is unavailable_revision; PACK/HISTORY can present an explicitly incomplete result, never complete-looking reconstructed history. Immutable scene/assets referenced by history are retained independently of event replay/cache expiry.

## 4. Same-client commands, receipts and outbox

Baseline [commitRegistryReview](../../apps/web/lib/server/registry.ts) opens its own transaction. FND extracts `commitRegistryReviewTx(client,id,acknowledgement)` retaining the current wrapper, locks, evidence checks, warning acknowledgements and expected revisions. Preserve compatible old callers and tests.

Coordinated command: one transaction → existing recording lock → site/draft/review locks in established order, sorted IDs for multiple resources → validate guard and full dependencies → registered transaction helper → query actual post-write pins → insert immutable CommitReceipt/audit/outbox → commit. All helpers use the same PoolClient; no hidden pool reads escape. Receipt pins command/hash, proposal/review, before/after revisions, resulting snapshot and event cursor. Pre-commit payload revisions are not new revisions.

Object storage is outside SQL: write/verify immutable provisional bytes first, then register accepted refs in SQL. Failed transaction leaves an unreferenced private orphan for delayed cleanup, never a partial published record. Do not delete an object referenced by any committed manifest. Upload/source promotion is intent-idempotent; identical bytes across users/intents do not merge ownership or permissions.

Registered handlers cover compatible registry proposals and RIGHTS' technical assertion acceptance. Unsupported operations fail explicitly. FIND owns its minimal participant-scoped case with optional legacy building-investigation link; no fabricated building for parcel-only results and no duplicate general case platform.

At GF1, FND also registers `assignProjectCode`, `cancelProjectCode`, `retireProjectSpace` and reviewed split/merge handlers from H26. They use the existing mutation guard, registry lock order, canonical payload hash, namespace uniqueness and same-client receipt/outbox. A code row without its receipt, or lineage without retired/assigned post-state, is an invalid partial write. The resolver reads exact status and current authorization; a code or QR cannot bypass an H01 release decision. HISTORY owns lineage projection, not identity allocation.

Outbox uses per-stream row-locked sequence held until commit; lock multiple streams in sorted order. Store minimal event schema/type, scope, manifest, correlation and decimal sequence. A global sequence allocated before commit or legacy UUID activity ID is not an ordered replay cursor. Consumers deduplicate `(streamId,sequence)`. State+manifest+initial replay cursor are read in one repeatable-read transaction; INGEST owns delivery, CITIZEN notification consumption.

## 5. Logical jobs and fenced recovery

Keep existing jobs/broker; add operation metadata and `usp_job_attempts`, not another queue. Register input/result schemas, deadlines, resource needs and completion handlers. Large inputs use private immutable payloadRef. Unknown operation rejects. JobProjection separates queued/running/needs_input/succeeded/failed/paused/cancelled with nullable total/progress, input pins, attempt metadata and safe error/result refs.

Claim atomically advances fence and binds owner/lease/input hash. Heartbeat and completion require current active fence/owner and unexpired lease. SQL result acceptance is authoritative; Redis claim/release alone is not enough. Recheck logical status/dependencies/fence, register output and append event in one transaction. Duplicate accepted completion returns its receipt. Stale/superseded output may be retained as history but never replace current results.

Pause stops new claims; valid running work may finish as a retained draft but not auto-record. Cancel advances fence and prevents later application while retaining originals/history. Retry after exhausted attempts is an explicit expected-version command with new fence. Resume does not resurrect cancelled jobs. Default child execution≤60sec under existing110/120sec worker caps;180sec lease and≤30sec heartbeat, configured/tested together. Queue wait, download, model and execution clocks are separate. Default transient retry ceiling three attempts with bounded backoff; semantic failures require input, not endless repair.

## 6. Geometry and display capability boundaries

| Profile | Accepted behavior |
| --- | --- |
| Retained asset | Original bytes/metadata only; no implied geometry |
| External display mesh/tiles | Source surfaces/transforms/LoD/identity preserved by UI adapter; not analytical volume/rights |
| Planar Polygon/MultiPolygon | Holes and named metric frame; measure after qualified topology |
| Prism | Qualified polygon + lower/upper + exact vertical reference |
| Compound space | One semantic ID references multiple exact components; never union footprint × full height |

Current simple-ring registry storage does not prove holes/compound persistence. V0 uses supported clean simple units; richer test cases must round-trip losslessly or return explicit unsupported analytical state. FND's qualified representation-reference bridge preserves existing property IDs, with incompatible legacy mirrors unavailable rather than lossy. FIND owns the shared planar/prism/slab operations used by IMPACT/HISTORY. No substitute per-feature boolean engine.

Missing CRS/axes/units/ground reference/vertical datum/grid → needs_input/unsupported_transform. Local-frame inspection can precede global placement. A display-only alignment is not a surveyed measurement transform. Numerical epsilon is not survey uncertainty. Ornament, screen-space road strokes and exploded-floor offsets cannot alter geometry quantities/evidence/readiness/checks.

## 7. Access and explicit derivative release

F1-min preserves loopback/Origin restrictions with a server-derived local operator. F2 separately uses maintained pinned OIDC/session implementation, authorization code+PKCE, validated issuer/audience/signature/expiry, exact redirects, CSRF protection and Secure HttpOnly sessions. No custom password/crypto. Missing config fails closed; fixture identities do not become publicly trusted headers.

Anonymous: released projections only. Contributor: own submissions/files. Reviewer/recorder: separately scoped grants. Administrator: configuration, not automatic source rights. Worker: bounded resource/action. Capabilities include property.read, evidence.preview/extract/original, proposal.create/review, record.commit, scope.assess, release.approve, deployment.inspect.

Private derivatives require current target AND contributing source/part/asset grants plus purpose/policy at preview/execution/download. Separately released derivatives use ReleaseDecision pinning exact output AssetRef/hash, source lineage, reviewed redaction/applicability, audience, reviewer, policy, expiry and active/revoked state. Releasing actor needs relevant source rights and release.approve; a later public viewer needs only the active approved release/audience, not private original access. An AI summary or public parent does not declassify data. Source supersession flags review without rewriting bytes; access/legal revocation invalidates affected releases. Recheck service/cache downloads; already delivered bytes cannot be recalled.

Inventory main/specialized API, ML/scene/source assets, SSR pages and static files before F2. Guarding the new route does not protect old downloads. Keep unqualified routes externally inaccessible, preserve trusted-proxy boundary and never remove localOnly globally. Public search/MCP uses explicit released projections, not a full dossier with a few fields removed.

## 8. Selection, caches and UI boundary

UI owns URL/transient state; server snapshots own facts. SelectionContext: none/pending/valid/invalid, each with generation; valid carries scope,target, optional building/floor/space refs and evidence. Invalid carries requested context and safe reason. Every selection/world/stage/entitlement change advances generation. Supplied invalid unit/area/source cannot silently broaden an action; retired IDs show explicit historic/unavailable context.

Cache key includes method/path, scope/stage/world, manifest/target pin, parameters, accessView/entitlement/policy. Intake reads use workspace/version. Abort or suppress old-generation responses; revoked pending reads cannot repopulate cleared caches. Asset events invalidate targeted consumers, not every dossier. Source/relationship/record changes invalidate dependency-matching manifests. Hidden selection stays explicit with reveal/clear action. Never store private records/tokens/packets in localStorage.

Reuse [resource cache](../../apps/web/features/spatial/data/resource-cache.ts), [sessions](../../apps/web/features/spatial/data/session.ts), [store](../../apps/web/features/officer/shared/store.tsx), [useBlock](../../apps/web/features/officer/block/useBlock.ts) and existing viewport. One active3D viewport/focused workspace; no feature-owned global provider/Canvas. UI owns renderer/slots and query translation; features supply typed callbacks/results.

## 9. Sole ownership and migrations

| Paths / seam | Sole writer |
| --- | --- |
| Proposed common/ports/index schemas and [contracts exports](../../packages/contracts/src/index.ts) | FND; feature detail schemas owned by producer |
| Proposed server USP shared helpers listed in section2; [db](../../apps/web/lib/server/db.ts), [registry](../../apps/web/lib/server/registry.ts), legacy receipt/resolver/investigation adapters | FND |
| [Processing](../../apps/web/lib/server/processing.ts), [dispatcher](../../scripts/dispatcher.ts), [geo API](../../services/geo/geo/api.py), [tasks](../../services/geo/geo/tasks.py), [JobStore](../../services/geo/geo/store.py) | FND; registered leaf tasks remain feature-owned |
| Proposed `app/api/v1/usp/[...path]/route.ts`, `app/mcp/route.ts`, existing API guards | FND |
| Existing config/compose/Dockerfiles/geo settings/legacy provider/package/requirements/locks; proposed `infra/deployment/Dockerfile.web` | FND applies bounded patches; DEPLOY owns new policy/provider/standalone reference files |
| Studio routes/layout/Shell/ProductHeader/map/cache/store/parent widgets and public page mounts | UI; integrates FND SSR wrapper |
| Proposed `contracts/src/usp/<feature>.ts`, `lib/server/usp/<feature>/**`, `features/usp/<feature>/**`, leaf tests/migration | Named feature owner |
| Proposed `fixtures/usp/**`, `scripts/usp/data/**` | DATA; FND data-pack schema, feature owners submit expected cases |

Reuse one pool and existing `pnpm db:migrate`; add named migration ledger/advisory-lock protection. Failed migration not applied. FND registers feature-owned migrations in dependency order, not just file numbering. Prefixes: usp_packet,usp_readiness,usp_finding,usp_citizen,usp_ingest,usp_history,usp_rights,usp_impact,usp_assist,usp_deployment. Stores contain feature state, exact manifests/receipts/bindings, not duplicate mutable property truth. Test clean, populated baseline, rerun and partial feature upgrade. Recovery disables feature routes/workers and preserves originals; no destructive down-migration or snapshot refresh default. Shared patches follow 00 and explicit role transfer, not concurrent silent edits.

## 10. Datasets, ordered implementation and acceptance

**Dataset policy, 24 September 2026:** follow [H28](28-data-acquisition-and-finale-tests.md) for the matched finale bundle (any permitted geography, labelled), exact source status, independent oracles, permitted fallbacks and aggregate load ladder. FND must not encode a required locality or provider in shared contracts. Larger corpora require tested partitioned storage/manifests, paging, identity and recovery within existing per-operation limits; no admission-limit increase or runtime schema migration is authorized by a new source upload. Existing D0/D1 and historical regression receipts below remain unchanged.

Use DATA's D0 and one D1 reference/geometry example as historical foundation fixtures; use H28's qualified matched bundle for GF0–GF5. FND's `usp-data-pack/1` starter now lives in `data-pack.ts`; DATA prepares the remaining full packs. The small [contract-smoke manifest](../../fixtures/usp/D0/contract-smoke/manifest.json) is not a full D0 scene. No existing PC path or unacquired archive is presumed available. Manifest stage assertions are supplied metadata, not independently verified results; the verifier only checks declared local bytes and never promotes parsing/rendering/workflow states.

1. F0 fixtures must cover unassigned intake, valid/historical snapshot, invalid cross-building unit, distinct namespaces, unknown quantity, pending job, unavailable producer, create/update guards, one-target/multi-target proposal and released derivative from restricted source. Producers and consumers parse the same bytes. Proposed `tests/usp-contract-producers.test.ts`. F0a's wire round trips do not replace these remaining domain producer/consumer tests.
2. F1-min exact D0 live reads/snapshot capture; source/relationship/membership changes and page-two stability in `tests/usp-snapshot-consistency.test.ts`.
3. Same-client prepare/commit: inject failures before/after draft, record, receipt and outbox; assert all or none and actual post-write pins in `tests/usp-command-atomicity-integration.ts`.
4. Real SQL/Redis fencing/cancel/retry/expired old completion in `tests/usp-job-fencing-integration.ts`; no duplicated accepted output.
5. Connect V0 with UI/PACK; test migration reruns, source authorization, invalid selection and deterministic local no-AI behavior.
6. Extend only needed F1-feature adapters; F2/environment claims remain separately qualified.

GF1 acceptance additionally requires **GF-T15** from H26: independent checksum vectors, concurrent idempotent assignment, missing/partial/multiple official anchors, correction/cancellation/retirement, atomic split/merge and status-aware resolver behavior. Test the CityJSON plus bound sidecar round trip and report exact/lost fields. GF-T16 through GF-T21 and release dependencies are centrally traced in H28; these names do not refer to the historical engineering backlog T tasks.

Run `pnpm typecheck`, `pnpm test:api`, `pnpm test:registry`, `pnpm test:register-scope`, applicable core tests and proposed tests with the actual project runners after test creation; H28 defines the required evidence. Include forged principal/scope headers, revoked permission during pending reads, public released asset without original grant, release revocation, storage/SQL failure, old cursor and nested transaction regression. Report actual pack/source hashes, requests/DB receipts and unqualified capabilities. F0 types passing does not pass live F1 or browser V0.

Repeat the implemented starter with `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-foundation.test.ts tests/usp-data-pack.test.ts`, `pnpm exec tsx scripts/usp/data/verify-pack.ts fixtures/usp/D0/contract-smoke/manifest.json`, and `pnpm typecheck`. These local checks perform no DB reset, deployment, model call or automatic merge.

## 11. Copy-paste FND assignment

> Read 00, H26, H28, this handoff including its historical F0a state, root/web AGENTS and actual services; check branch drift. Reuse accepted FND ports and D0 receipts. For `finale_v1`, complete only remaining GF0 contract/data seams, then own GF1's reviewed proposed-code commands, exact resolver, atomic lineage transaction and CityJSON/sidecar registry adapter. Preserve separate UUID, sourced official assertions and missing-anchor state; do not derive a legal parent from overlap. Keep source IDs/bytes, current wrappers, job fences, access/release and local restrictions. HISTORY owns lineage reads, RIGHTS owns declaration assertions, UI owns frontend/SSR mounts, DATA owns independent fixtures and feature owners own leaves; transfer shared contracts explicitly. Run section 10's relevant regression tests plus GF-T15 and round-trip/rollback/concurrency tests. Return source/manifest hashes, code vectors, actual receipts, loss report and unqualified capabilities. Do not treat contract-smoke as a full scene, claim mocks prove integration, activate public services or merge main without authorization.

## Z. Hardening addendum (H97)

Added 24 September 2026 by the cross-family review in [H97](97-review-findings-and-alignment.md). Where this section conflicts with text above in this file, this section wins. Task cards: [H29](29-agent-task-cards.md) FND-01 to FND-05.

### Z1. Contract additions FND owns

- `prepareProposal` kind adds `declaration` (H16 declarations, entries, amendments). SnapshotManifest pins add declaration, entry and applicability revisions, so historical cards keep the then-current declaration.
- Geometry and display assets carry `representation`, `geometryClass`, `analyticEligible` and `semanticLod` ([H22](22-rendering-and-sparse-data.md) Z1). Display derivatives use a separate store readable only by the display compiler.
- Registry reads expose the derived, display-only `verticalLocator` ([H26](26-identifiers-and-standard-exchange.md) Z1).
- One shared redaction module (Aadhaar with Verhoeff check, PAN, Indian mobile, EXIF strip) used by INGEST, PACK, ASSIST and CITIZEN ([H14](14-adaptive-ingestion-and-progressive-review.md) Z2).
- Model gateway in the finale is the `R-MODEL-CORE` subset in [H20](20-model-gateway-and-budget-pools.md) Z1. The "two keys sharing one wallet … restore/re-enrolment" qualification in section 2 applies before FP-DEPLOY live multi-pool qualification, not before GF2.

### Z2. Legacy ID legend

| Old term | Status now |
| --- | --- |
| F0, F1-min, V0 | Done at the recorded baseline; not restarted |
| F2 | Now FP-DEPLOY (protected multiuser) |
| PACK0 / PACK1 | Text/CSV packet (done) / PDF packet (GF4) |
| IMPACT0 | Existing screening path promoted in GF3 |
| D0–D7 | Data packs in H28 |
| ER-xx, F01–F14 | Audit findings in H98 |
| C01–C52 | Cross-family review findings in H97 |
| T015–T021 (engineering plan) | Historical tasks; unrelated to GF-T15–GF-T21 |
| G-01–G-27 | H20 gateway tests (finale subset listed in H20 Z1) |

Worker limits restated in gate terms: during GF0–GF1, at most two implementation owners plus one DATA/review task; from GF2, at most three unfinished integration-dependent streams.

### Z3. Section 10 status

Before GF0 exits, mark each of items 1–6 in section 10 as `done@<sha>` or `remaining` with a receipt link (GF0 checklist row 2 in [H28](28-data-acquisition-and-finale-tests.md) Z1).
