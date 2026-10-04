# STUDENT-02 — first backward allocation failure

2 October 2026. **The single frozen fit failed before its first optimizer update. No adapter was saved; reload and development comparison did not run.** Code commit `a25fdd0326b23b98e9719d7c757674911281b0ce` adds fixed fit/save/reload entry points and fresh containment staging. [The receipt](adapter-attempt-v1.json) records exact commands, all 22 compact artifact pins, ten executed source pins and the observed blocker.

## Actual attempt

The teacher v2 SHA-256 is `7510a7040afb7bec2bba9422eb5e14bbf0664c927bd0c2b24989c1af6dc7674c`. Both host and contained checks confirmed that all 11 inputs, 62 claims, two conflicts and prior decisions/lineage are unchanged from v1; only the required canonical-target abstention and correction provenance were appended. Teacher outputs remain provisional supervision. Five rejected OCR interpretations remain excluded.

The exact pinned Qwen tokenizer measured **490–2,333 combined tokens**, below the frozen 4,096 limit for all 11 examples. No truncation or row exclusion occurred. The fit stage contained training data only; development inputs/expectations were absent. The baseline prompt, generation settings and development artifacts were preserved.

The recipe remained Qwen2.5-0.5B-Instruct at `7ae55760`, q/v LoRA rank 8, alpha 16, dropout 0.05, six epochs, batch/accumulation 1, AdamW learning rate 0.0002, seed 17, assistant JSON plus EOS loss only, checkpointing enabled and cache disabled. Float32 adapter parameters and a float16 base use the pinned PEFT/GradScaler path. The stage reused unchanged baseline runtime/model bytes plus offline PEFT 0.17.1 and Accelerate 1.10.1 wheels, with their retained origin/licence receipts. No shared environment was changed.

| Observation | Actual result |
| --- | --- |
| Teacher delta / token preflight | Passed, 11/11 examples |
| Completed updates | **0/66** |
| Failed operation | First `scaler.scale(loss).backward()` on `teacher-bihar-identifier-conflict` |
| Native / Python errors | `fatal : Memory allocation failure`; `torch.AcceleratorError: CUDA error: unknown error` |
| Job peak committed / cap | **6,466,048,000 / 6,442,450,944 bytes**; recorded peak exceeds cap by 23,597,056 bytes (22.5 MiB) |
| Sampled peak process RSS | 3,209,150,464 bytes; separate from committed memory |
| GPU samples before failed backward | Maximum sampled allocated 1,751,900,672; reserved 2,449,473,536; minimum free 4,939,841,536 bytes |
| GPU qualification | Three samples ending after first forward; full failed-backward peaks were not captured |
| Exit / acceptance | Child and host exit 1; outputs rejected; no accepted-fit receipt |
| OS boundary | Actual zero-capability AppContainer, token and 6 GiB Job checked before resume, two inherited handles |
| Cleanup | Job closed; grants/profile and owner-label cleanup passed |
| Host / guard section elapsed | 431.865 / 225.719 seconds; no child timeout |

The finite-loss check completed before the failed backward, but the numeric loss was not persisted. `fit-progress.jsonl` is empty. Frozen-base equality after fitting, saved-tensor verification and fresh-process reload therefore remain unexecuted. The native allocator's precise failure mode is unresolved; the recorded Job peak alone makes this run fail the frozen resource criteria. This is not a claim that GPU capacity was exhausted.

Run: `E:/BhuAayam-data/task-data/ml-distillation/student/adapter-fit-ccad3d0c51fb478493b0c4765ea04d6a/`. Profile SHA-256: `997b561e2cd177070be23de3241e2beda0b96d6e5cefee6d8aee5f0b8abd7f46`. Failure: `aac309bf18af8a2c8a3f71f9e2076bd4672d19c45955647fc3ac2fb6160b71c4`. Guard: `4fdff8b8230c15091d68132d2efdbede8ed701f4a5b16bfa2d81e806fd577888`. Token proof: `6df56d3c999fde56b9d8c0689109cc30e52694ca3841543388136aa32a44da62`.

## Verification and handoff

Six focused controls passed for the exact teacher delta, assistant-only mask/EOS alignment, direct host refusal, adapter file/config integrity, fixed fit/reload arguments and unchanged baseline generation path. Six affected student controls also passed; 15 Python sources compiled and the staged diff check passed. Their actual command/exits and final source hashes are retained in `checks-v2-a25fdd03/checks.json`. The ten executed physical sources match the committed Git bytes after recorded line-ending normalization. No full sandbox campaign or baseline model rerun occurred.

The existing baseline remains 0/2 valid raw responses and 0/6 accepted claims. There is **no tuned quality result**. Evaluation content and historical mapping data stayed closed. Original sources, rejected teacher interpretations, baseline receipts and failed-run artifacts are preserved. No service, frontend, gateway, security primitive, shared dependency, credential or resource-limit changes were made.

Per the frozen assignment, there was **one attempt and no changed-parameter retry**. Return this exact blocker to the ML coordinator: a separately assigned repair must make the first backward fit within the existing committed-memory bound before another training attempt. No teacher-label correction is indicated by this runtime failure. This worker stops after the result callback.
