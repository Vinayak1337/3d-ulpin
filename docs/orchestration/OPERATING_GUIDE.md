# 3D ULPIN orchestration operating guide

Engineering guide, reconciled 4 October 2026. [ORCHESTRATOR.md](ORCHESTRATOR.md) governs the delegation-only coordinator and worker settings; [WORK_ITEMS.md](WORK_ITEMS.md) is the current queue. This guide supplies engineering, verification and preview rules. Product/ML delivery remains paused until resumed. Historical plans do not override current user direction.

## Usage monitoring revoked

The user revoked the custom usage/reset stop rule on 26 September 2026 and requested continued backend work. The `3d-ulpin-usage-stop-guard` schedule has been deleted. Do not poll account usage, hold dispatch based on the former threshold, or recreate the schedule. Normal platform limits still apply; no credit redemption or purchases are authorized.

There is no self-imposed agent/token/usage budget cutoff. Choose effort for the task using the current prompt. Process/VRAM bounds remain operational safeguards.

## Production-quality engineering before launch clearance

User clarification, 30 September: build to production engineering standards now. Reliability, security, source integrity, recovery, maintainability and meaningful testing belong in the implementation. Formal legal/policy review, permission requests and production-launch approvals are deferred to the release workstream. Do not interpret the hackathon/prototype stage as permission to ship fragile architecture, omit access controls or replace actual functionality with a demonstration. The MVP rule still keeps each increment small and usable; it does not lower its engineering quality.

Look for existing harnesses, model adaptations, training techniques and system designs when a component is difficult or existing work can accelerate delivery. Inspect primary repositories, model cards, papers and examples, then adapt the smallest relevant component into our current authorities. Ordinary public research and local development experiments are already authorized; do not add repeated approval requests or make production clearance a development prerequisite.

Public community/research/vendor resources may support development experiments; this supersedes earlier official-source-only acquisition restrictions for that scope. Preserve origin, version, attribution and terms; separate published claims from our own measured behavior. A public benchmark, teacher output or model prediction is not automatically correct property evidence or a qualified relationship label. Keep official operational qualification, untouched evaluations and recorded identities intact. Track production-specific licensing, residency, redistribution and deployment approvals for the later launch gate. Choose a usable alternative when a resource cannot be accessed or used under its actual conditions, without stalling unrelated development.

Research returns a short evidence-backed comparison tied to the current gap and concrete reusable interfaces/techniques. The lead makes the integration decision; do not replace the registry, queue, model gateway or whole backend merely because a framework exists. Inspect dependencies before installation and use isolated environments for model trials. No framework/model popularity score substitutes for one useful real-input journey.

## Coordination and execution

The future orchestrator selects and routes work; workers execute implementation, technical review, verification, integration and documentation. Use the exact assignment/return procedure in [ORCHESTRATOR.md](ORCHESTRATOR.md). The user explicitly assigned the present lead to author that prompt and personally audit/list cleanup targets; this does not authorize the future orchestrator to take over implementation.

Do not repeatedly rewrite plans. Improvise within the selected task to make it correct and practical. Record a material interpretation briefly; do not silently drop a requirement or change a gate. Ask only for a material unresolved decision or genuinely missing authorization/data. Read the migration ledger only for the relevant accepted implementation/history, not as a live dispatch queue.

## Current planning boundary

All active plans cover backend services, processing, sources, permissions, recovery and API contracts for the user-owned UI. After a user resume, workers execute bounded backend/data tasks under the current queue and exclusive ownership. Do not change frontend technology, screens/components/styles or mobile/theme work. Public-portal work remains full product. Follow the normalized backend decisions. Keep supplied design references and the current UI untouched. Preserve exact identity/revision/selection semantics, compatible saved URLs and unique inspection capabilities at API boundaries. Backend evidence cannot qualify untested UI or a complete product release.

## Before dispatch: six decisions

1. What usable feature or concrete defect will this assignment deliver?
2. Which existing task and dependencies govern it? Read only the relevant contracts and current code/evidence needed to scope it. For source-dependent work, consult the [official source index](../api/real-sources.md) and its retained manifests before repeating discovery.
3. What must be preserved, and what is the smallest correct implementation through existing services?
4. Which files/seams does this worker own? Are any owned by another active worker?
5. What is the cheapest sufficient check: manual journey, existing targeted check, or a small risk-specific automated check?
6. What exact result lets us accept it, and which source/permission/release qualifications remain open?

Hardening means preventing a concrete failure: stale records, unsafe egress, false claims, broken selection, lost originals, incompatible contracts. It does not mean inventing adjacent features, exhaustive edge-case lists or a testing project.

## Worker ownership

Model/effort/speed and callback rules have one current definition in [ORCHESTRATOR.md](ORCHESTRATOR.md): Sol 6.1 high/xhigh, max for a stated hard problem, standard/default speed only. Ordinary local `3d-ulpin` chats use exclusive pinned worktrees and verified full local permissions. Preserve interrupted checkpoints. Do not poll usage/tasks, create wakeup schedules or manufacture activity.

Parallelize dependency-ready work only with separate files/resources. Reserve one writer per shared seam, one learner/GPU owner, and explicit runtime and integration owners. The staging integration worker receives a bounded exclusive window; all other workers leave that checkout read-only. It preserves the user index/changes, integrates only accepted owned commits, and publishes changed API contracts when required. Catalogue changes precede source-pin/OpenAPI/client generation. Main merges, remote pushes, provider calls and deployments require applicable authorization.

A technical reviewer returns concrete reproducible defects to the implementation owner; it does not also edit that owner's production code. A separate review is useful for consequential or uncertain changes, not every small edit. Do not reopen accepted reviews without new evidence. Model reviews do not substitute for a gate's independent/human acceptance.

No populated-service resets, altered originals, overwritten credentials or unrelated process kills. Archive a worktree only after exact commit/dirty/ignored-state classification, ownership reconciliation and preservation of needed ignored files. Follow the lead-authored [cleanup list](CLEANUP_20261004.md); deletion is not a blanket tidy-up command.

## MVP delivery and verification

**User direction, 27 September 2026: we are building an MVP.** Deliver a usable feature with enough review and verification that the main flow works with real, imperfect and unstructured inputs. Do not turn implementation into a testing, hardening or reporting project. This section is the default for every assignment and review, including work already underway; it supersedes older requests for exhaustive per-feature verification.

### What we are trying to achieve

A user can submit a supported file, follow its progress, get a useful result, and understand or recover from a failure without losing the original or breaking the rest of the application. Unstructured data means varying layouts, incomplete fields and imperfect readable content within the formats we support. It does not mean claiming every format or damaged file can be interpreted successfully.

For ingestion, preserve the unchanged original and produce separate traceable extraction results. When a supported file fails, fix the agent, reader or routing logic. Do not edit the document, hand-prepare a replacement, invent facts or build a one-file workaround to make a check pass. Distinguish extraction failure, unavailable OCR/provider, and genuinely missing information. An unsupported input should produce a clear recoverable status, not crash or stall the application, corrupt data, or pretend to have succeeded.

### Default working loop

1. Pick one useful feature and define its smallest end-to-end result. Reuse existing services and tools; avoid adjacent features and infrastructure that result does not need.
2. Implement it. Review the changed flow for obvious defects, broken contracts and relevant data/access risks. The implementer reviews its changed flow; use a separate technical reviewer when the change materially benefits from one. The orchestrator only routes the return.
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

Orchestrator disposition: route accepted bounded work to integration, request a specific correction, or record a concrete blocker. Technical findings come from the assigned implementer/reviewer. After two unsuccessful fixes of the same defect, escalate that defect with existing evidence rather than restarting the whole feature. Avoid endless cosmetic review loops. A configuration, unit test or screenshot alone does not pass a runtime gate.

Use tool-based completion callbacks and compact ledger updates. No polling loops, heartbeat automation or status chatter for unchanged work. Do not start new work solely to manufacture activity. Maintain a short queue of actual work and return attention to the core product.

For image-heavy source review, inspect derivative file sizes before sending them to the model and use legible focused crops plus short persisted observations. Repeated large image views accumulate in the request even when each tool call succeeds. If HTTP 413 rejects the history, preserve disk checkpoints and move only unfinished work to a suitable idle task with a compact handoff; do not repeatedly retry/fork the same oversized history, bulk-read transcripts, or raise shared transport limits as a routine workaround. Keep original source bytes unchanged.
