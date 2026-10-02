# STUDENT-08-PREP — citation-view admission and fit counts

2 October 2026. Code preparation complete; no v3 dataset admission or model execution is claimed.

## Checkpoint and scope

- Code commit: `d4de04b5169a841563fe123a3de556f53319146d`, on `task/ml-association-student-20261002` in `C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin`.
- Base: `be4e9b09399ad8c03e4986bab53754be2d324d5c`. Primary staging observed read-only at `671e7696eaf67a40963eb6c8250f56773448533c`; no integration or staging write.
- Coordinator assignment: `docs/evidence/usp/ml-distillation/student-08.citation-view-preparation.assignment.json` at coordinator checkpoint `334467e30cd648a83aec3bec84140bf974b0a5f4`; physical SHA-256 `0a8af5c7be21ef377cb20ba818a46e282990168b5f22954c9afffd7ee81a16b6`.
- Supplied permissions: `approval_policy=never`, `sandbox_mode=danger-full-access`. Requested Astra/xhigh and default/standard speed; actual model/effort/request tier unexposed. No settings change claimed.
- Only six owned Python files and this handoff changed. Protected student/resources/security/model-isolation/dependency sources and original artifacts are unchanged. GPU unused; no owned model process, new stage or temporary dataset to clean up.

## Implementation

`checked_teacher(v1,v2)` retains exact pins and its original implementation. The new `citation_view.py` checks an explicit declaration, unchanged v2 byte prefix, one suffix variant per original in order, deterministic collision-free keys, reversed evidence order, exact teacher metadata and type-sensitive inverse recovery of the complete parent row. Existing schema/citation/literal validation uses only original train families. Expected totals are 22 rows, 124 claims, four conflicts, 44 abstentions and 22 `no_canonical_targets` appearances.

One checked training plan carries dataset/declaration hashes, rows, six epochs and planned updates. It governs shuffle, token preflight, completion, epoch means, result/adapter manifests, fit acceptance and reload proof. Legacy remains 11/66; the new mode requires 22/132. Acceptance checks every progress row, example/epoch order, loss means, supervised-token totals, attention updates and memory/reclamation update histories. New acceptance also rechecks the staged dataset and admission receipt. Reload results carry the same plan; training diagnostic dispatch remains separate from the development summarizer.

The original Qwen revision (`Qwen/Qwen2.5-0.5B-Instruct`, `7ae557604adf67be50417f59c2c2f167def9a775`), prompt, model loader/generation, LoRA/optimizer/seed/numerics, 64-token loss and 128-query attention are unchanged. Existing 6-GiB bounds, minimum free CUDA memory, 600-second phase limit, base/adapter verification and cleanup controls remain. No new runtime performance qualification follows.

## Contract for the later coordinator freeze

No production declaration, v3 digest or new execution assignment is created here. The explicit stage option is `--citation-view-assignment` and accepts only a separate `association-citation-view-fit-assignment/1`, task `STUDENT-08-FIT`. The old stage default still uses STUDENT-06.

The later assignment must retain the existing recipe/model/history/control fields and add:

- `executionAllowance.stageModelRun=true`, `fit=true`; reload additionally requires `inference=true`.
- `studentCodeCommit`: the exact clean checkout HEAD selected for execution.
- `datasetDeclaration`: exactly `version`, `frozen`, `datasetSha256`, `rows`, `parent`, `transform`, `provenance`. Version is `association-citation-view-dataset/1`, frozen is true, rows is 22, parent is the accepted v2 SHA/11 rows, transform is `opaque_keys_reverse_evidence/1`. The SHA must be the actual separately accepted v3 bytes. Missing, malformed, zero, parent or mismatched digests are refused.
- `provenance`: the exact TEACHER-03 assignment object in `citation_view.PROVENANCE` (task/version, assignment path, coordinator commit, canonical LF assignment hash, teacher base commit).
- `trainingPlan`: the exact result of `citation_view.training_plan(datasetDeclaration)`, including SHA-256 of its canonical JSON declaration. The plan is copied into the run freeze and fit receipts.

Admission matches the teacher's observed `augment_citation_views_v3.py` metadata layout: `parentDatasetPath`, `parentDatasetSha256`, `parentExampleId`, `parentRowSha256`, `parentRowHashConvention`, ordered `keyBijection` entries, old/new evidence order and `assignment`. Row hash excludes the LF terminator. The source snapshot was inspected read-only, physical SHA-256 `5aaf2f1a999a35e61f814ca7a57034564ad86f36d81839253ef4a257d667a834`; it was not yet committed when inspected. No teacher code was run and no v3 bytes or digest were read. Coordinator must compare the accepted teacher metadata against this contract before freezing the later fit.

Stage preparation copies the pinned v1/v2/v3 inputs only for fit, using the existing containment argument allowlist. The additional parent input is fixed-name, hash-pinned in freeze and profile; no shared security change. Reload input batches retain their existing model-visible shape without teacher targets or explanations.

## Verification and review

All commands ran from the assigned worktree using `C:/Python313/python.exe`, CPU only:

| Check | Actual result |
| --- | --- |
| `python -B scripts/usp/learning/association/test_citation_view.py` | Exit 0; seven tests, 0.074 seconds. Accepted v1/v2 admission; original retained count receipts; declaration/assignment refusal; bad digest/prefix/count refusal; three individual real-row inverse controls including conflict and unusable approval date; input/output/provenance/citation corruption refusal; 132-update count/reload controls. No second teacher batch assembled. |
| `python -B -` calling `stage_adapter.accepted_fit` on the retained STUDENT-06 fit root | Exit 0; existing fit remains accepted at 66 updates with an 11-row/six-epoch plan. Reads receipts and hashes only; no staging, inference or fit. |
| `python -B -` using `compile(raw, path, 'exec')` on the six owned Python files | Exit 0; all six compile in memory. Test file recompiled after removing its UTF-8 BOM. |
| Same CPU inspection, comparing ASTs with base HEAD | Exit 0; `checked_teacher`, `encode_training`, adapter config/file checks, `_gpu_runtime`, `FIT`, `NUMERICS`, V1/V2 pins identical. |
| `git diff --check`, then `git diff --cached --check` | Exit 0. Reviewed all owned changes, count flow, future assignment refusal, metadata layout and historical diagnostic compatibility. |

Both runtime check scripts asserted that `torch`, `transformers`, `peft`, `safetensors` and `accelerate` were absent from `sys.modules`. Positive v3 whole-dataset admission, model staging/loading, fit/reload, development/evaluation and promotion were deliberately not executed. Count-only receipt fixtures are integrity controls, not fit evidence. Historical accuracy results and source qualification remain unchanged. The fixed supervisor's historical `source_native_development_only` completion wording remains unchanged; it is not new quality evidence.

## Code pins

SHA-256 of committed Git blobs (LF bytes):

| File | SHA-256 |
| --- | --- |
| `scripts/usp/learning/association/association_adapter.py` | `3e8e082856c02058e706f63b265e6efa54aa8c4d00959037517e3b025e720c73` |
| `scripts/usp/learning/association/stage_adapter.py` | `272bc7b4e1c9088002e39d0c38e10f8fc6b4e6a6e5a20f0fca96a25e42af176b` |
| `scripts/usp/learning/association/summarize_adapter.py` | `49ec9cc61e2a93283741309d90fae75ba45054c0b882e7aa0218535e97979845` |
| `scripts/usp/learning/association/test_citation_view.py` | `3535b7d9efa9e32cc654d0e01cd59de4c33e680fa407c4e62b872ff18ace7878` |
| `services/geo/geo/usp_learning/association/adapter.py` | `7617fdce7a143a03a12ada3456d0202d6db50947f2d9ca534c03d29e64f62e91` |
| `services/geo/geo/usp_learning/association/citation_view.py` | `06d17f65230dfab966b1644d8ee75f8e0394615645c6bcc635a70f6d7ffc2cea` |

Return to coordinator for inspection of both preparation results, then a separate frozen fit assignment. No automatic follow-on work.
