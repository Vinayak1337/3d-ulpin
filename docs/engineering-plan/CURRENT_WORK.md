## Current — T093 reference-led floor registry

Clear selectable floor stacks, source boundary walls, compact labels, floor metrics and source access. Local desktop/mobile checks and five geometry tests passed; production build passed. [Result](tasks/T093_RESULT.md). Source geometry remains authoritative; unregistered ML proposals are not shown as registered floors.

## Current — T092 LiDAR, imagery and elevation views

The existing complete Lake View ZIP now renders its LAS point cloud, orthomosaic GeoTIFF, DEM and DSM in the shared map. Use Map tools → Layers → Map data. Verified original file upload, mobile source controls, alignment, floor-search return and hosted saved data; ten tests and production build passed. [Result](tasks/T092_RESULT.md). Source rendering is implemented; automatic building extraction from point clouds remains separate future work.

## Current — T091 mobile scrolling and sidebars

Responsive map, explorer, inspector, register and import dialog fixes are implemented and deployed. Browser verified phone, landscape and short desktop layouts; all property/floor controls remain reachable. [Result](tasks/T091_RESULT.md). Source data and identities are unchanged. Point-cloud generation remains a separate gap: the existing sample LAS/LAZ is retained and does not currently generate the map geometry.

## Current — T083 datasets persisted

Lake View and Shiv Vihar are saved in local linked PostgreSQL and object storage, with immutable canonical snapshots, source bindings and verified original bytes. Map and Batches list actual saved UUIDs. Duplicate saves reuse records; refresh/server restart reopen stored packages. Browser Save action and floor register verified. See [result](tasks/T083_RESULT.md). Saved fictional records still require review; T080 broader processing/publication remains open.

## Current — T082 named datasets in the directory

Lake View and Shiv Vihar appear in the Map list and header chooser. Their named URLs reopen the correct source package across refresh, with explicit fictional/unrecorded status. Directory, filtering, switching and refresh verified; production build passed. See [result](tasks/T082_RESULT.md). T080 durable mixed-source recording remains planned.

## Current — T081 navigation and Shiv Vihar import

Ordinary drag now pans; visible Move / Rotate controls and focused-map arrow keys are browser-verified. Imported the supplied Shiv Vihar MASTER ZIP into the shared map (32 buildings, five supplied floors, 26 spaces). This remains a session draft. See [result](tasks/T081_RESULT.md) and [statement 26011 gap audit](tasks/T081_REQUIREMENTS_AUDIT.md). T080 durable mixed-source batch/recording integration remains planned. Full AI/ML, multimodal extraction and statutory identity capabilities are not complete.

## Current — T079 map declutter and complete source package, 21 September 2026

Implemented solo. The reference-style city is now imported from a 52-member source ZIP (50 source files), with consistent provided schema fields, actual binary formats, 49 buildings / 184 floors / 189 spaces, source-linked rights/documents and less map clutter. [Result](tasks/T079_RESULT.md), [showcase guide](../LAKE_VIEW_SOURCE_SHOWCASE.md), [workflow coverage and gaps](tasks/T079_WORKFLOW_AUDIT.md). App: http://127.0.0.1:3000/studio/showcase. Local services recovered without reset; production port3000 plus backend/dispatcher only. No database seeding or recording.

Next bounded task T080: durable mixed-source batch receipt → reviewed frame mapping → existing scoped recording boundary. The complete ZIP currently produces a draft preview. Do not claim the whole attached workflow, universal binary extraction, official issuance or final user visual acceptance is complete.

## Previous — T078 reference city and performance, 20 September 2026

User rejected T077 map appearance/lag and accepted the register. T078 was completed solo: new authored reference-city source package (49 buildings), 76% fewer exterior draw batches, measured production orbit, shared searchable building/floor data. App: http://127.0.0.1:3000/studio/showcase. [Result and limits](tasks/T078_RESULT.md), [actual comparison](evidence/t078/comparison.html). User visual acceptance remains open. Original reference city source geometry does not exist in the supplied image pack. Linked database was unavailable at final verification; this preview makes no DB writes. Do not claim exact photographic parity or complete calibrated workspace/ML work.

## Latest user priority — T074 full reference audit complete

All 35 supplied paths / 17 unique images reviewed, including composite-board states. [T074 replication plan](tasks/T074_REFERENCE_REPLICATION_PLAN.md) defines exact map composition, render detail, all register/workspace/investigation states and shared-schema acceptance. Interactive image-by-image review: http://127.0.0.1:3013/reference-audit/. Full replication is not implemented. Next bounded task T075 pins the source-preserving canonical adapter/scene contract before matching the Block Map anchor. Standalone and production currently have separate contracts/render paths; do not claim otherwise. Keep the live product empty. See [audit result](tasks/T074_RESULT.md).

## Latest user priority — T073 dense spatial arrangements implemented

User clarified “any data” means spatial arrangements: attached/overlapping buildings and street/parcel conflicts. Existing localhost:3013 reference now has 82 dense plotted buildings, 68 valid shared-wall contacts and four computed geometric findings. Checks recompute on load/import; browser geometry-revision replacement was verified. 29 map + 11 import + 8 browser arrangement checks and 16 geometry checks pass. Previous T072 source fixture archived; actual side-by-side captures and source package preserved. See [T073_RESULT.md](tasks/T073_RESULT.md). User visual acceptance remains open; production shared-viewport integration is separate and the live app stays empty.

## Latest user priority — T072 reference map implemented

The isolated reference map is available at `design/reference-map-v5/`, localhost:3013. New fictional neighbourhood, detailed procedural architecture/landscape, canonical source package and actual ZIP/JSON preview loading are implemented. Browser checks: 17 map + 3 context recovery + 11 import/records/mobile passed. Source bytes and 86-object round trip verified. See [T072_RESULT.md](tasks/T072_RESULT.md) and the prototype `comparison.html`. Parent inspected supplied/reference captures side by side; photographic/pixel parity is not claimed and user visual acceptance remains open. App on port3000 remains empty (areas0, queue0), prior reference remains port3012. No production viewport replacement or ML expansion this turn.

## Latest user priority — T071 references ready, 20 September 2026

Isolated bulk-first interactive reference set is at `design/bulk-studio-v4/`, local port3012. See [T071_RESULT.md](tasks/T071_RESULT.md). Source Drive inventory, new normalization proposal and fictional fixture are included. User visual review is pending; actual app implementation has not resumed. The app on port3000 is still empty. Do not restore previous demos.

## Latest user priority — T070 complete, 20 September 2026

The user requested a completely empty app. All linked live datasets, documents, workspaces and processing data are cleared with a verified private recovery backup at `.runtime/app-cleanup-20260920/`. Built-in sample entry points are removed. See [T070_RESULT.md](tasks/T070_RESULT.md). Do not seed or restore old demonstrations without a new user request. Visual reference matching is still pending; previous functional completion did not constitute visual acceptance.

# Current work

The user-prioritized reference correction and Studio UX pass are implemented. T069 reference redesign came first, then T063–T068 sequential implementation. See backlog.json and tasks/T062_RESULT.md through T069_RESULT.md for exact scope/evidence; T068_RESULT is the final integration handoff. User visual acceptance remains open; do not claim universal survey/ML/statutory acceptance.

- App: http://127.0.0.1:3000/studio/work, final production build, pnpm start PTY69865 (web + dispatcher).
- Reference gallery: http://127.0.0.1:3011/, Python PTY53388. Before/revised image comparisons in index.html; revised/actual browser comparisons in implementation.html. IAB tab4 holds implementation comparison, marked deliverable.
- Current guide: docs/STUDIO_DEMO_GUIDE.md. README corrected to current Studio entry/workflow; older walkthroughs are historical.
- Final gates: production build/typecheck, 78 focused parent tests, 46 cleanup-worker tests, 8 browser hierarchy groups, 8 queue database checks, 4 complete record/export groups, immutable preservation comparison. No page errors. Final replay zero writes; first integrated run recorded only the new explicitly fictional T066 roof.
- Queue uses server pagination/literal search, exact recorded preparation fingerprints, active-job precedence and 15-second visible refresh. Historical GIS drafts now resume at /studio/imports/:id. Map/register/workspace requested controls and all originals/history/corrections/exports remain accessible.
- T066 package 5fd5efff-4f12-4173-a60f-eb2e852fd9a5 is now COMMITTED by T068; feature3395d7e2-897a-4001-b408-aeb998093f13 retains actual inferred contour and unknown height. T066's historical checkpoint still describes its then-unrecorded state; do not rerun its unrecorded assertions as if later recording never happened. T068 complete-journey script is replay-safe.
- Protected .runtime/ux-preservation-before.json must never be overwritten. Final immutable comparison: physical revisions559→560, registry322→322, unit1001→1001, original receipts554→565, all prior rows preserved. Two export bundles verify original bytes separately.
- Branch feat/visual-ml-completion has broad inherited/new uncommitted T060–T068 work; preserve all. Earlier main/Studio remote commits were integrated at da00fc1. No commit/push/deploy requested or performed.
- Root cleanup removed dead SearchDialog + Shell path + obsolete shell CSS; route-page aliases stay as thin redirects. 35 entrypoints / 91 remaining presentation modules reachable. Never delete live capabilities just to remove files.
- Limits remain raw GNSS/LAS/DEM intake, free-route Nous live qualification, broader real-data model accuracy, hosted-fixture gates, statutory issuance/multiple users. No paid fallback. Linked services preserved; no DB/volume reset or snapshot refresh.
