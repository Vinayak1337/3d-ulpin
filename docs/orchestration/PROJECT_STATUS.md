# Project status — 30 September 2026

Lead snapshot at accepted staging `530774ce5bfb8c466bd55c60a93149db8625533c`, plus the pending BUNDLE-02B candidate and independent assignments in [the continuation scopes](PARALLEL_20260930.md). This is an implementation/evidence status, not a percentage or release pass. GF0–GF5 and all separate full-product gates remain pending in release-plan.json.

## Accepted implementation and bounded evidence

| Area | Completed scope | Important limit |
| --- | --- | --- |
| Backend foundation | Modular NestJS, shared TypeScript contracts/domain services, SQL/PostGIS, private storage, canonical jobs/attempt fencing, Redis/Celery processing and access-checked SSE. Current generated API: 188 operations / 216 schemas. | Later workflow/format/accuracy gates are not implied by endpoint count. |
| Large originals and vector ingestion | Durable resumable original receipt/capacity, source-linked streaming GeoJSON chunks, private committed-prefix output, manual/qualified recipe mapping, streamed profiling, quarantine, bounded NWIC/NYC vector delivery and recovery receipts. | 7 GiB configuration is not a measured arbitrary-format/7 GiB workflow. City/interior scale, true changed-source revisions and global placement remain separately qualified. |
| Documents and tables | Native PDF/text/CSV/DOCX/XLSX extraction with source locators and uncertainty; private PDF region OCR through canonical retry/job/status. | Selected OCR region yielded five cited items; whole-page extraction remained zero/partial. General OCR accuracy, CAD/BIM and arbitrary layouts are not qualified. |
| Other ingestion profiles | Private native raster windows and bounded LAZ point batches; ZIP inventory, source-pinned member byte reader and CityJSON structural reader. | ZIP member API is returned for review; CityJSON reader still needs API admission. These do not establish analytical geometry, ownership or building/floor associations. |
| Officer/registry foundation | Existing identity lifecycle, evidence/packet/readiness/finding authorities; private consolidated registry JSON/PDF and building ledger projection with source/access checks. | Real positive official-ID, floor/space/rights/history qualification and full task-specific officer outcomes remain incomplete. |
| Model work | E5 and Qwen experiments, frozen source-family corpus, independently reviewed scripts/results, saved-output diagnosis and corrected scoped AppContainer audit. | Latest V8 fine-tune failed calibration: null cutoff and zero accepted positives. No model is promoted; document/building/floor association fine-tuning has not begun. Historical training network silence and production enforcement are unqualified. |
| Source evidence | Retained originals/catalogue, independent drawing reviews, completed compact Bihar/Haryana crosswalk review. | Numbered-villa/identifier and exact approved-revision gaps remain; all canonical matches are not_assessed and no relationship labels were created. |
| Studio frontend | React/Vite/TypeScript + Three.js workspace, batches/map/register/evidence/review/card screens and historical build/journey checks recorded by its frontend lane. | This is not a fresh UI verification. Its tracker/routes include local/draft workflows and stale backend requests; complete live wiring/rehearsal remains unfinished. Backend workers do not change frontend code. |

## Current work and owners

| Lane | State/outcome | Requested model |
| --- | --- | --- |
| BUNDLE-02B | Candidate `a15ebc5` returned with final real-source API evidence; original implementation owner stopped. Independent BUNDLE-02B-R review now allocated; lead integration/OpenAPI follow acceptance. | Astra/xhigh reviewer |
| CITYJSON-02 | Newly allocated source → canonical job → private native result/original API, using accepted reader and retained D1 exterior. Sole API/Docker runtime owner. | GPT-6.1 Sol/high |
| AI-06F | Newly allocated one fixed weight-8 → weight-1 experiment under verified restricted execution; prepare/freeze before fitting, stop if isolation or resource bounds fail. Sole learner/GPU owner. | Astra/high |
| PLAN-WIN-01 | Newly allocated repair of observed Windows path/Git-fixture-hash validation failures and stale historical D0 link. No gate weakening. | GPT-6.1 Sol/high |

All continuations use separate existing project worktrees and default/standard speed requested. Tooling cannot attest per-turn service tier; global default is configured. Active/successful execution is verified from callbacks, not inferred from assignment acceptance. Prior source/NET reviews are complete and are not repeated. API processing ownership is exclusive; populated storage is preserved.

## Remaining work to pick up in dependency order

1. Integrate reviewed archive-member and CityJSON API profiles and refresh the generated frontend contract. Extend only demonstrated missing supported-format profiles; broaden whole-page/scanned-plan extraction when a real input requires it.
2. Implement source-cited document association/review against versioned canonical buildings/floors, including multiple floors, later-arriving references and ambiguous/no-match cases. Obtain the specific missing keyed/revision evidence; do not force the reviewed drawings onto unrelated canonical records.
3. Complete GF0/GF1 runtime/contract reconciliation and loss-aware CityJSON geometry exchange. Current exchange still emits empty geometry/vertices and reports its loss; source-native CityJSON intake does not solve canonical export by itself.
4. Complete separately scoped building-mask/plan-segmentation routes, supported vertical delineation, qualified solids/topology/area checks and rights/share/tenure behavior. OCR and field-mapping models do not substitute for these functions.
5. Finish task-specific readiness, sanctioned-versus-observed revision comparison, utility/impact coverage, private property-card/QR proof and the complete source-to-card recovery journey. Preserve unknown rights/depth/geometry instead of manufacturing positive controls.
6. Qualify affected-cell updates, declared size/performance budgets and the supported larger-data path using actual sources. Preserve accepted vector measurements; 3D/interior scale is a separate claim.
7. After ingestion and reviewed association labels are ready, run final building/floor association fine-tuning and untouched evaluation. Online example collection, shadow routing and promotion/rollback need a useful qualified model; the current failed candidate does not unlock them.
8. Frontend owner completes live API wiring and officer journeys, followed by the bounded release rehearsal and owner acceptance. Public portal, conversational/MCP assistance, generative preview, broader renderer/scale and production deployment remain separate full-product workstreams. Formal launch clearance remains deferred; engineering and data/access correctness apply now.

No estimated completion percentage is asserted: the repository contains substantial reusable code, while the end-to-end Identify → Prove → Govern product and its acceptance evidence are still incomplete.
