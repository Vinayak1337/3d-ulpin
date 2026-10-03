# STUDENT-20 fragment adapter reload

**Native reload, output transport and cleanup passed; frozen development quality criteria failed.** One stage/reload ran at unchanged execution HEAD `671dfa78d7780d5279d8f110682525bf2c109622`, then one host-only comparison used the two stored baseline responses and unchanged frozen expectations. No native retry, baseline rerun or additional inference occurred.

## Observed selection result

| Request | Candidates | Expected | Baseline | Adapter | Adapter TP / FP / misses |
| --- | ---: | --- | --- | --- | --- |
| IfcBuilding Name | 4 | `c1` | empty | `c1` | 1 / 0 / 0 |
| Supplied non-null numerical building elevation | 3 | empty | empty | `c0`, `c1` | 0 / 2 / 0 |

The adapter recovers the building-name fragment. For the numerical-elevation request it selects an **absent** Elevation fragment and an explicitly **null** ElevationOfRefHeight fragment. These are unchanged source fragments, but neither supplies the requested number. Their selection is a relevance error; no generated numerical value is credited.

| Metric | Baseline | Adapter |
| --- | ---: | ---: |
| Valid whole responses | 2/2 | 2/2 |
| Exact request sets | 1/2 | 1/2 |
| Accepted true positives | 0 | 1 |
| False positives | 0 | 2 |
| Misses | 1 | 0 |
| Aggregate precision (including unsupported selections) | null (none selected) | 1/3 |
| Positive recall | 0/1 | 1/1 |
| Correct context-limited empty retrieval | 1/1 | 0/1 |

Supported-request precision is 1/1; unsupported-request precision is 0/2 and recall is null. Both prompts/contexts, candidate order, neutral IDs, prompt hashes and token lengths (1,290 / 921), greedy settings and fragment/controller definitions match the baseline. Adapter outputs are 85 / 88 tokens; baseline outputs were 83 / 83. Raw responses were saved before strict whole-response projection. No repair, fallback, forced choice or partial-response credit was used.

The controller guarantees JSON/schema, context identity, distinct current IDs and unchanged fragment projection. It does not guarantee relevance. Two requests from one development family do not establish generalization, extraction accuracy, conflict completeness, canonical association, operational truth or release readiness.

## Native proof and resources

The explicit local original base files match their frozen pins, and all **96 reloaded adapter tensors** exactly match the accepted saved adapter. No parameters are trainable during reload. The existing reload runner emits no fresh in-memory base-tensor digest; base equality here is the admitted original model bytes plus explicit local loading, with the previous fit's immutable-base proof retained. All 11 accepted-fit bindings match.

Native tokenizer/controller callback and final byte/text transport passed for both complete EOS-terminated outputs. Stage, guarded reload, post-output technical admission and the completed host comparison exited **0**. The first host helper stopped before scoring because it compared the training wrapper with bare fragment metadata. Its source/logs are retained; the corrected reader confirms identical nested fragment/controller metadata. Original expectations were read once, only after accepted outputs and cleanup, and stayed outside the native stage.

All memory observations remain inside the 6 GiB Job/RSS/CUDA caps and 1.5 GiB CUDA-free floor:

| Observation (bytes) | Baseline | Adapter | Adapter minus baseline |
| --- | ---: | ---: | ---: |
| peakJobCommittedBytes | 5,431,214,080 | 5,461,258,240 | +30,044,160 |
| peakProcessRssBytes | 3,259,510,784 | 3,264,638,976 | +5,128,192 |
| maxCudaAllocatedBytes | 1,291,972,608 | 1,294,135,296 | +2,162,688 |
| maxCudaReservedBytes | 1,356,857,344 | 1,358,954,496 | +2,097,152 |
| minimumSampledFreeCudaBytes | 6,030,360,576 | 6,028,263,424 | -2,097,152 |

Observed generation times changed from 2.385 / 1.959 seconds to 3.164 / 2.785 seconds (+0.779 / +0.825). Model load changed from 1.691 to 1.996 seconds; model section from 6.041 to 7.950 seconds. Reload command wall time was 301.375s and guard aggregate 129.547s. These are single-run observations; separate setup/child/cleanup timings are not exposed, and no generalized speed claim follows.

The existing 600-second child guard accepted exit 0, closed the Job, revoked scoped ACLs, restored owner/integrity settings and deleted the AppContainer profile without cleanup errors. No owned native process or pending tool session remains. Originals and all outputs are retained.

## Evidence and handoff

| Artifact | SHA-256 |
| --- | --- |
| Actual reload freeze | `cd31d0ffdd3121df01d3f3521ef96c4058493f4c7b1cc4a2d578e61e7c7161cc` |
| Actual profile | `ceab2bac1e8bc77591835c6d66bc7e369af6887208acb357bf471c62c9b38db4` |
| Guard | `9dcf3f8d1ee107cf5aabbf9c09597a2fdabbfa15859f4f095c29b95d1b5a6fe0` |
| Output acceptance | `d31d9f5fa674ec57c9aea11fb1563c65d0ec8457a327cc15ffafa973733bb4b8` |
| Native result | `c9fbb0097609b93dde4de0e5170c5a4915adf1412aa144681e476f047807fa23` |
| Technical acceptance | `522477fffdf5842a9a0b846aa247b8b690bb808896f441de658f9690836b7712` |
| Single host comparison | `8dd735628320ff0e8e89c2bea04bd56c67503caa1d85ebc2e31fd84f1c511ce0` |

[JSON evidence](fragment-adapter-reload-v1.json) records exact commands/exits, source/input/model/profile/output pins, raw texts, per-request metrics, resource/timing deltas and the retained helper failure. The actual profile has 19,688 entries and 31 executable-source pins; six native output files are accepted. The two evidence documents are the only repository changes.

Stage: `E:/BhuAayam-data/task-data/ml-distillation/student/adapter-fragment-reload-ee14485e297c4bc2aacd41c67b0c8077`. Return receipts: `E:/BhuAayam-data/task-data/ml-distillation/student/fragment-reload-return-a747d2d33ddd4b45ac00d3c3f4fb7bfe`. Host comparison: `E:/BhuAayam-data/task-data/ml-distillation/student/fragment-adapter-reload-v1-host-b8446233a35e4cb9bf4cfb95cca59b45`.

Supplied permissions: `never` / `danger-full-access`. Requested Astra/xhigh/default-standard; actual model/effort/tier remain unexposed. Teacher stayed idle/blind to development data; no training, held-out evaluation, acquisition/installation, providers, shared checkout changes, push/deploy or promotion occurred. Return this mixed result for coordinator review; no further model phase is authorized by it.
