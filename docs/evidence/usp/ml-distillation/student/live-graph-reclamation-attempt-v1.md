# STUDENT-05 — live-graph cleanup passes; longest backward still fails

2 October 2026. **The live-graph control passed and pre-backward cleanup released unused reserve, but the single fresh fit again failed on the seventh example's backward pass after six of 66 updates.** The fit was rejected; no adapter, reload or development comparison exists. Code: `cb93c4eebdc33d01fb2fcfeb6912ff378e85dddb`. [The receipt](live-graph-reclamation-attempt-v1.json) records exact commands/exits, 29 compact artifact pins and 13 executed physical/Git source matches.

## Change and control

The existing `release_unused_cache` routine now runs immediately before backward, after the finite-loss and cumulative-bound observations. Input, target, hidden, loss and saved autograd/checkpoint references remain live; this boundary does not clear gradients, detach tensors, rerun the decoder or reset peaks. Setup and completed-update cleanup remain. Paired phase samples retain example/update, numeric loss, supervised denominator, Job current/peak, RSS/private commitment and CUDA allocation/reservation/free memory. Fresh stage, fit acceptance and reload proof bind the new policy/control and STUDENT-04 receipt.

The existing two-step contained dropout fixture now also compares cleanup and no-cleanup while its loss graph is live. Forward fingerprints, clipped gradients, parameters, Adam/scaler state, next step and final state match exactly; graph connectivity, live identities, CPU/CUDA RNG and cumulative peaks are preserved. Training RNG is restored. Both existing loss-equivalence cases also pass. These are technical controls, with no source-accuracy or model-quality qualification.

The model/revision, all 11 train-only rows, six epochs/66 updates, q/v LoRA settings, numerics/SDPA, 64-token checkpointed loss, seed/order, prompt and baseline remain unchanged. The rows remain **490–2,333 combined tokens**, with no truncation or exclusion. All six completed losses exactly match STUDENT-04. Seven pre-backward reclamations and six completed-update reclamations passed their bounds.

## Measured cache release and failure

The longest row, `teacher-haryana-title02`, reached pre-backward cleanup at epoch 1/update 7 with **2,333 combined / 1,693 supervised tokens** and finite loss `0.13900867104530334`:

| Memory immediately before backward | Before cleanup | After cleanup |
| --- | ---: | ---: |
| CUDA live allocation, bytes | 1,187,224,064 | 1,187,224,064 |
| CUDA reserve, bytes | 2,051,014,656 | 1,281,359,872 |
| Job current commitment, bytes | 6,200,233,984 | 5,612,740,608 |
| Cumulative Job peak, bytes | 6,227,513,344 | 6,227,513,344 |

Cleanup released **769,654,784 bytes** of CUDA reserve; Job current commitment fell **587,493,376 bytes**. Live allocation and the historical Job peak were unchanged. The subsequent `scaler.scale(loss).backward()` still raised `torch.OutOfMemoryError` requesting **292 MiB**.

| Failure observation | Actual result |
| --- | --- |
| Completed updates / progress rows | **6/66 / 6**; seventh optimizer step not reached |
| Job peak / cap | **6,506,168,320 / 6,442,450,944 bytes**; excess **63,717,376 bytes** |
| Job current at failure | 6,439,059,456 bytes; current below cap, cumulative peak above it |
| Sampled peak process RSS | 4,100,116,480 bytes |
| CUDA peaks through failure | Allocated 2,140,153,344; reserved 2,277,507,072 bytes |
| Instrumentation | 96 flushed phase records; zero observation errors; cumulative peaks monotonic |
| Execution / timing | Child and host exit 1; host 349.636 s, guard setup/child/cleanup 149.657 s; no timeout |
| Boundary / cleanup | Pre-resume token/Job checks passed; zero capabilities, two handles, no truncation; Job closure and full ACL/profile cleanup passed |

The CUDA diagnostic reported about **4.73 GiB physically free**, 5.45 GiB allowed and 1.99 GiB allocated by PyTorch. The exact allocator/backing cause remains unresolved. These observations do not establish physical GPU exhaustion or a retained-graph leak. Pre-backward cache reclamation was insufficient for this fixed run. Initial base digest is retained; final base equality, adapter save and reload checks were not reached.

## Verification and handoff

Seven focused code checks passed (0.095 s), 18 sources compiled and the code diff check passed before execution. Evidence collection matched 13 executed physical sources to committed Git bytes after line-ending normalization. This continuation used the completed run and checks; it did not launch another model execution. At the user's pause check, the run had already exited and cleanup had passed.

Run: `E:/BhuAayam-data/task-data/ml-distillation/student/adapter-live-reclaim-fit-4912a44fb0cd46ecaf967af8bf785dbf/`. Profile SHA-256: `60a1300e7e8df3e922f818a3d4089e217accc17d010acb547f8c2e7711e3fb02`. Control: `25913a18a4701fdcbe7e557c1b107146af3d47c2936f2a3ee24890a2aeb22436`. Phase log: `4a143305f6a905716b65d51094a6eca908cc408a4cb9c3204f000327a47e021d`. Guard: `9784f5088c945b3d0f098eb813bb6ae18b51493929219a065fa4320508a42ab8`. Failure: `73ea5520927276298e975207501e9aa555836045f9d4f98e3689edd1791d09c4`.

Return this repeated longest-example backward blocker to the ML coordinator before a separately assigned repair. The authorized fit attempt is exhausted. Baseline quality remains **0/2 valid raw outputs and 0/6 accepted expected claims**; no quality improvement or promotion is claimed. Teacher remains idle and evaluations closed. Caps, security primitives, dependencies and originals are unchanged. All owned execution has exited; this worker stops after its callback.
