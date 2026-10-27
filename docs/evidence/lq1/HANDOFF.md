TASK   LQ1 — batch layout dispatch without the surface barrier            GATE GF5 / REH16 offline
WORKS  A slow surface pass no longer delays ready jobs; layout/profile follow-ups keep their batch item's place.
SEE IT pnpm exec tsx --tsconfig apps/api/tsconfig.json --test \
       packages/server/src/modules/cases/processing-latency.test.ts
INPUTS Real NYC 2,100-feature ZIP member; difficult mixed ZIP with six KML layers and a retained CSV.
GAPS   Actual 19 s source and 180/240 s runtime bounds unproven; shared source pin needs integration ownership.
DESIGN processing.ts runs one independent surface-admission pass and orders preparation using stored item state.
       processing.test.ts checks ordering and a stalled pass; the adjacent replay executes both real ticks.
       dispatch-selection.fixture.ts executes their ordering in memory, without an application database.
COMMITS 744de0d0 Keep batch layout dispatch independent of surface admission
CHECKS pnpm install --offline --frozen-lockfile: 0; pnpm typecheck:backend: 0.
       tsx --tsconfig apps/api/tsconfig.json --test: dispatcher, scratch, intake, KML, jobs and routing sets: 0.
       Final combined run: 564 tests, 557 pass, 7 explicit skips; exact argv in result.json.
       Standalone replay: 0; scratch probe: 0; direct node --import tsx replay: 0.
       One 60 s outer wrapper timed out after successful inner logs; no failed replay or leaked process found.
       openapi.ts --check: 1, only docs/api/source-pins.json stale; outside the inferred owned paths.
       git diff --check: 0; new-file 120-column check: 0; evidence validation: 0.
NEXT   Integration owner repins processing.ts using result.json, runs PostgreSQL controls, then authorizes rehearsal.

Offline checkpoint replay: member first dispatch **164.810 → 0 s**; layout **402.112 → 6.983 s**.
All seven layouts finish by **48.041 s** after the change, with the same two vector slots, 938 MiB peak held
memory, and one surface pass at a time. Worker spans are measured QW1 spans for this member, reused for layer
stubs. The 18.25 s surface perturbation reproduces a blocking path; it is not a measured REH16 helper duration.
This is not a retain-to-map benchmark: mapping/draft service times and PostgreSQL performance remain unknown.

The watch accounts for the pre-layout interval without inventing job timings: **41.463 s** to the first reading
projection, **20.294 s** to the first chunk, **4.057 s** to chunk 17, then **351 s** overlapping the six child
readings before the question, and **6.186 s** to the reported button. Queue versus execution is not separable
from item snapshots. **586 s is answer-to-map**, not retain-to-map; retain-to-map is **1,017 s**, excluding the
stated 8 officer seconds gives **1,009 s**. File/line findings and exact values are in `result.json`.
