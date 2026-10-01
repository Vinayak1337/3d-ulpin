# MODEL-EGRESS-02-R — mandatory Qwen containment review

**Lead correction closure, 1 October:** host-loader P2 below is closed by `5c536ff8f43222b1ffece08184e0d4d9e639fb6f`, integrated with the reviewed adapter as `8310531` / `9114718`. Lead inspected both direct-source loaders and the cache-positive/source-drift regression. Correction verification/commit receipts match SHA `a0e853b4f166649bf619e07e31facde461e842fa1271802631b04b8276b08bce` / `4cfffee0a7a23af497107c9d19af9df49034c8386ab351cb852d62d4d3551634`; nine artifact/history and four physical/Git source pins match. All six integrated stdlib controls pass (exit 0, 0.166 seconds), including both valid-cache bypasses and refusal before compilation; the new private receipt is `E:/BhuAayam-data/task-data/desktop-model-egress-enforcement/host-loader-fae962bb41344ee2b926ade8e4aa91ef/cache-regression.json`. No further actionable defect established in the assigned correction. Accept no-model Windows adapter/source-loading scope; complete sandbox evidence is reused, not rerun. Historical profiles remain historical, and Qwen/model/private-data/network/release limits below remain unqualified.

## Disposition and pins

**One P2 correction is required before accepting the reusable launcher: the host's source pin does not cover executable Python caches.** The saved no-model controls and strict Job-peak rejection reconcile successfully. No Qwen execution, private-data enablement or release qualification follows.

- Assignment/observed staging: `a1c3460033b01831e02a106fe23d7a627036a50e`; implementation base: `142905fa76a6a32b0fab3ce49ff635d43de1b097`; candidate: `2f0928e656f4a2768313ad0422f6af17412c02b8`.
- Reviewer: `C:/Users/kvina/.codex/worktrees/point-review/3d-ulpin`, branch `task/desktop-model-egress-enforcement-audit`. Completed image report `7fe24f43fcd64452547d5224e7d92f35d1cf9330` and its branch are preserved. Staging and the implementation checkout remained read-only.
- Reviewed the eight-file delta, assignment, handoff and applicable AGENTS/operating guide/migration ledger/normalized decisions. Reused MODEL-EGRESS-01, corrected AppContainer and weight-1 resource reviews. Also read the concrete IFC cache finding at `8396490` without changing or executing its candidate/runtime.
- Supplied permissions: `never` / `danger-full-access`. Requested Astra/xhigh/default-standard; actual model, effort and request tier are unexposed. No settings change, worker dispatch or polling occurred.

## Finding

### [P2] Load verified host source without accepting an unpinned cache

**Location:** `scripts/usp/learning/model_isolation.py:223–225`, using `audit_module` at lines 70–75. The host loads `appcontainer_audit.py` with `spec_from_file_location(...).loader.exec_module(...)` before comparing the helper/harness **source** hashes to the profile. This loader may execute a valid `__pycache__/appcontainer_audit.*.pyc`. That host cache is outside the staged `code/` inventory, and hashing the unchanged `.py` afterward cannot identify the executed code. `resources.py:29–33` similarly imports the host isolation helper through a cache-aware loader before entering this verification path.

The complete staged inventory is an improvement over the IFC profile: it does not exclude `.pyc` or `__pycache__`, and the host verifies it before launching the child. Thus the IFC defect does **not** transfer to the child-stage inventory. The uncovered path is the separate host launcher import that establishes the boundary.

One isolated standard-library control copied the exact candidate helper/harness source into the owned review directory. It generated a timestamp/size-valid harness cache whose only function returns `UNPINNED_HOST_CACHE`, then invoked the exact candidate `audit_module`. The cache function executed under `-B -I -S`, while both subsequent host source-pin comparisons passed and the exact candidate `load_profile` accepted the same complete staged inventory before and after. Source and profile bytes were unchanged. Only `STAGING_PARENT` was redirected in memory; a technical runtime placeholder was checked for existence and **never executed**. No AppContainer/model process, network or ACL operation occurred.

Expected: verify the source bytes before execution and use a loading policy that cannot substitute an unverified host cache, covering both the helper and harness imports. Executing the verified source bytes explicitly is one bounded option; merely moving the `.py` hash check earlier or adding `-B` is insufficient. Add a narrow valid-cache regression control. This establishes a local executable-code pinning gap, not a remote input exploit, evidence of an altered retained cache, or a confirmed containment escape/outbound request.

## Remaining reviewed behavior

Both normal Qwen CLIs route prepare/run through the contained branch of `guarded_run`; direct prepare/worker/context calls require the actual AppContainer token before private-input reads or model/dependency imports. Session/parent markers alone are refused. Missing profile, unsupported platform and changed staged bytes fail closed. No ordinary uncontained fallback was found in these Qwen paths. E5 retains its prior unrestricted default and separate qualification.

The host establishes the exact zero-capability SID and effective Job membership/limits while the child is suspended. The bootstrap uses `-B -I -S`; package paths are added after token/Job and profile checks. Child bootstrap imports before its own inventory check are within the already host-verified runtime/code stage. Base/tokenizer loading uses the staged model directory with local-only/remote-code refusal and safe base weights; adapter reload additionally requires local safetensors/config and rejects pickle weight suffixes. Actual Qwen prepare, fit, reload and comparison under this bootstrap remain unrun.

Reviewed path/reparse checks, current-account scope ownership, narrow ACL grants, explicit environment and the unchanged two-handle allowlist. Launch rejection attempts cleanup; terminal acceptance requires valid exit/truncation, actual token, effective limits, positive in-cap Job peak/RSS, checked Job close and successful ACL/profile cleanup. Failed launches have no protected acceptance receipt; final comparison/LoRA completion assembly occurs after launch acceptance. Exclusive action markers preserve the no-retry rule. No further independently established defect is reported in this delta.

Both `SETTINGS` ASTs match the base, including positive weight 8. The diff preserves prompts, source-family splits, training/scientific selection and evaluation restrictions. Retired weight-1 branch `f41ae65b6895abe0d4445fd11b3ac7d331d39df6` remains unchanged; its failed receipt and unresolved reported Job-peak cause retain their prior disposition. No weights, corpus or held-out inputs were read.

## Evidence and commands

Saved scope: `E:/BhuAayam-data/task-data/desktop-model-egress-enforcement/control-ec174bfdfc584ab68de7fabc524bafdb/`.

**893 reconciliation checks passed:** all 833 staged files (40,457,148 bytes; no caches in this saved control), seven executed physical source pins, candidate Git/source equivalence, four guard/acceptance artifact pins, accepted output hash, profile/session pins, runtime identity and both unchanged SETTINGS ASTs. All seven reviewer source files have different physical line endings from the owner's tested bytes; CRLF normalization gives exact candidate Git equivalence. These representations are recorded separately. Saved session `sourceCommit` is the assignment base, consistent with testing before the candidate commit; executed source hashes match the candidate after EOL normalization.

| Saved observation reused | Result |
| --- | --- |
| Verification receipt | 1,530 bytes; SHA256 `7a03d8f1758f24927b67f1906df286b7cd9d855dc634896013a460368c211584` |
| Actual adapter via `resources.guarded_run` | Exit 0; matching zero-capability SID; token/Job checked before resume; two handles; Job closed; cleanup passed |
| Resource facts | Cap 134,217,728 bytes, flags `0x2200`, 10-second deadline; Job peak 30,380,032 bytes; sampled RSS 38,576,128 bytes; complete adapter elapsed 9.672 seconds |
| Write/environment control | Code/input/model/runtime/state/receipt writes denied; output write allowed; unrelated technical sentinel excluded |
| Injected terminal peak failures | Missing and over-limit peak rejected despite child exit 0; cleanup passed; neither acceptance receipt exists |
| Actual suspended-child cap mismatch | Effective readback altered by one byte; rejected with zero resume calls; cleanup passed |
| Focused tests | Saved five passes in 0.075 seconds, including six direct-role refusals; not rerun |

Reviewer commands from the explicit reviewer worktree:

- `C:/Users/kvina/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none/python.exe -B -I -S E:/BhuAayam-data/task-data/desktop-model-egress-enforcement-review/cache-control.py`: exit **0**, reproduces the finding above.
- Same interpreter/flags with `E:/BhuAayam-data/task-data/desktop-model-egress-enforcement-review/reconcile.py`: exit **0**; seven source-only compilations, AST and saved-evidence checks. No candidate/dependency import in reconciliation.
- `git diff --check 142905fa76a6a32b0fab3ce49ff635d43de1b097 2f0928e656f4a2768313ad0422f6af17412c02b8` and report diff check: exit **0**.

Private reviewer receipts under `E:/BhuAayam-data/task-data/desktop-model-egress-enforcement-review/`:

| File | Bytes | SHA256 |
| --- | ---: | --- |
| `cache-control.json` | 1,418 | `935f60a7e0fffe66b2da5298b4832366a08712324b975a33575be6600cfaec59` |
| `reconciliation.json` | 6,915 | `91c685148df7f1cd18612b050e21eebc5752b859efd34da9d7ca3c24b0c0d4d4` |

One documentation lookup used the pluralized correction-report filename and was corrected. One PowerShell receipt-listing command had a parse error before execution; the corrected exact-file listing exited 0. Neither was a candidate/control failure. The single fresh control and reconciliation both passed on their first execution.

## Limits and handoff

The saved no-model Windows observations retain their bounded value; the host-cache finding prevents unqualified launcher acceptance. No model/dependency import, GPU, acquisition, providers, services/Docker, global setting, security grant, original/private source or production file was changed by this review. Private technical probe files are retained and its process exited. Earlier failed controls and final cleanup evidence remain untouched; no NET-01 descendant/network campaign was repeated.

Linux, arbitrary native/brokered network coverage, historical training silence, scientific quality, operational/private-data use and release gates remain unqualified. Return this report-only commit and the bounded correction request to the existing learner owner through the authorized lead callback, then stop. Lead owns integration and any further assignment.
