# 02 · Implementation lead and bounded worker delegation

**Adopted execution update: 23 September 2026.** This is the ready-to-use lead assignment for the existing handoffs, not another product specification. It replaces H00's earlier Sol-first routing recommendation. Domain requirements, ownership, data preservation and qualification gates remain in [00](00-README.md), [01](01-shared-contracts-and-ownership.md) and [99](99-ui-ux-and-integration.md).

**Recommended lead: GPT-6 Astra, reasoning effort Max, in the configured Codex development environment.** The lead implements the critical path and integrates worker results; it is not a full-time planner that delegates all coding away. Development workers may use **only GPT-6 Sol or GPT-6 Astra**. Runtime property inference is separately specified as Sarvam in [20](20-model-gateway-and-budget-pools.md).

**Runtime account clarification, 23 September 2026:** the user has one existing Sarvam key per separate account, with a reported ₹100 introductory grant per account. Use H20's independent-account onboarding and ordered budget rollover, not an assumption that all supplied keys share one wallet. Actual remaining balances and enrollment permissions are separate from that reported grant. Lead/worker model choices are unchanged.

**Dataset policy, 24 September 2026:** H00 section 4 supersedes locality-specific acquisition instructions. General map/load/adaptation testing may use real data from any suitable geography. Preserve old sources/regressions; do not require Uttam Nagar or Delhi. Assign DATA the large real 3D corpus and independent sparse/unfamiliar-source cohorts, with H14/H99 qualification rather than hardcoded sample acceptance. This update changes future test selection, not the recorded D0/D1 milestone or current runtime capabilities.

## 1. Max versus Ultra: execution surface matters

The [Astra model page](https://developers.openai.com/api/docs/models/gpt-6-astra) lists API efforts low/medium/high/xhigh/max. The current [subagent documentation](https://developers.openai.com/codex/subagents) describes Ultra in eligible ChatGPT Work surfaces as maximum reasoning with proactive delegation, and mentions support depending on client/model. Do not assume Ultra is a different base model or a universally valid API parameter.

For this project, use **Astra Max plus explicit delegation and verified worker settings**. This gives the lead a strong reasoning setting while making our worker-family restriction and ownership visible. Ultra is optional only where the actual client supports it and can honour the same model/tool/ownership restrictions; it is not required for parallelism. No claim is made that Ultra or Max is always faster, cheaper or more correct.

Inspect the installed client's actual model choices, subagent tool schema and configuration precedence. Record requested and observed settings separately. A sentence saying a worker is Sol does not change its model. If the client cannot enforce a chosen worker model/effort, report that limitation and continue serially on the already selected allowed model; do not silently spawn a different family or buy separate API access.

## 2. Worker selection policy

These are initial project routing choices, not benchmark-derived guarantees. Use the smallest sufficient assignment, not the lowest effort irrespective of risk.

| Assignment | Model and effort | Boundary |
| --- | --- | --- |
| Bounded read-only file search, source index or log summary | `gpt-6-sol`, `medium` | Return cited findings; no broad redesign or shared-file edits. |
| D0/D1/D4 data preparation, ordinary leaf implementation, fixed-policy READY/ASSIST0 logic | `gpt-6-sol`, `high` | Own explicit paths and independent expected cases; do not infer unavailable data. |
| Integration-heavy leaf, asynchronous recovery, PDF scoping or substantial UI interaction | `gpt-6-sol`, `xhigh` | Stable producer interfaces required; return tested changes, not mock completion. |
| High-risk transaction, numerical/reference, access-control or budget-race diagnosis | `gpt-6-astra`, `high` | Use a concrete cross-layer question/reproducer; lead retains final integration. |
| Persistent, genuinely hard blocker after focused attempts | `gpt-6-astra`, `max` | One bounded escalation, not a second whole-project orchestrator. |
| Independent milestone review | `gpt-6-sol`, `xhigh`; Astra `high` for a specific unresolved high-risk question | Reviewer does not edit the implementation before reporting findings. |
| Critical-path integration and architectural decisions | Lead `gpt-6-astra`, `max` | Lead writes code and runs the integrated workflow. |

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

## 4. Optional client configuration examples

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

The former `codex/fnd-f0-f1@97146d62d7e64c946abfc98b0d7e670845b17857` work is merged into `staging`. The present continuation is `codex/usp-staging-continuation-20260923` from `origin/staging@2838e798af838d7646ff92b1120c62c8458103da`, targeting staging in PR #13. It preserves main's deployment/API-index fixes. The original `feat/usp-foundation-f0@777c978` is historical. Inspect [FND interfaces](../evidence/usp/fnd/INTERFACES.md), [current D0 evidence](../evidence/usp/fnd/d0/README.md), current code and new test outputs before deciding what remains.

Those source/receipt reads are not a new end-to-end verification by this document author. Older H00/H01 starter-status prose is historical when current code has advanced. Do not regenerate implemented contracts because that paragraph says they were once missing. Recheck branch drift and preserve main's separate deployment work during later integration.

## 6. Ready-to-paste lead prompt

```text
Act as the hands-on implementation lead for Vinayak1337/3d-ulpin.
Use GPT-6 Astra at Max reasoning in the configured coding environment.
Use only GPT-6 Sol or GPT-6 Astra for any development worker.

Read current AGENTS.md and applicable framework instructions, then
00-README.md, 01-shared-contracts-and-ownership.md,
02-lead-agent-execution.md and 99-ui-ux-and-integration.md under
docs/usp-agent-handoffs/. Read relevant feature A-K sections as needed.
For runtime AI, read 19 and 20-model-gateway-and-budget-pools.md.
Do not regenerate the plans or treat the historical audit as another spec.

First inspect worktree changes, running writers, Git ancestry and actual
interfaces/tests. Continue the latest established implementation, not an
older starter. Fetch origin/staging and recheck its live head; the last base
was 2838e798af838d7646ff92b1120c62c8458103da. PRs 8–11 and the adopted
documentation are merged into staging; former branch names are historical.
Inspect PR 13's continuation before duplicating work. Use a new isolated
continuation branch and target staging, preserving newer application and
main-only deployment changes. No implicit deployment or main merge.

Take explicit FND/UI/PACK0 ownership for the critical path as appropriate.
Preserve the existing registry, jobs, source storage, renderer, IDs,
revisions, exact evidence links and unavailable states. Implement and test,
not merely supervise. Never use a new competing map, database or broker.

SPAWN WORKERS when a genuinely independent task can save time or provide
independent verification. Choose model/effort by the H02 routing table:
Sol Medium for bounded read-only exploration; Sol High for DATA and
ordinary isolated modules; Sol XHigh for integration-heavy leaves;
Astra High for high-risk cross-layer diagnosis; Astra Max for a specific
persistent hard blocker. Keep yourself on the critical integration path.
Do not delegate every small edit or set every worker to Max.

Actually set/verify the model and effort through the available spawn/config
mechanism. Worker prose alone is not model selection. If unavailable,
continue serially on the selected allowed model and report the limitation.
Do not use another model family, a hidden API runner or new paid account.

Start with at most two spawned threads and the existing total ownership
limits: two implementation owners plus DATA/verification before V0.
Only the lead spawns; workers cannot spawn children. Every writing worker
needs a safe worktree or non-overlapping file allocation. Supply exact
base SHA, paths, interface, pack/hash, tests and return evidence. Never
allow concurrent writers on shared contracts, state, routes or the map.

MILESTONE 1:
Finish the actual Studio D0 journey: neighbourhood -> building -> supplied
floor/unit -> exact evidence -> scoped text/CSV packet -> saved-state reload.
Separately qualify one real D1 roof-shaped building in the same shared
viewport without flattening it or inventing internal floors. Inspect actual
browser interaction and compare fresh screenshots with retained references.
Do not declare a separate showcase or mock API to be the product result.

DATA AFTER THE EXISTING SMOKE MILESTONE:
Follow H00 section 4's geography-independent selection procedure. Acquire a
real roof-shaped corpus and compatible same-area context; reserve independent
publisher/layout cohorts with naturally sparse or missing attributes. No
Uttam Nagar, Delhi or India-only acquisition prerequisite. Keep native inputs,
source IDs, releases, CRS/vertical metadata and exact conversion lineage.
Run real 10k -> 100k -> 1M aggregate load rungs only as partitioned ingestion
and spatial paging become qualified; do not raise per-job/scene limits or
clone records to manufacture scale. H14 J A1-A5 distinguishes no-code-edit
adaptation for supported formats from separately implemented new parsers.
Measure map interaction during ingestion, false confident mappings, missing
states and restart/replay correctness. Never present a small smoke test as
high-load acceptance or move one country's geometry into another's location.

Then continue dependency-ready milestones in order: useful readiness and
findings/evidence actions; separately qualified PDF packets; durable
progressive ingestion; history/relationships/impact; governed runtime AI;
then authenticated citizen/MCP/deployment only after their specific gates.
Checkpoint and verify each complete workflow before expanding. Do not stop
for routine permission between files or request that a human pick parsers.
Use the prescribed data fallbacks; unavailable authentic inputs block only
their particular real-source qualification. Do not claim optional or blocked
features complete or spend the whole session rewriting abstractions.

RUNTIME AI:
Use the existing modelGateway through DEPLOY, not feature-specific clients.
Sarvam 105B V1 handles bounded mapping/text interpretation; Vision digitise
is a separate OCR/page-billing job, not a LiDAR parser. Use deterministic
parsers/geometry and qualified recipe reuse; no training after each chunk.

Implement H20's organisation-level credit pools and per-key attribution.
USER-CONFIRMED SETUP: each existing key is from a different Sarvam account,
with a reported Rs100 introductory grant per account. Configure separate
account/organisation pools and their rate-limit scopes, one key each;
do not combine this supplied set into one Rs100 wallet. Enroll actual IDs,
current remaining balances, approved allocations and secret references.
A reported initial grant is not verified remaining credit. Additional keys
from the same organisation must share its existing pool, not mint funding.

Use a persisted, operator-approved account order. Reserve worst-case cost,
then keep the current pool until its admission threshold closes and advance
to the next eligible approved pool without asking again at each switch.
Drain admitted document jobs before permanent retirement; never reuse a
terminal key after restart, re-enrolment, reordered config or old backup.
Settle actual usage and retain unknown charge exposure. Do not retry a
possibly charged operation on the next account. A transient 429 is cooldown,
not exhaustion or permission to evade throttles. When no eligible pool
remains, preserve pending work and use the no-AI/manual fallback.
Cross-pool use requires legitimate funding and permission for the same data.
No signup automation, auto-top-up, secret logging or sending restricted
records to unapproved providers.

Finish the no-key/fake-provider accounting tests before opt-in synthetic
live calls. No supplied credential or balance evidence means no live pass;
manual mapping and typed native answers must still work. Keep developer
Sol/Astra usage separate from runtime Sarvam budgets and data permissions.

Before accepting each substantial milestone, use a fresh read-only review
worker for its actual diff, receipts, relevant adversarial tests and visual
behaviour. Record findings before fixing; then run targeted and integrated
regressions. Do not endlessly rerun unrelated tests once required checks pass.

Update existing implementation notes with commits, exact commands/exit
codes, source/pack hashes, API/storage/job receipts, screenshots, observed
worker models/efforts and usage where available. Distinguish contract-ready,
local-integrated, real-source-qualified and deployment-qualified outcomes.
Preserve populated volumes and unrelated work. Never hide failures, weaken
tests, fabricate dataset facts, buy credits, activate public services or
merge main without explicit authorization.

Proceed through coding, testing and corrections autonomously within the
available session/tools. At a real external gate or session limit, leave a
small recoverable checkpoint with the exact next action; never claim work
will continue after the session or that an unrun check passed.
```

## 7. Acceptance for the orchestration setup itself

Before relying on parallel work, prove one bounded read-only worker returns the requested model/effort when exposed by the client, actual file evidence and a useful result. Check task ownership, current branch and isolation before a writing worker starts. Unsupported or unobservable settings are explicitly recorded; do not infer a worker's identity from its answer style.

Record elapsed time to accepted milestone, interventions, failures fixed and available usage totals. There is no promised percentage of the user's plan or guaranteed Max-versus-Sol saving. Keep the lead accountable for final integration, even when a worker reports all tests passing.

**References checked 23 September 2026:** [Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra), [Sol model](https://developers.openai.com/api/docs/models/gpt-6-sol), [reasoning guidance](https://developers.openai.com/api/docs/guides/reasoning), [subagent/client configuration](https://developers.openai.com/codex/subagents). No worker was launched or model configuration installed by this documentation task.
