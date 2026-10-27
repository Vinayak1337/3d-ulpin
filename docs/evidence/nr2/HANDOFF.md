TASK   NR2 — streamed point and line layers are read            GATE GF-RECOVERY (offline only)
WORKS  Points and lines read with per-kind counts; incompatible building footprint mappings stay refused.
SEE IT pnpm exec tsx --tsconfig apps/api/tsconfig.json docs/evidence/nr2/check-real-inputs.ts
INPUTS Public OSM road fixture (good) and Delhi-wide community boundary (difficult), both used test_only.
GAPS   Native point-layer rehearsal, generated source pins and four unrelated intake checks remain open.

## Design

- `streaming-vector-reader.ts` accepts the canonical area's six kinds, preserving bounds and source bytes.
  `streaming-vector-validation.ts` tests validity for points, positive length for lines and area for polygons.
- `streaming-vector-worker.ts` counts final accepted dispositions and writes `streamedGeometrySummary` only
  with the fenced sealed result when totals match. An incomplete advisory tally never prevents completion.
  Matching summaries also initialize NULL inspection; the shared contract validates kinds and positive counts.
- `intake-large-worker.ts` projects matching summary counts into existing officer words, not a new display.
  Nonpolygon-only layers say Read while still permitting an officer to state a compatible nonbuilding role.
- The existing `compileStreamedMapping -> compileMapping` compatibility guard remains authoritative:
  points, lines and mixed nonpolygon layers cannot become buildings; polygon-only layout behavior is unchanged.

## Verification and continuation

`result.json` contains commands, counts, failure diagnoses and explicit runtime limits.
Round 2: backend typecheck, 17 streaming/geometry checks (including 500,000 polygons), 10 focused checks and
both structural reads pass.
The sealing regression uses the production continuation: completed with a receipt, no mismatched summary.
Round 1: 40 related checks pass; the broader intake run is 281/285. Its two PDF failures are recorded by RT1;
Ledger wording and migration adjacency failures concern unchanged files. The OpenAPI document matches;
Generated source pins need refreshing outside this task's owned paths.
No Docker, deployment, push, database reset or original modification occurred.

After integration, regenerate source pins, resolve those unrelated checks and rehearse one real point layer from
GeoPackage or KML through the live native conversion/read path. Confirm counts, not-a-footprint words and refused
building mapping. The two real fixture reads here do not qualify native conversion, PostGIS or registry behavior.

Code commits: `f884908d` (six-kind streaming and sealed counts), `08a00073` (officer projection and mapping checks).
