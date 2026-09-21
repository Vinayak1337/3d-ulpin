# 18 · Grounded property assistance and optional MCP access

Owner **ASSIST** · Priority **P3** · Baseline `main@f623cff897f91bb3ebd4c225f700ac263f7beb72` · Native integration needs [F1](01-shared-contracts-and-ownership.md); remote/private-user access additionally needs F2 and [DEPLOY](19-india-contained-deployment.md).

## A. User outcome and product value

Allow an authorized user to ask a practical question about an exact property, evidence requirement, submission or finding and receive a short answer with source references and a useful next action. MCP exposes a bounded subset of these existing services to compatible clients; it is an access channel, not the main USP.

Examples: a contributor asks “What is still needed for my submission?”; an officer asks “Why is this basement crossing flagged?”; a public visitor asks “Which released property matches this identifier?” Answers must stay within the caller's records and the permitted deployment boundary. “Who owns every flat in this block?” is not an authorized public query merely because a model can phrase it.

## B. Current implementation and gap analysis

[officer-ai-provider.ts](../../apps/web/lib/server/officer-ai-provider.ts) currently implements bounded Nous-backed extraction, explicitly treating source text as untrusted evidence and forbidding generated identifiers, geometry inference and publication actions. [officer-ai-validation.ts](../../apps/web/lib/server/officer-ai-validation.ts) and [grounding tests](../../tests/ai-extraction/grounding.test.ts) are useful validation precedents. These extraction mechanisms are not a complete conversational agent or an MCP server.

[area resolver](../../apps/web/lib/server/area-resolver.ts), dossiers and the proposed feature read ports supply useful domain answers. The resolver has synchronization side effects, so ASSIST must consume FND's read-only target projection, not invoke that mutating resolver as an allegedly read-only tool. Missing: scoped tool contracts, grounded answer validation, multi-turn scope controls, native assistance UI, MCP transport/auth integration and injection/data-exposure tests.

## C. Scope and non-goals

First release: native read-only assistant for selected property/workflow and a separately disabled-by-default **public-projection-only remote MCP**. Private officer/contributor tools may run inside the approved native/private environment. Broader remote private-data exposure is outside the initial scope and cannot be enabled merely by supplying an OAuth token.

No unrestricted SQL, arbitrary URL fetch, filesystem tools, whole-database export, autonomous registry writes, ownership determinations or generated surveys. Packet creation, evidence requests and review actions remain explicit native UI confirmations; read tools may return links to those screens, not perform hidden mutations. Voice, automatic form submission and custom ChatGPT map widgets are optional extensions after the read path qualifies.

## D. HLD and end-to-end flow

User opens **Ask about this property** → client sends question plus explicit selection → server derives principal and resolves permitted target → deterministic intent/tool router or bounded model chooses from allowed read tools → services return exact structured facts and evidence pointers → answer validator checks every claim/reference → response shows concise explanation and scoped navigation links.

MCP calls reuse the same server tool executor and access checks, with a narrower public release projection. They do not forward unrestricted native assistant state or conversation history. A question that changes scope requires explicit target resolution; ambiguous results ask for selection instead of choosing the first match.

## E. Targeted LLD

### Tool inventory and data boundary

Proposed schemas use FND `TargetPin`, `UspScope`, cursor limits and current server principal. Tool output includes `state`, exact input pins, bounded facts, evidence refs, limitations and app action links. The model never supplies an authoritative role or entitlement.

| Tool | Inputs and permitted outcome | Availability in first release |
| --- | --- | --- |
| `search_public_properties` | Bounded identifier/address query → approved public matches, no private party search | Native public and remote public MCP |
| `get_public_property` | Public ref → released summary, source/revision labels and safe app URL | Native public and remote public MCP |
| `explain_public_status` | Public ref → already released status reasons only | Native public and remote public MCP |
| `get_my_submission_status` | Submission ID → caller's status and requested next evidence | Authenticated native/private client only |
| `get_property_readiness` | Scoped target pin → READY dimensions, missing inputs and limitations | Authorized native/private client only |
| `explain_finding` | Finding ID/run pin → FIND facts, measurements and permitted evidence | Authorized native/private client only |
| `compare_property_revisions` | Explicit left/right manifests → existing HISTORY comparison/read result | Authorized native/private client only; no hidden comparison job creation |
| `get_packet_options` | Target pin → available packet action link and scoped prerequisites | Native/private only; creates no packet or signed download token |

Remote public tools must only read CITIZEN's approved public projection. If that feature is unavailable or a record is not released, return unavailable/not found; do not fall back to an officer dossier. Private MCP clients, if implemented for government use, must remain within DEPLOY's approved boundary and use F2 resource grants. They are not the same release as public ChatGPT connectivity.

### Grounding, state and limits

Proposed `Answer` contains intent, resolved target(s), short response blocks, fact references, limitations and next-action URLs. Each factual block references service-returned fact IDs or evidence pointers. Validate references belong to the permitted request/result set; reject invented pages, URLs, IDs or numerical values. Measurements come from deterministic services. Where no evidence exists, return “Not available in the supplied records,” not an inferred answer from model memory.

Sources, filenames, quoted clauses and previous assistant responses are untrusted data. Do not concatenate them into privileged tool instructions. Disallow tools outside the registry, reauthorize each call, bound recursion and validate all arguments/results. No model-produced URL may be fetched or opened server-side. App links are built from allowlisted route templates and validated refs; source links require access again when opened.

Initial proposed limits: 1,000 characters/question, six domain tool calls, 20 result items/call, 24 KiB total authorized evidence text, two model calls including repair and a 45-second request budget. Provider/model capability limits may be lower. A timeout or model outage falls back to deterministic status templates and existing navigation, not a different external provider. Never place secret tokens, original documents or private prompts in client analytics/logs.

Keep native conversation state bounded and server-scoped. A target change clears incompatible evidence context; prior permissions are not cached as permanent grants. Persist only optional minimal audit/feedback metadata in `usp_assist_runs`/`usp_assist_feedback`, not full transcripts by default. Any retained transcript requires an explicit retention/access policy. Feedback is not automatically model-training consent or ground truth.

### APIs and MCP

Proposed native API `/api/v1/usp/assistance/query` accepts question, selected context and optional bounded conversation reference; `/capabilities` returns allowed tool names and deployment availability without secrets. Read-only tool execution is shared through `executeTool(ctx,name,args)`. Feature services remain responsible for their own access checks even after ASSIST validates the request.

Proposed MCP server module uses the maintained official TypeScript SDK, pinned by FND, with a dedicated Streamable HTTP route at `/mcp`. FND owns the Next route/auth wrapper; ASSIST owns tool registration/transport adapter. Do not implement JSON-RPC or OAuth cryptography from scratch, or confuse MCP transport with INGEST's browser-progress SSE endpoint. Handle request/session isolation, initialized protocol version, disconnects and malformed methods through SDK conventions.

For authenticated private clients use the [MCP authorization security requirements](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations): validate tokens for this resource/audience; never pass upstream bearer tokens through as another service's credentials. Tool annotations describe actual behavior, not authorization. The [OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server) describes maintained SDK/transport and tool annotations; qualify the chosen SDK version and client during implementation. Anonymous public tools still need rate limits and a strict public projection.

The [OpenAI security/privacy guide](https://developers.openai.com/plugins/guides/security-privacy) and [MCP app help](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt) are integration references checked during planning on 22 September 2026. Client availability, account permissions and publication mechanisms can change; recheck before an actual release. No ChatGPT account or external connection was configured by this documentation task.

A remote client receives the data returned by tools. Therefore, an India-contained private deployment must disable external ChatGPT/MCP for private records. An outbound tunnel does not remove this data-transfer boundary. Public-projection release is an explicit exception/profile with no promise that exported public responses remain in India.

## F. Exact implementation map

| Existing or proposed file | Required change | Reason | Owner | Shared dependency |
| --- | --- | --- | --- | --- |
| [officer-ai-provider.ts](../../apps/web/lib/server/officer-ai-provider.ts), [officer-ai-validation.ts](../../apps/web/lib/server/officer-ai-validation.ts) | Reuse validation principles; FND adapts legacy provider routing through DEPLOY | No uncontrolled fallback | FND/DEPLOY; ASSIST read-only reference | Model gateway |
| Proposed new `packages/contracts/src/usp/assistance.ts` | Tool/answer/citation schemas | Bounded grounded contract | ASSIST | F0 read ports |
| Proposed new `apps/web/lib/server/usp/assistance/{tools,grounding,service,mcp,routes}.ts`, `migrations/18-assistance.ts` | Native tool executor, answer validation, MCP adapter and minimal audit | One permission-aware implementation | ASSIST | FND principal/access; feature reads |
| Proposed new `apps/web/app/mcp/route.ts` | Thin SDK transport/auth mount | One cross-cutting endpoint owner | FND | ASSIST adapter; DEPLOY mode |
| Proposed new `apps/web/features/usp/assistance/{PropertyAssistant,AnswerEvidence,AssistantActions}.tsx` | Contextual native assistant | Useful without external apps | ASSIST | UI selected-target slots |
| [QuickRecords](../../apps/web/features/studio/product/QuickRecords.tsx), [RegisterPage](../../apps/web/features/officer/register/RegisterPage.tsx) | Mount contextual entry and scope header | No new dashboard/chat island | UI | ASSIST leaves |
| Proposed new `tests/usp-assistance.test.ts`, `tests/usp-assistance-integration.ts`, `tests/usp-mcp.test.ts`, `tests/e2e/usp-assistance.spec.ts` | Grounding, injection, principal isolation and actual transport tests | No mocked-only connector claim | ASSIST | Isolated auth/provider/client fixtures |

## G. UI placement and interaction

Quick register → **Ask about this property** → compact panel with current building/floor/unit header → suggested questions based on available tools → answer with **Evidence** and one concrete next action. Full register uses the same panel. A native contributor question opens their submission context, not the officer shell. External ChatGPT setup belongs in an optional integrations/settings surface, not public onboarding's mandatory path.

Loading describes the bounded read operation; cancellation aborts model work without altering records. Empty/unsupported intent points to a relevant native workflow. Denied data is not summarized from cached content. Ambiguous identity shows selectable results. Model failure returns verified template facts where possible. Success citations open the exact source/revision with current permission checks. Scope changes are conspicuous; no invisible carry-over from another flat. ASSIST owns panel contents; UI owns scope/route/state integration.

## H. Agent ownership and dependencies

Use `feat/usp-assistance`. F0 enables schemas/offline tool evaluation; F1 enables real native reads. READY/FIND/HISTORY/CITIZEN/PACK ports can individually be unavailable; advertise only working tools. F2/DEPLOY and approved public projections gate remote MCP. FND owns SDK dependencies, endpoint auth and shared routes; DEPLOY owns provider client/egress policy; ASSIST owns prompts/tool validation. No feature service or canonical database rewrite.

## I. Implementation sequence

1. Implement deterministic tool registry and useful template answers before adding model routing.
2. Add bounded grounded generation through modelGateway and citation validation.
3. Connect native selected-property UI with exact-source links and permission changes.
4. Implement remote public-only MCP through the official SDK, sharing the same executor/public projection.
5. Qualify actual client handshake, tool schema/annotations and isolation; keep disabled until deployment gates pass.
6. Run adversarial source/argument tests, unavailable-provider cases and realistic questions in both public/native modes.

## J. Acceptance criteria and verification

Native demo asks why a known basement finding exists and what evidence is missing; answers cite the exact result/source and open that target. Public MCP lookup returns only a released summary. A prompt inside a document saying to reveal all owners or call an external URL must not change tool permissions or produce a network request. No source output may invent a fact, ID or page reference.

Test wrong OAuth audience, forged principal headers, cross-submission IDs, hidden party/source data, stale citation, ambiguous identifier, malformed tool output, rate limit, session reuse across users, model outage and exhausted budget. Packet options must not generate files or issue unrestricted links. India-private mode must make external MCP unavailable. MCP Inspector/SDK tests alone qualify protocol behavior, not every ChatGPT account's access; report an actual client test separately.

Run `pnpm typecheck`, `pnpm test:ai`; `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-assistance.test.ts tests/usp-mcp.test.ts`; `pnpm exec tsx tests/usp-assistance-integration.ts`; `pnpm exec playwright test tests/e2e/usp-assistance.spec.ts`. Pin any Inspector dependency through FND rather than running an unreviewed latest package. Return approved tool inventory, grounding/injection failures and fixes, actual protocol/client evidence, screenshots and unresolved deployment/account gates.

## K. Copy-paste agent assignment

> Implement ASSIST on `feat/usp-assistance`. Read the index/shared contracts, this handoff, DEPLOY and linked extraction/grounding code. Build bounded native read tools and verified answers first; add an optional public-projection-only MCP adapter through the official pinned SDK. FND owns auth/dependencies/route mounts, DEPLOY owns provider/egress and UI owns shared panels. Never expose full dossiers, unrestricted SQL/URLs, private data to external clients or hidden packet/registry writes. Keep tool arguments, source content and model output untrusted; validate references and scope on every call. Run section J native, injection, authorization and actual MCP tests, return commits and precise evidence/gates. No external setup or main merge without authorization.
