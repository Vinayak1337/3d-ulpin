TASK   K2b — Honest claims, officer decision and OCR diagnosis            GATE GF-BACKEND / GF-GOVERN (backend)
WORKS  See agent claims as candidates and record checked-page officer decisions without losing alternatives/history.
SEE IT curl http://127.0.0.1:3194/api/v1/buildings/6f95d04e-2067-4ac8-a3c2-6cc21ea46325/canonical
INPUTS Bihar Magnolia's source-only layout (good); Tower 3's same-page G+41/G+42 conflict and oversized scan (difficult).
GAPS   No truth-supported conflict selection; OCR retry still failed with no lines; Hindi execution unqualified.

DESIGN `SourceBuildingImportSchema` now requires claim transcription attribution. `sourceBuildingClaims` stores
       agent transcriptions as ai_extraction/unresolved; canonical claims project as candidates with page citations.
       `canonical-conflict-decisions.ts` reuses registry/physical history and original authority; its one officer
       command pins the canonical digest, citation and idempotency key. The projection retains decision history.

- Existing routes were inspected first: [route review](route-review.md). Preparation correction/decision routes
  reject committed packages; document-proposal decisions explicitly do not adopt canonical facts. No post-commit
  provenance correction fits. Stored Tower claims stay unchanged, while their legacy projection fails closed to
  candidate. Magnolia has no stored storey claims. No destructive re-import or invented replacement was performed.
- D2 truth does not settle the conflict. The demo action is **unresolved, needs source**, with local operator,
  checked-page reason and timestamp: [before](tower3-before.json), [decision](officer-decision.json),
  [after](tower3-after.json), [history](revision-history.json). Selection/resolvedConflicts is contract-tested only,
  never claimed executed on Tower. An officer-selected label still cannot manufacture a count or level schedule.
- First live decision exposed omitted non-null package lineage. The transaction rolled back; one corrected
  bounded run succeeded and retained the prior revision. Its regression and [recovery](decision-recovery.md) remain.
- [OCR diagnosis](ocr-diagnosis.md) retained the actual native exception outside Git. Missing libcurl caused
  STATUS_DLL_NOT_FOUND. A new isolated native dependency prefix fixes the language probe without changing the
  retained environment. Official Hindi commit/hash/Apache-2.0 and unchanged English copy are
  [recorded](tessdata-acquisition.json). Only the explicitly authorised non-secret OCR paths were updated,
  with a new private backup. Doctor reports eng+hin **assets**; the accepted runner still requests English.
- The single post-repair API region retry completed with OCR_SUPERVISOR_FAILED and **no text lines**:
  [result](ocr-result.json). Its subsequent cause is unknown; no extra OCR execution/retry occurred after it.
  Whole-page bounds, original bytes, pinned model/executable, CPU/Job supervision and deadlines were not weakened.
- [Runtime](runtime-final.json): only owned API/dispatcher restarted; final backend code is served from this
  worktree, left running. Containers/volumes preserved. No `.env` or credentials accessed directly, no protected
  A1/A2, database or Studio changes, no merge/rebase/push. Base remains the assigned K2 integration commit.

COMMITS f5450b90 fix(claims): retain agent transcription provenance as candidates
        59519809 feat(officer): append checked-page canonical conflict decisions
        6e65bc95 fix(officer): preserve package lineage in appended physical revisions
        377ce638 fix(demo): diagnose missing Tesseract DLL and configure isolated OCR assets
        da77a9d2 fix(canonical): keep single-claim methods honest and pin decision replay headers
        b37a4e5f test(officer): match published decision contracts and document claim provenance
        Final checkpoint: runtime verifier, result JSON and this report.

CHECKS pnpm typecheck:backend — 0
       Focused conflict/admission/canonical tests + tests/manual-ingestion.test.ts — 0
       python docs/evidence/gf-backend/k2b/check-lf-export.py (unchanged scripts/api/check.py) — 0
       pnpm exec tsx docs/evidence/gf-backend/k2b/verify-canonical.ts — 0
       pnpm platform:doctor --profile demo — 0
       git diff --check; new-code line lengths and Python syntax — 0
       Direct OCR diagnostics and API OCR worker — 1 (honest failures, not passing extraction checks)
       Exact commands, counts, source/worker pins and runtime details: [result.json](result.json).

NEXT   Lead reviews/integrates and refreshes pins against any newer staging producer changes; no full gate pass.
       Runner/bridge owner must retain sanitized failed candidate/exception detail under existing bounds before
       another OCR comparison. Add software/language acquisitions to the unowned catalogue if required. A future
       source-only correction contract must append provenance corrections; current stored history is preserved.
