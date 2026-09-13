# Prototype identifiers and real-data demo verification

Verified on 13 September 2026 against the local production app and persistent
PostGIS, private storage, Redis, Python processor and Celery worker.

## Automated checks

- Three Node tests passed: complete 128-bit UUID encoding, fixed-length parents
  with 10,000 distinct test values and growing child counters, and explicit
  level-label normalization.
- Six integration scenarios passed via `scripts/verify-identities.ts`:
  r1/r2 correction and rebuild stability; floor reassignment without renaming
  a space; repeated prepare/removal/reintroduction; two migration reruns;
  12 concurrent space allocations; and real NYC sample processing with original
  file-hash and independent projected quantity comparisons.
- The existing non-disruptive API suite passed **17/17** checks. Its refreshed
  record is [API_TEST_EVIDENCE.md](API_TEST_EVIDENCE.md).
- TypeScript and production builds passed. Geometry/source snapshots for the
  existing guided walkthrough matched their saved pre-change values exactly.

The first real-data integration attempt correctly rejected an explicitly empty
`levelLabel` in the converter output. The converter now omits that optional field,
leaving the envelope in the existing Unassigned group. The complete six-scenario
integration run then passed; the failed trial case was retained with a clearly
marked verification name. No interior level was invented to bypass validation.

## Browser checks

Playwright CLI verified the existing empty workspace shows its parent code;
the identifier modal closes on Escape and restores focus; the guided case shows
three named levels and seven spaces; copying writes the exact persisted ID;
the downloaded register matches the API; selecting U03 in the tree opens its
inspector with the same permanent space ID; and the dialog fits a 390 × 844
viewport. Desktop and mobile captures were visually inspected.

The NYC model opens with one space and no named interior levels. Its parent
and space ID are visible alongside the actual computed envelope and quantities.
The Sources library exposes original GeoJSON, provenance and converted input
downloads. No external document viewer is involved.

The original GeoJSON downloaded through the UI matched the pinned original
byte for byte. The final production build also passed a visible long-alias
layout check and returned healthy flags for all five backend services.

Tracked captures: [identifier tree](images/prototype-identifiers.png) and
[real-data envelope with identifiers](images/real-data-identifiers.png).

## Prepared examples

- Guided interior hierarchy:
  `http://127.0.0.1:3000/?case=20709958-49c4-4314-9e60-b80e607ef214`.
- Real NYC envelope:
  `http://127.0.0.1:3000/?case=d1d77c93-d979-488d-be1b-792cc81b608c`.
- Real parent: `3DU-6HTXY97PBS926VW6VS5K41PR4C`.
- Real permanent space: `3DU-6HTXY97PBS926VW6VS5K41PR4C:S001`.
- Real footprint: approximately **123.950241 m²**; relative height:
  **10.207752 m**; derived prism volume: approximately **1265.253317 m³**.

Integration output is in ignored `test-results/identities-report.json`;
browser captures and the downloaded register are under ignored
`output/playwright/`. The screenshots document current UI; the source and
identifier guides describe supported behavior and limitations. The full prior
eight-browser workflow suite was not rerun for this change.
