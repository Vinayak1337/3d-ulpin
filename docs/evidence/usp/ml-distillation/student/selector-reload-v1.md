# STUDENT-10-SELECTOR-RELOAD — reload passes; development criteria fail

3 October 2026. One fresh contained reload matched all **96 saved adapter tensors**, completed both frozen development inputs and passed output/resource/Job-closure/cleanup acceptance. Both responses are strict JSON and pass the selector schema, but both fail `selector_fragment_range`. **Valid raw selectors: 0/2; valid expanded outputs: 0/2; correct accepted claims: 0/6; precision: undefined; coverage: 0%.**

The [machine-readable evidence](selector-reload-v1.json) records exact commands/exits, source/model/runtime/input/adapter/output hashes, the host comparison and cleanup. SHA-256: `06b47bc2d750342feb7400bb562f0487283acd98e69436adc8f9c63ac447668a`. The retained baseline was not rerun. Formatting improved on these two related examples; usable coverage did not improve.

## Frozen execution

Executed unchanged clean code `95a0df5f8346f45a99941e353d9f35d791c747f2` in `C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin`, branch `task/ml-association-student-20261002`. Coordinator checkpoint: `71c70a5ac4268e2503a8b1f9d16e4ef11f268e3a`; assignment SHA-256: `8d111f0b6d101ffdea0c965732766af99d452dc7a0b48ace2087c7ad1f2f23f5`; fit acceptance SHA-256: `64fb6987d2b3842659829cce78b52cfcaaeef49d7c3a50ef018b0d33b4cd65c9`. Primary staging was observed read-only at `2dc194caf07eafe7913d3e3241fce10f8ee3eb0f`.

The required stager checked all twenty code pins and admitted the accepted fit once. It copied 19,668 pinned files / 8,606,827,118 bytes in 147.407 seconds. The new stage received only the original local base, exact saved adapter, development inputs and required contracts/proofs. Teacher input files and expectation contents were absent. The host-only expectations were hash-checked and read after output/guard/closure/cleanup acceptance.

Model `Qwen/Qwen2.5-0.5B-Instruct`, revision `7ae557604adf67be50417f59c2c2f167def9a775`, weights SHA-256 `fdf756fa7fcbe7404d5c60e26bff1a0c8b8aa1f72ced49e7dd0210fe288fb7fe`; adapter weights SHA-256 `93890e8ba23dd0c363cdcb36ed7e6f6b8f0a2ab2e3a3fe6e675ce91dfd277c70`. All parameters were frozen; exact 96-tensor reload used an explicit local base with no remote base lookup. Original seed 17, greedy generation, SDPA, 2,048 input / 768 output token bounds and containment/resource limits were retained. Both prompt hashes, input token counts and the complete selector-preflight bytes match the retained selector baseline. No truncation occurred.

Supplied permissions: `never` / `danger-full-access`. Requested Astra/xhigh/default-standard; actual turn model, effort and tier are unexposed. No prompt or global setting is presented as proof of request speed. No code/dependency change, fit, training diagnostic, retry, sweep or acquisition occurred.

## Measured development comparison

| Metric | Retained pretrained selector baseline | Saved selector adapter |
| --- | ---: | ---: |
| Strict JSON syntax | 0/2 | 2/2 |
| Selector schema | 0/2 | 2/2 |
| Valid raw selector ranges | 0/2 | 0/2 |
| Valid expanded/model outputs | 0/2 | 0/2 |
| Emitted parsed claims | Undefined | 7 |
| Accepted emitted / unique accepted claims | 0 / 0 | 0 / 0 |
| Correct accepted / expected claims | 0/6 | 0/6 |
| Accepted source-native precision | Undefined | Undefined |
| Coverage | 0% | 0% |
| Valid no-canonical-target abstentions | 0/2 | 0/2 |

The host comparison ran once and used unique `(role, state, literal, unit)` signatures from accepted expanded outputs only. IFC4 emitted four claims and IFC2X3 emitted three; both whole responses were rejected before expansion acceptance. No fence stripping, output repair, partial accepted credit or old raw-string citation summarizer was used. Raw no-canonical-target markers and empty canonical-link arrays appear in both outputs, but neither rejected response earns valid-output credit. System fallback abstentions also receive no credit. Correct absent/null claims are each 0/1.

The IFC4 output includes abstention selector `[4,0,7]`, beyond its four fragment ordinals 0–3. The IFC2X3 first claim cites `[3,0,4]`, beyond its three fragment ordinals 0–2. Both retained errors are `selector_ranges: selector_fragment_range`; `expandedOutput` is null. Raw bytes remain unchanged. These observations do not qualify semantic accuracy, conflict accuracy, canonical matching, operational use or generalization. All predeclared development quality checks fail; resources and cleanup pass.

| Example | Input tokens | Output tokens | Generation seconds | Token limit reached |
| --- | ---: | ---: | ---: | --- |
| IFC4 | 536 | 197 | 12.253991 | No |
| IFC2X3 | 493 | 153 | 9.016273 | No |

## Resources, cleanup and metadata

| Observation | Result |
| --- | ---: |
| Stage / host reload / child / output acceptance / comparison exits | 0 / 0 / 0 / 0 / 0 |
| Model load / model-section seconds | 2.473375 / 23.750993 |
| Host invocation seconds | 407.701 |
| Guard setup, child and cleanup seconds | 246.828 |
| Peak Job committed bytes | 5,213,143,040 |
| Sampled peak process RSS bytes | 3,216,420,864 |
| Peak CUDA allocated / reserved bytes | 1,090,065,408 / 1,145,044,992 |
| Minimum sampled free CUDA bytes | 6,242,172,928 |
| GPU samples | 354 |

No measured bound breach occurred. Job/CUDA caps remain 6,442,450,944 bytes; minimum free CUDA remains 1,610,612,736 bytes. The unchanged 600-second child limit was enforced. Separate child wall time is unexposed; host time includes full runtime verification outside that phase. Job commitment and RSS are distinct. The original one-time GPU initialization peak reset remains; there were no inter-example resets. Job/token validation, Job closure and ACL/AppContainer cleanup passed; all six accepted output artifacts retain their pinned hashes.

Existing `accepted_outputs(root, 'reload')` plus the scoped reload checks ran once on the host: exit 0 in 0.034475 seconds without model imports. Completion matches the guard. The host signature comparison exited 0 in 0.005731 seconds. Completed preparation/security campaigns and earlier model phases were not repeated.

Legacy result flags `teacherOutputsUsed=true` and `fitPerformed=true` describe the saved adapter's training provenance. This phase has `fitPerformedInThisProcess=false`, `teacherInputsInReload=false` and `teacherTargetsInPrompt=false`. No training or teacher targets entered the reload. The retained log includes `torch_dtype`, greedy-generation configuration and PEFT original-path config warnings; explicit local base loading and exact saved/loaded tensor equality passed. No executable code or output was changed to suppress warnings.

## Artifacts and handoff

- Reload root: `E:/BhuAayam-data/task-data/ml-distillation/student/adapter-selector-reload-5c4c5b3f14154294ae01760e60d04b7d`.
- Profile: `bc41ff13e5e5dca76688424f40d688c786ec90e663001f4a760ab5810e5592e1`; run freeze: `b7f9d50cb023bf4e7c44d5d9733e2c8b6f32e2e632b6daef62b991e958bfe9a9`.
- Guard: `d71352aa620c8c939a36a21325450a3c021486bd483b713a22e7e7548b25a4ce`; accepted-output receipt: `7e752395c0f17e926a4c79e0a3d1541add18ca89fab8886d1ba1fa02a2656c79`.
- Staged fit proof: `6862a6f26f4b6e2f22d7ca4034cf851b81861afe01213c5a6bca914cf1ec1fcd`; reload acceptance proof: `712e2c16dd0073087ac485c1fda878bf2ff77cc8fddd8ec8c8ee50427ff4d677`.
- Raw outputs: `99f332e8c63aec6ee63e7641995422fc1bd507e6a6d33c9dccebd71c7a782321`; model result: `23f2a01c88f93863c3b1bfb44654049bef6cf0e01a28ed42a3d043d792dafb8b`.
- Host comparison: `713acdafa4c73492b1748ad303145de5797e9516438bf84ceac34791a6598855` in `E:/BhuAayam-data/task-data/ml-distillation/student/selector-reload-v1-host-20261003-95a0df5f`.

Only this new evidence pair is committed. Existing fit artifacts, originals, frozen code and prior evidence were preserved. No primary staging, frontend, shared registration, teacher feedback, evaluation access or promotion. The single-stage/single-reload allowance is exhausted. Return exact evidence/final-clean commit and artifact pins to the coordinator, then stop for a separately scoped decision.
