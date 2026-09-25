# 3D ULPIN orchestration operating guide

User direction, 26 September 2026. Read this before every assignment, review, continuation and integration decision. This guide overrides older orchestration/model/testing instructions; product plans and their release requirements remain intact.

## Role: orchestrate, do not implement

The lead reads the relevant plan/task, identifies the actual work, hardens the assignment, selects model/effort, delegates, evaluates returned evidence and directs fixes. Do not write application code, run manual tests, create test suites, acquire datasets or perform implementation work yourself. Delegate execution, verification and Git integration. Maintaining this guide, concise assignments and the lead-owned coordination ledger is orchestration work.

Do not repeatedly rewrite plans. Improvise inside the selected task when necessary to make it correct and practical. Record a material interpretation briefly in the assignment; do not silently drop a product requirement or change an acceptance gate. Ask only for a material unresolved product decision or missing authorization.

## Before dispatch: six decisions

1. What usable feature or concrete defect will this assignment deliver?
2. Which existing task and dependencies govern it? Read only the relevant contracts and current code/evidence needed to scope it.
3. What must be preserved, and what is the smallest correct implementation through existing services?
4. Which files/seams does this worker own? Are any owned by another active worker?
5. What is the cheapest sufficient check: manual journey, existing targeted check, or a small risk-specific automated check?
6. What exact result lets us accept it, and which source/permission/release qualifications remain open?

Hardening means preventing a concrete failure: stale records, unsafe egress, false claims, broken selection, lost originals, incompatible contracts. It does not mean inventing adjacent features, exhaustive edge-case lists or a testing project.

## Stable model tasks

Keep separate reusable chats for each model/role. Do not switch their model between assignments merely to save creating a lane. Prefer stable instructions and short delta assignments; reference this guide and artifacts instead of reposting the whole plan. Cache hits are not guaranteed.

| Lane | Model | Effort selection |
| --- | --- | --- |
| Lead orchestration | GPT-6 Astra | High normally; xhigh for a specific difficult coordination decision |
| Implementation | GPT-6 Sol | High normally; medium/low for a bounded simple fix; xhigh only for difficult integration |
| Research, official data discovery, administrative work | GPT-6 Luna | Low/medium normally; high for difficult source reconciliation |
| Manual UI testing | GPT-6 Luna | xhigh; Sol high if the tooling or workflow exceeds Luna's capability |
| Risk review | GPT-6 Astra | High for security, privacy, transactions or geometry; medium for a small targeted review |

A straightforward review can use Sol in a separate review assignment when useful. Tiny fixes may go to Luna only with explicit isolated ownership; Sol remains the default code writer. Do not default every job to xhigh. Verify observed model/effort rather than claiming the requested setting was applied. Use only low through xhigh; no max/ultra.

Astra, Sol and Luna are the same model family. Their reviews are engineering checks, not the plan's independent cross-family/human milestone approval.

## Pipeline and ownership

Keep one implementation lane, one optional manual-test/research lane and one optional bounded review lane. Do not launch all three without useful independent work. Only the lead dispatches; workers do not spawn other workers.

Worker finishes -> returns exact commit and concise evidence -> lead reviews the outcome -> optional manual tester checks that pinned commit. While review/testing runs, assign the next dependency-ready, non-conflicting feature to the implementation worker on its own branch. Do not build dependent work on an unaccepted change merely to keep a worker busy.

Testers/reviewers own reports, not production code. They return reproducible issues with route/action, expected versus actual behavior, severity and a screenshot only when useful. Send fixes to the implementation lane. If it is already coding, choose a safe checkpoint or queue the fix; never let two owners edit the same seam. Blocking defects prevent integration of that result, not unrelated work.

Each implementation uses an isolated worktree and pinned base. Preserve original checkout changes. Integrate one accepted change at a time through a delegated execution assignment. Keep main unchanged; no push/deploy/public activation without authorization. Do not reset populated services, rewrite originals, overwrite credentials or kill unrelated processes.

## Lean verification

Default for a visible feature: implement -> inspect the actual UI -> complete the main journey -> check one relevant empty/error state -> fix concrete defects. Use desktop light mode; mobile optimization is deferred. Check keyboard/zoom when the changed UI can affect them. Replace legacy presentation progressively inside its existing feature card.

Workers run typecheck and directly relevant existing checks once. Prefer fixing/updating a directly affected existing test to adding a new suite. Add an automated test only for a concrete high-impact failure that manual UI inspection cannot establish, such as authorization, privacy/egress, identifier uniqueness, transactions, geometry calculations or data integrity. State the reason in one sentence.

Do not add mirrored implementation tests, broad speculative matrices, screenshots for every trivial edit, repeated full regressions, benchmark work or elaborate harnesses for low-impact changes. Reuse the established guarded preview and evidence tools. Repeat a check only after a relevant change, failure or unresolved concern. Broader checks belong at meaningful integration/release boundaries. Retain release requirements; defer their comprehensive verification honestly rather than weakening them.

Use real unchanged official sources, data.gov.in first or the responsible issuer. Never invent operational records, dummy PII, geometry, documents/images or adverse source fixtures. Existing historic corpora are retained regression only. Missing official coverage stays unqualified; do not manufacture it or halt unrelated implementation.

## Persistent local preview

Reserve `http://127.0.0.1:3187` for the user-visible running preview; temporary verification must use other ports. Verify the port is free before first startup and never kill an unrelated listener. Keep this loopback-only server running after handoff until the user requests it stopped or maintenance requires a coordinated restart. No scheduler or polling automation is needed.

The coding worker maintains a dedicated pinned preview worktree and owned isolated services using the existing guarded setup. Never serve from a worktree whose branch is changing during implementation. Preserve original/linked data and keep providers disabled. Record the served commit, URL, owned process/service identities and stop command without secrets. A candidate preview must be labelled as awaiting review; a running server is not release acceptance.

Reuse this URL for manual testing and user status checks. Every manual handoff and relevant shipped-work update names the already-running URL and served revision. Refresh the same preview only at a safe checkpoint coordinated with the active tester; do not silently test one revision while changing its files. Do not tear down the persistent preview as part of unrelated test cleanup. User-entered preview changes are not permission to overwrite originals or discard the preview's state.

## Compact assignment and return

Assignment: task ID/attempt; outcome and relevant plan sections; exact base/worktree; owned paths/exclusions; model/effort; a few acceptance checks; callback destination. Include only changes from standing rules.

Worker return: exact code/result commits, what works, commands/check results, short manual-test instructions, known limitations, dirty paths and owned-resource cleanup. Preserve actual failure evidence but do not send raw logs or repeat the entire task history. All agents are sharing a codebase: never revert others' changes.

Lead review: accept bounded work, request specific corrections, or record a concrete blocker. After two unsuccessful fixes of the same defect, escalate that defect with existing evidence rather than restarting the whole feature. Avoid endless cosmetic review loops. A configuration, unit test or screenshot alone does not pass a runtime gate.

Use tool-based completion callbacks and compact ledger updates. No polling loops, heartbeat automation or status chatter for unchanged work. Do not start new work solely to manufacture activity. Maintain a short queue of actual work and return attention to the core product.
