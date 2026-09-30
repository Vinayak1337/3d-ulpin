# CITYJSON-02 — private source/job/native-result API

Lead acceptance, 30 September: independent review `6537c21` found no actionable defect and integrates as `147d80d`; implementation/fixes/handoff integrate as `d24765e`, `ae510f2`, `0570891`, `d5d6a95`. The combined `api.py` retains the archive operation and dedicated CityJSON router. Integrated backend typecheck, 2/2 CityJSON authority tests, Python AST/registration checks and generated API/client checks pass. The contract is 193 operations / 221 schemas; existing named schema structures are unchanged, five CityJSON schemas/routes are added, and the existing event union is additive. [Catalogue receipt](cityjson-api-runtime.json) is an exact-data projection of preserved final read/cleanup evidence, not a new runtime. Original runtime/source/code hashes remain those below. LINK receives the isolated processing runtime only through its explicit compatible-code continuation. Geometry, MVT installation compatibility and all broader qualification limits remain open.

30 September 2026. Backend candidate, awaiting lead review/integration. Assigned worktree `C:/Users/kvina/.codex/worktrees/desktop-raster/3d-ulpin`, branch `task/desktop-cityjson-api`, base `530774ce5bfb8c466bd55c60a93149db8625533c`. Primary staging remains read-only; latest observed lead head `2ce90a3511f8ea2698459776a8f621e6feccae45`.

Implementation commits: `2b5af327730b726838aee2f2214e8008ef320cb3` adds the flow; `c4be39693b06b3705d2c4d72f6fd4646edf29734` makes a present malformed/null CityJSON marker fail closed through generic original authority; `b44adbccbf0e4250b9ae3216ccf9a5736639f8db` propagates server-set CityJSON `private, no-store` through the generic controller and prevents protected sources entering its earlier large-original streaming branch. This last narrow seam extension was explicitly assigned by lead after the final read found inherited `private, max-age=60`. Other profiles retain their existing cache policy. All four final read responses use `private, no-store`.

## Delivered flow

The existing source/object store retains the unchanged original with caller-declared lineage. The canonical job authority/dispatcher queues operation `cityjson-native`; a dedicated private Python transport invokes the accepted [source-native reader](native-cityjson-handoff.md) in a bounded child. Exact source/case/revision/context/subject/access/reader/payload pins and the accepted attempt fence govern publication and serving; original access is checked again after object read. Generic original downloads delegate protected CityJSON sources, including malformed present markers, to the same authority. No second registry/queue or dependency was introduced; existing area-operation dispatcher remains unchanged.

Routes under `/api/v1/ingestion/cases/{caseId}`:

- `POST cityjson`: multipart `file`, UUID `requestKey`, `expectedCaseRevision`, JSON `lineage`; retain and queue.
- `POST sources/{sourceId}/cityjson/retries`: idempotent request key with exact current case/source revisions and source SHA.
- `GET sources/{sourceId}/cityjson/jobs/{jobId}`: bounded private summary/recoverable status.
- `GET sources/{sourceId}/cityjson/jobs/{jobId}/native`: exact hash-checked accepted native JSON artifact.
- `GET sources/{sourceId}/cityjson/original`: unchanged original; generic `/api/v1/sources/{sourceId}/file` uses this authority.

Bounds: 8 MiB original, 32 MiB native artifact, 16 KiB result receipt/status, 64 retained CityJSON sources/128 MiB total, 16 jobs per source and two active jobs. Reader limits remain 1,000 objects, 100,000 vertices, 500,000 boundary indices, depth 64, one million tree nodes, cooperative 15-second deadline and hard 20-second child timeout. Unsupported content remains explicit; malformed supported geometry fails without publication. Filename is not parser authority. Additive source/job contracts and operation manifest are committed; generated OpenAPI/client files are left to lead integration.

## Checked real journey and recovery

Reused unchanged [D1 original](../../../fixtures/usp/D1/single-roof/original.json), 6,783 bytes, SHA `5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2`; issuer, CC BY 4.0 attribution, URL and acquisition remain in its manifest/receipt and source catalogue. Dutch exterior stays in its own geography. No new download, official fact or qualification label was created.

Case `88ca2024-d901-4ae4-84cb-a05cac578b2a`, source `9d10dcce-fb65-4ba4-9bb8-7ad164ac9d8c`, both revision 1. Initial processor-outage job `4f5a8adf-144d-4f7b-a5da-fad9f9e72ce3` failed with original preserved. A retry found the guard's `--no-recreate` had retained an older healthy geo container lacking the registered route; that job `32be6fd9-d58f-4297-87a5-3b7916d7d1be` failed clearly. Recreated only owned geo/worker from the built image using existing Compose files, preserving all storage. The actual unauthenticated `/internal/cityjson/native` then returned 401 rather than 404.

Successful retry `b1afbd0e-f480-45c8-b28b-4c9f19fe09a3` has accepted fence 1; replay returns the same job. Combined reader/wrapper SHA `377edfe71f3d08e0a1f4fb710441022b9a26fdadd0efa70724d0d1dea0f3d398`. Native output is 33,168 bytes, SHA `634685e1901b7e247878212262e45bf860942b1863490d7b8b67bda0b210022e`, exactly matching the accepted standalone reader. Independent oracle checks preserve two objects, 62 vertices, hierarchy/LoDs, three nonhorizontal LoD2.2 roofs and bounds within 0.000001 m; complete source JSON values remain, including null `b3_bouwlagen`.

Cross-case HTTP returns 404 and foreign Origin 403. Temporarily archiving only this new source-test case denied all four HTTP read routes with 403; its unarchived state was restored. Separate child calls to actual generic/dedicated original and status services under a different local subject each returned 403 before byte read; this is service evidence, not switched HTTP process attribution or human authentication. Focused in-memory tests cover malformed receipts, accepted-attempt/payload drift and the concrete present-null-marker regression without persisting invented property evidence.

## Commands and private evidence

- `pnpm typecheck:backend` — exit 0 after final cache/stream fix, committed as `b44adbc`.
- `node --import tsx --test tests/cityjson-authority.test.ts` — exit 0, 2/2 after final cache/stream fix.
- Earlier combined authority/existing private-MVT read tests — exit 0, 8/8 before the marker test was added. No new compiler clause or unrelated repeat MVT campaign.
- Four `test_cityjson_processing.py` tests — exit 0 in the existing geo image, read-only owned worktree mount, no network, 2 CPUs/1 GiB/pids 64. Host Python lacked shapely; no installation or host-Python pass claimed.
- Staged `git diff --cached --check` — exit 0 for all three implementation commits.
- `node E:/BhuAayam-data/task-data/desktop-cityjson-api/verify-final-read.mjs` — exit 0 at `b44adbc`: both exact originals, exact native artifact, unchanged accepted status, all four no-store headers, registered processor route 401 without token. No new ingestion or repeated access campaign.
- `node E:/BhuAayam-data/task-data/desktop-cityjson-api/verify-cleanup.mjs` — exit 0: owned API/dispatcher absent, only the three existing storage containers remain running.
- Guard `preflight`, `start`, `stop` commands with `E:/BhuAayam-data/runtime/prefix-worker-20260929` — exit 0; isolated project `ulpin-usptest-b050544f3d2cb99e`, API `http://127.0.0.1:3192`, geo `http://127.0.0.1:28000`, model gateway disabled.

Private evidence root `E:/BhuAayam-data/task-data/desktop-cityjson-api/`:

| Receipt/artifact | SHA-256 | Scope |
| --- | --- | --- |
| `receipt.json` | `da902f70f0421e33e942c4ea2c245d65b3c7a2de670c6859204ee8733c1ebdc6` | Processing/access evidence and 15 physical working-file pins at `2b5af32`; predates marker fix. |
| `final-code-precache-read.json` | `093d009948e814ff18deb79b538d66add7d664860baa45e5d6736b8df60d47c1` | Four exact retained reads at `c4be396`, no new ingestion; records generic cache issue explicitly. |
| `final-code-read.json` | `80109957aa34bc4e99024dd7e73584c7e2845a33c48d1fb17f2c046009473776` | Four exact retained reads at `b44adbc`, including corrected generic no-store header; 16 physical implementation-file pins. |
| `final-verification.json` | `339550f9f0e197c964757e86e90353e29945fd949ae82bbcf9397e117f309376` | Final code/read/evidence/script pins and observed stopped-processing/preserved-storage cleanup. |
| `final-runtime-result.json` | `0ded525f7b4624df847aa327361626eced66bee51d4c472b1040184e4614f849` | Successful accepted summary/artifact identity. |
| `archived-context-controls.json` | `499844c5ecfedf3f83082088334c57473c6dbb6481579c836f5e0f2027136366` | Four actual archived HTTP route denials and restored flag. |
| `subject-controls.json` | `1f617a30004a68d504abaccbb1c034eac8bfbcfc337b1521bbe7dd7dc224cd70` | Actual wrong-subject service denials. |
| `pre-cityjson-compiler.json` | `a7e08b67a29fdcca73707adb4a2026bcbf625d4bcae83a55dfd62d8d2241873c` | Observed prior compiler digest and 19-file hashes. |

`final-runtime-pins.json`, native output, initial outage/old-container results and the failed cache assertion script remain preserved. The first current-code assertion exited 1 on generic cache-control; the precache observation recorded that failure separately. Only the subsequent final-code receipt establishes its correction. Earlier subject/archived-context results are reused at their recorded revisions; no final-revision repeat of those campaigns is claimed. The streaming guard is a reviewed direct branch using the tested protected-source predicate, not a new persisted hostile-profile runtime test.

## Limits and cleanup

This qualifies bounded source/job/native-result transport and the checked foreign original only. No canonical registry geometry admission, analytical solid, global placement/CRS conversion, interior floors/units, ownership/rights, legal/exchange, frontend/rendering, scale, learning or release gate follows.

Adding the canonical job operation changes `jobs.ts`, among 19 MVT compiler-hashed files. Lead authorized leaving compiler compatibility unchanged: the owned runtime has zero private-MVT jobs and no retained generation binds observed pre-edit digest `e82f128b7c0ef1286df02afbc7238cebdce793fe8a18b451ed21da0d5815bd42`. Original physical `jobs.ts` bytes were not saved before editing; LF/CRLF reconstruction did not reproduce that digest. Do not claim exact physical-byte reconstruction or a retained-generation match. A later serving installation must reconcile any actually retained affected generation before read-compatibility claims.

Requested GPT-6.1 Sol/high/default-standard; actual model/effort/tier are not independently exposed. Supplied `never`/`danger-full-access` permissions verified. No worker/subagent, provider/model call, deployment, frontend/generated API edit, credential overwrite or populated-volume reset.

Owned API/dispatcher/geo/worker are stopped; populated PostgreSQL/MinIO/Redis remain running. Runtime ownership returns to lead in the completion callback. Originals, earlier receipts and old reader branch remain preserved. Worktree is clean after this documentation commit; no follow-on work is dispatched.
