TASK   NR2 — streamed point and line layers are read            GATE GF-RECOVERY (offline only)
WORKS  Points and lines read with per-kind counts; incompatible building footprint mappings stay refused.
SEE IT pnpm exec tsx --tsconfig apps/api/tsconfig.json docs/evidence/nr2/check-real-inputs.ts
INPUTS Public OSM road fixture (good) and Delhi-wide community boundary (difficult), both used test_only.
GAPS   Native point-layer rehearsal, generated source pins and four unrelated intake checks remain open.

## Design

- `streaming-vector-reader.ts` accepts the canonical area's six kinds, preserving bounds and source bytes.
  `streaming-vector-validation.ts` tests validity for points, positive length for lines and area for polygons.
- `streaming-vector-worker.ts` counts final accepted dispositions and writes `streamedGeometrySummary` only
  with the fenced sealed result. The shared streaming contract validates its six kinds and positive counts.
- `intake-large-worker.ts` projects matching summary counts into existing officer words, not a new display.
  Nonpolygon-only layers say Read while still permitting an officer to state a compatible nonbuilding role.
- The existing `compileStreamedMapping -> compileMapping` compatibility guard remains authoritative:
  points, lines and mixed nonpolygon layers cannot become buildings; polygon-only layout behavior is unchanged.

## Verification and continuation

`result.json` contains commands, counts, failure diagnoses and explicit runtime limits. Backend typecheck,
16 streaming/geometry checks (including 500,000 polygons), 40 related checks and both real structural reads pass.
The broader intake run is 281/285. Its two PDF failures are already recorded by RT1; ledger wording and migration
adjacency failures concern unchanged files. The OpenAPI document matches; generated source pins need refreshing
outside this task's owned paths. No Docker, deployment, push, database reset or original modification occurred.

After integration, regenerate source pins, resolve those unrelated checks and rehearse one real point layer from
GeoPackage or KML through the live native conversion/read path. Confirm counts, not-a-footprint words and refused
building mapping. The two real fixture reads here do not qualify native conversion, PostGIS or registry behavior.

Code commits: `f884908d` (six-kind streaming and sealed counts), `08a00073` (officer projection and mapping checks).
