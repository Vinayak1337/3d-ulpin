# STUDENT-04 — six updates pass; longest-example backward fails

2 October 2026. **Unused-cache reclamation preserved the tested state and next-step calculation, and six of 66 planned optimizer updates completed within bounds. The single fresh fit was rejected during the seventh example's backward pass.** No adapter was saved; reload and development comparison did not run. Code: `4df9a0278d9fcef6f987b2c5307b2a82a24744e2`. [The receipt](reclamation-attempt-v1.json) records exact commands/exits, 29 compact artifact pins and 13 executed physical/Git source matches.

## Change and control

After scalar progress capture, the loop clears gradients with `set_to_none`, releases finished tensors including the norm scalar, synchronizes, collects unreachable Python cycles and empties unused CUDA cache. The same reclamation runs after setup. Model parameters, Adam moments, scaler, encoded examples, epoch order and RNG remain alive. Cumulative resource peaks are checked before and after cleanup and never reset. Phase records identify every example's start, decoder, loss, backward, optimizer and reclamation, including reserved-minus-allocated memory.

The contained two-step technical control compares cleanup and no-cleanup paths with dropout. Parameter/optimizer/scaler/RNG fingerprints, next-step loss and gradients, and final state match exactly. Persistent identities and cumulative peaks are preserved, and training RNG is restored. Both existing CPU/CUDA loss-equivalence cases also pass. These controls establish the tested implementation behavior; source accuracy and model quality remain unqualified. The earlier loop already deleted six large references, so these results do not establish a retained-graph leak.

The frozen Qwen2.5-0.5B-Instruct revision, teacher v2, q/v LoRA recipe, seed 17, six epochs/66 updates, 64-token checkpointed head loss, exact supervised-token denominator/EOS, prompt and comparison expectations are unchanged. All 11 training rows fit the 4,096-token limit: **490–2,333 combined tokens**, with 62 claims and two conflicts preserved and no truncation or exclusion. The fit starts from the original seed; rejected weights were not resumed.

## Measured result

There are six optimizer updates, six ordinary progress rows and six completed reclamations with passing bounds. The first three training losses exactly match STUDENT-03. The former third-update blocker now passes:

| Memory after update 3 | Before reclamation | After reclamation |
| --- | ---: | ---: |
| CUDA reserved bytes | 1,986,002,944 | 1,115,684,864 |
| Job current committed bytes | 6,251,134,976 | 5,501,050,880 |
| Cumulative Job peak bytes | 6,251,134,976 | 6,251,134,976 |

Reclamation released **870,318,080 bytes** of CUDA reserve while Job current commitment fell **750,084,096 bytes**. The historical peak stayed intact.

| Failure observation | Actual result |
| --- | --- |
| Example / position | `teacher-haryana-title02`, epoch 1, seventh row; longest example |
| Tokens / pre-backward loss | 2,333 combined / 1,693 supervised; finite loss `0.13900867104530334` |
| Operation / exception | `scaler.scale(loss).backward()`; `torch.OutOfMemoryError`, attempted 292 MiB allocation |
| Job peak / cap | **6,501,675,008 / 6,442,450,944 bytes**; excess **59,224,064 bytes** |
| Job current before backward / at failure | 6,295,699,456 / 6,354,853,888 bytes |
| Sampled peak process RSS | 4,096,962,560 bytes |
| CUDA allocator peaks through failure | Allocated 1,962,219,008; reserved 2,051,014,656 bytes |
| Instrumentation | 74 flushed phase records; zero native/CUDA observation errors |
| Execution / timing | Child and host exit 1; host 421.691 s, guard setup/child/cleanup 229.172 s; no timeout |
| Containment / cleanup | Pre-resume token/Job checks passed; zero capabilities, two handles, no output truncation; Job closure and ACL/profile cleanup passed |

The CUDA diagnostic reported about 5.01 GiB physically free, 5.45 GiB allowed and 1.71 GiB allocated by PyTorch. The recorded cumulative Job committed peak also exceeded its cap. The exact allocator/backing cause remains unresolved; physical GPU exhaustion is not established. The seventh optimizer update was not reached. Initial frozen-base digest is retained; final base equality, saved-adapter checks and reload were not reached. Training losses do not establish a quality improvement.

## Verification and handoff

Seven focused code checks passed (0.092 s), 18 Python sources compiled, and the code diff check passed before execution. Those checks and the completed contained controls are reused for this evidence-only continuation. The saved JSON receipt is unchanged, SHA-256 `df2a19320fbd708b6cd75cfafe5f79ee9ebb575190071b9f4566acbe17be26cd`.

Run: `E:/BhuAayam-data/task-data/ml-distillation/student/adapter-reclaim-fit-9b5cf233e4bc4030abeb09a2b154e20d/`. Profile SHA-256: `b2f7ff3d22355ea6c941dd95f5edd4f7e24f8957be7961febf6fd367da0be606`. Reclamation control: `6fd23509a89eb281a93e240486a6c8edb05121dab836044c5328b356f03c7a20`. Phase log: `cdfbe4e2e73cd55be7d1a679ddb54aa93f5862e8132b28adc18b21b0fa6bffbb`. Guard: `234e66b70f2e5564c7553c87ffe49378b1506b8b26d5bc0ec31c7e502bc83f85`. Failure: `2c74a015197598386bd34b087a25686b53c85f37606e303042045563f5876624`.

The authorized attempt is exhausted. Return the longest-example backward failure and committed-memory breach to the ML coordinator for a separately scoped repair before any further run. Baseline quality remains **0/2 valid raw outputs and 0/6 accepted expected claims**. No new development result, held-out evaluation, teacher correction or promotion exists; teacher remains idle. Resource caps, originals, shared dependencies and security primitives are unchanged. All owned execution has exited and cleanup passed. This worker stops after the callback.
