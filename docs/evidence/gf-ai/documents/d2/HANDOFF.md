TASK   D2 — Part 1: quotes checked before storage            GATE ML-D2 / GF-AI documents
WORKS  Failed quotes are retained in rejected, not the review population; old snapshots still read.
SEE IT pnpm exec tsx --tsconfig apps/api/tsconfig.json --test tests/document-proposals.test.ts
INPUTS A5 Tower 3: 20 kept / 0 refused; one-digit-altered: 19 kept / 1 refused (quote_not_at_locator).
GAPS   Part 2 / AG-D1 pending; offline proof only; API receipt pin check remains blocked.
DESIGN document-proposal-quotes.ts uses the Python normalisation, intersection and number rules.
       document-proposals.ts reads the pinned accepted product before saving, outside insertion locks.
       document-proposals.ts contract adds /2 alongside /1; decision originals retain the check.
COMMITS 8d1c9894 — docs(documents): D2 where page text lives and what a stored proposal snapshot fixes
        c6430f35 — feat(documents): quote checked against cited region before storage
CHECKS pnpm typecheck:backend — 0; pnpm studio:typecheck — 0
       pnpm exec tsc -p scripts/agent/tsconfig.json — 0
       Focused six-file tsx suite — 0, 41 passed, 0 skipped; exact command/files in result.json.
       refresh-contract.ts staging — 0; pnpm studio:api-types — 0; openapi.ts --check — 0
       python -B scripts/api/check.py — 1: API-DOC runtime receipt changed (known owner re-pin blocker).
       git diff --check — 0; handwritten new-file line check — 0
       Known: tests/usp-packet-image-pdf-recovery.test.ts environment failure, owned elsewhere; not run.
NEXT   Resume Part 2 adapter, replay-only caller and decision readback; no half-built adapter left behind.
       Lead regenerates on newer staging (300 operations vs this branch's 298); no operation added.

**Caller fields:** no Studio caller exists today. Accept snapshot `/1 | /2` and
`quotationVerification: locator_checks_recorded`; read `proposal.quotationCheck` outcome/reason/basis,
`rejected.originalProposal`, and optional input `valueLiteral`. Review only the saved proposal population.
Conflicts may reference a refused original proposal; never remove or resolve them automatically.
Decision `originalProposal` can include the check; decision citation itself is still unverified.
`quote_truth` remains unresolved and `learningLabel` remains false.

**Runtime owner, after roll-out:** first obtain a current accepted OCR result and save the public Tower 3
packet with current pins. Set these variables from the actual save response, then run this read (not run here):

```bash
curl --fail --silent \
  "$DEMO_API/api/v1/ingestion/cases/$TOWER3_CASE/sources/$TOWER3_SOURCE/document-proposals/$CHECKED_SNAPSHOT"
```

Look for `/2`, `quote_at_locator`, the product hash and unresolved `quote_truth`. This read creates nothing.
Part 2 must resolve recording kind explicitly and handle uncited facts without invented locators.
The retained A5 packet contains G+42 only; a G+41 software-control citation must come from real retained text,
not from an invented alternative. Full remaining work and all check commands are in `result.json`.
