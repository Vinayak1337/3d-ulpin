# RUN-01 Nest runtime handoff

Phase 1 at base `316d645c02b6b516f37e32ffda812b7c2534b41f`: these scripts are **static preparation only**. Both runtime entrypoints have hard-coded closed gates. No Docker service, database, API, dispatcher, processor, provider or source upload is started by this phase.

`local-nest` adds a separate isolation profile at `127.0.0.1:3188`. The existing nonce, Compose project, database, bucket, storage and processor ports remain exact. The proposed launcher uses `@ulpin/api` rather than Next, checks the owned process group, includes `--profile app` on shutdown, and preserves named volumes. Private run files and logs live under `.runtime/run01/<nonce>/` with restricted permissions. It does not load `.env`, restore a snapshot, seed records or enable providers.

## Phase 2, after the lead supplies an accepted integrated commit

1. Review the actual `apps/api/package.json` start script, bind settings, health payload, dispatcher/migration entrypoints and Nest intake contracts. Update these scripts to match the accepted code. Remove the two `RUNTIME_ENABLED = false` gates only after that review. The smoke gate should remain closed if the original-to-job contract is still absent.
2. Use a clean, pinned checkout with no root `.env`. Confirm the required local Docker context and all six ports are free. Do not reuse another run's nonce or populated volumes.
3. After the locked install and accepted API build, prepare once. Copy the printed private directory into `RUN01_DIR`, then run:

   ```sh
   node scripts/usp/real-source-runtime.mjs prepare
   RUN01_DIR='/absolute/path/printed/by/prepare'
   node scripts/usp/real-source-runtime.mjs start "$RUN01_DIR"
   node scripts/usp/real-source-runtime.mjs status "$RUN01_DIR"
   node scripts/usp/real-source-smoke.mjs "$RUN01_DIR"
   node scripts/usp/real-source-runtime.mjs recovery "$RUN01_DIR"
   node scripts/usp/real-source-runtime.mjs stop "$RUN01_DIR"
   ```

   `resume "$RUN01_DIR"` is for the same stopped, reviewed nonce and preserved volumes. Always run `stop` after a partial/manual run; it never removes volumes. A failed startup attempts owned cleanup and reports cleanup failure separately. Inspect private logs without copying secrets into a handoff.

## Source qualification boundary

The retained NYC OTI `fixtures/real-nyc/original.geojson` has a pinned original URL, SHA-256 and terms in `provenance.json`. The proposed smoke checks identical submitted/downloaded bytes, native source key, the persisted candidate package and source evidence on one candidate record. This is a foreign official footprint with unknown parcel/interior/rights and no common vertical datum. The currently supported GeoJSON import normalizes synchronously and exposes no queued job tied to its original source revision. The old draft's inspection/build jobs used **different derived files**; they do not close the original-to-job gap. Until an actual supported job and corresponding record read are verified on the integrated Nest API, the smoke must write `qualification: blocked` and exit 2. GF-BACKEND remains open.
