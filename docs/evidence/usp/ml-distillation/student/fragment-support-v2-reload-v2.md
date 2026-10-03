# STUDENT-23 v2 fragment-support reload — attempt 2

**Native reload, output transport, resources and cleanup passed; frozen development quality criteria failed.** One stage and one contained reload ran at `856a937b3a8c4c8819cb033ab54362da28b1ef2e`. One host comparison followed accepted technical output and cleanup. Attempt 1 and the earlier v1 quality failure remain immutable.

| Request | Candidates | Expected IDs | Baseline IDs | V2 adapter IDs | V2 TP / FP / misses |
| --- | ---: | --- | --- | --- | --- |
| IfcBuilding Name | 4 | `c1` | empty | `c1`, `c2` | 1 / 1 / 0 |
| Supplied non-null numerical building elevation | 3 | empty | empty | `c0`, `c1` | 0 / 2 / 0 |

The adapter selects the requested building-name fragment plus one unwanted fragment, and selects two absent/null elevation fragments for the unsupported numerical request. Both whole responses are valid, but exact request sets fall from baseline 1/2 to 0/2. Precision is 1/4, positive recall 1/1, and unsupported-request false positives are 2. Frozen development quality criteria fail. The unsupported request selects an absent Elevation fragment and an explicitly null ElevationOfRefHeight fragment; neither supplies a non-null number. This statement concerns only the supplied context.

| Metric | Retained baseline | V2 adapter |
| --- | ---: | ---: |
| Valid whole responses | 2/2 | 2/2 |
| Exact request sets | 1/2 | 0/2 |
| True positives / false positives / misses | 0 / 0 / 1 | 1 / 3 / 0 |
| Aggregate precision | null (zero selections) | 1/4 |
| Positive recall | 0/1 | 1/1 |
| Unsupported-request false positives | 0 | 2 |
| Correct context-limited empty retrieval | 1/1 | 0/1 |

The supported request has precision 1/2 and recall 1/1. The unsupported request has precision 0/2 and undefined recall. The earlier v1 adapter remains a separate failed result: exact sets 1/2, precision 1/3, positive recall 1, and two unsupported false positives.

Both ordered contexts, prompts, neutral candidate IDs, greedy settings and controller policy match the accepted baseline. Prompt lengths remain 1,290 and 921 tokens. V2 emitted 88 tokens for each response; generation took 3.590 and 2.942 seconds versus baseline 2.385 and 1.959 seconds. Raw outputs were retained before strict whole-response projection. The controller enforces schema, context identity, current IDs and unchanged fragments; it does not establish relevance. No repair, forced selection, fallback or partial-response credit was used.

All **96 saved adapter tensors** matched exactly on native reload, with the explicit original local base. All 11 accepted-fit bindings and the fit's immutable-base proof were retained. The reload emits no fresh in-memory base digest. The actual profile has 19,690 entries: 19,630 runtime, nine model, 33 code and 18 input files. Staging copied 19,688 files / 8,607,058,827 bytes; proof and freeze are generated inputs. All 33 source physical/canonical/Git pins match the unchanged execution head.

| Observation (bytes) | Baseline | V2 adapter | Difference |
| --- | ---: | ---: | ---: |
| peakJobCommittedBytes | 5,431,214,080 | 5,433,962,496 | +2,748,416 |
| peakProcessRssBytes | 3,259,510,784 | 3,265,454,080 | +5,943,296 |
| maxCudaAllocatedBytes | 1,291,972,608 | 1,294,135,296 | +2,162,688 |
| maxCudaReservedBytes | 1,356,857,344 | 1,358,954,496 | +2,097,152 |
| minimumSampledFreeCudaBytes | 6,030,360,576 | 6,028,263,424 | -2,097,152 |

Stage, guarded reload, technical acceptance and host comparison each exited 0. The Job commitment peak and RSS are separate measurements. All original 6 GiB caps and 1.5 GiB free-CUDA floor passed. The existing guard enforced the 600-second child limit. Stage wall time was 164.405 seconds; reload command wall time 319.496 seconds; guard setup/child/cleanup aggregate 155.688 seconds. Model load was 2.053 seconds and model section 8.592 seconds. Separate child/setup/cleanup durations are unavailable; these single-run differences establish no general speed claim.

Cleanup closed the Job, revoked scoped ACLs, restored owner/integrity settings and deleted the AppContainer profile without errors. Recorded stage/reload/child PIDs 37580, 35672 and 46748 were absent on the final observation. No owned process or pending tool session remains.

Actual freeze SHA-256: `fccce3dacb0ae8a333a00c346f67ed97eac501c75029d0bb8f99b46793ad5e5f`. Actual profile SHA-256: `26564c096c2d3395e7ac6d8374563f7b102d91446a0f34a391a430ae0af1cd2f`. Technical acceptance SHA-256: `996dd1339bc00bbf826289ee43fc38986fdae242b5f32d5e027dda0f6cb7bd49`. Host comparison SHA-256: `ce12e6e928247978d319e89aba22252e283252eef620253c2e6aa8c169de5fda`.

[JSON evidence](fragment-support-v2-reload-v2.json) retains exact commands/exits, primary receipts, raw responses, both requests, metrics/deltas and source/input/model/output pins. Private return: `E:/BhuAayam-data/task-data/ml-distillation/student/fragment-support-v2-reload-attempt2-return-4adb84fdcb344bab90a12ec4a9d16eaf`. Stage: `E:/BhuAayam-data/task-data/ml-distillation/student/adapter-fragment-support-v2-reload-64e5e45b279741efb2811eaa2cb83f9e`. Host comparison: `E:/BhuAayam-data/task-data/ml-distillation/student/fragment-support-v2-reload-attempt2-host-db7f012932b8444eaa23931f6ecfcd1f`.

Only two repository evidence files change. Supplied permissions were `never` / `danger-full-access`; requested Astra/xhigh/default-standard, with actual model/effort/tier unexposed. Original expectations were read once after accepted cleanup and never entered native inputs. Teacher remained blind. Two requests in one development family cannot establish generalization, source accuracy, canonical association, operational truth, evaluation, promotion or release qualification. No further model phase was run or authorized by this result.
