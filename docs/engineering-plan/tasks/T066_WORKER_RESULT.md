# T066 worker implementation report

Implementation prepared 20 September 2026 on the inherited dirty branch. No commits, service restarts, data resets or production build were run by the worker. Parent owns build, browser review and actual local-inference qualification. This is not user acceptance.

## Delivered

- Routed `/studio/add-files` with optional `area`, `building`, `case` query context. A combined picker stages supported GIS and document selections; selected picker contracts, filenames appear in one retained/selected list, and ordinary originals can be received before block/property association. Destination/source-origin questions appear only when starting source-led spatial extraction. GIS bytes use T064's existing inspection and import services, one selected GIS source at a time; ordinary GIS review stays available in the routed task and retained DataTools callers.
- Explicit `ImportPackage.sourceWorkspace` containing the case, complete retained coordinate frame, declared world status and area-reference fingerprint. This creates no building or other physical feature. Existing named-frame area context is required, and source-only packages cannot be directly reviewed/recorded as physical features.
- New explicit source-only document endpoint. Ordinary `/documents` still requires canonical entity IDs. Original bytes pass through the real existing receipt/extraction service. Optional per-selection request keys replay successful source-only receipt and reject changed input under the same key.
- Common PDF, PNG, JPEG, CSV, TXT and DOCX format/profile mapping for intake and assignment. Existing legacy PDF/PNG/levels CSV originals remain eligible. Source-only case sources are rendered with their real package parts and original download URLs; source association preserves original case/source/hash/revision lineage through the existing copy implementation. Binary DOCX uses extracted text parts, not a text fetch of original bytes.
- Source-only imagery ML selection, persisted batches, retries, cancellation, retained result review and ordinary footprint draft generation. No property or preparation is required for building extraction. Floor-plan extraction may be inspected unassigned but application still requires a property and reviewed placement. Local eligible model is automatically selected; technical model details are collapsed.
- Footprint adapter accepts either existing explicit source-property association or explicit source workspace. The source-only path checks the complete retained frame and area reference, then continues all existing source/part/hash/raster/control/currentness, expected-area-revision, stable application identity, exact geometry and ordinary draft review checks. Origin propagates to derived proposals and receipt. Calibration reuse is restricted to the exact raster and expected named frame.

## Endpoint contract for parent verification

1. `POST /api/v1/source-workspaces`: JSON `{requestKey, areaId, expectedAreaRevision, name, worldStatus, caseId?}`. World status must be observed/planned/hypothetical/synthetic. Returns ImportPackage with `features: []` and `sourceWorkspace.caseId/frame/worldStatus/areaReferenceFingerprint`. Repeated request key/input reopens the same package; changed input rejects. Optional caseId adopts an existing case only when it has no import package, retaining all existing source revisions.
2. `GET /api/v1/source-workspaces?caseId=<uuid>` returns the case's source-only package or null.
3. `POST /api/v1/import-packages/:id/source-documents`: multipart `file`, `format` (pdf/png/jpeg/csv/text/docx), `expectedRevision`, optional `requestKey`. Requires explicit sourceWorkspace; no fake entityIds. Returns updated ImportPackage. Same requestKey and original/association payload replays; changed original rejects.
4. Existing `POST /api/v1/spatial-ml/batches`, item retry/cancel, and `POST /api/v1/spatial-ml/items/:id/footprint-drafts` contracts remain unchanged. Use returned package source/part and current revision. Building calibration frame is the retained `sourceWorkspace.frame.id`; named projected area reference is required for the footprint draft.
5. Open `/studio/cases/<sourceWorkspace.caseId>?mode=build` to inspect source-led extraction. `/studio/add-files?case=<caseId>` adds supported documents to a retained source workspace. `/studio/add-files?building=<canonicalBuildingId>&area=<areaId>` uses the property's retained preparation.

Parent has actual hash-checked published source images under `.runtime/t066-fixtures/` and checkpointed `scripts/ux/verify-source-workflow.ts`. Declare the qualification destination/workflow explicitly synthetic; images are not survey evidence for that destination. No fabricated control/level evidence is supplied by the UI. A local inference result remains a proposal and cannot establish ownership/height.

## Worker validation

- `pnpm typecheck`: passed after final code changes.
- `pnpm exec tsx --test tests/source-intake.test.ts tests/spatial-ml-backend.test.ts`: 10 passed. Covers supported/unsupported format routing and assignment profile parity, strict source-workspace input contract, full frame/benchmark/unit and area-origin/CRS mismatch rejection, exact transformed holes/multipart shapes, raster/control mismatch, empty result guard, and bounded batch selections.
- Read installed Next page conventions before route changes. Applied frontend-design and redesign-existing-projects to supplied 05/01 references; reviewed React best practices after TSX edits.
- Parent must complete production build, rendered desktop/tablet comparison, actual source-only local model run and receipt/draft verification before task acceptance.

## T067 handoff and limits

- `routes.addFiles(areaId?, buildingId?, caseId?)` is ready for queue/global Add files callsites. Global navigation/default queue remains T067 scope. Retained DataTools export/review is preserved.
- Source-only cases have package.areaId but no building_preparations entry. Workspace directory should use source-package area/context fallback. No dummy property should be created to satisfy queue presentation.
- GIS file batches are intentionally processed sequentially through real T064 service; unprocessed staged files can be removed, while retained originals cannot be removed by cancelling a selection. GIS and document review each retains its real service semantics.
- Ordinary document receipt requires no block. A source-only extraction workspace requires an existing block with a named metre frame; import a GIS source first if no block exists. Missing projected reference does not prevent package receipt/inference but prevents footprint placement. This UI does not invent CRS, origin, benchmark or controls.
- Legacy unassigned cases now receive the same six supported formats through explicit reference-documents receipt; historical low-level api.upload profile contract remains unchanged. The source-case frame uses explicit UNASSIGNED placeholders and is never used by the source-workspace extraction adapter.


## Parent review follow-up (included before final build signal)

- GIS creation reloads the area directory and retains the resolved new area. GIS form waits for authoritative property/area context and remounts on destination identity, so late context does not leave the form targeting a new block.
- Unsupported staged rows prevent Continue and state the corrective action. Document-only receipt routes directly to source review; mixed staged receipts keep one document continuation and preserve GIS drafts.
- `POST /api/v1/source-cases` accepts `{requestKey,name}` and returns `{caseId}` with stable creation retry identity. It requires no map area, property, CRS or frame input. Schema-required case frame and benchmark are explicitly `UNASSIGNED`, not evidence.
- `POST /api/v1/cases/:caseId/reference-documents` accepts multipart `{file,format,requestKey}` and returns `{caseId,sourceId}`. It is only for cases without package/physical-record association. Real native extraction feeds retained `inspection.referenceParts`; source suitability remains needs_input/reference-only. Retry reuses source ID and rejects different bytes. Original family/revision/hash and parts are preserved when this case is later adopted by source-workspaces.
- Unassigned workspace upload supports all six profiles directly. Build details offers block/context choice only for spatial extraction; optional property linking is collapsed. Source-only imagery has the primary extraction/review action and no duplicate Assign property header action.
- Focused suite is now 10 passing tests, including no-reference receipt schema and exact adopted native part identity/text.

## Final residual review fixes

- Upload size labels and preflight validation now match the private processor: PDF/DOCX/CSV/text are limited to 10 MiB, PNG/JPEG to 16 MiB; GIS remains 16 MiB. Oversized/empty selected documents show an actionable per-file message and disable continuation before case creation/receipt. Workspace uploads use the same check. Public receipt and assignment also enforce these existing format limits, without expanding private limits.
- Public ML batch/item reads now hydrate optional `retainedFootprintCalibration` from `spatial_ml_footprint_drafts.body.calibration`, newest matching draft first. This is read-only and works with existing source-only footprint receipts; no item migration or new inference is required. Reuse requires matching item/job/inference/model, source revision/hash/current retained part, page, raster, destination area and complete frame/reference evidence, plus valid controls. Existing source-workspace receipts provide the full retained frame/reference; new property-linked receipts also store them. Legacy property-linked receipts without full frame evidence are not automatically reused.
- ExtractionReview restores building controls from this field and still rejects a different current raster or expected frame. Its retained-control identity participates in the React key, so a changed/ineligible receipt does not leave stale automatically restored state. A concise notice identifies restored controls.
- Final focused command: `pnpm exec tsx --test tests/source-intake.test.ts tests/spatial-ml-backend.test.ts tests/spatial-ml-retained-calibration.test.ts` — **15 passed**. Covers format-size boundaries; historical footprint control restoration with zero floor applications and no mutation; source/part/page/model/job/raster/frame/benchmark/area-origin mismatches and invalid controls. `pnpm typecheck` passed.
- Parent may assert the actual retained imagery fixture's `retainedFootprintCalibration.imagePoints[1][0]` equals its raster width, verify nonzero controls in browser, and verify no source/job/draft counts change during read-only restoration.
