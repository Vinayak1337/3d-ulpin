# LP2 — the feature's own words by its retained byte range

TASK   LP2 — own words by byte range            GATE GF1
WORKS  Newly imported framed GeoJSON buildings keep exact locators; plans and exact parts read only those bytes.
SEE IT `node docs/evidence/gf1/lp2/check.mjs`
INPUTS NYC retained buildings; Niagara Falls and Halifax authority exports (test_only, bytes only).
GAPS   Large-original source admission and streamed package persistence remain separate prerequisites.

## What is proved

- `source-range.test.ts`: the import writer **calls the unchanged reader**, not a second scanner. Its triples match
  every NYC feature (including the one quarantined geometry), and Niagara's first/last 1,000 features. Normalizer
  indexes remain original array indexes after quarantine; any failed framing/pairing discards all file locators.
- `feature-range.test.ts`: all 1,661 accepted NYC excerpts match whole-file text character for character. Changed,
  shifted, other-feature, truncated, oversized and invalid-UTF-8 controls refuse. Missing locators keep the whole
  assessment unchanged. A two-source plan reads a 500 MiB receipt by range and its second source whole; this is
  a transport fixture, **not** admission of a real large source. Budget boundary controls retain the 64 MiB bound.
- `runtime-final.json`: actual throwaway PostgreSQL, unchanged NYC original, 1,661 recorded exteriors, three
  range plans/packets/cards and three actual baseline whole-path plans/packets/cards, all verified consistent.
  Direct packet and exact-part reads also use ranges. A field-order syntax control imports unchanged real facts
  without ranges. Geometry/measurements remain unavailable; rights remain unassessed.
- `nyc-postgres-equivalence.ts`: baseline code from the task's actual base, evaluated against the **same snapshot**.
  Paired plan/hash, packet, card content and PDF bytes are identical using shared issued protocol metadata and
  seeded PDF entropy. Independently issued whole cards have different IDs/timestamps; those bytes are not claimed
  identical. `fixture-equivalence.json` repeats the paired comparison on two in-memory real-feature fixtures.
- S3 control is CAR's loopback in-memory protocol store, including real HTTP 206 Content-Range responses, not
  MinIO performance qualification. Each runner removes **only its nonce-labelled tmpfs box**; unrelated concurrent
  containers/volumes/networks are irrelevant. No existing volume, original, demo, provider or credential was used.

## Exactly what integrity means

**Whole path:** every assessment reads the file, verifies its byte count and whole SHA-256 against the receipt,
then parses that original. It counts whole source bytes once per source. An observation without a range keeps
this path, its entries and its packet/card words; no backfill was done.

**Range path:** source authority still checks captured/live receipt revision, object key, SHA, byte count,
site/case/access and observation/locator source key. The store must return exactly `[byteStart, byteEnd)` and
report the receipt's total size in Content-Range. The span hash must equal the import-time raw SHA-256. The
import computed that locator from unchanged bytes whose whole hash was verified against the retained receipt
(or computed and retained for a new direct import). **The range path does not rehash the rest of the original**;
it cannot detect an alteration outside the requested span that preserves total size. Exact UTF-8 and one JSON
Feature with one object-valued properties member are required. Shared observed properties and 16,000-character
excerpt checks remain. No entry field/method marks the range path; these are still the source's own words.
Range-only sources count distinct fetched span bytes; a source read whole counts its whole receipt. Identical
spans are cached only within an assessment, and every observation is still checked against those raw bytes.

## Reader inventory / measurements

`step0.json` names all readers. Card projection/verification and detailed registry feature policy never read map
originals, so they need no new reader. Snapshot original download stays whole; packet code calls its existing
linked-evidence authorizer before and after range I/O instead of changing that download API.

`cost-*.json` and `range-cost-*.json` are one fresh-process pure-function sample near each file's end, with equal
excerpts checked separately. Whole → range milliseconds: NYC **11.434 → 0.284**, Niagara **204.913 → 0.289**,
Halifax **868.834 → 0.316**. Peak RSS includes module startup (not extraction-only memory); no statistical or
large-source throughput claim. Final runtime records per-path plan/card times; small-file DB work dominates.

## Rerun

- `node docs/evidence/gf1/lp2/run-runtime.mjs <new-receipt.json>` (new path, pinned local PostGIS image required).
- Isolated preload + `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test` adjacent range tests and named suite.
- Backend typecheck; API regenerate/check/refresh; Python API check; diff check: passed. `result.json` lists commands.

**Integration:** apply the small `area.ts` and `ingestArea` hunks without replacing the concurrent package-review
work. Regenerate source pins after integration. Admit large originals/write the same locator from reader records
in the next task; do not lift any source-profile or byte bound here.
