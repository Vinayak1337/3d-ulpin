# Studio routes against the live API

Audit of every `ROUTES` entry in `apps/studio/src/local/routes.ts` against `docs/api/openapi.json` (staging `9e310c10`), checked on 10 October 2026 against the running demo API (`http://127.0.0.1:3194`, read-only requests).

Status: `exists` = path, method and the shape the Studio reads are published; `partial` = the path is published but the shape or the parameters differ from what the Studio reads; `missing` = not in the OpenAPI document (a draft contract in `@ulpin/api-client/draft`); `pending-merge` = published on the `k1` branch only.

| Route | Method | Backend status | Contract difference that matters to the Studio |
| --- | --- | --- | --- |
| `/api/v1/health` | GET | exists | — |
| `/api/v1/workspace-capabilities` | GET | exists | — |
| `/api/v1/work-queue` | GET | exists | No stage, readiness or next action: the Studio derives the next action from `kind`, `state`, `jobStatus`. `state`, `areaId`, `dataKind` are null for cases; `status` accepts only `all`, `processing`, `recorded` |
| `/api/v1/work-board` | GET | missing | Draft `WorkBoard` (READY-01). Batches leave Stage and Readiness empty |
| `/api/v1/buildings/{buildingId}/ledger` | GET | partial | Path published as `building-ledger/1` (parcel ULPIN object, spaces, sources, history, `assessment`, `missing`). The Studio reads the draft `BuildingLedger` (rights, shares, readiness, checks, revisions). The two share no fields; the Studio ignores the published shape until it is mapped |
| `/api/v1/buildings/{buildingId}/residents` | GET | missing | Draft `BuildingResidents` (REGISTER-02) |
| `/api/v1/buildings/{buildingId}/levels/{levelId}/review` | GET | missing | Draft `LevelReview` (EXTRACT-02) |
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
| `/api/v1/areas/{areaId}/canonical` | GET | pending-merge | On branch `k1`: the canonical area scene. Not wired in this task |
| `/api/v1/buildings/{buildingId}/canonical` | GET | pending-merge | On branch `k1`: the canonical building record. Not wired in this task |

## Backend requests

One line per route or field the Studio needs and the screen that needs it.

- `GET /work-board` (READY-01): Batches, for Stage, Readiness and count cards.
- `GET /buildings/{id}/ledger` in the draft shape, or a mapping to `building-ledger/1` (READY-01, RIGHTS-01, HISTORY-02): Map inspector, Register, Review. The published shape has no rights, shares, readiness or checks.
- `GET /buildings/{id}/residents` (REGISTER-02): Register, Residents tab.
- `GET /buildings/{id}/levels/{levelId}/review` (EXTRACT-02): Review.
- `GET /sources/{id}/pages` without `sha256` and `revision`, or those values carried on evidence references: Evidence viewer for plans and deeds.
- Evidence with a `jsonPointer` or `row` on area features: Evidence viewer, so it shows the feature and not the start of the file.
- Line geometry drawn, or a `roads` polygon, for road proposals: Map of the Gurugram area (the 2 road lines are not drawn).
- `GET /import-batches/{id}` (INGEST-03), `POST /buildings/{id}/imports/inspect`, `POST /buildings/{id}/imports`, `GET /building-imports/{id}` (INGEST-04): Add files for building documents.
- `GET /public/*`, `POST /public/requests`, `POST /public/requests/track`, `GET` and `PATCH /register-requests` (PUBLIC-01, REQUEST-01): the public portal and the Registry requests screen.
- Error bodies read through `ApiError`: `@ulpin/api-client` should read `body.error.message` as well as `body.message` (the Studio normalises it in `apps/studio/src/api/queries.ts` until then).
- A committed, recorded building in the demo database: no register exists to check S12 and S5 levels against the live API.
