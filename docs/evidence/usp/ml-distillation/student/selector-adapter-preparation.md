# STUDENT-10-SELECTOR-PREP — CPU admission and representation hooks

3 October 2026. Code commit `9f3063874834fadf61f169b0ca40beddb76daddb`; base `c2773a4ca5054a851b611945db7ac6dab3d9f24b`, exclusive `C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin`, branch `task/ml-association-student-20261002`. Coordinator checkpoint `8ef00291708c0eb0408255787b8a4c3858f521e7`; assignment physical SHA-256 `98e20dc1fb718cdb75edbdc58366d2d9758c1ee8533a5e3cc6573a020ab112a3`. Primary staging observed read-only at `989d290659faf64271130b12a860277b747f8223`.

## Prepared flow

The new selector adapter leaf admits only the accepted 78,908-byte original eleven-row selector file (`36649ae4f7ca82e50366a627abdc89e02696f0c56cc0a5b648b88a07403cd9cb`) and exact v2 parent (`7510a7040afb7bec2bba9422eb5e14bbf0664c927bd0c2b24989c1af6dc7674c`). It checks all original inputs, lineage/supervision, train families, raw selectors and complete expanded equality against the parent, retaining 62 claims, two conflicts, 22 abstentions and eleven canonical abstentions. Teacher supervision remains provisional; no extra rows, facts, IFC coverage or state coverage were added.

Admitted in-memory rows keep expanded legacy outputs for unchanged validation and separate `selectorTarget` pointers for training. The explicit representation hook supplies source-only ordinal/token messages and canonical raw selector JSON (UTF-8, sorted keys, compact separators, no nonfinite values), followed by EOS. The existing encoder still masks every prompt token and supervises only the assistant target plus EOS. Teacher explanations, application keys/locators and expectations are absent from prompt fields. There is no teacher assembler or second target dataset.

`adapter.fit` retains one numerical/attention/loss/reclamation loop; optional hooks select the training plan, messages, target and actual prompt/representation metadata. Fit preflight, manifest and result carry the representation. Existing acceptance reuses full count/base/save/resource/cleanup proof, adding exact selector admission and target-digest checks. Existing exact tensor reload injects its verified local adapter loader into the selector runner; the pretrained default remains intact. Only the exact `association-selector-adapter-freeze/1` version selects this path through the existing `association_adapter.py fit/reload` actions and allowed CLI arguments. Unknown/mixed selector modes reject.

## Future execution contract — not an execution assignment

Use `stage_selector_adapter.py fit --assignment <frozen-file>` or `reload --assignment <separate-frozen-file> --fit-root <accepted-selector-fit-root>`. PREP is rejected before runtime inspection, directory creation or copying. Each future assignment requires:

- `version=association-selector-adapter-execution/1`, `task=STUDENT-10-SELECTOR-FIT`, and its exact `action` (`fit` or `reload`). `executionAllowance` is exactly stageModelRun/loadModel true, fit true only for fit, inference true only for reload, evaluation/promotion false, and integer freshPhases 1.
- Exact clean final `studentCodeCommit` (including the handoff commit) and `runtimeCodeCanonicalLfSha256` for the exact twenty `stage_selector_adapter.SOURCE_PATHS`. Current physical protected bytes must also match the accepted donor; do not normalize files. Thirteen existing execution sources remain protected against the donor profile. No shared guard/resource/security/dependency changes.
- Original model/revision (`Qwen/Qwen2.5-0.5B-Instruct`, `7ae557604adf67be50417f59c2c2f167def9a775`), `settings=adapter.FIT`, `numerics=adapter.NUMERICS`, `inferenceSettings=student.SETTINGS`, `teacherV2Sha256`, exact `representation=selector_adapter.representation_metadata()` and `trainingPlan=selector_adapter.training_plan()` (eleven rows, six epochs, 66 updates).
- `selectorSchema` at the pinned coordinator schema; schema canonical-LF SHA `dcc129e1c1600e583f6b7792a6ad5f1cf5e14ba206cde5a53df81bdfa14e07f4`. Prompt `association-selector-prompt/1` SHA `616f05ef389d1d9964f5215e349545d1cb4ad2fd023a9df75515bdf116535beb`; unchanged lossless lexical policy. Schema and exact prompt bytes are fixed-name auxiliary inputs pinned in freeze/profile.
- `runtimeProfileSha256=a09ee7907b8dc207b01712d84ec33245218773f479cf91301957ee76b32ae503`, the retained `adapter-citation-view-fit-fffafce9835d4f59bef71f4377bb5619` runtime/model profile. Reuse its already pinned PEFT 0.17.1/accelerate 1.10.1 runtime; no wheels installed, packages acquired or shared environment edited. Copy only runtime/model plus current frozen code and explicitly selected inputs.
- Retain the donor's `previousFailedFit`, `previousFailureReceiptSha256`, `attentionControlBeforeFit` and computational `memoryExecutionPolicy`. The policy canonical hash excluding only descriptive `causeQualification`/`continuation` is `d9d3b38aaedfba617256f35fc01d2e475885cfb0570981a6a7b007df8f5034d4`; update those two descriptions for the selector hypothesis/66 updates. All 4096-fit, 2048/768-inference, 6-GiB cumulative Job/CUDA, 1.5-GiB free-GPU and 600-second limits stay unchanged.

Fit excludes `cases`, `inputBatchSha256`, `acceptedFit` and all development input files. Its existing `--teacher-v1` option carries the exactly pinned **v2 parent**; `--training-data` carries the original selector targets. The historical option name is retained solely for CLI compatibility. Expansion is admission-only; the parent strings are never the assistant training target.

Reload has a separate freeze/profile, no teacher inputs, exact `cases=selector_adapter.CASES`, `inputBatchSha256=selector_adapter.BATCH_SHA` and `acceptedFit` containing root plus profile/guard/manifest/result/adapter-weights SHA-256 pins. Full accepted fit proof and matching selector representation/count metadata are required before staging, then exact adapter tensors are verified on reload. Only accepted expanded outputs may be compared on the host with the retained six expectations; do not use the legacy raw-string summarizer on selector arrays. No automatic reload is authorized by fit completion alone.

## Verification and limits

- `C:/Users/kvina/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none/python.exe -B -I -S scripts/usp/learning/association/test_selector_adapter.py` — exit 0; six focused CPU controls, 0.052 s. Actual eleven-row admission/counts/parent preservation; source/split/pointer/null refusal; source-only prompt and raw-selector target masking/EOS; legacy encoder/main-CLI preservation; exact dispatch/action/input/proof contracts; PREP refuses before mkdir/runtime inspection; actual target metadata and no model imports.
- In-memory `python -B -I -S -` compile/AST/hash inspection — exit 0. All seven Python files compile. Numerical fit/model/base/save body and five model/artifact helpers are AST-identical; original pretrained selector runner is reconstructed exactly after removing only the optional loader hook. Thirteen protected files match donor physical hashes and base Git bytes. The CLI `main` AST is unchanged.
- Complete owned delta reviewed; `git diff --check` and staged check pass. Prior codec/teacher/security campaigns reused. Character-token fixtures verify interfaces only; real tokenizer lengths, fit/reload execution, resources and quality remain unmeasured.

## Owned code pins

SHA-256 of committed LF blobs, also current physical bytes:

| File | SHA-256 |
| --- | --- |
| `scripts/usp/learning/association/association_adapter.py` | `3feb77855fc3e101479816224e21346eaa7cbc88e5ffe9476d2e7bee7f31c103` |
| `scripts/usp/learning/association/stage_adapter.py` | `bd620d0568df745bb00a849fbf7ae99c4a527fa3914b4a1964e58eb559c5abb1` |
| `scripts/usp/learning/association/stage_selector_adapter.py` | `bbd8ffad6150340a71a066a3fc37cd1c0726ab520944966dd56cfd14da24d0b5` |
| `scripts/usp/learning/association/test_selector_adapter.py` | `a8e452ddd5528356b21b8933c336fc29ea7cc86caa90f7ac595d3bb5adea1e70` |
| `services/geo/geo/usp_learning/association/adapter.py` | `ccd509742623b0b13bf02b9a1a5df08599e6cefe573f6db89d76a2056d04080d` |
| `services/geo/geo/usp_learning/association/selector_adapter.py` | `4a94f8e61d44699d3dbf884f1747933df57b4977c680f9445ff878def82727e8` |
| `services/geo/geo/usp_learning/association/selector_baseline.py` | `c239d432634952909b6508ef018d83d221c156c886076f4fa4a19113f452624a` |

Supplied permissions `never` / `danger-full-access`; requested Astra/xhigh/default-standard. Actual model/effort/tier unexposed; no setting change claimed. No runtime stage/copy/profile, tokenizer/model/GPU load, inference, fit, baseline retry, evaluation or promotion occurred. No model dependency imports, source/teacher assembly or owned-resource cleanup. Historical measured quality remains 0/2 valid and 0/6 correct accepted. Return code/handoff commits and final clean HEAD to the coordinator, then stop for inspection and a separate execution freeze.
