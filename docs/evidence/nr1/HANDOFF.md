TASK   NR1 — batch native-reader bridge            GATE AUD1-7, part 1 (offline only)
WORKS  Batch DXF/CityGML/CityJSON items queue their existing reader and retain candidate-summary or stop words.
SEE IT `pnpm exec tsx --test packages/server/src/modules/usp/ingestion/intake-native-readers.test.ts`
INPUTS Real 1_polylines.dxf + difficult ASCII_R12.dxf; two OGC CityGML examples; D1 CityJSON literal-only control.
GAPS   Upload-backed CityJSON is blocked by its processor key allowlist; no live rehearsal or map/card bridge.

## Design

`intake-native-readers.ts` is one table-driven adapter, not another reader or job authority. It selects the
reader by the probed `dxf`, `citygml` or `cityjson` format and original profile. Native source functions gain
IFC3-style upload receipt/card admission; their existing SQL is exposed as small insert functions, not copied.
A stable item/source-revision job key makes replay write-free. Original limits remain 16/32/8 MiB respectively.
`intake-draft.ts` changes only by its import and one hook beside IFC, before kept-only settlement.

All three workers settle their batch item inside their existing accepted/failed/stale terminal transaction.
One optional `nativeReaderJobId` projects `plan_ref` through the existing intake ledger/contract. Words and
`recordsSeen` use only accepted summary fields: no inferred layers, surfaces, CRS codes or building totals.
No source row, original key/bytes, geometry, registry record, package or card target is created or rewritten.

## Verification

- Backend typecheck passes. Final focused NR1/IFC/routing run: **36/36 pass**, including 20 NR1 tests.
- Full requested intake globs with API tsconfig: **309/313 pass**, four inherited failures: GLB name-prefix
  expectation, migration predecessor expectation and the two PDF failures already recorded by RT1 pending EVF1.
  The first run's two additional Nest decorator failures disappear with `apps/api/tsconfig.json`.
- Existing native authority checks: 12 pass, two configured-host tests skipped. They are not runtime proof.
- OpenAPI `--check` fails: catalogue stale; source-pin comparison not reached. Generated files are unowned.
- Diff whitespace and both new TypeScript files' 120-column checks pass. No Docker, push or live DB operation.

The source and numeric receipt is [result.json](result.json), including failed attempts and the stop decisions.
Native fixtures are not under `tests/fixtures` in this checkout; the tests reuse the existing authority-test
DXF/CityGML roots and saved native projections. The CityJSON control contains only D1's real header/feature
literals in standalone form and is read by the existing Python reader, without writing an original or geometry.
The unchanged D1 API envelope has no root type and remains unrecognised by the current batch probe.

## Next / prerequisite outside ownership

`services/geo/geo/cityjson_processing.py` accepts only `sources/<id>/<sha>`; uploads use `large-originals/`.
Its current allowlist therefore refuses uploaded CityJSON with `CITYJSON_SOURCE_PINS`. A dependency-free
comparison of its exact expression confirms this; importing the full processor locally lacks Shapely.
Do not present the queue test as a completed CityJSON batch read. Separately authorize that canonical upload
key with the same exact source/hash/size checks, then refresh OpenAPI and source pins at integration.

An authorized runtime owner must rehearse **one real DXF and one actual standalone CityJSON .json** through
upload → enrol → accepted worker → reload/replay. Check unchanged originals and candidate evidence with no
map/card target. Qualify the CityGML host profile/partial outcome there too. No runtime gate is passed here.

Commits: `1344d9b4` queue/admission/settlement; `23afe022` replay, limits, authority and terminal-summary tests.
