# STUDENT-03 — first backward passes; third-step Job peak fails

2 October 2026. **The objective-preservation control passed, and the original failing first backward/update completed within bounds. The single repaired run was rejected after optimizer step 3 because its recorded Job committed-memory peak exceeded 6 GiB.** No adapter was saved, and reload/development comparison did not run. Code: `59931b64a6d048f52b423fa5955f4ae8e2e449a4`. [The receipt](memory-repair-attempt-v1.json) records exact commands, 27 compact artifact pins and 12 executed source pins.

## Implemented repair

The pinned Qwen2 implementation calls its decoder and then `lm_head`; PEFT 0.17.1 keeps the q/v adapters inside that same decoder, and its LoRA hooks are inert without mixed `adapter_names`. The repair uses one identical decoder forward, selects the original assistant-predicting hidden positions, and computes the frozen head plus float32 summed cross-entropy in non-reentrant, RNG-preserving 64-token checkpointed chunks. Chunk sums are divided by the exact supervised-token count including EOS. No hidden states are detached during training; examples/context and target weighting are unchanged.

The exact model, teacher v2, scientific recipe, epoch order, inference prompt/settings, development expectations and resource caps remain unchanged. Fresh stage/profile hashes pin the memory policy, implementation and control tolerances. A read-only leaf observer records native Job current/peak committed memory, process RSS/private commitment and CUDA current/peak allocation/reservation/free memory. First-step numeric loss is flushed before backward; an observation error cannot replace the original exception. No edits were made to `resources.py`, `appcontainer_audit.py` or `model_isolation.py` in this increment.

## Actual control and fit

The one contained technical control compares full versus chunked loss and hidden gradients for 135 supervised positions, with chunks **64/64/7**, a distinct final EOS target and predeclared tolerances. Unselected hidden gradients remain zero, the head remains frozen/unchanged, and CPU/CUDA RNG states are unchanged. This fixture is not property evidence or a model-quality evaluation.

| Control | Loss absolute difference | Maximum hidden-gradient difference | Result |
| --- | --- | --- | --- |
| CPU float64 | 8.882 × 10⁻¹⁶ | 1.193 × 10⁻¹⁸ | Passed |
| CUDA float16 projection / float32 loss, scale 128 | 4.768 × 10⁻⁷ | 0 | Passed |

All 11 unchanged teacher examples again fit the 4,096-token bound: **490–2,333 combined tokens**, with no truncation/exclusion. The original first row, `teacher-bihar-identifier-conflict`, retained its 1,264 combined / 724 supervised tokens. Its finite loss **0.31136763095855713** was saved before backward; backward, finite adapter gradients, absent frozen-base gradients, clipping and optimizer update passed. Its post-update Job peak was **5,824,798,720 bytes**, within the cap.

| Observation | Actual result |
| --- | --- |
| Optimizer steps executed | **3/66**; full fit rejected |
| Post-update checks passed | Steps 1 and 2 |
| Normal progress records | 2; step 3 was flushed to the phase log before its resource check raised |
| Third row | `teacher-haryana-floor01`, 1,736 combined / 1,240 supervised tokens |
| Detection point | Post-optimizer/synchronization phase observation for step 3 |
| Primary exception | `RuntimeError: native phase Job committed/RSS memory bound exceeded` |
| Job peak / cap | **6,475,112,448 / 6,442,450,944 bytes**; excess 32,661,504 bytes (31.15 MiB) |
| Job current at detection | 6,407,479,296 bytes, below cap; the historical peak caused rejection |
| Sampled peak process RSS | 3,880,374,272 bytes, separately below cap |
| CUDA allocator peaks through failure | Allocated 1,867,337,216; reserved 2,101,346,304 bytes |
| Minimum sampled CUDA free | 5,352,980,480 bytes; no CUDA observation error |
| Instrumentation | 20 flushed phase records; no native/CUDA observation failures |
| Host / guard section elapsed | 416.222 / 223.500 seconds; no timeout |
| Boundary / cleanup | Pre-resume AppContainer token and 6 GiB Job checks passed; zero capabilities, two handles, no output truncation; Job closed and ACL/profile cleanup passed |

The new run has no native allocation or CUDA exception in its output. It demonstrates progress past the original first-backward failure, but it does **not** identify which allocator or subphase caused the third-step committed-memory peak. GPU capacity exhaustion is not supported by these measurements. Losses are from different training examples and are not a quality-improvement metric. Initial frozen-base bytes were hashed; final equality and saved-adapter/reload verification were not reached.

Run: `E:/BhuAayam-data/task-data/ml-distillation/student/adapter-memory-fit-dfd393a451dd489e94089487cec3ad68/`. Profile SHA-256: `4c08771875b8b704e0fc8a0f5e175f741686145b9869eedf2d15875d3e8db4e0`. Control: `16081a471997889be20b3b2104067205b166d849dd8d218c9b2de872c2439008`. Phase log: `48fdfd43aea692c12c3931d44f475b80878a50f6a9318765a65b3183be8d9f75`. Guard: `4b77056a13e7a8cef360515523e9235bad8e1fccbbad2bf07ad21e8db381cf08`. Exact target positions/IDs, first-step base digest, both successful progress rows, failure traceback and rejected output artifacts remain private and pinned.

## Verification and callback

Seven focused code checks passed, including preservation of the original error/native record when CUDA sampling fails; 17 Python sources compiled and the staged diff check passed. A read-only native structure smoke returned the expected 80 bytes. Both objective cases then passed in the actual contained child, and all 12 executed physical sources matched the committed Git bytes after line-ending normalization. No full sandbox, source or historical model campaign was repeated.

There was one authorized execution and **no additional retry**. The prior failed attempt and accepted baseline remain unchanged; baseline quality is still 0/2 valid raw outputs and 0/6 accepted claims. No development comparison, held-out evaluation, teacher correction, promotion, source alteration, shared dependency/system/resource change, service, frontend or gateway work occurred. Teacher remained idle.

Return this precise blocker to the ML coordinator: preserve the objective-equivalence and first-backward success, then separately assign a bounded implementation change that controls the committed-memory peak for the longer third example while retaining all 11 rows, 66 updates and the existing cap. All owned execution has exited; this worker stops after its callback.
