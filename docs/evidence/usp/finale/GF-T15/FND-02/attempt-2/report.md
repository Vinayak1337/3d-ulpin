# FND-02 attempt 2 · reviewed identity corrections

## Provenance and result

- Assignment `FND-02`, callback `ulpin-FND-02-attempt-2`, worker `01a0d5d3-c8dd-7472-8ea4-4decef30f0c7` on `local`, `Codex/gpt-6-sol/xhigh` (verified session setting). Original accepted base: `b2d2cc657c96f994e8b367762e1fd8f3f10c68c8`.
- Attempt-1 result `716fde1577231f210002a6ad4458bb75e57ee197` and its evidence remain intact. The requested plan refresh `604ab6521e75618fe57dd284bfaa84b97a133dbf` was merged without reset or rebase as `6c8fc8d83203c666ed106be7ed59fc2230e1ea63`. Updated H30/H99 are planning context; this bounded FND assignment makes no UI edits.
- Corrected code tested at `d68a9f6416c09c2afd65c4febb1f0115592b4fbd`. The evidence commit follows it. **Ready for independent review**, not integrated or qualified as a whole release gate.

## Six review findings resolved

| Finding | Correction | Executed evidence |
| --- | --- | --- |
| R1 · parallel receipt | The shared `UspCommitReceiptSchema` now registers a strict `project_identity` variant alongside the existing registry proposal variant. Identity receipts use canonical `TargetPin` before/after arrays; after pins are read from persisted registry rows. The identity variant records its real review ID and outcome codes without inventing a proposal ID. The post-state snapshot retains the submitted target selection with updated persisted pins. | Direct, stored SQL and HTTP-replayed assignment receipts parse the shared schema and are equal. A target-scoped correction returns a target-scoped manifest with the actual new revision. Existing USP contract tests pass. |
| R2 · live resolver behind old scope | Capture freezes project code/status/location, historical aliases and split/merge successor IDs in the registry snapshot body. Resolution uses only the exact captured body, validates both body SHA-256 and manifest body reference, enforces target selection, and filters successors to authorized captured members. An unavailable old state returns an explicit 409. Boundary events are excluded from identity successors. | Pre-assignment, pre-correction, pre-split, pre-cancel and pre-retirement scopes retain their historical state after later writes; a target-only scope hides other records/successors. A deliberately altered captured body fails hash verification with 409. |
| R3 · replay authorization | Replay still uses the saved command hash and receipt, but validates the original manifest against the current access-view and policy before return; officer capability is checked first. It does not require the old data revision to remain current. | Same-input replay works after subsequent data revisions. Changed access view/policy rejects replay; removed operator role rejects it. Stored/HTTP receipts remain identical. |
| R4 · boundary recipient and lineage semantics | Both boundary participants must have `assigned` status before revision/audit/outbox writes. Boundary edges stay temporal events and are excluded from successor projection and identity DAG cycle rules, allowing an independently reviewed reverse adjustment. | Unassigned, retired and cancelled recipients each return 409 with unchanged participant versions, audit count and outbox count. Forward and reverse adjustments retain both codes; neither endpoint appears as an identity successor. |
| R5 · shared successor location | Split and merge reviews carry an exact successor-UUID-to-location map. Missing, extra and source-mismatched entries fail. A split requires distinct derived successor locations. | The two authored split successors resolve to `NO-ANCHOR / S01 / F07 / R101` and `NO-ANCHOR / S01 / F08 / R102`; the new merge successor resolves to `NO-ANCHOR / S02 / F09 / R009`. Old codes remain retired/resolvable. |
| R6 · parcel provenance | Each parcel association preserves the literal supplied value, role, exact source revision and locator, explicit issuer/validity knowledge states, and review state. Aggregate anchor state is checked against every assertion, so `reviewed_complete` cannot conceal an unreviewed member. Parcel source pins must match reviewed evidence and the exact manifest revision; source evidence remains separate from the official assertion. | A literal with surrounding spaces round-trips unchanged; issuer/validity `unknown` remain explicit; missing metadata, mixed complete state, stale source revision and mismatched assertion source fail. `NO-ANCHOR`, reviewed primary and `MULTI(2)` remain separate from the immutable code. |

## Checks and receipts

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-*.test.ts` | 0 | 111 passed, 0 failed/skipped. |
| `pnpm typecheck` | 0 | Final explicit typecheck passed. Two intermediate runs exited 2 on an edit-time missing `)` and optional location narrowing; both were corrected before the tested commit. |
| `pnpm build` | 0 | Production build and its TypeScript pass succeeded; the existing GeoTIFF web-worker warning remains. |
| `git diff --check` | 0 | No whitespace errors. |
| `node scripts/usp/local-isolation.mjs --run` | 0 | Guarded disposable run passed 20/20 commands, including repeat migration, retained D0/D1 browser checks, expanded GF-T15 and owned-service cleanup. |

The final runner scope was `local-bda2fe4db6e103b7`; the authored identity site was `c34c47cf-7ab1-4cd1-92ac-4664e4cb6d75`. The authored source SHA-256 was `783719ada119a459da27816e97ae23db2741462575b664109b65b23bf17db4de`. The suite retained the earlier two-writer, unique-index retry, stale pin, injected rollback and tombstone checks. It finished with 3 assigned, 1 cancelled-error and 4 retired codes, and **14 accepted receipts matching 14 audit rows**. Representative receipt IDs are `bf33b95f-42cc-4889-838b-2363e9993f26`, `54068362-3ffe-4bf7-8272-e66e1c5b3673`, and `a838ed6f-d267-459a-b126-3318ee4749a0`. [run-summary.json](run-summary.json) pins all command exits, case names, raw receipt hashes and screenshot hashes.

Fresh browser screenshots from this tested code were visually inspected: [D0 unit selection](d0-unit-desktop.png) and [D1 source roof](d1-roof-desktop.png). They show retained product rendering and its source/unknown-interior labels; they do not demonstrate a P3 UI mount. [artifact-manifest.json](artifact-manifest.json) hashes this report, summary, screenshots and corrected source files.

## Qualification boundary

The transaction cases use an authored synthetic site and parcel labels in a disposable Postgres/S3/HTTP environment. They qualify the corrected local identity implementation and retained D0/D1 compatibility, not official issuance, real-source identity accuracy, rights, public access, QR/release behavior, UI, HISTORY, exchange round-trip, GPU scale or deployment. GF0/GF1/GF-T15 as whole gates remain pending their other owners' work and a different-model-family or human milestone review. No public service was activated, and no linked environment, populated volume, credential or historical receipt was modified.
