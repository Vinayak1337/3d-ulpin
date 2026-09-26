# Native Nest official-source runtime receipt

[Phase 2B receipt](phase-2b-2026-09-26.json), 26 September 2026. Served code: `5d80dd869c62dfed1bf39c2594cd1e080c9045fb`. Fresh nonce: `5060b8f6ecb57f0d`. Frozen install, independent backend typecheck/build, five-service startup and same-database migration repeat passed.

## Observed source journeys

- **USGS PDF:** unchanged 9,344,939-byte historical Central City sheet, SHA-256 `fc554d896f7620149f0c540ad996efc6f0ff26405d8ab77ee7ed1169aaccadcf`, with the [accepted permission/source receipt](../official-runtime-source/source-check.json). Case `44bec875-2fd2-4347-9dc9-bc0b203d5c4c` uses its actual title. Source `113aea54-0a8b-497f-b2ca-3f20dcb5fb5a` queued inspect job `3270eac3-2144-4b33-8ff2-e54192374624`. Stopping the owned processor produced a persisted failure. After restart, retry job `0d149fc3-1c89-4380-8d22-6588f163fcae` succeeded for the same source/fingerprint. The persisted inspection reports one page, 1191 × 1495 first-page points, `needs_input` and calibration required, with no extracted geometry, units or model. Same-key replay returned the same source and the same two job IDs.
- **NYC GIS:** unchanged 1,763-byte original, SHA-256 `6a0035cd7abe0f96da0fb7c9fc61067fd63c1894675e13e234173643e143ffda`. Synchronous import retained distinct source `baf472da-1938-4259-a6b5-d2f29b9aa8c8`; the package/area read binds candidate `1c418cae-df23-42e2-bd5c-63ad3e413141` to native `doitt_id=353927` and that source revision. Geometry role remains `unknown`. This journey claims no queued document job.

Both journeys preserved downloaded original bytes, hashes and sizes. MIME, private cache policy, original filename disposition and `nosniff` passed; remote-origin reads returned 403 `ORIGIN_DENIED`. All three new event actors match actual OS process subject `local-os:501:vinayak`; this is process provenance, not human authentication. API and dispatcher logs contained none of the generated credentials, and the model directory remained empty.

The loopback OpenAPI and dataset catalogue returned 200 and matched committed JSON: 132 operations, eight retained packs and two retained official test-source manifests.

## Shutdown and qualification

Owned stop exited 0. Both recorded process groups were empty, no nonce-labelled containers remained and all six loopback ports were free. The nonce's PostgreSQL, MinIO and Redis named volumes remain preserved. No reset, reseed, snapshot replacement or provider/model call was performed. Private logs and run receipts remain under `.runtime/run01/5060b8f6ecb57f0d/`.

The PDF check exercised the queued Python parser; the separate PDF.js rendering helper was not exercised. Both inputs remain foreign `test_only`. This receipt establishes only the observed local transport, canonical job/recovery, persistence and original-integrity behavior. Indian operational suitability, geometry/rights accuracy, ML, scale, frontend behavior, populated migration, deployment and release gates remain unqualified.
