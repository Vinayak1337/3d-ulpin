# 02 · Implementation lead and bounded worker delegation

<!-- plan-next-gate: GF0 -->

**Adopted execution update: 23 September 2026.** This is the ready-to-use lead assignment for the existing handoffs, not another product specification. It replaces H00's earlier Sol-first routing recommendation. Domain requirements, ownership, data preservation and qualification gates remain in [00](00-README.md), [01](01-shared-contracts-and-ownership.md) and [99](99-ui-ux-and-integration.md).

**Model-neutral roles, updated 24 September 2026 ([H97](97-review-findings-and-alignment.md)).** Any user-authorized coding agent (Codex, Claude Code, Gemini CLI or another client) may lead or work on this plan. Choose models by the **role tiers** in section 2, not by vendor. The lead implements the critical path and integrates worker results; it is not a full-time planner that delegates all coding away. **Codex profile (the user's original selection, unchanged for Codex):** lead GPT-6 Astra at effort Max; workers GPT-6 Sol or GPT-6 Astra only. Runtime property inference is separately specified as Sarvam in [20](20-model-gateway-and-budget-pools.md) and is never performed by a coding agent. Work is picked from [H29 task cards](29-agent-task-cards.md).

**Runtime account clarification, 23 September 2026:** the user has one existing Sarvam key per separate account, with a reported ₹100 introductory grant per account. Use H20's independent-account onboarding and ordered budget rollover, not an assumption that all supplied keys share one wallet. Actual remaining balances and enrollment permissions are separate from that reported grant. Lead/worker model choices are unchanged.

**Dataset policy, 24 September 2026:** [H28](28-data-acquisition-and-finale-tests.md) owns D0–D7 acquisition, exact sources, independent oracles and current test gates. Operational data is Indian; tests may use any permitted geography. No locality is mandatory. The full-product learner/load campaigns are separate from the finale's matched-data and domain-AI qualification.

## 1. Max versus Ultra: execution surface matters

The [Astra model page](https://developers.openai.com/api/docs/models/gpt-6-astra) lists API efforts low/medium/high/xhigh/max. The current [subagent documentation](https://developers.openai.com/codex/subagents) describes Ultra in eligible ChatGPT Work surfaces as maximum reasoning with proactive delegation, and mentions support depending on client/model. Do not assume Ultra is a different base model or a universally valid API parameter.

In the Codex profile, use **Astra Max plus explicit delegation and verified worker settings**; in other clients, use the client's highest available reasoning setting for the lead and the tier map below. This gives the lead a strong reasoning setting while making our worker-family restriction and ownership visible. Ultra is optional only where the actual client supports it and can honour the same model/tool/ownership restrictions; it is not required for parallelism. No claim is made that Ultra or Max is always faster, cheaper or more correct.

Inspect the installed client's actual model choices, subagent tool schema and configuration precedence. Record requested and observed settings separately. A sentence saying a worker is Sol does not change its model. If the client cannot enforce a chosen worker model/effort, report that limitation and continue serially on the already selected allowed model; do not silently switch to a model outside the configured tier map for that client, and do not buy separate API access.

## 2. Worker selection policy

These are initial project routing choices, not benchmark-derived guarantees. Use the smallest sufficient assignment, not the lowest effort irrespective of risk. Each assignment names a **tier**; the tier map after this table says which model each client uses. The model column is the Codex profile.

| Assignment | Codex profile model and effort | Boundary |
| --- | --- | --- |
| Bounded read-only file search, source index or log summary | `gpt-6-sol`, `medium` | Return cited findings; no broad redesign or shared-file edits. |
| D0/D1/D4 data preparation, ordinary leaf implementation, fixed-policy READY/ASSIST0 logic | `gpt-6-sol`, `high` | Own explicit paths and independent expected cases; do not infer unavailable data. |
| Integration-heavy leaf, asynchronous recovery, PDF scoping or substantial UI interaction | `gpt-6-sol`, `xhigh` | Stable producer interfaces required; return tested changes, not mock completion. |
| High-risk transaction, numerical/reference, access-control or budget-race diagnosis | `gpt-6-astra`, `high` | Use a concrete cross-layer question/reproducer; lead retains final integration. |
| Persistent, genuinely hard blocker after focused attempts | `gpt-6-astra`, `max` | One bounded escalation, not a second whole-project orchestrator. |
| Independent milestone review | `gpt-6-sol`, `xhigh`; Astra `high` for a specific unresolved high-risk question | Reviewer does not edit the implementation before reporting findings. |
| Critical-path integration and architectural decisions | Lead `gpt-6-astra`, `max` | Lead writes code and runs the integrated workflow. |

| Tier | Codex profile | Claude Code | Gemini CLI | Any other client |
| --- | --- | --- | --- | --- |
| T-read (read-only search, summaries) | `gpt-6-sol` medium | Claude Haiku or Sonnet | Gemini Flash | Fast model, read-only tools |
| T-work (bounded leaf, data prep, UI leaf) | `gpt-6-sol` high/xhigh | Claude Sonnet | Gemini Pro | General coding model |
| T-risk (transactions, numerics, access control) | `gpt-6-astra` high | Claude Opus | Gemini Pro, high thinking | Strongest reasoning model |
| T-lead (critical path, integration) | `gpt-6-astra` max | Claude Opus, highest effort | Gemini Pro, highest thinking | Strongest reasoning model |
| T-review (milestone review) | `gpt-6-sol` xhigh | Any family other than the author's | Any family other than the author's | Different family or a human |

Model names in the non-Codex columns are families, not pinned IDs: record the exact model ID and effort the client reports in the task ticket and receipt (`agent.product`, `agent.model`, `agent.effort`). **Milestone review must come from a different model family than the one that wrote the change, or from a human** (a same-family review is recorded as `review.independence: same_family`). If a client cannot run a tier, run the work serially at the lead tier and record that.

Do not default all children to Max or build a model-selection service merely to implement the project. Do not split a ten-line edit into a worker. After two focused unsuccessful fixes of the same reproducible defect, escalate the defect with its evidence rather than restarting the feature. A missing dataset, credential, executable or permission is an environmental gate, not proof that more reasoning solves it.

## 3. Spawn protocol and file ownership

**Spawn a worker when there is a bounded independent task that can save elapsed time or improve verification.** Typical first companion: inspect the actual D0/D1/D4 state and complete the missing DATA slice while the lead validates the active integration path. If DATA is already complete, use a read-only acceptance/test-gap worker instead of regenerating the pack.

Before V0, retain at most two implementation owners plus one DATA/verification task in total. The lead counts as an implementation owner while writing. Default to at most **two spawned threads**, excluding the lead. After V0, the existing limit of three unfinished integration-dependent workstreams still applies. A reviewer may replace a completed worker in a slot; no extra hidden swarm.

Only the lead spawns workers. Workers must not spawn children. One writer per shared area; no concurrent FND and UI ownership by several agents. The lead may sequentially hold multiple roles, with explicit transfer before another writer takes that role. Native subagents are not assumed to have separate Git worktrees: verify isolation. Use separate worktrees/branches for writing workers where supported; otherwise use non-overlapping paths and one integration owner, or serialize writes. Never build in another agent's live worktree or share a writable test database accidentally.

Every task ticket names:

```text
Task ID and useful outcome:
Requested model and effort; observed settings if available:
Base commit, worker branch/worktree and integration destination:
Owned paths; forbidden/shared paths and their owners:
Input contracts and exact data pack/version:
Required independent expected results and acceptance commands:
What must remain unchanged; access/network/spend constraints:
Dependency on the lead; when to stop and return a patch:
Return: commit/diff, commands and exit codes, artefact/receipt refs,
        changed interfaces, limitations and a concise summary.
```

The lead performs unrelated critical-path work while an independent worker runs. It waits when it needs that worker's actual interface or result, not by repeatedly polling every few seconds. At integration, verify the worker's exact base/diff, run appropriate combined tests and update the existing status/receipt. No worker may merge main, enable production, alter secrets or bypass failed acceptance.

## 4. Optional client configuration examples (Codex profile only)

**Examples only: not installed or runtime-tested by this documentation task.** Check current installed Codex documentation before creating/merging these files. Preserve existing project/user configuration; do not overwrite it. The [current documented configuration](https://developers.openai.com/codex/subagents) allows per-agent model and effort overrides, so verify that custom-agent files do not silently override the requested spawn settings.

Illustrative project configuration:

```toml
model = "gpt-6-astra"
model_reasoning_effort = "max"

[agents]
enabled = true
max_concurrent_threads_per_session = 2
default_subagent_model = "gpt-6-sol"
default_subagent_reasoning_effort = "high"
```

Illustrative `.codex/agents/ulpin-sol-worker.toml`:

```toml
name = "ulpin_sol_worker"
description = "Bounded ULPIN implementation or data task with explicit file ownership."
model = "gpt-6-sol"
model_reasoning_effort = "high"
developer_instructions = """
Follow the assigned ticket, current AGENTS and relevant handoffs.
Do not spawn children. Do not edit another owner's paths.
Preserve source identity and uncertainty. Use the supplied independent tests.
Return actual changes and verification, not claims from mocked completion.
"""
```

Use separately pinned roles/configs for XHigh implementation and read-only review when the client requires this; do not assume a spawn argument overrides a role's pinned setting. Do not turn off approval/sandbox safeguards to make a worker start. No OpenAI API keys or separate paid API runner are required merely to use configured Codex subagents; actual account/client availability remains to be checked.

## 5. Continue the existing implementation, not the old starter

The consolidated staging baseline is `45d033baae7ec4e5a572d82459b0062c70a12c95`. The continuation is already integrated; former PR/branch names are history, not pending dependencies. Fetch and verify staging before work. Main remains the separate old-code/deployment line. Inspect [FND interfaces](../evidence/usp/fnd/INTERFACES.md), [D0 evidence](../evidence/usp/fnd/d0/README.md), the [23 September local milestone](../evidence/usp/continuation-2026-09-23/README.md) and current code/tests. Do not recreate D0/PACK0/D1 because an old starter prompt requested them.

These reads do not confer a new runtime pass. Preserve populated data and unrelated changes. A future implementation branch uses the verified staging base and targets staging; no implicit main merge or deployment.

## 6. Ready-to-paste lead prompt

```text
Act as the hands-on implementation lead for Vinayak1337/3d-ulpin.
Use the T-lead tier of your client (Codex profile: GPT-6 Astra Max with
only GPT-6 Sol/Astra workers); verify actual settings through the client.
Read H97 (review findings) and pick the next unblocked H29 task card.

Read AGENTS.md and applicable framework instructions. Read H00, H01, H02,
H26, H27, H28, release-plan.json and the assigned feature/H99 contracts.
Read H19/H20 before any runtime provider work. Do not turn historical
T-number backlog entries or earlier audits into a second roadmap.

Inspect dirty files, running writers, Git ancestry and current code/tests.
Fetch origin/staging; the recorded consolidated baseline is 45d033b.
Use an isolated continuation branch targeting staging. Leave main and
populated environments unchanged. Do not activate public services.

Start at the manifest's nextGate (also declared at this file's top). Reuse and regression-check existing
D0/PACK0 and D1 receipts. Inventory actual gaps, preserve fixture semantics,
and pin a bounded Indian source bundle plus independent adversarial truth.
H28 governs acquisition; catalogue metadata is not downloaded survey data.
Proceed GF1 IDs/exchange, GF2 domain AI and spaces, GF3 governance/impact,
GF4 scoped card/QR, GF5 evidence and rehearsal as dependencies pass.

Implement on the existing registry, sources, jobs, provider gateway and
MapViewport. Retain the current Cesium D0/D1 runtime. No competing broker,
map, database or card service. A project ID is not an official ULPIN.
Unknown/unsupported analytical results are not numerical zeros. Preserve
all originals, revisions, local metre frames and vertical references.

Use explicit bounded owners and the H02 routing table. The lead remains
on critical-path implementation. Start at most two workers; use separate
worktrees or non-overlapping paths, no recursive workers. Supply exact
base, contracts, source hashes, independent expected cases and return
requirements. No concurrent writers to shared services or writable test DBs.

Keep full_product commitments without making them finale prerequisites:
concurrent learner, public request dashboard, MCP/conversational assistance,
enrichment, renderer experiments and large-scale protected deployment.
The four H27 domain-AI workstreams remain in the finale. Existing exact
conversion/no-key/manual routes remain useful when a provider is unavailable.

Use H20's modelGateway and task/cost/permission caps. Sarvam does bounded
interpretation/OCR; qualified specialist tools process geometry. H21 permits
eligible full-product learning alongside imports; training is not performed
by the gateway or triggered after every call. Independent account budgets
need verified allocations; never multiply grants, evade shared throttles,
reuse retired keys or retry unknown charged work against another account.
No-key/fake-provider tests precede any permitted live call. No secrets in
chat, Git, screenshots or logs; no paid or unapproved external fallback.

Run the named requirement tests, real producer/consumer integration and
actual Studio interaction. Save immutable receipts with exact code/source/
model/pack hashes, expected versus actual values and measured environment.
Use an independent read-only review (different model family or a human) before each substantial acceptance.
Update the manifest and existing evidence index only from actual passes;
documentation validation alone cannot close a runtime requirement.

Proceed autonomously through authorized coding/testing. Routine parser and
fixture choices belong to agents. Use H28's bounded acquisition fallbacks;
missing authentic input blocks its particular real-source claim, not all
software work. At a genuine external gate, retain a recoverable checkpoint
and the precise missing input. Never mark unrun or blocked work complete.
```

## 7. Acceptance for the orchestration setup itself

Before relying on parallel work, prove one bounded read-only worker returns the requested model/effort when exposed by the client, actual file evidence and a useful result. Check task ownership, current branch and isolation before a writing worker starts. Unsupported or unobservable settings are explicitly recorded; do not infer a worker's identity from its answer style.

Record elapsed time to accepted milestone, interventions, failures fixed and available usage totals. There is no promised percentage of the user's plan or guaranteed Max-versus-Sol saving. Keep the lead accountable for final integration, even when a worker reports all tests passing.

**References checked 23 September 2026:** [Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra), [Sol model](https://developers.openai.com/api/docs/models/gpt-6-sol), [reasoning guidance](https://developers.openai.com/api/docs/guides/reasoning), [subagent/client configuration](https://developers.openai.com/codex/subagents). No worker was launched or model configuration installed by this documentation task.
