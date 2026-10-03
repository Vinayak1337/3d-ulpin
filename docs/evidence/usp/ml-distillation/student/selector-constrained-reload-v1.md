# STUDENT-11 — one constrained saved-adapter reload

**Technical execution passed; the development quality criterion failed.** The controller produced two complete, source-range-valid selector responses, but both failed unchanged semantic validation. Nine claims were emitted, eight expanded signatures were distinct, and zero claims were accepted. Correct coverage remains **0/6**; precision is undefined because no accepted signatures exist.

Executed clean commit: `ec2b6b090e8c29f8739ea864b28b44db6c03d386`, branch `task/ml-association-student-20261002`, worktree `C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin`. No executable, dependency, source or runtime bytes were edited. The [machine receipt](selector-constrained-reload-v1.json) records exact commands, bindings, native results, resources and artifact hashes.

## Three separate decoding policies

| Policy | JSON/schema valid | Range valid | Semantic/usable | Accepted correct claims |
| --- | ---: | ---: | ---: | ---: |
| Retained pretrained selector | 0/2 | 0/2 | 0/2 | 0/6 |
| Retained unconstrained saved adapter | 2/2 | 0/2 | 0/2 | 0/6 |
| This constrained saved adapter | 2/2 | 2/2 | 0/2 | 0/6 |

The first two runs were not repeated. Input tokens, prompt hashes and the complete preflight artifact match the retained unconstrained run. Base weights, the exact saved adapter and greedy settings are unchanged; the explicit token mask changes the decoding distribution.

The controller forces syntax/key order/schema limits, source ranges, citation coverage/lengths, state/value compatibility, conflict citation minimums, a `no_canonical_targets` marker and empty canonical links. Both raw outputs contain those forced markers/links. They receive **no learned-accuracy credit**, and invalid-output fallbacks receive no credit at all. No partial claims were accepted from rejected responses.

## Observed semantic failures

Both responses fail `native_attribute_role_state_or_literal_mismatch` at `expanded_semantics`.

- IFC4: five claims, including `drawing` claims over the `IfcBuilding.GlobalId` attribute prefix and `conflicting` source-identifier claims over the project-name prefix. They do not identify the required source-native fields/values.
- IFC2x3: four claims label an absent elevation statement as a declared building, an entity prefix as a drawing, and `georeference.state` as a floor twice. Neither the expected absent state nor the distinct explicit-null state is accepted.

The absent-fragment failure is prevented in this run. Legal source pointers alone do not establish correct field selection. No canonical association, generalization, natural-conflict accuracy or operational qualification follows from these two related foreign IFC development examples. Held-out evaluation remains unopened.

## Native execution and resource evidence

Exactly one fresh stage and one contained inference phase ran. Staging, contained execution, existing output acceptance and the completed host report each returned exit 0. Actual fast-tokenizer vocabulary/decoder/byte checks passed; callback configuration, generated-only prefix checking and final decoded-text equivalence passed. Both responses completed with EOS, below the 768-token cap, without repair. All 96 saved adapter tensors matched exactly and all loaded model parameters were frozen.

| Observation | Result |
| --- | ---: |
| Input/output tokens, IFC4 | 536 / 202 |
| Input/output tokens, IFC2x3 | 493 / 168 |
| Generation time, IFC4 / IFC2x3 | 6.827 s / 5.347 s |
| Mask calls / trie visits | 370 / 121,430 |
| Total / maximum callback search time | 0.12670 s / 0.001642 s |
| Shared trie | 333,010 nodes |
| Peak Job committed bytes | 5,246,791,680 |
| Sampled peak process RSS | 3,257,221,120 |
| Peak CUDA allocated / reserved bytes | 1,090,065,408 / 1,147,142,144 |
| Minimum sampled free CUDA bytes | 6,240,075,776 |
| Model section / full host invocation | 14.195 s / 307.300 s |
| Staging / guard setup-child-cleanup | 161.545 s / 138.328 s |

All original cumulative bounds passed. The original guard enforced its 600-second child limit; a separate child elapsed time is not exposed. Callback search timing excludes tensor transfer, processor masking and GPU work. These observations do not establish a controlled speedup or end-to-end overhead comparison.

The accepted guard records child exit 0, owned Job closure, AppContainer/profile cleanup and access revocation without cleanup errors. Retained runtime warnings concern deprecated `torch_dtype`, inaccessible historical PEFT config with unchanged-vocabulary assumption, and ignored sampling flags under greedy generation; current tokenizer metadata and exact saved tensors passed the mandatory checks. No runtime changes were made to suppress warnings.

The host report initially failed with `KeyError: rows` when comparing against a retained summary whose per-example key is `examples`. The failure is retained; correcting only that report lookup completed the same frozen signature comparison. No model phase, input, expectation, criterion or generated output was repeated or changed. Host expectations were accessed only after output/guard/cleanup acceptance and never entered contained inputs or prompts.

## Retained artifacts and handoff

Run: `E:/BhuAayam-data/task-data/ml-distillation/student/adapter-selector-reload-6dcb589a909b42b69dec5b024b308bd3`.

Host receipts: `E:/BhuAayam-data/task-data/ml-distillation/student/selector-constrained-reload-v1-host-20261003-ec2b6b09`.

Profile SHA-256: `1c846a1b90ca117fefe64a51985b57788e6d6267d3ecfa642c5120b0db37734a`; freeze: `81c425f557d6477c4dacf81ee292056a79386b9e672f023d0ada1bbee7ac8f3d`; guard: `a2092b54a192c174237ecf4a6b2cb02571b41e5518921d597c24521d28fad518`; host summary: `61f14315be371d3c1371699cf34e376b0b2e8120f6391f5aa6f65fd2feaf09e1`. All raw/result/proof/command/source/model/input/policy pins are in the machine receipt.

Supplied permissions were `never` / `danger-full-access`. Astra/xhigh/default-standard was requested; actual per-turn model, effort and service tier remain unexposed. Legacy `fitPerformed`/`teacherOutputsUsed` flags describe adapter provenance; this phase performed no fit and loaded no teacher inputs or targets.

Return these evidence files to coordinator `01a0fbd1-c2aa-75c0-8a52-4c4f662f3759`, then stop. No automatic fit, diagnostic, sweep, inference retry, teacher development feedback, source acquisition, shared registration, deployment, promotion or evaluation opening is authorized. No live owned process or GPU allocation remains; original and experimental artifacts are retained.
