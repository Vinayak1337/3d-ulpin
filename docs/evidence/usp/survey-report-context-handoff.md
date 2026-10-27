# SURVEY-CONTEXT-01 — literal LP360 report inspection

4 October 2026. Code commit `b31c5c272f28a1c149592cfccd6e5dc24559e967`, branch `task/desktop-survey-report-context`, exclusive worktree `C:/Users/kvina/.codex/worktrees/desktop-plan-extraction/3d-ulpin`, pinned base `a99994ee2907caae507247962d5fe0636afcea3e`. Staging was read only; observed integration head `5f40673771189e5e65c076333d25398a604caf8d`. Prior source branch remains `task/desktop-survey-control-source@d31a0178b86f6d606e7d2e340b63c5d43a12c688`.

Current turn supplies `approval_policy=never` / `sandbox_mode=danger-full-access`. Assignment requests GPT-6.1 Sol/xhigh/default-standard. Actual turn model/effort/tier are unexposed; no speed override is claimed or requested.

## Delivered leaves and integration

- `packages/contracts/src/survey-report.ts`: strict exact-document request, typed source rows/statistics, quoted statements, provenance and qualification/gap response.
- `packages/server/src/modules/usp/ingestion/survey-report-parser.ts`: literal 19-field LP360 table profile, recognized by source title, four-component version, field vocabulary and section/axis structure. No filename, hash or sample-value recognition.
- `packages/server/src/modules/usp/ingestion/survey-report.ts`: current canonical authority captures around bounded result I/O; final full input/accepted-fence/result-reference recapture before disclosure.
- `apps/api/src/modules/evidence/survey-report.controller.ts`: private `POST /api/v1/usp/evidence/survey-report/context`, operation ID `POST_api_v1_usp_evidence_survey_report_context`, existing private guard/filter/local context, `private, no-store` and bounded strict JSON.
- `tests/survey-report-context.test.ts` and `tests/survey-report-controller.test.ts`: real imperfect sources, controlled transport/SQL envelopes, and portless controller metadata/body checks.

Lead owns registration: import `SurveyReportController` and `SurveyReportService` into EvidenceModule's controller/provider lists, export the new contract through the root contracts index, add the operation manifest entry, then regenerate OpenAPI/client/catalogue outputs. These shared files were not edited. The route is not claimed enrolled or served by the production application yet.

Request shape is `{document:{caseId,caseRevision,sourceId,sourceRevision,sourceSha256,jobId,resultSha256}}`; it accepts no caller table, frame, correspondence, URL or inferred labels. Response distinguishes `observedRows`, `parsedRows`, `parsedEnabledRows`, `parsedDisabledRows` and cited `unparsedRows`.

## Bounds and authority adaptation

Limits: 4 KiB request, existing 4 MiB document result, 128 KiB accepted native text, 200 observed table lines and at most 1 MiB response with 4 KiB reserved for its envelope. A 15-second absolute service deadline covers authority captures, HEAD/GET and projection; the body has its own existing 5-second deadline. Over-limit content refuses rather than truncates.

The existing `associationDocumentInputTx` is the transaction primitive underlying `associationDocumentInput`; the leaf reuses it inside deadline-aware short canonical case/source/job/attempt locks. No storage I/O occurs under these locks. The accepted AssetRef contains no byte count, so a temporary bounded HEAD reads only the canonical content-addressed result key and GET pins that ETag. The temporary metadata client is closed on every path.

Direct `readDocumentResult` buffers without a byte/deadline cap before its integrity check and exposes no cancellation/read injection. To meet the bounded-read requirement without editing the excluded shared reader/recipe, this leaf reuses existing `readFusionResult`'s document adapter and `readFusionObject`/`openObjectStream`. Those reuse the same DocumentResult schema/key, exact input fingerprint, source/part text hashes and complete native-unit continuity/count/hash checks, with bounded bytes/JSON allocation and cancellable transport. This is an explicit implementation adaptation, not a claim that an uncancellable timer bounds the original reader.

The parser supports one complete ordered native TEXT part per source line. Other formats, OCR/archive/model modes, multiline/segmented lines, repeated/ambiguous headers and changed table vocabularies refuse. Missing table header/terminator, missing/duplicate/out-of-order rows, redacted rows, incomplete summaries/statistics and native warnings prevent a completeness claim. Lost fields/rows are never reconstructed. Character spans are UTF-16, part-local and end-exclusive over the accepted, already redacted part; the original native part/source/unit hashes and line locators accompany them.

## Real-source outcome and concrete reader limitation

Reuse [the retained source manifest](survey-control-source/manifest.json) and [source limitations/attribution](survey-control-source/README.md). These unchanged Zenodo research-deposit parents remain Cape May, New Jersey, USA, in their separate foreign `test_only` family; this is not Indian operational evidence or D1 correspondence. No discovery or acquisition was repeated.

| Report | Original bytes / SHA-256 | Observed lines | Typed rows | Unparsed lines | Original data line range | Checked citations |
|---|---|---:|---:|---:|---|---:|
| PID | 6,458 / `6a185639d8775640a5103136f536b345bc886560a5baef0ef19a5d529740aff2` | 17 | 11 | 6 | 83–99 (header 82) | 357 |
| NVA | 44,314 / `dfcd0e1fa9030dcdd0b8d9990cf257fe1e8154e73dbd1ff23d1f39c6747e8a0e` | 166 | 105 | 61 | 338–503 (header 337) | 2,294 |

**Observed limitation:** the unchanged canonical personal-field redactor matches some coordinate digit sequences across Control X/Y (and PID Measured X/Y), producing fragments such as `503428.[redacted phone].801`. All 6 affected PID and 61 affected NVA lines remain exact cited accepted-text quotes in `unparsedRows`. Both reports therefore return `table.status=incomplete`, `state=needs_input`, and extraction/population gaps. Complete typed inspection of all 17/166 rows requires a separately scoped, privacy-preserving reader/redaction correction. This task did not bypass the redactor, restore coordinates from originals, mutate historical results or assert a complete table.

Both original `Turned Off` NVA rows (`gs_240`, ordinal 164; `gs_241`, ordinal 165) survive intact among the 105 typed rows. The other 103 typed NVA rows are enabled; the published vertical-measured 164 remains a distinct quoted source count whose full population is unverified. NVA horizontal-measured 0, `-----` unavailable fields, numeric `0.000` stated zeros, signed values, published withholding `166 of 166`, and all 15 source statistic rows remain literal. PID preserves signed `-0.000` and withholding `0 of 17`. Reported rounded residuals are not recomputed from rounded coordinates. Response sizes were PID 120,169 bytes and NVA 708,479 bytes.

Control coordinates, reported control errors, offsets, product measured/surface coordinates and reported residuals have distinct field roles and retain original vocabulary/unit-axis references. Header unit statements remain quoted. Source disclaimers/component-role statements/withholding remain separate from `learningSplit=not_assessed`. Missing working CRS, height linkage, survey epoch and object correspondence each remain actionable `needs_input`; Generated Time is not collection date. No transform, qualified comparison/application accuracy, native-point-control manufacture, registry/geometry write or learning label is produced.

## Actual verification and receipts

From the assigned worktree, with the technical local operator subject and retained report fixture root:

- `./node_modules/.bin/tsx.cmd --tsconfig apps/api/tsconfig.json --test tests/survey-report-context.test.ts tests/survey-report-controller.test.ts` — exit **0**, **6 passed**, **0 skipped**.
- `pnpm.cmd typecheck:backend` — exit **0** for server and API.
- `git diff --cached --check` — exit **0**.

The PID service flow uses the real native helper with an injected pure UTF-8 line callback matching `area.py`'s TEXT route; its existing redactor and unit/part hash/locator code still run. Controlled S3 HEAD/stream and authority captures exercise the production bounded adapter and service with one object read/two authority captures. A separate controlled read-only SQL capture checks the wrapper wiring. Deletion/redaction/header/terminator omissions stay incomplete; repeated headers refuse. Source denial precedes I/O, changed input/access/fence after I/O prevents disclosure, oversized metadata prevents GET, and truncated bytes fail integrity. Controller checks use a portless temporary Nest module and direct bounded-body invocation. These are code/controlled integration checks, **not** live enrollment, accepted-job history or an API runtime gate.

Initial real-source expectations failed because the canonical redactor masked the coordinates; the final expectations explicitly prove incomplete retention. Initial tsc optional-line narrowing and controller `reflect-metadata` resolution failures were corrected. No generic parser, dependency, migration, shared source reader, frontend, model/provider/GPU/native-process/Docker or learning work was added.

Private evidence root: `E:/BhuAayam-data/task-data/desktop-survey-report-context-20261004`:

- `receipt.json`: 4,696 bytes, SHA-256 `3b0b96c8a02b28324d6df7f18ae7a76ff7a25191b0e06348de0ce7e2236a337c`; actual command exits, code physical/Git blob pins, original hashes, permission/model observability and corrections.
- `controlled-service-receipt.json`: 1,086 bytes, SHA-256 `93d1d0244c4cb202110463de658451682f367e243ad6f797281a6a2c580f9c01`.
- `controlled-service-receipt.json.nva.json`: 2,210 bytes, SHA-256 `98103513c288d90158dc641db718e1009c908ac171602e86e85ee4cf3ad4d1cd`.
- `focused-tests.log`: 905 bytes, SHA-256 `87980abf5ef6adc5cecb8e20ba6df995d3191c3fbc23dc9c39b59d07f4863655`.
- `backend-typecheck.log`: 471 bytes, SHA-256 `5b77bcdf12aecf90d6c1e142a39a2d9f6db0bdf660a19b4403d500d0c557d5e1`.

Observed unchanged reader recipe SHA-256: `b6c4edba37018a5aa0d190b75b51b904c3f2998531b25a82f069353ad25834f0`. Both TXT originals, ZIP (36,256 bytes / `54ec53234550ca102ca37be5a2e4e0fc130ebe23c04b20c826913f12bb6f0480`) and deposit JSON (22,031 bytes / `966599043ea2799b3415a80537acb1e17ae504d57a53685a84f163a8c18c5ab3`) were rehashed unchanged. Originals and prior receipts remain in place. All test/typecheck processes exited; no listener, container, enrolled job, source/registry/native-history mutation, push or deployment occurred. Completion callback goes once to the standing user-authorized lead `01a0ed8a-4383-79c3-a0ae-35c1e969ef66`; no polls or schedules.
