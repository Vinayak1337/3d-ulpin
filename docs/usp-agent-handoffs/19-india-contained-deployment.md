# 19 · India-contained deployment and provider-controlled processing

Owner **DEPLOY** · Priority **P1 deployment gate** · Baseline `main@f623cff897f91bb3ebd4c225f700ac263f7beb72` · Consume [F0/F2 contracts](01-shared-contracts-and-ownership.md). This handoff plans controls; it does not certify the existing application or any provider.

## A. User outcome and product value

Allow a deployment operator to run the property/evidence workflows within an explicitly approved data boundary, understand which capabilities the server supports, and prevent an unavailable model or service from silently exporting records elsewhere. This is an enabling deployment capability, not proof of data truth or a unique mapping algorithm.

Example: an officer imports a restricted registry PDF. Its original, extracted text, packet derivatives, model requests, logs and backups must all follow the deployment policy. If the approved inference service is unavailable, the officer can continue manual mapping; the system must not fall back to the existing external Nous route or an external ChatGPT connection.

## B. Current implementation and gap analysis

[compose.yaml](../../compose.yaml) already runs local PostGIS, private MinIO, Redis and private geo/Celery services with loopback host ports and persistent volumes. It does not containerize the full web/dispatcher deployment or establish a production identity/egress boundary. Preserve this local demo configuration rather than silently exposing its ports.

[storage.ts](../../apps/web/lib/server/storage.ts) preserves originals with conditional writes and hash/readback checks. These help integrity, not geographical residency. [config.ts](../../apps/web/lib/server/config.ts) and [geo/settings.py](../../services/geo/geo/settings.py) default an S3 region string to `us-east-1`; with a local S3-compatible endpoint that string alone neither proves US storage nor proves Indian storage. Actual infrastructure and provider contracts must establish location.

[officer-ai-provider.ts](../../apps/web/lib/server/officer-ai-provider.ts) explicitly calls an external Nous endpoint. New features cannot claim a contained boundary while leaving this existing path ungoverned. The application also needs a complete browser/server external-resource inventory, including map tiles, fonts, model downloads, notification services and observability. No complete inventory or denied-egress runtime test is claimed by this documentation inspection.

Vendor context checked on 22 September 2026: [Sarvam's Trust Center](https://www.sarvam.ai/trust-center) states India-only residency for Indian deployments and offers managed, on-premises and air-gapped models. These are vendor statements, not an application deployment audit. The deployment owner must confirm the specific endpoint/service, retention, backups and processing terms before approving restricted data. [Sarvam's chat overview](https://docs.sarvam.ai/api/api-guides-tutorials/chat-completion/overview) documents its current chat API; implementation must recheck supported models and capabilities instead of copying obsolete model names.

## C. Scope and non-goals

First release: typed deployment policy and capability manifest; governed model gateway with an approved Sarvam adapter and optional configured local adapter; explicit local/private/public modes; safe failure behavior; reference protected deployment manifest; egress/restore qualification scripts and an administrator status surface. Local no-AI workflows must remain functional.

No universal “runs on any server” promise, residency certification inferred from a hostname, blanket regulatory compliance claim, automatic purchase/provisioning, secret collection in Git, or production launch during this implementation task. Full air-gap qualification and high availability are separate profiles requiring actual infrastructure evidence. An Indian inference provider does not automatically make unrelated email, logging or external AI services India-contained.

## D. HLD and end-to-end flow

Operator configures a policy using secret references and approved service endpoints → startup validates required identity/storage/service configuration → policy evaluates each requested capability and data class → authorized feature calls pass through the appropriate gateway → network controls enforce the configured destination boundary → response/output validators apply → safe operational status reports capability availability and unmet gates.

A policy change has a version and audit record. It takes effect for new jobs immediately; running jobs are checked before the next external operation or output publication. Revoking a destination stops future calls and marks affected work paused/needs input, without deleting retained evidence.

## E. Targeted LLD

### Deployment profiles and capability truth

| Proposed profile | Allowed processing | Required boundary |
| --- | --- | --- |
| `local_demo` | Current loopback-only services and labelled fixtures; separately opted-in existing AI under explicit policy | No claim of production authentication or India-only residency |
| `india_private` | Private records in approved Indian infrastructure; only approved local/India-hosted services | F2 identity/resource authorization; default-deny egress; external public MCP disabled |
| `public_interoperability` | Released public projection may be returned to external clients; private native workflows remain separately protected | Explicit public-release boundary; no claim that exported public responses stay in India |

An optional `air_gapped` capability is not automatically true for `india_private`. It requires preloaded pinned models/assets/images, internal identity/time/update procedures and a successful disconnected operation test. Public/private services may be separate deployments; do not switch a running private service to public mode without an explicit reviewed configuration change.

Proposed `DeploymentPolicy` contains version, profile, data classifications, service IDs, allowed purposes, endpoint allowlists, secret-reference names, processing-location evidence references, retention/backup policy references, budget profile and enabled features. Never store credential values or private contracts in this public repository. Proposed `CapabilityStatus` uses `configured`, `available`, `disabled`, `unqualified`, `unavailable`, with safe reason codes and last check; configuration is not successful runtime qualification.

Residency, confidentiality and integrity are separate assessment dimensions. Hash validation cannot determine truth, TLS cannot establish storage location, and a country-code DNS name cannot prove where logs/backups reside. Human-confirmed provider/infrastructure evidence is a release gate; automated checks establish configured destinations and observed behavior only.

### Model gateway and Sarvam adapter

DEPLOY implements the FND `modelGateway` port in proposed `apps/web/lib/server/usp/deployment/model-gateway.ts`. Inputs include task kind (`schema_mapping`, `document_extraction`, `grounded_answer`), bounded authorized evidence, requested output schema, data classification, deployment policy version and budget. The gateway derives its destination from server configuration, not user/model-supplied URLs. It returns structured output plus provider/model/version and bounded usage metadata, or a typed unavailable/error result.

The proposed Sarvam adapter uses the documented `/v1/chat/completions` contract and server-side `api-subscription-key` authentication. Configure the approved model rather than hardcode an assumption of free usage or support. Qualify required structured-output/image capabilities separately; schema mapping and grounded text answers do not imply the model can reconstruct LiDAR or interpret arbitrary plans. Enforce response byte/token/time limits, cancellation and strict output validation. Reject truncated, malformed or tool-invoking responses when the task does not authorize tools. No upstream response bodies or secrets enter errors/logs.

Use one bounded repair only when the feature budget permits. Count attempted calls against the budget even when output validation fails. Retry only documented transient failures within an explicit cap; never choose a different provider/model, paid tier or geographical endpoint implicitly. FND must route the existing Nous extraction entry through the same policy decision or disable it under `india_private`; a newly governed gateway cannot coexist with a bypassing legacy call path.

The local adapter supports an explicitly configured compatible local service; its presence does not claim that any model fits the available CPU/GPU. Publish measured memory/hardware/model requirements and an unavailable state when unmet. No AI credentials means deterministic ingestion/manual mapping and verified template answers remain available; features must not show an AI success badge.

### Service and network coverage

Inventory every data path: web/dispatcher/geo/worker, database, originals/derivatives, Redis, session/identity provider, scanner, model endpoint, backups, monitoring/error reports, email/SMS, browser tiles/fonts and model/package downloads. Classify coordinates, search queries and logs as possible disclosures rather than considering only uploaded files.

For `india_private`, enforce network default deny at the deployment boundary in addition to application allowlists. Allow only approved internal or qualified service destinations. Deny unexpected redirects and unapproved DNS/address changes; internal/private addresses are allowed only as explicitly configured service endpoints, never as request-supplied URLs. Do not implement a generic URL-fetch proxy. TLS/certificate validation is required for non-loopback transport; local development exceptions must not leak into protected mode.

Use local/approved basemap and font assets in private mode, or disable those optional layers with an understandable state. Do not silently request third-party tiles containing the officer's viewed coordinates. Disable external telemetry and raw document logging. Preflight can identify unapproved destinations, but only a real network test can qualify enforcement. Preserve source attribution/license metadata while replacing delivery paths; do not strip attribution to claim offline capability.

Provide explicit ports for CITIZEN: `scanAsset(ctx,assetRef)` returns `clean|quarantined|rejected|unavailable` with scanner/version and hash; `sendReceipt(ctx,messageRef)` uses an approved configured transport. Scanner unavailable blocks public file release. Email unavailable does not block in-app receipts. DEPLOY owns adapters/configuration; CITIZEN owns message content, subscriptions and submission logic. No public service is activated without F2, scanner qualification and required endpoint policy.

### Packaging, storage and recovery

Proposed `infra/deployment/compose.india-private.yaml` is a **standalone reference stack**, not an unchecked overlay whose port merges might retain unwanted exposure. Include web/dispatcher plus existing service roles, private networks, health checks, resource limits, pinned images and approved ingress. FND owns required dependency/Dockerfile/root-config changes; DEPLOY supplies narrowly reviewed patches. Do not deploy or replace the user's existing volumes as part of preparing this feature.

Secrets are injected through the operator's secret system or untracked deployment configuration; provide only placeholder names in `infra/deployment/policy.example.json`. Keep database/object-store consoles off public ingress. Reuse immutable originals and per-asset permission checks. Derived files and model caches have separate retention rules; deleting a derivative must not remove its original.

Backup qualification must restore a consistent database, referenced immutable objects, encryption/access configuration and job/outbox positions into **new isolated volumes**. Verify source hashes and record/revision links; resume idempotent work without duplicate commits or notifications. Document measured recovery time and any unsent-event recovery, not an invented recovery SLA. Never run `repo:init` or overwrite populated snapshot volumes for a restore test.

Proposed `usp_deployment_qualifications` stores policy hashes, non-secret capability/check results and evidence references; full network logs/contracts remain in restricted operator storage. Proposed read-only `/api/v1/usp/deployment/status` requires `deployment.inspect` and returns safe checks, not environment-variable dumps. Ordinary users see only relevant unavailable-feature reasons. New qualification operations run via an explicit operator CLI, not an unauthenticated endpoint that probes internal networks.

## F. Exact implementation map

| Existing or proposed file | Required change | Reason | Owner | Shared dependency |
| --- | --- | --- | --- | --- |
| [compose.yaml](../../compose.yaml), [geo Dockerfile](../../services/geo/Dockerfile) | Preserve local stack; request only reviewed shared build hooks | Avoid accidental exposure/replacement | FND shared changes; DEPLOY reference | Existing service roles |
| [config.ts](../../apps/web/lib/server/config.ts), [geo/settings.py](../../services/geo/geo/settings.py) | Inject strict policy/service config, keep secrets server-side | One configuration authority | FND | DEPLOY policy schema |
| [storage.ts](../../apps/web/lib/server/storage.ts), [officer-ai-provider.ts](../../apps/web/lib/server/officer-ai-provider.ts) | Preserve integrity behavior and govern legacy external calls | Close bypass paths | FND | DEPLOY adapters |
| Proposed new `packages/contracts/src/usp/deployment.ts` | Policy/capability/qualification schemas | Explicit deployability and limits | DEPLOY | Common refs/context |
| Proposed new `apps/web/lib/server/usp/deployment/{policy,capabilities,model-gateway,scan,mail,routes}.ts`, `providers/{sarvam,local}.ts`, `migrations/19-deployment.ts` | Govern services and store safe qualification receipts | Approved processing path | DEPLOY | FND principal/config/mount |
| Proposed new `infra/deployment/{compose.india-private.yaml,policy.example.json,README.md}` | Standalone deployment specification and required controls | Reproducible private profile | DEPLOY | FND build artifacts; operator infrastructure |
| Proposed new `scripts/usp/deployment-check.ts` | Explicit non-destructive preflight/network/restore verification orchestration | Measured qualification | DEPLOY | Isolated target and operator permission |
| Proposed new `apps/web/features/usp/deployment/DeploymentStatus.tsx` | Safe administrator diagnostics | Visible unmet gates without clutter | DEPLOY | UI settings slot |
| Proposed new `tests/usp-deployment.test.ts`, `tests/usp-deployment-integration.ts`, `tests/e2e/usp-deployment.spec.ts` | Policy, legacy bypass, denied egress and status tests | No assertion-only residency claim | DEPLOY | Isolated infrastructure/F2 fixtures |

## G. UI placement and interaction

Authorized operator opens the existing Studio header's settings menu → **Deployment** → sees profile, capabilities and qualification gaps → opens an actionable configuration reference. This is an advanced contextual surface, not a fourth top-level officer section. Property users see a short local reason such as “AI mapping unavailable; manual mapping is available,” not the provider's raw error.

Loading/unknown checks show “Not checked.” Missing credentials show a disabled capability without exposing secret names/values unnecessarily. Failed egress/identity qualification blocks protected-mode release; successful checks say what was tested and when, not “government certified.” An offline basemap has a local fallback/empty base while supplied geometry remains inspectable. DEPLOY owns status content; UI owns the settings entry and visual pattern.

## H. Agent ownership and dependencies

Use `feat/usp-deployment`. Policy and adapter tests start after F0. Native local no-AI integration can proceed before F2; public/private production release cannot. FND owns identity, shared config/dependencies, legacy-call shims and API mounts; DEPLOY owns the bounded gateway/provider/scan/mail implementations and infrastructure reference. ASSIST/INGEST consume modelGateway without adding their own network clients. Human tasks supply provider/IdP/infrastructure approvals, not architecture or code.

## I. Implementation sequence

1. Inventory actual server/browser destinations and classify data exposure; record unknowns rather than claiming containment.
2. Implement strict policy/capability schemas and denied-by-default gateway; preserve local no-AI operation.
3. Add and qualify Sarvam/local adapters with synthetic requests; wire existing Nous through FND's policy gate.
4. Add scanner/mail contracts and a standalone protected stack reference; coordinate F2 route/page coverage.
5. Run isolated denied-egress, SSE reconnect/proxy and multi-principal tests; verify optional assets/telemetry behavior.
6. Test backup/restore in new volumes and publish qualification receipts plus honest resource requirements.

## J. Acceptance criteria and verification

Synthetic restricted-data demo performs source intake, mapping, evidence preview and packet generation in the selected profile. Capture destination metadata at the boundary; no unapproved call occurs from either new or legacy provider paths. Deny the approved model endpoint: native manual workflows still work and no fallback request goes elsewhere. Public MCP remains disabled in `india_private`.

Test bad policy version, unknown destination, endpoint redirect, missing/expired credential, wrong IdP audience, scanner outage, email outage, unsafe diagnostics, third-party tile attempt, response truncation, exhausted model budget, revoked capability, worker restart and interrupted restore. A status page cannot mark residency qualified using configuration alone. Restored original hashes and registry revisions must match; outstanding job/event recovery must be duplicate-safe.

Run `pnpm typecheck`, `pnpm test:api`, `pnpm test:ai`; `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-deployment.test.ts`; `pnpm exec tsx tests/usp-deployment-integration.ts`; `pnpm exec playwright test tests/e2e/usp-deployment.spec.ts`. Once created, run `pnpm exec tsx scripts/usp/deployment-check.ts` against an explicitly isolated configured target. Use existing `pnpm platform:health` for the unchanged local stack. Do not claim protected deployment or live Sarvam qualification when only fixtures ran; return exact model/service/config versions and unresolved provider evidence separately.

## K. Copy-paste agent assignment

> Implement DEPLOY on `feat/usp-deployment`. Read the index/shared contracts, this handoff, existing compose/config/storage/Nous code and current official provider documentation. Build the proposed policy, model gateway, approved Sarvam/local adapters, scanner/mail interfaces, safe status and standalone deployment reference. FND owns shared config/dependencies/auth/mounts and legacy provider patches; UI owns settings placement. Govern every data path, not only new AI calls, and preserve manual local operation. Do not infer geography from a region string, silently fall back to an external provider, commit secrets or deploy over existing volumes. Run section J against fixtures and explicitly isolated infrastructure as available; return commits, destination inventory, measured checks/restore evidence, resource requirements and human approval gaps. No main merge or public activation without authorization.
