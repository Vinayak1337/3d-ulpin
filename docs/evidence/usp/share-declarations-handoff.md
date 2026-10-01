# RIGHTS-DECL-01 — reviewed declaration ledger

2 October 2026. Code commit `bf0e1a1a2a718bc4d416562bb854b5f3f2d217e5`, based on dispatch `142a7c3f65c36d92359d8c65a923a88737f67fa6`; branch `task/desktop-share-declarations`, worktree `C:/Users/kvina/.codex/worktrees/desktop-citygml/3d-ulpin`. CityGML checkpoint `a4dce87d09988a32cbd0aa81f6d27f6f52fe3ecb` is preserved and was not repeated. Supplied permissions are never/danger-full-access. Requested GPT-6.1 Sol/xhigh/default-standard; actual model/effort/tier were not exposed. No settings were changed.

## Delivered flow

Source-defined input → immutable draft → one immutable explicit review → technical acceptance → new sourced amendment → exact selected-target read. The first profile supports one site, ten declaration identities per site and up to 100 explicitly pinned members/entries per declaration. It uses existing registry identities, USP command receipts, snapshots and outbox. No registry, geometry, job, packet or citation authority was replaced.

Input retains instrument source revision/hash/byte receipt/locator, population status/count/target pins, allocation subject and definition, jurisdiction/statute, stated value/area/other basis, denominator state/definition/quantity, rounding, literal entry labels/shares, positive rational fractions and validity. An explicit `endState` distinguishes an unknown end from a source-stated open end. Unknown validity never makes a packet projection applicable. Original source receipts with explicit locators are supported; extracted part/asset pins, cross-site copied-source lineage and populations over this profile fail explicitly.

Arithmetic uses bounded BigInt rationals (128-digit source integers, 4096-digit intermediate/sum bound). Complete 99.5% is `arithmetic_mismatch`; partial 99.5% is `not_assessed_incomplete_population`. Missing/duplicate/ambiguous members remain findings; ambiguous entries are not double-counted. A caller cannot mark an incomplete/duplicate population complete. Parseable literal percentages must agree with their supplied fractions. Decimal parsing also preserves source units (`450.75 sq ft`, `0.873%`); no mesh/area-derived shares, inferred unit conversion, tolerance adjustment or last-entry normalization is performed.

Reviewer source/population/assessment acknowledgements and the exact statement `Technical acceptance only; not legal approval or source truth.` are required. Reviews are immutable and unique per proposal; revised decisions require another draft. Applicability is an explicit selected-target clause decision. An amendment without reviewed consent evidence stays `not_assessed` downstream. All accepted revisions, entries, reviews and applicability rows remain append-only; predecessor allocations and their source-stated periods are not rewritten.

Acceptance, post-write snapshot, commit link, receipt and outbox use the same PoolClient. Case/lineage locks precede the existing recording mutex; source/registry protections follow it. A per-site declaration fence rejects a waiting REPEATABLE READ transaction whose declaration view predates another acceptance. Serialization/duplicate/deadlock errors return a refresh conflict after rollback. Request-key replay uses the existing receipt authority. Current source existence/site/hash/bytes/active-case/lineage are required even when the legacy document helper returns false; marked sources also retain canonical document/job/input checks, including the final write boundary.

Declaration/entry/applicability membership changes the snapshot digest. The zero-declaration registry snapshot shape/order/digest is preserved. General body reads redact labels, clauses, consent and reviewer reasons. Selected reads return only that entry/applicability and aggregate counts/subtotal, reauthorize all contributing sources and require explicit snapshot target membership. `packetState` is a technical projection, not a generated packet, release or legal approval: it needs reconciled coverage, explicit applicability, current target/path pins and an explicit applicable `validAt`. Retained historical snapshots still read their original revision; an older revision is withheld for dates at/after a later recorded amendment.

## Lead registration and use

Register `DeclarationsController` from `apps/api/src/modules/evidence/declarations.controller.ts` in the evidence module's controllers. It requires no new provider. Lead owns root exports and generated OpenAPI/client/catalogue publication; those files were left untouched. The owned domain module additively exposes declaration schemas through the existing USP contracts export.

All five private, no-store, guarded POST leaves are under `/api/v1/usp/rights/declarations`:

| Leaf | Input / result |
| --- | --- |
| `prepare` | `UspPrepareDeclarationSchema` / proposal ID, version 1 and assessment |
| `proposal` | `UspReadDeclarationProposalSchema` / retained input, assessment, draft/reviewed/accepted state and review ID |
| `review` | `UspReviewDeclarationSchema` / immutable review ID and exact assessment |
| `accept` | `UspCommitDeclarationSchema` / registered declaration commit receipt and post-write snapshot |
| `selected-target` | `UspReadDeclarationSchema` (including nullable explicit `validAt`) / `UspSelectedDeclarationSchema` |

Start with an existing explicitly selected population snapshot; prepare one `create` change at declaration/entry revision 1 with empty applicability pins and required payload. Inspect the proposal, then review with its exact scope/version/manifest and acknowledged assessment. Accept using the returned review ID and identical scope/version. Read using the receipt snapshot. To amend, capture a fresh population snapshot, retain the declaration ID, use the next declaration/entry revision and exact `supersedes`, and review consent/applicability anew. Existing generic prepare/commit dispatch also supports the declaration kind; legacy declaration schemas without executable payload remain readable.

The three additive SQL steps are registered in `database/manifest.json` and `migrateUsp`. `scripts/db/verify_extraction.py` only adds this task to its authored-SQL provenance allowlist; all byte/hash/runtime checks remain. Do not bypass the manifest or apply partial schema manually.

## Verification and limits

All commands ran in the assigned worktree with locked dependencies; dependency manifests/lockfile were unchanged.

- `pnpm install --frozen-lockfile --ignore-scripts` — exit 0, 460 locked packages installed locally.
- `pnpm typecheck:backend` — exit 0 for server and API on the final code.
- `pnpm exec tsx --test tests/usp-declarations.test.ts tests/usp-contract-producers.test.ts` — exit 0, 11/11 checks. The generated technical controls cover exact arithmetic/incomplete/duplicate/one-beneficiary behavior, actual command dispatch and snapshot projections, immutable review/replay, failure after accepted writes with complete rollback/retry, stale source/population/review/fence and archived-case rejection, sibling redaction/selection denial, and retained amendment history/consent withholding. The controlled PoolClient exercises the existing transaction wrapper; it does not emulate PostgreSQL MVCC qualification.
- `python scripts/db/verify_extraction.py` — exit 0: 25 preserved historical files/136 statement hashes, 16 authored files, 40 named migration queries.
- `git diff --cached --check` — exit 0 before code commit.

Focused verification caught and fixed the declaration/declaration_entry locale-ordering conflict without changing zero-declaration ordering. The acceptance fence and unique immutable review prevent the reviewed stale-write cases; actual concurrent PostgreSQL behavior remains unrun.

Source discovery is reused: index Git blob `eed25d8b824eff7d90bb5b778486ccccfd75fb2f`, catalogue blob `9f9474d3ac8e8219595ec0b5ff884506d62504a4` at the dispatch pin. No authentic permitted matched building declaration instrument was found. Public statute text is not a building declaration. There was no acquisition campaign, operational-record fabrication, original alteration, live provider/model/GPU call, Docker/service startup/reset, frontend edit, generated publication, push or deployment.

Real-source accuracy/applicability, unchanged physical instrument bytes, current HTTP/SQL/object persistence, live MVCC/constraint/trigger behavior, performance, packets, legal approval and release gates remain **unqualified**. SQL was not applied under the retained Docker blocker. Technical source hashes in tests are explicitly generated controls, not operational acquisition receipts. No owned processes remain; only ignored worktree dependencies were installed. Staging and other lanes were not edited.

Exact-byte schema SHA-256: `c5693dcc9d2ce2d16b253d6a4a4dc426543e418c90bb5f36b27d3fe3370543fd`; the manifest pins all three SQL files and their statements. Code/source pin is the commit above; no test control is a source qualification.
