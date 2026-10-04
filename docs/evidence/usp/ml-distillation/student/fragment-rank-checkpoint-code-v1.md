# STUDENT-30 — full-state checkpoint code

Implemented at `d98903f7cee2fdf7e82b12c785f5445978c309c9` from `7a42a9e3d70b816612def13dec7125b9215d4dc7` in the assigned learner worktree. This is code and standard-library CPU preparation only; no model/native phase ran.

## Change

- Added a separate exact phase assignment/freeze and thin shared-stage entry. Fixed ranges are **0→20, 20→40, 40→60**, each 20 complete parents/114 candidate contributions, preserving the same global schedule and recipe.
- Checkpoints store 96 named fp32 masters (540,672 parameters), AdamW moments/steps/group order, all five GradScaler entries, full cursor/loss/order history, and CPU/CUDA/Python RNG. The tensor map contains 386 tensors.
- Bounded strict JSON and safetensors have exact names, shapes, dtypes, finite numeric payloads, offsets, sizes and hashes. Writes are exclusive, flushed/fsynced and closed; exact readback and RNG neutrality precede the final manifest. Partial saves cannot resume.
- Resumption requires protected `accepted_outputs`/guard/completion authority, explicit phase receipts and an independently pinned acceptance. The next phase receives five readonly predecessor files through existing containment paths.
- The shared original-model/PEFT/optimizer lifecycle remains. Fresh objects restore state/RNG after setup and before the next parent. Phases 1/2 report phase completion and save checkpoints; only phase 3 produces the final adapter through the existing exact-save path.
- A future tiny native dropout/AdamW/GradScaler proof uses the actual serializer and fresh objects to compare continuation exactly. It is **unrun**, required before future phase 1 fitting.

## Verification

One `python.exe -B -I -S .../test_fragment_rank_checkpoint.py` invocation passed **4 controls**, exit 0. All **7 owned sources** compiled in memory; code diff check exited 0. No old campaign was rerun.

Real retained train metadata, donor metadata and source pins were used. Tensor/device/RNG/optimizer/safetensors operations are explicit stdlib doubles. Positive phase 1/2 admission uses virtual readonly metadata and a doubled prior guard, then stops at the first mkdir; no stage is created. Worker/shared-fit checks stop before native imports. Roundtrip, modeled split-run continuity, malformed state, changed hashes, forged predecessor acceptance and incomplete-save refusal passed. These do not establish native numeric or save/resume equivalence.

All **40 protected sources** match their physical/canonical snapshot. The **14 retained train authorities** and historical timeout artifacts are unchanged. Future execution closure exactly matches the packet: **35 sources**, comprising 29 protected dependencies and 6 owned runtime files. Inputs number 14 for phase 1 and 19 for later phases. The prior 44 updates cannot resume because no checkpoint exists.

## Handoff

[Structured evidence](fragment-rank-checkpoint-code-v1.json) links exact commands, source/input hashes, checkpoint schema/tensor map, phase plan, and three **disabled** prototypes. Private receipts: `E:\BhuAayam-data\task-data\ml-distillation\student\fragment-rank-checkpoint-code-v1-f2403b84dc2249caa8f7663b523fdc58`. Receipt-index SHA256: `bdc09ad257ebac868f5bc854abe19de0cfc23aad5f2108cc98484e110b695389`.

Native serialization/RNG shape/optimizer continuity, model phase/save/resources, reload and relevance remain unqualified. Independent coordinator review and a separate positive assignment are required per phase. No executable positive assignment, stage/profile, runtime/model/tokenizer byte read, GPU work, development/expectation/evaluation access, labels, provider/service/host changes or staging/push/deployment occurred.

State coverage reuses saved PyTorch 2.8.0 and Accelerate 1.10.1 research; references and attribution are retained. No new dependency or upstream serialization code was copied. Requested Astra/xhigh/default-standard; actual model/effort/tier were unexposed. Supplied permissions: never/danger-full-access.
