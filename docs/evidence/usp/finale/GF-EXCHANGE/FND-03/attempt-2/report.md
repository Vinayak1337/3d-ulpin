# FND-03 attempt 2 — exchange review corrections

- Base: Astra review commit `e356919be7a7994eaf9ae047697ebd28485fcd69`, descending from FND-03 attempt-1 result `a6d2cbf12604400858dd311762e803f3c37821e0`.
- Code commit: `9cb926bc54b87e5fa9da58983bfcd8fed05a87b9`; branch `agent/FND-03-exchange-fix`; worktree `/Users/vinayak/.codex/worktrees/ulpin-sol-fnd03-fix/3D Ulpin`.
- Requested lane: Codex GPT-6 Sol, high effort. Actual selected model/effort were not exposed to this task, so observed settings remain unverified.

## Review findings resolved in code

| Finding | Correction |
| --- | --- |
| P1: incompatible share-alike data survived in sidecar/source metadata | The exporter computes one allowed record set before forming any artifact. Incompatible records, historical synthetic records and records without linked originals contribute only an object-ID loss marker. `CityObjects`, sidecar record bodies, source inspection metadata and LADM field rows are all built from the allowed set. Source metadata is included only if an allowed record references it. A requested-target pin list preserves comparison of the exact selected set without exporting excluded bodies. |
| P1: omitted CityObjects skipped rights/provenance comparison | Every retained sidecar record is compared first: pin, captured body hash, source IDs, licence family, omitted-state and each captured body field, including nested registry body fields. An unsupported or missing CityObject no longer bypasses these checks. Changed sidecar facts produce `conflict`. |
| P2: changed `children` links were invisible | Comparison checks both `parents` and `children`. Submitted hierarchy references are checked for unique resolution, supported parent type and reciprocal parent/child links; losses and changed links produce conflict entries without inventing replacement links. |

The private-only export contract, source-byte verification, no-mutation compare behavior, original storage, FND-04 geometry/display guards and legacy JSON export remain intact. Geometry is still omitted with an explicit loss because this registry profile has no source-supplied 3D solid. The LADM report remains conceptual.

## Verification and limits

`pnpm install --frozen-lockfile` exited 0 with the lockfile unchanged. `pnpm typecheck` exited 0. The directly adjacent existing check `pnpm exec tsx --test tests/usp-project-identity-code.test.ts tests/usp-geometry.test.ts tests/usp-d1-import.test.ts` exited 0 with 14 tests passing. `git diff --check` passed. No new synthetic source or identity fixture was authored.

An actual route export/compare was **not** run. The independent [existing-scope inventory](/Users/vinayak/.codex/worktrees/data-exchange-scope-01-luna/docs/evidence/usp/orchestration/manual/DATA-EXCHANGE-SCOPE-01-luna.md) established no eligible captured official registry-building scope from inspected repository materials. It did not query every database record. D1 is retained official 3DBAG exterior data with original SHA-256 `5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2`, but lacks a captured application registry/source pin and is an `area_feature`, so it cannot be substituted for this route's `registry_record`. No service was started, restored, seeded or queried to create an artificial case. The user's separate persistent loopback preview occupies its own pinned worktree and resource ports; this exchange task did not touch it.

`cjval` and `val3dity` remained unavailable at attempt 1 (exit 127 for both); no validator result is claimed for attempt 2. The GF-EXCHANGE runtime gate, official source-backed round trip, geometry semantics, licence qualification for redistribution, LADM conformance and independent milestone approval remain open. The comparison is bounded to the supplied selected snapshot; it is not a signed export receipt or a registry mutation.

## Manual route when a qualified record exists

Capture an authorized recorded **target-selection** snapshot with an exact EPSG frame and a linked original source. Submit its exact `scope` and registry record `targets` to `POST /api/v1/usp/exchange/cityjson/export` with `distribution: "private"` and a recorded compatible `licenceFamily` or `null`. Compare the returned `{cityJson,sidecar}` at `/api/v1/usp/exchange/cityjson/compare`, then repeat with `sidecar: null` to see explicit missing rights/provenance. Record the manifest/source/artifact hashes and before/after registry revision before any gate claim. Do not fabricate a source or convert D1 into a registry record for this check.
