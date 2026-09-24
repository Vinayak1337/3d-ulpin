# 20 · Sarvam gateway, credit pools and credential lifecycle

**Release boundary:** the existing gateway/no-key and cost controls support the finale where needed. Live service qualification remains distinct from documentation. Concurrent schema learning belongs to `full_product` H21; this gateway never trains or records property facts itself.

**Owner: DEPLOY, as a supporting part of [19](19-india-contained-deployment.md), not an eleventh independent USP.** FND owns shared contracts, migrations and route registration; UI owns shared settings mounts. **Decision date: 23 September 2026. Planning/code inspection base: `codex/fnd-f0-f1@97146d62d7e64c946abfc98b0d7e670845b17857`. Status: implementation plan, not installed or live-qualified.** Read [00](00-README.md), [01](01-shared-contracts-and-ownership.md), [14](14-adaptive-ingestion-and-progressive-review.md), [18](18-grounded-assistance-and-mcp.md) and [19](19-india-contained-deployment.md).

This document governs runtime Sarvam inference. [02](02-lead-agent-execution.md) separately governs the coding agents (any user-authorized client, by role tier) that write our software. Development-model usage and Sarvam API billing are different budgets.

## A. Outcome and account-aware key cycling

An operator configures approved provider connections once. Every feature then requests a bounded task through one gateway. The gateway checks permissions, selects a qualified model, reserves sufficient money, calls an eligible credential, records usage, and retires spent credentials without resurrecting them after restart.

**The credit unit is not the API key.** Sarvam's current pricing/rate-limit documentation says ₹100 introductory credit per new user. Its platform documentation says one organisation balance is shared by its workspaces, API keys and products. Account rate limits are shared across keys. Therefore ten keys from one organisation do not establish ₹1,000 or ten independent rate-limit allowances. [S1–S3]

**Project-specific clarification from the user, 23 September 2026:** each existing key intended for this project comes from a different Sarvam account, with a reported ₹100 introductory grant for each account. Use the **independent-account configuration**, normally one credential linked to each distinct organisation billing pool and account rate-limit scope. Do not default this supplied set to one shared ₹100 wallet. This records the user's setup, not a provider-confirmed balance check: exact organisation IDs, remaining credit and permitted project allocation are still enrolled through the secret-safe operator flow. Additional keys later created under an existing organisation do not add another grant.

Required behavior:

* Track spend attribution per key, but enforce affordability at the shared billing-pool level as well as local project/task limits.
* Cycle only among operator-authorized, eligible credentials/funding pools. Independent organisations need verified ownership, funding and permission for this project's data. Do not automate signup, farm promotional grants, or switch identities to bypass account throttles or suspensions.
* Once a key reaches terminal `retired`, never dispatch with it again. A temporary rate limit is a cooldown, not retirement or permission to bypass the account limit.
* When one organisation is exhausted, every key charged to it becomes unavailable for new calls. A different key on that same balance cannot fix exhaustion.

This preserves the user's automatic progression and permanent-retirement requirement without inventing money or claiming a new allowance per credential.

## B. Existing code and integration gap

At the inspected base, [ports.ts](../../packages/contracts/src/usp/ports.ts) already declares `UspModelGatewayRequestSchema`, `UspModelGatewayResultSchema` and `UspPorts.modelGateway`. Its budget currently contains only `maxInputBytes` and `deadlineMs`; its result has output/model/schema/evidence refs. These declarations do not implement pricing, reservations, credential selection or provider calls.

Reuse [common schemas](../../packages/contracts/src/usp/common.ts), [domain schemas](../../packages/contracts/src/usp/domain.ts), [commands](../../apps/web/lib/server/usp/commands.ts), [jobs](../../apps/web/lib/server/usp/jobs.ts), [migrations](../../apps/web/lib/server/usp/migrations.ts), [database](../../apps/web/lib/server/db.ts), [storage](../../apps/web/lib/server/storage.ts), [legacy AI provider](../../apps/web/lib/server/officer-ai-provider.ts), and the actual [FND interfaces](../evidence/usp/fnd/INTERFACES.md). Read current implementations before extending them. The new `usp/deployment` gateway modules below are proposed; no existing wallet implementation was established.

Do not replace the existing property/job authorities, expose arbitrary proxy endpoints, or create separate Sarvam clients in INGEST, ASSIST, CITIZEN or Python workers. All runtime provider traffic, including legacy paths, must use the governed boundary or be disabled.

## C. Scope, selected models and verified commercial facts

### Initial runtime model set

These are recommended starting profiles, not measured ULPIN model winners. Live availability and correctness remain acceptance gates.

| Task | First implementation | Price/reference and boundary |
| --- | --- | --- |
| Schema mapping / interpretation of extracted text | `sarvam-105b`, V1 chat; explicit `reasoning_effort: "low"`, `n:1`, nonstreamed structured output | ₹29.28 uncached input, ₹10.98 cached input, ₹73.20 output per million tokens. Reasoning is included in billable completion usage. [S1,S4,S5] |
| Difficult mapping exception | Same model, explicitly qualified `high` profile, within the same task's total call/money deadline | At most one additional call, only for a specific recoverable failure; absence of source semantics is `needs_input`, not a reason to keep prompting. [S5] |
| Scanned documents / Indic OCR / tables | Sarvam Vision through the documented Document Digitization/Document AI digitise workflow | Published document digitization price ₹0.50/page; maximum 10 pages per job. Confirm that exact endpoint/SKU price before enabling; do not assume every Vision or Extract endpoint has identical billing. [S1,S6] |
| Ordinary selected-property assistance | ASSIST0 deterministic facts and templates first; optional bounded `sarvam-105b` intent selection | No model call for reading an already computed fact. Free-form paraphrasing remains H18's separate gate. |
| GIS, LAS/LAZ, rasters, CityJSON | Existing/qualified deterministic parsers and specialist geometry/ML processors | No LLM reconstruction of raw coordinate arrays or binary surveys. The gateway can interpret a small source profile, not replace these processors. |

Do not use managed `sarvam-30b` or `sarvam-m`: they are deprecated. `sarvam-105b-conversations` is an available dialogue variant at the same published price, not a necessary additional mapping model. Third-party beta models served by Sarvam are not selected in this plan. Self-hosted 30B weights are a different deployment choice, not a reason to use a deprecated managed model ID. [S1,S4,S7]

### Bounded request profiles

For mapping, start with at most 24 KiB source/example text, 32 KiB final request input, 3–10 representative records plus relevant target schema, and `max_tokens=2048`. Permit a qualified exception profile up to 4096 total completion tokens; that is the currently documented Starter ceiling, not 4096 visible answer tokens plus free reasoning. Use `temperature=0.2`, leave other sampling defaults alone, disable tools, and pin model/endpoint/output-schema/prompt versions. Prefer the documented `response_format` JSON Schema support but always validate independently. [S4,S5]

The total synchronous task allowance remains **two network attempts including repair/retry, 45 seconds overall, 1 MiB response cap**, subject to stricter consumer limits. Smaller output schemas or manual clarification are better than silently truncated output. Sarvam pages disagree on the default/complete reasoning-effort enumeration; `low` and `high` are shared documented values. Send them explicitly and qualify the actual response; do not forward OpenAI `max`/`ultra` settings into Sarvam by analogy.

Document jobs are asynchronous: accept a request and return the existing `ServiceResult.pending` with our logical job ID. Do not hold a web request or SQL transaction open until OCR completes. Respect existing upload/page/pixel limits when they are smaller than the provider's. The gateway performs no training or autonomous registry writes. H21 separately allows eligible concurrent learning in the full-product release.

## D. End-to-end design

```text
INGEST / ASSIST / safe document extraction
        -> server-derived scope, purpose and evidence authorization
        -> qualified task profile and reusable-result/recipe lookup
        -> local project cap + organisation balance + key subcap checks
        -> transactional reservation and account/API admission control
        -> eligible credential -> pinned Sarvam adapter
        -> bounded response / asynchronous provider job
        -> durable usage settlement even if output is rejected
        -> schema and domain validation -> current job-fence/access checks
        -> accepted proposal/facts or explicit unavailable/needs-input
        -> existing job/outbox -> UI status; no geometry from token fragments
```

No-AI/manual mapping and ASSIST0 remain usable with zero credentials. API keys are supplied through a server secret mechanism, never committed or sent through browser configuration. No live provider call is authorized merely by this documentation change.

## E. Detailed contracts and failure behavior

### E1. Separate organisation, rate-limit group and credential

Use the existing PostgreSQL pool. Proposed feature-owned metadata tables:

| Record | Required information |
| --- | --- |
| `usp_deployment_billing_pools` | Provider organisation/account identifier, approved owner/workspaces/data classes, allowance evidence, verified opening balance, approved local allocation, balance observation time, external-spend uncertainty, funding epoch, state/version. |
| `usp_deployment_credentials` | Opaque ID, provider/workspace/billing-pool/rate-limit-scope IDs, secret reference, stable keyed fingerprint, capability qualification, priority, optional local subcap, state/version, retired reason/time. No plaintext key. |
| `usp_deployment_rate_limits` | Shared provider account/API scope, configured/observed limits, next admissible time, cooldown/circuit state; persists across process restarts. |
| `usp_deployment_model_calls` | Logical call ID, attempt ID/fence, input/evidence/policy/profile/price hashes, credential/pool, reserved/actual/uncertain cost, provider request/job ID, status, finish reason, timestamp and semantic outcome. |
| `usp_deployment_budget_entries` | Append-only reserve, settle, release, conservative-unknown, approved-adjustment entries; exact money and linkage to the call. |
| `usp_deployment_price_versions` | Provider/model/endpoint SKU, currency, meter definitions, rates, effective/verified dates, source URL, status and approval. |
| `usp_deployment_credential_events` | Append-only activation, draining, retirement, revocation, balance reconciliation and policy events. Unique terminal tombstone keyed by provider + stable credential fingerprint. |

A key's creator is not its billing identity. Operator-provided organisation/workspace metadata must be checked against authorised dashboard/account evidence; do not discover it by guessing from the key string. Unknown pool membership stays unqualified. Several aliases for the same organisation must collapse to the same unique pool. Several secret names with identical key bytes must collapse to one credential/tombstone.

For this project's enrollment, prepare one connection entry per supplied account: opaque account label, actual organisation/workspace IDs, secret reference, distinct billing-pool/rate-scope identity, reported grant amount and provenance, observed remaining balance/time, approved allocation, priority and allowed data/purposes. Mark the ₹100 grant as `user_reported` until evidence is recorded; do not initialize remaining credit from the grant or key count. Preserve balances already consumed elsewhere. If two entries resolve to the same organisation, collapse their funding identity instead of duplicating funds. Distinct verified organisations retain independent ledgers; a missing balance/approval disables that entry, not other qualified entries. Do not ask again whether the user's keys are from different accounts; request only genuinely missing enrollment fields.

Use a stable HMAC fingerprint with a separately protected installation secret; never display the fingerprint as the API key. Preserve its key version and historical fingerprint matching across rotation. Missing fingerprint/retirement state fails closed. Logging may show opaque credential labels, not key fragments or full prompts.

### E2. One-way credential progression

Credential lifecycle:

```text
unqualified -> standby -> active -> draining -> retired
                         |-> cooldown -> active
                         |-> disabled / invalid / revoked
```

`retired`, confirmed `invalid`, and `revoked` are terminal for that exact credential fingerprint. `disabled` is an operator pause, not a retired key. `cooldown` is a retryable health/rate event, not a completed cycle. Only the first documented activation transitions are automatic after prior qualification.

When a local key cap or pool threshold would be crossed, stop new inference admission, mark the credential `draining`, and select the next eligible approved option. Existing admitted work settles normally. For Vision, draining may perform only bounded status/result retrieval of already accepted jobs under their pinned credential/workspace; it cannot start another job. Finalize the cycle and mark `retired` only after those jobs terminate or are explicitly abandoned/reconciled. **After terminal retirement there are zero new provider requests using that key, including health probes.** Settlement of a late local response is allowed but does not reactivate it.

**Configured rollover for the supplied independent accounts:** use a stable operator-approved order (priority, then opaque connection ID), keep the current eligible pool until its affordability/threshold rule closes new admission, then advance to the next qualified pool permitted for that task and data. Persist the active selection and its version alongside the existing route policy/selection state; coordinate selection changes with E3's locked reservation so concurrent workers cannot independently reset or wrap the list. Approval of the pool list authorizes routine threshold rollover without another user prompt at each switch; it does not authorize new accounts, new funding or a different processing boundary. This is ordered progression, not per-request round-robin. If all eligible pools are exhausted, draining, retired, unqualified or otherwise unavailable, return the explicit no-funding/capability state and preserve manual work. Do not revisit terminal credentials. A transient 429 or ambiguous potentially charged request never triggers this budget rollover.

Do not automatically revoke keys at Sarvam; they may serve another authorized application. Our terminal state is an enforced local dispatch denylist. Security revocation immediately stops all dispatch and follows operator-approved provider revocation procedures separately.

A top-up does not revive retired keys in this project's permanent-retirement mode. It requires an approved new funding epoch and a different, newly enrolled credential. The new key still shares its actual organisation's balance. No duplicate ₹100 grant, automatic recharge, deletion/reimport reset, midnight reset or restart reset.

### E3. Money, reservations and reconciliation

Store amounts as **integer micro-INR (1 rupee = 1,000,000 micro-INR)** in BIGINT/decimal-string wire fields. Use checked BigInt/decimal arithmetic; reject negative, nonfinite or overflowing amounts. Do not round every small call down to zero paise. Version all price calculations.

For chat, with `P` prompt tokens, `K` explicitly reported cached prompt tokens and `O` total billable completion tokens:

```text
costINR = ((P-K)*29.28 + K*10.98 + O*73.20) / 1,000,000
```

Reasoning already included in `O` must not be added again. If cache breakdown is absent, price all prompt tokens uncached. An impossible count or unknown meter becomes `usage_unverified`, not zero cost. For digitization, reserve the full submitted page count at the qualified SKU rate; settle using the documented chargeable measure. Do not assume failed/partial requests, polls, or downloads are unbilled without verified provider semantics.

Before dispatch, compute a conservative reservation `R` from the final assembled request and maximum output/page count. Prefer a qualified matching tokenizer; otherwise use a tested byte-based upper bound including serialization/system/schema overhead, not a casual characters-divided-by-four estimate. Apply the project's configurable cost cushion, initially 20%; cache hits are not assumed. If a bounded upper estimate cannot be established, do not dispatch automatically.

Admission enforces all applicable caps: organisation funding allocation, project total, batch/task total, optional credential subcap and the shared provider rate budget. `availableLocal = approvedAllocation - settledSpend - outstandingReservations - unresolvedExposure`. Provider balance snapshots impose an additional conservative ceiling after subtracting post-snapshot/local-unreconciled exposure and external-spend allowance. Never count the same settled debit twice as both settled and reserved; conservative ambiguous exposure can intentionally remain deducted until reconciliation. Do not infer that requests outside this gateway did not consume the wallet.

Defaults for a **verified ₹100 available allocation only**: warn at 80%, soft-close new work at 90%, and preserve at least ₹5 headroom. Admit a call only when both the soft ceiling and remaining headroom permit `R`. These are configurable local controls, not Sarvam's own per-key budgets. Do not initialise every credential or a previously used account with ₹100. Illustrative known-balance example: at ₹89.90 settled and no outstanding calls, a ₹0.30 reservation exceeds the ₹90 soft ceiling and is not dispatched on that pool.

Use a short SQL transaction to lock applicable budget/credential rows in a fixed order, check the complete reservation, and create an attempt. Commit before the network call. On completion, another short transaction settles usage once, retains safe receipt metadata, transitions the credential if needed, and appends an event. Concurrent callers must not each spend the same last rupee. If actual charges exceed the reservation, record the actual debit/deficit, suspend the affected pool and require reconciliation; never clamp the invoice to the estimate.

**Provider balance is not our estimate.** No authenticated public balance/usage-read endpoint was established in this planning research. Implement `BalanceReader` as `available` only when an officially documented, permitted interface is actually qualified. Until then, support timestamped manual dashboard observations and approved budget allocations; no dashboard scraping, guessed `/balance` endpoint or fake live percentage. Default automatic mode to gateway-exclusive funding, or explicitly reserve for known external usage. With shared outside spending and no trustworthy balance observation, show unknown headroom and require a refreshed observation/allocation before new paid work. A stale observation alone cannot prove affordability.

A newer observation must record its inclusion/reconciliation boundary so already-accounted calls are not credited or deducted twice. Lower provider balances clamp headroom immediately. Higher balances never automatically authorize more spending. Price changes or ambiguous billing semantics suspend the affected profile until reviewed; old calls retain old price versions. Refunds/top-ups are explicit immutable adjustments, not silent counter resets.

### E4. Request identity, crashes and retries

Deduplicate the logical invocation by server-derived subject, exact scope/evidence/input/prompt/profile/policy and purpose plus request key. Each network attempt gets its own ID and reservation. A completed same-payload retry returns its stored, reauthorized result; a changed payload conflicts. Provider request IDs are evidence, not proof the provider honours our idempotency header.

If failure is proven before dispatch, release the reservation. Once bytes may have reached the provider, a timeout, connection loss, cancellation or process death leaves `outcome_unknown` with conservative cost exposure. Do not release it just because the job lease expired. Reconcile a known provider job, or retain the exposure and pause for resolution. There is no promise of exactly-once provider charging. Do not blindly repeat a possibly accepted request on the next key.

All SDK retries are disabled or counted by this gateway's single attempt budget. A retry needs sufficient task deadline, shared rate allowance and an additional reservation. At most two network attempts per synchronous task includes transport retries and model repair together; it is not two of each per credential. Schema repair after a complete invalid response may use the single remaining attempt. Unsupported semantics or absent source units go to clarification instead.

Billing settlement and domain acceptance are independent. Even a late, cancelled, malformed or disallowed result can have incurred a charge; settle it, but only current authorised job fences may publish accepted facts. Stored completion does not grant current access to its evidence.

### E5. Error classification and account limits

Classify by endpoint/version, structured provider error code and HTTP status, not status alone. The general error guide lists exhausted credit as `429 insufficient_quota_error`, while the platform FAQ also describes `402` on exhausted organisation credit. Support both qualified forms; a bare unknown 429 is never proof of permanent exhaustion. [S2,S3,S8]

| Observation | Required behavior |
| --- | --- |
| 402 / documented insufficient-credit code | Block the entire billing pool for new work; drain/retire its participating keys under this policy; never try another key on the same balance. An independently funded approved pool may accept a subsequent safely classified request. |
| 429 `rate_limit_exceeded_error` | Shared account/API cooldown; honour Retry-After and pacing. Do not retire keys or cycle them to evade the throttle. |
| 403 `invalid_api_key_error` | Mark exact credential invalid; no blind retry. An already authorised alternate credential may be selected only after error scope is clear. |
| Other 403 / workspace or model denial | Capability/policy failure; do not label credit exhausted or transfer documents to an unrelated organisation. |
| 400/413/422 unsupported input/schema | Correct the caller/profile or return unsupported; no credential rotation. |
| 500/503/transient outage | Circuit breaker with bounded backoff; unknown processing/charge exposure remains accounted. Changing keys does not fix a provider outage. |
| 200 with missing/truncated/invalid output | Account usage, reject semantic output; one bounded repair if safe and budgeted. Do not accept partial JSON. |
| Missing usage, unknown price or wallet state | Conservative exposure plus `usage_unverified`/`budget_unverified`; do not report free success or refill the pool. |

Initial documented limits are 40 requests/minute for Starter Sarvam 105B and 10/minute for document intelligence; actual dashboard limits may be lower or change. [S2] Start with one chat request in flight and one document job admission in flight, pacing below the configured aggregate cap. Count polling and any other endpoints in the appropriate shared limiter. Use at least the slower of the provider guidance and our aggregate pacing; a six-plus-second aggregate interval is needed for a 10/minute shared bucket, not one fast poll loop per worker. No independent unlimited limiter per key/process. Persist cooldown/admission state, or use Redis atomically only with a defined fail-closed restart/reconstruction policy.

### E6. Document jobs, data boundary and output safety

Use the currently documented Sarvam digitise lifecycle/SDK or verified REST reference; pin it before implementation. Do not assume `sarvam-vision` is a V1 chat-completion model or reuse an old legacy document endpoint's fields. Provider documentation names `language` and `output_format: "md"|"html"` for digitise; keep Extract's schema/output requirements separate. [S6,S9]

For documents longer than ten pages, create bounded derivative batches with exact original SHA, original page numbers, crop/rotation mapping and revision provenance. Preserve the original untouched. Deduplicate child jobs by exact source rendition/page set/profile/purpose, not filename. Retain provider job IDs durably; poll/download only through the original approved organisation/workspace. A replacement key is valid for an existing job only if provider access semantics and our policy explicitly allow it. Partial success preserves completed page outputs and marks missing pages; it cannot become a complete property packet.

Treat returned Markdown/HTML, ZIP paths, filenames, URLs and JSON as untrusted. Use PACK's process-isolated page handling, safe HTML rendering, bounded extraction/decompression and storage allowlists. Provider-issued signed download URLs require a qualified host/redirect rule, no credential forwarding, size caps and current authorisation; never fetch a model-authored URL. If a required download destination violates India-private policy, leave the capability unavailable rather than silently exporting data.

Only authorised minimal evidence is sent. Prompt-injection text cannot alter routes, model/profile, keys, wallets, retry limits or permissions. Provider calls never decide rights, apply generated code, change geometry directly or issue official identifiers. Hash/schema/source checks and feature-specific validation remain mandatory.

India-private qualification includes actual hosting, logs, backups, retention and model-training settings. Sarvam's trust-centre claim is vendor context, not proof of our full system. Hugging Face/ZeroGPU is a separately labelled external-demo endpoint and cannot be selected by India-private policy. No fallback to external GPT models for runtime property processing in this plan. [S10]

### E7. Shared API shape and settings

FND evolves the **existing** `UspModelGatewayRequestSchema`/result and ports; it does not add a competing gateway. Use a versioned optional execution envelope or qualified wrapper so existing callers do not break. Server policy resolves `taskProfileId`, invocation ID, permitted provider route, total money/token/page/call caps and approved candidate pools. Client-supplied provider/key/org/role/price/rate overrides are rejected.

The existing `ServiceResult` states remain: available output, pending logical job, not-assessed or unavailable with safe reason codes. Add a compatible sanitised `ModelCallReceipt` reference to accepted output/job metadata: profile/model/version, prompt/schema/evidence hashes, price version, usage quality, semantic result, charged/reserved money, latency and retry count. Do not return credential fingerprints or organisation balances to ordinary property users. Keep full usage evidence restricted; do not persist raw reasoning or complete private prompts by default.

Operator-only proposed routes under `/api/v1/usp/deployment/ai`: read settings/capabilities, register a **secret reference**, set versioned profiles/budgets, retire a credential, record balance observations, inspect paginated ledger/retirement history and resume only eligible funding. FND mounts strict handlers. Mutations use existing guards, audit and deployment permissions; add narrowly scoped `deployment.configure` and `deployment.billing.inspect` only through FND. No unauthenticated arbitrary proxy, public key tester, generic secret browser or browser-readable key list.

## F. Exact implementation ownership

| Existing or proposed path | Owner / work |
| --- | --- |
| Existing `packages/contracts/src/usp/{ports,domain,common,index}.ts` | FND evolves shared gateway/receipt compatibility and producer/consumer tests. |
| Existing `apps/web/lib/server/usp/{commands,jobs,migrations,principal}.ts`, shared config/route mounts | FND supplies transaction/fence/access/migration integration, without broad rewrites. |
| Proposed `packages/contracts/src/usp/model-gateway.ts` | DEPLOY policy/profile/price/credential/usage DTOs; no import cycle into common. |
| Proposed `apps/web/lib/server/usp/deployment/{model-gateway,policy,capabilities,credentials,budgets,usage,rate-limits,reconciliation}.ts` | DEPLOY gateway and persistent accounting/retirement; one network owner. |
| Proposed `apps/web/lib/server/usp/deployment/providers/{sarvam-chat,sarvam-documents}.ts` | DEPLOY pinned protocol/error/usage adapters, no feature-specific clients. |
| Proposed `apps/web/lib/server/usp/deployment/migrations/20-model-gateway.ts` | DEPLOY additive tables/indices; FND registers via actual migration mechanism. |
| Existing `apps/web/lib/server/officer-ai-provider.ts` | FND routes or disables legacy external calls through policy; do not leave a bypass. |
| Proposed `apps/web/features/usp/deployment/AiProviderSettings.tsx` | DEPLOY leaf content; UI mounts in Shell's workspace dialog, not another permanent dashboard. |
| Proposed `tests/usp-model-gateway.test.ts`, `tests/usp-model-budget-integration.ts`, `tests/usp-model-gateway-recovery.ts`, `tests/e2e/usp-ai-settings.spec.ts` | DEPLOY/FND tests; DATA contributes source/oracle fixtures under existing ownership. |
| Proposed `scripts/usp/verify-model-gateway.ts` | Bounded synthetic live qualifier; network/key/budget explicitly opt-in; never auto-top-up. |

Only implement the paths needed by the next gate. Prefer a few cohesive modules over an unused generic provider framework. Initial support is one chat adapter plus the separately qualified document adapter; extensibility means a typed interface, not integrating every vendor.

## G. Operator and user experience

Workspace → AI processing → show provider/model per task, local allocation, spend/reserved/uncertain amounts, last provider-balance observation, shared pool membership, safe key label/state and retirement reason. Estimated versus verified values must be visibly distinct. Editing a key alias or rearranging the list cannot reset its identity or spend.

The operator sees `Retired permanently — local budget threshold`, `Account funds unavailable`, `Cooling down until …`, `Unverified balance`, or `Model unavailable`, not a generic green connection badge. Credentials draining existing document jobs have a separate label. No View key action. Retired credentials have no reactivate control.

Ordinary users see only `AI temporarily unavailable — continue with saved mapping/manual review`, current safe progress and a retry opportunity when appropriate. No account IDs, balances or provider error bodies. A failed provider does not erase a draft, reset upload progress or fabricate a completed review.

## H. Gates and dependencies

**G0:** deterministic policy/cost/selection tests and no-key fallback. **G1:** actual PostgreSQL reservation/concurrency/retirement/restart integration with a local fake provider. **G2-chat:** bounded synthetic Sarvam chat qualification with operator-supplied credentials and confirmed funding. **G2-doc:** separate document endpoint, page billing and restart qualification. **G3:** deployment-mode/security/account approval. These refine DEPLOY0/1/2; none delays existing local V0 or ASSIST0.

The user supplied the account topology and reported ₹100 grant per account, not secret values or live balance evidence. No credentials were inspected; no real balance, endpoint compatibility, billing reconciliation or runtime quality is claimed passed. H90 contains the narrow account-owner prerequisites; agents implement everything else and exercise mocks/fixtures while those prerequisites are unavailable.

## I. Build sequence

1. Inventory current model call sites; define compatible task profiles, local caps and permitted data. Prove no-key/manual behavior.
2. Add exact money/price versions, pool/credential identity, append-only ledger and retirement tombstones. Test fake responses before any live key.
3. Connect one V1 chat adapter; disable hidden SDK retries. Complete local simultaneous-request, timeout, crash, drift and revocation tests.
4. Integrate INGEST's mapping proposal/recipe reuse and ASSIST's typed facts through the same gateway. H21 separately schedules eligible training batches in the full-product release; gateway calls are not a training trigger.
5. Mount operator settings/history with actual persisted values, then qualify one synthetic live call with an explicit small allocation.
6. Add the asynchronous document path and page billing only when its precise endpoint/SKU is confirmed. Qualify G2-doc separately.
7. Run approved multi-pool rollover and terminal retirement using fake credentials first, then only legitimately funded approved live pools. Qualify restoration and full egress separately.

## J. Test packs and acceptance

Use D0 non-personal metadata and a controlled fake Sarvam server with deterministic request/charge logs. D3 supplies real attribute layouts, D4 a preserved source row; D5 documents are permitted real-source follow-up, not a prerequisite. Use independent expected outputs, no generated answer as its own truth. Record vendor/live tests separately from simulated errors.

| ID | Required test / observable result |
| --- | --- |
| G-01 | Three keys in one organisation share one ₹100 allocation, not ₹300; two differently named aliases of that pool still share the same ledger. |
| G-02 | Two callers near the cap: row locking admits only affordable reservations. Crash/retry cannot spend the last amount twice. |
| G-03 | Same key re-added under another secret name remains terminal after retirement. Process restart and configuration reload do not revive it. |
| G-04 | 429 rate limit pauses the shared account bucket; no credential cycling, no permanent retirement. |
| G-05 | 402 and 429 insufficient quota block all keys on that pool; separate authorised funding can advance, same-wallet keys cannot. |
| G-06 | 403 invalid key versus generic forbidden/model denial have different effects; no endless pool traversal or cross-tenant fallback. |
| G-07 | Below-threshold remaining funds still reject a call whose worst-case reservation crosses the soft ceiling. |
| G-08 | 2,000 uncached input + 1,000 completion tokens cost ₹0.13176; all cached input costs ₹0.09516; 10 digitised pages cost ₹5 at the selected qualified SKU. Use exact micro-INR. |
| G-09 | Reasoning tokens already included in completion are counted once; absent cached breakdown uses uncached price; malformed/missing usage is not zero. |
| G-10 | Timeout after provider acceptance retains unknown exposure; retry on another key does not silently duplicate a possibly charged job. |
| G-11 | Definite pre-dispatch rejection releases reserve; duplicate settlement callback settles once; actual charge above reserve records deficit and suspends dispatch. |
| G-12 | Failed schema/finish_reason:length still costs money and uses the same total two-attempt budget. An empty answer is not accepted. |
| G-13 | Cancelled/stale worker cannot publish results, but charged usage is settled; no lease-expiry refund assumption. |
| G-14 | Price version changes retain historical arithmetic; external spending lowers available funds; top-up does not automatically expand local caps or revive retired keys. |
| G-15 | Async document survives restart without resubmission; 11-page input uses safe bounded derivatives with correct original page mapping; partial output stays partial. |
| G-16 | Draining key may finish only its admitted jobs; terminal retired key makes zero calls, including health/poll/download. Unqualified cross-workspace job lookup is denied. |
| G-17 | Source injection cannot choose credential/model/URL, modify budget or run code. Cache cannot disclose another user's evidence after revocation. |
| G-18 | India-private mode denies external-demo endpoints and unapproved signed-download hosts. Missing model/key preserves manual workflows. |
| G-19 | SQL unavailable, lost tombstone state or unknown wallet mapping fails closed for paid dispatch; no in-memory zero-budget fallback. |
| G-20 | Restore an older DB with current key configuration: startup requires reconciliation of retirement/usage state before paid calls; no old snapshot resurrects keys. |
| G-21 | Rate pacing across two processes and multiple polling jobs stays within the shared cap; fake clock and Retry-After exercise expiry without slow sleeps. |
| G-22 | Billing and settings routes enforce permissions/version/CSRF rules; response, logs, errors, screenshots and browser bundles reveal no secret. |
| G-23 | Changing policy mid-job prevents an unapproved next call; a denied result cannot be surfaced from cache. |
| G-24 | Demonstrate actual D0 mapping → qualified recipe → subsequent batch conversion without repeated inference, plus D4 literal field preservation. No invented height/CRS/owner. |
| G-25 | Supplied topology: three distinct account/organisation fixtures, one key each, each with a verified unused ₹100 allocation, retain three independent ledgers (₹300 gross allocated, before per-pool headroom and project caps). Spend on A does not debit B/C. Same-organisation aliases still follow G-01. |
| G-26 | A reports a ₹100 signup grant but its observed remaining balance is ₹64: admit against only the approved remainder, never refill it to ₹100. Unverified B remains ineligible while qualified C can operate within its own permissions; account count is not spend authority. |
| G-27 | Ordered A → B → C rollover at the reservation-aware soft ceiling survives concurrent callers, restart and reordered config. A drains only admitted jobs and becomes terminal; later admission never wraps to A. Exhausting the final eligible pool gives unavailable/manual fallback, not reset, top-up or another signup. |

For G-20, a standalone old database cannot prove later retirements never happened. Restore must be disabled for paid calls until a current append-only retirement/usage backup or operator-verified reconciliation is available. Restore the stable fingerprint secret securely; absence blocks dispatch. Do not pretend an old snapshot alone provides a globally permanent memory.

Run existing `pnpm typecheck` and `pnpm test:ai`, then create and execute the listed tests using existing tsx/Playwright runners, for example `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-model-gateway.test.ts` and `pnpm exec tsx tests/usp-model-budget-integration.ts`. Integration uses an explicitly isolated database and fake provider, not the user's live wallet. Run `scripts/usp/verify-model-gateway.ts` only after implementation with explicit opt-in and a small approved synthetic budget. Return code/price/config/pack hashes, request counts, ledger rows, retirement proofs and exact executed commands. No live key means G2 stays unqualified.

## K. Copy-paste DEPLOY assignment

> Implement the H20 portion of DEPLOY using 00, 01, 19 and this A–K specification on an isolated branch based on current integration code. Reuse the existing modelGateway port and FND SQL/jobs; implement Sarvam 105B V1 first, then separately qualified Vision document digitisation. Build shared organisation balances, per-key attribution, exact reservation/usage accounting, account-wide throttles, one-way terminal credential retirement, crash reconciliation and permission-safe operator settings. Use D0/fake-provider tests before live calls; acquire D3/D4 only as prescribed. Use the user's confirmed separate-account setup: one existing key per independently funded account, with a reported ₹100 grant each, ordered threshold rollover and persistent retirement. Verify actual organisation identity, remaining balances and permitted allocations; the grant is not a fresh per-key allowance. No promo farming, rate-limit evasion, secret commits, automatic recharge, invented balance endpoint, direct registry writes or unapproved provider fallback. FND owns shared contracts/migrations/mounts, UI shared surfaces and DATA fixtures. Run J, return actual evidence, and leave unavailable external qualifications explicit while completing unaffected work.

## Primary references checked for this plan

Vendor facts below were checked on 23 September 2026; implementations must pin and recheck the exact endpoint/version. These links are not evidence of this installation's live qualification.

* **S1:** [Sarvam pricing](https://docs.sarvam.ai/api/getting-started/pricing) — 105B token rates, signup credit and digitisation price.
* **S2:** [Credits and rate limits](https://docs.sarvam.ai/api/getting-started/ratelimits) — account-wide limits and initial per-API ceilings.
* **S3:** [Organisations/workspaces](https://docs.sarvam.ai/api/platform/organisations-and-workspaces), [billing](https://docs.sarvam.ai/api/platform/billing), [platform FAQ](https://docs.sarvam.ai/api/platform/faq) — shared organisation funding, no native per-key budget, account settings.
* **S4:** [105B model](https://docs.sarvam.ai/api/getting-started/models/sarvam-105b), [V1 endpoint](https://docs.sarvam.ai/api-reference/chat/chat-completions-v1) — model, schema and usage fields.
* **S5:** [Chat overview](https://docs.sarvam.ai/api/api-guides-tutorials/chat-completion/overview), [thinking-level guide](https://docs.sarvam.ai/api/api-guides-tutorials/chat-completion/how-to/adjust-the-models-thinking-level) — reasoning/output budget; defaults differ across pages, so qualify explicit values.
* **S6:** [Vision](https://docs.sarvam.ai/api/getting-started/models/sarvam-vision) — document role, page limit and asynchronous lifecycle.
* **S7:** [Managed 30B deprecation](https://docs.sarvam.ai/api/getting-started/models/sarvam-30b).
* **S8:** [Error guide](https://docs.sarvam.ai/api/getting-started/errors-troubleshooting) and S3 FAQ — endpoint-specific 402/429 exhaustion and auth/error distinctions.
* **S9:** [Sarvam integration reference](https://docs.sarvam.ai/api-reference/metaprompt) — current SDK/Document AI field cautions; follow exact endpoint specification over illustrative snippets.
* **S10:** [Sarvam trust centre](https://www.sarvam.ai/trust-center); application-wide boundary requirements remain in H19.

## Z. Hardening addendum (H97)

Added 24 September 2026 by the cross-family review in [H97](97-review-findings-and-alignment.md). Where this section conflicts with text above in this file, this section wins. Task card: [H29](29-agent-task-cards.md) DEPLOY-01.

### Z1. Finale subset `R-MODEL-CORE` (GF2)

This file specifies a full multi-pool ledger for FP-DEPLOY. The finale needs a handful of mapping calls, so GF2 builds only this subset:

- One provider key read from the `ULPIN_PROVIDER_KEY_<LABEL>` environment namespace (or `/run/secrets/`). A secret reference outside that namespace, or any `NEXT_PUBLIC_*` name, is rejected with 422; registering `DATABASE_URL` or `S3_SECRET_KEY` as a provider key is a test case.
- One `usp_model_calls` table with reserve and settle, a hard project cap, and 402/429 classification.
- A per-consumer allocation so assistance can never starve ingestion (for example INGEST reserves at least 70 % of the project cap), plus a daily call cap per principal.
- A `ProviderAdapter` interface (`propose(request) → structured result | typed error`) with three implementations: the selected Sarvam adapter, a fake adapter for tests, and a **replay** adapter for the offline rehearsal profile ([H19](19-india-contained-deployment.md) Z2). Sarvam is the selected adapter behind a provider-neutral interface, not an architectural dependency.
- A prompt minimiser before every call, using the shared redaction module ([H01](01-shared-contracts-and-ownership.md) Z1). Assistance prompts carry only the question plus a catalogue of fact IDs and kinds.
- Finale tests from section J: G-04, G-05 (single pool), G-08, G-09, G-12, G-17, G-18, G-19 and G-22, plus the GF-AGENT cases in [H28](28-data-acquisition-and-finale-tests.md) Z2. Everything else in section J is FP-DEPLOY.

Prices in formulas are fixtures (`price_versions`), not constants in code. The baseline for this file is the current staging head named in `release-plan.json`.

### Z2. Promotional credit pools

The finale default is one budget pool with rollover off, so no human input is needed. Before a second or third account's credit ever becomes eligible for rollover (FP-DEPLOY), record a distinct `accountHolder` (a team member) and a `termsPoolingCheck` citing the provider clause that permits it. Otherwise treat all keys as one project budget. Never show rollover on stage.
