# IFC-02-R — focused correction closure

## Disposition

**Both findings in the original IFC API review are closed for this candidate. No further actionable finding was established in the correction delta.** Recommend accepting the corrections at the existing code/local Windows process checkpoint. Lead owns integration; actual HTTP/PostgreSQL/private-object persistence and release qualification remain open.

Reviewed candidate `b1c0b170c7a18508fa32b62cb90921c1b4c395c3`, correction code `9906d615dbe5b7a53c1d3a364ea92316876ae00c`, tree `58b093fa7ea231b5df3ec6ac3ba04862b52960d3`, against original candidate `24879bdeb41e2820a36ce1061c2b321844e3e66f`. Read-only staging/closure assignment was observed at `1fc002a2e23c110ff4e78fdd61c5455e752dee27`.

Clean reviewer worktree `C:/Users/kvina/.codex/worktrees/point-review/3d-ulpin` was branched as `task/desktop-ifc-correction-audit`; completed Qwen report `e692b7ac70dbbf1b201771a8c8c3738379b9811d` and its branch remain preserved. Own only this report and private `E:/BhuAayam-data/task-data/desktop-ifc-api-correction-review/`. Supplied permissions are `never` / `danger-full-access`; requested Astra/xhigh/default-standard, with actual model/effort/request tier unexposed. No settings change or worker dispatch occurred.

Read the complete closure assignment, PARALLEL_20261001E, original review from lead staging, correction handoff, IFC-02 ownership/amendments, source index/catalogue/manifest and accepted local-reader review. Reconciled current AGENTS/guide/normalized decisions and migration-ledger updates. Scope was the seven changed code/test files plus handoff; the completed full canonical workflow/parser review was reused.

## Closed findings

| Finding | Correction and evidence | Result |
| --- | --- | --- |
| P1: generic retry creates unregistered queued IFC jobs | `packages/server/src/modules/cases/domain.ts:884–885` rejects `ifc-native` with 422 / `IFC_CANONICAL_RETRY_REQUIRED` immediately after the job lookup, before case locking, existing-job reuse or mutation. The source-bound retry and strict worker metadata/fence paths are unchanged. The saved caller regression uses two failed IFC jobs through `CaseIntakeService.retry`; both are refused, with no inserts/updates/deletes/case locks, queued capacity, source changes or events. | Closed |
| P2: executable caches escape runtime identity checks | Profile `/2` adds explicit `verified_bytecode_read_no_write` and repository-root identity. Node and Python inventories include runtime/environment caches plus the reachable repository helper/CLI/native-module sources and cache directories, including Windows case variants. `ifc-processor.ts:32–34,47` verifies tools in Node before wrapper/reaper spawn, covering Python startup and imports preceding the wrapper's own verification. Saved controls reject a valid forged cache with unchanged source in both Node config and Python verification; old `/1` profiles are refused unchanged. | Closed |

The wrapper still verifies the profile before and after processing. `VerifiedCacheSubprocess` in `scripts/usp/ifc/server.py:20–27` accepts only the expected interpreter and `-I -S -c` child shape, then inserts `-B`. The original CLI and reader bytes remain unchanged. This suppresses new cache writes while allowing already verified caches; it does not claim `-B` prevents cache reads. The saved child control observes `sys.dont_write_bytecode=True`, and the corrected real wrapper smoke preserves its profile inventory and historical artifact bytes.

Before the wrapper starts, the Node check covers the runtime/stdlib and repository `profile` cache that Python may import before its own verification. The child gate and native dependencies remain within the verified runtime/environment/repository selection. This avoids the separate Qwen host-loader gap: the IFC trust check runs outside Python before those imports. No new behavioral control was needed after tracing these paths and reconciling the saved proof.

## Cleanup, compatibility and profile lifecycle

The added initial tool check runs before process creation. Reaper verification failure returns `IFC_REAP_UNAVAILABLE`, which preserves private scratch instead of starting unverified Python or deleting files before termination is confirmed. The existing kill-on-close Job, fixed host mutex/process capacity, cancellation path and parser supervision remain unchanged. Existing cancellation/busy evidence is reused; the correction smoke is a successful invocation, not a new cancellation-interleaving campaign. Correction scratch was independently observed empty.

All 19 MVT, nine semantic and nine validator constituents and aggregate physical/Git hashes match the original candidate exactly. No immutable-read exception, current-writer relaxation or historical pin rewrite was added. The IFC code aggregate changes to physical `7900454406c7ebebb4b30872bf059c8eda5dfecffdc5b15cf2ae707e08faf5fd` / Git `c7d6d9b23fd9334079868b046907cd9bc3d0c3efb2f298552b409e113279aa1a`; profile and wrapper pins change as recorded in the handoff. Python, reader and dependency-lock pins remain unchanged.

The new profile is bound to the implementation owner's repository path and physical bytes. Integration needs a fresh `/2` profile for the actual integrated checkout/runtime and its own qualification. Do not rewrite the saved owner profile to match another checkout. Historical `/1` profiles remain evidence and now fail current configuration checks; they do not authorize current execution.

## Evidence reconciliation

Matched `E:/BhuAayam-data/task-data/desktop-ifc-native/api-checks/ifc-02-corrections/correction-pins.json`: **35,459 bytes**, SHA256 `1cd656b9df723ea228c5c4ba1c899a5e9db7574529531b77c40d7af14c43cbac`.

Independent reconciliation passed **5,156 comparisons**, including all **4,838 inventoried files / 215,910,429 bytes / 1,811 caches**, exact complete file-list equality, seven changed physical/Git source pins, accepted reader/CLI byte preservation, both original hashes/sizes, historical evidence and reviewer-control pins, all shared/IFC aggregate constituents, current runtime/tool pins and saved smoke identity. Node/Python repository selections match. Five reviewer code/test files differ from tested owner bytes only through checkout line endings; the receipt records both physical forms and exact Git equivalence without rewriting either.

The `/2` profile file itself is **1,062,300 bytes**, SHA256 `4be36984cd8bf3cbe0b661c23a2a562fe1d2a0a43d5b58585af38a6b78803606`. The larger `profile.bytes` field in the owner correction receipt represents total inventoried bytes. The historical `final-pins.json` and `/1` profile remain unchanged at their recorded hashes.

Reused saved checks, all recorded exit 0:

- Generic retry caller: one pass; two failed IFC jobs rejected before mutation.
- Cache/profile and child adapter: two passes; forged cache denied, source unchanged, repository cache included, old profile retained/refused, child cache writes disabled.
- One corrected real wrapper/native invocation through SQL/storage doubles: one pass, **28.479 seconds**. IFC2X3 original SHA256 `c4db65ba847f6b369a95d6c54fa11f4750cbe6d59f021934e8923d8d578e5885`; 55,011-byte artifact SHA256 `66dcfb321cac47b605ffed87beaf060b50b1203a151b738fe446b6251d003d3a`, matching retained output.
- Backend typecheck, wrapper/helper source compilation and diff check.

Reviewer command: `C:/Users/kvina/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none/python.exe -B -I -S E:/BhuAayam-data/task-data/desktop-ifc-api-correction-review/reconcile.py`, exit **0**. It compiles the exact profile source directly for read-only inventory verification; it does not import native packages or run a parser. `git diff --check 24879bdeb41e2820a36ce1061c2b321844e3e66f b1c0b170c7a18508fa32b62cb90921c1b4c395c3` and staged report diff check exit **0**.

Private reviewer `reconciliation.json`: **7,262 bytes**, SHA256 `1dd86613da90bf84b7f32c8ba0b96268f5d3a68115cafc4593acbdde3733de5c`. Saved tests/native smoke were not rerun. One reference search addressed the unintegrated handoff in staging and reported it absent; the handoff was read from the pinned reviewer checkout. This was not a test failure.

## Retained limits and return

Both buildingSMART CC-BY-4.0 certification originals remain unchanged, `test_only`, and geographically unqualified. No geometry/global placement, association, legal units/rights, learning, scale, Linux, HTTP/SQL/private-object persistence or release acceptance follows. The prior full review's authority and compatibility limits remain in force.

No production/generated/frontend file, original, runtime, shared cache, service, Docker resource, provider/model/GPU, configuration or security grant was changed. No fresh native execution, source acquisition, additional worker, polling or schedule occurred. Private reconciliation files are retained; no owned process remains running. Return this report-only commit to the lead by the authorized callback, then stop.
