TASK   RT1 round 2 — Preserve act 1 routes; fallback on refusal            GATE GF1 / AUD1 gap 4
WORKS  Small maps/ZIPs keep their routes; only 413/422 falls back to uploads, preserving the first refusal words.
SEE IT pnpm --filter @ulpin/studio test -- src/features/intake/retain-batch.test.ts
INPUTS Real NYC footprints; real Magnolia PDF named plan.json; test_only CityJSON and dense NYC repetition.
GAPS   Two PDF checks await EVF1 integration; one native XLSX skip; no live runtime qualification.
DESIGN retain-batch.ts restores retainMap/viaUpload exactly; retainOriginal falls back on ApiError 413/422 only.
       retainBatch publishes the first refusal message and retains it alongside later outcome words.
       No upload progress mechanics, rendering, CSS or shared command changes.
       document-worker.ts exactly matches the origin/staging merge base, leaving EVF1's reader to integration.
CHECKS pnpm typecheck:backend (0); pnpm studio:typecheck (0).
       Studio intake: 204 passed in 37 files (0); focused transport routing: 14 passed (0).
       Server byte routing: 11 passed (0); combined server checks: 157 passed, 2 failed, 1 skipped (1).
       The two failures are upload-backed PDF reads: reverted readObject rejects large-originals/ keys.
       A bounded direct readObject check confirms STREAMING_ORIGINAL_REQUIRED before storage access (0).
       UI design scan (0); merge-base document-worker diff empty (0); git diff --check (0).
       Exact commands, failures, historical diagnostics and UI design findings are in result.json.
NEXT   Lead integrates EVF1 and RT1, reruns the PDF checks, then rehearses on an authorized empty runtime.
       Configure the native workbook interpreter separately. No merge, rebase, push or deployment performed.

## Review notes

- The real act 1 footprints post to `/sources`, not `/uploads`; small ZIP success still posts to
  `/intake/archives`. Both functions are unchanged from the base. CSV/TIFF/LAZ direct upload selection remains.
- Mocked `/sources` refusals cover CityJSON (`UNSUPPORTED_PROFILE`, 422), a 2,500-feature GeoJSON
  (`RECORD_LIMIT`, 413), and the real PDF named `.json` (`INVALID_JSON`, 422). The fallback refreshes the case
  revision, sends the same filename and complete bytes, then enrolls the retained source. ZIP refusal also falls back.
- A lost response, 400, 403, 409 or 500 never switches routes. The first refusal words remain on the existing Reason
  row through progress and success, and are preserved if upload fails. No new browser format sniffing was added.
- The accurate upload-backed PDF fixture is deliberately unchanged. No duplicate document reader, storage edit,
  test skip or weaker object key masks the EVF1 dependency. The lead's eventual merge owns that integration.
- UI design check: no Blocking or Design system findings. Existing server words use the existing Reason column;
  no DOM, CSS, tokens or focus behavior changed. The scanner covers apps/web, not Studio; no visual claim is made.
- No Docker, live database, application, provider or deployment was used. This is unit/protocol evidence, not a
  runtime gate. Round 1 optional A3B diagnostic gaps remain recorded, not rerun or claimed fixed.
