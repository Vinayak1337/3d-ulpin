# CITYGML-02 — canonical private CityGML intake

3 October 2026. Code `018df114de9d862cb3dea966d4f2d5133a2cdf2f`, assigned base
`0b209ca31e97fbcbadae9d5bb6dc02524127b1fe`, branch
`task/desktop-citygml-private-api`, exclusive checkout
`C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`. The completed KML fusion
branch remains at `5174b618`; read-only staging still matches the assigned base.
[Assignment](../../orchestration/PARALLEL_20261003.md#citygml-02--canonical-private-intake).
Requested Sol6.1/xhigh/default-standard; actual per-turn model/effort/tier are
unexposed. Supplied permissions: `never` / `danger-full-access`.

Unchanged upload → canonical source/job → private status/native/original reads,
with explicit idempotent retry. Uses existing cases, sources, operations,
attempts/fences, private objects and transactional outbox. An accepted job may
have a partial inspection; successful processing does not qualify its geometry.
Caller-declared lineage stays separate. Tool outages preserve originals;
interruption requires an explicit new job. Source/case/access/reader/input and
accepted-fence pins are checked around object I/O and before adoption. Ambiguous
COMMIT preserves authoritative recovery. Generic original access delegates to
CityGML authority; snapshot/copy/package/streaming/generic retry cannot bypass
it, including malformed markers and copied ancestry. Public source projections
hide private markers and reference parts.

## Lead registration

These integration edits remain lead-owned:

1. Export `./citygml-ingestion` from `packages/contracts/src/usp/index.ts`.
   Worker leaf imports are direct; server subpath exports already suffice.
2. Register `CityGMLController` and `CityGMLIngestionService` in
   `apps/api/src/modules/ingestion/ingestion.module.ts`.
3. Add the five operations below to the ingestion operation manifest, with
   batch `CITYGML-02`, disposition `added`, nativeController `citygml` and
   runtimeEvidence `pending`. Upload maxBodyBytes is `34603008`; response
   schemas are `CityGMLRetainReceiptSchema`, `CityGMLQueueReceiptSchema`,
   `CityGMLStatusSchema`, binary and binary. Retry uses `CityGMLRequestSchema`.
   Republish OpenAPI/client and the additive `citygml-native.changed` event.
4. In `source-fusion-kml-authority.ts`, change the immutable read assertion
   from `assertKMLTools` to exported `assertKMLReadTools`. This helper returns
   void after full current inventory verification. Fusion files remain untouched
   under this lane's ownership boundary. KML worker/processor assertions stay
   strict. Catalogue/index/ledger updates also remain lead-owned.

| Method/status | Path under `/api/v1/ingestion/cases/{caseId}` |
| --- | --- |
| POST / 201 | `/citygml` |
| POST / 202 | `/sources/{sourceId}/citygml/retries` |
| GET / 200 | `/sources/{sourceId}/citygml/jobs/{jobId}` |
| GET / 200 | `/sources/{sourceId}/citygml/jobs/{jobId}/native` |
| GET / 200 | `/sources/{sourceId}/citygml/original` |

Upload fields: one unchanged file, requestKey, expectedCaseRevision and JSON
lineage. Retry pins requestKey, current expectedCaseRevision,
expectedSourceRevision and sourceSha256; there is no member-selection field.
Private guards, no-store/nosniff headers and query-field refusal apply to all
five routes. Native bytes use profile `ulpin-native-citygml/1`.

## Checked retained inputs

Reuses [the accepted OGC manifest](native-citygml/sources.json), corrected reader
and unchanged CLI/runtime lock. Both originals are `test_only` standards
examples with SIG 3D/GDI-DE acknowledgement and unresolved specific-example
redistribution terms. No source acquisition, parser rewrite, dependency/cache
installation or operational/learning facts were added.

| Original | Actual inspection | Native bytes / SHA256 |
| --- | --- | --- |
| `Building_and_garage_LOD2-EPSG25832.gml` | partial; 256 elements, 2 buildings/parts, 28 coordinate declarations, 213 decoded values, 15 references | 167401 / `c075f2a686e45c80e0ef155a3d3b911346a4e3c0d9e73a5ed45722f59b707dd6` |
| `Building_LOD1-LocalEngineeringCRS.gml` | partial; 157 elements, 1 building, 18 coordinate declarations, 96 decoded values, 1 reference | 92114 / `0c1061c377bd318efb7e27ba774f2990afc0b9ad9e53204d8cdd782ce795ce6f` |

Both complete projections match their previously accepted bytes exactly.
Literal IDs/namespaces/locators/reference declarations, absent dimensions,
unsupported opaque payloads and unresolved-link states remain in the native
artifact. No schemas, assets or XLinks are fetched. Summary flags keep accuracy,
validity, identity and rights not_assessed, and analytic/registry/learning
eligibility false. This does not establish property association, geometry
validity, operational truth or release qualification.

Actual source → job → worker → status/native/original method journeys use
bounded native execution and labelled memory SQL/S3 protocol doubles. They are
not current HTTP/PostgreSQL/object-persistence evidence. Two denied retries
stop after revoked original reads, before parsing/publication; existing accepted
objects remain intact. Native artifact reads also deny post-I/O revocation,
changed case context and fenced acceptance.

## Checks, pins and bounds

Private evidence: `E:/BhuAayam-data/task-data/desktop-citygml-private-api/`.
`final-pins.json`, 49,558 bytes, SHA256
`77ecfc9806d9c70abb02a6eed553199f8c2cd05187c8b9007678f9eb9731dafe`,
pins 23 owned physical/Git code files, three unchanged protected reader/CLI/lock
files, both actual journeys and 14 evidence files. `baseline.json` and the final
receipt contain independently reconstructed old/new physical and Git/LF
constituents and aggregates for IFC/DXF/KML/semantic/MVT/CityJSON validation.
Both native journeys pin the final physical CityGML code aggregate
`319041a906b31bca05e1386c992e5a5ca8bad15062930d9b9ab0880e8074408d`.

- Authority plus exact historical-read controls: exit 0, seven passes and one
  intentionally unconfigured native skip (`authority-01.log`).
- Configured two-original native journey: exit 0, one pass/no skips
  (`native-01.log`, `journey-01/`). Parser execution was sequential, 0.112/0.106
  seconds, peak Job private bytes 48,283,648/48,431,104, affinity `[0,1]` and
  four sampled OS threads.
- Five-route leaf metadata/guard/private-header/query check: exit 0, one pass,
  without listener/generated writes (`nest-01.log`).
- Affected existing KML authority plus new compatibility controls: exit 0,
  seven passes/one deliberately skipped old native journey
  (`compatibility-final.log`); no old processor rerun.
- Final server/API typechecks, two new wrapper compilation checks without
  bytecode writes, and staged whitespace check: exit 0.

Compatibility admits only exact captured assigned-base code aggregates for
immutable IFC/DXF/KML/semantic/MVT reads. Non-code/runtime/access pins and full
current inventories remain mandatory; writers stay strict. Prior accepted
compatibility remains. Historical inventories are never repaired/repointed.
CityJSON validation gets no exception and remains stale where its producer code
changed. Comparison tests are technical controls, not fresh historical-runtime
qualification.

Fresh `profile-01.json`: 3,412 files, SHA256
`73a502d2f283f965c41cc12888b594f672684315577796933ff48762f67087d9`.
It inventories the existing CPython 3.13.7/Expat 2.7.1 runtime and isolated
psutil 7.2.2 environment plus exact checkout imports/caches. Full inventory
verification remains unchanged after both native journeys. Command-local
configuration uses `ULPIN_CITYGML_PROFILE` / `ULPIN_CITYGML_PROFILE_SHA256`;
an integrated checkout requires its own fresh profile and code pins.

Caps remain: 32 MiB original, 16 MiB artifact, 512 KiB status/result, 64 retained
sources/256 MiB and 16 jobs per source; one admitted job/parser at a time.
Unchanged native limits are 60 seconds, 2 GiB, two affinity cores, depth 64,
25,000 elements, 64 KiB strings and 100,000 decoded values. Wrapper ceiling is
90 seconds; worker 150 seconds inside the canonical 180-second lease;
request/read ceilings 45/60 seconds. Fixed host mutex and named kill-on-close
process-tree Job adapt the accepted KML design; no repeated kill/security
campaign. OS egress and literal two-total-thread enforcement are not claimed.

Task-owned scratch is empty and no owned Python child remains. Private evidence
ACL allows the owner, SYSTEM and administrators; shared roots/originals/runtime
are unchanged. No services, Docker/socket changes, DB/migrations, model/GPU,
provider calls, frontend, push/deploy or public activation. Live transport,
persistence, authentic applicability, performance and GF gates remain open.
