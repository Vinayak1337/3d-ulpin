# STUDENT-29 — one rank fit attempt

**Failed at the frozen 600-second child timeout; no saved adapter.** One stage and one exact generated guard command ran from clean `8176cd8e74ebe7312a99b9bc3d7e5d336e4bf396`. No retry or executable edit followed.

## Observed outcome

- Staging passed: 19,686 profile entries (19,630 runtime, 9 model, 33 source and 14 input files). Generated freeze and canonical profile map matched the protocol.
- All 57 actual train prompts passed source/focus and single-token label-boundary admission. Maximum prompt length was 3,375 tokens; no truncation or exclusions.
- Actual weighted-loss/parent-accumulation equivalence passed four CPU/CUDA and fp32/fp16 cases. Attention and reclamation controls passed with RNG restoration.
- The original model loaded with a frozen head, 96 trainable tensors and 540,672 parameters. Base-before digest covered 290 tensors: `7c651c8be4013651138142820f0e895a170054851eb3edd6ed3fcd64027b0c44`.
- **44/60 optimizer updates completed.** These complete parents contain 253 candidate contributions. Two further candidate backwards completed inside parent 45 (epoch 5); the third candidate reached pre-backward reclamation. Total recorded: 256 forwards/losses and 255 backwards. The partial parent received no optimizer update.
- Ordered progress, exact parent loss sums, finite gradients/losses, scale 128, frozen-gradient absence, query-block attention and retained-gradient reclamation histories match the completed prefix. Full fit/save/base-after/accepted-output checks remain unrun.

Complete epoch contribution sums were 0.6672022424, 0.5498685832, 0.4767307865 and 0.4323174514. These are **in-sample sums at successive parameter states**, not a relevance result.

## Resources, timing and cleanup

| Observation | Bytes |
|---|---:|
| Maximum recorded Job commitment | 5835636736 |
| Maximum recorded process RSS | 4102279168 |
| Peak recorded CUDA allocation | 1487139328 |
| Peak recorded CUDA reservation | 1635778560 |
| Minimum recorded CUDA free memory | 5717884928 |

Recorded memory stayed within the 6 GiB caps and 1.5 GiB free-memory floor. The guard's terminal observation is empty after timeout; these are retained child self-observations, not terminal supervisor peaks.

Stage duration: 149.547s. Full host guard command: 788.687s. Supervisor receipt clock: 624.672s. Last child phase record: 510.973s; completed update durations total 495.911s. These clocks cover different scopes.

The guard exited 1 with `TimeoutError: probe timed out after 600000 ms`, `outputsAccepted=false`, and cleanup passed. Protected termination closes the owned Job and waits for the child; one post-run process snapshot found no process tied to the exact stage. ACL revocation, profile deletion and SID freeing passed. No adapter, resume checkpoint, fit result, manifest, completion, accepted map or attention-scope restoration receipt exists. Preserved outputs are diagnostic only.

## Receipts and boundary

[Structured evidence](fragment-rank-fit-v1.json) contains exact commands/exits and primary hashes. Private recovery and receipt index: `E:\BhuAayam-data\task-data\ml-distillation\student\fragment-rank-fit-technical-v1-90b3623b587341d2b0555c4a95f82393`. Stage: `E:\BhuAayam-data\task-data\ml-distillation\student\adapter-fragment-rank-fit-d2eddcc973224e04abd13090b66762d9`. Recovery SHA256: `7acb90baee15ea480190ede90b8adb2ed68aa5c6ffbdbf1ebdae5c63c9858960`.

No reload/inference, development/host expectations, evaluation, teacher/new labels, publication changes, acquisition, providers, shared services, executable/staging edits or deployment occurred. Inputs and source bindings were rechecked from retained bytes. Ten provisional parents/two train families remain `needs_independent_review`; Sarvam is excluded. The known relevance miss remains unresolved.

Requested Astra/xhigh/default-standard; actual model/effort/tier were unexposed. Supplied permissions: never/danger-full-access. Any further experiment requires a new coordinator assignment.
