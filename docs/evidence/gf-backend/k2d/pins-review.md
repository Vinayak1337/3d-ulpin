# K2d pin review

- `docs/api/datasets.json` adds T1-prep's six Surat official-portal HTML originals: five profiled development
  families and one excluded by native cell limits. Entries retain original URLs/hashes/acquisition, unconfirmed
  reuse permission, `test_only`, no teacher labels or evaluation truth and no runtime installation claim.
- P2 adds 100 unchanged publisher CubiCasa test PNG/SVG pairs for foreign noncommercial diagnostics.
  CC-BY-NC-SA data versus CC-BY-NC model/code, no metric/survey qualification, no training or Indian accuracy
  claim, and unaudited checkpoint-population overlap remain explicit. No holdout originals were read.
- These are catalogue entries, not wire-schema changes. OpenAPI links to the same catalogue endpoint;
  no schema/client regeneration is required.
- Runtime receipt mismatch was isolated to CRLF checkout bytes for `cityjson-validation-runtime.json`,
  `current-runtime-20261003.json`, and `source-evidence-history-20261005.json`. Each recorded hash exactly
  matches the recovered LF bytes. A naive all-LF export can also break historical CRLF-pinned receipts.
  Preserve both existing receipts and recorded pins: the existing K2b normalizer restores only hash-matching
  receipt encodings in each new export. No semantic receipt mutation or runtime requalification is justified.
  Exact mismatches and decisions are in `pins-review.json`; A4/A5 should reuse that export normalizer.
