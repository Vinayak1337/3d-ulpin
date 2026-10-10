# K2c bounded failures and decisions

## GeoTIFF footprint draft

- First API draft request returned redacted 503 `SERVICE_UNAVAILABLE`; request ID `8fbc5050-115b-46ef-9a85-5e77c663fce5`.
- No draft receipt or physical feature was committed; the command transaction rolled back.
- Bounded read-only replay of the new projection SELECT diagnosed PostgreSQL `42725`, `operator is not unique: - unknown`.
- Cause: unary negation of untyped origin parameters in `ST_Translate`, not a geometry/data/revision defect.
- Repair: explicit integer CRS and double-precision origin casts. Regression verifies the typed SQL.
- After the SQL fix, the same request reached the existing area normalizer and returned 422 `AREA_PROCESSING`: it admitted only WGS84 UTM, while the retained imagery area's explicit display reference is EPSG:6933.
- The established area normalizer now admits this one additional explicit WGS84 equal-area metre CRS. Existing area-of-use, extent, source transform and geometry checks remain; the independent SQL analytical-qualification gate is unchanged. No arbitrary projected/local CRS was allowed.
- A new owned demo-only processor image carries that seam repair. Earlier overlays/images and originals are retained.
- Recovery uses only the exact saved request/key; no inference retry, changed crop, replacement originals or DB correction.
- Read-only diagnostic setup initially lacked an absolute transaction deadline/profile configuration. The retained helper uses the existing `readDemo()` reader and an explicit read-only deadline; credentials are never printed.

## OCR

- One region-only Tower page-1 API retry: `521741ce-3527-4049-a0c9-43b13a6188f5`.
- Job completed, observation failed `OCR_SUPERVISOR_FAILED`, no text lines.
- Bridge retained allowlisted `KeyError` with fixed message `Worker exception; sensitive detail withheld` and attempt ID.
- No exception paths, document text, arbitrary key/message or traceback is exposed or committed.
- No whole-page OCR, crop sweep or further OCR execution. Existing render/time/memory/log bounds are unchanged.
- Next: runner/adapter owner diagnoses the internal key under private bounds before authorising another comparison.
