# STUDENT-06 — full fit passes; development quality fails

2 October 2026. **The one authorized fit completed all 66 updates within the recorded resource bounds, preserved the base weights and saved an exact adapter. Fresh reload passed; development quality failed with 0/2 valid raw outputs and 0/6 accepted expected claims.** Code: `c852f5a9dc0f0bae981c9cf956bf9e1948253ac8`. [The receipt](query-sdpa-attempt-v1.json) binds exact commands/results and private artifacts to the executed code. No second fit or comparison was run.

## Change and equivalence

Fit-only attention processes contiguous blocks of at most 128 queries with the existing SDPA math backend. Every block retains all original keys and values; its boolean mask uses absolute query positions. Non-reentrant checkpoints preserve RNG and connected Q/K/V gradients. Original Qwen projections, RoPE, output projection, grouped-query semantics, float16 inputs and float32 math remain. Unsupported shapes, masks, cache and sliding-window options fail explicitly. A Qwen-local interface is restored in `finally`; the shared global registry, baseline and generation route are unchanged.

The frozen 263-token control covers blocks 128/128/7, the offset causal mask and recomputation. Both CPU double and CUDA float16 controls pass the predeclared output/loss/Q/K/V-gradient tolerances. Maximum output differences are `6.938893903907228e-17` and `6.103515625e-05`; maximum CUDA Q/K/V gradient differences are `4.76837158203125e-07`, `9.5367431640625e-07` and `1.9073486328125e-06`. Inputs and training RNG are preserved. Existing loss-equivalence and live-graph reclamation controls also pass. These controls establish bounded technical equivalence, not bitwise equality of complete training runs or source accuracy.

All 11 teacher v2 examples, their 62 claims/two conflicts, six epochs, 490–2,333 combined tokens, assistant JSON+EOS objective, 64-token head chunks, seed/order, q/v LoRA and optimizer settings remain frozen. No row was truncated or excluded. The prior 292-MiB failure motivated this query scheduling; its exact allocation/backing cause remains unproven.

## Fit observations

| Observation | Measured result |
| --- | --- |
| Completed updates / progress rows | **66/66 / 66** |
| Fit / model section | 114.283 / 119.284 seconds |
| Host / guard setup-child-cleanup | 642.728 / 410.766 seconds; child and host exit 0, no timeout |
| Job peak / cap | **5,480,808,448 / 6,442,450,944 bytes** |
| Sampled peak process RSS | 4,232,900,608 bytes |
| CUDA peak allocated / reserved | 1,351,742,976 / 1,537,212,416 bytes |
| Minimum sampled CUDA free | 5,816,451,072 bytes; above the 1.5-GiB floor |
| Instrumentation | 755 phase records, zero observation errors, monotonic cumulative peaks; 133 attention snapshots |
| Base verification | All 290 base tensors unchanged, digest `7c651c8be4013651138142820f0e895a170054851eb3edd6ed3fcd64027b0c44` |
| Adapter save | 96 exact tensors / 540,672 trainable parameters; safetensors SHA-256 `4456b00aba8591c751ecfef8ac78f1272eabd3f56e0212266f8b5fc2c508b485` |
| Scope / cleanup | Qwen interface restored, global registry unchanged; pre-resume token/Job checks, Job closure and ACL/profile cleanup pass |

The full-fit acceptance checks verify every update's complete K/V context, maximum 128-query blocks and all 24 attention layers at decoder/backward boundaries. Base, adapter, controls, phase history and output hashes all pass. Host time includes pin validation and containment setup/cleanup; it is distinct from the bounded child and fit timings. Epoch mean losses declined from 0.35698 to 0.07722; this is a training observation only.

## Reload and development comparison

A fresh contained process loaded the explicit local base and all 96 saved adapter tensors exactly. It used the unchanged two buildingSMART development examples, independent expectations, prompts and generation settings; no teacher inputs or fitting occurred in this process. Input lengths/prompt hashes match baseline; output lengths are 288/281 tokens and neither reaches the 768-token limit.

| Frozen development check | Baseline | Reloaded adapter |
| --- | ---: | ---: |
| Valid raw responses | 0/2 | **0/2** |
| Accepted expected claims | 0/6 | **0/6** |
| Source-native coverage | 0% | **0%** |
| Accepted precision | Undefined | Undefined: no accepted claims |
| Correct absent / null claims | No accepted claims | 0/1 / 0/1 |
| Valid model outputs with required abstention / empty links | 0/2 / 0/2 | 0/2 / 0/2 |
| Extractable exact citations | None | 5/5, only from the parseable but invalid response |
| Generation seconds, complete / incomplete | 4.698 / 4.676 | 20.871 / 19.032 |

The IFC4 response is malformed JSON (`Expecting ',' delimiter`, character 629), with broken citation/claim structure. The IFC2X3 response parses but fails `nondeclared_value_must_be_null`: it uses field names as unknown revision values and omits the expected distinct absent/null claims. Its five extractable citation quotes match input fragments; that narrow citation result does not validate the claims, and the malformed response is excluded from that denominator. The unchanged validator rejects both without repair and returns empty claims/links plus `invalid_student_output` and `no_canonical_targets`.

The reload host/child exited 0; host time was 524.680 seconds and guard setup/child/cleanup 291.359 seconds. Model load/section took 2.690/42.617 seconds. Job peak was 5,174,407,168 bytes; sampled peak RSS 3,214,495,744 bytes; CUDA peak allocated/reserved 1,078,333,952/1,115,684,864 bytes; minimum sampled CUDA free 6,271,533,056 bytes. All measured resource bounds, pre-resume token/Job checks, Job closure and ACL/profile cleanup passed. These timings describe this run, with no broader speed qualification.

The predeclared development criteria fail. This is one family with two related examples; conflict accuracy, canonical matching and generalization remain unqualified. The adapter is retained as experimental evidence and is not promoted. Evaluations remain closed; development content/predictions were not sent to the teacher or turned into training targets.

## Verification and handoff

Eight focused checks pass (0.141 s), 19 sources compile, the frozen attention-control constants match the assignment and the code diff check passes. The stage acceptance and final `summarize_adapter.py <fit-root> --reload-root <reload-root>` checks exit 0. Evidence collection matches 14 executed physical sources to committed Git bytes after line-ending normalization in both environments. Existing containment/dependency verification is reused. No shared dependency, security primitive, frontend, original source, canonical record or evaluation changed. Default/standard speed is required; actual turn model/effort/tier is unexposed. The assignment's historical Astra/max wording is preserved separately from the current user policy.

Fit root: `E:/BhuAayam-data/task-data/ml-distillation/student/adapter-query-sdpa-fit-f90a65c82dde45ae9c2e0ce4a60dddcd/`. Profile SHA-256: `75c3ebe9d116846026b9924402446ef5d457bd929a324407f899f13ce1a45a45` (19,661 pins). Attention control: `3276075010dc5c3874ec9ff34e77365696ed35d458e96504449105c786ffab81`. Block history: `b831cd4cc25a505bb21cb6a9c3758f76ffd6edc302bbe50fd39fb3c2dfe46f56`.

Reload root: `E:/BhuAayam-data/task-data/ml-distillation/student/adapter-query-sdpa-reload-264850e669c14b4d846411326349118d/`. Profile SHA-256: `2c0447a415717f32132f3da1b7b16e982ec94362c5d193209d033e3763f03000` (19,665 pins). The completion receipt pins 38 fit and 27 reload artifacts; its SHA-256 is `de954d2fc45a2621b3993a51827f05306f098776442d0a1b6f4392ce14e69c83`.

All owned model processes have exited and cleanup passed. Return the successful memory repair and failed quality comparison to the ML coordinator for a separately scoped next decision, then stop. The authorized single fit/reload allowance is exhausted; no promotion, additional fit, output repair, teacher correction, evaluation or shared gateway registration follows from this result.
