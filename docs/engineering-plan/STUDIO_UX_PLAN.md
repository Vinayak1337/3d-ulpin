# Studio officer workflow — SIH 26011

20 September 2026. User-authorized replacement of redundant interfaces and simplification of Studio. This supersedes the earlier instruction to keep duplicate presentation screens. Preserve all processing capabilities, identities, original bytes, revisions and historical URL resolution. Current implementation branch: `feat/visual-ml-completion`.

## Intended officer journey

1. Open Studio: find a saved block/property, resume a workspace, or add survey/plan files. Demonstrations are explicitly separate from real datasets.
2. Add files: detect supported type, native CRS/layer/columns, page count and document title; reuse selected block/property. Ask only for missing or ambiguous information. Show detected values with evidence and an edit option.
3. Prepare: read structured schedule facts and offer local document/spatial assistance where available. Show the next unresolved action. Keep manual drawing and advanced geometry tools available as secondary actions.
4. Review: inspect proposed boundaries and source-linked facts, resolve conflicts and missing levels/placement. Reuse valid saved calibration tied to the same source and frame; never invent coordinates, elevations or rights.
5. Check and record: show actual computed findings and a concise change summary; explicitly record the reviewed proposal. Reload continues from persisted state.
6. Inspect/export: select a property, floor or unit, inspect its evidence and history, export the selected scope with canonical identity.

## Audit findings and evidence

Read-only code inventory covered every `app/**/page.tsx`. Browser inspection used the running local production app at 1280 × 720: default Studio scene, block directory, Import a block, workspace directory, and the persisted T061 case's Measure and Build details modes. T060/T061 captures remain baseline artifacts; this audit makes no new acceptance claim.

| Priority | Finding | Effect | Task |
|---|---|---|---|
| P0 | `/studio` opens an authored 62-building sample while saved Lake View has 22 features; both appear under one product identity | Officer cannot distinguish the starting workflow and actual saved records | T063 |
| P0 | Old officer routes render a second live UI; other aliases terminate there | Duplicate navigation and inconsistent state | T063 |
| P0 | Import requires CRS defaulting to EPSG:4326 even when native metadata supplies another CRS | Avoidable projected-file failure and misleading configuration | T064 |
| P1 | Import exposes format, namespace, stable-ID column, feature type, geometry meaning and destination before inspecting a file | Technical form longer than viewport; wrong defaults and unnecessary work | T064 |
| P1 | Three upload interfaces accept different profiles and assignment cannot handle everything advertised | Upload dead ends | T064/T066 |
| P1 | Preparation displays source-part selector, two assistance systems, facts, placement and build together in narrow right panel | Primary action is below fold; officer must understand internal pipeline | T065 |
| P1 | Persisted successful model cannot continue to review after refresh because `builtRevision` starts null | Repeated build / lost progress perception | T065 |
| P1 | Overhead building extraction is guarded by existing building/preparation selection | Cannot discover a new building from a source naturally | T066 |
| P1 | Layer list, property list, selected record, labels, findings, minimap and duplicate scene controls are expanded together | Map is visually crowded with competing actions | T067 |
| P2 | Directories show disabled location controls, research links and many undifferentiated verification/demo entries; workspace list has no useful search/status grouping | Slow retrieval; appearance of unfinished app | T063 |
| P2 | Source facts expose hashes/raw JSON line locators, generic Selected states, technical model configuration and redundant per-value dialogs | Excessive reading and clicks | T065/T066 |
| P2 | Repeated page headings, large cards and inconsistent date wording | Density without hierarchy | T063/T067 |

Source anchors: `features/studio/routing.ts`, Studio catchall page, `lib/legacy-url.ts`, `features/studio/product/urls.ts`, `officer/block/{DataTools,ImportForm}.tsx`, `officer/workspace/{BuildPanel,useWorkspace,AssignDialog}.tsx`, `components/PreparationBuild.tsx`, `officer/workspace/ml/SpatialExtractionPanel.tsx`, `lib/server/{area-routes,officer-preparation,areas}.ts`, `services/geo/geo/{native_gis,native_schedule,inspection,area}.py`.

## Safe automatic work

| Detect/reuse automatically | Ask officer only when needed |
|---|---|
| Validated file/container type and editable filename-derived title | Unsupported file, ambiguous format/layer |
| Declared native CRS, fields, sole layer | Missing or conflicting CRS; never guess projected coordinates |
| Candidate ID/name column after uniqueness/completeness checks | Multiple plausible IDs; geometry meaning/feature role cannot be proven |
| Selected canonical property/block and existing source association | Ambiguous property association |
| PDF pages, image size, source locator and immutable hash | Which pages to process when multiple relevant pages |
| Strict schedule CSV facts and unit conversion already parsed by native_schedule | Conflicting facts, missing elevations/benchmark or unsupported claims |
| Valid persisted placement/calibration for exact source/raster and frame | New calibration or unsupported location |
| Eligible model from source task, saved job/review state | Explicit candidate selection and technical recording |

Document text extraction exists; arbitrary document-field interpretation is not yet reliably automatic. Show assisted suggestions with source locators, never silently claim ownership, parcel authority, ground level, dates or floor count. Local ML remains reviewed assistance. No paid fallback.

## Routes and deletion contract

All ordinary entry points resolve to Studio. Fixture routes remain explicitly labelled examples, not the default saved-record workflow. Preserve canonical UUID and fixture identifier separation.

- `/blocks[/id]`, `/register`, `/properties/:id/{register,workspace}`, `/workspace[/case][/geometry]`, `/register/{sites,records}/:id`, `/delhi`: replace duplicate page implementations with Studio redirects.
- `/`, `/areas`, `/registry`, `/sites`, `/workbench`, property aliases, `/legacy/**`, `/v2/**`: keep thin resolvers; terminate directly in Studio, preserving query/context, source/page, floor/unit, ambiguity and malformed-route behavior.
- Keep `features/officer` capabilities until fully integrated: GIS conflicts/rebase/checks, source acquisition/attribution, canonical and retained register history/corrections/rights, scoped exports/inquiries, calibration/measurement/trace, facts/ML/placement/build/review and advanced geometry. Folder name alone is not evidence of obsolete code.
- `/map-lab`: engineering-only, absent from officer navigation.
- Delete demonstrably unused old presentation/components after dependency and capability verification. Do not delete APIs, originals, source snapshots, records, test data or useful source parsers as UI cleanup.

## Problem-statement coverage

Supported workflow connects GIS parcels/buildings, evidenced vertical spaces, local raster extraction, deterministic spatial checks and identity-aware exports. Present unknown geometry/heights honestly. Rights remain evidenced assertions. Technical identifiers are not official statutory issuance.

Raw GNSS/CORS processing, unrestricted LAS/LAZ/E57 segmentation and full DEM/DSM terrain processing remain the separately deferred input-expansion track (T054 and input support plan). This UX pass must neither advertise unsupported upload success nor mark those capabilities complete. Surface their supported alternatives/requirements without dead navigation buttons.

## Sequential execution

| Task | Bounded output | Gate before next task |
|---|---|---|
| T062 | This audit, capability/deletion map, requirements and task plans | Planning validator; no false implementation claim |
| T063 | Sole Studio route family, useful default start/directory, searchable resumable directories | Route/context regressions, build and browser start/navigation |
| T064 | File-first GIS intake, server metadata inspection and safe defaults | Native projected/multilayer/malformed examples; original preservation; browser upload |
| T065 | Persistent next-action preparation, compact facts/review, resume build | Reload/stale build/record regression; browser source-to-review |
| T066 | Unified document intake and source-led ML with sensible task defaults | New source without fake building; actual inference/review; retry/lineage |
| T067 | Map/register/workspace visual hierarchy and plain-language refinement | Desktop/tablet screenshots, keyboard/focus, canonical scoped actions |
| T068 | Proven-unused UI deletion and integrated officer qualification | Dependency scan, production build, full source-to-record/export journey |

One task may be In progress/Review/Verify at a time. Each implementation gets a fresh Astra 6 High worker with explicit file ownership, written plan and previous result. Parent reviews code and browser evidence before proceeding. Fresh worker contexts provide the requested task reset; the parent conversation is not literally reset. No recursive worker spawning. Keep durable CURRENT_WORK.md updated for compaction/handoff. Record Implemented separately from user acceptance. Do not batch all screens into one change.

Additional browser findings: saved property register at approximately 842 px width retains a blank left rail while compressing the main content, repeats block/property name in breadcrumbs, and moves all global sections behind hamburger. In Build details the rendered persisted T061 case says “Review ready” with 6/6 facts reviewed, but offers only “Build proposed 3D details”; the primary continuation is neither visible nor restored. Evidence selector exposes dozens of raw attribution JSON lines as ordinary choices. Source lists show large thumbnails for every document and repeated Retained labels, reducing useful working area. Address these in T065/T067 without removing source access.
