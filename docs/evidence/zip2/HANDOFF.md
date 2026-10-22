TASK   ZIP2 — bounded mixed-ZIP member intake            GATE GF-STREAM (partial)
WORKS  Up to 64 safe independent members are retained/enrolled; small GeoJSON keeps its existing reader route.
SEE IT `bash docs/evidence/zip2/verify.sh`
INPUTS Public Google/OSM repository bytes; retained Tweed GeoPackage plus nested shapefile ZIP, test_only.
GAPS   No live runtime qualification; shared-reader seams below still prevent an unrestricted “every ZIP” claim.

DESIGN `intake-zip-layers.ts`: small GeoJSON uses manual retain; other members use the existing byte receipt.
       First 64 independent members in archive order; retries count kept originals, overflow stays inside in words.
       Lineage/replay recovery remains; ancestry pins enforce depth two, deeper ZIPs stay kept, not read.
       `intake-zip-layers-worker.ts`: existing fenced job and lease renewals, existing IntakeService.register.
       `intake-draft.ts`: ZIP words only, original lines 64–87, now 64–116; adapter dispatch is untouched.
COMMITS b6a97076 fix(ingestion): retain and enrol mixed ZIP members with bounded nesting
CHECKS `bash docs/evidence/zip2/verify.sh` — 0: backend typecheck, 28 ZIP checks, 291 intake checks, diff check.
       Full configured intake attempt — 1: 286/287 passed; the unchanged migration-order assertion failed.
       `python -m json.tool docs/evidence/zip2/result.json` — 0; new-file 120-column check — 0.
NEXT   Lead review, then an authorized PostgreSQL/object-store/dispatcher/native-reader rehearsal.

## Shared seams needing separate ownership

- The existing probe omits orphan and raster sidecars from `card.members`; this job cannot copy unlisted entries.
  Expose the full safe directory or add an existing-reader directory-list seam in `intake-zip.ts`.
- `intake-native-derivative.ts` can overwrite the mixed archive summary if conversion finishes after fan-out.
  Preserve the member summary alongside its conversion outcome. Grouped shapefiles still use that existing reader.
- The probe treats any pack containing KML as KMZ. Mixed KML packs therefore bypass the generic ZIP job.
- Normal recursive jobs stop before enrolling a depth-three ZIP. Directly re-enrolling that retained source is
  guarded against another ZIP job, but a shapefile-native queue is selected earlier in `IntakeService.publish`.
  Put the ancestry admission before every archive reader to close that explicit re-enrolment path.
- CSV is retained/enrolled exactly like a dropped file; today's batch flow still asks **Read as a table**.
  No sheet/header selection, mapping approval or property record was invented here.
- Round 2 restores `ManualIngestionService.retain` with `format: 'geojson'` for GeoJSON up to 16 MiB, so small
  Point/Line members keep `geojson-manual-v1` without depending on the unmerged adapter-choice change.
  Larger GeoJSON still uses the existing streamed byte-receipt path; PDF/CSV and other kinds use byte receipts.
- Empty files stay inside the unchanged archive with words because the existing receipt and lineage require
  positive bytes. The existing byte-receipt capacity ceilings remain; they were not raised.

## Qualification and failure recovery

No Docker, database, object-store writes, provider calls or operational record writes were used. Test archives are
built in memory; source bytes on the data drive were read only and their hashes are unchanged. The Lake View pack
is an additional repository fixture, not independent real operational evidence. Native reader correctness and
storage/job behavior on PostgreSQL remain runtime work, not established by the SQL protocol doubles.

The full intake run exposed an existing test assumption: G16 widening now sits between streamed-profile and the
intake schema. The test, migration implementation and SQL are unchanged from staging. No unowned fix was made;
a final complete intake selection excludes only `tests/intake-migration.test.ts`, explicitly in `verify.sh`.
Earlier dependency/configuration failures and the receipt-basename correction are recorded in `result.json`.

Round 2 checks additionally show the small Point/manual and PDF/CSV byte-receipt branches, mixed-kind fan-out
capped at 64 in archive order even when SQL returns lexical order, and an interrupted retain retried without
creating more than 64 member originals in total. Beyond-cap members remain inside with `ZIP_LAYER_LIMIT` and
words naming the cap. The round-1 unrestricted-fan-out check is replaced, not claimed as current behavior.
