# DOC-INGEST-01 — original-first document intake

Candidate for lead review on `task/document-ingestion`, based on accepted head `352ce6a30cab9d97c37c2d080ba3219ff01bd5cc`. Implementation commit: `db985b95fdd785a2531589ba425dac44df976e92`; final privacy and harness correction: `16cc71aa24e1508d4fa92e83107bfcdbe6805e6d`. Assigned Sol/max, DEFAULT tier; observed model/effort/tier unavailable. No delegation, Fast request, usage monitoring, push or deployment.

The former reference-document adapter parsed before retention and required a package for officer proposals. The new backend stores unchanged bytes and a durable receipt before queuing extraction, without a package/entity prerequisite. It reuses private original storage, source/case records, operations, canonical jobs, dispatcher, fenced USP attempts, outbox and the existing model gateway. No SQL migration, frontend, renderer, plan/catalogue or serving3188 change.

## Contract and boundaries

- `POST /api/v1/ingestion/cases/{caseId}/documents`: multipart original plus request key/current case revision; optional existing-family revision and `native_only`/`propose` mode.
- `GET /api/v1/ingestion/cases/{caseId}/sources/{sourceId}/documents/jobs/{jobId}`: current-pin status, native stage, separate model stage and 25-part pages.
- `POST /api/v1/ingestion/cases/{caseId}/sources/{sourceId}/documents/retry`: explicit current case/source revision and original SHA pins. Same-key concurrent retries reuse one job.
- Existing private original download remains `/api/v1/sources/{sourceId}/file`. Historical synchronous receipt replay remains compatible; new legacy-adapter receipts add a job ID.

Byte/container identification selects existing bounded native PDF, UTF-8 text, generic CSV-reference and DOCX readers. Admission is 16 MiB; native readers remain 10 MiB/250,000 characters, PDF 100 pages, DOCX bounded ZIP/XML/body/direct cells. Native parts are at most 4,096 characters; derivative objects at most 4 MiB; source job history 32. PNG/JPEG require unavailable OCR; JSON/GIS stays with its separate authority. Unknown format, encrypted PDF, unreadable/bounded archive and tool failures remain explicit. No invented placeholder text, entity association or geometry.

Native source/hash/locator citations survive independently of provider availability. The proposal stage accepts only literal quoted string fields/values from selected redacted native parts, bounded to 12 parts/12,000 characters and the gateway byte budget. One bounded repair, no tools/code execution, approvals or fact publication. `ULPIN_DOCUMENT_MODEL_LAYOUT_CAP` must be explicitly configured, 0–100; a case lock reserves each distinct original/reader under access/provider-policy pins atomically. No qualified familiar-layout recipe exists, so every distinct original counts as unfamiliar. Existing gateway financial reservations remain authoritative; no prices, balances or allowances were invented.

Final privacy patch keeps staged text solely in the fenced result object, hides staged parts/private job markers from generic source inspection and excludes staged text from package parts. Historical parts remain compatible. Native-only jobs do not depend on unrelated provider configuration. Source/access/archive, original integrity, case/reader/model-policy drift and stale publication checks remain enforced.

## Actual verification and limits

See [sanitized evidence](document-ingestion-runtime.json). One fresh guarded `local-nest` nonce `b59ef011e66e0f1b`, API3191: four cases, five retained sources, seven jobs; zero model calls, registry records or physical features. All original hashes/downloads remained exact:

| Retained official original | SHA-256 | Observed result |
| --- | --- | --- |
| NYC OTI native metadata, 12,973 bytes | `520c8ef5bb687ea75945db749f061febd075965f2ca338945b6a392dd62afd27` | Native line parts; provider disabled; replay/dedup/retry; bounded second page |
| USGS Central City CO 1910 PDF, 9,344,939 bytes | `fc554d896f7620149f0c540ad996efc6f0ff26405d8ab77ee7ed1169aaccadcf` | Actual scanned map: `needs_ocr`, no fabricated text; exact original download |
| NYC single footprint, 1,763 bytes | `6a0035cd7abe0f96da0fb7c9fc61067fd63c1894675e13e234173643e143ffda` | Unsupported document format, retained original; stale result hidden after distinct source receipt |
| NYC area crop, 41,792 bytes | `869c5dc4fb50d71be4f62f4a2936c29bd95ade14c712bdf4f51986841d82771a` | Unsupported document format, exact retained original; distinct-layout cap control |

Issuer URLs, acquisition dates, original bytes and terms are unchanged in the existing source check and NYC manifests; evidence records exact references. These remain foreign `test_only` sources. No cadastral/rights, measurement, field accuracy, OCR, Indian operational or learning qualification.

`pnpm typecheck:backend` passed for implementation and final privacy code. Six MVT read checks and five native-intake/event checks passed. API journeys covered provider-disabled native output, original availability during unsupported/tool-error extraction, concurrent retry, incorrect pins, cross-site/source scope, stale masking and restoring the native tool without editing an input. Source ownership/archive controls and ControlAdapter quotation/unquoted/foreign-part/tool rejection passed. Six concurrent layout reservations yielded one record; another actual retained original was denied at cap one. These are protocol controls, not live-model extraction accuracy or financial-policy qualification.

The initial API harness exited 1 only when the auxiliary root script could not resolve `@ulpin/contracts/usp`, after all five API journeys passed. A supplemental explicit-path control invocation exited 0 on the same nonce/records. The permanent harness import and scanned-PDF expectation are corrected. Immutable failed and supplemental receipts are preserved, not rewritten.

**Runtime proof is pinned to `db985b9`.** The final privacy patch was made after shutdown and has backend type-check plus passing pure source/package projection controls; it has not received another runtime acceptance. Do not treat this handoff as an end-to-end runtime gate for `16cc71a` or as a release gate.

## MVT compatibility and cleanup

Only `packages/server/src/modules/usp/jobs.ts` and `packages/server/src/modules/usp/tiles/compiler.ts` changed among the 19 `mvtCodeSha` inputs. Lead approved document job enrollment and immutable complete/committed-prefix reads from exact pre-document code `3d060fda17b9cd542c4c8c2ffb29ad5fafb6cd28e34053235885ce13b3275656`, with valid stored/current self-hashes and every remaining compiler field including PostGIS equal. Old `7ba0d…`/`c36c3…` complete-only behavior is unchanged. Compile/publication/recovery retain current exact pins; no stored artifact/pin rewrite. Current MVT SHA is `d581ad446fa799c1ca9123721df7bc95db0b80192f4188006bcfde717ad03b61`; native reader SHA is `f910f7f6a076a5f0018d228fda02f5d383326beee827b7716f52ded0049af7db`.

Private combined receipt: `.runtime/run01/b59ef011e66e0f1b/document-ingestion-evidence.json`, SHA `d943618dd7a1ced6914b54acccea47d009e1a0dd0ea1eb0abfb8132dae1f11ce`. Shutdown exit0; owned API/dispatcher groups empty, no containers, all three named volumes preserved. No other processes, populated environments or originals reset.

Live proposals require an explicitly authorized call and approved existing gateway configuration/key, task/consumer permission, real pricing/funding/budget policy, task layout cap and applicable source/egress permission. Nothing was enabled or called. The lead owns generated OpenAPI, source-index/catalogue and plan reconciliation. Paused sufficiency WIP `f030aa0` is not an ancestor and must not be integrated.
