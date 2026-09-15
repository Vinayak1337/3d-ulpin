# Officer workflow implementation and verification

This implements the handoff on branch `feat/real-block-officer-workflow`, based on fetched `40e4cae1ace9482e423414a07009d729ce55033f`. The original handoff matched current HEAD; there was no newer completed work to overwrite. `AGENTS.md` now states the current scope. Previous plans, identities, sources and dated reports remain preserved.

The implementation is local and single-operator. It has not been merged or publicly deployed. Real-data acceptance remains incomplete: the retained real block is Bronx exterior evidence; the separate officer fixtures are explicitly synthetic software tests. No synthetic geometry was inserted into the real block to manufacture streets, interiors, a utility or a violation.

## Delivered behavior

- A shared Cesium block remains central across **3D Block**, **Property Register** and **Plan Workspace**, reached through the centered floating glass navigator. Selection opens that property's dossier, original sources, detailed floors/units and preparation; the surrounding block and camera remain available. The explorer and technical coverage details collapse. The earlier workbench and registry remain accessible.
- Additive contracts/tables connect physical representations, parcels, detailed records, preparation cases, groups and investigations. Associations retain evidence, participant revisions and review history. Named horizontal placement and vertical references cannot be established by simply renaming a frame. Existing reserved building identities are reused through the existing reviewed registry pipeline.
- Related files produce source-bound native candidates. Typed review resolves conflicting claims; missing information blocks only dependent preparation. One canonical draft generates actual immutable build inputs for the dispatcher/Celery worker. Corrections preserve source revisions and building/floor/space identities. Stale source, placement, association and review snapshots cannot silently publish.
- Exact occupation-minus-confirmed-parcel-union, road/public overlap, contact and unique public-union quantities have independently authored geometry tests. Findings carry all participants, exact transformed overlay geometry, sources, input revisions and limitations.
- Utility profiles preserve centre/invert/crown/depth meanings, units, datum, cross section and source evidence. Supported levels appear in 3D/sections; missing depth remains an unresolved horizontal alignment. Exact physical volume is restricted to compatible constant prisms/rectangular corridor profiles. Circular/sloping profiles do not receive invented exact collision volumes.
- Persisted investigations support evidence requests, responses, review states and revision-bound JSON/CSV/print registers. Print views contain a plan and available source-backed detailed section. Exports omit unnecessary party fields. These are local technical records, not official notices, title certificates or legal orders.
- The server-only Nous adapter checks the authenticated free catalog, bounds requests, grounds proposals in selected source parts, records hashes/usage/results, caches actual responses and rejects stale applies. Missing configuration leaves native preparation working. No live inference result is claimed.

## Executed checks

Runs occurred on the local Apple M3 / 16 GiB machine, Node 26.7.0, pnpm 9.12.0, Next.js production server, PostGIS/MinIO/Redis/private Python/Celery stack. The following are current implementation runs, not relabeled historical reports.

| Command / rehearsal | Actual result |
| --- | --- |
| `pnpm typecheck`; `pnpm build` | Passed; production build includes the new property routes. The existing Cesium client-minification exception is retained. |
| `pnpm exec tsx --test tests/*.test.ts` | 18 passed: scene, identifiers, evidence provenance and registry validation. |
| `pnpm test:ai` | 22 passed. Synthetic grounding/provider-contract tests; not live inference accuracy. |
| `pnpm test:ai-integration` | Ten scoped DB/API checks passed, including actual native PNG crop bytes/hashes, draft-only application, cache and stale protection. Nous transport mocked; zero actual inference runs. |
| `.venv/bin/pytest -o addopts='' -q --tb=short` from `services/geo` | Current full suite: 162 passed in 2.38 seconds, including G01–G07/V01–V04 and native GIS/document adapters. |
| `ULPIN_API_EVIDENCE_FILE=OFFICER_API_EVIDENCE.md pnpm test:api` | 17/17 passed. [Current API report](OFFICER_API_EVIDENCE.md). |
| `pnpm test:registry`; `pnpm test:registry-reimport`; `pnpm test:registry-allocation` | Existing registry, reimport/correction/idempotence/history, concurrent allocation and canonical rings passed. |
| `pnpm test:area` | Passed: actual 62-feature saved source/hash, synthetic scenarios, holes/multiparts, source documents/corrections, retry and vertical unknowns. An obsolete coverage-message assertion was updated to the new explicit datum explanation. |
| `pnpm test:demo` | Both existing synthetic real-processing rehearsals passed: C-001 6.4 → 0 m³; C-002 14.4 → 0 m³. |
| Existing Playwright suite | Eight tests covered: seven initially passed; the remaining calibration viewport defect was corrected and the focused test passed in 26.5 seconds. No claim of one uninterrupted eight-test green run. |
| `pnpm test:officer` | Native CSV → source decisions/placement → actual worker → reviewed same-building records; two independent properties, correction identity retention, duplicate opening, stored derivative hash, stale review rejection, exact 20 m², requests/review/export passed. The final run also passed shared-space deduplication/revision invalidation, lossless single-part MultiPolygon preparation, exact section export and raw-snapshot redaction. |
| `pnpm test:block-membership` | Explicit cross-block membership returns the same utility identity in each block, reprojects XY and evidence-bound profile positions, excludes unrelated overlaps, preserves the owner record, invalidates checks after source change and rejects more than 2,000 context features. Scoped fixtures cleaned. |
| `pnpm test:horizontal-performance` | 150 synthetic features, 50 explicit parcel associations, 750 vertices. Ten local authenticated HTTP checks verified all 50 independently specified 20 m² strips. First request 64.25 ms; nine warm samples p95 50.04 ms. Includes transport/parsing, excludes DB/browser; services already warm. [Machine-readable report](evidence/horizontal-performance.json). |
| `pnpm test:fresh-install` | New isolated volumes/schema/private bucket, additive migration, saved-source import/review/commit, real worker preparation, full isolated restart, same IDs/hash/check and successful cleanup. Reuses installed dependencies/images; not a clean OS test. [Fresh installation report](FRESH_INSTALL_VERIFICATION.md). |

Current production build `qBp7S3GFDeRwiUXAoEQsr` also measured two fully prepared property dossiers: **81.97 ms warm p95**, 20 local HTTP/JSON samples after two warmups ([report](evidence/detailed-dossier-performance.json)). Earlier actual browser selection p95 was 71 ms; the rendered real 62 route was captured in 1,299 ms on a fresh browser context and 1,123 ms on a warm reload (one sample each, services warm). Continuous camera drag measured 59.96 frames/s containing actual GL draws on Apple M3; input-paced sparse wheel frames were separately reported at 19.10/s, not presented as capacity. [Methods and limits](OFFICER_INDEPENDENT_VERIFICATION.md) include host concurrency and exact viewports.

The complete presentation stack, web and dispatcher were stopped, volumes retained, services restarted and additive migrations repeated. The [restart checkpoint](evidence/officer-restart.json) confirmed unchanged 62 real identities, both detailed registers, CLOSED case 63143c47-3e9d-4037-88ad-29f83f5b8db6 and eight then-listed original byte hashes. The browser reopened sources and reran the supported exact 20 m² check. The local web/dispatcher temporarily ran with Node's process-scoped proxy settings routing external HTTP(S) to a closed loopback port while exempting localhost; browser external HTTP(S) was also blocked. Local health/native processing worked, and an actual UI live-source refresh failed with explicit provider-unreachable/saved-snapshot guidance. Missing Nous credentials kept live assistance unavailable. No new request was labeled a saved success. Normal server settings were restored afterward.

Final export inspection then added the previously omitted associated-parcel download link by resolving the finding's immutable source revision ID. The exact existing case and source bytes were preserved; its re-exported JSON/CSV/PDF now includes six supporting originals/derivatives, including `synthetic-parcel.json`. The extended officer regression and actual UI source-link check passed. The readable zoomed plan labels were measured at 12 px through the rendered SVG transform.

The browser proof, measured viewports and actual captures are in [OFFICER_UI_VERIFICATION.md](OFFICER_UI_VERIFICATION.md) and the [independent machine-readable evidence](evidence/officer-independent-ui.json). The controlled workflow uses uploaded native files and actual review/build/record actions; no hidden API publication is counted as a UI step. API/worker tests are identified separately.

## Source and capability boundaries

The retained Bronx area has 62 original observed exteriors. The original SHA-256 remains `869c5dc4fb50d71be4f62f4a2936c29bd95ade14c712bdf4f51986841d82771a`. It lacks matched real parcel/public layers, interiors and utilities. Source roof heights are building-relative, not a surveyed common ground surface.

[SOURCE_ACCESS.md](../demo-data/real-block/SOURCE_ACCESS.md) records the bounded GMDA/DDA/Pune research, actual count requests, reuse terms and exact data-holder request. The [native capability matrix](OFFICER_GEOMETRY_VERIFICATION.md) explicitly distinguishes supported GeoJSON/ArcGIS/GPKG/Shapefile/CSV/document profiles from unsupported interpretations. Single-part, single-ring MultiPolygons unwrap losslessly for detailed prisms; true courtyard/multipart detail conversion is blocked rather than filled or discarded. Original area geometries and exact checks retain holes and parts.

[OFFICER_AI.md](OFFICER_AI.md) records the actual provider integration, limits and missing credential. Public route metadata does not establish authenticated entitlement, quota or model accuracy.

## Remaining acceptance blockers

1. **T01 and real-data portions of T03/T04/T06/T07/O1–O5:** an authorized coherent Indian block with same-place roads, parcel/public boundaries, at least three properties, two genuine building-specific plan/section packages and a real utility source. No permitted complete package was acquired. The exact requests and unsuccessful count probes are preserved; foreign/synthetic substitutes do not pass these criteria.
2. **Surveyed underground acceptance:** actual utility levels/cross section, compatible ground/datum evidence and relevant source-backed basement/foundation geometry. Synthetic supported overlap/contact/separation tests verify the engine only. Circular/sloping exact-solid collision and arbitrary detailed courtyard/multipart conversion remain unsupported profiles.
3. **T08 actual inference:** an authorized local `NOUS_API_KEY`, authenticated free entitlement and at least ten permitted representative pilot document groups. Live field accuracy, locator coverage, local-language performance, geometry error and correction burden are unmeasured. Scanned-plan metric geometry/PDF rasterization and arbitrary CAD/BIM interpretation are not implemented capabilities.

4. **T10 remaining verification limit:** native browser 125% zoom was not executed; the equivalent 1093×614 CSS layout, 1366×768, 1920×1080 and narrow 390×844 layouts passed. A clean-OS installation was not claimed; isolated fresh data/storage installation did pass.

Use [OFFICER_STARTUP.md](OFFICER_STARTUP.md) for startup, existing property IDs, saved-source import, rehearsal and preservation instructions. The [execution ledger](REAL_BLOCK_EXECUTION.md) records task classifications and commits. Local sampled performance targets passed within the documented workloads and methods.
