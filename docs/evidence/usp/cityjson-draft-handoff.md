# CITYJSON-DRAFT-01 — private exterior draft code checkpoint

1 October 2026. Implementation `53318fa4632fa3f29f7f4288d34ba8f20c8836ac`, based on `004e2c342300cd874067f8a582bb022a80ebd96c`, branch `task/desktop-cityjson-draft`, worktree `C:/Users/kvina/.codex/worktrees/b3eb/3d-ulpin`. Reconciled staging `d4fd93d884c4b08bf87b39091c8951f5e8b58329`: no difference from the base under contracts/server/API source; the later lead changes are handoff metadata. Primary staging remained read-only.

Assignment: [CITYJSON-DRAFT-01](../../orchestration/CITYJSON_DRAFT_01.md). Requested GPT-6.1 Sol/xhigh/default-standard; actual per-turn model, effort and tier are unobserved. Supplied permissions are `never` / `danger-full-access`. No new chats or subworkers.

## Delivered behavior

| Private operation | Contract | Bound |
| --- | --- | --- |
| POST `/api/v1/registry-cityjson-drafts` | `RegistryCityJSONPrepareSchema` → `RegistryCityJSONReceiptSchema` | 16 KiB JSON |
| GET `/api/v1/registry-drafts/:draftId/native-exterior` | `RegistryCityJSONReadSchema` | 1 MiB response |
| POST `/api/v1/registry-drafts/:draftId/native-exterior/remove` | `RegistryCityJSONRemoveSchema` → `RegistryCityJSONRemovalReceiptSchema` | 16 KiB JSON |

All use `PrivateSpatialGuard`, `private, no-store` and no query fields. Existing RegisterService/module and exact Zod documentation are reused; the operation manifest adds three operations. Generated OpenAPI/client/catalogue remain lead-owned.

Preparation reuses the canonical registry allocator and draft transaction, with one new application building UUID distinct from source IDs and official ULPIN. `destination.kind=source_site` creates a separate nonsynthetic EPSG:7415/NAP site and archived preparation case atomically; no existing site/record is assumed. Existing destinations require the exact declared frame and expected site revision. The accepted source case frame/context/site ID remain unchanged.

The draft carries immutable input/result/artifact/accepted-fence and native selection pins plus the existing core `asset` representation. Native geometry stays in the accepted artifact: encoded vertices, transform, exact Solid/MultiSurface boundaries, LoD, semantics and actual Building/BuildingPart parent context are resolved without reconstructing a shell. The draft XY footprint is the traceable projection of an explicitly selected supported Building LoD0 horizontal face with one ring. Closed rings normalize only that projection; the native ring is unchanged.

Same-client source/case/job/accepted-attempt checks hold canonical SHARE locks and run before/after object I/O. Preparation serializes on the existing case-import advisory lock, locks an existing destination site before source authority, and creates fresh source sites only within its transaction. Current-access reads lock site/draft before source authority. Request replay and different-key same-intent reuse require unchanged draft/site/input/fence pins. Amended/removed intent and an unrelated canonical draft request-key collision conflict without overwrite or duplicate reservation.

General registry projections omit private pins and the candidate-derived footprint. The revision-zero registry identity reservation contains an empty footprint, without private geometry. Generic creation/edit/review/commit reject marker presence, including absent legacy `geometry` and committed replay. Removal increments the draft revision, clears the marker and derived footprint without source I/O, and preserves identity/source/job history. Its remaining empty record needs fresh ordinary footprint/evidence before generic review.

## Code checks and preserved source pins

Focused tests protect loss of exact source geometry, stale/revoked authority, duplicate writes, unrelated draft overwrite and accidental recording/disclosure. Technical controls use in-memory authorities and application references; they create no persisted operational records or qualification receipts. The unchanged source and saved accepted artifact supply the representation checks.

| Actual command/check | Result |
| --- | --- |
| `ULPIN_CITYJSON_DRAFT_ARTIFACT=E:/BhuAayam-data/task-data/desktop-cityjson-api/native.json` then `pnpm exec tsx --test tests/registry-cityjson-draft.test.ts tests/registry-document-evidence.test.ts` | exit 0; 17 passed, 0 skipped (8 new + 9 affected citation/projection regressions) |
| `pnpm typecheck:backend` | exit 0; server and API |
| `node E:/BhuAayam-data/task-data/desktop-cityjson-draft-checkpoint/check-routes.mjs` | exit 0; three route/guard/cache/schema metadata checks, three direct query denials, direct 16,385-byte body rejection (413); no listener |
| `git diff --cached --check` before implementation commit | exit 0 |

These are code/technical checks, **not HTTP/runtime or analytical qualification**. Existing accepted CityJSON/OCR/LINK runtime journeys were not repeated. Only the affected citation/projection regressions were exercised.

| Retained input | Bytes | SHA-256 |
| --- | --- | --- |
| `fixtures/usp/D1/single-roof/original.json` | 6,783 | `5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2` |
| `E:/BhuAayam-data/task-data/desktop-cityjson-api/native.json` | 33,168 | `634685e1901b7e247878212262e45bf860942b1863490d7b8b67bda0b210022e` |

Origin/attribution: [unchanged 3DBAG Building API response](https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.1655100000500568), © 3DBAG by tudelft3d and 3DGI, CC BY 4.0 as retained in the [manifest](../../../fixtures/usp/D1/single-roof/manifest.json). Dutch declared EPSG:7415/NAP is not independently qualified or Indian placement. Source-supplied null floor information remains null; no floors, units, rights or volumes are inferred.

External code/source/Git-blob/receipt hashes and exact commits are saved in `E:/BhuAayam-data/task-data/desktop-cityjson-draft-checkpoint/verification-pins.json`, alongside `tests.txt`, `typecheck.txt`, `routes.json` and the no-listener route script. The route receipt pins its executed bundle SHA-256. Original and accepted artifact bytes were rechecked unchanged.

## Limits and runtime ownership

This bounded profile supports one Building exterior or its explicit single-parent BuildingPart geometry, declared EPSG:7415/NAP and one supported source LoD0 horizontal single-ring footprint. Missing/incompatible references, parent relationships, geometry or footprint return recoverable 422; excessive private views return 413. Geometry/reference/topology remain `not_assessed`, state `unrecorded`. No P3 issuance, positive geometry qualification receipt, FIND/READY relaxation, global conversion, geometry exchange, interior, learning, performance, release or deployment claim is made.

**Runtime unrun and lead-owned.** No API/DB/Docker/worker/dispatcher query/start, source mutation, download, GPU/model execution, frontend change, provider call, push or deployment occurred. No owned listener/service was created; temporary route bundle was removed. Tracked changes are committed; the pre-existing untracked `.pnpm-store/` and completed OCR branch remain preserved. After acceptance, the lead may transfer the bounded actual-D1 API journey; this code checkpoint does not authorize or claim it.
