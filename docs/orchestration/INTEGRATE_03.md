# INTEGRATE-03 — accepted large-plan OCR integration

2 October 2026. User-authorized Astra integration assignment from lead `01a0ed8a-4383-79c3-a0ae-35c1e969ef66`. Requested Astra/xhigh/default-standard; actual model/effort/per-turn tier is unexposed and no speed change is claimed. Supplied current-turn permissions are verified as `approval_policy=never`, `sandbox_mode=danger-full-access`.

## Ownership and pinned scope

- Clean staging base: `7cf2e535944bf1ff61b6c3df9909eff6cb8c1d3c`, `E:/Projects/3d-ulpin`. Sole delegated staging/publication writer is this integration task until its authorized completion callback; lead pauses staging writes.
- Preparation: `C:/Users/kvina/.codex/worktrees/desktop-integration-20261002/3d-ulpin`, new `task/desktop-ocr-integration-20261002` from that base. Preserve previous `task/desktop-integration-20261002` at `2d1f3da6a878c5ce091524e8bdf8751ac32af8f1`.
- Accept only code `17b414bb936fedaff2bf21ad072c76f6e6e8f2a5`, handoff `9806a3c8aa3a87422bdf7507460dc5b8e7358ac3`, and independent report `875ae6b9798090175bc644b1cd92583a6b2e82a3`. Prior `80514149` is patch-equivalent to integrated `be0544d` and must not be duplicated. [Review scope](OCR_LARGE_PLAN_01_REVIEW.md) and [result](../evidence/usp/large-plan-ocr-handoff.md) define code/local-observation acceptance.
- Lead inspected the delta, matched owner receipts/25 physical pins and the saved crop, and accepted the report with no actionable finding; reviewer reconciliation is 7,147 bytes, SHA-256 `21f5dcde6ef1d42f33c1d8d7e57549eb98add299aceb8c0063048d6ae9c088db`.
- FUSION-02 `509c983` / `5440fb1` remains independently under review and unintegrated. Its fusion files are read-only/excluded. No branch/worktree cleanup, main merge, push, deployment, Docker/socket/DB, provider/model/labels or new worker/polling is assigned.

## Acceptance and return

Review the combined accepted delta; run the two affected TypeScript OCR bounds/sparse-compatibility controls and backend typecheck. Reuse completed Python, original, crop/affine and OCR evidence without another render/OCR/source/runtime campaign. Publish OpenAPI/client and compare exact previous operations/schemas: only intended nested OCR source-frame bounds may change, with whole-page/crop runtime refinements preserved. Keep historical reader/source/result pins and strict stale-input fences; no compatibility bypass.

Update this concise integration return, current ledger/status/source index and an existing catalogue capability pointer only where appropriate; create no dataset or canonical job. Recheck original staging branch/HEAD/index/worktree before transferring only exact prepared commits. Return exact final SHA, commit mapping, actual checks and limitations through the authorized callback to the lead, release staging ownership and stop.

## Accepted FUSION-02 amendment — 2 October

During integration the lead accepted FUSION-02 code `509c983d96c2480e572fcc48211e4c490a8bf965`, handoff `5440fb1d90dd2b5445cd44435b45a5640bffc415`, and independent review `f23926c9a9a7bc39c70c0eec4679567c76898991` with no actionable finding. This supersedes the pending/excluded wording above. Integrate these after the accepted crop code, preserve both source branches, and publish once for the combined change. The lead matched completion physical/Git pins and reviewer receipt/reconciliation SHA-256 `cbd6b1bbd1a3904360be11dc5ce72b7bbc8cdafc42d74694a6267cf87a517b50` / `0a45c8f0bed1842479b8e81032f4c8b65499cfcaf80b2be8f68703c63b6b19e3`.

Verify the imported OCR status/frame refinement survives fusion projection using the existing in-memory technical fixture; no Haryana candidate may be fabricated into a canonical accepted job. Preserve strict explicit ordinals, source/selection/config/result pins and ordinary native/CityJSON behavior. Reuse saved proofs: raw USGS OCR `DocumentResult` bytes are unavailable, so its evidence is saved-field projection only, not reconstructed result bytes or current authority. Expected API remains 217 operations, with intentional nested frame-bound changes and an additive fusion OCR variant. Sole staging ownership and all no-runtime/no-model/source-integrity boundaries remain unchanged.

## Integration return

Accepted implementation and publication head: **`e559d0b7e85673c6f1a8f635549d4c543b763c6d`**, from the clean pinned staging base above. The final documentation commit's SHA is returned in the callback. All seven prepared commits were transferred with `git cherry-pick --ff` after exact branch/HEAD/index/worktree/parent-chain guards. The prior integration branch, both implementation branches and original review branches remain preserved; no other worktree was written.

| Accepted original | Integrated commit |
| --- | --- |
| `17b414bb936fedaff2bf21ad072c76f6e6e8f2a5` | `4575b58bfd43baea67f82b187d4d3dbeb3c34069` |
| `9806a3c8aa3a87422bdf7507460dc5b8e7358ac3` | `143bfe2c1f834fae57286bc400f5f6b8a3adedff` |
| `875ae6b9798090175bc644b1cd92583a6b2e82a3` | `85d6e826b210a5df2b7f6125690af4318dbabc88` |
| `509c983d96c2480e572fcc48211e4c490a8bf965` | `16d1c82f3df00b89e7ddbb6781c38aed8f7fe528` |
| `5440fb1d90dd2b5445cd44435b45a5640bffc415` | `60a7346458502c6744fc078566a643b9ab14435d` |
| `f23926c9a9a7bc39c70c0eec4679567c76898991` | `8d3c149db22e2636022a700e4e9c57e10a2d834d` |

The publication commit updates explicit OCR-ordinal access wording, the generated API/client, and one local-evidence pointer on the existing RERA crosswalk catalogue entry. No source identity/count, installation/relationship status, original manifest or historical qualification changes. Its one new in-memory composition regression reuses the generic technical fixture (6,000 × 8,000-point source), validating the bounded crop through the canonical document result, fusion projection and imported status-summary refinement. Invalid whole-page/oversized/outside/over-limit-frame metadata fails both result and response schemas. No real Haryana observation is represented as an accepted job.

Actual checks, all final exit **0**:

- `pnpm exec tsx --test --test-name-pattern 'large OCR source frames|sparse OCR cites' tests/document-ocr-boundary.test.ts`: two controls. These passed before the unrelated fusion addition and were not repeated.
- `pnpm exec tsx --test --test-name-pattern 'OCR|strict selection|literal own JSON keys|heterogeneous ordering' tests/source-fusion.test.ts`: eight controls including the combined-frame regression, exact explicit selections, ordinary native/CityJSON behavior, literal keys, partial/gap states and final config-drift denial.
- `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/modules/evidence/source-fusion.controller.test.ts`: one production-module/no-listener control.
- `pnpm typecheck:backend`: server/API; final combined code passed. The earlier crop-only pass was superseded only because the accepted fusion code changed dependencies.
- `python scripts/api/build-dataset-catalog.py`; OpenAPI generation with `REPO_DATA=false pnpm --filter @ulpin/api exec tsx --tsconfig tsconfig.json scripts/openapi.ts`; `pnpm --filter @ulpin/api-client generate` and `typecheck`: all pass. Existing locked installation reused; no dependency/lockfile change.
- Exact JSON comparison against dispatch: all 217 operation identities preserved, 216 complete operation objects unchanged, fusion operation summary only changed. All 249 schema names preserved; **246 schemas identical**. Fusion request `/sources/items/oneOf/2` and response `/data/sources/items/anyOf/2` gain only `document_ocr`; document-status OCR `sourcePageFrame.width/height.maximum` changes from 2000 to 14400. All former native/CityJSON alternatives are identical. Runtime conditional whole-page/crop refinements remain enforced and are explained in the API guide; source-frame maximum alone is not whole-page permission.
- Catalogue source/generated comparison: only the existing crosswalk `localExtractionEvidence` field is added. Catalogue `--check`, final staging `python scripts/api/check.py`, OpenAPI generator `--check`, handoff validator and whitespace/owned-path checks pass. No listener/domain operation was opened.

Evidence reused: five owner large-plan receipts and all 25 source/code/artifact/prior-receipt pins matched; the independent 7,147-byte review receipt matched. FUSION owner completion/projection receipts and both reviewer receipts matched; its 39 referenced physical pins represent 30 distinct paths, all matched. The accepted ordinary saved context remains SHA-256 `92bfe44612eecbfdb000bc8b3cd7e6a8b25a56d023827967b7be2613c968e8b0`. Native/crop/affine/OCR observations, historical source pins and previous campaigns were reused, not rerun.

The unchanged 19-file `documentReaderSha()` aggregate changes at Git-byte scope from `83066d9fd6217a515633ba7503380ecb0defcfb398764a951d45ce5231efe489` to `71649369061f7d2312cd7fe93741f36a858a1777fe3a0ad9431aa8804f44acc6`. Current integrated staging physical digest is `0514f71b05cac8142261886a39729404611ef9714feba400ce14a73986338e59`; physical and Git representations remain distinct. Reader construction/current-input fencing, the OCR bridge and supervisor are unchanged. Old artifacts may be producer-stale under the existing authority; no digest, saved receipt or stale-job bypass was rewritten.

**Limits and next work:** the Haryana result is one local caption with `textCompleteness=unverified` and missing OSD data disclosed. Whole-page metadata still reports unsupported for that large source. FUSION's actual USGS proof is saved-status/payload projection; raw OCR result bytes are unavailable, and nothing reconstructs or freshly verifies them. Current HTTP/SQL/object-service authority, persistence, full transcription, approved drawing revision, canonical relationships, learning and release gates remain unqualified. Once the separately owned Docker/runtime blocker is resolved, use exact current source/job/config/reader inputs for the bounded canonical journey; do not promote the local caption directly or bypass stale historical artifacts. No new source/model/renderer campaign is assigned here. The completion callback releases sole staging ownership back to the lead and ends this task.
