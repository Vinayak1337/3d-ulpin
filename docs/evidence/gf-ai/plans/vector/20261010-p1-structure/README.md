```text
TASK   P1 structure review — typed vector pipeline       GATE GF-AI / GF-T16 prerequisite
WORKS  Keep the accepted room output exactly; explicitly abstain on an unmatched CAD layer profile.
SEE IT python -m json.tool docs/evidence/gf-ai/plans/vector/20261010-p1-structure/result.json
INPUTS Magnolia page-2 ground/first/second panels; scanned Haryana Tower 3 page 1.
GAPS   Accepted measurement/literal gaps remain; no raster path or API ingestion added.
DESIGN vector_plan.py: named immutable profile; typed evidence → strips → bridges → mask → outline → rooms.
       Typed small steps handle scale, labels, frames and overlays; CLI/verifier reuse those boundaries.
```

## Proof and checks

[result.json](result.json) contains **four identical normalized SHA-256 pairs**:
full-precision candidates and consistency for both real inputs. Before any
refactoring, fresh outputs and their **raw** hashes were frozen outside Git in
`E:/BhuAayam-data/task-data/p1-vector-plan/20261010-p1-structure/before-full/`
and `before-hashes.json`. Fresh after outputs live under `after-full/` and
`after/`. No existing private files or originals were changed or deleted.

Normalization sorts JSON **object keys**; arrays, coordinates, dimension values,
polygons, citations, bridges, unknowns and discrepancies are untouched.
Candidates exclude only `/codeSha256` and `/pages/*/runtimeSeconds`. The latter
is execution instrumentation, not extraction data. **Consistency excludes
nothing.** Neither compared document contains a timestamp. New `result.json`
receipts retain fresh timestamps/code hashes and `layerProfileName`; the proof
pins those receipts separately rather than claiming their raw bytes match.

The proof records function/line/type audits for every named Python file.
**No function-length exceptions**: every function is at most 40 physical lines;
all have parameter/return hints (implicit `self` excluded); `awk 'length>120'`
prints nothing. Unused edge polygonization and layerless-guessing code are
removed. Old parameter-receipt fields stay only to preserve accepted hashes.

`LayerProfile` selectors are compiled full-match regexes or immutable name
sets. The default `magnolia-cad/1` keeps the reviewed architecture semantics.
No matched wall layers on a vector page means `no_matching_layer_profile`,
zero rooms, unknown scale, and no guessing. The extra synthetic-layer test
is explicitly a code-path unit test, **not** real-input evidence.

Verification commands and actual exit codes are in `result.json`: both-input
verifier; three unit tests; compileall; pip check; unused-code check and the
requested awk/diff checks. Formatter tooling was pinned outside the project
venv; runtime dependencies were not changed. A malformed inline verification
harness failed once with an unterminated-string `SyntaxError` before checks
ran; replacing its nested shell quoting with a plain awk command fixed it.
It was a harness quoting fault, not an extraction or parity failure.

## Git decision and next

The task first asked for `git merge staging`, then its worker rules forbade
merging. The later rule was followed: §11 was read with `git show` without
changing branches or history. The lead can integrate the current standards.
No merge, rebase, push, GPU, provider, registry write or DB operation occurred.

Commits are the two `refactor(plans): …` changes followed by
`feat(plans): named CAD layer profile with explicit no-match gap`.
The lead should review this proof and integrate the accepted behaviour.
P2 and ingestion remain the next dispatch, not work done in this session.
