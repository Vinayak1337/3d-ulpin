# Bulk Studio reference audit

Date: 20 September 2026. Scope: visual design audit for the new **Batches / Map / Register** workflow. This document does not claim implementation, computation, survey accuracy, or visual acceptance of the running app.

## Evidence and conclusion

Visually inspected with `view_image`: all three anchors, all ten named supporting block-map/register/workspace images in `/Users/vinayak/Downloads/3D_ULPIN_V2_REDESIGN_PACK_FINAL/images/`, and the six final Officer Studio V3 images named below. Original images were not changed. The V3 images are generated design artifacts, not browser captures or source evidence.

The supplied pack establishes a useful visual language: persistent orientation, a large spatial or document canvas, restrained green controls, selection linked to an inspector, and an exploded model connected to a floor table. V3 successfully removes duplicated photographs, statistics, issue summaries, and competing actions. However, V3 remains a property-first sequence and removes too much visible map functionality. Bulk Studio needs a new batch model and exception-driven review, while retaining the references' spatial controls and evidence context.

**Adopt the reference's visual hierarchy, not its asserted identities, figures, legal statuses, or every panel.** The images contain contradictory measurements/statuses and misleading identity shorthand. They are interaction references only.

## Reference-by-reference audit

Paths in this table are relative to the supplied `images/` directory. Descriptions reflect the actual rendered images, not filenames.

| Reference | Visually observed strength | Gap or inconsistency | Bulk Studio treatment |
| --- | --- | --- | --- |
| `anchors/01-block-map-anchor.png` | Large oblique neighborhood; visible 3D/2D, Underground, Labels, Fit Block and Focus; parcel boundaries distinguish the selected building; layer toggles and inspector are legible. | Property list, inspector photo, bottom findings and inspector issues repeat the same selection. Red selection reads as a conflict before its provenance is clear. Building is titled with a bare ULPIN. | Retain geographic context and discoverable view controls. Use one selection inspector, a collapsible layer drawer and one findings surface. Explicitly label parcel 2D ULPIN separately from proposed building 3D ID. |
| `anchors/02-property-register-anchor.png` | Exploded floor model beside an expandable floor/unit table; source documents and history make evidence discoverable. | Statistics appear twice; both tabs and permanent evidence/issues/history rail compete. Ownership is one flat attribute. A single parcel and floor-only hierarchy imply simpler relations than the new model permits. | Keep synchronized model/table selection. Move evidence/history to contextual tabs, add Rights and Relations, and expose IDs and revisions at the selected entity level. |
| `anchors/03-plan-workspace-anchor.png` | Source document is the main canvas; extraction links to visible outlines; comparison, calibration and floor stack demonstrate valuable capabilities. | Several primary actions and duplicate Build Details/Send for Review controls. A height is asserted while a warning says it was not found. Global “Reference OK” obscures which frame/scale/placement is supported. | Turn this into an exception review detail within a batch. Source + proposed geometry + one unresolved decision; retain calibration, compare and manual tools in explicit modes. Each value carries its own source and review state. |
| `block-map/01-layers-2d-map.png` | Distinct plan view and clear footprint/parcel/utility layering; collapsible inspector rail preserves map area. | Bottom findings and mini-map crowd the scene; color alone carries several meanings. A decorative aerial scale could be mistaken for calibrated measurement. | Provide a true 2D state preserving the same selection. A compact legend explains geometry role and uncertainty with line pattern/text as well as color. Show a scale only when backed by the rendered coordinate transform. |
| `block-map/02-import-export-data-tools-modal.png` | Supported heterogeneous inputs are understandable; preview lists found layers, feature counts and per-layer selection. | Format selected before uploading; location and role require manual entry; “replace existing layer (if same name)” threatens identity/history. Modal is too constrained for a large batch. | Use a full-page batch intake with many files, automatic classification and source metadata; list inferred layers/pages and target links. Ask only unresolved questions. Duplicate/update decisions use identity and revision evidence, never filename alone. |
| `block-map/03-properties-parcel-inspector.png` | Parcel details, associated buildings, linked records and boundary comparison establish useful relationship navigation. | Selected parcel is rendered with building emphasis; documented and displayed area/IDs are inconsistent with other screens. “Verified” is unexplained. Ownership lacks a separate right/evidence model. | Selection type is explicit: Parcel, Building, Floor, Space or Right. Parcel highlight remains independently visible. Show all linked parcels and buildings, assertion source, revision and review state; no automatic legal verification badge. |
| `block-map/04-utility-and-findings.png` | Visible Section and Underground tools, utility type toggles, section line A–A′, and finding-to-map actions are strong spatial affordances. | “Horizontal clearance” is drawn as a vertical arrow. The same utility distance is non-conflicting elsewhere and conflicting here. Two section previews and repeated findings occupy too much space. | One active section surface with orientation, datum/benchmark and the measured quantity named precisely. Unknown depth stays unknown. Computed finding shows inputs/rule and geometry revision; never reuse illustrated distances or thresholds. |
| `block-map/05-photos-and-history-sidebar.png` | Actual image is a workspace start screen with recent work and processing states, not a photos/history sidebar. | Hero, five overlapping starting actions, tutorial and second recent-plan list compete; new work is still one property/workspace. | Replace with Batches directory: one New batch action, resumable batches, processing totals and actionable exception counts. Do not reproduce its landing-page hero. |
| `register/01-register-start-page.png` | Actual image is detailed Floors & Units, with exploded model, floor elevations, expandable IDs and evidence. Reset View is visible. | Repeated metrics and a very narrow center; occupied/vacant/constructed statuses mix distinct concepts. Floors assume regular 3 m steps and one containing floor per unit. | Preserve the synchronized hierarchy and Reset View. Show actual source-backed levels; represent cross-floor spaces and shared areas without duplicating identity. Separate geometry state, usage and right/occupancy assertions. |
| `register/02-floors-and-units-page.png` | Actual image is Register start page; search and map entry explain how to retrieve records. | Four large entry cards plus a sample record and explanatory model delay retrieval. Imports create a second entry to ingestion. | Register root is a searchable/filterable entity directory. Import points to Batches. Example data belongs in an explicit demonstration context, not among real records. |
| `register/03-investigation-page.png` | Findings include location, evidence requested and timeline; “View on Map” connects issues to geometry. | The same case is both In Progress and Resolved. Duplicated issue summaries, invented officer workflow and statutory-looking statuses exceed local technical review. | Reuse issue/evidence/history linkage for batch exceptions and record checks. One current status with immutable events; no fabricated municipal officer, legal approval, case closure or field visit. |
| `workspace/01-workspace-start-page.png` | Actual image is a multi-screen board. It includes multiple mixed uploaded files, auto-detected coordinate system, scoped export, source documents, history comparison, basement and calibration. | Tiny panels are not a finished layout; some topics are only sketches. It still has property/workspace creation gates and apparent official IDs. | This is the strongest supporting reference for mixed intake, basement visibility, evidence and scoped actions. Use these capabilities in dedicated states; do not copy the collage or treat labels as requirements already implemented. |
| `workspace/02-measure-workspace-page.png` | Same dense workspace composition as the plan anchor; distance/area/perimeter/height modes, source page, scale and comparison are discoverable. | Measurement mode and extraction review are simultaneously expanded; an attractive overlay can imply measured certainty without calibration. | Measure is an explicit mode with known frame/scale preconditions and a visible exit. Missing calibration offers the specific source/control-point task, with measurement unavailable until resolved. |

## V3 mockup assessment

Paths below are relative to `design/officer-studio-v3/`.

| Image | Preserve | Required revision for bulk-first design |
| --- | --- | --- |
| `02-map.png` | Large canvas, one inspector, subdued surroundings, visible 3D/2D and Layers, clear fictional dataset label. | Add visible Select, Floor isolate, Section and Underground alongside Fit/Reset; show active mode and uncertainty legend. One amber “2 checks” row is insufficient to explain which geometry is uncertain. Selected building must identify proposed 3D ID and linked official parcel assertion distinctly. Illustrated scale and textured neighborhood cannot count as evidence of calibrated geometry. |
| `03-register.png` | Large exploded model/table split; synchronized space selection; selected source filename/page; “Separate floors — Display only”; quiet tabs. | “Record” column does not identify system-generated proposed 3D IDs. Add parcel entity and official 2D assertion provenance, Rights, Relations, source revisions and geometry revisions. Support one space across floors/parcels, shared stairs, basements and absent geometry. Section needs a real active-state design, not just a button. |
| `04-work-queue.png` | Readable actionable rows; one Add files action; needs-attention filtering; no onboarding clutter. | It lists properties/workspaces, not batches. Replace with batch name, source counts/types, processing progress, linked entities, review exceptions and next action. A batch may contain many properties or initially no resolved property. “Recorded” must support partially recorded batches. |
| `05-add-files.png` | Multiple different formats in one drop zone; file metadata; collapsed advanced settings; originals retained; concrete missing-role question. | Two files and one boundary-role field do not prove heterogeneous batch handling. Show many files and independent receipt/processing states, automatic page/layer classification, suggested entity links, duplicates, unsupported/failed items and per-item retry. Ambiguity blocks affected items, not unrelated ready records. |
| `01-plan-review.png` | Wide source canvas, suggested labels, source location for a dimension, explicit missing floor-level source, saved draft and deferred finish. | Single-property heading and universal three-step wizard mask batch context. Add batch breadcrumb, exception position/count and target entity. Provide accept/change/reject for a specific proposed link or fact, including source conflict comparison. “Confirm details & continue” must identify the decision scope and cannot imply all evidence was reviewed. |
| `06-check-and-record.png` | Before/after ground-floor counts; unchanged other floors; source-backed levels; statement that recording creates a revision. | A fixed all-green checklist does not demonstrate validation. Add selectable entity/revision scope, changed geometry/evidence/rights/relations summary, check time and input fingerprint freshness, blockers vs warnings, deferred items, and partial recording result. Show proposed system IDs explicitly; recording is technical, not official issuance or legal approval. |

## Priority remedies

### P0 — Structure and truthfulness before image generation or implementation

1. Make Batches, Map and Register the only top-level officer navigation. Batches is a directory and work entry point; Map and Register open directories unless a contextual entity link is used. Contextual review preserves batch, source, selection and return position.
2. Establish the visible entity model. Parcel holds an existing official **2D ULPIN assertion**, with source and revision. Building, floor and space display **proposed system 3D IDs** as technical identities. Demonstration IDs are explicitly fictional. A missing official parcel ID is missing, never synthesized.
3. Keep rights separate from geometry and occupancy/usage. A right references its subject, holder/party where supplied, evidence and revision; geometry does not prove ownership. Show unknown/contested/unreviewed states without invented legal outcomes.
4. Design many-to-many links and vertical relations: one source to many entities; many sources to one entity; building/space spanning parcels; space spanning floors; shared stairs/circulation and underground space. Never encode these only by copying a space under multiple parents.
5. Separate source receipt, suitability, suggested classification/link, draft geometry, validation and recording. A successful upload is not a validated record. Automation creates inspectable suggestions and exceptions, never unsourced geometric certainty.
6. Make record scope explicit. Show selected entities and proposed revisions, changes and check freshness; ready records can be recorded while clearly identified unresolved items remain in the batch. Revision creation preserves originals, canonical IDs and earlier revisions.

### P1 — Usable spatial review

1. Keep 2D/3D, Select, Floor isolate, Section, Underground, Layers and Fit/Reset discoverable in the map's primary tool area; group secondary actions without hiding these in an overflow menu. A disabled tool explains missing geometry/source prerequisites.
2. Show one contextual inspector at a time. Layer browser and exceptions list are drawers; avoid a permanent full entity list, repeated photo and bottom findings tray all competing with the map.
3. Use stable selection color plus a separate conflict overlay. Add legend labels/patterns for recorded geometry, proposed geometry, uncertain placement, missing levels and selected extent. Render missing geometry as unavailable; no substitute solid boxes or invented heights.
4. Preserve selection, batch/entity identity and viewport on navigation between map, evidence and register. Exaggerated/exploded floors are explicitly display-only, with source elevations unchanged.
5. Tie every displayed numeric area, distance, height and conflict to source or actual computation in a named local-metre frame and vertical benchmark. Distinguish values read from documents from values computed from geometry.

### P2 — Density and consistency

1. Reuse a compact header and two primary content regions for detail tasks. Give the working canvas priority; show exact source/selection context once.
2. Replace duplicated metrics with a contextual selection summary. Use real lists and tables for bulk work rather than oversized cards.
3. Use a single internally consistent specimen across all screens, including IDs, geometry, sources, levels, exceptions, batch counts and revision states. Label illustrative mockup counts; replace them with computed values in implementation.
4. Keep local and fictional context visible, without fabricated profile, municipal endorsement or version branding.

## Proposed visual tokens

These are implementation targets inferred from the inspected visual language, not sampled or verified source CSS.

| Token | Target and use |
| --- | --- |
| Canvas/surface | `#F7FAF9` application background; `#FFFFFF` panels; flat surfaces with restrained borders. |
| Primary ink | `#15232B`; secondary text `#586879`; avoid faint blue-gray text for critical source/status information. |
| Brand/action | Forest green `#145D49`; active text `#0F493B`; light active background `#E9F3EE`. One filled primary action in a task region. |
| Border/focus | Hairline `#DCE5E5`; visible 2 px focus ring `#267A62`, offset from the control. |
| Review/failure | Amber `#9A5B00` on `#FFF5DF` for review; red `#BA2D2D` on `#FFF0EF` for a blocking failure. Each includes icon and text, never color alone. |
| Spatial semantics | Green outline/light fill for selection; dashed amber for uncertain proposal; solid/dashed patterns separate source/recorded/proposed roles. Blue can distinguish utility/evidence context; conflicts use a separate red overlay. |
| Typography | Existing legible sans family; body/table 14–16 px, section 18–22 px, page title 24–30 px. Tabular numerals for quantities; long IDs copyable and expandable rather than unreadably compressed. |
| Spacing | 4 px base; 8 px related controls, 12–16 px panel padding, 20–24 px main gaps. Compact batch rows approximately 56–72 px, expanding for exceptions. |
| Controls | 40–44 px desktop control height; at least 44 px primary action hit area; 6–8 px radii. Avoid pill-shaped cards or heavy shadows for every item. |
| Layout | Header approximately 64 px. Context row only when needed. Inspector approximately 340–400 px at large desktop sizes; collapsible. Primary map canvas remains at least 60% width with one inspector at 1440 px. |

Final colors must be checked for readable contrast; the hex targets alone are not accessibility acceptance.

## Screen acceptance criteria

### 1. Batches directory

- Shows Batches / Map / Register, dataset context, global search and one New batch action.
- Table demonstrates a mixed-source batch, a processing batch, a batch with exceptions, and a partially recorded batch. Counts are mutually consistent and status text distinguishes received, processing, review and recorded.
- Each row communicates sources, linked entities, unresolved exception count and next action without entering the batch. Ready work is not concealed by unrelated failed items.
- Can resume the exact batch without selecting a property first; empty state uses the same intake action rather than a second onboarding interface.

### 2. Mixed-source intake and batch overview

- Demonstrates a single upload containing supported spatial files, PDF plans, scanned images and a level schedule; source-type detection is per file/page/layer where relevant. No single format selection gates the drop zone.
- Each source shows receipt/processing status and retained-original identity; source metadata and coordinate reference are auto-read when available. Unknown is explicit.
- Overview shows suggested source roles and entity links with the reason/evidence, plus unmatched, conflicting, duplicate and failed items. The officer can correct a link and retry a failed item without repeating the batch.
- Automatic classification success does not visually imply geometry validation or official registration. Unsupported sources remain visible as retained evidence when supported by the product, with their processing limitation stated.

### 3. Exception review detail

- Batch breadcrumb, exception count/position, source revision and target entity remain visible. One current decision has accept/change/reject or a similarly concrete action.
- Source and proposed overlay are legible side by side; provenance navigates to exact page/region/layer/row. Conflicting sources can be compared without leaving the batch.
- Covers an ambiguous parcel link, absent floor levels, and uncertain scale/placement as distinct states. Each exposes only the missing input and shows the effect of resolving it.
- Manual trace, measure, calibration and compare remain reachable as deliberate modes; their prerequisites and active mode are clear. Draft save and deferred review preserve the current context.

### 4. Map

- Separate demonstrated states: 2D footprint/parcel, selected 3D building, isolated floor/space, section, underground and uncertain/missing geometry. A single scenic 3D screenshot is insufficient.
- 2D/3D, Select, Floor isolate, Section, Underground, Layers and Fit/Reset are readable without opening a generic overflow. Active controls and available keyboard help are clear.
- Selection in the map agrees with entity type/ID and linked relations in the inspector. Parcel and building can be selected independently. Layer toggles include source/recorded/proposed and can reveal uncertainty.
- Section identifies cut orientation and benchmark; underground distinguishes known depth from unknown. Floor isolate and exploded display never change measured coordinates.
- One findings/exception surface links to the corresponding geometry and supporting source. No fixed uncomputed measurement, fake conflict number, unexplained “verified” badge or decorative scale presented as survey truth.

### 5. Register directory and entity detail

- Root retrieves records by entity type, official parcel 2D ULPIN or proposed system 3D ID. Detail preserves the surrounding parcel/building/batch context.
- Synchronized model and expandable floors/spaces table show selected entity once. Long IDs, source-backed area/levels and missing geometry states remain legible.
- Parcel official-ID assertion is visibly distinct from proposed building/floor/space IDs. Rights and Relations are separate from geometry; demonstrate a multi-parcel building, cross-floor space and shared circulation relationship without duplicated identities.
- Evidence and History reveal original source revision, geometry revision, assertion/review provenance and preceding revisions. Geometry updates do not overwrite evidence or imply rights changes.
- Scoped export states selected entities/revisions and available geometry, and includes original evidence where requested; no invented geometry fills a missing scope.

### 6. Validate and record selected scope

- Shows selected batch items/entities and proposed revision changes, including additions, updates, unchanged context and explicitly deferred items. Visual selection corresponds exactly to the record action's scope.
- Checks separate blocker/warning/pass/not-run states, identify supporting inputs and report whether results are current. Changing inputs makes stale validation visible.
- Demonstrates both blocked recording and a ready subset. Unsupported/invalid items cannot silently enter the selected scope; partial recording leaves a resumable remainder.
- Success states exact recorded revisions and remaining exceptions. It says technical recording and proposed system IDs, never official ID issuance, title approval or statutory acceptance.

## Review gate

Before accepting the next design pack, compare each proposed screen with its relevant original reference and V3 counterpart at the same desktop size. Check the entity/ID/source/revision specimen across screens. Require actual browser captures and real interaction evidence later for implementation acceptance; generated reference art cannot demonstrate functioning bulk ingest, calibrated measurement, relation integrity, preserved bytes or revision history.

## Prototype review

Reviewed the isolated prototype at `http://127.0.0.1:3012/` on 20 September 2026 using Playwright and `scripts/spatial/browser-launch.mjs`. Captured and visually inspected Batches, Import, Exception review, Record, Register directory/detail, Rights & links, Evidence and History. Desktop viewport: 1440 × 1000; tablet: 900 × 900. Map behavior is owned by the separate map review and was not retested here. Port 3000, live app, seed data and prototype code were not changed by this review. Clicking prototype selection/record controls was confined to the disposable browser tab; these are explicitly local demonstration actions.

Evidence is in `.runtime/t071-review/`: `review-desktop-*` and `review-tablet-*` capture the initial review; `review-final-*` capture parent fixes; `snapshot.json`, `interaction-snapshot.json`, `final-interactions.json` and `partial-interaction.json` record observed text and selected interactions. This is a moving prototype; findings below describe the inspected state, not a guarantee that later edits retain it.

### Improvements verified during review

| Check | Observed result |
| --- | --- |
| Bulk visual hierarchy | Clear Batches / Map / Register navigation, one import action, readable batch rows, restrained green/white surfaces and a persistent fictional-data label. No horizontal document overflow on the initially tested five routes at either viewport. |
| Source count | Initial Import claimed seven entries but displayed three. Parent corrected it; final desktop/tablet captures show all seven: three embedded fictional sources and four explicitly metadata-only descriptors. This accurately distinguishes the three actionable source-backed batches from the seven-entry sample package. |
| Register navigation | Initial root opened Neem Court directly. Parent corrected it to a directory with twelve buildings and a search control; searching “Unmeasured” returns the one matching building. Detail is now `#register/B01`. |
| Recording density | Initial 27-object list made the page roughly 2,820 px high. Final capture shows a bounded table, compact rows, persistent table header and summary, plus Select ready / Clear. At tablet width the summary remains legible; its bottom action requires page scrolling. |
| Missing height | B12 is explicitly footprint-only, has no guessed height/extrusion, remains blocked for 3D recording and is excluded by a disabled unchecked control. Other eleven buildings can proceed. |
| Count arithmetic | BATCH-01 has twelve parcels + twelve buildings + three roads = 27 objects. Default scope selects 26 with B12 excluded. BATCH-02 shows four floors and twelve spaces; BATCH-03 one utility. |
| Parent/child selection | Unchecking Plot 01 deselects Neem Court. Selecting Neem Court includes Plot 01 again. Clear followed by Neem Court selection gives exactly two selected objects. |
| Partial recording flow | Recording that two-object scope produces a local receipt for two objects, retains the B12 exception, and changes BATCH-02 from Waiting for parent to Ready for review. No live recording capability is inferred. |
| Identity and rights | Detail explicitly distinguishes the proposed building ID from “Official parcel 2D ULPIN — Not supplied.” Vertical limits name a fictional benchmark. Rights remain unverified and geometry is not presented as ownership proof. |
| Readable evidence — final recheck | Source viewer now leads with source locator/revision, identifier, feature type, name, height, elevation, usage, floors, address and coordinate frame. Original file is explicitly absent from this fixture. Raw JSON is collapsed under Technical source record. |
| Inspectable right — final recheck | Shared access opens RIGHT-01, its three distinct common-circulation space IDs on floors 1–3, source record SR-B01-F1-C and “Legal authority — Not established.” This demonstrates one asserted right spanning several spaces without asserting ownership. |
| Recording scope — final recheck | Included links and revisions shows 26 geometry revisions and eleven parcel/building relationships in the default BATCH-01 scope; each relationship includes its ID and evidence record. The fixture names geometry version 1 and retains source/object identity. Changing selection after acknowledgement unchecks acknowledgement and disables Record until acknowledged again. |
| Partial progress — final recheck | After recording Neem Court and Plot 01, BATCH-01 displays “2 recorded · 24 ready · 1 blocked” alongside Needs attention. The unresolved exception remains actionable. |
| Contextual navigation — final recheck | Register detail returns to Property register and separately offers Locate on map. Prepare an update routes to `#import/B01`, where “Update for Neem Court” preserves the selected property and explains comparison with retained identity/revisions. |

The final recheck was one bounded desktop browser pass, not a repeat of the full viewport suite. New evidence: `review-recheck-evidence.png`, `review-recheck-right.png`, `review-recheck-scope.png`, `review-recheck-counts.png`, `recheck-first.json` and `recheck-final.json`. These supersede the initial evidence-viewer, rights-scope, recording-summary, partial-progress and contextual-navigation findings.

### Remaining priorities and acceptance limits

| Priority | Concrete issue and officer impact | Recommended next change |
| --- | --- | --- |
| P1 | The source viewer is now readable, but it shows authored fixture facts rather than actual survey documents with located overlays. No source-image alignment, document dimension extraction or page-region evidence review is established by this pass. | Retain truthful fixture labels. Validate real document/source previews, located evidence, calibration and comparison through later supported-source work before accepting those capabilities. |
| P1 | Recording scope is inspectable and acknowledgement becomes stale when selection changes, but the three checks remain illustrative. There is no demonstrated server validation run, input fingerprint freshness or comparison of changed/retained geometry revisions against persisted records. | Preserve the prototype limitation. Later show real check results, input revision fingerprints, geometry/relation diffs and immutable recording receipts. Selection acknowledgement is not validation freshness. |
| P2 | The right specimen now covers several floor spaces, but a single cross-floor space and a multi-parcel building are not concretely demonstrated in the reviewed register screens. | Add supported examples and inspectable relation/revision histories when available. Do not imply that three linked spaces are one duplex space, or fabricate rights to fill the example. |
| P2 | The seven-source organising state shows Matched/Metadata only but no concrete editable entity-match explanation. The only exception specimen is absent height. | Add a bounded ambiguous-link example with source location, suggested target, matching reason and Accept/Change/Defer. This is required before claiming the auto-link/review-exceptions design is complete. |
| P2 | Search placeholder is clipped; source-type squares abbreviate utility/control/elevation to “utili”, “surve”, “eleva”; one result reads “1 buildings.” Register remains building-only. | Widen the search field, use clear icons or complete short labels, correct count grammar and add entity-type retrieval when parcel/floor/space/rights directories are in scope. |

The non-map layout is suitable for continued prototype review at the tested sizes. The final fixes address the concrete evidence readability, right-scope inspection, recording-scope visibility, partial-progress and contextual-navigation defects found in this pass. The reviewed screens do **not yet satisfy the full acceptance criteria above** for actual document overlays, real classification/inference, ambiguous matching, persisted revision comparison or multi-entity retrieval. They also do not establish real heterogeneous ingestion, persisted audit history, server validation, source-byte preservation, native survey solids/topology, standards conformance or official identity issuance. Those are capability/acceptance limits, not claims that the revised prototype controls are broken.
