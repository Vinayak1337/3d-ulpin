# RUN-CURRENT-01 — current isolated API and checkpoint schema

Completed 3 October 2026, with runtime observations from 16:05–16:19 UTC. The retained prefix profile served one authorized LGD source metadata/original read through the current Nest API, and the canonical USP migration applied the pending checkpoint schema and its metadata prerequisites. Source/job rows and existing registry counts were preserved. Task-owned API and storage were stopped after verification; Docker remains available.

Owner: `01a0f810-a9ec-73b2-9a47-dc2884e09c2d`; exclusive checkout `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`, branch `task/desktop-current-runtime`. Base and served SHA: `f642cf4ed81bf9509d108a6b48f64591c77941f7`. Staging was read-only and still matched that SHA at handoff preparation. Historical `task/desktop-docker-recovery@4d0cc67e` is preserved. Requested GPT-6.1 Sol/xhigh/default-standard; actual model, effort and service tier were not exposed. Supplied permissions were `approval_policy=never`, `sandbox_mode=danger-full-access`.

Private proof: `E:/BhuAayam-data/task-data/current-runtime-20261003-run01/verification.json`, with original command receipts, code/SQL/configuration/proof pins and this handoff's byte hash. The fresh directory restricts access to the current operator, Administrators and SYSTEM. Existing profile/configuration/log/PID records were not overwritten. No production code or API contract changed.

The existing profile `E:/BhuAayam-data/runtime/prefix-worker-20260929`, project `ulpin-usptest-b050544f3d2cb99e`, passed operator SID/isolation checks. Only its three existing stopped PostgreSQL/MinIO/Redis containers were started, after exact labels, image IDs, named-volume mounts and loopback bindings were checked. API-only startup used port3192 and a hidden owned process; processing, dispatcher, model gateway and live providers stayed inactive.

`packages/server/src/modules/usp/migrations.ts:migrateUsp()` completed with exit0 after inspection of every pending and always-executed SQL step and matching manifest hashes. It applied `usp_declarations_001`, `usp_packet_plans_001`, `usp_property_cards_001` and `usp_packet_pdf_entry_checkpoints_001`. The reviewed metadata prerequisites were compatible with existing data; core/backfill/reseed migration paths were not invoked. No conditional USP migrations remain pending. The checkpoint table has zero rows, 16 validated constraints (including four foreign keys, two unique constraints and its primary key), and the expected enabled immutable trigger. Plan/card tables are also empty; previous migration ledger rows are unchanged.

The current API at `http://127.0.0.1:3192/` returned HTTP200 for case `2c5ca5cc-d98a-48e9-9be0-16f2c590d0a3` and private original source `59b3f4b2-0a3a-4acd-9c99-60b989dda5f8`. The Ministry of Panchayati Raj LGD districts CSV, retained via [data.gov.in](https://www.data.gov.in/resource/local-government-directory-lgd-districts), is revision1, profile `csv-reference-v2`, status `needs_input`. All 89,622 downloaded bytes match the unchanged fixture, manifest and catalogue lineage: SHA-256 `b8901c98350a4057d3371ce14228181e4bb12cc447f847490efee599a0e38b59`. Its recorded GODL attribution, 25 September acquisition and unknown row epoch/coordinate references remain unchanged. This is a test-only administrative reference read; it establishes no property, geometry, ownership or training qualification.

Health returned HTTP200, database/storage true and database `structurally_ready` with schema ready. Overall `ok:false` reflects intentionally stopped processor/worker. The API's Redis flag is derived from processor readiness; an independent read-only `redis-cli PING` returned `PONG`. Six historical NOT VALID geometry/source constraints remain disclosed. This does not qualify full application health or release readiness.

Before/after counts stayed cases39, sources36, jobs73, registry_records1, registry_sites1, job_attempts73 and packets0. Job states remained succeeded63/failed7/stale3; queued/running/retry-pending jobs were zero before and after. Full source-row and job-row SHA-256 fingerprints were unchanged, as were eight original configuration/historical process-record hashes. See `preservation.json` for exact pins.

Actual successful commands below exited0; `<proof>` is the private directory above. The migration used the API's `TSX_TSCONFIG_PATH` temporarily, restoring its previous process value.

```text
node <proof>/runtime.mjs preflight
node <proof>/runtime.mjs start-storage
node <proof>/database.mjs before
node --import tsx <proof>/migrate.mjs
node <proof>/api.mjs start
node <proof>/api.mjs read
node <proof>/database.mjs after
node <proof>/verify.mjs
node <proof>/api.mjs stop
node <proof>/runtime.mjs stop-storage
git diff --check
git diff --cached --check
```

Two private-helper exit1 failures are retained: the first storage identity comparison stopped before container startup because stopped-port projections differed; the first API-read assertion stopped before source requests because it assumed Redis health was independent. Corrected helpers retained exact identity/loopback checks and recorded partial health plus direct Redis PING. Neither correction changed production code or original records. Runtime checks were not repeated during handoff preparation; no new typecheck/test campaign was needed for this evidence-only commit.

Cleanup identity-checked API PID30700, creation `/Date(1791044102849)/`, entry `<checkout>/apps/api/src/main.ts`, then stopped it. The PID is absent and port3192 has no listener. Only these task-started containers were stopped:

| Service | Exact container ID |
| --- | --- |
| PostgreSQL | `0c396431d8d4d7f2eafbe7042d28bb3569d2d8eb63098521c9f7c061aa7e1aee` |
| MinIO | `d1fa3830725f9d16a19f36749b80e2a15eeaa44427122eba433679428d54b620` |
| Redis | `06d88638fa535e14659c7f59ea39185bbde66c7f5bcc023555bfcf1ff7db7e03` |

All24 original container IDs remain, with zero running; all14 named volumes remain, including the three exact prefix storage volumes. Docker Engine29.8.0 remains available. No task-owned application/helper process remains. No volume reset, seed/reimport, credential/configuration change, frontend/model/native work, push or deployment occurred.

Qualification is limited to current authorized source metadata/original-byte read and additive metadata migration on this populated isolated profile. Queue/checkpoint reuse, mixed packets, contention/recovery execution, native extraction, applicability/measurement/rights, learning, scale and GF/release gates remain untested.
