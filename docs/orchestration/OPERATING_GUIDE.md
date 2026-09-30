# 3D ULPIN orchestration operating guide

User direction, 26 September 2026. Read this before every assignment, review, continuation and integration decision. This guide overrides older orchestration/model/testing instructions; backend requirements and release qualification remain intact; the 26 September backend-only scope supersedes older UI implementation plans.

## Usage monitoring revoked

The user revoked the custom usage/reset stop rule on 26 September 2026 and requested continued backend work. The `3d-ulpin-usage-stop-guard` schedule has been deleted. Do not poll account usage, hold dispatch based on the former threshold, or recreate the schedule. Normal platform limits still apply; no credit redemption or purchases are authorized.

On 30 September the user reiterated that there is no self-imposed agent/token/usage budget cutoff for workflow development. Effort selection is about usefulness: Astra normally uses medium through xhigh; max is for exceptional cases with a concrete benefit, not routine research or orchestration. Process/VRAM limits remain operational safeguards, not reasons to abandon useful work.

## Production-quality engineering before launch clearance

User clarification, 30 September: build to production engineering standards now. Reliability, security, source integrity, recovery, maintainability and meaningful testing belong in the implementation. Formal legal/policy review, permission requests and production-launch approvals are deferred to the release workstream. Do not interpret the hackathon/prototype stage as permission to ship fragile architecture, omit access controls or replace actual functionality with a demonstration. The MVP rule still keeps each increment small and usable; it does not lower its engineering quality.

Look for existing harnesses, model adaptations, training techniques and system designs when a component is difficult or existing work can accelerate delivery. Inspect primary repositories, model cards, papers and examples, then adapt the smallest relevant component into our current authorities. Ordinary public research and local development experiments are already authorized; do not add repeated approval requests or make production clearance a development prerequisite.

Public community/research/vendor resources may support development experiments; this supersedes earlier official-source-only acquisition restrictions for that scope. Preserve origin, version, attribution and terms; separate published claims from our own measured behavior. A public benchmark, teacher output or model prediction is not automatically correct property evidence or a qualified relationship label. Keep official operational qualification, untouched evaluations and recorded identities intact. Track production-specific licensing, residency, redistribution and deployment approvals for the later launch gate. Choose a usable alternative when a resource cannot be accessed or used under its actual conditions, without stalling unrelated development.

Research returns a short evidence-backed comparison tied to the current gap and concrete reusable interfaces/techniques. The lead makes the integration decision; do not replace the registry, queue, model gateway or whole backend merely because a framework exists. Inspect dependencies before installation and use isolated environments for model trials. No framework/model popularity score substitutes for one useful real-input journey.

## Role: own delivery and use delegation when useful

The lead reads the relevant plan/task, identifies the actual work, owns its result and coordinates file ownership. The lead may execute a bounded task directly, including the user-directed historical cleanup, or delegate independent work when that improves delivery or review. A delegation is optional; it does not replace the lead's responsibility to inspect the result and complete integration. Select model and effort for any delegated role, and record what actually ran. Keep one writer per shared seam.

Do not repeatedly rewrite plans. Improvise inside the selected task when necessary to make it correct and practical. Record a material interpretation briefly in the assignment; do not silently drop a product requirement or change an acceptance gate. Ask only for a material unresolved product decision or missing authorization.

Current execution: [NestJS migration and delivery ledger](NESTJS_MIGRATION.md). The user explicitly authorizes multiple independent Sol implementation tasks in separate worktrees for this migration, followed by review/integration and lead-owned OpenAPI/data handoff.

## Current planning boundary

All active plans cover backend services, processing, sources, permissions, recovery and API contracts for the user-owned UI. The user now authorizes bounded backend implementation/data tasks after normalization. The lead hardens plans directly; workers execute plan tasks. Do not change frontend technology, screens/components/styles or mobile/theme work. Public-portal work remains full product. Follow the normalized backend decisions. Keep supplied design references and the current UI untouched. Preserve exact identity/revision/selection semantics, compatible saved URLs and unique inspection capabilities at API boundaries. Backend evidence cannot qualify untested UI or a complete product release.

## Before dispatch: six decisions

1. What usable feature or concrete defect will this assignment deliver?
2. Which existing task and dependencies govern it? Read only the relevant contracts and current code/evidence needed to scope it. For source-dependent work, consult the [official source index](../api/real-sources.md) and its retained manifests before repeating discovery.
3. What must be preserved, and what is the smallest correct implementation through existing services?
4. Which files/seams does this worker own? Are any owned by another active worker?
5. What is the cheapest sufficient check: manual journey, existing targeted check, or a small risk-specific automated check?
6. What exact result lets us accept it, and which source/permission/release qualifications remain open?

Hardening means preventing a concrete failure: stale records, unsafe egress, false claims, broken selection, lost originals, incompatible contracts. It does not mean inventing adjacent features, exhaustive edge-case lists or a testing project.

## Stable model tasks

**Latest user override, 30 September:** the user resumed workers and selected GPT-6.1 Sol (`gpt-6.1-sol`) for ordinary work, with priority authorized. Do not use GPT-6 Sol for new dispatches or continuations. Reserve Astra for the most demanding work and highest-quality control, at standard/default speed and the previously agreed medium–xhigh efforts. This supersedes older model/tier instructions below while preserving their history. Reuse paused chats/worktrees and uncommitted checkpoints. Current dispatch exposes model and effort but no per-chat speed parameter; configured global default is not proof of a worker's actual tier. Do not change unrelated chat settings to manufacture a tier claim.

User direction, 29 September: new worker chats must belong to the local `3d-ulpin` project and inherit `approval_policy=never` / `sandbox_mode=danger-full-access`. Create the chat with the local project target, then use its separately assigned worktree explicitly for implementation. Check actual turn metadata or supplied permission instructions before implementation; an old chat can retain `on-request` / `workspace-write` despite full-access global config. Retire that chat, preserve its worktree checkpoint and transfer ownership to a verified new project chat. Do not repeatedly ask for already granted local permission. This does not grant live provider spending, public deployment or destructive data resets.

Use ordinary reusable Codex tasks for each model/role; do not spawn subagents. Reuse existing tasks where appropriate and create another task only when authorized by the user. Keep separate reusable tasks for each model/role. Do not switch their model between assignments merely to save creating a lane. Prefer stable instructions and short delta assignments; reference this guide and artifacts instead of reposting the whole plan. Cache hits are not guaranteed.

Use **GPT-6 Sol** by default, including implementation, research, manual verification and review. Use separate reusable role tasks/worktrees where independence matters, with effort suited to the work (high normally; xhigh/max for consequential code/review). On 29 September 2026 the user explicitly authorized **GPT-6 Astra for AI model training**, **local GPU training if useful**, and later **selecting, downloading and testing a suitable open pretrained model**. The existing learner task may be upgraded to Astra to preserve its context and exclusive file ownership. This supersedes the previous Sol-only, no-GPU and additional-model-download restrictions for the selected local work; it does not authorize priority tier, cloud spending or live provider calls. Download only a justified needed checkpoint with pinned revision, licence and hashes in a separate environment. Keep source-derived labels and untouched evaluation families separate, freeze settings before fitting, and measure bounded RTX 3070 memory/runtime use. CPU remains suitable when it is faster or sufficient for the small candidate.

**Astra effort, user direction 30 September:** choose `medium`, `high` or `xhigh` according to the assigned work. Reserve `max` for exceptional cases with a concrete expected benefit and state that reason briefly in the assignment; being an AI task or inheriting an earlier max setting is not sufficient. Routine source curation and bounded comparisons do not default to max. Apply the chosen effort explicitly when dispatching or continuing Astra, and preserve honest historical requested/observed settings. AI-06C source-only curation requested `high`; its recorded scope and frozen-data boundaries are unchanged.

Use the default service tier. The user's latest instruction revokes Fast/priority; local `service_tier = "default"` was verified on26September. The task API exposes no speed argument, and per-turn tier remains unobserved unless returned explicitly. Do not request priority or modify credentials, buy access, or retry authentication failures in a loop.

After dispatch, end the lead turn and resume only when a worker sends a message. Do not poll tasks, run wait loops or create wakeup/heartbeat schedules. A callback may trigger its needed review, fix or integration work and the next authorized dispatch, followed by another quiet wait.

Astra, Sol and Luna are the same model family. Their reviews are engineering checks, not the plan's independent cross-family/human milestone approval.

## Pipeline and ownership

Latest user direction, 30 September: expand useful parallel work beyond one implementation lane. GPT-6.1 Sol is an available ordinary-work choice, not an exclusivity rule; Astra high/xhigh is appropriate for demanding analysis/quality control. Keep one writer per seam and one learner owner; resource-sensitive runtime operations remain explicitly owned. Preserve the no-polling/callback workflow and do not reopen evaluations or repeat completed work to occupy workers.

Normally keep one implementation lane plus only useful verification/research lanes. For the authorized NestJS migration, run multiple independent Sol implementation lanes with exact module ownership after the shared foundation is accepted. Do not launch workers before dependencies are ready. Only the lead dispatches ordinary tasks; delegated owners do not create further tasks or subagents.

An owner finishes -> returns an exact diff or commit and concise evidence -> lead reviews the outcome -> optional manual tester checks a pinned revision. The lead may be that owner. While review/testing runs, scope the next dependency-ready, non-conflicting feature. Use separate worker worktrees from a pinned accepted staging commit; never switch another worker’s checkout or edit its owned files. Do not build dependent work on an unaccepted change merely to keep a worker busy.

Testers/reviewers own reports, not production code. They return reproducible issues with route/action, expected versus actual behavior, severity and a screenshot only when useful. Send fixes to the implementation lane. If it is already coding, choose a safe checkpoint or queue the fix; never let two owners edit the same seam. Blocking defects prevent integration of that result, not unrelated work.

Current checkout policy, updated by explicit user direction: the lead integrates in the original `staging` checkout; each ordinary worker model uses its own worktree and branch. Record a pinned base and exact file ownership. Reuse model tasks/worktrees; retire a worker worktree only after its commits and dirty files are reconciled. Preserve original checkout changes and its index state. Integrate one accepted change at a time, directly or through a delegated execution assignment. Keep main unchanged; no push/deploy/public activation without authorization. Do not reset populated services, rewrite originals, overwrite credentials or kill unrelated processes.

## MVP delivery and verification

**User direction, 27 September 2026: we are building an MVP.** Deliver a usable feature with enough review and verification that the main flow works with real, imperfect and unstructured inputs. Do not turn implementation into a testing, hardening or reporting project. This section is the default for every assignment and review, including work already underway; it supersedes older requests for exhaustive per-feature verification.

### What we are trying to achieve

A user can submit a supported file, follow its progress, get a useful result, and understand or recover from a failure without losing the original or breaking the rest of the application. Unstructured data means varying layouts, incomplete fields and imperfect readable content within the formats we support. It does not mean claiming every format or damaged file can be interpreted successfully.

For ingestion, preserve the unchanged original and produce separate traceable extraction results. When a supported file fails, fix the agent, reader or routing logic. Do not edit the document, hand-prepare a replacement, invent facts or build a one-file workaround to make a check pass. Distinguish extraction failure, unavailable OCR/provider, and genuinely missing information. An unsupported input should produce a clear recoverable status, not crash or stall the application, corrupt data, or pretend to have succeeded.

### Default working loop

1. Pick one useful feature and define its smallest end-to-end result. Reuse existing services and tools; avoid adjacent features and infrastructure that result does not need.
2. Implement it. Review the changed flow for obvious defects, broken contracts and relevant data/access risks. The lead can review it; use a separate reviewer only when the change materially benefits from one.
3. Run the relevant typecheck or build once after the code stabilizes. Use a small set of unchanged real inputs: normally one representative successful journey and one naturally difficult or incomplete input relevant to the feature. Reuse retained official sources before finding more.
4. Check the flow manually through the UI when it is wired, or directly through the API for backend-only work. Confirm the result, readable status and a useful failure/retry path. Do not build UI merely to test an API.
5. Fix observed defects and repeat only the affected check. Once the scoped checks pass and no known blocker remains, integrate, update the API handoff briefly and move to the next feature.

### When an automated test is worth adding

Prefer existing tests and verification tools. Add a small targeted test when it prevents a concrete regression or checks an important property that manual use cannot establish reliably—for example, unauthorized access, lost originals, duplicate writes or accepting stale results. Explain the reason in one sentence. A new shared write may need a focused concurrency check; it does not automatically need an exhaustive schedule matrix.

Do not add tests merely to mirror implementation, raise coverage, enumerate hypothetical edge cases or justify code already working. Do not create large protocol matrices, new harness frameworks, repeated full regressions, benchmark campaigns or extensive evidence reports for an ordinary feature. Do not rerun accepted unrelated work. Broader checks require a concrete unresolved risk or a separately scoped milestone.

### Definition of done

The promised flow works on the checked real inputs; the relevant difficult case fails clearly or recovers; changed code passes the relevant build/typecheck; and review has no known blocker affecting that flow, source integrity or access. The handoff states what works, what was checked and any material limitation in a few lines, with the API/schema updated where needed. Unsupported capabilities stay explicit rather than expanding the current task indefinitely.

Do not weaken an access check, discard originals or label missing evidence as a pass to save time. Equally, do not hold a usable MVP feature hostage to unrelated future requirements. Unrun release, scale, accuracy and full-product gates remain unqualified; they are not mandatory new campaigns for every feature. Missing source coverage should be recorded briefly and should not halt unrelated implementation. Never manufacture operational test records, geometry, source documents or expected facts.

## On-demand local preview

The user released the standing preview on 26 September 2026. Start the loopback preview at `http://127.0.0.1:3187` only when a task needs it; temporary verification can use other ports. Verify the port is free before startup and never kill an unrelated listener. Stop owned app processes after the task unless the user asks to keep them running. No scheduler or polling automation is needed.

The code owner serves a pinned preview from its explicitly assigned worktree with owned isolated services and the existing guard. Coordinate app-only restarts at safe checkpoints when changing the served revision. Preserve original/linked data and keep providers disabled. Record the served commit, URL, owned process/service identities and stop command without secrets. A candidate preview must be labelled as awaiting review; a running server is not release acceptance.

When a preview is running, record its URL and served revision for manual testing and status checks. Refresh it only at a safe checkpoint coordinated with the active tester; do not silently test one revision while changing its files. Preserve its isolated data volumes during app or container shutdown. User-entered preview changes are not permission to overwrite originals or discard data.

## Compact assignment and return

Assignment: task ID/attempt; outcome and relevant plan sections; exact base/checkout; owned paths/exclusions; model/effort; a few acceptance checks; callback destination. Include only changes from standing rules.

Worker return: exact code/result commits, what changed, commands/check results, short relevant verification instructions, known limitations, dirty paths and owned-resource cleanup. Preserve actual failure evidence but do not send raw logs or repeat the entire task history. All agents are sharing a codebase: never revert others' changes.

Lead review: accept bounded work, request specific corrections, or record a concrete blocker. After two unsuccessful fixes of the same defect, escalate that defect with existing evidence rather than restarting the whole feature. Avoid endless cosmetic review loops. A configuration, unit test or screenshot alone does not pass a runtime gate.

Use tool-based completion callbacks and compact ledger updates. No polling loops, heartbeat automation or status chatter for unchanged work. Do not start new work solely to manufacture activity. Maintain a short queue of actual work and return attention to the core product.
