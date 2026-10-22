TASK   RT1 — Keep originals, route readers by bytes            GATE GF1 / AUD1 gap 4
WORKS  Batch drops keep and enroll originals before selecting their byte-kind reader; dense GeoJSON streams.
SEE IT pnpm exec tsx --test packages/server/src/modules/usp/ingestion/retain-routing.test.ts
INPUTS REH9 NYC footprints/register/orthophoto/LAZ; real Magnolia PDF offered as plan.json and as CSV.
GAPS   No live runtime qualification; one native XLSX check skipped; optional legacy A3B diagnostics need follow-up.
DESIGN retain-batch.ts removes name routing; its progress loop is unchanged.
       service.ts commits original receipts before parsing and checks advisory table selections against bytes.
       intake-draft.ts reuses bounded GeoJSON or streaming; upload authority and source pins stay unchanged.
       intake-text.ts/intake-ledger.ts expose disagreement words; document-worker.ts reads upload-backed PDFs.
COMMITS e165cf2f fix(ingestion): keep originals before byte-based reader selection
        2a2910f4 test(ingestion): cover retained byte routing and unchanged rehearsal readers
CHECKS pnpm typecheck:backend (0); pnpm studio:typecheck (0)
       Server command/files in result.json: 159 passed, 1 skipped (0); routing test: 11 passed (0).
       pnpm --filter @ulpin/studio test -- src/features/intake: 194 passed (0).
       UI design scan (0); git diff --check (0). Earlier failures and optional diagnostics are in result.json.
NEXT   Integrate, then rehearse on an authorized empty runtime. Configure the native workbook test interpreter.
       Coordinate retain-batch.ts routing-only edits at lines 5, 32–35 and 42–44 with the progress change.
       Outside this task's paths, the A3B pool needs to model committed-but-unprofiled rows and metadata attachment;
       its native-reader and learning-control failures also remain unqualified. No push or deployment performed.

## Review notes

- Every batch file now uses the existing `/uploads` transport, then `/intake/items`. NYC's transport changes by
  design, but its bounded adapter, the LPC CSV adapter, raster-window and point-batch selections are unchanged.
- Small retained GeoJSON gets its existing manual profile on the same upload source. No original is copied,
  renamed or overwritten. Record-source admission checks the upload hash and byte receipt and grants no rights
  or geometry authority. Contained-layout memory includes these bounded upload sources.
- API disagreement words are projected into the existing `limitReason`; stored reader reasons are not rewritten.
  CityJSON is recognized and honestly kept-only: this task does not activate a CityJSON model reader.
- The PDF fixture used to call an upload receipt a source while giving it a `sources/` object key. It now uses the
  real `large-originals/` key, proving the bounded stream bridge the PDF worker needs.
- No DB harness requiring PostgreSQL exists for these checks: TB1 documents the mocked-pool convention. No Docker,
  live database, application, provider or deployment was used. This is unit/protocol evidence, not a runtime gate.
