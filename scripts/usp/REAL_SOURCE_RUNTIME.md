# RUN-01 Nest runtime handoff

Phase 2A starts from accepted staging `055534deb93eef0b85e8251b88cc40bc9a691fec`. The guarded Nest runtime launcher is enabled for isolated foundation/SQL health and recovery checks. `real-source-smoke.mjs` remains gated until the intake controllers and same-original job path are integrated. This phase does not qualify source-to-job-to-record.

`local-nest` adds a separate isolation profile at `127.0.0.1:3188` and pins both `PORT` and Nest's `API_PORT` to 3188. The existing nonce, Compose project, database, bucket, storage and processor ports remain exact. The proposed launcher uses `@ulpin/api` rather than Next, records each process group's nonce, leader PID, PGID and start time, and checks its actual members after SIGTERM. If ownership is unverified or members remain, shutdown reports unresolved cleanup without signalling a reused group. Compose shutdown includes `--profile app` and preserves named volumes. Private run files and logs live under `.runtime/run01/<nonce>/` with restricted permissions. It does not load `.env`, restore a snapshot, seed records or enable providers.

This host uses the standalone `docker-compose` CLI; its Docker CLI has no `compose` subcommand. The runner passes the verified local Docker context to Compose.

## Phase 2, after the lead supplies an accepted integrated commit

1. The accepted `@ulpin/api start` uses `API_PORT`, binds `127.0.0.1`, and exposes the expected five-service health shape. Keep the smoke gate closed until the integrated intake contract supplies a verified same-original job path.
2. Use a clean, pinned checkout with no root `.env`. Confirm the required local Docker context and all six ports are free. Do not reuse another run's nonce or populated volumes.
3. After the locked install and accepted API build, prepare once. Copy the printed private directory into `RUN01_DIR`, then run:

   ```sh
   node scripts/usp/real-source-runtime.mjs prepare
   RUN01_DIR='/absolute/path/printed/by/prepare'
   node scripts/usp/real-source-runtime.mjs start "$RUN01_DIR"
   node scripts/usp/real-source-runtime.mjs status "$RUN01_DIR"
   node scripts/usp/real-source-runtime.mjs migrate-repeat "$RUN01_DIR"
   node scripts/usp/real-source-runtime.mjs recovery "$RUN01_DIR"
   node scripts/usp/real-source-runtime.mjs stop "$RUN01_DIR"
   ```

   `migrate-repeat` invokes the existing `pnpm db:migrate` against the same guarded private database without resetting it. `resume "$RUN01_DIR"` is for the same stopped, reviewed nonce and preserved volumes. Always run `stop` after a partial/manual run; it never removes volumes. A failed startup attempts owned cleanup and reports cleanup failure separately. Inspect private logs without copying secrets into a handoff.

## Source qualification boundary

The retained NYC OTI `fixtures/real-nyc/original.geojson` has a pinned original URL, SHA-256 and terms in `provenance.json`. The proposed smoke checks identical submitted/downloaded bytes, native source key, the persisted candidate package and source evidence on one candidate record. This is a foreign official footprint with unknown parcel/interior/rights and no common vertical datum. The currently supported GeoJSON import normalizes synchronously and exposes no queued job tied to its original source revision. The old draft's inspection/build jobs used **different derived files**; they do not close the original-to-job gap. Until an actual supported job and corresponding record read are verified on the integrated Nest API, the smoke must write `qualification: blocked` and exit 2. GF-BACKEND remains open.
