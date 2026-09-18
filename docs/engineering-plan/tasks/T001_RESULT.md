# T001 — accepted repository and isolated preservation baseline

Date: 18 September 2026. Decision: **Accepted for the declared development
baseline**. Review: source/test-oracle review and explicit self-review, not an
independent reviewer. This does not accept the renderer's visual quality.

## Tested revision and environment

The foundation branch preserves `f082441` and contains adoption `263dae2`, browser
repair `6328987`, isolated runner `c4e6857`, and fixture-root correction `34e44fc`.
The complete successful hosted run is **35354159342**, testing the full commit
`34e44fcd73c288e964a804bb3d8223a7d8702345`. The matching plan/source inventory run
**35354159279** also passed. These results were retrieved from the actual GitHub
run and its revision-matched artifact, not inferred from workflow source.

Windows: Node 24.19.0, pnpm 9.12.0, Python 3.13.7, locked Next 16.3.5 and Cesium
1.145.0. The production build and actual Chromium/software-WebGL suite passed.
Hosted: GitHub-hosted Ubuntu, the repository's pinned PostGIS/MinIO/Redis/geo
images, Python 3.12 for processing tests, and a unique database/bucket/Compose
project for each run. No private developer credentials were sent to the runner.

## Verification completed

| Boundary | Result |
|---|---|
| Existing pure/UI/AI tests | 97 passed across the seven named suites |
| Isolation and network guards | 33 passed at the fixture-root repair revision |
| Collector | All hosted tests passed; Windows separately records one native symlink privilege skip |
| Type checking and production build | Passed locally and in the successful hosted run |
| Original repository snapshot | 44 tables and 497 stored objects verified against committed bytes and hashes |
| Additive Uttam Nagar transfer | 4,440 rows and 53 objects added across six distinct areas |
| Replay and migration | Repeated transfer was unchanged; original rows survived migration and repeat migration |
| API adversarial suite | 17/17 passed against actual storage and processing |
| Closed-ring API/build regression | 1/1 passed through the actual queued build |
| Real browser | 10/10 groups; genuine GLB, shared canvas/state, unit inspection, 2D and held-drag/return/responsive checks |
| Python processing suite | Passed in a read-only project mount with network disabled |
| Post-test preservation | All protected original rows, IDs, source objects and their metadata remained unchanged |
| Cleanup | Only this hosted attempt's owned project and volumes were removed |

The source-linked original count increased from 541 before API tests to 550 after
their nine new uploads. Those counts are not the number of all stored objects:
the baseline separately checks all snapshot objects and source-row links.
No failing run was hidden: the first hosted attempt `35353264114` failed on the
fixture-root assumption after its restore/replay steps passed; the correction
added a tested explicit fixture path rather than weakening the API assertion.

## Durable evidence

`evidence/T001-hosted-35354159342.json` contains the actual scoped integration
report, tested commit, timing, table fingerprints and original-byte receipts.
`evidence/T001-source-c4e6857.json` is an earlier committed-source inventory, not
the final tested commit; the successful workflow also records its exact source.
`evidence/T001-fixture-references.json` retains representative IDs and native frame
references from the byte-verified committed Uttam Nagar bundle. The implementation
inventory identifies reusable boundaries and remaining task obligations.

## Explicit limits and next task

The PC's private database was never modified or independently restored. Its Docker
engine was stopped; its blocked startup was not bypassed. Before a later private-PC
migration, take and verify a fresh baseline of that actual data. Software WebGL,
mouse emulation, and fixed synthetic calibration scenes do not establish GPU
capacity, physical-phone behaviour, user visual approval, or full existing UI
parity. No unsupported importer is promoted to supported by these tests.

T002 can now establish the reference/requirement/fixture acceptance contract. All
later task-specific geometry, composition, state and rendering acceptance remains
in force. Main and all original/study datasets remain unchanged.
