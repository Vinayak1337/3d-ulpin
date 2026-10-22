TASK   EVF1 — bounded kept-original reads            GATE GF5 / REH10
WORKS  Evidence reads a small batch original and quotes its row; a failed read now shows its state and reason.
SEE IT pnpm exec tsx --tsconfig apps/api/tsconfig.json --test \
       packages/server/src/modules/usp/ingestion/intake-evidence-worker.test.ts
INPUTS NYC LPC register: unchanged first-two-record prefix, and the full register with duplicate BINs (test_only).
GAPS   No live rehearsal; service.ts is another owner's path; one unrelated baseline migration test fails.

DESIGN
- `storage.ts::readRetainedOriginal` reuses the existing native `openObjectStream`, with a caller's memory limit,
  byte checks before copying, streaming SHA-256, timeout and stream cleanup. `readObject` stays unchanged.
- Evidence, learning, document extraction/download and registry table-row reads use it, each under its existing
  reader limit. The complete changed/unchanged call-site inventory is in `result.json`.
- `readIntakeEvidence` joins only the job currently named by a source's coverage, returning optional failure
  state/code/safe words without changing counts, job persistence or confirmation pins. No database migration.
- The contract lacked a words field and Studio built its count sentence locally: optional `coverage.failure`,
  generated OpenAPI/client types and a minimal `coverageWords` append were necessary. No layout or CSS change.

CHECKS
Both typechecks pass. Focused regressions: 31 pass; Studio evidence/confirmation: 17 pass. Catalogue check passes.
Full intake/evidence run: 339 pass, one unrelated failure, no skips. Exact commands/exit codes: `result.json`.
`tests/intake-migration.test.ts:19` assumes the ledger immediately follows streamed-profile. Baseline G16 adds
streaming capacity between them. Those files are unchanged. One bounded no-DB comparison captures indices
25/26/27 and exactly one ledger call; `check-migration.ts` reproduces it. No repeated failing-suite retry.

NEXT
The lead should coordinate `ingestion/service.ts::validate` with its owner, correct the stale migration-test
expectation separately, and rerun REH10 on a runtime after integration. No Docker, live writes, provider call,
original change or push occurred here. The runtime card gate is not claimed passed.
