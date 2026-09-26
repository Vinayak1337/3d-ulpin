# TILE-01 — bounded private standard MVT

Completed backend implementation and real-source runtime checks on 26 September 2026. Lead review/integration and the broader runtime gates remain separate. No frontend, renderer, public service, provider, source original, generated API catalogue or existing runtime helper was changed.

## Pins and scope

- Accepted base: `4c8d7510168235bef04139196851f0aac0defa4a`.
- Worker: reusable Sol task `01a0dc66-1a95-7813-b198-b3747e9a1908`, branch `task/tile-01-private-mvt`, checkout `/Users/vinayak/.codex/worktrees/0bc6/3D Ulpin`.
- Implementation: `bb144170715a4fcb6b6bec3cd0668c673fa54f15`.
- Production correction and final served code: `e8e0580c3f86ab557003bbfef6f5ffd8591e95ba`.
- Observed turn model/effort: `gpt-6-sol` / `max`. The assignment originally requested Fast; the user subsequently revoked priority and required Sol-only new assignments. The host is now configured with `service_tier = "default"`; this completed turn’s actual service tier is unobserved (`null`). No usage monitoring.
- Final nonce: `6ec4ef2dfff134fc`, Compose project `ulpin-usptest-6ec4ef2dfff134fc`, isolated loopback API `http://127.0.0.1:3191/`; now stopped.
- Geo image: `ulpin-geo:run01-6ec4ef2dfff134fc`, digest `sha256:be92666e1d142753bc0643e246cd354618462fe64f397d644ac8436f57014919`.

The existing canonical jobs/USP attempt authority, Node dispatcher, administrative registry, private object store and source admission are reused. PostGIS compilation runs in the existing dispatcher with a restricted NOLOGIN compiler role. There is no Martin instance, second broker, competing registry or coercion of administrative UUIDs into the property registry. New `usp_display.source_tile_cells` and immutable `source_tile_generations` are source/job/admission-bound extensions; existing registry-bound derivatives are untouched.

## Official unchanged input

Reuse [the retained source check](nest-migration/nwic-boundaries/source-check.json), [source profile](../../../fixtures/usp/D3/nwic-boundaries-v1/vector-admission-profile.json), [manifest](../../../fixtures/usp/D3/nwic-boundaries-v1/manifest.json), [official source index](../../api/real-sources.md) and [accepted INGEST-07 handoff](projected-vector-handoff.md). No new discovery/download was required.

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| NWIC ZIP, `district_nwic_geojson.zip` | 71,238,839 | `44c734cc72139f2447dcebfe2791cac862dc5ba265e158912d797cf3410d5c37` |
| Literal member, `district_nwic.GeoJSON` | 168,356,689 | `2b27a478e24d8c51b0655e74ce3f4f880e75c752e4597550d6fc925ed06ac201` |

Original: `/Users/vinayak/.codex/task-data/ulpin-nwic-boundaries-v1/district_nwic_geojson.zip`. Member: `/Users/vinayak/.codex/task-data/ulpin-nwic-boundaries-v1/extracted/district_nwic.GeoJSON`. Both were hash-checked before and after runtime. Issuer NWIC, portal producer GSI and native `agency=SOI` remain distinct in the source records. The existing conditional deterministic-test permission and accuracy/currentness/legal/training limitations remain.

Native EPSG:7755 observations and their EPSG:4326 derivatives come from the accepted pinned, always-xy/no-network INGEST-07 transform, with parser SHA-256 `ba5ff17a255f8161c1b73d19b0961549f73b9cc0a9e94f9faeca1c73387bb633`. The source has 733 native MultiPolygons and 3,125,505 positions: 720 admitted and 13 quarantined for native self-intersection. Tiles exclude quarantines and require the exact qualified admitted frame; unknown or altered source/frame profiles fail explicitly.

## Representation and API

Profile `nwic-private-mvt/1`, grid `xyz-webmercator-4096-b64/1`, layer `nwic_districts`. The compiler uses unbuffered `ST_TileEnvelope`, EPSG:4326→3857, `ST_AsMVTGeom(...,4096,64,true)` and `ST_AsMVT` with real numeric native IDs. Halo candidate selection is separate from the unbuffered clipping bounds. Numeric MVT feature IDs are scoped transport IDs; canonical administrative UUID/source-observation identity maps remain authoritative. They are not official parcel ULPINs.

Five new native operations, under `/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/private-mvt`:

| Method/path | Result |
| --- | --- |
| `POST` | Fenced source/admission/context-pinned logical job, HTTP202 |
| `GET` | Current job status and coherent generation pin |
| `GET /generations/{jobId}/{version}` | Immutable ready/pending manifest |
| `GET /generations/{jobId}/{version}/tiles/{z}/{x}/{y}.mvt` | Standard hash-verified MVT, private/no-store |
| `GET /generations/{jobId}/{version}/tiles/{z}/{x}/{y}/units/{unitId}` | Exact identity-map pick → admitted canonical observation |

No client SQL, object URLs, compiler profiles or unknown query fields are accepted. Source/case/operator/revision/admission/compiler/access authority is resolved before any tile cache/object lookup, and rechecked after object reads before return. Archive, cross-origin, cross-case and stale context deny prior outputs. Benign earlier generation versions remain coherent/readable while their source context stays current.

Display quantization, clipping and validity correction can omit, collapse or repair geometry. Each cell records candidate/emitted/omitted counts, exact map dependencies and source/compiler pins. The runtime observed seven omitted feature occurrences across cells; all 720 admitted units appeared somewhere. This is not a causal breakdown of omissions or a measurement of repairs. Every manifest is labelled administrative context, `analyticEligible=false`, with these limitations. Native/geographic source observations and accepted history are preserved unchanged.

Primary format/SQL references: [MVT2.1 proto](https://raw.githubusercontent.com/mapbox/vector-tile-spec/master/2.1/vector_tile.proto), [ST_AsMVT](https://postgis.net/docs/ST_AsMVT.html), [ST_AsMVTGeom](https://postgis.net/docs/ST_AsMVTGeom.html), [ST_TileEnvelope](https://postgis.net/docs/ST_TileEnvelope.html).

## Finite bounds and publication

| Resource | Bound |
| --- | --- |
| Zoom/grid | XYZ zoom2–6; extent4096; buffer64 |
| Catalog including windows/invalidation/parents | 128 cells; actual source envelope62: 2/2/4/12/42 by zoom |
| Publication batch | Four newly prepared cells; copied outside cells precede dirty-cell batches |
| Tile / identity map / manifest | 2MiB / 512KiB / 1MiB |
| Reserved artifacts per job | 64MiB and384 object reservations, including reused refs, intermediate manifests and failed/orphan writes |
| Job/request/history | One global active tile job;32 retained jobs;128 request aliases;8 completed job histories;32 versions/job |
| Attempts / lease / build | Existing three-attempt authority,180s heartbeat lease;240s build deadline per runner invocation starting before first lookup |
| SQL / lock / object | At transaction entry, ≤8s statement and≤2s lock, reduced to remaining build time; object operations≤10s, reduced to remaining time |

All invalidation/catalog unions exceeding128 fail rather than truncate. Artifact reservations precede writes and remain charged even when a write fails or a manifest is never adopted. The finite worst-case charge is32×64MiB=2GiB; accepted history is not automatically reclaimed. Capacity exhaustion returns an explicit error, retaining exact-key replay.

Immutable assets/maps are written and hash-verified before cells are staged. Coherent manifests reference only prepared cells, explicitly list pending cells, and are adopted with the source pointer and compact outbox event in one transaction. Final completion uses the existing fenced USP authority. A late/expired owner cannot fail or retire a newer owner; only never-published terminal staging can be selectively retired, preserving published cells, generations and all charged object receipts.

Source-observation changes/revalidations derive invalidation from old+new actual extents, halo and all parent zooms. Partial windows retain the outside catalog. Unchanged tile/map content addresses are reused. A changed case/admission context with unchanged geometry can create a verified copy-only generation; unchanged current inputs still return `MVT_NO_CHANGE`.

Astra's initial P2 identified case/advisory/attempt locks before SQL limits and late deadline checks. Correction `e8e0580` installs scoped bounds before all tile transactions/queries, claims, heartbeats, completion and failure retirement; propagates remaining time through compilation/storage/staging; and checks deadline before coherent insertion, after transaction actions and immediately before fenced completion COMMIT. Existing non-tile job call behavior is preserved by optional narrow callbacks.

Final compiler pins:

- Code hash: `7ba0d09183675baa615a63a4f72add4f683bb83f1027321b2d61d09bb63fbc82`.
- Policy hash: `32ec71b4da66b81bb327a71b828b6ed4657cbdd697c7f2d2cf73c61978298e00`.
- Source transform hash: `be1ac135a94abffa5cf29707de98f9fa1fcada8889c723349dd8c5c3531cea90`.
- Composite compiler hash: `c36c3ea4d51fd52914fa89c602e36867c3132715b06836b535c21a3f7072c6f5`.
- Runtime: PostgreSQL17, PostGIS3.5.2, GEOS3.9.0, PROJ7.2.1 NETWORK_ENABLED=OFF, protobuf1.3.3, Wagyu0.5.0. Full version string is in the actual receipt. Source transform remains the separately pinned pyproj3.6.1/PROJ9.3.0 profile; neither transform establishes positional accuracy.

## Actual runtime evidence at corrected code

Fresh native upload and admission of the unchanged original; no database snapshot import, reset/reseed, ownership edit, provider call or original overwrite.

| Record | Actual UUID |
| --- | --- |
| Case | `381f0d7e-1a3a-4c95-9283-9fc2e7a6c308` |
| Source | `74dff7cd-23e1-4536-80df-eed38463d9d2` |
| First admission | `615102b1-3c52-4c74-a271-ebc4b44ece2d` |
| Initial tile job | `65e3fc17-e016-44fe-bf7e-ad9909041782` |
| Revalidation tile job | `5cb16983-f41e-4957-ae83-8d3cd52895cf` |
| Current-context re-admission | `d892517d-7a45-4e85-88af-35c6ea32c278` |
| Copy-only tile job | `5a430f96-eed0-46c4-a11b-3976b77f3f34` |

- First useful manifest v1: four ready/58 pending, job still running,3.205s after tile enqueue. Its SHA-256 is `61a4326846bc8d6b99afd39b4c9b12fac056f84bfe74b0692440c0388f5c5805`.
- Held real case row: ordinary lock probe returned PostgreSQL`55P03`,3,389ms end-to-end (includes connection/transaction overhead; configured lock timeout2s). Remaining100ms probe returned`57014`,145ms end-to-end. Neither published another generation under the held lock.
- Dispatcher group30529 was abruptly stopped only after exact recorded PGID/start-time, `/bin/sh`, checkout cwd and nonce command verification. Its five exact group members were recorded; all vanished. No process-name matching or unrelated termination.
- Supported whole-nonce stop/resume preserved v1 and four staged cells. Expired A's failure and an unowned failure were denied while temporary B owned the job. Dispatcher C accepted attempt3 and completed the same logical job, hash-checking recovered assets; final generation v16. Initial tile elapsed43.106s including crash/restart/control, not a scale benchmark.
- All62 emitted protobufs decoded as version2 polygon tiles, layer/extent/buffer/geometry command bounds/count closure checked. Total6,016,272 tile bytes; largest492,242B;4,160 feature occurrences;16,654 polygon rings;720 distinct canonical units;13 quarantines excluded. Scoped numeric IDs match actual native keys; canonical picks agree across cells. No admitted unit was absent from every cell.
- Actual revalidation used unit`cd0b76b9-a02c-47eb-ab9a-84b2504b2f75`, old/new extent`[76.76053775811685,13.682260928372543,78.4692618588293,15.234277476866716]`. Invalidation cells were`2/2/1,3/5/3,4/11/7,5/22/14,6/45/29`. The requested one-cell window was zoom6,x44,y24;57 outside cells were preserved. Recompiled unchanged cells also reused their identical artifacts,62 reused overall. Three progressive versions completed in8.202s.
- A real case revision denied old manifests/tiles. Native re-admission completed in38.460s; copy-only job had zero compile-plan cells and62 verified reused tile/map pairs, completed in5.916s. Current pin v1 SHA-256`c19775f67440e9d8983e99bc74812d1f39101c4fd5073673e85bfadf5d790085`. Old context remains denied; a new request with exactly current pins returned409`MVT_NO_CHANGE`, with tile-job count unchanged at3.
- One original, two accepted admission histories, three succeeded tile jobs,186 prepared cells and20 immutable generation versions remain. Model-call count0. Original/member hashes and earlier observation metadata were unchanged.
- Charged object reservations, including intermediate manifests/reused refs: initial140objects/9,590,536B; revalidation127/7,230,722B; copy-only125/7,111,533B. All within declared bounds.
-26 compact private outbox frames, maximum216B. Every published event version matched its committed coherent generation/status. Compiler role was NOLOGIN and nonprivileged, allowed source SELECT and denied source/generation UPDATE. An actual same-value generation UPDATE was rejected by immutable trigger (`P0001`) and rolled back.

Private receipts are retained outside Git under `/Users/vinayak/.codex/worktrees/0bc6/3D Ulpin/.runtime/run01/6ec4ef2dfff134fc/`:

| Receipt/program | Bytes | SHA-256 |
| --- | ---: | --- |
| `private-mvt-smoke.json` | 26,729 | `5aa78d234aaed8dd5eb1c9b677274820fe0e02045852f0b5d70d915bb0b742ab` |
| `private-mvt-postcheck.json` | 9,179 | `d660c0894a193d61905d00d0e5674f917a28bb4fcdd9e710ca921e21e8976898` |
| `dispatcher-crash.json` | 526 | `a40666a2fe8d227eb842b7ba8ea2227aebc7f930afd08d573239526164b2b371` |
| `private-mvt-postcheck.mjs` | 5,266 | `b10be970456ee6909684a846042eb260f14c27cac49e54d7495060f21816232a` |

The primary smoke is committed at `scripts/usp/private-mvt-smoke.mjs`; per-run control programs and their hashes are recorded by its receipt. The independent postcheck program above is preserved with its exact hash.

Earlier nonce `d0687f255b8f0222` at `bb14417` is stopped/preserved. Its initial smoke failed because graceful stop reported lingering dispatcher descendants; they subsequently exited and its62-cell job drained to completion. A continuation's claim then correctly failed on a succeeded job. A separate hashed decoding continuation passed the actual62tile/720unit/private/invalidation checks, but did not qualify interrupted-job recovery. All failed/pass receipts remain there; `private-mvt-decoding.json` SHA-256`1f9b9ce9f144015f2923aad034825ad6583f852771cc2341283fd08cc35b4305`. Corrected code never ran under that earlier ownership pin.

## Commands, cleanup and limits

Actual final code checks, all exit0:

- `pnpm typecheck:backend`.
- `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test tests/manual-ingestion.test.ts tests/ingestion-events.test.ts tests/usp-foundation.test.ts` —42/42 passed.
- `python3 scripts/db/verify_extraction.py` —25 exact historical files/136 statement hashes;7 authored additions;31 named runtime queries and Compose bootstrap. Historical SQL unchanged.
- `node --check scripts/usp/private-mvt-smoke.mjs`; `git diff --check`.
- Existing guarded `prepare --api-port3191`, `start`, `stop`, `resume` at final nonce; `node scripts/usp/private-mvt-smoke.mjs <final-dir>`; preserved postcheck program.

Final owned `stop` exited0. Verified status: no containers, no live leaders or process-group members; API32411 and dispatcher32265 gone. Three named volumes (PostgreSQL, MinIO, Redis) remain; earlier nonce volumes/receipts also remain. No unrelated serving resource was stopped. The stop receipt is `private-mvt-stop.json` in the final nonce directory. `.runtime` receipts are ignored by Git and must be preserved separately before any future worktree archival.

This is post-admission private administrative display qualification. It does **not** establish first useful generation before multi-chunk import completion/full GF-STREAM, GF-SCALE, changed official geometry/deletion invalidation with a second official revision, generic format/CRS coverage, positional/legal/currentness accuracy, property/ownership/height facts, learning permission, public/multiuser/replica deployment or UI/renderer adoption. Performance numbers are local observations, not scale qualification. Lead owns generated OpenAPI/source/runtime catalogue and ledger updates after reviewed integration.
