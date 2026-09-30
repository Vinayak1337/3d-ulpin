# AI-06F-R — weight-1 fit and resource review

Date: 2026-09-30. Candidate: `f41ae65b6895abe0d4445fd11b3ac7d331d39df6`; accepted base: `530774ce5bfb8c466bd55c60a93149db8625533c`. Assignment and staging head reconciled at `dfdeb6f71d300ea4dd73773fd99d9758e2b2c8ac` (`PARALLEL_20260930.md`, AI-06F-R). Primary staging remained read-only. This report is the only owned change on `task/desktop-weight1-resource-review`.

Requested reviewer settings: Astra/xhigh/default-standard. Actual model, effort and per-turn tier are not exposed; supplied permissions are `approval_policy=never`, `sandbox_mode=danger-full-access`. No workers were launched.

## Disposition

**Accept the handoff as evidence of an incomplete, failed experiment. No model, reload, resource-envelope or release acceptance.** The saved development scores already make the adapter unusable under the unchanged criterion. The learner code has one confirmed resource-validation gap below; its recorded failure must not be rewritten as success.

**One next recommendation:** preserve the adapter, originals and receipts as failed-experiment evidence and retire this candidate from further model execution. Reload/fit salvage cannot remedy the saved score ordering. No new execution or resource diagnostic is recommended by this review.

## Findings

### P2 — recorded Job peak is absent from the wrapper's success checks

In `scripts/usp/learning/run_weight1_isolated.py:301`, `bounded_launch` checks only the external RSS monitor, then returns the launch observation. The phase gate at line 470 checks child exit/output truncation, with no comparison between `peakJobMemoryBytes` and `LIMIT`. A zero-exit child with an over-limit Job receipt could therefore continue successfully. The observed child exited 1, so this run was correctly rejected independently; this finding does **not** establish why Windows reported the excess or why reload failed. It prevents unqualified acceptance of the wrapper's resource checks for reuse.

### Saved rankings cannot meet the frozen usefulness criterion

Read-only arithmetic matched all 69 score identities to the frozen 44 training / 25 calibration fields and checked finite three-target rows. The unchanged wire-shape rules (`model.py:97–118`) allow Census county `geometry` to propose `building.geometry`; its qualified label is null. No inference or threshold selection was performed.

| Saved weight-1 calibration score | Value |
| --- | ---: |
| Census negative polygon → geometry | 0.996570348739624 |
| Maximum allowed key score, Chesterfield `GlobalID` | 0.9963215589523315 |
| Maximum allowed name score, Chesterfield `BuildingName` | 0.9688562154769897 |

Acceptance is `score >= threshold`. Rejecting that Census negative requires a threshold strictly above its score. Every allowed calibration key/name score is lower, so all four key/name positives would abstain. At most the three geometry positives could remain: **at most 3/7**, with no key/name coverage. This contradicts both the frozen zero-error/every-target selection policy and the development requirement of at least 5/7 positives. This ordering proof neither chooses a cutoff nor produces a decision matrix; independent reload equality remains unverified.

The saved comparison to weight 8 also confirms that the USGS negative geometry score fell from 0.997409046 to 0.977370739 and Census from 0.999322772 to 0.996570349, while Cambridge `SITE_NAME` fell from 0.156104907 to 0.104477316, Oregon `NAME` from 0.433981478 to 0.388617992, and IGN `cleabs` from 0.051845472 to 0.027795624. Reduced negative scores alone do not establish usefulness.

## Observed execution and unresolved resource cause

- Saved preflight passed matching AppContainer SID, zero capabilities, Job membership and two inherited handles. Output/scratch writes passed; code/model/input/runtime/execution writes and ungranted canary reads were denied. Six saved numerical checks passed in 0.034 seconds; they were not rerun.
- One fit completed 51 updates / three epochs in 78.047 seconds and saved the adapter plus 69×3 development scores. Required independent reload failed in the second `load_base()` at `safetensors.safe_open`, Windows OSError 1455. Child and run exited **1**. `reload.json`, `selection.json` and `result.json` are absent. `completedPhases` lists observations, including failed `child-fit`, rather than successful phases.
- Configured Job limit: **6,442,450,944 bytes**; reported `PeakJobMemoryUsed`: **7,066,611,712 bytes**. External sampled RSS/peak working set: **4,030,197,760 bytes**. RSS does not establish committed-memory compliance. Supervised elapsed time was 161.078 seconds against 600; last-epoch CUDA allocated/reserved peaks were 1,319,489,536 / 1,350,565,888 bytes, with minimum sampled free CUDA 6,005,194,752 bytes. These fit observations do not qualify reload or the Job envelope.
- Static inspection of the accepted launcher found class 9, flags `0x200 | 0x2000`, byte-valued `JobMemoryLimit`, checked set/assign calls before resuming the suspended child, and a query of the same extended structure after exit. A standard-library-only evaluation of the three ctypes declarations confirmed Windows x64 sizes 64/48/144 bytes for basic limits/IO counters/extended limits; Job limit and peak offsets are 120/136. No flag, unit or ABI mismatch was found.
- Microsoft documents `JOB_OBJECT_LIMIT_JOB_MEMORY` as limiting job-wide committed memory, with excess commits failing; `KILL_ON_JOB_CLOSE` terminates associated processes on final handle close. The notification-only limit uses a different information class. These definitions do not explain this receipt's over-limit peak. Child membership in a Job is checked, but effective Job limits are not read back into evidence.
- The trainer deletes optimizer/scaler/parameter references before scoring and performs `del model`, garbage collection and CUDA cache clearing at lines 323–325 before reload at 327. The forward closure shares the deleted model binding; scores are Python floats. No explicit retained whole-model reference was established. Logical deletion does not demonstrate release of host commit/mappings. There are no surrounding commit/private-memory samples or host commit/pagefile measurements. **Neither a whole-model leak nor host pagefile exhaustion as the sole cause is established.** This release/reload lifecycle already exists in the accepted base.

## Scope, frozen inputs and cleanup

The five-file candidate diff retains weight 8 as the normal default and permits the wrapper's frozen weight 1. The sole learning-settings delta from the previous freeze is `positiveWeight: 8 → 1`; corpus/proof hashes, training plan and epoch orders, token lengths, prompt/selected-input hashes, selection policy, development criterion and reload sample match. All 13 staged code files match recorded hashes and candidate blobs after CRLF normalization. Only train/calibration inputs are staged; no held-out or diagnostic split was opened by this review.

The wrapper copies into task-local scopes, pins the relocated runtime/helper manifests and verifies frozen code/context before model import. Attempt markers are exclusive and there is no automatic rerun/fallback. Output checks require exact empty, non-reparse, current-owner scopes before owner-WO/Low changes; grants are recorded before attempted application, with Modify confined to output/scratch. Environment restoration precedes cleanup, whose AppContainer and owner-scope paths are independently attempted. The accepted security harness is unchanged.

Saved `ai06f-weight1-03-run.log` contains 16 grant revocations with exit 0, successful SID freeing and profile deletion `0x00000000`. Both `owner-scope-cleanup.json` entries pass, restore Medium labels and show zero explicit owner grants. The handoff reports no remaining task process; this review did not query live processes or ACLs. Originals and prior attempts remain preserved.

## Evidence and verification limits

Private evidence root: `E:/BhuAayam-model-evaluation/20260930/ai06f-weight1-03/`. Independently matched pins:

| File under root | SHA-256 |
| --- | --- |
| `completion.json` | `e2eb5b39d27d815b76f848bcc0bda9ebc56bae6a9603f0ce46176e9d50872759` |
| `execution/freeze.json` | `aebb1aee161e3842cfa40d4dc745632ebad81a273a27d9baa21d046299f1dae0` |
| `receipts/child-fit.json` | `bada6b914b277a6fae8f8ac8be71d8dcf6f371b9b800dc9ab4086dbe3c215d05` |
| `execution/run/scores.json` | `83029bbd22ebba3f1930555c79f1ecce033f9049f763d4089c33b4f61cfe7bed` |
| `execution/run/adapter/adapter_model.safetensors` | `743dda48ed1acbd20df55338f6f4ae6ad0083f40bbc8da5585603161cfca36c8` |
| `postcheck.json` | `f21b2093c364d45cf0de500527ae90d4040d59afb9af857722cfa8815bb0716f` |

Weight-8 freeze at `E:/BhuAayam-data/task-data/ai-06a-learning/desktop-ai06a/v8-lora-01/freeze.json` matched `1075a64cc50da8c84cd09818d6aba9822aa2afe7a34846b1a45d898763799005`. Original model/runtime identity remains pinned through the freeze/stage/runtime manifest chain; no model was loaded. The lead's existing 65-artifact verification is reused, not represented as a repeated campaign.

Reviewer commands: `git diff`/`rg`/file reads for code and receipts; inline `C:/Python313/python.exe -B -` standard-library scripts for hashes, AST parsing, freeze/input equality, saved-matrix arithmetic and ctypes layout. These verification scripts exited 0 after correcting an initial arithmetic script's metadata assertion (context targets are objects with `id`, saved targets are strings); that initial invocation exited 1 before score arithmetic and changed no evidence. All staged Python parsed successfully. `git diff --check` and `git diff --cached --check` exited 0; the staged diff contains only this report. No dependency/model import, inference, gradient, reload, threshold search, service/DB access, acquisition, live ACL/pagefile/cap change or harness edit occurred.

Documentation consulted on 2026-09-30: [Microsoft basic Job limits](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information) and [extended Job limits](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information). Documentation explains metric semantics, not observed enforcement. No operational, Indian-geography, held-out learning, scale or deployment qualification follows.
