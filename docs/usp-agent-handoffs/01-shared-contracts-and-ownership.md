# Shared contracts, ownership and foundation implementation

**Owner:** FND. **Baseline:** `main@f623cff897f91bb3ebd4c225f700ac263f7beb72`. This is an implementation handoff for prerequisite work, not a statement that the proposed contracts already exist. Read [the execution index](00-README.md).

## 1. Architecture decision: extend, do not replace

Retain Next.js, PostgreSQL/PostGIS, private object storage, the current dispatcher and private Python/Celery workers. Keep the existing registry as its record authority and existing import/case workflows as draft authorities. Add feature-specific tables for findings, requests, packet jobs and ingestion progress; do not duplicate property geometry or rights into a new master database.

The baseline has two materially different paths: registry/area records with mutable drafts and recorded revisions, and retained synthetic spatial packages. [spatial-dataset-db.ts](../../apps/web/lib/server/spatial-dataset-db.ts) enforces `classification='synthetic'` and `revision=1`. A saved package is not a recorded registry site. Adapt each explicitly; never remove those constraints merely to make a new feature appear to work.

Canonical core concepts already exist in [scalars](../../packages/contracts/src/spatial/core/scalars.ts), [identity](../../packages/contracts/src/spatial/core/identity.ts), [source catalog](../../packages/contracts/src/spatial/core/source-schema.ts), [geometry](../../packages/contracts/src/spatial/core/geometry-schema.ts) and [snapshots](../../packages/contracts/src/spatial/core/snapshot.ts). Reuse validators and the existing [legacy-to-core adapter](../../apps/web/features/spatial/data/core-legacy-adapter.ts). New feature read models are projections, not a competing canonical schema.

## 2. Existing contracts that must survive

| Existing contract | Required preservation |
| --- | --- |
| `RegistryRecord.id`, `siteId`, `identifier`, `revision`; `RegistryLink` types `within`, `floor`, `serves`, `crosses` in [registry.ts](../../packages/contracts/src/registry.ts) | Do not replace IDs with labels, floor numbers, mesh IDs or generated hashes. Resolve exact parents and revisions. |
| `RegistryRight` types `ownership_claim`, `shared_use`, `easement` | A claim is not proof of ownership. Accepted technical review is not statutory adjudication. |
| `CoreRef {namespace,id}` and `CoreRevisionRef {ref,revision}` | Preserve namespace and ID separately. Use `coreRefKey` for keys; do not parse ad-hoc colon-separated strings. |
| Core value states `known`, `unknown`, `not_applicable`, `withheld`, `conflicting` | Never coerce absent, withheld or disputed data to zero. |
| Core source access labels `public`, `operator`, `restricted` | Metadata alone does not enforce access. Every actual read must pass server policy. |
| Core locators: page/region, rows, lines, feature, JSON pointer, model element, whole asset, verbatim | An unstructured/verbatim locator is not a validated extract boundary. Preserve it and request clarification. |
| Core source-link purposes `context`, `geometry`, `levels`, `record`, `appearance` | Context/appearance must not silently satisfy geometry or rights evidence requirements. |
| Geometry roles distinguish `recorded_road_land`, `road_surface`, `roof_projection`, `recorded_parcel`, `display_only` | Keep analytical comparisons role-aware. Do not measure presentation meshes. |
| [Registry prepare/commit](../../apps/web/lib/server/registry.ts) and [case processing](../../apps/web/lib/server/processing.ts) fingerprint/revision checks | Preserve stale-result rejection and immutable historical revisions. |

Official 2D ULPIN assertions remain attached to parcels where supplied. Internally allocated identifiers remain explicitly application identifiers. Never generate an official-issuance claim from an email, QR code, coordinate, uploaded deed or model output.

## 3. Proposed common DTOs and service ports — F0

**Proposed new files:** `packages/contracts/src/usp/common.ts`, `ports.ts`, `index.ts`; `apps/web/lib/server/usp/targets.ts`; `tests/fixtures/usp-common.ts`.

Publish strict Zod schemas alongside these types. Reject unknown fields, non-finite numbers, invalid refs, repeated query parameters and oversized payloads. These illustrative signatures are requirements to implement, not baseline exports:

```ts
type UspScope = { scopeId: string; world: CoreRef; snapshotDigest: string };
type TargetPin = { ref: CoreRef; revision: number };
type BackingRef =
  | { kind: 'registry'; siteId: string; recordId: string }
  | { kind: 'area_feature'; areaId: string; featureId: string }
  | { kind: 'retained_dataset'; datasetId: string; objectId: string };
type ResolvedTarget = {
  pin: TargetPin; scope: UspScope; backing: BackingRef;
  kind: 'parcel' | 'building' | 'floor' | 'space' | 'infrastructure';
  label: string; identifiers: IdentifierAssertion[];
  geometry: CoreRepresentation[]; evidence: EvidencePointer[];
  recordState: 'draft' | 'recorded' | 'retired' | 'retained_only';
};
type EvidencePointer = {
  source: CoreRevisionRef; asset: CoreRevisionRef | null;
  sourcePart: CoreRevisionRef | null; locator: CoreLocator;
  purpose: 'context' | 'geometry' | 'levels' | 'record' | 'appearance';
  origin: 'direct' | 'inherited'; target: CoreRef;
};
```

`IdentifierAssertion` must retain scheme, issuer if known, literal value, provenance and assertion/review status; reuse compatible core identifier schemas. An adapter must return `unavailable` rather than fabricate a revision, link or official issuer. A legacy `SourceBinding` is resolved to the existing source revision row; a typed locator may be added only when validated against that source. Keep the original free-text locator as provenance.

Use the existing adapter's namespaces when available. Where a backing object lacks a core ref, FND records a deterministic namespace-qualified mapping once in a binding ledger. That is a technical reference, not a new public ULPIN. Do not match solely by names or automatically merge a retained object and a registry record.

F0 ports, with injected implementations for tests:

| Port | Required behavior |
| --- | --- |
| `resolveTarget(ctx, pin, scope)` | Verify resource grant, parent/world membership and exact revision; return the supported read projection or a typed error. |
| `readScope(ctx, scope, cursor)` | Stable, bounded, revision-consistent pagination; include coverage/selection definition. |
| `readEvidence(ctx, pointer, action)` | Apply target AND source/part/asset access; never return storage credentials or unrestricted object keys. |
| `currentSnapshot(ctx, scopeId)` | Return exact digest and revision pins used for invalidation; no timestamps-as-revisions. |
| `commitProposal(ctx, command)` | Delegate to existing reviewed draft/commit services under expected revisions; no direct feature write to recorded property rows. |
| `appendOutbox(tx, event)` | Store a minimal durable event in the same transaction as the mutation. |
| `modelGateway(ctx, task)` | Invoke only a configured provider allowed by deployment and data classification; return validated output or unavailable. |

Optional cross-feature reads (`findings`, `evidenceRequests`, `rightsGraph`, `history`) return `{state:'available', snapshotDigest, data}` or `{state:'not_assessed', reasonCode}`. FND publishes their minimal projection interfaces in `ports.ts`; feature-specific detail schemas belong to their feature contract file. An absent feature is not an empty successful result. Tests may inject unavailable providers without importing unimplemented modules.

## 4. Access and deployment gates

**F1 local mode:** preserve current loopback restrictions, derive the local demo operator on the server and protect new services with the same policy port. Fixtures must include different principals even before production identity is enabled. Do not make caller-supplied `actor`, `role`, `scopeId` or email authoritative.

**F2 protected mode:** a deployment-configured identity provider authenticates a server session. Use a maintained OIDC/session implementation selected and pinned by FND, authorization-code flow with PKCE, verified issuer/audience/signature/expiry, exact redirect allowlist, CSRF protection and secure HttpOnly cookies. Do not implement cryptography or password storage from scratch. Missing IdP configuration fails closed; a fixture principal is permitted only in tests or explicitly loopback-only demo mode. Dependency/lockfile changes belong to FND, not individual agents.

Proposed `Principal` carries server-derived subject, roles, deployment mode and entitlement version. Grants are resource-scoped, not just role strings:

| Principal / capability | Allowed scope |
| --- | --- |
| Anonymous | Explicitly released public projection only; no party/contact details, private original, internal finding or enumeration endpoint |
| Contributor | Their own submission and files; public projections; no automatic ownership grant |
| Scoped reviewer | Assigned scopes; evidence needed for review; cannot publish outside grants |
| Scoped recorder | Separately granted reviewed-record operation; cannot bypass expected revisions |
| Deployment administrator | Configuration and resource grants; not an automatic right to all source contents |
| Worker/service | Bounded job resource and action; never a user-controlled actor string |

Capabilities include `property.read`, `evidence.preview`, `evidence.extract`, `evidence.original`, `proposal.create`, `proposal.review`, `record.commit`, `scope.assess`, `deployment.inspect`. `evidence.original` and `evidence.extract` are distinct. The effective permission is the intersection of principal grants, resource/asset restriction, allowed purpose and deployment policy. A reviewed redacted public derivative may receive a separate release decision; an AI summary does not declassify its source.

FND must inventory and gate the main catch-all API, specialized spatial/dataset/ML/scene/source routes and server-rendered Studio pages. The [Studio route](../../apps/web/app/studio/%5B%5B...view%5D%5D/page.tsx) performs database reads; API-only checks are insufficient. Leave legacy paths localhost-only in protected deployments unless individually qualified and included in the route-policy tests. Never replace `localOnly` with a global `return` or trust reverse-proxy headers without a configured trusted boundary.

Public data preparation is an explicit allowlist projection, with field-level omissions and non-enumerable errors. Session/permission changes invalidate caches and derivative-download authorization. Expiring links are not sufficient by themselves if they remain usable after revoked access.

## 5. API and event conventions

**Proposed new mount:** `apps/web/app/api/v1/usp/[...path]/route.ts`, delegating to `apps/web/lib/server/usp/routes.ts`. FND owns both. Features own leaf handlers under `apps/web/lib/server/usp/<feature>/routes.ts` and receive `RequestContext`; they do not edit the central dispatcher.

Use `/api/v1/usp/<feature>/...` with feature names `packets`, `readiness`, `findings`, `citizen`, `ingestion`, `history`, `rights`, `impact`, `assistance`, `deployment`. Methods and payloads are defined in each handoff. Mount a module only after its imports and tests exist; disabled modules return a documented unavailable response, not a fake successful payload.

Successful JSON includes `{data, meta:{schemaVersion:'usp/1', requestId, snapshotDigest}}`. Errors use `{error:{code,message,retryable,requestId,details?}}`; no stack traces, raw documents or provider responses. Use 400 malformed, 401 unauthenticated, 403 denied where disclosure is safe, non-enumerable 404 otherwise, 409 stale revision/idempotency conflict, 413 resource limit, 422 unsupported semantic input, 429 throttled and 503 unavailable. UI should act on codes, not parse English messages.

Mutations require an idempotency key, canonical payload hash, server actor and expected revision/snapshot. Repeating the same key/payload returns the original result; different payload is 409. Do not retry non-idempotent writes automatically. Collection responses use bounded cursors pinned to the filter and snapshot. Public queries have a stricter allowlist than officer queries.

**Proposed durable events:** `usp_streams` plus `usp_outbox`. Use a per-stream sequence allocated while holding the stream row lock until commit; a global sequence allocated before transactions commit can otherwise create replay gaps. Store stream ID, decimal sequence, event type/version, scope, target refs, snapshot digest, correlation ID and minimal safe payload. Keep legacy `events` as historical activity; its UUIDs are not a replay ordering.

Features call `appendOutbox`; they do not publish directly from a browser or before transaction commit. INGEST owns SSE replay delivery; CITIZEN owns notification consumption. Events are at-least-once; consumers deduplicate by stream/sequence. Authorization is rechecked for subscription, replay and dereferencing assets. Reconnect, expired cursor and revoked permission have explicit behaviors in handoff 14. Do not stream confidential document text merely to update a progress bar.

## 6. Persistence and migration coordination

**Proposed new files:** `apps/web/lib/server/usp/db.ts`, `access.ts`, `principal.ts`, `audit.ts`, `outbox.ts`, `migrations.ts` and `targets.ts`.

FND owns a migration registry with named, ordered migrations and advisory-lock protection, called from the existing [db migration entry](../../apps/web/lib/server/db.ts). Reuse `pool`, `query`, `transaction`; do not introduce Prisma or a second connection pool. No requests run destructive schema rewrites. Feature migrations use separate names/files; only FND registers them. Scripts still run through `pnpm db:migrate`.

FND tables: resource-scope bindings/grants, idempotency records, audit records, stream counters and outbox. These contain references and policy metadata, not copied canonical property contents. Validate polymorphic backing refs transactionally; bind each resource to an existing backing record and scope. Historical mappings remain resolvable after archival. A same-label object in another site is not a match.

Feature table prefixes are reserved: `usp_packet_*`, `usp_readiness_*`, `usp_finding_*`, `usp_citizen_*`, `usp_ingest_*`, `usp_history_*`, `usp_rights_*`, `usp_impact_*`, `usp_assist_*`, `usp_deployment_*`. Migration names begin with the feature number, but FND controls applied order by dependency. Features must not independently alter `registry_records`, `registry_revisions`, `sources`, `jobs`, `spatial_datasets` or existing identity tables. Request a minimal FND-owned adapter patch instead.

Every mutation records actor, purpose, before/after revision pins, request key and reason. Logs do not contain full source text or credentials. Separate source classification, geometry method, technical review state, recorded state and external authority evidence. A single `verified` boolean is forbidden.

## 7. Shared UI and map ownership

The URL owns restorable selection/scope; the existing store owns transient preferences; server snapshots own property facts. FND defines a normalized `SelectionContext` with area/site/dataset scope, world, target pin, floor/unit refs, source pointer and panel. UI maps it to the existing `feature`, `record`, `world` and contextual routes. Unknown or incompatible selections produce a visible error and no substitute property.

Reuse [useBlock](../../apps/web/features/officer/block/useBlock.ts), [officer store](../../apps/web/features/officer/shared/store.tsx), [map sessions](../../apps/web/features/spatial/data/session.ts), [resource cache](../../apps/web/features/spatial/data/resource-cache.ts) and [viewport leases](../../apps/web/features/studio/scene/SharedViewport.tsx). UI alone modifies these files and the top-level shell/routes/renderer adapters. Feature components receive the selection and callbacks; they must not install another provider, Canvas, Cesium viewer or global selection store.

**Proposed extension files owned by UI:** `apps/web/features/usp/shared/FeatureSlots.tsx`, `SelectionBridge.tsx`, `StatusBadge.tsx`, `EvidenceAction.tsx`, `FeaturePanel.tsx`. Feature leaves export a typed panel/action registration. UI mounts them in quick inspection, full register, batch review and contextual map tools. Persist no private records or tokens in localStorage. Cache keys include resource scope, world, snapshot, access-view/entitlement version and parameters; clear scoped caches on sign-out, revocation and scope change.

## 8. Exact shared-file ownership

| Existing or proposed file | Change | Reason | Sole owner | Consumers |
| --- | --- | --- | --- | --- |
| [contracts index](../../packages/contracts/src/index.ts) | Export shared USP contracts only after they exist | Avoid parallel export conflicts | FND | All |
| Proposed new `packages/contracts/src/usp/common.ts`, `ports.ts`, `index.ts` | Common refs/context/ports/schemas | Freeze compatibility | FND | All |
| [db.ts](../../apps/web/lib/server/db.ts), proposed new `usp/migrations.ts` | Register additive migrations | One schema coordinator | FND | All persistent features |
| [processing.ts](../../apps/web/lib/server/processing.ts), [dispatcher.ts](../../scripts/dispatcher.ts), [geo/api.py](../../services/geo/geo/api.py), [geo/tasks.py](../../services/geo/geo/tasks.py) | Narrow worker dispatch/result hooks | Preserve the existing queue | FND | INGEST, PACK, FIND, IMPACT |
| [API catch-all](../../apps/web/app/api/v1/%5B...path%5D/route.ts), [spatial-core-http.ts](../../apps/web/lib/server/spatial-core-http.ts), specialized API families | Mode-aware access and regression coverage | No bypass routes | FND | All |
| Proposed new `app/api/v1/usp/[...path]/route.ts`, `lib/server/usp/routes.ts` | Mount qualified leaf routes | One API integration point | FND | Feature route modules |
| [config.ts](../../apps/web/lib/server/config.ts), [package.json](../../package.json), [web package](../../apps/web/package.json), [geo requirements](../../services/geo/requirements.txt), lockfiles | Review required config/dependencies | No conflicting upgrades | FND | DEPLOY and other requests |
| [Studio route](../../apps/web/app/studio/%5B%5B...view%5D%5D/page.tsx) | UI owns routing; FND supplies access wrapper patch for UI to integrate | One writer even when access is cross-cutting | UI | FND and all features |
| [Shell](../../apps/web/features/officer/shared/Shell.tsx), [ProductHeader](../../apps/web/features/studio/product/ProductHeader.tsx), [product URLs](../../apps/web/features/studio/product/urls.ts) | Navigation/slots | One product experience | UI | All panels |
| [QuickRecords](../../apps/web/features/studio/product/QuickRecords.tsx), [RegisterPage](../../apps/web/features/officer/register/RegisterPage.tsx), [BlockPage](../../apps/web/features/officer/block/BlockPage.tsx), [WorkQueue](../../apps/web/features/officer/work/WorkQueue.tsx) | Mount leaves and preserve scope | Avoid concurrent parent edits | UI | Relevant feature agents |
| Proposed new `packages/contracts/src/usp/<feature>.ts`, `lib/server/usp/<feature>/`, `features/usp/<feature>/`, `tests/usp-<feature>*` | Feature-local implementation | Bounded independent ownership | Named feature owner | Read-only imports by others |

UI/FND cross-cutting work is delivered as a patch request; the listed sole owner applies it. Do not reformat shared files as part of a feature. No feature may claim independence from an unavailable service simply because a stub compiles.

## 9. Foundation implementation and acceptance

1. Capture baseline and map each supported backing kind to a stable core ref; add fixtures for ambiguous identifiers, cross-floor units, retained-only objects and withheld evidence.
2. Publish F0 schemas/ports and unavailable-provider adapters. Test compatibility before feature branches start.
3. Implement F1 read adapters and additive stores; wire legacy local access through the policy port without weakening it. Add source-download and derived-read authorization tests.
4. Coordinate dispatch hooks and API/UI slots with their owners. Test transactional idempotency, outbox commit ordering, stale-revision rejection and migration reruns on populated fixtures.
5. Implement F2 behind disabled-by-default deployment configuration; verify identity provider configuration and exhaustive route/page coverage before enabling public traffic.
6. Run isolated integration regressions. Reconcile existing package/store formats without rewriting originals, changing IDs or treating synthetic packages as observed records.

**Proposed tests:** `tests/usp-contracts.test.ts`, `usp-access.test.ts`, `usp-targets.test.ts`, `usp-outbox.test.ts`, `usp-foundation-integration.ts`, `tests/e2e/usp-access.spec.ts`. Add cases for forged principal/scope headers, cross-site resource IDs, denied preview/download/extract, stale cache after revocation, duplicate commands, rollback between storage/DB steps, and a late commit that must not disappear from event replay.

Run existing `pnpm typecheck`, `pnpm test:studio`, `pnpm test:api`, `pnpm test:registry`, `pnpm test:register-scope`, plus proposed tests with `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test <exact-test-files>`. Integration tests require the isolated services; do not call mocked access a production security pass. F0 is accepted by contract tests, F1 by live local service tests, F2 only by authenticated multi-principal and deployment checks.

## 10. Copy-paste foundation assignment

> Implement FND from `docs/usp-agent-handoffs/01-shared-contracts-and-ownership.md` after reading `00-README.md`, root/web AGENTS and the pinned baseline files. Work on an isolated `feat/usp-foundation` branch. First deliver F0 schemas, ports, reference adapters and fixtures, then F1 live local integration; implement F2 as a separate protected-deployment gate, disabled until qualified. Own only the shared backend/contracts/config/migration paths assigned to FND. Send shell/route/selection patches to UI rather than editing its files independently. Reuse registry identities, core source/geometry contracts, existing jobs and private storage. Do not rewrite snapshots, remove localhost guards globally, publish records automatically, or expose originals through public endpoints. Run the specified contract, access, migration, API and registry tests; distinguish fixtures from live services. Return commit SHAs, gate status, exact shared interfaces, migration/dependency changes, verification evidence and unresolved external configuration gates. Do not merge into main without authorization.
