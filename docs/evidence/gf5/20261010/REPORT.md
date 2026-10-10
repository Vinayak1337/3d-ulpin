TASK   J1b — journey identity/card through snapshot listing          GATE GF5 (partial; exit 0)
WORKS  pnpm journey:check decides the recorded unit identity and real card using two named pure POST reads.
SEE IT pnpm journey:check
INPUTS R3 Tower 3 UNIT-3B; difficult G+41/G+42 conflict and stale TNHB mapping; Magnolia and test_only RAMP.
GAPS   Real prisms and readable CityJSON remain missing; card expiry requires a future write-mode revision.
DESIGN read.ts allow-list/timed HTTP; identity-card.ts newest scopes, exact identity and every card verification.
       Existing canonical/snapshot/P3/card authorities reused; no dependencies, app changes or runtime writes.
COMMITS c9eea080 — POST read trace; bd45d811 — identity/card decisions; this commit — J1b run.
CHECKS golden-journey tsc 0; agent tsc 0; live run 0 (11 pass / 0 fail / 0 blocked / 2 skipped).
       Non-listed POST refused 1, zero requests; --write refused 1; diff/120-column/evidence checks 0.
NEXT   Lead review/integrate; P5.2/K4 cited geometry/limits; P5.3 readable export; P7 revision before expiry.

| Step | State | ms | What this run read |
| --- | --- | ---: | --- |
| doctor | pass | 6530 | Exit 0; health 200, structurally ready; gateway disabled |
| installed | pass | 35 | Story inputs present |
| canonical | pass | 2056 | Cited values and distinct states |
| roofprints | pass | 16 | 80 candidates, 4 decisions; test_only lineage; 0 registry records |
| storeys | pass | 1 | Tower conflict preserved; Magnolia 3 reviewed levels |
| recorded | pass | 12 | Exactly 1 cited floor/unit; absent geometry, unknown measurements |
| tables | pass | 3376 | 90 columns, 102 rows, 51 chunks; stale retained mapping, v44 |
| register | pass | 506 | Both registers and ledgers 200 with citations |
| identity | pass | 72 | Canonical reviewed code resolves to the same unit, version 2 |
| geometry | skipped | 1 | No placed footprint/cited height limits; 0 real prisms |
| exchange | skipped | 14 | No readable export; GET on POST-only export path 404 |
| card | pass | 318 | One real revision; consistent list, six verification passes; not revoked/expired |
| invariants | pass | 28 | 29 API-reported hashes match; review-only registry invariants |

Run started 19:52:42 IST; served 83965a21 with K8 present, total 12966 ms. Snapshot listing answered immediately;
no five-minute retry needed. Both decisions used the newest scope; no older fallback occurred.
Card expires 2026-10-11T13:39:30.390Z; expired=false. Consistency is not signature, title or issuance proof.
J1a's previous journey is attempt-2.json (9/1/0/3); attempt-1.json and its real doctor-failure log are unchanged.
Trace and check receipts: ../j1b/result.json. No assignment, generation, revision, revocation or provider call.
