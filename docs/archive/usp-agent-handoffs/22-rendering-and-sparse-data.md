# 22 — Progressive asset delivery, source sufficiency and late evidence

**Current scope, 26 September 2026:** [Delivery policy](current-delivery-policy.md) takes precedence over older sections and H97 addenda. All active work is backend-only: services, processing, data, security and API contracts for the user-owned UI. The user authorizes assigned backend plan tasks in separate worker worktrees; frontend technology and implementation remain untouched. The [normalized backend decisions](backend-streaming-plan.md) govern streaming, scale and migration. All public-portal work remains full product. Use unchanged official sources; unavailable coverage stays unqualified.

**Backend ownership:** FND owns geometry/source/asset contracts, INGEST progressive publication and LEARN deferred permitted estimators. The user owns rendering and visual acceptance; no renderer or frontend implementation is assigned. H99 preserves selection/access contracts.

## A. Existing renderer compatibility boundary

Preserve existing consumers during backend migration. The user owns frontend technology and renderer selection; this plan makes no frontend dependency or replacement decision. Backend assets preserve source shapes, semantic/pick identity, bounds, units, reference frames and qualified transforms. Display clipping proves no volumetric intersection. Existing Three helpers remain compatible; do not schedule a renderer migration, new viewer or library installation.

FP-RENDER remains a deferred compatibility/research commitment only. Any later user-authorized renderer experiment needs identical source assets, metadata/codecs and measured consumer evidence; no backend-only test establishes picking, clipping, camera or GPU behavior. Helsinki supplies source/provenance context, not Indian property rights or a new required rendering engine. Optional real foreign sources stay in their native geography under H28.

## B. Durable progressive asset delivery

Chunking is independent of whether interpretation is AI-assisted, learned or exact. Geometry is prepared and published in useful batches. SSE announces saved ready assets with version/identity contracts that allow the user-owned client to retain its selection/camera. Display-tile boundaries need not equal processing-chunk boundaries.

Keep existing bounded compiler profiles for compatibility. Add the private streamed output profiles and the required GF-STREAM/GF-SCALE-1 qualification in [the normalized backend plan](backend-streaming-plan.md); do not raise existing compiler/frame limits to simulate scale. A 10k/100k/1M backend corpus is navigated through a spatial index, not loaded into one frame or one browser array. In the full-product release, promotion of the learner may increase conversion throughput where measured; it does not bypass draw-call, network, memory or GPU budgets.

Expose stable IDs across LoD/tile seams, declared asset size/complexity, source-shaped geometry and deterministic derivative metadata. Keep processing fair and assets bounded. Lighting/material/outline behavior and client disposal are outside this backend assignment.

## C. Layer vocabulary and future enrichment (current scope restricted)

Current delivery renders official-source geometry and its traceable derivatives. The estimated/illustrative vocabulary below is retained for existing records and future design; it does not authorize generating missing source objects or facts. Generative expansion needs a new explicit user scope decision.


| Layer | Permitted content | Permitted use |
| --- | --- | --- |
| Evidence-linked | Original/source-asserted or reviewed geometry and quantities, with dates and references | Supported measurement/review after profile qualification; provenance does not automatically prove legal truth |
| Estimated interpretation | Predicted height/roof class or an uncertain source-derived outline, with method, range and validation domain | Optional labelled preview; no automatic evidence coverage, legal boundary or ownership conclusion |
| Illustrative presentation | Procedural facade detail, roof texture, neutral road ribbon, stylized placeholder massing | Visual context only; never copied into analytical geometry, official IDs, registry facts or training truth |

A known footprint with missing height remains a footprint with unknown height under the current official-source policy; no new illustrative extrusion is authorized. An estimated height needs a calibrated model and data support to be labelled a prediction; a constant or template is an illustrative assumption. A road centreline can be drawn as a styled ribbon, but that ribbon is not a recorded road-land polygon. Missing roads/buildings are not generated under the current official-source scope.

The evidence view is the default for recording and analysis. An explicit **Enhanced preview** toggle shows a persistent legend plus per-object labels; generated content is distinguishable without colour alone. Screenshots/exports containing it retain the legend/watermark and generation metadata. All-rendered content must not be selectable as a verified registry unit. Synthetic contextual objects have display IDs, not official/canonical property IDs.

## D. Poor-data behavior and insufficiency

| Available evidence | Planned behavior |
| --- | --- |
| Valid footprint + reliable height/reference | Source-shaped extrusion or supplied roof model; preserve source meaning |
| Footprint, no height | Source footprint only, with unknown height; no default extrusion. A permitted, qualified estimator is a separately labelled later route |
| Road line, unknown width | Draw source line; optional illustrative ribbon; disable legal road-width findings |
| Point/address, no footprint | Marker/list and evidence request; no fabricated property polygon |
| Geometry, unknown CRS or vertical reference | Retain; named local preview only when valid; global placement/3D comparisons blocked |
| Invalid topology, conflicting parents, severe missing geometry | Keep valid independent objects, expose exact errors; affected object is unplaced/unassessed |
| Only aggregate statistics or too little location evidence | Area-level context or source-only list; flag `insufficient_for_spatial_reconstruction` |

There is no arbitrary universal completeness percentage. A versioned `DataSufficiencyPolicy` evaluates the intended task and minimum evidence for location, footprint, height, reference and identity. Avoid both extremes: silently inventing facts and rejecting an entire useful batch because a few optional fields are absent.

A later visual-estimation model can learn heights/roof classes from permitted independently sourced examples using footprint geometry and relevant context. Evaluate on spatially held-out sites (Indian where available), report error/ranges and out-of-domain behavior, and abstain when support is inadequate. This is a different model from schema interpretation. Neither decorative output nor the system's own guesses become training ground truth.

## E. Registry and other evidence may arrive later

Map existence must not depend on a registry document, supplied ULPIN or complete floor plan. Give physical candidates stable application identities with nullable evidence/identifier links. Do not create placeholder owners, official ULPINs or guessed flats.

Later upload → retained revision → candidate association by exact identifiers first → ambiguity review → evidence link/new source observation → targeted revalidation → revised display/record if supported. A new authoritative height supersedes an estimate through a new revision; old sources, predictions and packets remain traceable. Do not rebuild all buildings for a new document. One building may span parcels; one unit may span floors; one stair can serve several units.

## F. Deferred public projection boundary

Full-product public APIs use released lookup, own-submission receipts, quarantine and access-checked sources under H13. Do not reuse officer sessions/caches/dossiers or infer that a released exterior releases every deed or floor plan. Keep known-format limits and permission/retention contracts. Public dashboard/frontend implementation is outside all active plans.

## G. Backend acceptance and unqualified consumer metrics

Validate persisted source-shaped assets, canonical identity maps, holes/reference metadata, bounded manifest/event delivery, stale removal, late evidence and permission/restart recovery. Derived styling must leave source hashes, quantities, readiness, rights, findings and exports unchanged. Insufficient geometry cannot become a complete cadastre; new evidence creates a traceable revision without changing physical identity.

Measure acquisition, preparation, conversion, first committed usable asset and service resource budgets separately. Historical consumer targets (first useful scene within 8 seconds, cached selection within 100 ms, frame-time p95 at most 33 ms on declared hardware) are unqualified external UI measurements, not a backend acceptance claim or assignment. Browser/GPU/camera/picking/accessibility and full-product runtime interaction checks require separately supplied user-owned integration evidence. No visual captures or renderer work is scheduled.

## Z. Hardening addendum (H97)

Added 24 September 2026 by the cross-family review in [H97](97-review-findings-and-alignment.md). Within the retained backend contracts this addendum resolves older detail; the current delivery policy and backend-only scope take precedence. Task cards: [H29](29-agent-task-cards.md) FND-04 and the H99 API compatibility contract; former UI-03 is retired.

### Z1. Two fields instead of one overloaded "layer"

"Three layers" means two different things across these docs. FND adds two separate fields to every geometry and display asset in `packages/contracts/src/usp`:

| Field | Values | Meaning |
| --- | --- | --- |
| `representation` | `context_mesh`, `physical_semantic`, `legal_space` | What the geometry is: a photogrammetry context mesh, a semantic building part, or a legal/rights volume |
| `geometryClass` | `evidence_linked`, `estimated`, `illustrative` | How much we can trust it |
| `analyticEligible` | boolean | True only for `evidence_linked` geometry that passed its qualification; FIND, READY, PACK, LEARN examples and the H26 export accept only these |
| `semanticLod` vs `displayLevel` | CityGML LoD label vs tile refinement level | Never use "LoD" alone |

Plus `DataSufficiencyVerdict {task, requirements[], outcome: sufficient | partial | insufficient_for_spatial_reconstruction, missing[]}`. Measurement is allowed only when `analyticEligible` and `representation` is not `context_mesh`. Display derivatives live in a separate store keyed by `recordId`; only the display compiler reads it.

### Z2. Where heights come from in India

| Height source | `geometryClass` | Analytic? |
| --- | --- | --- |
| Own nDSM with qualified control (H27 Z1) | `evidence_linked` | Yes, after checkpoint residual test |
| Historical third-party ML heights | `estimated`; not a current official-source input | No |
| Historical volunteered height/level tags | Retain provenance in history; not a current official-source input | No |
| Sanctioned storey count ("G+3", "S+4") | `evidence_linked` count | Count yes; count × assumed floor height is `illustrative` |
| CartoDEM (about 30 m) | Terrain context only | No |

### Z3. Indian level realities

Add `levelKind`: `stilt`, `basement`, `lower_ground`, `ground`, `mezzanine`, `typical`, `terrace`, `rooftop_structure`. Level order comes from the source, not elevation. Unknown elevations stay null; do not invent spacing or geometry. Hill buildings where the road entrance is "ground" keep the source's naming. Every value carries its unit or is `not_assessed`. Seek unchanged official-source GF-VIEW cases; missing coverage stays unqualified: storey count without heights ("4 storeys (source), height illustrative"), a footprint with no height rendered 2D and labelled "height unknown", a point with no footprint producing no polygon, a stilt floor and a mezzanine.

### Z4. Definitions for acceptance

- "First useful local scene" = the first frame where at least one persisted object is pickable with the correct `recordId`, timed from the first `scene.manifest_published`. Report receipt-to-scene time separately.
- Backend workers change no scene engine, framework, frontend dependencies or components. Existing consumers and their exact identity/reference/access contracts remain compatible until the frontend owner supplies a cutover. FP-RENDER is an external integration qualification, not a backend renderer-selection task.

### Z5. Finale Enhanced view and real reference area (25 September 2026)

[H30](30-reference-scene-and-incomplete-data.md) brings a bounded part of section C's Enhanced preview into `finale_v1`: deterministic presentation of official DEM, road/water/green and building geometry, with neutral materials, sun and shadows; no invented trees, dimensions or building detail over a real Indian reference area (DATA-09), with the sync rules in H30 D. The no-change assertion in section G moves from full-product enrichment qualification into GF-SCENE for this bounded view. Generative detail is a future option subject to renewed user authorization; it is not part of current implementation. Section D's poor-data table is extended by H30 E's fill / ask / park / reject decisions and question budget.
