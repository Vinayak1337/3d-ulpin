# Unified Studio UI/UX and final integration

Owner **UI** · Baseline `main@f623cff897f91bb3ebd4c225f700ac263f7beb72`. This handoff was written after rereading the completed [10–19 feature handoffs](00-README.md#execution-matrix), [shared contracts](01-shared-contracts-and-ownership.md) and [necessary human inputs](90-required-human-tasks.md). It specifies future implementation, not a completed visual or runtime audit.

## 1. Product experience and existing implementation

The product should feel like one workflow: **receive sources → resolve uncertainty → inspect an exact property → review the proposed change → retrieve its evidence**. Keep the existing three primary sections from [product URLs](../../apps/web/features/studio/product/urls.ts): **Batches, Map, Register**. Features appear at the point of use, not as ten more dashboards or navigation items.

The active officer path is [app/studio/[[...view]]/page.tsx](../../apps/web/app/studio/%5B%5B...view%5D%5D/page.tsx), using [Shell](../../apps/web/features/officer/shared/Shell.tsx) and active components under `features/officer`. Do not implement only in the separate [Studio App showcase](../../apps/web/features/studio/App.tsx) and call the officer workflow integrated.

The active map is [BlockPage](../../apps/web/features/officer/block/BlockPage.tsx) → [SavedSceneViewport](../../apps/web/features/studio/product/SavedSceneViewport.tsx) → [MapViewport](../../apps/web/features/spatial/MapViewport.tsx). The project also has [shared viewport leases](../../apps/web/features/studio/scene/SharedViewport.tsx) used by Studio scene surfaces. Reuse the existing source adapters/engine boundary appropriate to the active route; do not add a new provider or move the officer product into the showcase merely because both can display a map.

Static integration observations to address:

| Baseline behavior | Required integration change |
| --- | --- |
| [QuickRecords](../../apps/web/features/studio/product/QuickRecords.tsx) already supports contextual floor/unit inspection | Add bounded feature slots inside that inspector; do not replace it with a new register state tree. |
| [RegisterPage](../../apps/web/features/officer/register/RegisterPage.tsx) resolves `requestedRecord` to an existing record or `undefined` | An explicitly invalid unit link must show an invalid-scope state and disable scoped actions, not quietly broaden to a building-level packet/export. |
| Register sections already include Floors & spaces, Property details, Documents, Checks, History and Investigation | Reuse these categories; make investigation a contextual drill-down rather than adding many more permanent tabs. Preserve old `tab` links. |
| Shell has a Local workspace dialog with unconditional local-retention wording | Extend this actual dialog for DEPLOY; show only claims supported by profile and qualification. No assumed existing deployment settings page. |
| ProductHeader searches full internal resolver/dataset endpoints | Public pages need CITIZEN's released projection and their own slim header, not this unrestricted search component. |

These are code observations, not claims of reproduced browser failures. UI must verify them in the isolated running application during implementation.

## 2. Information architecture and surfaces

| Surface | Existing route / proposed route | Purpose and what stays visible |
| --- | --- | --- |
| Batches overview | `/studio/work` | Current work and one primary action per item; scope summary and filters, not infrastructure metrics everywhere |
| Intake | `/studio/add-files` | Upload receipt, recognized/retained/needs-input counts, then focused mapping questions |
| Batch review | `/studio/imports/:importPackageId` | Draft preview, exceptions, review/record controls; INGEST batch ID is resolved through the package binding |
| Area map | `/studio/areas/:areaId` | Shared map, selected world/revision, compact contextual quick register and optional findings tray |
| Dataset chooser | `/studio/datasets` | Select a known area/retained dataset with clear classification; not a second analytics dashboard |
| Register chooser | `/studio/registry` | Find a property/identifier and handle ambiguous matches |
| Full property register | `/studio/properties/:buildingId/register` | Full records/evidence/history and reviewed actions with persistent selected floor/unit context |
| Existing preparation workspace | `/studio/properties/:buildingId/workspace`, `/studio/cases/:caseId` | Existing geometry/preparation/check/record mechanisms, not a newly rebuilt editor |
| Public property finder | Proposed `/public/properties` | Approved public search/map and entry to own contribution; no officer datasets/party search |
| Own submission | Proposed `/public/submissions/:id` | Contributor status, clarification and authorized files; login required |
| Deployment/integration settings | Proposed contextual view in the existing Shell workspace dialog | Authorized profile/capabilities; optional public MCP setup guidance; no new top-level navigation |

Preserve existing retained dataset/site routes and legacy URL translation. An internally recorded registry revision, an observed source world and a synthetic dataset are different concepts; show classification and review status independently. A proposed drawing is not “observed,” and a supplied official parcel ID does not make an app-generated unit ID official.

## 3. Feature-to-interface matrix

| Feature | Entry point | Primary surface | Contextual surface | Main action | Visible result |
| --- | --- | --- | --- | --- | --- |
| [10 PACK](10-scoped-evidence-packets.md) | Selected property → Documents | Scoped packet preview drawer | Quick/full register Evidence | Review scope and generate | Included/shared/omitted evidence, job status and authorized packet |
| [11 READY](11-evidence-readiness-and-review-queue.md) | Batches filter or selected target status | Work queue / readiness details | Optional map overlay and register status strip | Open the stated next step | Exact missing fact, evidence/check basis and scoped action |
| [12 FIND](12-rights-aware-spatial-findings.md) | Map Checks or register Checks | Findings tray | Exact-volume highlight and existing investigation | Inspect evidence / open investigation | Measurement, applicability, coverage and review state |
| [13 CITIZEN](13-citizen-evidence-and-corrections.md) | Public Find my property; officer Request evidence | Submission/clarification flow | Register request panel and Batches review item | Submit or review a proposal | Own receipt, requested clarification and separate recording outcome |
| [14 INGEST](14-adaptive-ingestion-and-progressive-review.md) | Add files | Receipt/mapping/batch review | Shared progressive draft preview | Resolve mapping then review coherent group | Placed/needs-input counts, draft objects and retained source links |
| [15 HISTORY](15-property-history-and-comparison.md) | Register History | Version-pinned comparison | Compact quick-register timeline | Select two explicit versions | Changed fields/source refs and supported overlay; lineage when retained |
| [16 RIGHTS](16-shared-spaces-and-vertical-rights.md) | Selected unit/shared space → Relations | Contextual relationship panel | Floors & spaces or Property details | Inspect clause / propose relation | Beneficiary/space links with claim and technical-review labels |
| [17 IMPACT](17-infrastructure-impact-screening.md) | Map tools → Assess proposed work | Proposal editor/results | Existing SpatialInquiry and map overlay | Screen mapped records | Potential interactions plus explicit unassessed coverage |
| [18 ASSIST](18-grounded-assistance-and-mcp.md) | Ask about this property | Contextual assistant panel | Source citations and native action links | Ask a bounded read question | Grounded answer tied to the selected property; no hidden write |
| [19 DEPLOY](19-india-contained-deployment.md) | Workspace status → Deployment | Authorized diagnostics view | Local capability warnings | Inspect qualification gap | Tested/disabled/unqualified capabilities without secret exposure |

**Relations** is a contextual subsection, not a seventh permanent register tab. Packet, assistance, comparison and proposed-work modes reuse one foreground detail panel. Findings may replace the inspector temporarily with an explicit Back to property control; do not stack three trays over the map.

## 4. Layout and visual hierarchy

### Map with quick register

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ 3D ULPIN       Batches  Map  Register        Search       Workspace      │
├─────────────────────────────────────────────────────────────────────────┤
│ Area / supplied scope     Observed sources · revision N       Add files │
├───────────────────────────────────────────┬─────────────────────────────┤
│ 2D / 3D     Layers     Fit                 │ Building A         Full ↗   │
│                                           │ Parcel ID / System ID       │
│               SHARED MAP                  │ First floor › Flat 101      │
│                                           │ Boundary evidence needed    │
│ Selected space + relevant overlay         │ Summary  Evidence  More     │
│                                           │ Relevant facts / next step  │
│                                           │ Request evidence             │
│ World · assessment coverage      Checks   │ Relations / History / Ask   │
└───────────────────────────────────────────┴─────────────────────────────┘
```

Desktop target: map gets the flexible majority; inspector approximately 360–420 px with resizable/minimum bounds where helpful. No permanent left property tree plus right inspector plus checks tray unless the viewport comfortably supports it and the user explicitly opens the extra context. Move layers/dataset lists into the existing on-demand rail/dialog. Show floor controls only for a selected building with corresponding records; unavailable internal geometry remains a record/evidence view.

Keep the selected building/floor/unit, world/classification, relevant revision and main next action visible while drawer content scrolls. Quick register answers “what is this, what is missing, where is its evidence?” Full register handles long tables, investigation history and detailed revision comparison. Preserve map camera when opening full register and returning.

### Batches and full register

```text
BATCHES                            FULL REGISTER
Needs attention | Ready | History  Building / selected floor / unit
Scope: received records, digest N  Technical status · source world
Item             Next action      Floors  Details  Documents  Checks  History
Unplaced plan    Match building    Selected section; contextual investigation
Chunk paused     Confirm units    Evidence / scope / source references
Submission       Review evidence  Prepare update      Property packet
```

At most three primary overview counts, all clickable into matching filtered work. Queue health lives behind batch diagnostics. The full register's investigation route remains addressable but normally opens from a finding; do not remove existing review functionality just to simplify navigation. Keep original archive and derived property packet actions visibly distinct.

### Style and accessible density

Reuse the current restrained green/sage product palette, light panels, simple borders and existing icons from [product.css](../../apps/web/features/studio/product/product.css), [operations.css](../../apps/web/features/studio/product/operations.css) and [shared ui.css](../../apps/web/features/officer/shared/ui.css). Consolidate shared tokens through UI-owned styles instead of adding feature-specific global overrides or another component library.

Proposed target sizing: normal task text at least 14 px desktop/16 px mobile, essential metadata no smaller than 12 px, readable line-height around 1.45, 8/12/16/24 px spacing steps and approximately 44 px primary touch targets. Do not retain tiny 8–10 px essential labels merely to fit more text. Use one accent action per context and a clear type hierarchy; do not put paragraphs of explanations on cards. Details remain available on demand. Use installed/local fonts or approved assets in private mode; no silent remote font requests.

At approximately 900 px, collapse optional rails and move detail into a single modal sheet while keeping map selection context. At approximately 620 px, use full-height detail sheets, compact labelled navigation and form inputs large enough to read without zoom. Avoid nested horizontal scrolling; long IDs wrap/copy safely. Desktop search stays keyboard-accessible; mobile search opens a labelled input rather than relying on an invisible placeholder. Essential actions must work without hover, colour vision or map dragging.

These wireframes prescribe component hierarchy and interaction, not a claim of pixel-perfect matching to an unavailable mockup. Capture baseline and implemented screens during UI work for side-by-side comparison; reference images are optional, not a prerequisite to code.

## 5. Selection, state and map integration LLD

UI implements the `SelectionBridge` described in 01. URL parameters carry restorable selection; server adapters validate them before fetching feature data. Existing physical `feature` ID and registry `record` ID are not interchangeable. A human-readable identifier may resolve to several matches; present ambiguity instead of choosing the first.

| Context | Existing query/route behavior to preserve | Proposed extension |
| --- | --- | --- |
| Area map | Area route; `feature`, `record`, `world`, existing finding selection | Allowlisted `panel` for readiness/evidence/packet/relations/history/assistance/impact; server-validated artifact IDs for resume |
| Full register | Building route; `area` or legacy `areaId`, `record`, `tab`, existing investigation `case` | Same logical panel mapping plus optional comparison/packet ID; no conflicting duplicate values |
| Source evidence | Existing source/page context | Exact FND evidence pointer and source revision; old links translated without changing their meaning |
| Batch review | Existing import-package/case route | Resolve linked ingest batch server-side; do not place an ingest UUID in the package route |
| Public routes | New approved public refs / own submission IDs | No internal private target details or bearer credentials in query strings |

An example desired map URL is `/studio/areas/{areaId}?feature={buildingId}&record={unitId}&world=observed&panel=evidence`; braces denote validated values, not new ID schemes. Full register preserves the same target through `/studio/properties/{buildingId}/register?area={areaId}&record={unitId}&tab=evidence`. FND maps legacy world strings to the canonical world refs; UI must not assume the types are interchangeable.

Explicitly invalid record/area/world/source selection produces a visible mismatch state. The user may deliberately choose a valid parent/area, but the app must not silently broaden an export, query or submission. Disable actions until scope is resolved. Ignore no invalid parameter just to make a page look successful. Preserve recognized legacy routes; reject duplicate ambiguous values through shared request validation.

Map engine rules:

1. Reuse the current `SpatialDataProvider`, `ResourceCache`, `MapSessions`, `useBlock` and MapViewport source union. Feature leaves receive target/callback props, not their own store or renderer.
2. One active 3D viewport per focused officer workspace. Source panes, 2D plan diagrams and accessible lists can coexist; comparison does not require two WebGL viewers. Pause hidden rendering and dispose owned resources when no longer leased/visible.
3. Feature overlays carry stable target refs, representation/input revision and a role. They are display projections of accepted analytical results, never a second measurement authority. Preserve the current representation distinction between analytical geometry and display-only decoration/exploded floors.
4. INGEST applies accepted manifest/tile changes in bounded batches, retaining selected identity and camera. Late network responses for a prior scope cannot replace current data. HISTORY/IMPACT overlays name their explicit world/revision pairing.
5. Cache keys include scope/world/digest and entitlement view. Clear private responses on sign-out/revocation; no private documents, tokens or generated packets in localStorage. Server checks remain authoritative even after the UI hides a control.

## 6. Shared extension contracts and ownership

Proposed UI registration contract: `FeatureRegistration` has feature ID, allowed surfaces, required capability names, a pure availability function over qualified context, lazy leaf component and supported action kinds. Availability is `available`, `needs_selection`, `unavailable`, `denied` or `not_assessed`; these do not substitute for server authorization. FND publishes common ref/context types; UI owns the component registration mechanics. Register only implemented features, not placeholders returning fake success.

Feature panels receive `selection`, `scope`, `capabilities`, `onSelectTarget`, `onOpenEvidence`, `onNavigateAction` and `onClose`. Async results carry their input pins. Children request navigation with typed actions; they do not directly reset a shared global store. Parent action execution validates scope and preserves the existing [navigation guard](../../apps/web/features/studio/data/navigation-guard.ts) for unsaved work.

| Existing or proposed file | UI-owned change | Feature dependency |
| --- | --- | --- |
| [Studio layout](../../apps/web/app/studio/layout.tsx), [Studio route](../../apps/web/app/studio/%5B%5B...view%5D%5D/page.tsx) | Preserve provider lifecycle, integrate qualified route mounts and FND-supplied SSR access wrapper | FND/F2; active feature leaves |
| [Shell](../../apps/web/features/officer/shared/Shell.tsx), [ProductHeader](../../apps/web/features/studio/product/ProductHeader.tsx), [urls.ts](../../apps/web/features/studio/product/urls.ts) | Coherent navigation, workspace/deployment action, scope-safe search/URLs | DEPLOY and FND projections |
| [BlockPage](../../apps/web/features/officer/block/BlockPage.tsx), [BlockRails](../../apps/web/features/officer/block/BlockRails.tsx), [QuickRecords](../../apps/web/features/studio/product/QuickRecords.tsx) | Contextual quick-register/feature slots and panel switching | PACK/READY/FIND/RIGHTS/HISTORY/ASSIST |
| [SavedSceneViewport](../../apps/web/features/studio/product/SavedSceneViewport.tsx), [MapViewport](../../apps/web/features/spatial/MapViewport.tsx), [map sessions](../../apps/web/features/spatial/data/session.ts), [useBlock](../../apps/web/features/officer/block/useBlock.ts) | Typed overlay/selection and camera lifecycle integration | INGEST/FIND/HISTORY/IMPACT |
| [resource cache](../../apps/web/features/spatial/data/resource-cache.ts), [officer store](../../apps/web/features/officer/shared/store.tsx) | Entitlement-aware invalidation and bounded transient preferences | FND context/access |
| [RegisterPage](../../apps/web/features/officer/register/RegisterPage.tsx), [Evidence](../../apps/web/features/officer/register/Evidence.tsx), [History](../../apps/web/features/officer/register/History.tsx), [SpatialInquiry](../../apps/web/features/officer/register/SpatialInquiry.tsx) | Scope validation and feature mounts; preserve existing sections | Relevant leaf owners |
| [WorkQueue](../../apps/web/features/officer/work/WorkQueue.tsx), [ImportWork](../../apps/web/features/officer/work/ImportWork.tsx), [AddFiles](../../apps/web/features/officer/workspace/AddFiles.tsx) | Real queue/receipt/review integration, no duplicate boards | READY/INGEST/CITIZEN |
| Proposed new `apps/web/features/usp/shared/{FeatureSlots,SelectionBridge,StatusBadge,EvidenceAction,FeaturePanel}.tsx`, `feature-types.ts`, `shared.css` | Shared slots, status/interaction tokens and selection adapter | F0 types; implemented leaves |
| Proposed new `apps/web/app/public/properties/page.tsx`, `apps/web/app/public/submissions/[id]/page.tsx`, `apps/web/features/usp/shared/PublicShell.tsx` | Thin safe public mounts and navigation | CITIZEN/F2/DEPLOY |
| Proposed new `tests/usp-ui-integration.test.ts`, `tests/e2e/usp-product-journey.spec.ts`, `tests/e2e/usp-visual.spec.ts` | Shared selection/navigation and real cross-feature browser verification | Qualified local stack/fixtures |

UI is sole editor of these shared parents. Feature agents remain sole editors of their leaf components/services/tests unless they explicitly transfer ownership for a narrow integration fix. FND owns API/DB/worker/identity changes; UI must not build a parallel mock backend to make missing features appear connected.

## 7. Unified states, content and accessibility

| State | Shared behavior and wording principle |
| --- | --- |
| Loading | Keep valid scope header; show bounded progress/skeleton, never invented percentage |
| Empty | Name the missing population: no supplied records, no scoped evidence, no earlier revision; not zero risk |
| Not assessed / incomplete | Explain the absent dependency/input and next action; distinguish from successful no-finding result |
| Stale | Show pinned result and what changed; disable stale mutation/record actions until revalidated |
| Error / retry | Preserve draft inputs, use safe reason/action, retry only idempotent operations |
| Denied / withheld | Hide private details and counts appropriately; do not leak filenames or party names through tooltips/citations |
| Submitted / accepted / recorded | State the actual workflow step; receipt is not review, accepted proposal is not recorded title |
| Success | Show exact target/revision and completed action; qualified technical readiness is not legal clearance |

Use text + icon + optional colour for status. Keep units next to every measurement and world/classification near every 3D view. Labels “System 3D ID” and “Official parcel ULPIN, supplied” prevent identity confusion. Use “Possible discrepancy” and “Review needed” rather than unreviewed legal verdicts. A generated packet says it is a compilation; a proposal drawing says it is hypothetical/planned.

Dialogs have focus trapping, Escape handling, labelled titles and focus return. Replacing the property inspector with a check/packet panel preserves a labelled Back action. Forms expose validation near fields and via an accessible error summary; screen-reader progress uses a polite live region without announcing every SSE event. All map-only selections/actions have a list or numeric-form alternative. Test keyboard navigation, visible focus, contrast, 200% zoom, reduced motion and narrow screens. Do not animate the camera automatically on every streamed tile.

## 8. Implementation and integration order

**UI0 after F0:** establish SelectionBridge, availability/status primitives and leaf slots; preserve all existing routes and test invalid selection/camera navigation. This early integration work can proceed while feature owners build against documented fixtures.

**UI1 after F1:** integrate PACK, READY and FIND first to qualify one selected-unit journey. Add INGEST into actual AddFiles/ImportWork with explicit package/batch binding. Then HISTORY/RIGHTS and IMPACT, only using available qualified ports. Keep unimplemented optional actions hidden or explicitly unavailable; do not ship working-looking buttons wired only to fixtures.

**UI2 after F2/DEPLOY:** mount safe public finder/submission pages and qualified native assistance. Keep external MCP/profile configuration in the advanced workspace surface, subject to its separate gate. Public views never reuse full internal dossiers/search.

**Final pass:** integrate one owner branch at a time into the agreed feature integration branch. Run shared contracts/migrations first, then relevant feature tests and complete browser journeys. Resolve UI/LLD contradictions by editing the affected handoff individually and notifying its owner, not by silently diverging from the interface. No unauthorized merge into main.

## 9. Acceptance criteria and repeatable demonstrations

Primary synthetic journey: import a supported delivery → clarify units/CRS without invented data → see progressive draft geometry → select a unit with missing evidence → request and receive a contributor response → reviewer creates/records the supported proposal → readiness updates for the named step → generate only that unit's scoped packet → inspect exact before/after history. Related actions use the same IDs/worlds/revisions throughout; the citizen sees only their authorized projection.

Additional demonstrations: shared stair relationship opens the same affected units in FIND and PACK; hypothetical excavation reports a basement interaction and unknown utility depth without an all-clear; native assistant cites the selected finding; private deployment disables external MCP and displays manual fallback when its model is unavailable.

Required negative cases: invalid record URL cannot trigger a building-wide export; rapid selection changes cannot show the previous unit's documents; switching world cannot reuse incompatible findings; a revoked grant removes cached/downloadable evidence; interrupted SSE resumes without duplicated objects; closing a drawer restores keyboard focus; hidden overlays do not block mouse/touch map controls. Test drag/pan/zoom and pointer events explicitly rather than judging only screenshots.

Run existing `pnpm typecheck`, `pnpm test:studio`, `pnpm test:register-scope`, `pnpm test:register-exports`, `pnpm test:registry`, `pnpm test:api`; run proposed `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-ui-integration.test.ts` and `pnpm exec playwright test tests/e2e/usp-product-journey.spec.ts tests/e2e/usp-visual.spec.ts`. Use [Playwright configuration](../../playwright.config.ts) and the established isolated stack; `pnpm test:e2e` is the full final regression where supported. Respect the [build-server guard](../../scripts/check-build-server.mjs).

Capture comparable baseline/final screenshots at 1440×900, 1024×768 and 390×844 for Batches, map quick register, full register/evidence, batch mapping, submission and a failure/incomplete state. Use fixed synthetic data/camera/fonts and wait for explicit scene readiness in tests. Record active WebGL viewport count, selected target attributes and camera return behavior; a screenshot alone cannot prove shared state. Human usability observations are H4, distinct from automated tests. Never commit private source screenshots or generated packets.

## 10. Copy-paste UI/integration assignment

> Implement UI on an isolated `feat/usp-ui-integration` branch. Read root/web AGENTS, `00-README.md`, `01-shared-contracts-and-ownership.md`, all handoffs 10–19 and this integration document. Work in the actual Studio officer route and linked shared parents, not only the showcase. Establish typed selection/feature slots first, then integrate real F1 services and qualified feature leaves in dependency order; F2/DEPLOY gate public surfaces. Preserve one shared map boundary, exact unit/source/world scope, current workflows and accessible alternatives. Do not add a top-level page per feature, broaden invalid record selections, invent readiness, or use mocked APIs as completion. FND owns backend/shared contracts; feature owners own their modules. Run the specified scope/security/browser/visual journeys, compare screenshots at the defined sizes, and return commits, a feature-to-route verification matrix, real UI evidence, active-map/selection checks and explicit remaining gates. Do not merge main without authorization.
