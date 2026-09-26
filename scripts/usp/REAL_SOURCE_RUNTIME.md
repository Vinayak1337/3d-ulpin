# RUN-01 Nest runtime handoff

Phase 2B preparation uses accepted native registration base `6d4d550b8680c43b4196bd2628a5fd81dfa2505a`, followed by the accepted schema/docs corrections at `cbc5174aadae33f5db89540cddad16813fb7d290`. The lead accepted preparation `33f9749` and authorized one fresh run after correcting the initial job observation race. Both execution gates are enabled in the runtime commit. The completed task checkout has since been retired; original receipt paths are historical. Preparation checks alone do not qualify source-to-job-to-record.

The [26 September phase 2A receipt](../../docs/evidence/usp/nest-migration/runtime-foundation/README.md) records the observed foundation startup, same-database migration repeat, processor health recovery and completed owned shutdown. Its named volumes remain preserved. Source flow was not tested in phase 2A.

The [phase 2B receipt](../../docs/evidence/usp/nest-migration/runtime-source/README.md) records both passed source journeys, actual document-job failure/retry, same-key replay, private original integrity and completed owned shutdown on `5d80dd8`. The separate PDF.js helper and broader product/scale gates remain unqualified.

`local-nest` uses `127.0.0.1:3188` and pins both `PORT` and `API_PORT` to 3188. The nonce, Compose project, database, bucket and service ports remain exact. New preparations derive `ULPIN_LOCAL_OPERATOR_SUBJECT=local-os:<uid>:<account>` from the actual `node:os` account, record that provenance and pass it explicitly to API and dispatcher. This attributes process writes; it does not authenticate a human. Historical actors are untouched.

The launcher records each process group's nonce, leader PID, PGID and start time, and checks its actual members after SIGTERM. Unverified ownership or surviving members produce an unresolved-cleanup result without signalling a reused group. Compose shutdown includes `--profile app` and preserves named volumes. Private run files and logs live under `.runtime/run01/<nonce>/` with restricted permissions. The launcher does not load `.env`, restore a snapshot, seed records or enable providers.

This host uses the standalone `docker-compose` CLI; its Docker CLI has no `compose` subcommand. The runner passes the verified local Docker context to Compose.

## Fresh phase 2B run, after lead acceptance and authorization

1. Merge the accepted preparation/integration pin. Enable both script gates in a reviewed owned commit before preparing. The run records the resulting clean code pin; changing code afterward invalidates startup and smoke.
2. Use a clean, pinned checkout with no root `.env`. Confirm the required local Docker context and all six ports are free. Do not reuse another run's nonce or populated volumes.
3. After the locked install and accepted API build, prepare once. Copy the printed private directory into `RUN01_DIR`, then run:

   ```sh
   node scripts/usp/real-source-runtime.mjs prepare
   RUN01_DIR='/absolute/path/printed/by/prepare'
   node scripts/usp/real-source-runtime.mjs start "$RUN01_DIR"
   node scripts/usp/real-source-runtime.mjs status "$RUN01_DIR"
   node scripts/usp/real-source-runtime.mjs migrate-repeat "$RUN01_DIR"
   node scripts/usp/real-source-smoke.mjs "$RUN01_DIR"
   node scripts/usp/real-source-runtime.mjs stop "$RUN01_DIR"
   ```

   `migrate-repeat` uses the existing migration authority against the same private database without resetting it. The source smoke invokes only the guarded `processor-stop` and `processor-start` actions for its real document-job failure/recovery check, restoring the processor in `finally`. It writes one private `source-smoke.json`, including the failing phase and actual returned IDs on failure. Always run `stop` after success or a partial run. A startup failure attempts owned cleanup and reports unresolved cleanup separately. A failed processor restoration requires owned cleanup; inspect private logs without copying credentials into a handoff.

   `resume` is limited to a stopped nonce with recorded process provenance, preserved volumes and unchanged clean code. A newer revision requires a fresh nonce. Phase 2A configurations remain readable for status/cleanup and are not eligible for new writes under the new attribution contract.

## Source qualification boundary

The smoke records two independent journeys:

- **USGS historical PDF:** uses the unchanged private original and documented permission from [source-check.json](../../docs/evidence/usp/nest-migration/official-runtime-source/source-check.json). The case uses the actual document title. Uploading `plan-pdf-v1` queues a canonical inspect job. With the owned processor stopped, the first case read may observe `queued` or an already completed dispatch failure; the receipt records its exact observed status and asserts the persisted failure/history while the original stays downloadable. After restart, the actual retry endpoint creates a new job with the same source and input fingerprint. Its persisted inspection must remain `needs_input`, with page metadata and calibration required, no extracted geometry, units or model. Same-key replay must return the same source without new source/job rows. Downloaded bytes, SHA-256, size, private cache policy, disposition, MIME and remote-origin denial are checked.
- **NYC GIS:** uses only unchanged `fixtures/real-nyc/original.geojson`, its recorded native key, hash and terms. The synchronous import/read checks a distinct source revision, candidate/evidence binding and area package read, plus original-byte and private-download checks. It claims no queued document job.

Both sources are foreign `test_only`. The runtime receipt qualifies only the observed transport, queue/recovery, persistence and original-integrity behavior. It does not establish Indian source suitability, geometry/rights accuracy, ML, scale, frontend behavior or release-gate completion. Missing queue/parser support is a failing receipt and a defect callback to the lead.

## Archived completed runs

After integration, the lead removed the completed runtime worktree and preserved its entire private `.runtime/run01` tree at `/Users/vinayak/.codex/backups/ulpin-nest-consolidation-20260926-080116/runtime-0365/run01`. All 29 copied files were hash-checked. The old named service volumes remain intact and stopped. Historical ownership pins/checkout paths are not silently rewritten; archived configurations are recovery evidence, not a fresh-run input. Create a clean current checkout and a new nonce for subsequent code. See the [consolidation record](../../docs/orchestration/NESTJS_MIGRATION.md#consolidation-completed-26-september-2026).
