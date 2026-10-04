# STUDENT-28 — rank fit code and CPU preparation

Implemented at `865d2bf6135fd4f3d4a31687054bfc2c026eb4b1` from `971fa41aae40359e2b36be37897cd3e06d106928` in the assigned student worktree. No native execution occurred.

## Change

- Added exact, default-off `STUDENT-29-FRAGMENT-RANK-FIT` admission and a thin stage wrapper through the existing stage/guard authority.
- Extended the shared adapter fit with prompt-only binary support loss. Labels select the two next-token logits; they are never appended to input. Exact published weights remain `1/(10*candidateCount)`.
- Each complete parent contributes sequential candidate backwards and one shared unscale/check/clip/step. Six seed 17 permutations give 60 updates/342 contributions. Epoch receipts report sums of parent contributions.
- Shared model/PEFT loading, original frozen base/head, numeric checks, attention/reclamation, resources, save/equality/manifest remain in place. Future native equivalence exercises the actual new helpers against independent analytic sums.
- Future runtime inventory is 33 files: 27 protected dependencies and 6 owned runtime sources. Payload is 11 pinned publication/contract/acquisition files plus requirements and the independent assignment/freeze. Historical teacher JSONL/support receipts are not copied.

## Checks

Seven owned sources compiled in memory. The focused native-import-blocked invocation passed three controls and found one test virtualization error: streaming assignment hashing used `Path.open`. The read-only virtual-file double was corrected; only that affected control reran and passed. Initial raw logs are preserved. Final code diff check exited 0.

The controls use real retained train publication, source hashes and donor **metadata**. Stage/host/worker paths stop at the first intercepted mkdir/guard/output effect. Shared fit admission reaches its pre-native import boundary. Tokenizer, tensor/autograd, decoder/head, scaler/optimizer, phase/reclamation and native-proof operations are explicitly doubled. These results do not qualify native token IDs/lengths, precision/gradients, model fit/save/reload or relevance.

All 36 protected review sources, 14 retained train authority files, publication, lineage, labels, prompt and policy are unchanged. No runtime/model/tokenizer bytes, development/evaluation inputs or live provider were opened. No stage/profile, GPU process, fit, inference, new label/publication, staging edit, push or deployment occurred.

## Handoff

Private receipts: `E:\BhuAayam-data\task-data\ml-distillation\student\fragment-rank-fit-code-v1-fc6a4a56245443c1b91834047c6ee3d6`. The [JSON receipt](fragment-rank-fit-code-v1.json) links source/input/plan/policy pins, command logs and the disabled prototype. Receipt-index SHA256: `c4b7219756fd6400ab4835fb2f96527430b805d332160b16c214e4a06f8c1e8b`.

The prototype records the implemented code checkpoint and exact future inputs/settings; it carries no command, launch allowance or final execution head. Coordinator review and a separate positive final-clean-head STUDENT-29 assignment are still required for native fit. Rank reload remains outside this increment. The original-base recall miss remains open.

Ten provisional related parents/two train families remain `needs_independent_review`; 57 pairs are not 57 independent examples or operational facts. Sarvam is excluded. Requested Astra/xhigh/default-standard; actual model, effort and tier were unexposed. Supplied permissions were never/danger-full-access.
