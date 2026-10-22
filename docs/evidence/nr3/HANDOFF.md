TASK   NR3 — native upload keys            GATE AUD1-7 prerequisite (offline only)
WORKS  CityJSON upload keys pass unchanged source-id/hash/size/reader/selection guards.
SEE IT `PYTHONPATH=services/geo python -B services/geo/tests/test_cityjson_processing_pins.py`
INPUTS Real D1 CityJSON; difficult real ASCII_R12 DXF and local-CRS CityGML via existing saved projections.
GAPS   Shapely absent: pin guards isolated, not a full processor run; image rebuild and live rehearsal required.

## Design and pins

Only `cityjson_processing.py:KEY` changes in production, matching point/raster's exact two-namespace expression.
The new Python test compiles the actual guards before storage, without mocking Shapely or claiming transport proof.
`cityjson.ts:cityjsonReaderSha()` already hashes both Python files dynamically, so no TS literal pin needs updating.
`reader-pins.test.ts` verifies parity with the actual Python hash function and rejection of the previous job pin.
Hashes, inputs, setup failures and check counts are in [result.json](result.json); historical pins stay immutable.

DXF and CityGML need no changes: source admission checks exact upload keys/receipts, their bounded fetch accepts
both original namespaces, and processors verify bytes/hash before passing owned local paths to Python.
No additional key-path blocker was found. The two configured-host execution tests remain skipped.

## Checks and next

Backend typecheck passes; focused TS tests: 40 pass, zero skipped; native authority tests: 10 pass, two skipped.
Python: four isolated pin tests and six actual native reader/oracle tests pass. The regression failed before the fix.
Dependencies were installed from the offline cache only; no lockfile changes. No Docker, push or live writes.

**The processor image must be rebuilt before this runs.** Deploy matching TS and Python bytes together with CSV2.
An authorized runtime owner must then rehearse actual upload → enrol → accepted worker → reload/replay, checking
unchanged originals. Existing jobs retain their old pins and may be stale; do not silently rewrite those jobs.
The existing D1 API envelope still lacks the batch probe's root type; use an actual standalone CityJSON upload.
