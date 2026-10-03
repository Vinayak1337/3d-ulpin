TEACHER-05-REQUESTED-FRAGMENTS completed on 3 October 2026. Six new provisional train-only query/selection examples reuse exact `input.evidence` dictionaries from accepted v2 parents. Candidate pools contain complete named parent inputs in fixed order; only identical same-key/content occurrences are deduplicated. All contexts are built before support labels are consulted. Model inputs contain only the fixed contract fields, request and unchanged candidates; parent targets, expected IDs, roles and new support judgments stay outside them.

| Example suffix | Source-supported request | Candidates | Selected IDs |
| --- | --- | ---: | --- |
| 01 | Floor-02 caption and its scope | 4 | `c3` |
| 02 | Refuge-floor caption and sheet identifier | 7 | `c1`, `c2` |
| 03 | All Tower-3/T-3 site-plan G+ count statements | 5 | `c0`, `c1`, `c2` |
| 04 | Explicit mentions of plot/Khesra 1659, including grouped identifiers | 6 | `c0`, `c1`, `c3` |
| 05 | Carpet Area table cell, without assuming its unit | 7 | `c4` |
| 06 | A fragment explicitly stating an official parcel ULPIN | 6 | empty |

Both frozen training families are represented. Across 35 candidate appearances, ten selected appearances have ten exact supporting quotes; the carpet-area case also checks one retained `locator.columnLabel`. Five selections are nonempty proper subsets, three are multi-fragment answers, one is a conflict request and one is empty. The site conflict retains all three supplied G+41/G+42 statements, including both separate G+42 annotations, without choosing a winner. Example 04 selects the retained HTML plot reference, layout-title Khesra annotation and grouped land-document annotation, spanning three original hashes. It asserts no one-to-one crosswalk. The empty case says no direct support in its six-fragment context, never property-wide absence.

Executed from `C:/Users/kvina/.codex/worktrees/ml-teacher-20261002/3d-ulpin`:

```powershell
& 'C:/Python313/python.exe' -B 'C:/Users/kvina/.codex/worktrees/ml-teacher-20261002/3d-ulpin/docs/evidence/usp/ml-distillation/teacher/prepare_fragment_requests_v1.py'
```

One stdlib CPU assembly, Python 3.13.7, exit 0. It verified physical assignment/contract/freeze/parent pins, train source membership, complete parent-fragment equality, full canonical-context identity, contiguous candidate IDs, current distinct selection IDs, frozen schemas and quote support. The contract's `uniqueItems` is enforced explicitly alongside the unchanged pinned schema checker. Full context hashing includes the request, order, family/split and every retained provenance field; the prompt remains the assignment's fixed prompt.

A separate Python stdlib stdin readback ran with `& 'C:/Python313/python.exe' -B -`, exit 0, without importing the assembler or reading its support rules. It independently canonicalized and hashed contexts 04 and 06, decoded current selection IDs to unchanged parent fragments, verified three selected original hashes for case 04 and an empty result with six retained candidates for case 06. The same command compiled only `prepare_fragment_requests_v1.py` with built-in `compile()` and wrote no bytecode. Changed-code review, staged whitespace, owned-path and final artifact/code-pin readback checks passed with exit 0. No corruption suite, source inventory or earlier campaign was repeated.

Private artifacts under `E:/BhuAayam-data/task-data/ml-distillation/teacher/`:

| Artifact | Bytes | Raw SHA-256 |
| --- | ---: | --- |
| `train-teacher-fragments-v1.jsonl` | 82626 | `32c7fc4071754431f87756d0ebd121539a5357187ef0efb139083f5b86e4d742` |
| `fragment-requests-v1.support.json` | 24769 | `cb440f2ddf2ebec3ba2294b3131d6935251f20320d3e93cde2482aeffb91d961` |
| `fragment-requests-v1.receipt.json` | 3854 | `d74f95a1a01e0dbd36149063e725944f3ee1469a4a99680c76aa2581887828cf` |

[fragment-requests-v1.manifest.json](C:/Users/kvina/.codex/worktrees/ml-teacher-20261002/3d-ulpin/docs/evidence/usp/ml-distillation/teacher/fragment-requests-v1.manifest.json) pins the data and separate support/receipt artifacts. The assembler's canonical-LF SHA-256 is `4cb839a0aef9bb1c3c2054be1be3234eaf0fbb0b9bcef9f3c6830f474ec1a24d`. Assignment physical SHA-256 is `501979901e9f71a114e6fc685caad387ab7876c45e66ea6a3ffc46d78ade34fd`; contract physical SHA-256 is `a7f289ea272e933b20cd9b5e06fae53c6f0d77daeaf878bb8a2aad65ee7d9082`. V2's 70,333 bytes retain SHA-256 `7510a7040afb7bec2bba9422eb5e14bbf0664c927bd0c2b24989c1af6dc7674c` before and after preparation. The separate support artifact records all candidate parent pointers/raw-row hashes, exact selected quotes, observable reasons and the empty-context limitation. The model target contains only version, context identity and selected IDs.

These are newly authored provisional query labels, `provisional_synthetic_supervision` and `needs_independent_review`, rather than official records or independent evaluation truth. OCR completeness and source-supported annotation limitations remain unchanged. No unit, ULPIN, ownership, canonical association, current approval, conflict resolution or model-quality result is established. Supplied permissions remain `never/danger-full-access`; requested teacher settings are GPT-6.1 Sol/xhigh with default/standard speed. Actual per-turn model/reasoning/tier metadata is unexposed.

Writes were limited to the three assigned new teacher files and three new private paths. Earlier code/data/rejects/originals and coordinator contracts were not rewritten; prior historical pins were retained without reopening retired content or repeating original inventories. No coordinator result/status/acceptance records, development/evaluation expectations, student predictions or held-out contents were read. No model/runtime/tokenizer/GPU/provider/stage/fit/inference, services/dependencies, shared API/frontend edits, delegation, push or deployment ran. Learner owns its independent codec/preparation. Send the owned completion commit to the coordinator only, then stop.
