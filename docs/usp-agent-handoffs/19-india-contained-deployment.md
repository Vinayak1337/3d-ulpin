# 19 · Governed AI and India-contained deployment

**Release boundary:** finale uses local isolated services and existing provider/no-key controls; production authentication, multiuser/public activation and India-hosted deployment are `full_product` gates. Local privacy and any permitted provider call still require their relevant checks.

**Provider-plan update, 23 September 2026:** [20 - Sarvam gateway, credit pools and permanent credential retirement](20-model-gateway-and-budget-pools.md) is required for this feature's model integration. Use [02 - Astra Max lead and explicit worker delegation](02-lead-agent-execution.md) for development-worker selection. These instructions do not claim a live provider, funded account or passing new tests.

Owner **DEPLOY**. Baseline `f623cff897f91bb3ebd4c225f700ac263f7beb72`; revised 22 September 2026. Read [00](00-README.md), [01](01-shared-contracts-and-ownership.md), consumers [13](13-citizen-evidence-and-corrections.md), [14](14-adaptive-ingestion-and-progressive-review.md), [18](18-grounded-assistance-and-mcp.md) and UI slot in [99](99-ui-ux-and-integration.md). ER-16/22/23 are incorporated. No provider, infrastructure or application certification is claimed by this plan.

## A. User outcome and product value

Allow an operator to run evidence workflows within a declared processing boundary, see which capabilities actually work and stop unavailable services from silently exporting data elsewhere. With the approved model offline, manual mapping and typed service answers remain useful. Residency, confidentiality and integrity are separate: storage region, access controls and checksums do not prove one another or document truth.

## B. Current implementation and gap analysis

[compose.yaml](../../compose.yaml) includes local PostGIS/MinIO/Redis/geo/Celery but not a complete protected web/dispatcher deployment. [storage](../../apps/web/lib/server/storage.ts) preserves original bytes; [config](../../apps/web/lib/server/config.ts) and [geo settings](../../services/geo/geo/settings.py) use an S3 region string that does not establish actual geography for a local compatible endpoint. [Legacy Nous](../../apps/web/lib/server/officer-ai-provider.ts) is an external call path that must also be governed.

Implement actual gateway/scanner/mail adapters, capability policy, complete ingress/egress inventory, reproducible service entrypoints and environment tests. A standalone compose filename, region setting or vendor claim is not operational qualification. Preserve the existing local stack and volumes.

## C. Scope and non-goals

DEPLOY0: policy schemas, disabled/unavailable states and no-AI local operation. DEPLOY1: governed Sarvam/local adapters and scanner/mail integration with measured synthetic tests. DEPLOY2: standalone protected stack, F2 route/page coverage, denied-egress and isolated backup/restore qualification. These gates are separate; none delays the local V0 map→unit→evidence slice.

No automatic cloud purchase/provisioning, secret collection in Git/chat, production launch, universal hardware support, blanket regulatory compliance or high-availability platform. Full air-gap operation is optional and needs disconnected tests with preloaded dependencies, not a checkbox.

## D. HLD and end-to-end flow

Load policy and secret references → validate configured service capabilities → derive destination/purpose from server policy → enforce boundary before every external call → bounded provider response validation → feature-specific semantic validation → persist safe receipt → display actual capability. Policy revision/revocation applies to new work and before each subsequent external operation/result publication; do not delete retained evidence when a capability is revoked.

## E. Targeted LLD

### Profiles and truthful status

| Mode | Permitted behavior |
| --- | --- |
| local_demo | Existing loopback workflow and labelled fixtures; optional explicitly configured AI. No production residency/auth claim. |
| india_private | Approved Indian infrastructure and providers, F2 resource permissions, default-deny egress and disabled external MCP. |
| public_interoperability | Separately released public projections may leave through approved external clients; private native data remains protected. Do not claim public responses stay in India. |

`DeploymentPolicy`: version, mode, data classes/purposes, approved service IDs/endpoints, secret-reference names, budget limits, retention/backup/location evidence refs, allowed features and release policy. `CapabilityStatus`: disabled/configured/unqualified/available/unavailable with safe reason, tested version/environment/time. Configuration alone is not available; no secrets/full provider bodies in HTTP status.

[Sarvam Trust Center](https://www.sarvam.ai/trust-center) states India-only residency for Indian deployments. This is vendor context, not proof of this installation's full data flow; H3 confirms the selected service contract and backup/log/subprocessor arrangements. The application must govern every path, not just the model call.

### Model gateway: one network owner

Implement the existing FND gateway using [H20](20-model-gateway-and-budget-pools.md), which is the detailed adapter specification for this DEPLOY workstream. It defines selected models/prices, organisation wallets, per-key attribution, bounded calls, shared rate limits, atomic reservations, ambiguous billing, permanent credential retirement and the operator settings tests. Do not duplicate those mechanisms in consumers or create a separate gateway.

The initial model set is Sarvam 105B V1 for bounded schema mapping/extracted text, and separately qualified Vision document digitisation for scans. ASSIST0 stays deterministic. Managed 30B is deprecated. No LLM reads raw point-cloud arrays into invented cadastral geometry. Check the exact endpoint/price/capability against H20's dated sources and actual live qualification before use. Keys enter through secret references, not Git/chat/browser configuration.

Sarvam's introductory credit is per new user, while organisation balances and account rate limits are shared by keys. Authorised rollover must not multiply the shared balance or bypass throttling. Retired credentials never resume after restart/re-enrolment; draining admitted document jobs and transient cooldown are distinct states. Unknown provider charge is retained as exposure, not silently refunded. A funded key is not proof of data-transfer permission.

Keep the current synchronous two-attempt/45-second/1 MiB caps as total task bounds, including retries and repair; asynchronous document jobs use existing durable jobs and their own qualified page budget. Count reasoning inside completion usage once. Provider token streaming is not geometry SSE. FND routes or disables the legacy Nous path; no unapproved paid/model/geography fallback. No-key and exhausted-budget modes keep manual mapping and typed answers useful. When FP-LEARN is implemented, H21 permits eligible, isolated training alongside ingestion; provider-derived examples require recorded permission. It is not a finale prerequisite.

### Scanner and mail adapters

Default scanner implementation is a private ClamAV/clamd service with pinned image and signature database/version. [Official scanning guidance](https://docs.clamav.net/manual/Usage/Scanning.html) notes the TCP interface is not authenticated; expose it only through an isolated internal socket/network, never public ingress. Precheck upload sizes and configure scanner limits consistently: a skipped/limit-exceeded file is quarantined/unavailable, never clean. A stale/missing signature policy or scanner outage blocks public release. Use immutable uploaded bytes and return `{uploadId,assetHash,verdict,engineVersion,signatureVersion,scannedAt,limitStatus}`. Clean antivirus does not remove structural/active-content validation or isolated rendering requirements. Do not delete originals automatically on an alert.

Mail uses an operator-approved configured transport; absent transport is unavailable, with in-app status intact. Request follows 01 notificationId/deliveryKey/audience/template. Return accepted with provider receipt, rejected, or unknown acknowledgement; CITIZEN owns reconciliation and dedup. Never promise exactly-once delivery or email actual deeds/party information by default. Scanner/model/mail network clients live here, not independently inside feature modules.

### Inventory, build and network enforcement

Produce a machine-readable inventory as implementation evidence, listing path/route/process, audience, data types, destination, policy decision and test. Cover:

| Surface | Must be checked |
| --- | --- |
| Main API catch-all | Cases, registry, resolve, work queue, source file/export and health paths |
| Specialized API routes | Spatial datasets/search, ML/source, core scene descriptors/GLBs, calibration and Studio source assets |
| SSR pages and static assets | Studio catch-all, property/register/workspace pages, public routes, cached/derived files and public-directory fixture contents |
| Server processes | Web, dispatcher, geo, worker, database, objects, Redis, scanner, provider and backups |
| Browser calls | Basemap/tiles, fonts, textures, analytics/error reporting, external links and MCP responses |

FND supplies authentication/access wrappers; DEPLOY verifies every ingress path and trusted proxy assumption. Unknown route is denied externally until qualified. Do not globally remove localhost guards or expose an internal resolver through a new public wrapper.

Proposed `infra/deployment/compose.india-private.yaml` is standalone, not an overlay retaining old port mappings. Web and dispatcher use the same pinned build artifact but separate processes: web invokes the configured `@ulpin/web` production server; dispatcher invokes `pnpm dispatcher`. The existing root `pnpm start` already launches both, so do not also start a duplicate dispatcher. Existing web script binds loopback; FND must supply a container-only entrypoint binding the internal service interface while approved ingress remains the only public listener. Preserve local developer scripts.

FND owns proposed `infra/deployment/Dockerfile.web` and any shared package/config changes requested by DEPLOY. Build context is repository root with the lockfile/workspace, packages/contracts, apps/web, required scripts and traced static/runtime assets. Use frozen install and a tested production build; missing build-time secrets must not be solved by baking credentials into the image. Qualify launch, health and source/PDF assets in a clean isolated stack. Do not claim a reference YAML runs until these images/entrypoints pass.

Default-deny network policy applies to runtime egress in addition to application allowlists, including redirects/DNS changes and model/scanner updates. Approved internal addresses are allowed only by configuration, never request-supplied fetch targets. Require validated TLS on protected external transport. No third-party basemap/font/telemetry call in India-private mode unless specifically approved; local assets or disabled optional context are the fallback. Preserve attribution/licences. Air-gapped mode additionally preloads packages, images, model weights, scanner signatures and local identity/time infrastructure, then tests disconnected operation.

### Recovery and status

Restore a consistent database, referenced immutable objects, permission/release policy, encryption/secrets configuration and logical job/outbox positions into new isolated volumes. Verify original hashes, target/source revisions and manifest dependencies. Reconcile pending jobs against durable accepted receipts and current fences; consumed notifications stay deduplicated. Do not blindly restore old Redis state over newer SQL. Expired leases are retried through the logical job contract, not marked succeeded. Report measured recovery, not an invented SLA.

`usp_deployment_qualifications` stores non-secret policy/config hashes, test outcomes and restricted evidence references. GET `/api/v1/usp/deployment/status` requires deployment.inspect. Qualification is an explicit operator CLI targeting an isolated environment, not a public endpoint that probes arbitrary network addresses. Feature users see safe capability reasons only.

## F. Exact implementation map

| File | Change / owner |
| --- | --- |
| Existing compose/config/storage/Nous/geo settings and package/lock files | FND sole editor applies narrow DEPLOY patches; original local setup preserved |
| Proposed `packages/contracts/src/usp/deployment.ts` | DEPLOY policy/capability/scan/mail/model result schemas, FND port compatibility |
| Proposed `apps/web/lib/server/usp/deployment/{policy,capabilities,model-gateway,scan,mail,routes}.ts`, `providers/{sarvam,local}.ts`, `migrations/19-deployment.ts` | DEPLOY adapters/status; FND mounts/migrates |
| Proposed `infra/deployment/{compose.india-private.yaml,policy.example.json,README.md}` | DEPLOY standalone reference, operational instructions and safe placeholders |
| Proposed `infra/deployment/Dockerfile.web` and shared service entrypoints | FND build artifact owner, DEPLOY tests/consumes |
| Proposed `scripts/usp/deployment-check.ts` | DEPLOY non-destructive inventory/preflight/isolated test orchestration |
| Proposed `apps/web/features/usp/deployment/DeploymentStatus.tsx` | DEPLOY leaf; UI extends actual Shell workspace dialog |
| Proposed `tests/usp-deployment.test.ts`, `tests/usp-deployment-integration.ts`, `tests/e2e/usp-deployment.spec.ts` | DEPLOY policy, real destination, scanner, launch and recovery tests |

## G. UI placement and interaction

The existing [Shell](../../apps/web/features/officer/shared/Shell.tsx) Local workspace dialog is the integration point; no assumed deployment settings page. UI extends it to show authorized profile/capability/qualification details and actionable missing configuration. Remove unconditional data-stays-here copy unless the tested profile supports it. Loading says not checked; missing service says unavailable; failed qualification blocks protected activation; successful status states exactly what was tested. No government-certified/India-only badge from a config variable. Ordinary users keep a brief manual-fallback explanation.

## H. Ownership and dependencies

Use `feat/usp-deployment`; own DEPLOY new adapters/reference/test files only. F0 policy/fixture work can run alongside local V0. F2 and accountable H3 approval are required only for protected/public activation claims. FND owns auth/shared configuration/build/legacy hooks; UI workspace mount. Technical defaults, open-source acquisition, inventory and tests are agent work; people provide permissions/actual accounts, not architecture.

## I. Implementation sequence

1. Inventory actual routes/destinations and build requirements; keep unknown entries unqualified.
2. Implement default-deny policy and local no-AI capability behavior.
3. Implement Sarvam/local/scanner/mail adapters and synthetic tests; govern legacy Nous through FND.
4. Produce and launch standalone images/entrypoints in isolated volumes; prove no duplicated dispatcher and no accidental service ingress.
5. Test F2 and all source/scene/SSR/public routes, browser egress, SSE proxy/reconnect and provider outages.
6. Restore new volumes and validate hashes/manifests/jobs/events; report environment-specific qualification separately.

## J. Dataset and operational verification

Use D0 non-personal fixtures from [H28](28-data-acquisition-and-finale-tests.md), labelled restricted for policy testing: original upload, exact property, source preview, PACK derivative and INGEST draft asset. Source data need not be truly sensitive to test denial. Add one separately released sanitized derivative and verify public access without private originals. D1/D2 external fetching is an explicit allowed acquisition task, not an unapproved runtime tile dependency; cache/preserve permitted small assets for private-mode tests.

Live provider qualification uses only bounded synthetic fields through a separately configured approved key. No key means adapter mocks plus deterministic operation, not a live Sarvam pass. Verify structured output, truncation, tool attempts, response limit, quota/timeout, missing key and model unavailable; deny the approved endpoint and assert no legacy/alternative call. No automatic credit purchase or unapproved model/funding/geography switch; only pre-authorised H20 rollover is permitted.

Scanner tests include a benign permitted test fixture, known antivirus test artifact under isolated test policy, scan-size limit, stale signatures and unavailable daemon; skipped work must never return clean. Email acknowledgement loss becomes unknown/reconciled, not claimed exactly once. Check wrong IdP audience, unguarded SSR, direct asset URLs, cached revocation, third-party browser tile request, secret-safe errors and blocked redirects. Kill a worker and interrupt restore, then resume idempotently with no duplicated records/notifications.

Run `pnpm typecheck`, `pnpm test:api`, `pnpm test:ai`, existing `pnpm platform:health`; proposed `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-deployment.test.ts`, `pnpm exec tsx tests/usp-deployment-integration.ts`, `pnpm exec playwright test tests/e2e/usp-deployment.spec.ts`, and `pnpm exec tsx scripts/usp/deployment-check.ts` only after creation and against an explicitly isolated target. Return code/pack/image/provider versions, inventory, actual calls denied/allowed, launch/restore receipts and unresolved H3 evidence. Configuration tests cannot prove residency.

**H20 is part of DEPLOY acceptance:** execute its G-01 through G-27 tests as applicable. Qualify local ledger/fake-provider behavior separately from live chat, live document billing and deployment residency. No public balance API, real key pool or permanent post-restore memory is assumed. Operator account evidence is required before funded calls, not before fixture implementation.

## K. Copy-paste assignment

> Implement DEPLOY using 00, 01 and this handoff on feat/usp-deployment. Use non-personal D0 to build default-deny policy, governed Sarvam/local adapters, hash-bound scanner and honest mail outcomes; keep no-AI local operation usable. FND owns shared config/build/auth/legacy patches and UI the existing workspace dialog. Inventory all routes/SSR/assets/browser calls, not just new model traffic. Build/test the standalone stack with correct web/dispatcher entrypoints in new isolated volumes, then run J egress/scanner/recovery tests. Actual approved service/account evidence is a separate gate; do not ask humans to code/provision by default, collect secrets in Git/chat, buy credits, claim configuration proves residency or launch/merge main without authorization.

## Z. Hardening addendum (H97)

Added 24 September 2026 by the cross-family review in [H97](97-review-findings-and-alignment.md). Where this section conflicts with text above in this file, this section wins. Task cards: [H29](29-agent-task-cards.md) DEPLOY-02 and DEPLOY-03.

### Z1. The finale build must not call non-Indian providers

The legacy officer-AI path can still send deed text and image crops to a non-Indian endpoint, while the Shell says "Your evidence stays here". In the finale build (GF0, owner FND):

- Ignore `NOUS_API_KEY` unless `ULPIN_ALLOW_NON_INDIA_PROVIDER=1` is set explicitly; the finale profile never sets it.
- Drive the Shell's data-residency copy from capability status, not a fixed sentence.
- GF-REHEARSAL asserts zero requests to non-allowlisted hosts using the egress log.

### Z2. Offline rehearsal profile `local_demo_offline`

Venue Wi-Fi is unreliable. Add a sub-profile where the gateway serves hash-matched recorded responses through the replay adapter ([H20](20-model-gateway-and-budget-pools.md) Z1), labelled on screen "replayed from rehearsal <date>". Map tiles and fonts are served locally. Recipe reuse is labelled as reuse. GF-REHEARSAL runs once with the network disabled ([H28](28-data-acquisition-and-finale-tests.md) Z5).

### Z3. Compliance mapping (demo-configured versus production-gated)

| Obligation | Finale (local demo) | FP-DEPLOY |
| --- | --- | --- |
| DPDP Act 2023 and Rules: notice, purpose, retention, erasure, grievance, breach intimation | Synthetic or consented data only; retention table documented | Processor contract with the provider, per-table retention and erasure jobs, grievance contact, breach runbook |
| CERT-In directions (28 April 2022): incident reporting within 6 hours, 180-day log retention in India, NTP sync to NIC/NPL | Not applicable to a local demo; stated as such | Required and tested |
| Retention for `usp_assist_runs` and model-call tables | 30 days in demo | Set by the approved policy |
| Fine-resolution geospatial data (own drone ortho, DSM, LiDAR) | Processed on India-located machines; agents get downsampled or synthetic samples | Same; an FP-DEPLOY prerequisite in H90, not a finale input |

### Z4. Host and Origin checks

The loopback-bound finale app validates the `Host` header against an allowlist (DNS-rebinding protection). A forged `Host` gets 403; add this to section J.
