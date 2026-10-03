# STUDENT-17 — fragment baseline

## Result

**Runtime accepted; frozen small-development quality criteria not met.** One fresh stage and one contained inference ran from clean `04931c584bacc5bb68d6b839173c2a93adbaf25d`, using the original Qwen2.5-0.5B-Instruct revision `7ae557604adf67be50417f59c2c2f167def9a775`, without an adapter. No retry, fit or evaluation was run.

| Request | Candidates | Expected IDs | Selected IDs | Whole response | Exact set | TP / FP / misses | Precision | Recall |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| IfcBuilding Name (IFC4) | 4 | c1 | empty | accepted | no | 0 / 0 / 1 | null | 0 |
| Supplied non-null numerical building elevation (IFC2x3) | 3 | empty | empty | accepted | yes | 0 / 0 / 0 | null | null |

Both raw responses passed JSON/schema/whole-response checks: **2/2 valid**, **1/2 exact sets**, **0/1 positive recall**, **0 selected fragments**, and **0 unsupported-request false positives**. Aggregate precision is **null**, because its selected-fragment denominator is zero. Correct context-limited empty retrieval is **1/1**. The supplied name fragment was missed; the positive precision/recall and 2/2 exact-set requirements are unmet.

The host expectations were read once, after authoritative acceptance and cleanup verification, for one host-only comparison. Their SHA-256 is `71efa01a6e56e35c24a6e9440c01e0e8aeb3be322fedc877343765eae45f943e`. Raw outputs and accepted worker artifacts were preserved unchanged.

## Execution and containment

The exact stage and run command arrays, timestamps, stdout/stderr, exits, source/model/policy hashes and artifact pins are in [the evidence receipt](fragment-baseline-v1.json). Stage, guarded command and host acceptance verifier each exited **0**. The run command came directly from the new `stage.json`.

- Stage: `E:/BhuAayam-data/task-data/ml-distillation/student/fragment-baseline-6d2a6e03ea684bdcb30fabb45d4dbe80`
- Host report: `E:/BhuAayam-data/task-data/ml-distillation/student/fragment-baseline-v1-host-1b930671d67040d08898d805e93e0071`
- Profile SHA-256: `86b0f0b19d4e740f2e6e38f7eea8eaccd24b7b3072883f8b7d22421c39b8ef75`
- Freeze SHA-256: `9be4dd759c0562ed43c8f599c04c988680711ae044e57d3c3c97ffe2e2ad8ed4`
- Guard SHA-256: `f88716ac6b7f2a8ab5dd80fb0617942543b0ba2861c3e01469c5eb40a0f2e0d0`
- Accepted receipt SHA-256: `07ee89b643551787fe79abc1baf90d4f4950b5f7f47190622467ccdfba0ac7b8`

All **9** accepted output hashes matched. Profile/freeze/session/source bindings, native transport, complete grammar/EOS, generated-byte agreement and no truncation/repair passed. Inputs used 1,290 and 921 tokens; each response used 83 output tokens. The profile contains 19,417 entries and binds 20 source files. Existing staging/guard checks supplied runtime/model validation; no separate donor campaign was repeated.

| Resource | Observed bytes | Bound |
| --- | ---: | ---: |
| Peak Job committed memory | 5,431,214,080 | ≤ 6,442,450,944 |
| Peak process RSS | 3,259,510,784 | ≤ 6,442,450,944 |
| Peak CUDA allocated | 1,291,972,608 | ≤ 6,442,450,944 |
| Peak CUDA reserved | 1,356,857,344 | ≤ 6,442,450,944 |
| Minimum sampled CUDA free | 6,030,360,576 | ≥ 1,610,612,736 |

The RTX 3070 run used two CPU threads, batch 1, seed 17, greedy fp16/SDPA and a 600-second child limit. Job closure, all 10 AppContainer ACL revocations, SID release, profile deletion and both owner-ACL/integrity restorations passed. The session receipt is retained and its AppContainer grant revoked. All owned command sessions exited; artifacts remain for audit.

## Timing

| Measurement | Seconds |
| --- | ---: |
| Stage wall | 158.734878 |
| Guarded command wall | 283.662156 |
| Guard setup + child + cleanup aggregate | 127.125000 |
| Model load/preflight section | 1.690551 |
| Entire measured model section | 6.040705 |
| Name-request generation | 2.384943 |
| Elevation-request generation | 1.959431 |

The guard aggregate excludes its initial full profile verification. The frozen guard emits no separate setup, child-only or cleanup duration; those fields remain null. Model-section time is not child wall time. No child-only time or speedup was inferred.

## Scope and next boundary

JSON/schema, full-context identity, current distinct IDs and unchanged fragment projection are deterministic controller contributions, not learned relevance. Empty retrieval means `no_support_in_supplied_context`; it never establishes property-wide or whole-original absence.

These are two related development requests from one buildingSMART certification family. Retained IFC originals and their CC BY 4.0 attribution remain unchanged; they are `test_only`, with unqualified operational and geographic applicability. No generalization, conflict completeness, extraction accuracy, canonical association, adapter gain or release pass follows. The concrete error available for the coordinator's next bounded decision is the missed positive name fragment.

Requested Astra/xhigh/default-standard; observed model/effort/tier are unexposed. Supplied permissions were `never` / `danger-full-access`. Only these two evidence files are repository changes. Teacher/held-out/retired data, frontend, other checkouts, shared services and provider routes were untouched. No acquisition, installation, push, deployment or promotion occurred.
