# TEACHER-02 target-policy correction

2 October 2026. `train-teacher-v2.jsonl` appends exactly `{code: 'no_canonical_targets', citations: []}` to all 11 outputs. This is the coordinator's deterministic policy for the frozen seed's unavailable canonical targets/crosswalk, not a new source fact. The input/output schema remains v1; the batch and supervision correction metadata are versioned v2.

Run in the assigned teacher worktree:

```powershell
python docs/evidence/usp/ml-distillation/teacher/correct_target_policy_v2.py
```

Python 3.13.7, exit 0. Mandatory abstention passes 11/11. All 11 inputs, 62 claims, two conflicts, 11 existing abstentions and source lineage compare equal both semantically and as canonical compact UTF-8 section bytes; empty canonical links remain. The original v1 lines are verified canonical before this comparison. Only the policy append and separate supervision correction metadata change.

[batch-v2.manifest.json](batch-v2.manifest.json) pins new data/code/receipt hashes and the immutable parent (`71e218b2a13ad26938f0b4ab5f4111125af8530dfbd0a01c0c3b9680f3bfefec`). Private data and `target-policy-v2.receipt.json` remain under `E:/BhuAayam-data/task-data/ml-distillation/teacher/`. The receipt contains per-example preservation hashes. V1 data, all its manifest-listed receipts, five rejected interpretations and historical assembler/checker pins match before and after the correction. Each v2 supervision records correction version, policy authority/method and parent data hash.

No source inventory, OCR, original-source reading or interpretation was repeated. No new example/status, permission change, development/evaluation access, model/GPU/process or dependency operation ran. Supervision remains provisional and needs independent review. Supplied `never/danger-full-access`; requested Sol6.1/max with default/standard required, actual per-turn tier unexposed. Teacher ends after sending this concrete correction to learner and coordinator.
