# FUSION-GEOPARQUET-01 — exact accepted-window leaf adapters

## Lead integration, 3 October

Leaves integrate as `fbf8b356` / `2934b038`; shared endpoint wiring follows the
accepted CityGML citation return `d5a8c397` / `7a8e3e4f`. Selection/context unions,
count bounds, complete-set child/parent authority, bounded reader and projection
dispatch are wired; unsupported association/citation paths explicitly refuse
before source I/O. Actionable absent-row/out-of-window errors survive assembly.
An observed leaf-first ESM initialization failure was fixed by extracting the
unchanged common pin/literal schemas to `source-fusion-common.ts`, re-exported
through the original paths. No semantics or historical literal hashes changed.

Five GeoParquet checks now pass, including the actual shared assembly of the
retained Canada row with the EPSG document, four bounded object reads, two
complete-set captures and denial after the accepted parent changes during I/O.
Nineteen affected common-literal/association/CityGML-citation checks pass after
that schema extraction; prior two integrated KML citation checks also passed.
Backend/client types and OpenAPI validation pass. No native or model run.
Published route/schema counts remain 254/292, with additive embedded variants.

Saved mixed journey:
`E:/BhuAayam-data/task-data/lead-geoparquet-fusion-20261003/integrated-mixed-context.json`,
191966 bytes, SHA256 `5220ec734aa6cd39296a9b24b98949d6219f29af7987ead4b20e5525505107d8`.
Context SHA256 `8aae2e6a74a8b370dd6cbb81bbbe93079bcee84a9958353511a827e36fc7f90d`.
The shared method journey uses labelled memory SQL/document/source/storage/tool
controls over unchanged real bytes. Current HTTP/persistence/runtime admission,
authentic applicability and all geometry/learning/release claims remain unqualified.
The original leaf-only handoff below is retained as historical scope.

3 October 2026. Code `f95c74ad70f2344387e0f5a19bc27ac245b5dc8e`, base
`ffe16d0e54e52e904dc1adef1982602fcd69b08e`, branch
`task/desktop-fusion-geoparquet-adapter`, exclusive checkout
`C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`. Staging was read-only,
clean and at the same base. [Assignment](../../orchestration/PARALLEL_20261003.md#next-independent-implementation--fusion-geoparquet-01-leaf-adapter).
Requested GPT-6.1 Sol/xhigh/default-standard; actual per-turn model/effort/tier
unexposed. Supplied permissions: `never` / `danger-full-access`.

Explicitly select 1–25 unique global row indices from one exact accepted
GeoParquet artifact. The leaf preserves result/input/reader/fence/source,
artifact/window/enrolled-selection/direct-parent pins, literal records, raw WKB,
integer decimal strings, column locators and declared/default/absent/null states.
Global row index, array ordinal and group-local row index stay separate. Other
windows and unselected rows never expand. No geometry transform, matching,
identity assignment, registry attachment or learning label is produced.

Only three new leaves and one focused check changed. Shared unions/dispatch,
association/citation, exports, intake/jobs/protection, native/config/runtime,
generated API, catalogue/ledger, frontend and ML remain unchanged. **The combined
endpoint is not delivered or qualified until lead wiring and its scoped journey.**

`acceptedFusionGeoParquetTx` reuses canonical source/input/accepted-attempt
predicates and visible accepted-job SQL, capturing one direct parent without
object I/O or tool scans in the lock scope. Calling canonical
`geoparquetStatusTx` here would read the parent receipt and scan tools while the
aggregate locks are held. `readFusionGeoParquetResult` instead validates that
exact receipt outside SQL using existing bounded/hash/deadline/JSON primitives;
it reads no parent/next native rows. Final recapture includes parent authority.
Production defaults keep strict current reader/tool/inventory checks.

## Exact lead wiring

1. Export `./source-fusion-geoparquet` from `packages/contracts/src/index.ts`.
   In shared `source-fusion.ts`, import the leaf selection/context schemas; add
   `SourceFusionGeoParquetSelectionSchema` to the selection discriminated union
   and `SourceFusionGeoParquetSchema` to the context source union. Common pin and
   literal fields are lazy to avoid evaluating the schema import cycle. Include
   `rowIndices` in total selection counting/duplicate checks; preserve 2–8
   sources/25 total selections and the 512 KiB GeoParquet result-receipt bound.
2. In shared `source-fusion-authority.ts`, add `FusionGeoParquetAuthority` to
   `FusionAuthority`; optional dependency slots `geoparquet` and
   `geoparquetTools` use `acceptedFusionGeoParquetTx` and
   `verifyFusionGeoParquetTools`. Dispatch capture with `(client,pin,true)`;
   dispatch tools with `(authority.input,budget)` after transaction release.
   Preserve the entire `parent` field in expected/final authority comparisons,
   canonical complete-set case/source locks and final reauthorization.
3. At the beginning of shared `readFusionResult`, dispatch the GeoParquet kind
   to `readFusionGeoParquetResult(selection,authority,budget,read)`, before its
   generic key/receipt read. Reject a mismatched authority kind. The leaf loads
   selected result, direct parent receipt when present, then selected artifact;
   all reserve bytes in the same aggregate budget. Existing 64 MiB aggregate,
   30-second deadline and 1 MiB response ceilings remain; no truncation.
4. In server `source-fusion.ts`, dispatch matching GeoParquet selection/loaded
   kinds to `fusionGeoParquetSourceProjection(selection,loaded)`. Preserve
   `SOURCE_FUSION_GEOPARQUET_NO_ROWS` and
   `SOURCE_FUSION_GEOPARQUET_ROW_WINDOW` in `assembleSourceFusion`'s actionable
   error allowlist. Existing loaded/result types then derive from the reader.
5. Add explicit `SOURCE_FUSION_GEOPARQUET_CONTEXT_ONLY` refusals in shared
   association proposal/capture, association literal/manual-selection and
   citation-selection consumers before I/O. Update necessary exhaustive union
   consumers without silently dropping rows. Coordinate the citation seam with
   its CityGML owner; this task provides no citation variant.
6. Lead owns OpenAPI/client and additive catalogue/index/ledger publication.
   Check the integrated schema/import cycles and one GeoParquet + existing
   document context through the existing endpoint assembly; retain complete-set
   final authorization and older variants. Reuse these native artifacts; do not
   rerun the parser or rewrite historical profiles.

## Checked result and limits

Reuses [retained upstream manifest](native-geoparquet/sources.json) and accepted
[continuation](geoparquet-continuation-handoff.md) / [absent-geo](geoparquet-api-handoff.md)
artifacts. Original `example.parquet` is 29,834 bytes, SHA256
`f3e4bf0b0376904f851057d2047bb69e81dce913f2ff1aabe8a4dc1ec0789bc2`.
Selected continuation artifact remains 74,975 bytes, SHA256
`78fb245f218091ba7a1e945b86c2b02dc3fd02cff3a2f7bc34c795ea092e3044`.
One Canada record is returned: global row 3, array ordinal 1, group 0/local row
3, pointer `/rows/1`. Its record SHA256 is
`18ca162ccadf35cd807ecf4d79f740f66044b09c1e32339025fbcd9f053f9f18`;
compact leaf response is 73,822 bytes and three reads reserve 81,504 bytes.
Coverage remains partial, next row 4/5. `continuationRowsFetch:not_performed`
distinguishes row fetching from direct parent receipt validation.

- `pnpm exec tsx --test tests/source-fusion-geoparquet.test.ts`: exit 0, four
  passes/no skips. Literal row/metadata/WKB pins; absent-geo and outside-window
  refusals; child/parent/fence/hash/byte denials; revocation and parent change
  after reads with final leaf recapture; unconfigured tools/expired deadline.
  An initial test-only base64 assumption failed; it was corrected to the
  unchanged native WKB `hex` field. No production bytes were altered.
- `pnpm typecheck:backend`: exit 0, server and API. Staged whitespace: exit 0.
- SQL/source/storage/tool authority are memory controls. Tests explicitly use
  historical-reader reconstruction without changing any saved input/result.
  For the selected continuation, physical and saved reader hashes both equal
  `3126c1531f82c6e4b7b9d8bdfd7f1ece06c817ba4a601e78f97ed95e7ff17485`.
  Production tool verification still refuses without a configured current
  inventory; no profile repair or successful current tool admission is claimed.

Private proof: `E:/BhuAayam-data/task-data/desktop-fusion-geoparquet/final-01/`.
`verification.json`: 10,396 bytes, SHA256
`07891e54826cd7cf66792ab58ac909d56ff9f0ec2d8e246755a202b24d3d87b8`;
four code, fifteen unchanged shared seams, seven retained-input and five proof
pins. `selected-continuation-row.json` contains the concrete request/projection.
Inputs remain foreign/upstream `test_only`; current HTTP/SQL/storage, authentic
applicability, geometry/accuracy/rights, learning and release gates stay
unqualified. No parser/source/model run, services, dependency/profile/runtime
change, push or deploy. No owned process remains; historical branches and all
originals/receipts are preserved.
