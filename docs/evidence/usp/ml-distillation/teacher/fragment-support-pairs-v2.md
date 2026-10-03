TEACHER-06-QUALIFIED-SUPPORT-PAIRS completed on 3 October 2026. Two teacher-authored request pairs append four provisional annotations to the accepted six-row train dataset. All 82,626 original bytes are the exact new prefix; original order, IDs, context/input/output, source fragments and historical supervision remain unchanged.

| Pair | Unchanged parent context | Literal request | Qualified request |
| --- | --- | --- | --- |
| 01, area/unit | `teacher-fragments-v1-05`, seven candidates | Printed Carpet Area value: `c4`, exact text `1557.20`, retained column label `Carpet Area` | Value explicitly stated in square metres: empty; supplied value/locator has no stated unit |
| 02, drawing/status | `teacher-fragments-v1-01`, four candidates | Printed Floor-02 scope: `c3`, including the original `13rd` | Explicitly currently approved Floor-02 scope: empty; the supplied caption states scope, not current approval |

Each pair keeps identical candidate dictionaries/order/provenance/neutral IDs. Only the new annotation ID/request and corresponding full-context hash/target change. The positive rows retrieve literals; a field-name match alone cannot satisfy the requested qualifier. All 22 new candidate appearances have separate source-backed reasons: two selected and twenty excluded. They reuse eleven unique candidate fragments and two original source hashes, spanning both train families. The ten-row output has 57 candidate appearances, twelve selected appearances and three empty selections, including the original empty case.

No missing/absent/null/withheld state labels were added. The qualified empty results mean `no_support_in_supplied_context`; they do not classify the whole original/property or assert that an approval/unit does not exist. Original native/OCR methods, unverified completeness and other limitations are preserved. New outputs remain `provisional_synthetic_supervision`, `needs_independent_review` and `sarvamDerived=false`. Request annotation IDs are teacher material; new supervision records both the new requested/observed provenance and the original parent teacher provenance.

Executed once from `C:/Users/kvina/.codex/worktrees/ml-teacher-20261002/3d-ulpin`:

```powershell
& 'C:/Python313/python.exe' -B 'C:/Users/kvina/.codex/worktrees/ml-teacher-20261002/3d-ulpin/docs/evidence/usp/ml-distillation/teacher/prepare_fragment_support_pairs_v2.py' --output-dir 'E:/BhuAayam-data/task-data/ml-distillation/teacher/fragment-support-pairs-v2-402ba4a9ecb0fc808f3c9534c6318cdf'
```

Python 3.13.7, exit 0, tool wall time 0.207 seconds. Recorded preparation interval: `2026-10-03T15:47:06.917441+00:00` to `2026-10-03T15:47:07.029646+00:00`. The same invocation explicitly compiled only the changed producer once with built-in `compile()` from `15:47:06.920744` to `15:47:06.924954` UTC, exit 0, without writing bytecode. One compact CPU check reused the pinned teacher schema checker and verified the prefix, four new distinct IDs, train-family membership, complete current-context/input/target binding, distinct current selected IDs, unchanged parent/pair candidates and exact serialized new rows. The context hashes include the whole request and original fragment provenance; explicit uniqueness checks retain the frozen `uniqueItems` requirement. Source-support inspection was limited to the two chosen accepted contexts. Final code review, whitespace, owned-path and artifact/code-hash readback checks passed with exit 0.

All private outputs are retained in the fresh directory named in the command:

| Artifact | Bytes | Physical SHA-256 |
| --- | ---: | --- |
| `train-teacher-fragments-v2.jsonl` | 138050 | `ff366335b907d13f8128c22788d9bb65ad6c94eac7972052b2be458f90c8c7fd` |
| `rows-v2.receipt.json` | 4109 | `23e55431848c7c4a771dc33d1d72467d221c66c12791c15d888af80bb716b555` |
| `source-support-v2.receipt.json` | 33399 | `a96c15a2b019633c7c2c5afdbf87d57537f0aaf16a08de41db4f7fa201915257` |
| `check-v2.receipt.json` | 5911 | `bccf0e62338ba201e1d9cb552be5cb302f8a80eb1a6586d816c28c793e4a5b1c` |

[fragment-support-pairs-v2.json](C:/Users/kvina/.codex/worktrees/ml-teacher-20261002/3d-ulpin/docs/evidence/usp/ml-distillation/teacher/fragment-support-pairs-v2.json) pins these artifacts, each new raw-row/context hash, both parent row/context/input/supervision hashes, full actual argv/cwd/times and counts. The separate source receipt records every selected/excluded candidate's exact observable quote, UTF-8 quote hash, source/fragment hashes, locator and concise reason. Source hashes retain accepted lineage; originals were not re-extracted or independently requalified. Producer canonical-LF SHA-256: `8937c66f93520a202250c189455ef36db032750bed27b9002406b5d1f1c02f16`. Assignment commit: `67793c1a8354b8d2cb3d08d87aa8e057e3a7e9a0`; physical assignment SHA-256: `524e3408972c4ab2820dd408d51c4a59004094d5289e00c23fe120374ef3111f`. The parent dataset remains `32c7fc4071754431f87756d0ebd121539a5357187ef0efb139083f5b86e4d742` before/after preparation. Listed common-authority pins matched before/after; no donor-stage inventory or non-train link was followed.

Supplied permissions are `never/danger-full-access`. Requested settings remain GPT-6.1 Sol/xhigh and default/standard speed; actual model/reasoning/tier metadata is unexposed. These annotations establish no independent truth, operational fact, current approval, measurement unit, ownership, canonical association or model-quality result. Coordinator data review and accepted-codec checks must precede any separate learner admission/fit assignment.

Writes are limited to the three new assigned repository files and this one fresh private directory. Earlier datasets/manifests, source originals, other checkouts and shared contracts remain retained. No development/evaluation/held-out/retired data, current ML status, student evidence/acceptance/protocols or runtime metadata were read. Only the specifically listed common files and original teacher train acceptance were used. No source campaign, model/native/GPU/provider processing, fitting, acquisition/install, host/service/volume/credential change, delegation, push or deployment ran. Return the clean owned commit to the coordinator only, then stop.
