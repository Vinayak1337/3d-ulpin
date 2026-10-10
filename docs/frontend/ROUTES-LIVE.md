# Studio routes against the live API

Audit of every `ROUTES` entry in `apps/studio/src/local/routes.ts` against `docs/api/openapi.json` (staging `9e310c10`), checked on 10 October 2026 against the running demo API (`http://127.0.0.1:3194`, read-only requests).

Status: `exists` = path, method and the shape the Studio reads are published; `partial` = the path is published but the shape or the parameters differ from what the Studio reads; `missing` = not in the OpenAPI document (a draft contract in `@ulpin/api-client/draft`); `pending-merge` = published on the `k1` branch only.

| Route | Method | Backend status | Contract difference that matters to the Studio |
| --- | --- | --- | --- |
| `/api/v1/health` | GET | exists | — |
| `/api/v1/workspace-capabilities` | GET | exists | — |
| `/api/v1/work-queue` | GET | exists | No stage, readiness or next action: the Studio derives the next action from `kind`, `state`, `jobStatus`. `state`, `areaId`, `dataKind` are null for cases; `status` accepts only `all`, `processing`, `recorded` |
| `/api/v1/work-board` | GET | missing | Draft `WorkBoard` (READY-01). Batches leave Stage and Readiness empty |
| `/api/v1/buildings/{buildingId}/ledger` | GET | partial | Published as `building-ledger/1`; **live**, mapped to the screens' `BuildingLedger` by `apps/studio/src/api/ledger.ts`. The published shape has the parcel ULPIN, spaces, sources, history, `assessment` and `missing`. Rights, shares, readiness, checks, deviation, address, declaration, ground elevation, and the actor and hash of each revision are absent: the screens show them as Unknown or Not assessed |
| `/api/v1/buildings/{buildingId}/residents` | GET | missing | Draft `BuildingResidents` (REGISTER-02) |
| `/api/v1/buildings/{buildingId}/levels/{levelId}/review` | GET | missing, superseded for candidates | Draft `LevelReview` (EXTRACT-02). The candidate review screen (F2a) no longer reads it: roofprints come from `/areas/{id}/canonical` and rooms from `/buildings/{id}/canonical` (`candidates`). Only the old workspace's level question still calls it |
| `/api/v1/import-batches/{batchId}` | GET | missing | Draft `ImportBatch` (INGEST-03) |
| `/api/v1/sources/{sourceId}/pages` | GET | partial | Published as `document-pages/1`: requires `sha256` and `revision` query parameters (422 without them), pages carry `frame`, `mediaBox`, `renderSupport`, `url`, `locator`, `calibration`. The Studio calls it with neither parameter and reads the draft `DocumentPages`. Non-document sources answer an error and fall back to the file viewer |
| `/api/v1/sources/{sourceId}/pages/{page}` | GET | missing | Page renders are published as `/pages/{page}/raster` |
| `/api/v1/public/records` | GET | missing | Draft `PublicSearch` (PUBLIC-01) |
| `/api/v1/public/records/{recordId}` | GET | missing | Draft `PublicRecord` (PUBLIC-01) |
| `/api/v1/public/buildings/{buildingId}` | GET | missing | Draft `PublicBuilding` (PUBLIC-01) |
| `/api/v1/public/areas` | GET | missing | Draft (PUBLIC-01) |
| `/api/v1/public/areas/{areaId}/map` | GET | missing | Draft `PublicMap` (PUBLIC-01) |
| `/api/v1/public/codes/{code}` | GET | missing | Draft (PUBLIC-01) |
| `/api/v1/public/requests` | POST | missing | Draft (REQUEST-01) |
| `/api/v1/public/requests/track` | POST | missing | Draft (REQUEST-01) |
| `/api/v1/register-requests` | GET | missing | Draft (REQUEST-01). The header badge polls it every 3 s and treats 404 as no requests |
| `/api/v1/register-requests/{ref}` | GET, PATCH | missing | Draft (REQUEST-01) |
| `/api/v1/buildings/{buildingId}` | DELETE | missing | Deletion is not published. Records are retired through reviewed classification, not removed from the Studio |
| `/api/v1/areas/{areaId}` | DELETE | missing | As above |
| `/api/v1/import-packages/inspect` | POST | exists | Answers `suggestedIdField: null` and `featureIdEligible: false` when no field is unique per feature (a one-feature file); the Studio asks the officer to choose the field |
| `/api/v1/import-packages` | POST | exists | Writes to the linked database; not exercised in this audit |
| `/api/v1/import-packages/{packageId}` | GET | exists | States are `RECEIVED`, `READY_FOR_REVIEW`, `COMMITTED` and others; features are unrecorded proposals until committed |
| `/api/v1/buildings/{buildingId}/imports/inspect` | POST | missing | Draft (INGEST-04) |
| `/api/v1/buildings/{buildingId}/imports` | POST | missing | Draft (INGEST-04) |
| `/api/v1/building-imports/{importId}` | GET | missing | Draft (INGEST-04) |
| `/api/v1/areas` | GET | exists | `featureCount` is 0 and `dataKind` is `empty` for areas that hold only unrecorded proposals (the area header then shows no feature count); `extent` is null |
| `/api/v1/areas/{areaId}/context` | GET | exists | Imported proposals arrive in `displayFeatures`; `features` is empty until records are committed. Roads are line geometry (`MultiLineString`), which the map does not draw. Evidence is `{featureId, sourceRevisionId}` with no `jsonPointer` or `row`. `sceneAssets` is empty |
| `/api/v1/buildings/{buildingId}/register` | GET | exists | 404 `NOT_FOUND` for a building that is only a proposal (all 64 in the demo database). Error bodies are `{ error: { code, message, requestId } }`, not a top-level `message` |
| `/api/v1/sources/{sourceId}/file` | GET | exists | The file name is in `filename*=UTF-8''…` form |
| `/api/v1/resolve` | GET | exists | Called by the building search; not in the route table |
| `/api/v1/areas/{areaId}/canonical` | GET | exists | **Live**: the map draws its footprints from this record through `toSceneInputs()`. Every building of the demo Bronx area is `recordState: candidate`; the Gurugram area has `buildings: []` and its two road base features have no polygons (`value: null`, state `unknown`) and no line geometry |
| `/api/v1/buildings/{buildingId}/canonical` | GET | exists | **Live**: the inspector shows its `recordState` and `gaps`; the scene adds its storeys and levels when it has them; the candidates page lists its recorded floors and units (F3a below) |
| `/api/v1/spatial-ml/batches/{batchId}` | GET | exists | **Live** (F2a): batch id, items and image count, shown beside a roofprint candidate |
| `/api/v1/spatial-ml/items/{itemId}` | GET | exists | **Live** (F2a): the inference receipt (model card summary) and the footprint drafts already made from the image |
| `/api/v1/spatial-ml/items/{itemId}/footprint-drafts` | POST | exists | **Live**: F2c below |
| `/api/v1/buildings/{buildingId}/candidates` | POST | exists | **Live**: F2c below |
| `/api/v1/import-packages/{packageId}/review` | POST | exists | **Live** (F2a): answers 422 `USP_GEOMETRY_PAYLOAD_UNQUALIFIED` for every roofprint draft; the Studio shows it as a blocked state |

## F2c candidate decisions — live, 10 October 2026

- `POST /api/v1/spatial-ml/items/{itemId}/footprint-drafts`: accepts rejections alone with `selections: []`,
  per-component reasons and no top-level `reason`; returns `package: null` without creating a draft package.
  Accept-plus-reject requests are unchanged. Studio recorded one reject-only Karnataka decision through this route.
- `POST /api/v1/buildings/{buildingId}/candidates`: Studio now sends `action: 'reject'` with `candidateId`,
  `reason`, `requestKey` and `expectedCanonicalRevision`; `Idempotency-Key` equals `requestKey`, as for `attach_level`.
  Room rejection success was route-intercepted for this UI check; no live room write was made.
- A record with a `review` has no accept, reject or attach controls; its outcome, reason, actor and time remain visible.
  Concurrent decisions still return the server's message: 409 `CANDIDATE_DECIDED` or 422 `ML_REVIEW_SELECTION`.
- Magnolia has three reviewed levels; its level picker was checked live without attaching a room.

Evidence: [F2c result](../evidence/gf-ai/ui/f2c/result.json) and
[UI design check](../evidence/gf-ai/ui/f2c/ui-design-check.md).

## F2b table imports — UI complete, live reads / intercepted writes, 10 October 2026

Studio route: `/studio/work/cases/:caseId/tables/:sourceId`. Optional `rawJobId`, `mappingJobId` and
`recipeId` parameters preserve the selected jobs and recipe. Add files offers **Import as a table** for
CSV/XLSX; it selects or creates an unassigned case, retains the original and queues raw/mapping jobs.
Workbook sheet and header rows are entered explicitly; there is no sheet-list endpoint.

Published routes used (all prefixed `/api/v1`):

- `GET /work-queue`, `GET /cases/{caseId}`, `POST /cases`: source-case selection, validation and creation.
- `POST /ingestion/cases/{caseId}/sources` (multipart),
  `GET /ingestion/cases/{caseId}/sources/{sourceId}/profile`: retained table, hash and selected headers.
- `POST /ingestion/cases/{caseId}/sources/{sourceId}/streaming-vector`,
  `GET /ingestion/cases/{caseId}/sources/{sourceId}/streaming-vector/jobs/{jobId}`: raw rows and progress.
- `POST /ingestion/cases/{caseId}/sources/{sourceId}/chunk-mapping`,
  `GET /ingestion/cases/{caseId}/sources/{sourceId}/chunk-mapping/jobs/{jobId}`,
  `GET /ingestion/cases/{caseId}/sources/{sourceId}/chunk-mapping/jobs/{jobId}/chunks/{chunkIndex}`:
  candidate column proposals, questions, field origins and model confidence.
- `GET /ingestion/cases/{caseId}/events`: native SSE with cursor resume; stream failures disclose
  2-second job-status polling. Durable per-chunk metrics are deduplicated by job and chunk.
- `POST /ingestion/cases/{caseId}/sources/{sourceId}/recipes`,
  `GET /ingestion/cases/{caseId}/recipes/{recipeId}`,
  `POST /ingestion/cases/{caseId}/recipes/{recipeId}/approve`: every column needs a target and reason;
  proposal and approval are separate confirmations. Approval uses the configured local operator.

Qualification:

- **Live, read-only:** A3c case `4ad9cb6d-56c0-445e-a9b6-357d1dc1d452`; source profiles, raw status,
  recipe revisions and durable SSE metrics. First CSV reports new/memory/new; second reports accepted
  memory and learner v44; native XLSX reports sheet `T_18` and header rows 4/5. Teacher calls are zero.
- **Live limitation:** all three historical mapping-status reads return 409 `STALE_REVISION` after later
  sources advance the case revision. Studio shows the exact refusal and unknown proposals; it does not
  replace unavailable mapping data with offline results. Automatic ordinary-dispatcher rollout remains owed.
- **Intercepted:** import, case creation, refusal/retry, mapping proposal, operator approval and following
  its new mapping job. JSON mutation bodies and responses validate against the published contract;
  multipart serialization is tested. No F2b live write or runtime restart was made. Offline second-file
  reuse is job-local, not proof of accepted learning.
- Public D8 development originals only, `test_only`, permission unconfirmed. Tables produce draft rows,
  not buildings, registry entries or map features. No table execute control exists. No mapping-accuracy,
  authenticated officer-truth or student-improvement claim is made.
- Canonical labels and meanings come from the contracts vocabulary. `openapi-fetch` null-only type loss
  requires narrowly documented transport casts; authored bodies otherwise use generated API types.

Evidence: [F2b result](../evidence/gf-agent/ui/f2b/result.json),
[intercepted browser checks](../evidence/gf-agent/ui/f2b/browser-result.json),
[live read checks](../evidence/gf-agent/ui/f2b/live-result.json) and
[UI design check](../evidence/gf-agent/ui/f2b/ui-design-check.md).

## F3a recorded floors and units, table result freshness — live reads / intercepted states, 10 October 2026

Studio route: `/studio/properties/:buildingId/candidates`, panel **Recorded floors and units** below the
review columns. Read-only; it has no write control.

- `GET /buildings/{buildingId}/canonical` is its only read. A level with `registryFloorId` is a recorded
  floor; a space with `recordState: reviewed` and a `label` is a recorded unit. Label, heights, kind, area
  and citations are shown as returned; a code is shown only when `proposedCode.state` is `reviewed`.
  A floor the server linked to a schedule row arrives as that row and is listed once, under it.
- The gap sentence about source-stated labels is found in `gaps` by its opening words, because gaps carry
  no code, and is shown once above the list.
- **Live, read-only:** Tower 3 `6f95d04e-2067-4ac8-a3c2-6cc21ea46325` (no levels) and Magnolia
  `e8777ffc-9409-4129-bacf-f680160d8795` (3 levels) hold no recorded floor; both show the empty state.
- **Intercepted:** the populated states, without and with a code. The responses come from the K4b offline
  protocol double fed with the K4c request literals and validate against the published contract; the code
  is a test value from the existing generator, not an issued identity. No live write was made.
- **Citation control:** opens the existing evidence viewer on the cited source with the page and region as
  locator text. Against the demo runtime the viewer shows its file view, not the page: see Backend requests.
- **Table page** (`/studio/work/cases/:caseId/tables/:sourceId`): the raw and mapping status and chunk
  responses carry `current` and `reasons`. When any is `current: false` the page shows one **Needs review**
  notice with the reasons in words and offers neither Approve nor the shared-reason control. Mapping
  questions are kept across chunks by `sourceField`, first occurrence first; plan and field origins come
  from the latest chunk. Checked with intercepted controls only.

Evidence: [F3a result](../evidence/gf1/ui/f3a/result.json),
[browser checks](../evidence/gf1/ui/f3a/browser-result.json) and
[UI design check](../evidence/gf1/ui/f3a/ui-design-check.md).

## Backend requests

One line per route or field the Studio needs and the screen that needs it.

- `GET /work-board` (READY-01): Batches, for Stage, Readiness and count cards.
- `building-ledger/1` fields the screens read and the published shape lacks (READY-01, RIGHTS-01, HISTORY-02): address, declaration, ground elevation, per-space rights, areas and shares, readiness, checks, deviation, and the actor and hash of each revision. Map inspector, Register, Review.
- Evidence locators in `building-ledger/1` are `feature:<id>` text; the evidence viewer needs a `jsonPointer` or `row` to open the exact feature.
- Line geometry in the canonical area record for roads that have no polygon (the scene has no line primitive either): Map of the Gurugram area.
- `GET /buildings/{id}/residents` (REGISTER-02): Register, Residents tab.
- `GET /buildings/{id}/levels/{levelId}/review` (EXTRACT-02): Review.
- `GET /sources/{id}/pages` without `sha256` and `revision`, or those values carried on evidence references: Evidence viewer for plans and deeds.
- Evidence with a `jsonPointer` or `row` on area features: Evidence viewer, so it shows the feature and not the start of the file.
- Line geometry drawn, or a `roads` polygon, for road proposals: Map of the Gurugram area (the 2 road lines are not drawn).
- `GET /import-batches/{id}` (INGEST-03), `POST /buildings/{id}/imports/inspect`, `POST /buildings/{id}/imports`, `GET /building-imports/{id}` (INGEST-04): Add files for building documents.
- `GET /public/*`, `POST /public/requests`, `POST /public/requests/track`, `GET` and `PATCH /register-requests` (PUBLIC-01, REQUEST-01): the public portal and the Registry requests screen.
- The officer geometry-qualification route (K2e) (F2a): not in `docs/api/openapi.json` yet. Until it is, every accepted roofprint stops at the blocked state; the typed TODO is `reviewDraftForRegistry` in `apps/studio/src/features/review/candidates/commands.ts`.
- A committed, recorded building in the demo database: no register exists to check S12 and S5 levels against the live API.
- XLSX sheet listing before retention (F2b): Add files currently asks for the exact sheet name and header rows.
- Per-case retained table-source and latest-job listing (F2b): reopen saved source/job links without relying on SSE replay.
- Historical mapping job/chunk reads that preserve source fences after an unrelated source changes the case (F2b/A3c).
- Ordinary dispatcher rollout of tabular raw/mapping jobs (F2b/A3c): the live fenced-worker receipt is not automatic dispatch.
- Preserve null-only fields in `openapi-fetch` Readable/Writable types (F2b): `selection.table` and `destination` are null.
- A stable code or kind on each canonical `gaps` entry (F3a): the recorded panel finds the source-label sentence by its opening words.
- The recorded floor's own label, citation and `recordState` when it is linked to a schedule row (F3a): the canonical level then carries only the schedule row's label and citations.
- The source file name on canonical citations (F3a): the citation control names the source by a short id.
- A page-and-region evidence read (F3a): canonical citations carry `sourceSha256`, `sourceRevision` and a page region, but the evidence viewer has no region locator and the demo runtime answers 503 `DOCUMENT_PAGES_RUNTIME_UNAVAILABLE` for `GET /sources/{id}/pages`.
- A recorded building with a source-recorded floor and unit in the demo database (F3a): the populated panel was checked with intercepted responses only.
