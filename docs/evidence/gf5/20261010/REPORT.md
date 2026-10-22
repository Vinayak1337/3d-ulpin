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

## Current pre-demo command (JRN2)

The report above is the historical J1b run. The same journey runner now defaults to today's batch story:

```sh
pnpm journey:check
pnpm journey:check --case <case-uuid>
pnpm journey:check --output docs/evidence/jrn2/demo-check.json
pnpm exec tsc -p scripts/golden-journey/tsconfig.json
pnpm exec tsx --tsconfig scripts/agent/tsconfig.json --test scripts/golden-journey/batch.test.ts
```

- Default selection: newest **created**, non-archived case with retained intake items. Empty workspaces and
  cases without intake items are not batches; no name, filename, receipt id or sample key selects the story.
  `--case` reads that case directly, including an empty case, without selecting a different one.
- Eight steps: batch, items, table, surfaces, evidence coverage, stored confirmation, card and row citation.
  JSON includes words, route templates, actual path pins, HTTP status and response hashes. The console is a
  one-screen summary. Exit 1 only for `fail`; `undecidable` and `skipped` keep exit 0.
- **GET only**, including discovery and card reads. Tables use stored source profiles; surface part pages and
  each published part's display report give placed/not-placed/pending counts. Not placed is not a failure.
  Unknown coverage and planned counts remain null. Missing readings skip; refused/partial reads are undecidable.
- Card selection: newest updated carded building target across target pages, then the latest revision of its
  stored card. Verification must say `consistent`; expiry, revocation and a changed record are disclosed.
  The exact card PDF is read through its GET resolver and its quoted excerpt, file and row locator are checked
  against that revision's registry citation and the batch's stored confirmation. No card-facts POST is sent.
  Consistency is not a signature, title or issuance claim. Pagination caps return undecidable, not a partial pass.
- Offline inputs in `scripts/golden-journey/batch.fixtures.ts` are recorded contract-shaped **test_only fixtures**
  with authored values, never runtime records or expected demo facts. Tests include a real PDF byte round trip.
- Default JSON: `docs/evidence/jrn2/demo-check.json`. The recorded demo run found 11 active cases but no intake
  items: all eight steps skipped honestly, 12 GET requests, no writes. The batch story is not live-qualified.

The earlier receipt-pinned story remains available with `pnpm journey:check --legacy`. It uses the two named
pure POST reads described above and is **not** the GET-only batch check. `--write` still refuses before a request.
