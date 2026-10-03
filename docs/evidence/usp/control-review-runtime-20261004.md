# RUN-CONTROL-01 — retained reference reader prerequisite, 4 October 2026

The current private API reads the unchanged D1 original successfully, but its retained revision-5 references are ineligible under the current document reader. The canonical references GET returns HTTP 409 `STALE_REVISION` before any comparison or review write. This is an observed prerequisite, not a persistence/replay or accuracy qualification.

Served code: `6c4efb44d6af8d45792d2820771d7c9953075a0e`, exclusive worker checkout `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`, branch `task/desktop-control-review-runtime`, loopback `http://127.0.0.1:3192/`. The completed comparison-review branch remains preserved. Staging was read-only; its later observed head was `84043e2731ccaf7743dbacddb0d559cd8693d1d2`. No production files changed or migrations ran. Supplied permissions were never/danger-full-access. Assignment requested GPT-6.1 Sol/xhigh/default-standard; actual model, effort and per-turn tier were not exposed.

Private proof: `E:/BhuAayam-data/task-data/control-review-runtime-20261004-run01/verification.json`, 20,547 bytes, SHA256 `cc5bd61bff887774de3e164183baf97e829ef956505b465fde0db549e26bc04a`. It pins diagnostic code, reader components, private helpers, HTTP receipts, before/after snapshots and cleanup. Credentials and raw private context remain outside Git.

## Actual HTTP observations

| Request | Outcome |
| --- | --- |
| GET `/api/v1/health` | 200; database/storage true, schema structurally_ready, overall false with processor stopped. Redis/worker observations correctly unobserved/processor-unavailable. |
| GET `/api/v1/sources/9d10dcce-fb65-4ba4-9bb8-7ad164ac9d8c/file` | 200; all 6,783 bytes equal the unchanged D1 fixture, SHA256 `5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2`. |
| GET `/api/v1/registry-drafts/bacc6fee-3156-438b-9720-8e7a531f9a47/native-exterior/references` | 409 `STALE_REVISION`: “The document source, case, reader, access or model policy changed. Retry under current pins.” Request ID `1530028e-30dc-4dc1-a81a-4a66d821971e`. |

The native source belongs to case `88ca2024-d901-4ae4-84cb-a05cac578b2a`; the draft's historical workspace case is `92e28360-9276-4f2b-b433-83bcaf3107ea`. Those identities were discovered from current records and kept distinct.

## Precise prerequisite

A private `BEGIN READ ONLY` diagnostic used the same runtime environment and canonical `documentSourceTx`, `documentInput` and `assertDocumentInputTx` as the API. Both reference sources are latest and their case/source revisions and hashes still match. For each job, the only stored/current input difference is `readerSha256`; source, case/context, subject/access, policy, mode and model-related input fields are unchanged. Both canonical input guards independently reproduce the same HTTP 409.

| Retained document job | Source | Selected parts |
| --- | --- | --- |
| `b15e790a-65c8-4920-ba59-608a7cd25204` | `0bb1289a-a087-4b33-9590-4e693ddaa23b` | 3 |
| `e63f6bd6-f6f9-4384-8a3f-7cc51d86da8c` | `d37030cf-0c46-4268-ae0b-18097aa30858` | 2 |

Both retained jobs/reference pins bind reader `e745ab9bf180da35d3fd59be8021da0f0944b203b34debb83549a590921d6166`; the current canonical reader is `b901accbcd0e7d555774fd0962950ff816d410cbce24e7a200bf2b2e8516ad0c`. The refusal originates in `packages/server/src/modules/usp/ingestion/document-context.ts`, `assertDocumentInputTx`.

Resuming requires fresh canonical accepted document-extraction receipts for those two unchanged reference originals under the current reader, followed by explicit removal/reselection of stale reference pins using current accepted parts and the current draft revision. Preserve historical jobs, results and selections; do not rewrite their hashes. Recheck the complete native/reference authority afterwards: this diagnostic does not establish that every subsequent guard will pass. Extraction and reference amendments were outside this assignment and were not attempted.

Control assessment, wrong expected assessment hash, review save/read/same-key replay and admission assessment are **unrun**. No comparison, saved needs_input decision or admission summary is claimed. Independent object controls and accuracy/admission qualification remain absent.

## Preservation and cleanup

Full before/after row fingerprints match for cases 39, sources 36, jobs 73, registry_records 1, registry_sites 1, registry_drafts 1, usp_job_attempts 73, usp_job_metadata 73 and packets 0. All prior operation fingerprints and job states match; pending jobs 0, added operations 0, control-review operations 0. The downloaded original matches its retained fixture. All eight profile/config/historical process-record files retain their initial hashes.

Only the three verified existing prefix PostgreSQL/MinIO/Redis containers were started, using exact IDs, project labels, image identities, mounts, operator SID and loopback bindings. API PID 45168 was stopped only after matching its recorded creation/entry identity; it is absent and port 3192 has no listener. The task-started containers are stopped, all 24 container IDs remain, and all 14 volume names match the retained recovery inventory. Docker Engine 29.8.0 remains available. Dispatcher, processing, native extraction, providers and model/GPU work stayed inactive.

## Commands and exits

`<proof>` below is the private directory named above. All commands ran from the assigned worker checkout with existing locked dependencies.

| Command | Exit |
| --- | --- |
| `node <proof>/runtime.mjs preflight` | 0 |
| `node <proof>/runtime.mjs start-storage` | 0 |
| `node <proof>/database.mjs before` | 0 |
| `node <proof>/api.mjs start` | 0 |
| `node --import tsx <proof>/journey.mjs`, initial invocation | 1 |
| Same journey after the private import correction | 0, recorded HTTP 409 blocker |
| `node --import tsx <proof>/diagnose.mjs` | 0 |
| `node <proof>/database.mjs after` | 0 |
| `node <proof>/api.mjs stop` | 0 |
| `node <proof>/runtime.mjs stop-storage` | 0 |
| `node <proof>/finalize.mjs` | 0 |

The first private journey helper passed an absolute Windows path to ESM import and failed before HTTP or writes. It was corrected to `pathToFileURL`; the existing API was reused without a production edit or restart. The actual three HTTP observations were performed once. No additional tests, typecheck, native reruns or release campaigns were needed for this evidence-only handoff.
