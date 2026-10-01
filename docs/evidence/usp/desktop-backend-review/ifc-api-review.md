# IFC-02-R — private canonical IFC workflow review

1 October 2026. **Two actionable findings; return to the owner before acceptance.** This is an independent code/evidence review, with two targeted local controls. It does not authorize integration or qualify HTTP, PostgreSQL/private-object persistence or launch.

## Reviewed revision and scope

- Candidate `24879bdeb41e2820a36ce1061c2b321844e3e66f`; implementation `f20e97a6701a8866c9df9455eb438c15098c838c`, tree `ce700854d406c63defb7be9e7eaf33f9ee96ee35`; base `d42b2fb8df0c2021a0f1106015ff830db0cd5acc`. Reviewed the complete 27-file delta and relevant authority callers.
- Existing clean reviewer worktree `C:/Users/kvina/.codex/worktrees/desktop-ifc-api-review/3d-ulpin`, branch `task/desktop-ifc-api-audit`. Read-only staging matched dispatch `4f6ca13858823c9453ca14854aa81ed81a2700f1`. Neither staging nor the implementation checkout was changed.
- Read AGENTS, operating guide, migration ledger, normalized decisions, IFC-02 including lead amendments, relevant handoffs/release boundary, source index/catalogue, accepted IFC-01 review and returned IFC API handoff. GF0 remains pending. Accepted native parser/CLI behavior was not reopened.
- Supplied permissions verified as `approval_policy=never` / `sandbox_mode=danger-full-access`. Requested Astra/xhigh/default-standard; actual model, effort and per-turn tier are not independently exposed. No speed/config change was made.
- Own only this report and `E:/BhuAayam-data/task-data/desktop-ifc-api-review/`.

## Findings

### 1. [P1] Refuse generic retry before creating an unregistered IFC job

The existing `POST /api/v1/jobs/{jobId}/retry` remains reachable through `CasesController.retry` (`apps/api/src/modules/intake/cases.controller.ts:86–91`) and `CaseIntakeService.retry`. `packages/server/src/modules/cases/domain.ts:885–921` rejects projected-vector, MVT and document jobs, but accepts a failed `ifc-native` job and inserts a new job with its old payload/input fingerprint and **no `usp_job_metadata` row**. The new worker's inner join at `packages/server/src/modules/usp/ingestion/ifc-worker.ts:66–68` returns no row and exits, leaving that job queued permanently. Its payload also retains the old job ID.

The targeted control ran the exact candidate `retryJob`, `jobFrom`, `runIFCJob` and `executeIFCJob` function bodies with memory-only SQL/lock doubles. Both failed IFC inputs returned a new `queued` job; both remained queued after the worker, with no metadata and mismatched payload/new job IDs. Two such jobs fill the global `IFC_LIMITS.active=2` count checked in `ifc.ts:89–90`, so subsequent canonical IFC receipt/retry requests are refused. No native process or storage call is needed to trigger it.

Expected: reject generic retry with an IFC-specific canonical-retry-required response before mutation, directing recovery through the source-bound IFC retry route. Add a narrow caller-level regression control. Keep the strict worker join/fencing; synthesizing missing authority inside the worker would hide this invalid enrollment path. The finding is introduced for the newly supported IFC operation even though the generic helper predates this change. Receipt: `retry-control.json` below. Actual HTTP/persistence remains unrun.

### 2. [P2] Include executable Python caches in the runtime trust boundary

`packages/server/src/modules/usp/ingestion/ifc-config.ts:44–46` and `scripts/usp/ifc/profile.py:18–23` skip every `__pycache__` directory and `.pyc` file. Python still **reads** valid caches under `-I -S -B`; `-B` only suppresses writes. The wrapper adds the profiled environment's site-packages to the loader path (`server.py:164–166`), and the accepted CLI's child also imports from that directory. Thus a changed cache can execute while the profile/source digests and both inventory verifications remain unchanged. Source hashes alone do not identify the executed dependency code in this configuration.

The isolated control created a small inventory skeleton and one protocol-only package inside the private review directory. Its pinned source returned `PINNED_SOURCE`; a timestamp/size-valid cache returned `UNPINNED_CACHE`. The unchanged candidate Python inventory/`verify` accepted the exact same file list before and after, while the actual pinned interpreter invoked with `-I -S -B` returned `UNPINNED_CACHE` and `dont_write_bytecode=true`. Source bytes remained unchanged. This proves a local runtime-drift gap, not a remote IFC-file exploit or evidence that the retained environment is compromised.

Expected: either pin/verify all executable cache bytes, or enforce a loader/cache policy that cannot execute unverified caches in the wrapper and native child, including imports before verification. Merely adding `-B` is insufficient. Fix the wrapper/profile boundary without silently rewriting the accepted reader. Receipt: `bytecode-control.json` below. No retained environment, source, parser or shared cache was modified.

## Authority and compatibility review

The canonical IFC path otherwise reuses existing source/operation/job/attempt/outbox authority. Input fingerprints bind case/context, source family/revision/hash/size/key, subject/access and reader/tools. Private reads check current authority before and after object I/O. Artifact acceptance reads back the bounded result and native artifact before the current attempt commits. Case/destination locks precede job/metadata/attempt locks. Terminal updates respect owner/fence/state; ambiguous COMMIT preserves authority and objects instead of overwriting success or deleting possibly committed originals. Result objects left by failed acceptance stay unreachable. No independent actionable defect was established in these paths.

Reviewed generic original download and stream refusal, source projection redaction, snapshot capture/read, package/copy admission and copied-source ancestry. Captured or current malformed/null IFC markers are protected, including absent current rows. The missing generic retry guard above is a separate reachable mutation path.

The wrapper retains the fixed host mutex and named kill-on-close two-process Job, with nested parser Job, sanitized environment, bounded reply, cancellation reaper and guarded scratch cleanup. Shared Job capacity prevents a replacement parser from exceeding the predecessor's remaining process slot. Saved cancellation evidence observes an actual parser termination; it is not a proof of every process interleaving. Original/artifact limits remain 32/16 MiB, process/tree ceiling 2 GiB, parse/wrapper/worker budgets 60/90/150 seconds under the 180-second lease. Two affinity cores, one compute pool and sampled helper-thread allowance remain the accepted interpretation. Runtime code pinning is subject to finding 2.

Traced every call to `assertProjectedReadInput`, `acceptedProjectedTx`, `sealedPrefixTx`, `mvtContextTx`, `assertMvtInputTx` and the MVT read predicate. Explicit immutable-read propagation covers projected status/page/geometry and its post-I/O check, semantic chunks, MVT generations and sufficiency. Enrollment/reuse for execution, semantic publication/sealing/recovery, MVT compilation/publication and current-job assertions retain current-exact defaults. A receipt/status replay does not enroll or execute an old producer. Preparations/seals compare against their **stored** publisher pin; self-hashes, source/access/revision/parser/input, chain/observation/closure and asset checks remain. Earlier MVT exceptions retain their original semantics. No stored hash is rewritten.

The exact two pre-IFC physical/Git representations reconstruct successfully: MVT `37f9c493…` / `9a979001…`, semantic `2fc75b28…` / `2410cb1d…`. Unknown profiles remain denied; every non-code MVT field must match. Full constituent hashes and all old/new aggregate values are in the matched owner receipt and reviewer reconciliation. CityJSON validator remains strict; its new physical/Git digest is `68b36dea13d51740eeaa37313d309214c6d9af6f64efa1001dc521dbc10f25a9` / `ebd6a2f21e383866679ec995eb65ba20a8a687504da5240c9542214ba0c0a851`. Historical explicit validations may be producer-stale as expressly accepted; no exception or reprocessing was introduced.

## Evidence reconciliation and targeted commands

Matched `api-checks/final-pins.json` SHA256 `6c3d41254e3017007ff83423f8573121c430bd56fd590ceb0d878e50619877ef`: **6,254 comparisons passed**, covering old/new constituent and aggregate hashes, original and saved artifact hashes/sizes, seven receipt files, interpreter/tool pins, unchanged reader/CLI Git bytes, and all 3,022 inventoried runtime files (175,690,666 bytes). Nine clean-reviewer physical files differ from the tested owner's physical bytes due to checkout line endings; both representations are recorded, not substituted. The cache exclusion described above limits what that inventory proves.

Reused matched saved checks: 15 focused passes/one configured-process skip; one IFC4 summary supplement; one no-listener Nest route pass; backend typecheck; one configured host-worker run through SQL/storage doubles (21.402 seconds); and three BUSY/cancel/profile-drift controls. The final host artifact matches retained IFC2X3 output `66dcfb321cac47b605ffed87beaf060b50b1203a151b738fe446b6251d003d3a`, 55,011 bytes/45 records. Earlier loader-gap run `worker-local-process.txt` remains separate (SHA `895f78b8825802a1dcbcca0cb970df32b4ddb47d00a88d5f6c7ac37e8411e7b9`). No saved campaign was rerun.

Reviewer commands ran from the explicit reviewer worktree:

- Existing `env/Scripts/python.exe -I -B <private>/bytecode-control.py`: exit 0, reproduces finding 2.
- Existing `env/Scripts/python.exe -I -B <private>/reconcile.py`: final exit 0, all comparisons match. First run exited 1 because the reviewer used `{path, sha256}` instead of the validator's `{file, sha256}` aggregate representation; initial receipt remains preserved separately. No candidate defect was inferred from that harness error.
- `node <private>/retry-control.cjs`: corrected control exit 0, reproduces finding 1. Initial harness parse failed before execution due to a CJS `exports` variable collision; renamed the harness variable only. A following wildcard hash command mistakenly included a directory and made that combined shell call exit 1; the control itself finished with exit 0. Exact-file hash enumeration subsequently passed.
- `git diff --check d42b2fb8df0c2021a0f1106015ff830db0cd5acc 24879bdeb41e2820a36ce1061c2b321844e3e66f`: exit 0.

Private reviewer receipts under `E:/BhuAayam-data/task-data/desktop-ifc-api-review/`:

| File | Bytes | SHA256 |
| --- | ---: | --- |
| `reconciliation-final.json` | 5,046 | `7cac0de41e46352464c8fbc44efbd7662f3d0665a66e84cf76bbf3bc5f5d0328` |
| `bytecode-control.json` | 1,143 | `c27626654c9b347d58bd7dfd12c7197a66f6013d58d383fa834971340f96a0dd` |
| `retry-control.json` | 2,693 | `f07e883c0a08b34ac0c6f87e3a51ac7bd49fde08e6ec02b34ba3e46b570ce142` |

## Limits and cleanup

The two unchanged buildingSMART CC-BY-4.0 certification examples remain `test_only`, with unknown/unqualified physical geography and unapplied source reference metadata. Neither summary nor metadata establishes geometry, global placement, legal units, ownership, association or learning truth. Live HTTP/PostgreSQL/private-object persistence, Linux, performance at larger inputs and release gates remain unqualified.

No production/generated/frontend file, services, Docker/socket, providers, models, GPU, additional workers or schedules were touched. No dependency installation or native IFC rerun occurred. Probe processes exited; retained owner scratch was empty. Private probe inputs/results and initial diagnostic receipts remain for reproduction. Return this report by the authorized lead callback, then stop.
