# CITYJSON-EOL-01 — preserve accepted reader checkout bytes

1 October 2026. Code `e9a7486b4ab073cf0d35d4e17b098f956c696beb`, base `90e4528706d566a5b571e312db20eb37d26f08e6`, branch `task/desktop-cityjson-reader-eol`, worktree `C:/Users/kvina/.codex/worktrees/desktop-raster/3d-ulpin`. Completed LINK-02 branch remains at `d8ef819`; staging and other worktrees stayed read-only.

Added only two exact-path `.gitattributes` rules, `text eol=lf`, for `services/geo/geo/native_cityjson.py` and `services/geo/geo/cityjson_processing.py`. Every existing attribute policy is preserved byte-for-byte as the prefix of the new file, including `docs/evidence/usp/cityjson-draft-runtime.json -text`. Python blobs/content, the reader hash algorithm and saved job pins are unchanged.

One paired disposable checkout control passed with command-local `git -c core.autocrlf=true`. Separate task-owned `GIT_WORK_TREE` and `GIT_INDEX_FILE` paths contain only the attributes and two reader checkouts; no global/local Git configuration or existing populated checkout was rewritten. The pre-change checkout reproduces the exact recorded CRLF drift, while the corrected checkout matches both accepted LF Git blobs byte-for-byte:

| Reader digest, native reader then processing reader | SHA-256 |
| --- | --- |
| Before, `autocrlf=true`, CRLF physical checkout | `5b3acfc03646043ceac58813551709f878b9e76c7878a14ffc9a3c6a4849c633` |
| After, `autocrlf=true`, LF physical checkout and accepted concatenated Git blobs | `377edfe71f3d08e0a1f4fb710441022b9a26fdadd0efa70724d0d1dea0f3d398` |

| Unchanged accepted Git blob / corrected checkout | Bytes | SHA-256 |
| --- | ---: | --- |
| `native_cityjson.py` | 20,168 | `12befa78d15c61ad6e4f3aec3c581eb0723a33c4f7b34516e86f4299e84f5492` |
| `cityjson_processing.py` | 5,526 | `4dae1815520281f153ba367252f33e484421a3005aa0121ed3dd3c9352cb457b` |

`node E:/BhuAayam-data/task-data/desktop-cityjson-reader-eol/verify-checkout.mjs` exited 0 on its first run. It checks committed LF bytes, preserved attribute policies, before/after physical hashes and `git ls-files --eol`, unchanged existing worker-reader bytes, clean status and `git diff --check`. Staged whitespace checks also exit 0. No broader test campaign, validator execution, services/DB/API/Docker access, source read/rewrite, reprocessing, frontend, generated contract, credentials, push or deployment occurred. No processes/resources were started; task-owned disposable indices/checkouts remain as evidence outside live checkouts.

Receipt: `E:/BhuAayam-data/task-data/desktop-cityjson-reader-eol/check-001/receipt.json`, SHA `c6e1d00ca998c09686712a65a1ce2cb71ff37ae172efcfdfefb6594814b8935f`. It pins the base/code commit, two Git blobs, before/after physical files, both attribute blobs, exact Git commands/exits and the retained verification script. Requested GPT-6.1 Sol/high/default-standard; actual model/effort/tier remain unexposed. Supplied `never` / `danger-full-access` permissions verified. Goal tracker remains paused as reference.

This policy prevents future checkout drift. It does not automatically replace already populated or dirty reader copies; those must retain their originals and follow the existing exact-byte recovery when execution is explicitly assigned. No new native extraction, saved-input compatibility, geometry validity or release qualification is claimed. Return this clean bounded change to lead, then stop without polling.
