# 18 · Grounded property assistance and optional public MCP

**Release: `full_product` (FP-ASSIST).** Conversational assistance/MCP is deferred beyond the finale. Existing deterministic source-linked explanations may be reused without claiming a deployed agent or MCP server. The finale ingestion agent follows H14/H27 and cannot publish registry facts.

**Provider-plan update, 23 September 2026:** [20 - Sarvam gateway, credit pools and permanent credential retirement](20-model-gateway-and-budget-pools.md) is required for this feature's model integration. Use [02 - Astra Max lead and explicit worker delegation](02-lead-agent-execution.md) for development-worker selection. These instructions do not claim a live provider, funded account or passing new tests.

Owner **ASSIST**. Baseline `f623cff897f91bb3ebd4c225f700ac263f7beb72`; revised 22 September 2026. Read [00](00-README.md), [01](01-shared-contracts-and-ownership.md), gateway in [19](19-india-contained-deployment.md) and [99](99-ui-ux-and-integration.md). ER-15/21/22/25 are incorporated. New paths below are implementation tasks, not available functionality.

## A. User outcome and product value

Allow an authorized user to ask why an exact property has a finding, what evidence is missing, or what happened to their submission, then open the actual evidence or next screen. MCP is an optional access channel over the same bounded services, not the main USP. A source-linked explanation must communicate the service's real result, not merely look convincing because it has citations.

## B. Current implementation and gap analysis

[Nous extraction](../../apps/web/lib/server/officer-ai-provider.ts), [validation](../../apps/web/lib/server/officer-ai-validation.ts) and [grounding tests](../../tests/ai-extraction/grounding.test.ts) provide precedents for constrained extraction. They are not a conversational agent or MCP server. [Internal resolver](../../apps/web/lib/server/area-resolver.ts) has synchronization side effects and cannot be exposed as an unrestricted read tool. Use FND's read-only projections and enabled feature ports.

Implement strict tool schemas, typed fact assembly, exact citations, scope/permission isolation and a native useful answer flow. Citation-ID membership alone cannot establish that generated prose correctly describes the cited evidence; the first release therefore uses the deterministic fact-rendering contract below.

## C. Scope and non-goals

ASSIST0: native local read-only tools and deterministic answers from real F1 service facts; no model or F2 required for this local path. ASSIST1: optional bounded model routing and separately evaluated paraphrasing through the permitted gateway. ASSIST-MCP: public-projection-only remote server, disabled until F2/DEPLOY and released-data qualification. A private native contributor session still requires its real authentication boundary; local fixture identities do not qualify public accounts.

No SQL, arbitrary URL fetch, filesystem access, whole-database queries, ownership decisions, autonomous registry writes or hidden creation of packets/comparison jobs. Read tools return native action links; the user performs write confirmation in the existing interface. General chat, voice, model training and custom ChatGPT map widgets are optional later work. No private records returned to external ChatGPT in India-private mode.

## D. HLD and end-to-end flow

Ask about selected property → server derives principal and validates selection → bounded intent/target resolution → authorized read tool → typed service facts with exact manifest/citations → deterministic answer blocks → exact evidence/next-action link. Optional model may choose an allowed intent or fact IDs, but cannot author arbitrary authoritative measurements/status. Remote MCP uses the same executor with a narrower released-only tool registry.

A scope-changing question resolves a new target explicitly. Ambiguous identifiers produce choices; they do not silently select the first match. Old conversation context cannot preserve a revoked grant or overwrite current selection.

## E. Targeted LLD

### Tool contracts and availability

All tools receive RequestContext from the server and validated arguments. Results contain ServiceResult state, exact target/manifest pins, bounded facts, limitations and safe native actions. No caller/model role string confers authority.

| Tool | Required source / outcome | First-release audience |
| --- | --- | --- |
| `search_public_properties` | CITIZEN released query → at most 20 public matches | Native public and remote public MCP |
| `get_public_property` | Active released projection → approved summary/ref | Native public and remote public MCP |
| `explain_public_status` | Released reason codes → deterministic status explanation | Native public and remote public MCP |
| `get_my_submission_status` | CITIZEN own-submission version → exact status/required evidence | Authenticated native/private only |
| `get_property_readiness` | READY target/task/manifest → requirements, reasons and available action | Scoped native/private only |
| `explain_finding` | FIND result/case/manifest → measurement, coverage, uncertainty and evidence | Scoped native/private only |
| `compare_property_revisions` | Existing HISTORY comparison ID and its two manifests → retained result | Scoped native/private only; no hidden new job |
| `get_packet_options` | PACK target projection → capability/prerequisites/native action | Scoped native/private only; no packet generation or unrestricted signed token |

A missing producer is not_assessed/unavailable and the tool is not advertised as working. Public tools never fall back to internal dossiers or the mutating resolver. A released derivative may be readable under its ReleaseDecision without access to its private original, but only its approved output facts may be returned. Revoked releases are unavailable on the next call.

### Typed facts and factual correctness

Proposed `Fact` union: measurement `{factId,target,manifest,quantityDefinition,value,unit,method,evidenceRefs}`, status `{factId,target,manifest,state,reasonCodes,coverage}`, source_assertion `{factId,target,sourcePart,exactQuote,reviewState}`, and action `{actionKind,target,routeTemplate,arguments}`. Only actual service responses create these objects. Schema rejects non-finite values, incompatible units and invented pointers. Source quotes are bounded extracts, not authoritative interpretations.

`Answer` contains resolved scope, intent, ordered fact IDs, deterministic explanation template IDs, limitations and permitted action IDs. Templates render measurements/status/negation directly from the Fact union. The model may suggest ordering/intent within the allowlist; it cannot replace 20 m³ with 200 m³, turn not_assessed into clear, change the subject or manufacture a page citation. Unsupported intent returns a useful native navigation alternative, not background model knowledge about the property.

Optional free-form paraphrase is a separately disabled capability until evaluation covers entailment, negation, unit conversion, subject swaps, partial coverage and unknown states. A second model's approval is not proof. Keep typed factual blocks authoritative and label any optional explanatory text appropriately. A wrong-but-cited sentence fails acceptance even when its citation exists. Source/definition conflicts must be displayed, not reconciled by a language model without evidence.

Sources, filenames, clauses, tool output text and previous assistant turns are untrusted data. They cannot change tool instructions or permissions. Validate every argument/result, reauthorize every tool call and reject tool names not in the current registry. No model-generated URL is fetched. Routes are built from allowlisted templates and server-validated refs; opening evidence rechecks permissions.

### Limits, state and API

Default request profile: 1,000 question characters, six tool reads, 20 results/read, 24 KiB total evidence text, at most two model calls including one repair, and 45-second overall budget. Lower provider limits prevail. Model failure or budget exhaustion falls back to deterministic available facts and native links, never another unapproved provider. Cancellation stops further model/tool work and does not modify records.

Keep bounded server-side conversation context keyed by subject, selection generation, access view and policy version. Target/entitlement change invalidates incompatible evidence. Minimal proposed `usp_assist_runs`/`usp_assist_feedback` records contain request/manifest/tool/version/outcome metadata, not full transcripts by default. Feedback does not automatically authorize model training. Do not log raw deeds, tokens, prompts or private source text.

Proposed `/api/v1/usp/assistance/query` accepts question, selected context and optional bounded conversation reference. `/capabilities` returns actually enabled tools. `executeTool(ctx,name,args)` is the shared executor. Query does not mutate domain records; audit metadata is separate and must not create hidden packets, proposals or comparison jobs. Shared envelopes and error/non-enumeration rules are in 01.

### MCP transport and deployment

FND owns proposed `app/mcp/route.ts`, authentication and dependency pins; ASSIST owns the official TypeScript SDK adapter/tool registrations. Use SDK Streamable HTTP, protocol negotiation and session isolation; do not handwrite JSON-RPC/OAuth or reuse the browser progress-SSE endpoint as MCP. Public tools still require rate limits and release checks. Authenticated private clients, if later enabled inside the approved boundary, validate resource audience/issuer/expiry and never pass a client's bearer token to another provider.

Implementation references: [OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server), [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization). Recheck the negotiated version and current supported SDK when implementing; a dated reference is not a claim that every client supports the latest protocol. Documentation was checked for planning; no client/account has been configured by this task.

Native local assistance needs F1 and its real producers, not F2. Remote public MCP needs F2, DEPLOY public_interoperability mode and an approved released projection. India-private mode disables external MCP/private-data transfer. An outbound tunnel or an OAuth token does not change where the returned data goes. Do not claim exported public responses remain inside India.

### Runtime gateway and billing boundary

ASSIST0 remains deterministic and requires no model wallet. Optional routing uses H20's authorised Sarvam profile through the existing gateway, with typed factual blocks retaining H18 authority. Do not expose key aliases, billing-pool identifiers, balances or provider error bodies to a property user. Budget exhaustion, cooldown or an unqualified provider falls back to available typed service facts and native actions, not another model provider. Result reuse still requires current source/target grants. Development GPT workers in H02 are not runtime property processors. Optional paraphrase remains separately evaluated and is never enabled merely because a key is funded.

## F. Exact implementation map

| File | Change / owner |
| --- | --- |
| Existing extraction/validation/resolver files linked in B | Read-only precedents; FND alone governs legacy calls and read projections |
| Proposed `packages/contracts/src/usp/assistance.ts` | ASSIST tool/Fact/Answer/template schemas |
| Proposed `apps/web/lib/server/usp/assistance/{tools,grounding,templates,service,mcp,routes}.ts`, `migrations/18-assistance.ts` | ASSIST executor, typed rendering, optional model routing and MCP adapter |
| Proposed `apps/web/app/mcp/route.ts` | FND sole transport/auth mount; DEPLOY mode gate |
| Proposed `apps/web/features/usp/assistance/{PropertyAssistant,AnswerEvidence,AssistantActions}.tsx` | ASSIST native leaf UI |
| [QuickRecords](../../apps/web/features/studio/product/QuickRecords.tsx), [RegisterPage](../../apps/web/features/officer/register/RegisterPage.tsx), public submission parents | UI exact selected-context mounts |
| Proposed `tests/usp-assistance.test.ts`, `tests/usp-assistance-integration.ts`, `tests/usp-mcp.test.ts`, `tests/e2e/usp-assistance.spec.ts` | ASSIST fact correctness, injection, permissions and real transport tests |

## G. UI placement and interaction

Quick/full register → Ask about this property → persistent building/floor/unit header → questions drawn from available producers → concise typed facts with Evidence and one next action. Own-submission assistance stays in the contributor surface, not the officer shell. Loading is bounded; unknown intent points to a real workflow; absent evidence stays unavailable; denied data is not summarized from cache. Ambiguity displays target choices. Scope changes are explicit. UI owns navigation/focus/mobile sheet, ASSIST content. No mandatory external ChatGPT setup for ordinary users.

## H. Ownership and dependencies

`feat/usp-assistance`; own feature code/tests/migration. F0 schemas first, F1 real-service ASSIST0 as soon as those producers exist. F2 applies only to actual authenticated public/private deployments and remote MCP, not the local operator. DEPLOY is the only model-network client; FND defines/wires ports and pins SDK; UI mounts; DATA prepares shared oracles. Do not create an alternative RAG/property database to mask unavailable producers.

## I. Implementation sequence

1. Obtain real D0 service outputs and expected questions/facts; implement deterministic tools/templates.
2. Complete finding/readiness answer → exact evidence/native action in active Studio without a model.
3. Add bounded model intent selection through gateway and strict fact-ID/template validation.
4. Evaluate optional paraphrase separately; retain deterministic output on any unsupported fact.
5. Add public-only MCP after released projections and F2/DEPLOY pass; qualify real handshake/tool behavior.
6. Test permission changes, hostile source instructions and incorrect-but-cited answers, not just valid JSON.

## J. Test datasets and verification

**D0:** actual FIND O-01 result (10 m²/20 m³), READY missing-boundary result, CITIZEN own submission and PACK options. Ask why the basement is flagged, what evidence is needed and whether the submission is recorded. Match exact subject, units, state, coverage and evidence against independent expected.json. Inject an uploaded instruction to reveal other owners, an invented URL, an existing citation attached to the wrong claim, negated status and a delayed previous-target result. None may alter permission, generate a network fetch or become a factual answer.

**D4 after integration:** preserve/recheck the [DDA inventory PDF](https://dda.gov.in/sites/default/files/Housing_Department/list_of_flats_and_garages_dda_premium_housing_scheme_2026.pdf) and normalized selected row. Questions about C-01-3 must preserve Block NA, Pocket E and source quantity meaning; no inferred owner, Block C, unit polygon or complete-building coverage. If actual bytes are unavailable, use D0 equivalent and mark real-source evaluation unpassed. DDA answers require the normalized source producer, not model memory.

Test cross-submission IDs, wrong token audience, forged principal, revoked source/release, hidden party/filename, ambiguous property, exhausted limits, malformed output, false unit conversion and model outage. Native fallback must work without remote MCP. Verify read-only tools do not create packets/jobs/proposals. MCP SDK/Inspector tests qualify protocol only; actual external-client account availability is a separate recorded test. No live credentials or account setup is assumed.

Run `pnpm typecheck`, `pnpm test:ai`; `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-assistance.test.ts tests/usp-mcp.test.ts`; `pnpm exec tsx tests/usp-assistance-integration.ts`; `pnpm exec playwright test tests/e2e/usp-assistance.spec.ts`. Return service/pack hashes, expected/actual factual blocks, rejected adversarial cases, exact navigation and protocol evidence. Report ASSIST0/optional paraphrase/remote qualification separately.

**Additional H20 acceptance:** zero-key, exhausted-wallet and 429 scenarios still return correct available typed facts without leaking settings. Revoke evidence access during a pending answer and verify neither cached model text nor a fallback discloses it. Any optional model call shares H20's two-attempt and money caps; no hidden second client.

## K. Copy-paste assignment

> Implement ASSIST on feat/usp-assistance using 00, 01 and this handoff. Start with actual D0 service facts and deterministic templates, then attempt normalized D4 rows for independent source testing. Build useful native answers with exact citations/actions before optional model routing or remote MCP. Citation membership alone is not truth: preserve subject, units, negation, unknown state and coverage mechanically. Use DEPLOY's gateway, FND auth/SDK/mounts and UI selection slots; do not add SQL, URL fetching, hidden writes or a separate data authority. Run J real-service injection/permission/semantic tests, return commits, fact outputs, screenshots and separate client gates. Local F1 assistance must not wait for public F2. No external activation or main merge without authorization.
