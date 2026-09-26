# INGEST-07 — retained official projected-vector admission

26 September 2026. Bounded backend source journey passed at code pin `6e85ae679207c8e8fce6df6a3879f8ccc9eafa79`, from accepted base `78f44217312ae6cb545e04d844e363ac1c230ab6`, in `0bc6` / `task/ingest-07-projected-vector`. Production correction is `093de781a75618bc4147d92068985bc86ef4dd48`; the final delta is the guarded verification runner. Lead reported Astra's independent scoped review accepted that production code with no remaining P1/P2 and six focused controls passed. Integration remains lead-owned.

The exact retained NWIC district ZIP now follows existing sources → canonical jobs → dispatcher → Celery/Python → fenced publication into source/job-linked administrative observations. All 733 dispositions survive: 720 admitted and 13 quarantined native self-intersections; neither repair nor silent dropping occurs. Native and geographic geometry remain private and bounded. This qualifies this one deterministic profile, not tiles, GF-STREAM/GF-SCALE, UI, generic format support or source survey/legal/currentness accuracy.

## Source and converter pins

Reuse the [official source index](../../api/real-sources.md), [acquisition receipt](nest-migration/nwic-boundaries/source-check.json), [manifest](../../../fixtures/usp/D3/nwic-boundaries-v1/manifest.json) and [admission profile](../../../fixtures/usp/D3/nwic-boundaries-v1/vector-admission-profile.json). No new download or discovery occurred. Issuer: National Water Informatics Centre; portal metadata identifies Geological Survey of India as producer. [Issuing download](https://nwdp.nwic.gov.in/dataset/6c1af675-1dec-4927-882c-c1ba9d73f76b/resource/8d9aa2e9-9806-4f26-a4ac-48ba21e9b96d/download/district_nwic_geojson.zip), acquired `2026-09-26T08:44:40+00:00`; [issuing terms](https://www.nwdp.nwic.gov.in/footer/copyrightPolicy) support the recorded conditional deterministic test use. Training permission remains unqualified.

| Input/runtime | Exact pin |
| --- | --- |
| Outside-Git original | `/Users/vinayak/.codex/task-data/ulpin-nwic-boundaries-v1/district_nwic_geojson.zip` |
| ZIP | 71,238,839 bytes; SHA-256 `44c734cc72139f2447dcebfe2791cac862dc5ba265e158912d797cf3410d5c37` |
| ZIP member | Literal `district_nwic.GeoJSON`; 168,356,689 bytes; SHA-256 `2b27a478e24d8c51b0655e74ce3f4f880e75c752e4597550d6fc925ed06ac201` |
| Retained expanded original | `/Users/vinayak/.codex/task-data/ulpin-nwic-boundaries-v1/extracted/district_nwic.GeoJSON` |
| Converter | `services/geo/geo/projected_vector.py`; SHA-256 `ba5ff17a255f8161c1b73d19b0961549f73b9cc0a9e94f9faeca1c73387bb633` |
| Worker image | `ulpin-geo:run01-e0c00ba88a5b1a20`; `sha256:be92666e1d142753bc0643e246cd354618462fe64f397d644ac8436f57014919` |
| Transformation runtime | Python 3.12.14; NumPy 2.0.2; Shapely 2.0.7 / GEOS 3.11.4; pyproj 3.6.1 / PROJ 9.3.0 |
| PROJ database | SHA-256 `79b660eb3c09f50c0f251e958db7cbf9a2d5d18d2836e99082095b31c7e029c5` |

Literal EPSG:7755 is preserved. The pinned no-network, no-ballpark, grid-free operation uses `always_xy` to EPSG:4326; source/target units are metre/degree and vertical reference is null. Actual runtime inverse residual was at most `6.51925802230835e-9` metres over 3,125,505 positions. This is numerical consistency only; the stored qualification is `numerical_transform_only_not_survey_accuracy`.

## Records, API and fences

The existing `administrative_units` registry gains namespaced typed native keys; immutable observations bind each source locator, properties, native geometry, disposition and optional geographic derivative to its canonical job/source. Namespace is `nwic:district-boundary:8d9aa2e9-9806-4f26-a4ac-48ba21e9b96d`. The actual numeric `id` keys stay numbers. The two real `dtcode="999"` records have distinct numeric keys 731/732 and distinct application UUIDs. Names/codes do not establish identity or ULPIN issuance. Existing FeatureKind and manual building mapping remain unchanged.

Four private native operations use `/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/projected-vector`: POST admission; GET status; GET `/units` for at most 25 metadata records with pinned continuation and optional geographic bbox; GET `/units/{unitId}/geometry` for one native or admitted geographic Feature. Native responses preserve exact original bytes and label EPSG:7755; geographic responses use `application/geo+json`. Quarantined geographic reads return 422. No whole-layer geometry appears in status, job JSON, metadata pages or lifecycle events. Accuracy/currentness stays `source_boundary_accuracy_and_currentness_unqualified`, purpose `administrative_context`.

Existing `usp_job_metadata` / `usp_job_attempts` carry intake/source pins, owner, attempt number, input hash, 180-second lease and fence; no second broker/job authority or invented scene manifest is introduced. Source adoption, accepted fence and compact outbox publication commit together. Private current-context checks also protect reads and source/operator changes. Publication follows case → source → job/metadata/attempt lock order. Admission and retirement share their advisory lock before those row locks.

Publisher failure must still match the current live owner, latest attempt number, fence and input hash. Superseded publishers return without invoking the generic dispatcher's job/error mutation. A genuinely changed current case/source is rechecked under locks and authoritatively fences the logical job; worker failure retains its separate authoritative path. Failed/stale retirement deletes only that job/source's NEVER-accepted staging after fencing, requires `accepted_fence IS NULL`, metadata failed and no accepted source pointer, and preserves a compact receipt in existing operations. Originals, canonical identities, immutable artifacts, accepted observations, jobs, attempts and outbox history are preserved.

## Finite profile capacity

One active projected job is allowed globally in this environment. Separate retained bounds are 128 canonical job receipts, 256 admission request receipts, four converter hashes, eight accepted generations, 128 MiB stored observation values per generation and 1 GiB across retained observations. Exact existing request keys remain replayable at capacity; new work then needs a reviewed capacity decision, never a reset or erasure of accepted history. A new request can re-admit a successful older job's source after its case context changes.

Native/geographic artifacts deduplicate by exact source + converter + content hash. Each converter's generated artifacts remain bounded by the unchanged 384 MiB output limit; per-job index limit is 1 MiB. Together four converter namespaces and 128 job indexes reserve at most 1,664 MiB of projection artifacts. Failed staging is retired; its compact receipts and immutable assets are retained within these finite reservations. Original/upload storage remains governed by the existing large-original profile.

Other unchanged limits: exact one-member archive; 1 MiB reader chunk/native Feature, 2 MiB geographic Feature, 18,000 positions per Feature, 128 rings/polygons, 17,000 positions per ring; child address-space ceiling 2 GiB, CPU soft/hard 100/105 seconds, 80 MiB spool-file bound, 100-second reader budget/108-second wrapper timeout. Publication checks its 120-second deadline between bounded feature operations; artifact reads have 10-second bounds, stage SQL/lock bounds 5/2 seconds. These are finite profile guards, not a production scale qualification.

Stored observation accounting sums actual column value sizes plus a fixed row allowance. It does not measure database indexes, WAL, allocator/free-space overhead or physical disk reclamation. Measured final retained values were 100,002,249 bytes per accepted generation (200,004,498 total); each generation's native/geographic geometry memory representation was 98,910,488 bytes. Object inventory measured 733 shared native objects / 168,355,067 bytes, 720 shared geographic objects / 117,546,989 bytes and three job indexes / 2,205,678 bytes: 288,107,734 projection artifact bytes total. All 733 earlier accepted records referenced the same feature artifacts after re-admission.

## Guarded source journey and receipts

Final project `ulpin-usptest-e0c00ba88a5b1a20`, API `http://127.0.0.1:3191/`; private directory `/Users/vinayak/.codex/worktrees/0bc6/3D Ulpin/.runtime/run01/e0c00ba88a5b1a20`. The existing runtime guard verified a clean pinned checkout, absent root `.env`, loopback nonce-owned services/credentials and isolation. Only that nonce database was used; the user's linked database/environment and live providers were untouched.

1. Retain the unchanged official ZIP through nine existing bounded upload parts and idempotent finalization; enqueue/replay one canonical projected job. Worker results stay compact and unaccepted staging stays unreadable.
2. After eight real staged observations, expire publisher A's lease and claim B through the existing USP authority. A's late failure returns false; B remains active at attempt/fence 2, job error remains null, and all eight rows survive. Only an actual subsequent case revision change fences the logical job and retires those exact eight never-accepted rows, with its retirement/job history intact.
3. Retry from the same retained source; accept all 733 dispositions. Verify numeric native keys, duplicated real dtcode, exact native bytes for admitted/quarantined records, preserved geographic properties/finite coordinates, bbox/page bounds, wrong case/cross-site denial, stale generation rejection and exact-key replay.
4. Change the real case revision again and admit a third job without re-uploading. Both 733-row accepted generations remain, canonical unit IDs and all native/geographic refs are reused, original-key receipts still name their original jobs, and exactly nine compact projected lifecycle events exist. Final current generation has 720 admitted, 13 native-invalid quarantined and zero invalid geographic geometry; stale staging count 0, retained originals 1, jobs 3, model calls 0. ZIP/member hashes remain byte-identical.

Actual application job durations were stale 41.084 s, first accepted 61.767 s and later re-admission 58.948 s. Final worker conversion measured 22.688 s, peak resident 94,658,560 bytes and per-run output 286,637,282 bytes; the final worker's total output includes its own index and counts shared bytes processed again. These local measurements do not pass GF-SCALE.

| Private evidence | SHA-256 |
| --- | --- |
| `projected-vector-smoke.json` | `852011d75921beac4c9e7288923bf0e928f37c5b400349c15f53fecbe42ac16a` |
| `projected-vector-retention.json` | `fac3b47079969a997516895235454e7444b25419dbc7f08eefa7dd7b7ce24823` |
| Stopped `ownership.json` | `5a60f77d76ac8d3ddc14aaf0761c66197a9f3fac615175e3e5359892650c0ffc` |
| Generated private attempt-control script | `b3bc00a4cbd51efe5d9420a3447e561d9aa96066ad1c15c96e49e721319014d5` |

Actual commands: `pnpm typecheck:backend` exit 0 on final production correction; candidate `pnpm build` exit 0; existing manual-ingestion/ingestion-events test command exit 0 (5/5); `python3 scripts/db/verify_extraction.py` exit 0 (historical hashes unchanged); Python compilation, smoke-script syntax and `git diff --check` exit 0. Existing runtime `prepare --api-port 3191`, `start <private-dir>`, `node scripts/usp/projected-vector-smoke.mjs <private-dir>`, bounded DB/object retention measurement and `stop <private-dir>` all exited 0 for the final run. API/body code did not change during serving.

Preserved earlier attempts: `89c19822668b9904` / `d0f865f` exposed JSONB bbox array serialization (worker succeeded, publication failed before any committed observation); `ce59daa350fc65d3` / `030b531` exposed the retirement-audit conflict target and status error normalization with unaccepted rows; `c999c5be1b3421a5` / `093de78` stopped at the configured tsx eval tooling failure; `0e60ccaa813dc73b` / `6e85ae6` failed before source processing on an isolated PG startup connection termination. Each stopped with volumes/evidence retained. The one unchanged guarded startup retry succeeded; serving/readiness scripts were not edited. None is a passing runtime receipt.

Final owned dispatcher/API groups 14040/14162 and five nonce containers were stopped by the existing guard; no assigned port listener or running final-project container remains. Three final named volumes (`minio-data`, `postgres-data`, `redis-data`) remain. No other lane, linked service, original, accepted history or volume was stopped/deleted. Final API catalogue/source-index updates belong to the lead; link this evidence before changing NWIC admission status. No frontend, renderer, Next adapter, root plans, AGENTS, credentials, provider, push/main or deployment changes were made.

Observed worker model `gpt-6-sol`, effort `max`. Fast requested; host configured `service_tier="priority"`; per-turn tier unobserved (null). No model artifact or ML/provider call was involved in this deterministic source conversion.
