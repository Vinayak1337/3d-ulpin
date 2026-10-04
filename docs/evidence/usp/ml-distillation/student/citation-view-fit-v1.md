# STUDENT-08-FIT — 132 updates pass; development quality fails

2 October 2026. **One authorized fresh-base fit completed all 132 updates, preserved the base weights and saved an exact adapter within the frozen resource bounds. One fresh exact reload passed. Development remains 0/2 valid raw responses and 0/6 accepted expected claims.** No further model run or promotion follows.

The [machine-readable receipt](citation-view-fit-v1.json) records commands, exits, code/model/runtime/data hashes, all 39 fit and 27 reload artifact pins, metrics and cleanup. Receipt SHA-256: `0a4f96f411274c5bfaf27ef9e0f4928804d7604cccf7aee8ee06d7e08686b369`.

## Frozen execution

Executed the exact clean `00b235199b716b426680e452c79649f2afb5d18f` on `task/ml-association-student-20261002`, worktree `C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin`. No Python code changed. Coordinator freeze `546029c42578209ca1337cbe027c753a69a924bc`; assignment SHA-256 `a661132e341e1908ed8ea50edcd9ac581604ed99ac99672ab7bbfb5c619ef861`. Primary staging observed read-only at `d7d61f55ca9d02b4f4fbb7c575b72b55838375c3`.

Accepted v3 SHA-256 `d8ee61f09e474069bf4375ac1cc1b24f574ca18a32b4e49721fa9d415df6d1b4`: 22 rows, 124 claim appearances from the same 62 parent-row claims; exact 11-row v2 prefix plus 11 citation views. No new source facts, absent/null-state or native IFC training examples. All 22 rows survived token preflight, 490–2,495 combined tokens, no truncation/exclusions. Six seed17 epochs produced exactly 132 updates and 81,432 supervised tokens.

Qwen2.5-0.5B-Instruct revision `7ae557604adf67be50417f59c2c2f167def9a775`, LoRA/optimizer/numerics, 64-token assistant JSON+EOS loss, 128-query full-context fit attention, prompt and greedy inference remain unchanged. Completed CPU preparation checks were reused. Only mandatory contained loss/reclamation/attention controls ran; all passed. No sweep, retry, prior-adapter continuation or second dataset assembly.

Supplied permissions were `never` / `danger-full-access`. Requested Astra/xhigh/default-standard; actual turn model/effort/tier unexposed. Runtime: torch 2.8.0+cu128, transformers 4.57.6, peft 0.17.1, accelerate 1.10.1, safetensors 0.8.0; GPU RTX 3070. Model files and dependencies were fresh pinned copies of the accepted baseline runtime.

## Technical results

| Observation | Fit | Fresh reload |
| --- | ---: | ---: |
| Stage / host / child exits | 0 / 0 / 0 | 0 / 0 / 0 |
| Fit or model-section seconds | 175.968 fit; 179.047 model section | 51.504 model section; 2.465 load |
| Host seconds | 465.859 | 423.983 |
| Guard setup/child/cleanup seconds | 300.031 | 262.796 |
| Peak Job committed bytes (cap 6,442,450,944) | 5,996,720,128 | 5,196,668,928 |
| Sampled peak process RSS bytes | 4,230,090,752 | 3,214,704,640 |
| Peak CUDA allocated bytes | 1,374,529,536 | 1,078,333,952 |
| Peak CUDA reserved bytes | 1,537,212,416 | 1,117,782,016 |
| Minimum sampled CUDA free bytes | 5,814,353,920 | 6,269,435,904 |
| Job/token pre-resume checks, job closure, ACL/profile cleanup | Pass | Pass |

Host time includes file verification outside the bounded child. No timeout or measured resource breach occurred. Acceptance verified 132 progress rows, 1,481 memory observations and 265 attention snapshots; all per-update counts, complete K/V context, 24 attention layers, loss denominators and cumulative peaks passed. Qwen attention scope restored; no observation errors. Loss/reclamation/attention controls retain technical-only qualification. Epoch mean losses were 0.27702, 0.15174, 0.10653, 0.07334, 0.04872 and 0.03066; these are training observations only.

All 290 base tensors retain SHA-256 `7c651c8be4013651138142820f0e895a170054851eb3edd6ed3fcd64027b0c44`. Saved 96 adapter tensors / 540,672 trainable parameters match the fitted state; fresh reload matches all 96 exactly using the explicit local base. New adapter safetensors SHA-256: `83d4556301460a141e4c73cc9947fdcbbf9b8c9d0dd8aeb91a12bdd163d82785`. The old 66-update adapter remains untouched.

## Unchanged development comparison

| Metric | Retained baseline | Retained 66-update candidate | New 132-update candidate |
| --- | ---: | ---: | ---: |
| Valid raw responses | 0/2 | 0/2 | **0/2** |
| Accepted expected claims | 0/6 | 0/6 | **0/6** |
| Accepted precision | Undefined | Undefined | Undefined |
| Coverage | 0% | 0% | 0% |
| Extractable exact citations | 0/0 | 5/5 | 3/8 |

The citation denominator includes only parseable responses and gives no claim credit to a rejected response. The malformed response is excluded. New candidate correct absent/null claims are 0/1 and 0/1. Valid responses with required no-target abstention or empty canonical links are each 0/2; system fallback abstentions do not count as model success. All predeclared quality criteria fail; resources and cleanup pass.

The IFC4 raw response fails JSON parsing at character 321. It has broken quotation/claim structure and repeated trailing keys. The IFC2X3 response parses but fails `quote_not_exact`: it emits instruction-like text as source quotations and unsupported non-null literals for unknown states. The unchanged validator rejects each whole response, applies no repair, and returns no accepted claims. Output lengths are 379/450 tokens, below the 768-token limit; generation takes 22.783/26.236 seconds. Input lengths are 464/442 tokens; prompt hashes and input lengths match both retained candidates. No teacher inputs, targets or explanations entered reload prompts.

Raw outputs SHA-256: `63c2c522180458736bc60914b90186ca72c2f35033f737aeffc4160e44cca94b`. Neither baseline nor previous adapter was rerun. Doubling exposures confounds a causal key/order interpretation; this run establishes no citation-binding improvement, new coverage, canonical association, conflict accuracy or generalization. Development content/predictions were not sent to the teacher or reused as training labels.

## Retained artifacts and handoff

- Fit: `E:/BhuAayam-data/task-data/ml-distillation/student/adapter-citation-view-fit-fffafce9835d4f59bef71f4377bb5619`. Profile SHA-256 `a09ee7907b8dc207b01712d84ec33245218773f479cf91301957ee76b32ae503`.
- Reload: `E:/BhuAayam-data/task-data/ml-distillation/student/adapter-citation-view-reload-53f721761a1542aba223e512ebb1739c`. Profile SHA-256 `f59c54fd376584ad23722ec9785edf91923bd31fce677a2d7f0cb7e780cfe30a`.
- Stage commands used the existing `--citation-view-assignment` path; host logs and exact command/result receipts are in each run root. The unchanged `summarize_adapter.py <fit-root> --reload-root <reload-root>` exited 0 and wrote the retained comparison. Fifteen executed source files match the frozen physical/Git bytes in both stages; artifact/code collection exited 0 with no host model imports.

Both owned model jobs exited and cleanup passed. Only this new handoff/receipt are committed; no original, source catalogue, shared code, frontend, gateway, provider, production service or staging checkout was changed. No train diagnostic, held-out evaluation, promotion, push or deployment. The one-fit/one-reload allowance is exhausted. Return this technical success and failed quality result to the coordinator, then stop for a separately scoped decision.
