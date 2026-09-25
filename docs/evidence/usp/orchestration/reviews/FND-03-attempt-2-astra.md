# FND-03 attempt 2 — focused Astra follow-up

**Disposition: bounded source-review acceptance of the three corrections. No remaining actionable defect found within this scope.** This is partial implementation acceptance, not a passed FND-03/GF-EXCHANGE runtime gate.

- Base: `e356919be7a7994eaf9ae047697ebd28485fcd69`.
- Reviewed code: `9cb926bc54b87e5fa9da58983bfcd8fed05a87b9`; result: `36d2fe2cba4ec21c228ebbdca2475338488d5bb1`.
- Review branch/worktree: `review/fnd03-attempt2-astra`, `/Users/vinayak/.codex/worktrees/fnd03-attempt2-astra-review`, created at the result pin.
- Observed Codex desktop / `gpt-6-astra` / `high`, verified from this task's latest local `turn_context`. Same-family engineering check only; not independent milestone approval.
- Read the current operating guide, prior review, the single-file production diff and worker evidence. Ownership is this report only.

## Finding dispositions

| Prior finding | Source review conclusion |
| --- | --- |
| P1: withheld licence content survived in sidecar/source metadata | Resolved. `apps/web/lib/server/usp/exchange.ts:72–94,150–153` computes `allowedRecords` once before CityObject construction, derives the source set from those records, and uses it for sidecar bodies, source metadata and LADM rows. Incompatible share-alike records no longer reappear through those artifacts. Excluded IDs/pins and explicit loss reasons remain, without excluded bodies; source content shared with allowed records retains its allowed provenance. |
| P1: sidecar-only facts skipped for omitted CityObjects | Resolved. `exchange.ts:247–261` compares each retained record, pin, body hash, source IDs, licence, omitted-state and captured top-level/nested body fields before either CityObject early exit at lines 264–268. Unsupported/missing CityObjects can no longer suppress comparison of retained rights/provenance. Missing or altered records conflict rather than silently passing. |
| P2: children changes escaped hierarchy comparison | Resolved. `exchange.ts:185–212,240,269–272` checks supported parent types, reference resolution, duplicate children and reciprocal links, then compares both `parents` and `children` against expected output. Changing both submitted sides consistently still conflicts with the captured hierarchy. No replacement relationship is inferred. |

Direct effects also reviewed: `requestedPins` keeps the original requested selection available when filtering leaves no sidecar records; compare rejects duplicate/invalid IDs, resolves pins through the captured manifest and then checks the complete submitted pin list against expected pins (`exchange.ts:227,344–357`). Existing target-selection/access checks and original-byte verification remain in use. The new pin list is part of a snapshot comparison, not a signed export receipt. No registry/source write or provider path was added. Geometry omission, private-only distribution and conceptual LADM limits remain explicit.

## Evidence and qualifications

Reused the [worker report](../../finale/GF-EXCHANGE/FND-03/attempt-2/report.md): frozen-lockfile install, typecheck, 14 adjacent existing tests and diff-check passed. The 14 tests do not exercise these exchange routes. No suite, service or route invocation was repeated by this review; the three dispositions above are source/control-flow conclusions, not freshly demonstrated runtime passes.

No eligible captured official registry-building scope has been established by the inspected-materials inventory. That is **not proof that every database lacks one**. Official D1 remains an exterior `area_feature`, not an eligible registry/source pin for this adapter; do not relabel it or manufacture missing registry facts. A smallest private export/compare run with and without the sidecar still needs an eligible existing official-source-backed registry-building snapshot, retained originals and isolated execution, with snapshot/source/artifact hashes and no-write evidence.

Actual route round trip, available pinned `cjval`/`val3dity` with passing receipts, supported geometry and the full source-backed levels/components/parcel/shared-interest/lineage scenario remain open. Attempt-1 validator commands returned 127; no attempt-2 validator pass is claimed. Missing official coverage, redistribution qualification and independent milestone acceptance remain unchanged. The result commit adds only its report and does not change release requirements.

Cleanup: only this review report changed; `git diff --check` passed. Worktree retained for report integration. No tests, fixture creation, installations, database queries, providers, keys, services, ports or containers were used by the review. Original/worker edits and prior review branches were preserved. Persistent preview `http://127.0.0.1:3187` and its intentionally running services were untouched; its served revision was not inspected in this review. No owned running resources remain.
