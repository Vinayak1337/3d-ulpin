# FND-04 · Attempt 2 · Review corrections

## Result and identity

Both findings in the [lead review](lead-review.json) are corrected in code and ready for independent review. No runtime or milestone gate is accepted by this receipt.

- Assignment: FND-04, attempt 2; worker task `01a0d5d3-c8dd-7472-8ea4-4decef30f0c7`, host `local`.
- Observed latest session settings: `Codex / gpt-6-astra / high`.
- Original integration base: `1a6baf0d832117932c291fa6bfc08a536d8bd26e`.
- Attempt-2 starting commit: `0d07d3442c3dcf983c23b645100c3bc65a58a976`.
- Code commit: `051584595fabbd1a42480233c7c2f7ea05984ca6`, branch `agent/FND-04-geometry-separation`.
- Evidence/result commit is supplied in the final callback.

The existing isolated worktree was used. Attempt-1 code/evidence history, other owners' work, plans, ledger, AGENTS files and protected originals remain unchanged. No merge, push, linked-environment migration or deployment occurred.

## R1 — Current projection fails closed

`geometryProjection` now converts a formerly qualified annotation into effective `analyticEligible: false` metadata with `qualification.state: unqualified` when current SQL eligibility is false or the qualification revision is unavailable. Its reason is `current_qualification_unavailable`; sufficiency remains explicitly insufficient. It does not mutate the retained annotation or invent a new accepted receipt.

The projection schema rejects contradictions between effective eligibility and sufficiency, and rejects a sufficient projection with no qualification revision. Metadata tests exercise the formerly failing qualified-annotation/false-eligibility case used by source supersession and annotation revocation, both directions of schema inconsistency, and missing revision pins. This is schema/metadata coverage; no real qualification receipt was fabricated to simulate revocation.

## R2 — Every saved participant is checked

The shared `usp/finding-qualification.ts` guard reads only `usp_analytic_geometry` under the existing analytical purpose roles. For every finding it requires:

1. A complete, unique participant set and matching saved input-revision set.
2. Exact participant ID/revision/source-revision agreement between saved body and input pins.
3. A currently qualified view row for that saved revision, with canonical payload equality. Normalized identity envelope fields are checked through the explicit identity/revision match; source and geometry payloads cannot be replaced.
4. Qualified source pins covering the primary and nested source-revision references in that saved participant. The existing SQL predicate checks accepted receipt, canonical body hash and each current source revision/hash, including source supersession.

It never substitutes a newer participant body for a saved one. Missing pins, removed participants, changed payloads, stale revisions, unqualified metadata and incomplete source coverage abstain.

| Consumer | Enforcement |
| --- | --- |
| Investigation creation / retries | Selected check findings pass the shared guard in the mutation transaction; retries return an explicit current projection of retained history. |
| Investigation readiness / review / close | Saved findings pass the same guard before advancement; note-only edits retain saved history and project its current eligibility. |
| Investigation read and dossier investigation list | Unqualified findings are withheld from current `findings`, with `analysisState: not_assessed`; originals remain in explicitly named history with `currentAnalyticalEligibility: false`. |
| Building dossier | Latest relevant findings are assessed using their saved participants, replacing the prior current-neighbour lookup. Missing qualification marks the check unavailable/stale and withholds current issues. |
| Register export, including saved investigations | Every exported finding is assessed. Current findings withheld by dossier projection are still included in export assessment, preventing an empty filtered list from appearing qualified. Saved exports use original saved findings. Printable formats reject unqualified findings; JSON labels and preserves history. |
| Block export | Every latest-check participant is assessed, including neighbours outside context features and child registers. Unqualified current checks are withheld and explicitly retained as history. |

No full RIGHTS/declaration acceptance or qualified runtime processor was added.

## Fresh verification at the exact code commit

All executable tests below ran at `051584595fabbd1a42480233c7c2f7ea05984ca6`; the staged whitespace check preceded that commit. Actual argument vectors, output, times and exit statuses are in [checks.json](checks.json). [verification.json](verification.json) hashes all 20 implementation files changed since the original assignment base and identifies the nine files changed in attempt 2.

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Exit 0 |
| `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-*.test.ts` | 124 passed, 0 failed |
| `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/registry*.test.ts` | 12 passed, 0 failed |
| `pnpm test:register-scope` | 3 passed, 0 failed |
| `node scripts/usp/gf/FND-04-isolated.mjs` | Exit 0; 21 fresh and 24 retained PostgreSQL checks |
| `git diff --cached --check` | Exit 0 before code commit |

The five added metadata tests cover effective revocation, selected-participant-qualified/neighbour-unavailable, removed or stale participants, mismatched or missing saved source/revision pins, all four purpose adapters, role restoration and explicit immutable history. Test tokens are existing schema examples; no operational geometry, finding quantities or source facts were authored.

[Fresh SQL](sql-fresh.json), [retained SQL](sql-retained.json) and [SQL command receipts](sql-run.json) retain the actual database results. Existing role denials (42501), illustrative-write denials (23514), fresh/already-identity-migrated installation and replay still pass. New retained tests call the actual investigation-read, saved-register-export and block-export paths: a retained investigation's four findings are withheld from current output, seven missing participant checks are reported, exact saved findings remain in explicit history, and printable export rejects with 422. The block's unqualified current check is likewise withheld while history remains available.

All **44 protected retained table hashes remain unchanged** after the new read/export checks. The unchanged dump was restored only into fresh nonce-owned PostgreSQL services under the existing isolation guard. Cleanup affected only those owned services/volumes. No web server or unrelated port 3000 was touched.

## Qualification limits

The qualified-building/unqualified-neighbour scenario is metadata-only adapter coverage. The actual retained corpus has no accepted analytical qualification; retained export tests prove abstention and history preservation, not a positive operational finding result. No official-source analytical accuracy qualification is claimed, and no synthetic operational records or positive qualification receipts were inserted.

Attempt-1 limits continue: no enabled real qualifying processor, display generation, asset byte round trip, renderer, provider, GPU, protected multiuser, browser/UI or deployment qualification. SQL purpose roles do not restrain the privileged database administrator. Declaration acceptance remains `not_assessed`.

Independent cross-family or human milestone acceptance remains outstanding. These are bounded worker implementation checks.
