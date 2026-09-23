# Unified Studio UI/UX, real 3D display and integration

Owner **UI**. Baseline `f623cff897f91bb3ebd4c225f700ac263f7beb72`; revised 22 September 2026 after reviewing the revised feature handoffs 10–19 and shared contracts. Read [00](00-README.md), [01](01-shared-contracts-and-ownership.md), this file and the actual enabled producers. ER-02/03/07/11/17/18/23–25 are incorporated. These are implementation/acceptance requirements, not claims that the UI or datasets have been tested in this documentation task.

## 1. Product target and actual integration path

Deliver a polished, usable semantic 3D workbench: neighbourhood → selected building → supplied floor/unit → exact evidence → useful review/report action → reopen saved state. Photographic context is optional. Do not confuse a textured mesh with legal property geometry, or a satellite background with a complete 3D interface.

The active route is [Studio catch-all](../../apps/web/app/studio/%5B%5B...view%5D%5D/page.tsx), using [Shell](../../apps/web/features/officer/shared/Shell.tsx). Active map: [BlockPage](../../apps/web/features/officer/block/BlockPage.tsx) → [SavedSceneViewport](../../apps/web/features/studio/product/SavedSceneViewport.tsx) → [MapViewport](../../apps/web/features/spatial/MapViewport.tsx). Reuse [SpatialDataProvider](../../apps/web/features/spatial/data/Provider.tsx), [map sessions](../../apps/web/features/spatial/data/session.ts), [resource cache](../../apps/web/features/spatial/data/resource-cache.ts) and the appropriate existing renderer/lease path. Improving only [Studio App showcase](../../apps/web/features/studio/App.tsx) is not product integration.

Existing [QuickRecords](../../apps/web/features/studio/product/QuickRecords.tsx) supports floor/unit selection. [RegisterPage](../../apps/web/features/officer/register/RegisterPage.tsx) needs explicit invalid-record handling rather than broadening to a building. ProductHeader's internal search is not appropriate for public pages. Shell's unconditional local-data wording must become capability-aware. These are baseline code observations to reproduce/test, not previously verified live bugs.

## 2. First deliverable and data selection

**V0:** one clean D0 neighbourhood loaded through real services, with 3–5 buildings and ≤30 supplied spaces, active selection, unequal levels/basement, exact evidence and a PACK0 text/CSV packet that survives reload. Do not wait for public authentication, online model learning, every modality or a complete real Indian cadastral dataset. Intentionally conflicting D0 geometry may remain a separate draft test so the clean recorded demonstration is not blocked by correct validation.

**D1 real-geometry gate:** separately load one actual external roof-shaped building through this product's shared viewport, preserve geometry/source identity and show unavailable interiors honestly. Then qualify 25–100 buildings. Passing D0 does not pass D1; D1 exterior success does not qualify apartment records. D2 textured Helsinki context is optional and cannot block V0. D3 Delhi provides location context; D4/D5 provide independent record/drawing tests, not automatic geometry joins. See data runbooks and source URLs in section 9 and 00.

## 3. Information architecture and feature matrix

Keep [Batches / Map / Register](../../apps/web/features/studio/product/urls.ts). No separate dashboard/page per USP. Keep known retained-site/dataset routes and legacy redirects.

| Surface | Route and role |
| --- | --- |
| Batches | `/studio/work`: exact work items/next actions and at most three scope-qualified counts |
| Intake | `/studio/add-files`: durable receipt, recognized/missing stages and focused mapping questions |
| Batch review | `/studio/imports/:importPackageId`: resolve bound INGEST batch; draft map plus exceptions; no interchange of batch/package UUIDs |
| Map | `/studio/areas/:areaId`: shared geometry, classification/revision and selected-property quick register |
| Directories | `/studio/datasets`, `/studio/registry`: actual selectable datasets and exact/ambiguous identities |
| Full register | `/studio/properties/:buildingId/register`: persistent selected unit, full evidence/records/history |
| Preparation | Existing `/studio/properties/:buildingId/workspace` and `/studio/cases/:caseId`: reuse editing/review mechanisms |
| Public, F2 gated | Proposed `/public/properties`, `/public/submissions/:id`: released lookup and own submission only |
| Operator capabilities | Extend existing Shell workspace dialog, not an assumed settings page |

| Producer | Entry / surface | Main action → visible complete result |
| --- | --- | --- |
| [PACK 10](10-scoped-evidence-packets.md) | Selected unit Evidence / same quick/full drawer | Confirm plan → actual scoped artifact; PACK0 and PDF capability distinct; Original archive separate |
| [READY 11](11-evidence-readiness-and-review-queue.md) | Status strip/Batches count | Open exact requirement/selectionToken → same counted target set and working source/request action |
| [FIND 12](12-rights-aware-spatial-findings.md) | Map/register Checks | Exact result/evidence → saved scoped review case; parcel-only works without fake building; optional existing investigation link |
| [CITIZEN 13](13-citizen-evidence-and-corrections.md) | Released finder/own receipt; officer request | Submit/clarify → actual draft receipt → separately recorded outcome, never upload=ownership |
| [INGEST 14](14-adaptive-ingestion-and-progressive-review.md) | Add files / bound import review | Resolve recipe → selectable durable draft manifest → checked coherent review group |
| [HISTORY 15](15-property-history-and-comparison.md) | Unit History | Choose exact manifests → field/source/difference view and actual old evidence |
| [RIGHTS 16](16-shared-spaces-and-vertical-rights.md) | Contextual Relations inside existing unit/shared-space detail | Inspect clause/propose/review → one space, beneficiaries and technical receipt |
| [IMPACT 17](17-infrastructure-impact-screening.md) | Map contextual tool / existing SpatialInquiry | Enter/draw proposed volume → saved affected-space report plus unassessed coverage |
| [ASSIST 18](18-grounded-assistance-and-mcp.md) | Ask about this property/submission | Typed service facts → exact evidence/action; native local F1, remote public separately gated |
| [DEPLOY 19](19-india-contained-deployment.md) | Workspace dialog | Inspect profile/capability → tested/unqualified/disabled reason without secret exposure |

Relations and investigation are contextual drill-downs, not another set of permanent top-level tabs. A finding/packet/history panel replaces the foreground inspector with a clear Back action. Do not stack multiple trays over the map. Preserve addressable old register tab/investigation links.

## 4. Layout, visual language and data honesty

```text
3D ULPIN       Batches  Map  Register       Search        Workspace
Area / supplied scope       Source classification · revision       Add files
┌──────────────────────────────────────────┬─────────────────────────┐
│ 2D/3D  Layers  Fit                        │ Building A       Full ↗ │
│                                          │ First floor / Flat 101  │
│        SHARED INTERACTIVE 3D VIEW         │ Exact ID · draft/rev N  │
│                                          │ Boundary evidence needed│
│ selected space + relevant overlay         │ Summary  Evidence  More │
│                                          │ Linked source / action  │
│ coverage / reference             Checks   │ History / Relations/Ask │
└──────────────────────────────────────────┴─────────────────────────┘
```

Map gets the flexible majority; desktop inspector approximately 360–420 px. Optional layers/property lists open on demand, not a permanent left tree plus right inspector plus another dock. Selected building/floor/unit, classification/stage/revision and action remain visible while detail scrolls. Full register expands long tables/evidence/history; returning preserves camera and selection.

Reuse restrained sage/green tokens and existing [product](../../apps/web/features/studio/product/product.css), [operations](../../apps/web/features/studio/product/operations.css) and [shared UI](../../apps/web/features/officer/shared/ui.css) styles/icons. Normal task text ≥14 px desktop/16 px mobile, essential metadata ≥12 px, readable line-height, 8/12/16/24 spacing and approximately 44 px primary touch targets. Consolidate tokens rather than stacking global overrides or another component library. One accent action per context. Details may be dense; do not replace necessary labels with tiny icons or tooltips.

For D0 architectural quality, use stable materials, controlled exposure/contact shadows, legible silhouettes, selected-space outlines, depth hierarchy and calm background/context. Authored fixtures may contain detailed roofs/terraces/stairs because their source explicitly defines them. Real geometry retains source shapes; no invented facade/floor/road-width detail enters measured facts. Ornament is display-only. Building height unknown is shown as footprint/unavailable height, not a random attractive extrusion. Roof overhangs and recorded ground footprints remain separate roles.

Approximately 900 px collapses optional rails; approximately 620 px uses one full-height sheet. At 390×844 keep the scope header/action visible, form labels readable and search usable without a hidden placeholder. Long IDs wrap/copy. Use local/approved fonts/textures in private mode. No screenshot or satellite image substituted for an interactive 3D scene.

## 5. Two geometry lanes, one shared viewport

### Existing canonical lane

[Compiler](../../apps/web/features/spatial/compiler/compile.ts) already emits 3D Tiles 1.1 and coarse/detail GLBs from its bounded profile. Reuse it for supported canonical exterior geometry and existing selected-space overlays. Respect its one-frame/5 km/2,000-entity/50,000-position/12,000-facade-bay/80 MiB bounds. These are backend ceilings, not client loading targets. Do not claim arbitrary CityJSON/mesh input support by removing a validator.

### External display lane

Add a typed `external_asset` display adapter under the current MapViewport/runtime boundary. UI owns proposed `apps/web/features/usp/shared/{external-scene,scene-manifest-adapter}.ts` and compatible client layer changes. FND owns source/asset persistence and authorized HTTP serving; DATA acquires originals. No new standalone Cesium/R3F app or route-specific Canvas.

First D1 path: parse the full preserved CityJSON/CityJSONFeature sample with its declared metadata/transform, decode scale/translate exactly once, retain building/part hierarchy and semantic IDs, triangulate supported planar surface rings in each face's plane while preserving holes, and produce a display-only mesh with pick identity mapping. Do not flatten roof surfaces into XY footprints. Nonplanar/unsupported surfaces return an explicit adapter limitation; do not silently fill them. Bound one-building input before a wider converter. Use existing triangulation dependency where suitable; FND pins any required codec, never an invented installed library.

Alternatively a separately qualified provider 3D Tiles lane can retain provider geometry/feature metadata through the existing tiles renderer. It must pass actual decoder/metadata/selection tests, not merely load a bounding box. [3DBAG service documentation](https://docs.3dbag.nl/en/delivery/webservices/) distinguishes its API coordinate system from geocentric tile delivery and names required metadata/compression extensions. Read the actual source declarations; do not apply the CityJSON transform a second time to already transformed tiles. Missing meshopt/quantization/metadata support yields explicit unsupported capability until the selected renderer/codec is qualified.

D1 API coordinates with NAP elevations are not automatically ECEF/ellipsoidal. If global transformation resources are unavailable, use an explicitly labelled local engineering display preserving relative roof dimensions; disable unqualified global/measurement joins. Never guess a geoid correction. Full global placement is a separate test. Internal floors remain unavailable unless independently sourced.

D2 textures: preserve mesh/MTL/image dependency paths and licence, resolve only registered bounded local assets, reject remote/path-traversal dependencies. Missing texture uses a neutral material and visible asset limitation, not a blank map. An unsegmented photogrammetry mesh is context, not a set of invented legal units. Analytical volume comes only from qualified canonical representations; display meshes remain non-authoritative.

Both lanes preserve canonical/source identity maps across LoD, hide/show, selection and refresh. One 3D view can combine appropriately placed context and semantic overlays with explicit provenance; never move Dutch/Helsinki geometry onto Delhi coordinates to fake local evidence.

## 6. Durable draft consumption, selection and cache rules

Consume INGEST's `usp-scene-manifest/1` from [14](14-adaptive-ingestion-and-progressive-review.md). The outer rendering manifest ID is distinct from its pinned data SnapshotScope.manifestId; do not hash a manifest into itself or interchange scene/data IDs. Common opaque AssetRef belongs to FND; INGEST owns scene descriptors/manifests; UI consumes them. Each asset supplies actual hash/version, frame/bounds, LoD and pick refs. The recorded-only process cache cannot supply a durable draft by pretending its stage changed.

Fetch consistent batch status+event cursor, replay committed manifest events, and load at most four assets concurrently. Adopt a coherent manifest version; remove/release replaced assets and honor entity removals. Version gaps/expired cursors refresh the complete authoritative manifest. Ready-to-render is not ready-to-record. A failed/denied tile preserves usable remaining context and explicit coverage. Never replay a removed entity from an older late response. SSE unavailable uses the specified polling fallback, not fake streaming timers.

Use 01 SelectionContext states/generation. URL owns restorable feature/record/world/panel and artifact refs; server validates exact area/parent/stage membership. Current `feature` physical ID and `record` registry ID are not interchangeable. No explicitly invalid/retired/unavailable unit request silently broadens PACK, source query or submission to its building. A missing optional parameter differs from an invalid supplied parameter. Reject duplicate/conflicting known parameters, preserve safe legacy URL translation.

Example desired context: `/studio/areas/{areaId}?feature={buildingId}&record={unitId}&world=observed&panel=evidence`. Full register carries the same selection with `record` and `tab=evidence`; artifact IDs resume an exact plan/comparison, not whatever unit is selected now. Intake uses workspace/version before a SnapshotScope exists. Unresolved public submissions remain intake-only.

Advance generation on target/world/stage/access changes; abort or suppress old-generation results. Cache keys include method/path, scope/world/stage, manifest/target pin, filter, accessView and entitlement/policy version. Clearing on revocation must also prevent pending reads from repopulating stale private content. Asset-ready invalidates only the relevant manifest/asset consumer; source/record mutations invalidate matching dependency manifests, not every dossier on each tile. Keep private data/tokens/packets out of localStorage.

Filters hiding the selected object keep an explicit hidden-selection banner with Reveal/Clear, not automatic nearest-object selection. Removed identity gives historical/unavailable context and explicit successors where supplied. Returning from a register/source restores camera within documented tolerance; streamed assets do not auto-fit every time. Pause hidden render loops and dispose owned geometry/material/texture resources when no longer referenced.

## 7. Shared slots, ownership and interaction states

`FeatureRegistration` contains feature ID, surfaces, required capability, pure availability function and lazy leaf. Available/needs_selection/unavailable/denied/not_assessed is UI state, not authorization. Mount only real implemented producer/leaf combinations. Feature panels receive selection/scope/capabilities and typed onSelectTarget/onOpenEvidence/onNavigateAction/onClose callbacks. Parent verifies scope, routes and [unsaved-work guard](../../apps/web/features/studio/data/navigation-guard.ts). No leaf installs another provider, renderer or selection store.

| Shared path / proposed destination | UI responsibility |
| --- | --- |
| [Studio layout](../../apps/web/app/studio/layout.tsx), Studio route, Shell, [ProductHeader](../../apps/web/features/studio/product/ProductHeader.tsx), product URLs | Provider lifecycle, navigation, FND SSR wrapper, actual workspace capabilities |
| BlockPage, [BlockRails](../../apps/web/features/officer/block/BlockRails.tsx), QuickRecords, RegisterPage | Exact invalid-selection handling and contextual feature mounts |
| SavedSceneViewport, MapViewport, [useBlock](../../apps/web/features/officer/block/useBlock.ts), map sessions/cache/[store](../../apps/web/features/officer/shared/store.tsx) | Two display adapters, one viewport, generation/access-aware state |
| [WorkQueue](../../apps/web/features/officer/work/WorkQueue.tsx), [ImportWork](../../apps/web/features/officer/work/ImportWork.tsx), [AddFiles](../../apps/web/features/officer/workspace/AddFiles.tsx) | Actual receipt/draft/review producer integration |
| Proposed `apps/web/features/usp/shared/{FeatureSlots,SelectionBridge,StatusBadge,EvidenceAction,FeaturePanel,PublicShell}.tsx`, `feature-types.ts`, `shared.css` | Reusable status/content/interaction and safe public layout |
| Proposed `apps/web/features/usp/shared/{external-scene,scene-manifest-adapter}.ts` | Typed source/display manifest adaptation, no new source authority |
| Proposed public pages named in section 3 | Thin CITIZEN released/own-data mounts behind F2, never internal search/dossier reuse |
| Proposed `tests/usp-ui-integration.test.ts`, `tests/usp-external-scene.test.ts`, `tests/e2e/usp-product-journey.spec.ts`, `tests/e2e/usp-visual.spec.ts` | Shared contract, geometry preservation, real interaction and visual acceptance |

FND remains sole shared API/DB/worker/config writer. Feature owners own their leaves. UI requests a concrete backend patch rather than making a mock API to appear complete. DATA owns fixtures and independent expected results. Explicitly transfer ownership before editing another owner's file.

States: loading retains only matching scope; empty names missing data; incomplete/not_assessed differs from no finding; stale cannot enable a current write; errors retain inputs and bounded retry; denied hides names/counts; submitted/accepted draft/recorded are distinct. Measurements show units/method. Generated packets say compilation, estimates say estimated, hypothetical work says proposed. No legal-clearance or official-issued system ID label.

Test keyboard/list/numeric alternatives to map-only actions, focus trap/return, Escape, readable errors, contrast, 200% zoom and reduced motion. Use text/icon as well as colour. Screen reader updates are coalesced, not every SSE event. Hidden overlays must not intercept pointer/touch input; test actual drag/zoom/orbit, not only screenshots.

## 8. Visual and interaction acceptance — V1 through V8

Retrieve the actual committed reference images via [comparison-manifest.json](../../apps/web/public/studio-review/comparison-manifest.json). Verify hashes/paths and label reference, historical capture and fresh active-product baseline distinctly. A file named current-map from an earlier task is not a current baseline. Use the accessible original reference to guide composition/material/detail; do not fabricate a missing image from its filename. If unavailable, the concrete shot contracts below still apply and visual-reference comparison remains explicitly unqualified.

| Case | Data and action | Pass condition / evidence |
| --- | --- | --- |
| V1 neighbourhood | D0 fixed camera; D1 real roof sample separately | Legible depth/silhouettes, coherent material/light scale, actual non-box D1 roof surfaces preserved; pan/orbit/zoom works; no screenshot background substitution |
| V2 building selection | Click B-A then B-B and a D1 source feature | Highlight, identity, register and evidence all match; no previous-building flash; D1 without interiors stays unavailable |
| V3 vertical stack | D0 basement, mezzanine, unequal heights, courtyard and supported per-level unit | Correct source levels/outlines; isolate/explode changes presentation only; measures/source hashes unchanged; unsupported compound analysis not hidden |
| V4 underground/section | D0 negative levels; FIND/IMPACT when enabled | Cutaway shows correct relative vertical separation; actual result/evidence supports highlighted volume; unknown utility depth is a gap. In V0 this tests scene visibility only, not unfinished FIND/IMPACT calculations. |
| V5 evidence action | U-A101 mixed source and PACK | Exact locator and applicable clause; NEVER_A102 absent from relevant preview/packet; text PACK0 passes only its profile, PDF requires PACK1; invalid unit cannot export building |
| V6 history | Two actual D0 manifests | Explicit dates/stages, correct old sources and supported overlay, no current-data substitution; one camera/viewer |
| V7 progressive draft | Three real INGEST chunks with failure/reversed completion | Selectable persisted geometry before batch completion; restart/replay matches fresh manifest; no duplicated/resurrected objects or global scene reload per event |
| V8 mobile/failure | 390×844, denied source, missing tile, empty record and reconnect | Readable selected-scope sheet and action; focus/touch work; failures do not show another property's private content or erase saved context |

V0 requires relevant D0 V1–V5/V8 plus the separate D1 geometry/identity gate. V6/V7 and unfinished feature-specific behavior are later gates, not fake screenshots to satisfy V0. Capture V1–V8 for their enabled phases at 1440×900, 1024×768 and 390×844 as appropriate, with fixed pack/hash/camera/fonts and explicit scene-ready condition. Compare fresh baseline/final side by side at the same settings. Record actual interaction/DOM IDs/asset requests, not subjective claims of pixel-perfect generated-image equivalence. Do not claim user approval without it.

### Measured budgets, not invented performance

Initial workload: 25–100 exterior buildings, ≤30 detailed spaces, ≤25 MiB visible geometry, local ready services. Proposed acceptance targets: first useful local scene ≤8 seconds, cached property-selection feedback ≤100 ms, interactive desktop frame time p95 ≤33 ms on the recorded reference hardware, and no continuing owned-resource growth over ten repeated open/close/scope-switch cycles after expected cache warmup. Record cold/warm, GPU/browser/device pixel ratio, network/cache, data size and actual p50/p95. Software WebGL tests can prove correctness but not desktop-GPU performance.

If a budget fails, reduce resident LoD/texture resolution/draw calls within the same geometry fidelity, add bounded loading and retest. Do not drop source objects, replace roofs with boxes or freeze interaction to fabricate a pass. On low-end/mobile devices offer a measured reduced-detail or existing 2D/list fallback; state the unsupported 3D profile. Test active renderer count and disposal; a static screenshot cannot prove memory/performance. Targets are configurable project engineering choices, not provider performance claims.

## 9. Dataset acquisition, test use and fallback

**D0:** DATA prepares the named aliases/sentinels/oracles in 00 from existing authored material without touching populated datasets. Import through actual services; images, plans, records and 3D must share the same fixture truth. Keep intentional invalid draft cases distinct from the clean V0 example.

**D1:** [preserve this full 3DBAG response](https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.1655100000500568), read [delivery/CRS/extension documentation](https://docs.3dbag.nl/en/delivery/webservices/), save hash and original metadata, and compare decoded coordinates/source face topology before rendering. One asset must pass roof shape, identity, placement and null-interior handling before a larger sample. External access failure → retain D0 visual work and report D1 unqualified; do not manufacture a replacement source.

**D2 optional:** [Helsinki models](https://www.hel.fi/en/decision-making/information-on-helsinki/maps-and-geospatial-data/helsinki-3d) / [mesh directory](https://3d.hel.ninja/data/mesh/). Acquire one small permitted urban crop with textures; archive acquisition/rendering were not completed by planning. Test dependency completeness, missing texture, placement and attribution. It stays geographically separate.

**D3 after V0:** [existing Uttam Nagar acquisition](../GOOGLE_UTTAM_NAGAR.md) and [transfer instructions](../UTTAM_NAGAR_SETUP.md). Do not redownload the giant shard without checking existing files. Display real outlines/uncertain candidates and estimated heights separately; source-only 2D data is not an excuse for a noninteractive UI or invented interiors.

**D4/D5 later:** [DDA inventory](https://dda.gov.in/sites/default/files/Housing_Department/list_of_flats_and_garages_dda_premium_housing_scheme_2026.pdf) for exact source rows; [RERA 2831](https://haryanarera.gov.in/view_project/project_preview_open/2831)/[2079](https://haryanarera.gov.in/view_project/project_preview_open/2079) or permitted campus plan/section for an Indian vertical model. Confirm matched building/phase/revision/levels and permission. DDA alone cannot supply geometry; a planned tower is not a surveyed as-built. Named local-frame inspection may precede global placement. Missing authentic data blocks that real-source claim, not D0 development.

## 10. Implementation sequence and final verification

1. UI0: after F0, establish typed selection/slots and source/display adapters; reproduce invalid-record/rapid-switch behavior and capture fresh active-route baseline.
2. UI1/V0: connect F1-min D0 map/unit/evidence/PACK0 through actual services; qualify D1 single-building roof separately. No F2/model/public workflow prerequisite.
3. Integrate feature leaves serially after their producer tests: READY/FIND/PACK1, then I1 INGEST durable manifests and HISTORY/RIGHTS/IMPACT according to their dependencies. Native ASSIST0 can run after its F1 producers exist, not only after F2.
4. UI-public: F2/DEPLOY enables released finder/own-submission routes and separately public MCP settings; never reuse internal search/full dossier on public surfaces.
5. Run corresponding V shots, negative integration and workload tests, then full regressions. H4 intended-user observation is a separate usability gate, not a substitute for automated verification or a prerequisite to all coding.

Existing commands: `pnpm typecheck`, `pnpm test:studio`, `pnpm test:register-scope`, `pnpm test:register-exports`, `pnpm test:registry`, `pnpm test:api`, `pnpm test:e2e`. Proposed tests after creation: `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-ui-integration.test.ts tests/usp-external-scene.test.ts`; `pnpm exec playwright test tests/e2e/usp-product-journey.spec.ts tests/e2e/usp-visual.spec.ts`. Respect [Playwright config](../../playwright.config.ts), [isolation](../../scripts/engineering/isolation.mjs) and [build-server guard](../../scripts/check-build-server.mjs).

Return route→producer→pack→test evidence matrix, actual SHA/source/artifact hashes, screenshot comparisons, selection/camera IDs, active viewport count, resource/performance measurements and each unqualified profile. Test stale source, invalid deep link, hidden selected entity, duplicate URL parameters, revoked grant/release during pending read, missed/replayed asset event, offline source and nested pointer overlays. No screenshots from a different showcase or mocked successful network responses as completion evidence.

## 11. Copy-paste UI assignment

> Implement UI on feat/usp-ui-integration using 00, 01, this file and enabled feature contracts. Work in the actual Studio route and shared BlockPage/SavedSceneViewport/MapViewport path. Obtain D0 through DATA and attempt D1 one-building roof geometry; complete the live visual map→supplied floor/unit→exact evidence→PACK0→reload slice first. Preserve rich external source shapes through the typed display lane, not generic boxes or another viewer. Follow selection-generation/cache/access rules, durable INGEST manifests and all relevant V1–V8 shot contracts. UI owns shared frontend; FND backend/config, feature owners leaves, DATA fixtures. Use stated no-data/no-model/local-frame fallbacks and continue unaffected work without asking humans to design it. Run section 10 actual service/browser/geometry/performance checks, compare fixed-camera fresh screenshots and return exact evidence and capability gates. Do not call mocked/showcase-only work finished, invent source facts, activate public services or merge main without authorization.
