# CITYJSON-VALIDITY-02-R — validation job review

1 October 2026. **Changes requested: two P2 findings.** Review covers the 18-file candidate `1dae7f14deb77d2036232230777b26f9994c952f` against exact base `90e4528706d566a5b571e312db20eb37d26f08e6`, handoff `933724b791d049775faa1666d6b1949d79d02e00`, under assignment at lead `cfb58c9fa64adfca69fee51fe633aaa0f6ef55d8`. No new persisted validation or SQL contention was run.

Branch `task/desktop-cityjson-validation-review`, worktree `C:/Users/kvina/.codex/worktrees/point-review/3d-ulpin`, clean before review. Completed draft review branch remains at `c16a5f41129c5b6a74dff95ca0df390fe1baca6f`. Primary staging was read-only and its coordinated production seams match the base. Requested Astra/xhigh/default-standard; actual model/effort/tier remain unexposed. Supplied permissions verified as `never` / `danger-full-access`. No new workers.

## P2 — make database phases obey the worker deadline

Location: `packages/server/src/modules/registry/cityjson-validation-worker.ts:76–82`; related `:61–67`, `:100–112` and failure bookkeeping `:25–38`.

The 300-second timer only aborts the controller used by object I/O and the native supervisor. `current()`, heartbeat/claim/accept and failure bookkeeping use ordinary transactions with no signal, lock timeout or statement timeout. `infrastructure/db.ts:42–57` also supplies no query cancellation; the pool's connection timeout does not bound row/advisory waits. Claim happens before this worker timer is installed. Finally, `await checking` waits for any monitor query even after the timer has been cleared.

Concrete reproduction schedule (static, no application SQL executed): claim a validation, then let a second transaction hold its `registry-import:<case>` advisory gate or site row beyond the worker deadline. The monitor and/or post-process `current()` waits at that lock. At 300 seconds the controller becomes aborted, but the awaited query remains blocked. If native execution already rejected, the catch instead waits on `failCityJSONValidationJob`, which requests the same gate without a bound. The promise remains pending and `processing.ts:213–215` cannot clear the sole `cityjsonValidationWorker` slot, preventing subsequent validation jobs in that dispatcher from starting. A timeout/stop therefore does not provide the promised bounded worker cleanup.

The same omission reaches publication: the callback checks the signal before returning to `acceptUspJobAttempt`, but that helper then awaits accepted-state/outbox writes and COMMIT without another deadline check. A database wait after that check can finish publication after the deadline. The native 120-second process timer does not cover these SQL phases.

Use one absolute worker deadline starting before claim, with actual query/transaction cancellation or bounded lock/statement waits, bounded failure cleanup, and a deadline check through the final commit boundary. Do not merely race an uncancelled transaction against a timer, since it could continue holding locks or publish later. A focused control should hold the authority lock through deadline/stop and show worker release with no late acceptance; no broad validation rerun is needed.

## P2 — project canonical cancellation into the status contract

Location: `packages/server/src/modules/registry/cityjson-validation.ts:168–170`.

The new status response passes `row.job.error` directly into a schema that only accepts `CITYJSON_VALIDATION_*` codes (`packages/contracts/src/registry-cityjson-validation.ts:33`). Canonical `cancelUspJob` writes `jobs.status='failed'`, metadata state `cancelled`, and `jobs.error='Cancelled by local operator'` (`modules/usp/jobs.ts:173–182`). With otherwise current draft/source authority, reading that validation reaches the response parser and throws a Zod error instead of returning a useful cancelled/failed outcome. The Nest exception filter maps this to 422 `INVALID_INPUT` despite valid read parameters. Worker failure bookkeeping preserves cancelled terminal metadata and cannot replace that string.

Focused no-service reproduction called the actual `cancelUspJob(jobId, 1)` against an in-memory client, then passed its resulting status/error through the actual validation response schema. Cancellation completed, status was `failed`, and parsing rejected only `code`. The repository currently has no HTTP caller of this generic cancellation helper; this is a demonstrated canonical-helper/status integration defect, not an observed UI cancellation journey. It directly affects the assigned generic cancellation boundary.

Map `logical_state='cancelled'` to a controlled validation cancellation code/status before parsing, and allowlist other stored failures rather than passing arbitrary error text into the public contract. Preserve the canonical cancellation fence and existing callers. Check the actual cancellation-to-status path with current source authority, without starting validators.

## Other scoped observations

- Enrollment accepts only request key/current draft revision. Candidate/site/record/footprint/native source/result/fence/access/tool/config pins and geometry indices are server-derived. Same-key replay compares the exact enrolled input and returns the existing job; admission limits are serialized after source/destination authority. No caller report/path/verdict enrollment was found.
- Same-client authority retains the shared source-case gate before site/draft/source/native-job locks, then validation job/metadata/attempt locks. Claim, monitor, completion and status use current source/draft authority. Failure bookkeeping takes the gate before validation job locks and preserves terminal/cancelled or superseding attempts. Generic cancellation takes only job/metadata/attempt locks; no new inverse domain-lock edge was established. The missing deadline bounds above remain open.
- Native execution runs outside SQL transactions. Before accepted publication, report hashes/input/summary, current source/draft/tool configuration and live attempt are checked again. Accepted reads require matching metadata, accepted fence, attempt input and completion hash, verify immutable reports, then recheck aggregate authority. This is source inspection/control evidence, not persisted acceptance qualification.
- Fixed 32 KiB result envelopes, derived report keys and exact byte/hash verification preserve bounded private storage. The opt-in `putOriginal` path forwards its signal, permits only 412 conditional-create replay before streaming verification, and retains the prior no-signal behavior. No unbounded `readObject` fallback was added to the opted-in path.
- The offline adapter and tool-lock bytes are unchanged. Its retained cjval/val3dity parsers check report identity, coverage, parameters and verdict consistency. The new summary binds source/tool/report hashes and exact selected indices; only controlled codes/locators and version/hash pins appear in the normal result. Invalid remains a completed verdict; unsupported, unavailable and timeout are distinct.
- Explicit configured Python/tool/DLL/code pins, isolated Python arguments, an allowlisted environment, a Windows host mutex and kill-on-close Job Object are used. Process-tree ownership is established before native children launch. Node supervision has a separate 120-second timer and handles cancellation at listener attachment. Retained harmless-process controls exercise host exclusion/crash release and descendant cleanup; they do not prove every application startup/stop timing or network isolation. Offline flags are correctly not described as an OS network sandbox.
- New private Nest operations use guard/cache/query/body/status bounds and additive declarations. No geometry mutation, native draft recording bypass, positive qualification receipt or analytical predicate change was found. All qualification/reference/canonical-admission fields remain `not_assessed`.

## Evidence, checks and limits

Reused lead verification of `E:/BhuAayam-data/task-data/desktop-cityjson-validation-jobs/checkpoint-01/verification.json`, 14,541 bytes, SHA-256 `47e71a0be12a120170a5cfc0a84a03d1cecee917fa133f95a9ef75337e4d6bcc`: 18 physical/Git code pins and 24 auxiliary pins. Inspected retained backend typecheck exit 0, nine TypeScript controls (zero skips), two harmless Windows process controls, and their relevant code. No full suite, adapter campaign or original/native/draft runtime was repeated.

Reviewer checks:

- `git diff --check 90e4528706d566a5b571e312db20eb37d26f08e6 1dae7f14deb77d2036232230777b26f9994c952f`: exit 0.
- `pnpm exec tsx E:/BhuAayam-data/task-data/desktop-cityjson-validation-review/cancel-status-control.ts`: exit 0, reproducing the cancellation contract mismatch using no services. Script SHA-256 `3ae1b8a5a8648ce10ec99ad6bdff2940e330e5796414f8a0600f9f40379e7133`; adjacent JSON result SHA-256 `637a3bec855fa87950a578b0c7121674aebe41f0d1ee420cd961a8ab64fe791a`.

Retained Dutch 3DBAG D1 source remains 6,783 bytes / SHA-256 `5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2`, with existing attribution/licence and EPSG:7415/NAP limits. No Indian placement, reference accuracy, interiors/rights, canonical admission, analytical eligibility or exchange claim follows. Lead must reconcile the separately accepted reader LF attributes with physical served bytes before future runtime.

Only this report is committed; the isolated technical control is retained outside Git. No application DB/API/Docker query/start, fresh validators, source mutation, model/GPU/provider execution, frontend/generated/production edit, deployment or goal-tracker change. Implementation owner retains fixes; lead owns integration and any later explicit runtime transfer. Real validation-job enqueue/accept/read/retry, SQL contention and effective application timeout behavior remain unrun.
