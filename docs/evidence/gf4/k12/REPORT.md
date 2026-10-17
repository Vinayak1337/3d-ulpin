TASK   K12 — plan entries and card rows before card storage            GATE GF4, GF5
WORKS  Server reads a unit's entry handle and previews current card facts/revision without storing anything.
SEE IT pnpm exec tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/usp/packets/*test.ts
INPUTS Retained Tower 3 UNIT-3B crop; difficult scan has no geometry/quantities; revoked/corrupt protocol controls.
GAPS   Not roll-out ready: required operation-manifest additions are outside owned paths; stored bindings omitted.
DESIGN plan-entries.ts reuses sourceStatementHandle, statementContextTx and PDF plan protection/assessment.
       card-service.ts shares prepareCardFactsTx/nextCardRevisionTx between preview and generate; no projection edit.
       Controllers expose pure no-store POST reads; contracts are additive and preview strips the request key.
COMMITS 09cfd0ca docs(card): K12 what a plan may include and what generate reads before it writes
        33704c08 feat(packets): the entries a plan for a target may include can be read, with their handles
        1f54aa23 feat(card): the rows a card would print can be read before the card exists
        Final commit: docs(card): K12 evidence
CHECKS pnpm typecheck:backend — 0; pnpm studio:typecheck — 0.
       tsx --test new entries/preview files — 0, 3 + 6 passed; existing card tests untouched and passing.
       Combined neighbouring suite (exact prefix/files/counts in result.json) — 0, 95 passed / 3 skipped.
       Initial packet suite — 1: known interpreter pin test (5 passed / 1 failed) and import-order cycle.
       One comparison preloading pdf-service.ts — 0, all 3 image-region tests pass; dependency files unchanged.
       refresh-contract.ts staging — 1; openapi.ts --check — 1: unowned operation-manifest prerequisite.
       pnpm studio:api-types — 0, unchanged old schema only, NOT the two new operations.
       python -B scripts/api/check.py — 1: existing runtime receipt changed; no pin edited.
       git diff --check — 0; new/added lines over 120 — 0; self-review staging...HEAD completed.
NEXT   Lead appends operation-manifest-additions.json to evidence/operation-manifest.json, then regenerates.
       Runtime owner sends the two requests in REQUESTS.md after roll-out; no migration or live run performed.
       Preserve changed-handle behavior: create blocks it, confirm refuses PACKET_PLAN_BLOCKED (not create throw).
