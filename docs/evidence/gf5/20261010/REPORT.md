TASK   J1a — golden journey, check mode                         GATE GF5 (partial; exit 1)
WORKS  One command reads the live demo story and reports passes, failures, blocked and missing capabilities.
SEE IT pnpm journey:check
INPUTS Karnataka test_only roof candidates; Magnolia cited levels; difficult Tower 3 conflict and TNHB table.
GAPS   Exact P3 resolution is POST-only; real prisms, GET exchange and card discovery remain unavailable.

| Step | State | ms | What the final run read |
| --- | --- | ---: | --- |
| doctor | pass | 6841 | Exit 0; gateway disabled; no failed components |
| installed | pass | 55 | Story areas, buildings and cases present |
| canonical | pass | 1733 | Frames/states; reviewed and supported values cited |
| roofprints | pass | 10 | 80 candidates, 4 decisions, test_only lineage; 0 registry records |
| storeys | pass | 1 | Tower's 2 cited alternatives; Magnolia's 3 reviewed levels |
| recorded | pass | 23 | Exactly 1 cited floor/unit; geometry absent, measurements unknown |
| tables | pass | 4961 | 90 columns, 102 rows, 51 chunks, 90 retained open questions, v44 |
| register | pass | 532 | Both registers and ledgers 200, cited facts |
| identity | fail | 1 | Reviewed code read; exact resolution cannot be decided without POST |
| geometry | skipped | 1 | 0 real prisms; stated limits/placed footprint absent |
| exchange | skipped | 7 | GET export 404; POST-only snapshot/frame-bound export |
| card | skipped | 18 | K8 scopes missing; verification probe gets route-own NOT_FOUND 404 |
| invariants | pass | 37 | 29 API original/derivative hashes match; no unreviewed roof/label facts |

No blocked steps in this run. Clears: geometry — P5.2/K4, cited heights and placed reviewed geometry;
exchange — P5.3, a readable nonempty export; card — K8 snapshot listing unblocks K7's scoped card read.
Identity fail means undecidable resolution, not bad issuance: the required P3 resolver uses POST.
Lead: provide an exact GET resolver; legacy GET is not P3 authority and synchronizes identifiers.

DESIGN inputs.ts pins; read.ts timed GET/hashed receipts; story.ts/govern.ts named checks; run.ts summary/archive.
       Local tsconfig covers the new folder; no change to the read-only agent tsconfig or new dependency.
COMMITS aa00ee09 — feat(journey): the golden journey in check mode walks the demo story read-only
        This commit — docs(journey): first run on the demo, with blocked and skipped steps named
CHECKS golden-journey tsc 0; agent tsc 0; final live run 1 (9 pass / 1 fail / 0 blocked / 3 skipped);
       --write refused 1 before any request; git diff --check 0; new-file 120-column check 0.
NEXT   Lead: review the resolution prerequisite and missing capabilities; runtime unchanged by this worker.

Evidence: final run started 19:25:22 IST, served fbe525f7, total 14224 ms, retained as journey.json.
The 18:47 run on 9aad8da2 is attempt-1.json (7/2/2/2); its real doctor failure and diagnosis log are retained.
Changed decisions: card fail to skipped fixes GET-prefix parsing and names K8/K7; doctor adds failedComponents
and passed after R3; register's array contract was corrected and live K6 reads now pass; identity blocked to fail
because R3 assigned a code but GET-only resolution is undecidable. Other decisions were rechecked and unchanged.
Receipts are grouped/compact without changing statuses, response hashes or observations; cache reuse is run-local.
