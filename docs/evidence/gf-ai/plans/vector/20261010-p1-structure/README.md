```text
TASK   P1 structure review — typed vector pipeline       GATE GF-AI / GF-T16 prerequisite
WORKS  Keep the accepted room output exactly; explicitly abstain on an unmatched CAD layer profile.
SEE IT python -m json.tool docs/evidence/gf-ai/plans/vector/20261010-p1-structure/post-merge/result.json
INPUTS Magnolia page-2 ground/first/second panels; scanned Haryana Tower 3 page 1.
GAPS   Accepted measurement/literal gaps remain; no raster path or API ingestion added.
DESIGN vector_plan.py: named immutable profile; typed evidence → strips → bridges → mask → outline → rooms.
       Typed small steps handle scale, labels, frames and overlays; CLI/verifier reuse those boundaries.
```

## Proof and checks

[Post-merge result.json](post-merge/result.json) contains **four identical
normalized SHA-256 pairs**: full-precision candidates and consistency for both
real inputs. The initial pre-merge checkpoint remains in [result.json](result.json). Before any
refactoring, fresh outputs and their **raw** hashes were frozen outside Git in
`E:/BhuAayam-data/task-data/p1-vector-plan/20261010-p1-structure/before-full/`
and `before-hashes.json`. Initial after outputs live under `after-full/` and
`after/`; the resumed post-merge outputs live under `resume-final/full/` and
`resume-final/compact/`. No existing private files or originals were changed
or deleted.

Normalization sorts JSON **object keys**; arrays, coordinates, dimension values,
polygons, citations, bridges, unknowns and discrepancies are untouched.
Candidates exclude only `/codeSha256` and `/pages/*/runtimeSeconds`. The latter
is execution instrumentation, not extraction data. **Consistency excludes
nothing.** Neither compared document contains a timestamp. New `result.json`
receipts retain fresh timestamps/code hashes and `layerProfileName`; the proof
pins those receipts separately rather than claiming their raw bytes match.

The proof records function/line/type audits for every named Python file.
**No function-length exceptions**: the longest function is 37 physical lines;
all have parameter/return hints (implicit `self` excluded); `awk 'length>120'`
prints nothing. Unused edge polygonization and layerless-guessing code are
removed. Old parameter-receipt fields stay only to preserve accepted hashes.

`LayerProfile` selectors are compiled full-match regexes or immutable name
sets. The default `magnolia-cad/1` keeps the reviewed architecture semantics.
No matched wall layers on a vector page means `no_matching_layer_profile`,
zero rooms, unknown scale, and no guessing. The extra synthetic-layer test
is explicitly a code-path unit test, **not** real-input evidence.

Verification commands and actual exit codes are in `post-merge/result.json`:
both real-input CLI runs; the fresh/accepted evidence verifier; three unit tests;
compileall; pip check; unused-code check and the requested awk/diff checks.
Subprocesses used `PYTHONPATH=services/geo`; recorded argv omits that environment
prefix. The proof CLI also exited 0 with `allIdentical:true`. Formatter tooling was pinned outside the project
venv; runtime dependencies were not changed. A malformed inline verification
harness failed once with an unterminated-string `SyntaxError` before checks
ran; replacing its nested shell quoting with a plain awk command fixed it.
It was a harness quoting fault, not an extraction or parity failure.

## Git decision and next

Initially the worker rules forbade merging, so §11 was read with `git show`.
The **resume explicitly requested one merge of current staging**: after
committing the unfinished profile checkpoint, `git merge staging` completed
cleanly, without conflicts or edits in another checkout. The post-merge proof
records `stagingIsAncestor:true`. The P1 diff against staging was read file by
file; final overlay pixel-coordinate names were clarified without changing
output. No rebase, push, GPU, provider, registry write or DB operation occurred.

Task commits:
- `d17100b6` — refactor(plans): split wall masks and scale fits into typed pipeline steps
- `3882e150` — refactor(plans): separate typed CLI, verifier and evidence publication steps
- `074c595c` — feat(plans): named CAD layer profile with explicit no-match gap

The additional merge commit contains the requested staging update and resumed
proof; it is not a change to extraction behaviour.
The lead should review this proof and integrate the accepted behaviour.
P2 and ingestion remain the next dispatch, not work done in this session.
