# GEOPARQUET-02 — canonical private row inspection

3 October 2026. Code `5a63d6afcbe0472005905947659c9dd24e999380`, base
`409d26414b5f7544fc4db41d1b14c95d43604957`, branch
`task/desktop-geoparquet-private-api`, exclusive checkout
`C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`.
[Assignment](../../orchestration/PARALLEL_20261003.md#geoparquet-02--canonical-private-original-and-bounded-row-inspection).
Requested Sol6.1/xhigh/default-standard; actual per-turn model/effort/tier are
unexposed. Supplied permissions: `never` / `danger-full-access`.

Unchanged upload → canonical source/job → bounded selected-row inspection,
private status/native/original reads and explicit idempotent retry. Uses existing
cases, sources, operations, fenced attempts, private objects and outbox. Upload
and retry require `{startRowIndex,rowCount}`; count is 1–1000. Continuation pins
the accepted parent job, result/artifact hashes and exact advancing next row;
the enrolled input also pins parent input hash and accepted fence. Source/case,
access, reader, selection and accepted-attempt authority are checked around I/O
and before publication. Caller-declared lineage remains separate. Outages retain
originals and interruption requires a new explicit job. Generic original access
delegates to this authority; streaming/copy/snapshot/package/generic retry cannot
bypass protected markers, including malformed markers and copied ancestry.
Public source projection removes private original/accepted/reference fields.

## Lead registration

1. Export `./geoparquet-ingestion` from `packages/contracts/src/usp/index.ts`.
   Existing server subpath exports suffice for leaf imports.
2. Register `GeoParquetController` and `GeoParquetIngestionService` in
   `apps/api/src/modules/ingestion/ingestion.module.ts`.
3. Add the five operations below to the ingestion operation manifest with batch
   `GEOPARQUET-02`, disposition `added`, nativeController `geoparquet` and
   runtimeEvidence `pending`. Upload maxBodyBytes is `34603008`; responses are
   `GeoParquetRetainReceiptSchema`, `GeoParquetQueueReceiptSchema`,
   `GeoParquetStatusSchema`, binary and binary. Retry uses
   `GeoParquetRequestSchema`. Republish OpenAPI/client and the additive
   `geoparquet-native.changed` event.
4. Update catalogue/index/ledger while preserving historical fields. Any fusion
   consumer adjustment remains lead-owned; this task edits no fusion, citation,
   packet/card or learner files. Integrated execution needs a fresh profile for
   its exact checkout/code; do not repoint historical inventories.

| Method/status | Path under `/api/v1/ingestion/cases/{caseId}` |
| --- | --- |
| POST / 201 | `/geoparquet` |
| POST / 202 | `/sources/{sourceId}/geoparquet/retries` |
| GET / 200 | `/sources/{sourceId}/geoparquet/jobs/{jobId}` |
| GET / 200 | `/sources/{sourceId}/geoparquet/jobs/{jobId}/native` |
| GET / 200 | `/sources/{sourceId}/geoparquet/original` |

Multipart fields: one unchanged file, requestKey, expectedCaseRevision, JSON
lineage and JSON selection. Retry additionally pins expectedSourceRevision,
sourceSha256 and nullable continuation. Private guard, no-store/nosniff headers
and query-field refusal apply to all routes. Native profile is
`usp-native-geoparquet/1`; complete native bytes are preserved without rewriting.

## Checked retained inputs

Reuses the [accepted upstream manifest](native-geoparquet/sources.json),
[reader handoff](native-geoparquet-handoff.md) and
[accepted review](desktop-backend-review/native-geoparquet-review.md).
Both inputs are `test_only`, with retained origin revisions, terms and
attribution; foreign data stays in its original geography. No acquisition,
reader/CLI/lock rewrite, dependency/runtime/cache repair or model execution.

| Original, selection 0 / 2 | Actual API outcome | Native bytes / SHA256 |
| --- | --- | --- |
| `example.parquet` | partial: Fiji/Tanzania, decimal GDP integers `5496`/`63177`, 148 coordinate values, next row 2 of 5 | 23850 / `b69aaeeb3202a94f0bb6ce9ce3ed8971fba43afbfc56556785d5b98209f4a431` |
| `alltypes_plain.parquet` | unsupported `geo_absent`: 8-row/11-column inventory, no decoded rows or continuation | 7453 / `81ad130e4632c9daf5d908daf3f3c44dbb98d16fbb2ab934c68d1c039cb03722` |

Both full projections reproduce their previously accepted bytes exactly. Exact
metadata bytes, WKB/locators, integer decimal strings and CRS
absent/null/supplied/specification-default distinctions remain in the native
artifact. Unsupported cells retain their bytes/reasons. API status labels an
available truncated window or unsupported geometry cells `partial`; successful
job acceptance does not imply full-table coverage. Accuracy, validity, identity
and rights stay `not_assessed`; analytic/registry/learning eligibility stays
false. Non-microsecond `time64[ns]` remains refused by the unchanged reader;
broad temporal coverage remains unqualified.

Actual retain → job → worker → status/native/original methods use native
execution with labelled memory SQL/S3 protocol doubles. Exact continuation is
queued/replayed; incorrect result/artifact/next-row pins are denied. Each retry
is revoked after original I/O and stops before a second parser/publication.
Accepted reads deny post-I/O revocation, stale case context and fenced
acceptance. This is method/native evidence, not current HTTP/PostgreSQL/private
object persistence or authentic property applicability.

## Checks, pins and limits

Private evidence: `E:/BhuAayam-data/task-data/desktop-geoparquet-private-api/`.
`final-pins.json`: 56,327 bytes, SHA256
`5fa595f1f9b2c3efd09d4236eda6f65c268af5d2b6ee862d80ba44c3ba6b2ac1`.
It pins 23 physical/Git code files, three unchanged reader/CLI/lock files, both
journeys and 20 evidence files. Baseline/final receipts independently reconstruct
old/new physical and Git/LF constituents for IFC/DXF/KML/CityGML/semantic/MVT and
CityJSON validation. Both runs pin physical GeoParquet code
`05270c0d2bcfaf4dddd619c6579a0dae1d58d5a3ed8bb35a9070a0022b9b932d`.

- Authority/read compatibility: exit 0, seven passes/one deliberately
  unconfigured native skip (`authority-01.log`).
- Configured native journey: exit 0, one pass/no skips, exactly one sequential
  parser per input (`native-01.log`, `journey-01/`). Parser durations
  0.209/0.183 seconds, peak Job private bytes 61,661,184/49,229,824, affinity
  `[0,1]`, four sampled OS threads.
- Five-route Nest metadata/guard/header/query check: exit 0, one pass, no
  listener or generated-file writes (`nest-01.log`).
- Affected CityGML/KML authority and new compatibility: exit 0, twelve
  passes/two deliberately unconfigured old-native skips
  (`compatibility-final.log`); no old parser rerun.
- Final server/API types, wrapper compilation without bytecode, post-run full
  inventory and staged whitespace check: exit 0.

Immutable compatibility admits only exact captured assigned-base code hashes;
all current inventory/non-code/runtime/access checks remain mandatory and
writers stay strict. Existing historical compatibility remains. CityJSON
validation receives no exception. Comparisons do not requalify historical
runtime inventories. Receipt-helper failure from a missing empty-output log is
preserved separately; it caused no native execution or source change.

Fresh `profile-01.json`: 5,877 files, 1,240,549 bytes, SHA256
`5cf93303dc5aefc91148992ca122c351ddace07554a6e62661b9683ff99892c7`.
Existing CPython 3.13.7, PyArrow 21.0.0, Shapely 2.0.7, NumPy 2.2.6 and psutil
7.0.0 inventories are unchanged after both native journeys. Command-local
configuration uses `ULPIN_GEOPARQUET_PROFILE` and
`ULPIN_GEOPARQUET_PROFILE_SHA256`.

Caps: 32/16/1 MiB source/native/footer, 512 KiB status/result, 64 retained
sources/256 MiB, 16 jobs per source and one admitted job/parser. Native limits
remain 60 seconds, 2 GiB, two affinity cores/six monitored OS threads, 128
columns/groups, 128 MiB selected-group expansion, 1,000 returned rows and
100,000 coordinate values. The reader's 100,000 row bound applies per selected
group. The API additionally refuses aggregate scanned/prefix counters above
100,000 after output; no stronger native aggregate cap is claimed. Larger
cross-group windows remain unqualified; the checked window scans two rows.
Wrapper/worker/request/read ceilings are 90/150/45/60 seconds, within the
canonical 180-second lease. Fixed host mutex and named kill-on-close process Job
retain gated supervision; OS egress denial and literal two-total-thread
enforcement are not claimed.

Task scratch is empty and no task-owned Python process remains. Evidence ACL
permits owner/SYSTEM/administrators only; shared runtime/original roots are
untouched. Preserved CityGML and KML fusion branches remain. Live transport,
persistence, operational accuracy/geometry/learning, scale, Linux and release
gates remain unqualified. Lead integration/publication is the next step.
