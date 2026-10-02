# STUDENT-07 — fixed training-family generation diagnostic

2 October 2026. **Both training responses pass JSON/schema checks; only one passes full validation. Accepted reconstruction is 1/7 provisional claims (14.29% coverage), so in-sample generation remains unreliable.** The one inference phase, exact adapter reload and resource/cleanup checks passed. Code: `559b2b12fd1e501b9ad1941c00839691ef9f2f35`. [The receipt](training-generation-v1.json) retains commands, raw-output pins, comparisons and limits.

## Scope and execution

One fresh contained process reloaded the accepted experimental STUDENT-06 adapter and generated exactly once for `teacher-haryana-floor02`, then `teacher-bihar-unusable-approval-date`. All 96 saved adapter tensors matched exactly. Both cases remain **train** in the frozen families; seven accepted provisional teacher claims provide the host-only comparison. This is in-sample reconstruction, not independent source truth, accuracy or generalization. The previous development result stays **0/2 valid outputs and 0/6 accepted claims**.

The new leaf keeps the original `SYSTEM_PROMPT`, `prompt_messages`, chat template, `SETTINGS`, greedy generation and inference attention. It reuses the existing exact adapter loader; `student.py` and all shared containment/resource files are unchanged. Both prompt hashes/token counts are checked before generation. The fresh input batch contains only the two unchanged source inputs; targets, explanations, development files and expected outputs are absent. The host reads the original pinned teacher targets only for selection/integrity and post-inference comparison.

The supervisor's fixed completion field `qualification=source_native_development_only` is legacy metadata. It is **not** this run's scope: the pinned `trainingDiagnostic` assignment, freeze and result explicitly identify training-only reconstruction. No development run or relabelling occurred.

Three focused checks pass (initial 0.023 s/final 0.021 s), five owned Python sources compile, and diff checks pass. The checks reject family relabelling, reordered/changed inputs and injected targets; they match the original generation-loop AST except for true train-split validation and verify unchanged protected source bytes. No model dependencies were imported on the host. Supplied permissions are `never` / `danger-full-access`; requested Astra/xhigh/default-standard, with actual turn model/effort/tier unexposed.

## Results

| Observation | Haryana floor02 | Bihar unusable approval date |
| --- | ---: | ---: |
| JSON / schema valid | Yes / yes | Yes / yes |
| Full raw-output validation | Rejected: `literal_not_cited` | Passed |
| Accepted expected claims | 0/6 | 1/1 |
| Raw claim values matching provisional targets | 1/6 | 1/1 |
| Raw extra claim values / missing expected values | 5 / 5 | 0 / 0 |
| Exact raw citation quotes | 7/7 | 2/2 |
| Unknown claims violating literal/unit null rule | 4 | 0 |
| Raw no-canonical-target abstention / empty links | Yes / yes | Yes / yes |
| Raw abstentions equal target | No: extra `floor_unknown` | Yes |
| Input / output tokens | 424 / 367 | 378 / 112 |
| Generation seconds | 24.213 | 7.125 |

Haryana emits the correct `TOWER03` building claim, then cites that same tower-only fragment for five other literals. It labels the complete floor caption as one floor and the printed `13rd`, `21st`, `30th`, `38th` as unknown **level** values with non-null literals. All five of those literals are absent from their own citations; four also violate the unknown/null rule. The spelling `13rd` is present unchanged in the raw text but is **not an accepted floor claim**. The whole response is rejected without repair, so its correct building claim receives no accepted credit.

Bihar's entire raw JSON object equals the frozen provisional target (canonical SHA-256 `77fd0df366bfad76a174c6d9f6dd6d58e1a61f371359b76f8394c75659432392`). It preserves the revision as unknown with literal/unit null and retains `approval_date_unusable` plus `no_canonical_targets`. This does not establish an actual approval date.

Across both cases, accepted precision is **1/1** with **1/7** coverage and zero extra accepted claims. Raw inspection finds **2/7** target-matching claim values, with five extra/missing values in the rejected response. All **9/9** raw quotes match their keyed fragments, but that metric does not establish claim support: the Haryana literals reference the wrong fragment. Both raw outputs retain empty canonical links and the required abstention; only the valid Bihar output earns accepted credit. Empty conflict arrays match both targets, leaving conflict accuracy unmeasured. Neither output reaches the 768-token limit.

Host and child exited 0. Host time was 475.551 seconds; guard setup/child/cleanup 263.687 seconds; model load/section 2.547/33.891 seconds. Job peak **5,174,374,400 bytes**, sampled peak RSS **3,215,663,104 bytes**, CUDA peak allocated/reserved **1,073,165,312 / 1,111,490,560 bytes**, and minimum sampled CUDA free **6,275,727,360 bytes** all satisfy the original bounds. Pre-resume token/Job checks, zero capabilities, two inherited handles, Job closure and ACL/profile cleanup passed.

## Retained evidence

Run: `E:/BhuAayam-data/task-data/ml-distillation/student/training-generation-b4e13b7ea0e842e4a8bf84993d53d397/`. Profile SHA-256: `b5cc9f63ff7fa76b1e8c642e98e6f68b85b6afc899194176100d7ec08a6ca93a`, 19,667 pins. Frozen assignment SHA-256: `1db41c509fc91f42d5e15c90229ca82c93b0224c66185ee56444bfe4445aaf61`. Original saved adapter SHA-256: `4456b00aba8591c751ecfef8ac78f1272eabd3f56e0212266f8b5fc2c508b485`.

Staging and the host comparison command exited 0. Receipt SHA-256: `39ffe37c249e3426f4535029322928ed2727dc5e8073ac7cc2ecb38811b53bd2`; 28 retained artifact pins and 15 executed physical/Git source matches. `hostComparison` contains strict accepted-projection metrics; `rawInspection` separately records the rejected response's content without crediting it. Raw outputs and original comparison artifacts are preserved unchanged.

The concrete training-family errors are citation binding, role/state assignment and null handling; a cross-family coverage gap alone cannot explain this result. No new fit, teacher correction, output repair, constrained decoding, dataset expansion, model change, evaluation or promotion followed. The teacher remained idle. All owned execution exited and cleanup passed; return these train-case predictions/errors to the coordinator, then stop pending its next scoped decision.
