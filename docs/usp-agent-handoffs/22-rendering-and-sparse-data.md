# 22 — Progressive rendering, visual completion and late evidence

**New handoff, 24 September 2026. Owner: UI; shared geometry/source services: FND; learned estimators: LEARN.** Preserve existing H99 selection, permission, disposal, V1–V8 and actual-product acceptance. This document adds the revised visual direction; none of its new capabilities has been runtime-qualified in this task.

## A. Rendering decision

**`finale_v1`: retain the current shared Cesium runtime used by the recorded D0/D1 workflow.** Qualify its actual source-shaped meshes, picking, basement visibility, clipping and frame placement; do not infer support from a Cesium demo using a different primitive type. Display clipping never proves volumetric intersection.

**`full_product`: evaluate Three.js + React Three Fiber + Drei behind the existing MapViewport boundary only for a measured unmet interaction/rendering need.** 3DTilesRendererJS is an optional candidate requiring decoder, metadata, selection, licence and cache qualification. It is not a committed engine migration or an installed capability. Test the same assets, camera and device against current Cesium before deciding. Maintain one active renderer lease and shared selection/cache semantics.

Helsinki 3D contributes an example of separate textured city context and semantic building models with source provenance. It is a city/data programme, not an alternative JavaScript engine. Use a permitted small native-coordinate sample for optional D2 visual tests; its model does not provide Indian apartment rights. See [H28](28-data-acquisition-and-finale-tests.md).

Use GLB/glTF assets, hierarchical 3D Tiles, local engineering origins for numerical stability, bounded caches and suitable level of detail. Qualified horizontal/vertical transforms remain shared domain operations. Start with the stable WebGL path; WebGPU is an optional measured upgrade, not a guaranteed speed fix. MapLibre/deck.gl, iTowns, Giro3D or Babylon.js are not additional mandatory engines. Introduce one only for a measured unmet capability, not to collect libraries.

## B. The map always streams progressively

Chunking is independent of whether interpretation is AI-assisted, learned or exact. Geometry is prepared and published in useful batches. SSE announces saved ready assets; the shared map fetches and adds them without resetting the camera. Display-tile boundaries need not equal processing-chunk boundaries.

Start with the existing 25–100 visible exteriors / 25 MiB visible-geometry profile and small selected interiors; keep existing compiler/frame limits until separately qualified. A 10k/100k/1M backend corpus is navigated through a spatial index, not loaded into one frame or one browser array. In the full-product release, promotion of the learner may increase conversion throughput where measured; it does not bypass draw-call, network, memory or GPU budgets.

Visual quality comes from source-shaped geometry, roof silhouette, consistent units, stable lighting/materials, selective contact shadows, outlines and careful interaction. Render decorative repetitions with instancing where qualified. Dispose assets/materials and keep selection IDs stable across LoD and tile seams. Prioritize a coherent local view and connected roads, while retaining fair queue scheduling.

## C. Three distinct layers, not one truth flag

| Layer | Permitted content | Permitted use |
| --- | --- | --- |
| Evidence-linked | Original/source-asserted or reviewed geometry and quantities, with dates and references | Supported measurement/review after profile qualification; provenance does not automatically prove legal truth |
| Estimated interpretation | Predicted height/roof class or an uncertain source-derived outline, with method, range and validation domain | Optional labelled preview; no automatic evidence coverage, legal boundary or ownership conclusion |
| Illustrative presentation | Procedural facade detail, roof texture, neutral road ribbon, stylized placeholder massing | Visual context only; never copied into analytical geometry, official IDs, registry facts or training truth |

A known footprint with missing height can have an optional illustrative massing view while the recorded height remains unknown. An estimated height needs a calibrated model and data support to be labelled a prediction; a constant or template is an illustrative assumption. A road centreline can be drawn as a styled ribbon, but that ribbon is not a recorded road-land polygon. Missing roads/buildings may appear only in a separately labelled illustrative scenario, not as purported observations of the actual area.

The evidence view is the default for recording and analysis. An explicit **Enhanced preview** toggle shows a persistent legend plus per-object labels; generated content is distinguishable without colour alone. Screenshots/exports containing it retain the legend/watermark and generation metadata. All-rendered content must not be selectable as a verified registry unit. Synthetic contextual objects have display IDs, not official/canonical property IDs.

## D. Poor-data behavior and insufficiency

| Available evidence | Planned behavior |
| --- | --- |
| Valid footprint + reliable height/reference | Source-shaped extrusion or supplied roof model; preserve source meaning |
| Footprint, no height | Evidence mode: 2D footprint. Enhanced preview: labelled illustrative massing; optional qualified height estimate later |
| Road line, unknown width | Draw source line; optional illustrative ribbon; disable legal road-width findings |
| Point/address, no footprint | Marker/list and evidence request; no fabricated property polygon |
| Geometry, unknown CRS or vertical reference | Retain; named local preview only when valid; global placement/3D comparisons blocked |
| Invalid topology, conflicting parents, severe missing geometry | Keep valid independent objects, expose exact errors; affected object is unplaced/unassessed |
| Only aggregate statistics or too little location evidence | Area-level context or source-only list; flag `insufficient_for_spatial_reconstruction` |

There is no arbitrary universal completeness percentage. A versioned `DataSufficiencyPolicy` evaluates the intended task and minimum evidence for location, footprint, height, reference and identity. Avoid both extremes: silently inventing facts and rejecting an entire useful batch because a few optional fields are absent.

A later visual-estimation model can learn heights/roof classes from permitted independently sourced examples using footprint geometry and relevant context. Evaluate on spatially held-out Indian sites, report error/ranges and out-of-domain behavior, and abstain when support is inadequate. This is a different model from schema interpretation. Neither decorative output nor the system's own guesses become training ground truth.

## E. Registry and other evidence may arrive later

Map existence must not depend on a registry document, supplied ULPIN or complete floor plan. Give physical candidates stable application identities with nullable evidence/identifier links. Do not create placeholder owners, official ULPINs or guessed flats.

Later upload → retained revision → candidate association by exact identifiers first → ambiguity review → evidence link/new source observation → targeted revalidation → revised display/record if supported. A new authoritative height supersedes an estimate through a new revision; old sources, predictions and packets remain traceable. Do not rebuild all buildings for a new document. One building may span parcels; one unit may span floors; one stair can serve several units.

## F. Separate public dashboard — full_product

Public: find released property, view permitted evidence status, report a discrepancy/missing space, upload allowed documents, answer clarification and track own submissions/notifications. Officer: compare sources, validate associations and approve an actual proposal through the existing registry workflow.

Share UI components and domain APIs, not unrestricted sessions, caches or records. A released map does not make every floor plan/deed public. Build the public dashboard as a distinct experience, not an officer drawer; preserve H13 authentication/quarantine/release/receipt rules and H01 permission checks. MVP public uploads remain bounded known formats; broader attachments get tested parsers, not an unrestricted upload promise.

## G. Acceptance

For the finale, run a real active-product camera path while qualified ingestion is active. Full-product learner qualification additionally runs that path during training. Verify pan/orbit/zoom, basement visibility, source-shaped roofs/holes, stable picks and no stale target information. The deferred renderer experiment compares current and candidate renderers with identical assets/camera/device; it cannot block finale acceptance. Keep previous V1–V8 regressions.

Proposed initial performance targets from the existing plan: first useful local scene within 8 seconds after admitted prepared inputs, cached selection feedback within 100 ms and desktop frame-time p95 at most 33 ms on declared reference hardware. Measure acquisition, source preparation and conversion latency separately rather than hiding them from end-to-end preview time. These are engineering targets, not achieved results.

During full-product enrichment qualification, toggle enhanced preview and assert source hashes, measured quantities, readiness, rights, findings and evidence exports are unchanged. Insufficient geometry must not become an apparently complete cadastre. Add real evidence and prove the estimate is superseded without changing physical identity. Ten repeated navigation cycles must not show continuing owned-resource growth after expected cache warmup. Software-WebGL screenshots do not qualify actual GPU performance.
