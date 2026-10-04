TEACHER-03 completed on 2 October 2026. The private v3 dataset preserves all 70,333 v2 bytes as its exact prefix and appends one deterministic citation view per parent, in parent order. Policy `opaque_keys_reverse_evidence/1` derives each opaque key from SHA-256 of the parent example ID, U+0000 and the old key; it reverses evidence order and replaces every claim/conflict/abstention citation key. Each variant has the `-citation-view01` suffix and explicit augmentation metadata. Source text and factual labels remain unchanged.

The result has 22 rows: 11 originals and 11 variants. Its 124 claim appearances come from the same 62 parent-row claims; four conflict appearances come from two parent conflicts. There are 44 abstention appearances, including exactly 22 empty-citation `no_canonical_targets`. These counts do not establish independent truth or add source facts, absent/null-state examples or native IFC coverage.

Executed once from `C:/Users/kvina/.codex/worktrees/ml-teacher-20261002/3d-ulpin`:

```powershell
& 'C:/Python313/python.exe' -B 'C:/Users/kvina/.codex/worktrees/ml-teacher-20261002/3d-ulpin/docs/evidence/usp/ml-distillation/teacher/augment_citation_views_v3.py'
```

Python 3.13.7, CPU only, exit 0. All 22 rows passed the frozen input/output schema, train-family/source-lineage checks and exact citation/literal/unit checks; 168 citation appearances were supported. All 11 variants inverted to their exact parent row bytes, including source hashes, methods, locators and text, output array order, roles, states, literals, units, quotes, conflicts, abstentions and empty canonical links. Supervision changed only through `augmentation=true` and `citationViewAugmentation`. V1/v2 datasets, historical receipts, the five rejected interpretations, frozen contracts and historical code pins matched before and after assembly.

All five targeted corruption guards rejected their inputs: duplicate evidence keys, a forced opaque-key collision, Floor02's caption bound to the tower-only fragment, a changed quote and a changed source locator. Readback of Haryana Floor02 confirmed the drawing caption and printed `13rd`/`21st`/`30th`/`38th` floor labels retain their caption citation. Bihar's single-fragment unusable approval date was re-keyed while preserving the unknown revision, null literal and abstentions. Exact recovery also preserves the Bihar blank villa and Jamabandi conflict, Haryana G+41/G+42 conflict and unresolved approval revisions. The new code was reviewed; syntax and whitespace checks passed (exit 0).

Retained private artifacts under `E:/BhuAayam-data/task-data/ml-distillation/teacher/`:

| Artifact | Bytes | Raw SHA-256 |
| --- | ---: | --- |
| `train-teacher-v3.jsonl` | 157217 | `d8ee61f09e474069bf4375ac1cc1b24f574ca18a32b4e49721fa9d415df6d1b4` |
| `citation-view-v3.mapping.json` | 21839 | `5613e167d9de0838089596a9318e0230c624a3b1976c759626ae3293965112ee` |
| `citation-view-v3.receipt.json` | 15413 | `7ec28054d645185c6c4426b0faccf3c6d199f2ac4b925445c83fcb6b9765c3f3` |

[batch-v3.manifest.json](C:/Users/kvina/.codex/worktrees/ml-teacher-20261002/3d-ulpin/docs/evidence/usp/ml-distillation/teacher/batch-v3.manifest.json) pins these artifacts, the parent, contract/freeze, assignment and code. The new assembler's canonical-LF SHA-256 is `5aaf2f1a999a35e61f814ca7a57034564ad86f36d81839253ef4a257d667a834`. The assignment is pinned to coordinator commit `334467e30cd648a83aec3bec84140bf974b0a5f4`, canonical-LF SHA-256 `e5cfa3cadb6b547ec14d03b24513963e28259f9c3b8efa1a3caa0aa9d1232244`. The private mapping records each key bijection, old/new evidence order and parent/variant row hashes; the receipt records denominators, inverse checks, retained pins and the executed command.

No source acquisition, inventory, OCR, source reinterpretation, development/evaluation content or historical mapping holdouts were reopened. Only the authorized two-example training feedback was previously inspected; assembly rechecked its hash. No fitting, GPU/model process, provider call, dependency/service/frontend/student change, canonical mutation, push or deployment ran. No temporary files or bytecode were created by this task. The teacher worktree remains separate from staging, observed read-only at `3d5af6c541a2eca696d3e13c3bb8cfa1ee24fa18` during final review.

Supplied permissions are `never/danger-full-access`; requested teacher settings are GPT-6.1 Sol/max with default/standard speed required. Actual per-turn model/reasoning/tier metadata is unexposed. Existing source and supervision qualification remains unchanged and independent review is still required. Positional/key shortcutting remains a hypothesis; this preparation establishes no causal finding or model-quality gain. Student admission/count handling and any subsequent fit belong to the student/coordinator. Send the completed owned commit to the coordinator only, then end the teacher turn.
