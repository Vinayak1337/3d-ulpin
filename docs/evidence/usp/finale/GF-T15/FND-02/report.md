# FND-02 · P3 identity and lifecycle

## Assignment and result

- Assignment `FND-02`, attempt 1, callback `ulpin-FND-02-attempt-1`; worker `01a0d5d3-c8dd-7472-8ea4-4decef30f0c7` on `local`, `Codex/gpt-6-sol/xhigh` as verified from this turn's session context. Branch `agent/FND-02-project-identity` started from exact local `staging@b2d2cc657c96f994e8b367762e1fd8f3f10c68c8` after a successful remote fetch; the remote `origin/staging` was older and was not used as the base.
- Implementation tested at `87568510183d4be50a85fcc8dc1e2e17cc71ad8d`. This evidence commit follows it. No push, merge, deployment, linked-environment migration, provider call, data purge or credential edit occurred.
- **Ready for independent review.** The local code, build and disposable database checks passed. The full GF-T15 release gate remains subject to a different-model-family or human review and subsequent UI/history/exchange work.

## Implemented seam

The pure `P3/1` contract accepts canonical or unseparated codes after ASCII-space trim and ASCII uppercasing, rejects malformed/unknown symbols, computes the project-defined mod-1021 check, and distinguishes valid syntax from an issued record. The server generator draws 100 cryptographic random bits. The four fixed vectors and exhaustive single-symbol and adjacent unequal checked-body swap cases pass. The code is a proposed application identifier, never an official parcel ULPIN or rights assertion.

An additive `usp_identity_001` migration installs namespace-unique, permanent code reservations, reviewed identity state, review pins, audit and directed lineage tables. A database trigger prevents deleting, transferring, rewriting or reviving a reservation. The canonical `registry_records` UUID remains the record identity; code/status/location are projected into USP snapshots and target resolution. Existing registry reads and the D0/D1 runtime remain compatible.

The guarded local-operator commands prepare an exact reviewed action and then assign, correct, cancel, retire, split, merge or adjust a boundary. They lock the recording and namespace seams, lock record UUIDs in sorted order, validate snapshot/review/version/source pins, and use the existing command idempotency, outbox and snapshot machinery. Code collision retries use a savepoint in the same transaction. Each accepted command advances canonical record revisions and commits audit, post-state snapshot, event and receipt together. A tested injected fault between insertion and receipt leaves neither code nor receipt. Cancelled and retired codes remain reserved and resolvable. The resolver rejects a location line with HTTP 422 `locator_not_an_identifier` and returns status-aware old code/legacy identifier records with successors rather than redirecting them.

The location line is derived from reviewed parcel associations and locator parts at read time. It is never accepted as an identifier. Authored cases show `NO-ANCHOR` for absent/unreviewed supply, a reviewed primary parcel, `MULTI(2)` for two reviewed associations, and a two-level `F07-F08` space while the project code stays fixed. `boundary_adjustment` requires a valid transferred polygon, evidence and two continuing records, preserving both codes and advancing both revisions; an unsupported 1→1 split returns 422.

## Executed evidence

| Check | Exit | Result |
| --- | ---: | --- |
| `pnpm exec tsx --test tests/usp-project-identity-code.test.ts` | 0 | Four focused codec/location tests pass. |
| `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-*.test.ts` | 0 | 111 passed, 0 failed/skipped. |
| `pnpm typecheck` | 0 | TypeScript passed during implementation; production build repeated TypeScript successfully at final code commit. |
| `pnpm build` | 0 | Production build passed; the existing GeoTIFF web-worker warning persists. |
| `git diff --check` | 0 | No whitespace errors. |
| `node scripts/usp/local-isolation.mjs --run` | 0 | 20 commands exited 0, including migration/replay, retained source checks, D0/D1 browser flows, GF-T15 and owned-service cleanup. |

The final disposable run used Compose scope `local-5dbc133456f1c728` and authored identity site `8012962f-73a1-47ff-9557-e9287daab239`. Its original synthetic source bytes have SHA-256 `783719ada119a459da27816e97ae23db2741462575b664109b65b23bf17db4de`. Two concurrent writers attempting the same record produced one accepted code and one 409. Replaying the accepted request returned its exact receipt; changed payload, stale manifest and stale version each returned 409 without a reservation. A forced unique-index collision retried to a new valid code. The fault between insert and receipt rolled back both, and the unchanged request then succeeded.

Split and merge assigned fresh successor UUID/code pairs and retired old reservations; the old code and legacy identifier stayed resolvable. Cancellation and terminal retirement left tombstones; direct SQL delete and revival attempts were rejected by the trigger. The final isolated state had 3 assigned, 1 cancelled-error and 4 retired codes. All 13 accepted identity receipts matched 13 audit rows. Representative receipt IDs: `cdfd7e19-9ad1-48c6-ac43-21caafebf4b8`, `703aba5d-17db-4571-adf1-ccd63b387d3a`, `865c57c4-ff70-411e-b427-18ab0ba3a2db`. The full bounded check list, command exits and raw-receipt hashes are in [run-summary.json](run-summary.json).

The first isolated run at `0c81d704b30fa312635e49f006f031da0b9926e5` exposed an evidence-array SQL encoding error in split lineage; the runner failed and cleaned its owned services. `3b1a8ca5612d793bad2c9cd8f5774f15d5f89ed4` fixed the encoding. A complete second run passed. The final run at `87568510183d4be50a85fcc8dc1e2e17cc71ad8d` added unreviewed/primary anchor and SQL tombstone protection cases and passed again.

Fresh active-product screenshots from the final D0/D1 browser run were visually inspected: [D0 unit selection](d0-unit-desktop.png) and [D1 source roof](d1-roof-desktop.png). They establish that the retained map flows still render at this code commit; they do not show a P3 UI, official issuance or an interior cadastre.

## Qualification boundary

These are authored synthetic transaction and compatibility tests. They establish local code behavior and isolated Postgres/S3/HTTP integration, not real-source identity accuracy, ownership, formal standards conformance, public resolver authorization, QR/release behavior, UI identity presentation, historical comparison, exchange round-trip, GPU scale or deployment. The next GF1 review should inspect the exact review capability and evidence model, code/status projection for downstream consumers, and how HISTORY/UI/PACK bind to the retained resolver. Do not mark the whole finale release gate passed from this receipt.
