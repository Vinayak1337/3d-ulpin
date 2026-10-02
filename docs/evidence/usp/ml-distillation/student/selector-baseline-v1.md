# STUDENT-09-BASELINE — blocked before stage creation

3 October 2026. The single authorized staging attempt exited 1 before creating a runtime stage. No model/guard/GPU process, tokenizer preflight, inference, fit or evaluation ran; no quality or resource metrics were measured. No repair or retry was attempted.

Executed from exact clean `113c47e7977eb3c1561f3cd61846369c4456e410` in `C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin`. Assignment physical SHA-256 `57b77caffc2a0527348b07cda104e08a53afb758acb90468b2467aba8b69c4f9`; coordinator checkpoint `16d82df50d69b095eccd43c535208ffeb83a2582`. Primary staging was observed read-only at `195c502f166272fab49a267fa3ba8ef10626f5aa`. All twelve assignment code pins, acceptance receipt, parent profile/five inputs and host expectation/original-summary hashes matched before staging.

## Exact blocker

`stage_selector_baseline.py:63` rejected `selector_protected_source_drift:scripts/usp/learning/model_isolation.py`:

| Pin source | Bytes | Physical SHA-256 |
| --- | ---: | --- |
| Assigned clean checkout | 23,841 | `69e51fd895697f224960226cdc1f99499d2b43d0b17ac76638e20cdfa8787676` |
| Retained baseline profile and file | 22,508 | `7257b92c4e072f0f9f066ff2721db1eae25e1e90eb2cc0d1e5c0558ba7ae30f3` |

Both files use LF; canonical bytes differ. The checkout contains later adapter-role/fit/reload allowlist and completion handling. The new stage requires protected source bytes to equal the older baseline profile, while the assignment pins the current guard. Both pinned sources are intact. The read-only audit found six of eight protected sources equal. The other mismatch is `student.py`: current `a380d21dbfceea8012a979182cb9c2f7956b222e984d5c923025ab9e3d34cc87` versus retained `23108097250b406c867f6759b6dba7cbeb5b0c85d0bdb5b86b6d75da1d28bb4d`; its later version adds an optional model loader. This second mismatch was diagnosed without another staging attempt. `git diff --no-index` returned 1 as expected for differing files. An initial read-only diff helper had an unmatched parenthesis (exit 1 before execution); its corrected form exited 0. No executable, historical run, profile, source or assignment was changed.

## Evidence and boundary

[Machine-readable receipt](selector-baseline-v1.json) records the exact staging command, exit, elapsed time, all pins and artifact digests. Host-only logs and diagnosis are retained under `E:/BhuAayam-data/task-data/ml-distillation/student/selector-baseline-host-20261003-113c47e7`. This directory contains metadata only; no private runtime/model stage, generated freeze/profile, raw model output, guard or cleanup receipt exists. No owned-resource cleanup remains.

Requested Astra/xhigh/default-standard; supplied permissions are `never` / `danger-full-access`. Actual model/effort/tier are unexposed; no setting change is claimed. Return to the coordinator for inspection and a separately authorized narrow correction/frozen execution. No automatic continuation.
