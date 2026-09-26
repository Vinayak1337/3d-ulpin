# 3D ULPIN orchestration operating guide

User direction, 26 September 2026. Read this before every assignment, review, continuation and integration decision. This guide overrides older orchestration/model/testing instructions; backend requirements and release qualification remain intact; the 26 September backend-only scope supersedes older UI implementation plans.

## Role: own delivery and use delegation when useful

The lead reads the relevant plan/task, identifies the actual work, owns its result and coordinates file ownership. The lead may execute a bounded task directly, including the user-directed historical cleanup, or delegate independent work when that improves delivery or review. A delegation is optional; it does not replace the lead's responsibility to inspect the result and complete integration. Select model and effort for any delegated role, and record what actually ran. Keep one writer per shared seam.

Do not repeatedly rewrite plans. Improvise inside the selected task when necessary to make it correct and practical. Record a material interpretation briefly in the assignment; do not silently drop a product requirement or change an acceptance gate. Ask only for a material unresolved product decision or missing authorization.

## Current planning boundary

All active plans cover backend services, processing, sources, permissions, recovery and API contracts for the user-owned UI. The user now authorizes bounded backend implementation/data tasks after normalization. The lead hardens plans directly; workers execute plan tasks. Do not change frontend technology, screens/components/styles or mobile/theme work. Public-portal work remains full product. Follow the normalized backend decisions. Keep supplied design references and the current UI untouched. Preserve exact identity/revision/selection semantics, compatible saved URLs and unique inspection capabilities at API boundaries. Backend evidence cannot qualify untested UI or a complete product release.

## Before dispatch: six decisions

1. What usable feature or concrete defect will this assignment deliver?
2. Which existing task and dependencies govern it? Read only the relevant contracts and current code/evidence needed to scope it.
3. What must be preserved, and what is the smallest correct implementation through existing services?
4. Which files/seams does this worker own? Are any owned by another active worker?
5. What is the cheapest sufficient check: manual journey, existing targeted check, or a small risk-specific automated check?
6. What exact result lets us accept it, and which source/permission/release qualifications remain open?

Hardening means preventing a concrete failure: stale records, unsafe egress, false claims, broken selection, lost originals, incompatible contracts. It does not mean inventing adjacent features, exhaustive edge-case lists or a testing project.

## Stable model tasks

Use ordinary reusable Codex tasks for each model/role; do not spawn subagents. Reuse existing tasks where appropriate and create another task only when authorized by the user. Keep separate reusable tasks for each model/role. Do not switch their model between assignments merely to save creating a lane. Prefer stable instructions and short delta assignments; reference this guide and artifacts instead of reposting the whole plan. Cache hits are not guaranteed.

| Lane | Model | Effort selection |
| --- | --- | --- |
| Lead orchestration | GPT-6 Astra | High normally; xhigh/max for difficult coordination decisions |
| Implementation | GPT-6 Sol | High for bounded changes; xhigh/max for complex implementation or integration; medium/low for simple fixes |
| Research, official data discovery, administrative work | GPT-6 Luna | Max only for every assignment |
| Backend contract verification | GPT-6 Luna | Max only; use Sol when code execution is the better fit |
| Risk review | GPT-6 Astra | Xhigh/max for consequential security, privacy, transaction or geometry reviews; high/medium for bounded reviews |

A straightforward review can use Sol in a separate review assignment when useful. Tiny fixes may go to Luna only with explicit isolated ownership; Sol remains the default code writer. The user authorizes more expensive workers for upcoming assignments and prioritizes quality: use higher-effort Sol or Astra where complexity or consequence warrants it, without expanding scope or repeating unnecessary checks. Every Luna worker must use max only. Other models may use any supported effort appropriate to the task. Verify observed model/effort rather than claiming the requested setting was applied.

Fast is the requested default. The local configuration was observed with `service_tier = "priority"`; the task API exposes no speed argument. Report requested Fast, configured tier and observed per-turn tier separately. If turn metadata omits the tier, say unobserved. Do not modify host authentication/configuration, buy API access or retry an authentication failure in a loop; report the blocker once.

Astra, Sol and Luna are the same model family. Their reviews are engineering checks, not the plan's independent cross-family/human milestone approval.

## Pipeline and ownership

Keep one implementation lane, one optional manual-test/research lane and one optional bounded review lane. Do not launch all three without useful independent work. Only the lead dispatches ordinary tasks; delegated owners do not create further tasks or subagents.

An owner finishes -> returns an exact diff or commit and concise evidence -> lead reviews the outcome -> optional manual tester checks a pinned revision. The lead may be that owner. While review/testing runs, scope the next dependency-ready, non-conflicting feature. Use separate worker worktrees from a pinned accepted staging commit; never switch another worker’s checkout or edit its owned files. Do not build dependent work on an unaccepted change merely to keep a worker busy.

Testers/reviewers own reports, not production code. They return reproducible issues with route/action, expected versus actual behavior, severity and a screenshot only when useful. Send fixes to the implementation lane. If it is already coding, choose a safe checkpoint or queue the fix; never let two owners edit the same seam. Blocking defects prevent integration of that result, not unrelated work.

Current checkout policy, updated by explicit user direction: the lead integrates in the original `staging` checkout; each ordinary worker model uses its own worktree and branch. Record a pinned base and exact file ownership. Reuse model tasks/worktrees; retire a worker worktree only after its commits and dirty files are reconciled. Preserve original checkout changes and its index state. Integrate one accepted change at a time, directly or through a delegated execution assignment. Keep main unchanged; no push/deploy/public activation without authorization. Do not reset populated services, rewrite originals, overwrite credentials or kill unrelated processes.

## Lean verification

Default for backend work: inspect the actual producer/consumer contract, verify the affected operation and one relevant failure/recovery state, then fix concrete defects. Plan-only work uses document/link/schema checks. UI design and browser acceptance are a separately assigned user-owned integration dependency; do not turn backend validation into a redesign or screenshot project.

Workers run typecheck and directly relevant existing checks once. Prefer fixing/updating a directly affected existing test to adding a new suite. Add an automated test only for a concrete high-impact failure that manual UI inspection cannot establish, such as authorization, privacy/egress, identifier uniqueness, transactions, geometry calculations or data integrity. State the reason in one sentence.

Do not add mirrored implementation tests, broad speculative matrices, screenshots for every trivial edit, repeated full regressions, benchmark work or elaborate harnesses for low-impact changes. Reuse the established guarded preview and evidence tools. Repeat a check only after a relevant change, failure or unresolved concern. Broader checks belong at meaningful integration/release boundaries. Retain release requirements; defer their comprehensive verification honestly rather than weakening them.

Use real unchanged official sources, data.gov.in first or the responsible issuer. Never invent operational records, dummy PII, geometry, documents/images or adverse source fixtures. Preserve real gathered originals and lineage; selectively retire obsolete synthetic assets only after exact-path or exact-record review. Missing official coverage stays unqualified; do not manufacture it or halt unrelated implementation.

## On-demand local preview

The user released the standing preview on 26 September 2026. Start the loopback preview at `http://127.0.0.1:3187` only when a task needs it; temporary verification can use other ports. Verify the port is free before startup and never kill an unrelated listener. Stop owned app processes after the task unless the user asks to keep them running. No scheduler or polling automation is needed.

The code owner serves a pinned preview from its explicitly assigned worktree with owned isolated services and the existing guard. Coordinate app-only restarts at safe checkpoints when changing the served revision. Preserve original/linked data and keep providers disabled. Record the served commit, URL, owned process/service identities and stop command without secrets. A candidate preview must be labelled as awaiting review; a running server is not release acceptance.

When a preview is running, record its URL and served revision for manual testing and status checks. Refresh it only at a safe checkpoint coordinated with the active tester; do not silently test one revision while changing its files. Preserve its isolated data volumes during app or container shutdown. User-entered preview changes are not permission to overwrite originals or discard data.

## Compact assignment and return

Assignment: task ID/attempt; outcome and relevant plan sections; exact base/checkout; owned paths/exclusions; model/effort; a few acceptance checks; callback destination. Include only changes from standing rules.

Worker return: exact code/result commits, what changed, commands/check results, short relevant verification instructions, known limitations, dirty paths and owned-resource cleanup. Preserve actual failure evidence but do not send raw logs or repeat the entire task history. All agents are sharing a codebase: never revert others' changes.

Lead review: accept bounded work, request specific corrections, or record a concrete blocker. After two unsuccessful fixes of the same defect, escalate that defect with existing evidence rather than restarting the whole feature. Avoid endless cosmetic review loops. A configuration, unit test or screenshot alone does not pass a runtime gate.

Use tool-based completion callbacks and compact ledger updates. No polling loops, heartbeat automation or status chatter for unchanged work. Do not start new work solely to manufacture activity. Maintain a short queue of actual work and return attention to the core product.
