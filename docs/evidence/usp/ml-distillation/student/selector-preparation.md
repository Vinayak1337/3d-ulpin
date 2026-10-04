# STUDENT-09-PREP — exact source selectors and future baseline interface

3 October 2026. **CPU preparation complete; no model stage, load, fit or inference.** Code commit `07af479fe58521b6447758a913c255a41102be10`; sole worker `C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin`, branch `task/ml-association-student-20261002`, base `47b01a5c3d280333352bdbca7eb066f486445a07`. Primary staging observed read-only at `67b5f85630fa0ffc4094d7d107709d24b1a8c9c5` before edits.

Coordinator checkpoint `1b877bada13447f88727be50803707366625b340`; assignment physical SHA-256 `64c015595977954b82e9e2544b70c1f577a270d5a939099909989cecb2f32b35`. Supplied permissions `never` / `danger-full-access`; requested Astra/xhigh/default-standard. Actual turn model/effort/tier unexposed; no settings change claimed.

## Codec and result semantics

`selectors.py` implements the exact Unicode regex `\w+|\s+|[^\w\s]`, without normalization. Every match retains its codepoint offsets, including whitespace runs and individual punctuation. A frozen canonical input snapshot binds the source text, keys, locators, source hashes and family to both prompt and projection. The model receives only fragment ordinals and ordered token strings. Source identifiers appearing in actual text remain source text; application keys, locators, labels, teacher explanations and independent expectations are not prompt fields.

Strict JSON (including duplicate-key/nonfinite refusal), the pinned selector schema, exact integer types (no bool/float/string coercion), nonempty bounds and all pointers are checked before an expansion is returned. Quotes recover the original fragment key and exact source slice. A literal/unit span must be inside a citation span from that claim in the same fragment. Then the unchanged original validator checks roles/states, units, identifiers, conflicts, exact citations and train/development family scope. Any failure rejects the whole response; no partially valid claim credit or repair.

Results separately expose `jsonSyntaxValid`, `selectorSchemaValid`, `rawSelectorValid` (schema plus in-range spans), `expandedOutputValid`, `modelOutputValid`, `acceptedClaimCount`, raw parsed pointers, expanded output when range-valid, rejection stage/message and the fallback projection. A binding or semantic failure can have valid raw selectors and a retained rejected expansion while accepted claims remain zero. Raw text is separately saved before projection by the runner. Accepted count means the unchanged validator accepted the whole output; it is not independent accuracy. `correctExpectedClaims=null` and `expectedClaimsEvaluated=false` explicitly defer host comparison. The old raw-text summarizer must not be used to score selector arrays as legacy strings; future expected-claim scoring uses only accepted expanded outputs. Historical outputs/results are untouched.

Prompt version `association-selector-prompt/1`; UTF-8 SHA-256 `616f05ef389d1d9964f5215e349545d1cb4ad2fd023a9df75515bdf116535beb`. Selector schema canonical-LF SHA-256 `dcc129e1c1600e583f6b7792a6ad5f1cf5e14ba206cde5a53df81bdfa14e07f4`. The compact prompt states the selector format, unchanged roles/states and already-public native-field rules. Exact copying does not establish semantic truth; a test explicitly confirms the legacy validator can accept a wrong OCR role when its literal is source-supported.

## Narrow future execution contract

`stage_selector_baseline.py --assignment <separately frozen file>` is an explicit new leaf. It refuses STUDENT-09-PREP before runtime inspection or directory creation. The future assignment must include:

- `version=association-selector-baseline-assignment/1`, `task=STUDENT-09-BASELINE`; `executionAllowance`: stageModelRun/inference true, fit/evaluation/promotion false, freshBaselinePhases integer 1.
- `studentCodeCommit`: the exact clean final checkout HEAD selected by the coordinator, including any handoff commit; `model=Qwen/Qwen2.5-0.5B-Instruct`, `revision=7ae557604adf67be50417f59c2c2f167def9a775`, and `settings` exactly equal to unchanged `student.SETTINGS`.
- `promptVersion`, `systemPromptSha256`, `selectorSchemaCanonicalLfSha256` as above; `lexicalPolicy` exactly `selectors.POLICY` (version/pattern/flags); `selectorSchema` pointing to the pinned coordinator schema file.
- `inputBatchSha256`: exact retained baseline development batch bytes; exactly two ordered `cases`, each containing only `exampleId` and `inputCanonicalJsonSha256`. New source content/teacher targets are not accepted by staging.

Future staging copies the accepted baseline runtime/model/inputs to a new private root, with hashes checked against its accepted profile. It verifies code bytes against the frozen commit, pins them before copying, and keeps eight protected baseline sources exact. The original `association_student.py run` CLI/containment allowlist remains; only an explicit freeze-version branch chooses the new runner. Fixed-name auxiliary inputs are the assignment, pinned selector schema and exact prompt bytes. The ordinary input pin set is exactly batch/schema/family/model receipt; all auxiliary files are pinned in freeze and profile. Expectations remain outside the inference stage. No production assignment or stage was manufactured during preparation.

The future runner preserves the original pretrained loader, seed, deterministic settings, resource setup, stopping checks and greedy `generate` call. A separate leaf is needed because the original student runtime is read-only; no monkey-patching or shared runtime refactor. It measures both prompts before loading the model, saves source/lexical offsets and actual token counts in `selector-preflight.json`, and refuses over-limit input without truncation. Python/Unicode runtime versions are recorded. Original 2,048-input/768-output bounds, 6-GiB Job/RSS/CUDA caps, free-memory floor and 600-second phase guard remain. Model token lengths, resource behavior and quality are unmeasured until separate baseline execution.

## Focused verification

All CPU checks used `C:/Users/kvina/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none/python.exe` with `-B -I -S` (3.11.15, Unicode 14.0.0), matching the retained baseline interpreter family. No torch/transformers/peft/safetensors/accelerate imports.

| Check | Observed result |
| --- | --- |
| `python -B -I -S scripts/usp/learning/association/test_selectors.py` | Exit 0; seven tests, final 0.015 s. Unicode lossless spans, three individual retained train-row round trips (Haryana Floor-02, Bihar unusable approval date, natural conflict), strict syntax/type/ranges, own-citation binding, conflict/state refusal, snapshot/pin/family isolation, source-only prompt, future freeze pins and PREP refusal before mkdir. |
| `python -B -I -S -` compile/hash/AST inspection | Exit 0; all five edited Python files compile in memory; test recompiled after the final conflict check. Eleven protected files match base Git bytes. Removing only the optional dispatch branch reconstructs the old CLI AST exactly. New runner resource initialization, GPU checks and generate call are AST-identical to the original. |
| Accepted teacher interoperability, `python -B -I -S -` | Exit 0; exact accepted size/hash, all 11 original inputs unchanged, all 142 pointers decoded and all 11 expanded/accepted outputs exactly equal v2 targets. 62 claims/two conflicts/22 abstentions; source-only prompt payloads checked for every row. No files written. |
| `git diff --check`, `git diff --cached --check` | Exit 0. Reviewed all owned files, the explicit future stage/dispatch, strict expansion and scope/metric distinctions. |

One inline test-edit helper initially omitted `encoding='utf-8'` and failed with Windows cp1252 `UnicodeDecodeError` before writing. It was corrected; final compile/tests above pass. No application/runtime failure was hidden.

The teacher interoperability check was authorized by the coordinator's subsequent data callback at `002ea01616b08246b249f08077a2ee53c4e5e7de` (teacher owner `fdaaa81a56c1b633d0cd8d5ce10d0908d795fd82`, integration `15a5a26f62495d2214f8f86f1f29ff07b0860216`). Read-only manifest/acceptance matched the 78,908-byte `E:/BhuAayam-data/task-data/ml-distillation/teacher/train-teacher-selectors-v1.jsonl`, SHA-256 `36649ae4f7ca82e50366a627abdc89e02696f0c56cc0a5b648b88a07403cd9cb`, against the exact 70,333-byte v2 parent SHA `7510a7040afb7bec2bba9422eb5e14bbf0664c927bd0c2b24989c1af6dc7674c`. No teacher assembler was run or second target dataset created. This establishes representation interoperability, not model performance or new state/IFC/source coverage.

## Owned code pins

Committed Git blob SHA-256 (LF):

| File | SHA-256 |
| --- | --- |
| `scripts/usp/learning/association/association_student.py` | `12f55b8e6d4ba5db3f0617381a8c5af744714400fc02b19611d61e169edf7324` |
| `scripts/usp/learning/association/stage_selector_baseline.py` | `17af0472c6eef45b69821e0b0a735764ea1443bec3b236c17b3bfd742b5c8cc1` |
| `scripts/usp/learning/association/test_selectors.py` | `172e7d9cfd7259d9a9c753658da19d47bc4614fa28b007f8000b8eed2271ff90` |
| `services/geo/geo/usp_learning/association/selector_baseline.py` | `842088a7d5042c29c74a80049601c634288196eafb0fd54d81d737be008c430f` |
| `services/geo/geo/usp_learning/association/selectors.py` | `dcb83b6352c8c5972607c616866b11f91767235052cbac8b9606215b80b6863e` |

Only these five code paths and this handoff changed. No old fit chain, student.py, validation.py, model isolation/resources/security, dependency, original/historical artifact, coordinator schema, primary staging, frontend or gateway changed. No stage/model/GPU process was created and no cleanup remains. Callback to coordinator, then stop for inspection and a separate frozen baseline assignment; no automatic follow-on.
