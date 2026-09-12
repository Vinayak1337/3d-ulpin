# APPENDABLE PROJECT HAND-OFF — REVIEWED ADDITIONS AND GUARDRAILS

## 1. How this addendum applies

This supplements the main prompt for the 3D ULPIN / Vertical Property Mapping project. Complete the main prompt’s requested task and format; apply only the relevant parts below. Do not turn a narrow task into a full redesign, require every feature in every deliverable, or reproduce this review as public-facing project content.

The baseline below records our established direction. The additions come from a reviewed supplemental proposal; the corrections and priorities are our engineering conclusions, not a verbatim endorsement of that proposal. Everything remains proposed unless implementation, data access, or test results are actually demonstrated. Explicit newer user decisions take precedence; otherwise flag material conflicts rather than silently changing the architecture.

## 2. Preserve the established product

We are building a task-oriented mobile-and-web system for creating, reviewing, and maintaining evidence-linked 3D property records—not merely a city viewer or an automated ownership generator.

Its core value is boundary-level evidence, actionable validation and missing-information requests, and change-impact previews. Physical observations, rights-related spatial units, source documents, and review decisions remain separate but linked.

The mobile companion handles assigned cases, evidence requests, photos/notes, imported measurements, offline drafts, and explicit synchronization states. The web workbench handles precise alignment, linked plan/3D editing, findings, and initial final spatial acceptance. Both use one registry. Phone location is contextual evidence, not automatically a surveyed property boundary. Offline edits never silently overwrite accepted revisions.

Preserve the proposed stack: Next.js/React/TypeScript and CesiumJS with a linked 2D editor; Expo/React Native/TypeScript with local SQLite for mobile; one versioned application API; PostgreSQL/PostGIS; private object storage; and Python/FastAPI processing with Celery/Redis. SQLite persistence does not supply synchronization or conflict resolution by itself. The application controls permissions, acceptance, and identity; workers return proposals and findings. These additions do not justify replacing the application backend or introducing many microservices or a separate graph database.

## 3. Retain these useful additions

### A. Optional BIM/IFC-assisted preparation

Add a narrowly supported IFC import route alongside—not instead of—the plan-based route. Proposed tool: IfcOpenShell in the Python subsystem.

The workflow is import → inspect building/storey/space information → check geometry, units, placements, and georeferencing → let an operator map or group spaces into candidate units → validate and review.

Do not equate an IfcSpace with a legally registered apartment. Do not assume every IFC file contains complete, usable, globally aligned geometry. Record source revision, source object identifiers, transformations, and operator mapping decisions. Unsupported content produces an explicit limitation, not fabricated geometry. Implement after obtaining a suitable sample; universal BIM support is not an MVP dependency.

### B. Observed / Recorded / Compare views

Expose three coordinated modes: observed physical model; recorded spatial units; and comparison. Show source dates, geometry revisions, and whether each record is draft or accepted.

A visible difference is “requires interpretation,” not automatically a violation. Physical walls, registered unit boundaries, and utility-rights volumes need not coincide. Selecting a difference should open its evidence and review case. Reuse the existing viewer and record relationships.

### C. Vertical inspection

Add a defined “what is above, below, or inside?” query. For example, select a point or small footprint and inspect a vertical column over a stated elevation range.

Return intersected recorded spaces ordered by elevation, with identifiers, type, status, and evidence links. Declare the query footprint/buffer, reference system, selected revision/time, and data coverage. Apply permissions. No result means no match in the available authorized records—not proof that no structure, right, or utility exists.

### D. Observation-triggered maintenance

Keep two different capabilities distinct:

- Change impact: a source or boundary is revised; identify dependent records and stale validation results.
- Observation-based change detection: newer physical observations differ; open a candidate review case.

The extension is new observation → possible exterior change → review case → field evidence request → verified candidate update → affected-record preview → acceptance.

Start with observable footprint or exterior-height discrepancies. Do not infer a new legal floor or hidden basement merely from roof imagery. No detected change is not proof that every record remains current. Mobile can support “Report observed change” before automatic detection is implemented. Neither path directly overwrites accepted records.

## 4. Strengthen evidence and time semantics

Boundary evidence must support the relevant component: footprint, lower limit, upper limit, or alignment. Retain source revision, page/region or measurement reference, method, units, reference systems, quality information, and transformation history.

Add a measurement basis for reported quantities: quantity type, boundary convention, included/excluded spaces, method, units, uncertainty, and source revision. Compare like with like. Areas using different conventions must be marked non-comparable until the difference is resolved; do not average them into apparent agreement.

Record source ancestry. Multiple products derived from one upstream estimate are not independent corroborating measurements. In particular, the review identified GOBS height information as derived from Google’s temporal product; check the exact release and attribute lineage before combining evidence.

Distinguish effective time from recording time: when a record or right is stated to apply versus when the system received or recorded it. Unknown effective dates remain unknown, not silently replaced with upload dates. Keep geometry, rights, evidence, and review revisions linked. This is a data-model refinement, not a requirement to build an elaborate “4D” interface immediately.

## 5. Dataset leads, not acquired project assets

The review identified these acquisition candidates. Availability and permissions were not established by downloading and testing every dataset; re-check the current source, licence, access conditions, and intended-use permission before relying on one.

- UAVPal, Bhopal: candidate imagery/DSM/label data for Indian urban extraction experiments. Check exact files and reuse terms.
- TALD, Thiruvananthapuram: candidate outdoor point-cloud classification data. The review flagged an eligibility/request-based access route; do not assume unrestricted immediate download or interior-floor observations.
- IIT Roorkee Delhi UAV data: a permission-dependent photogrammetry candidate. The review flagged research-use and demonstration restrictions; obtain authorization appropriate to the intended showcase.
- P³, Pixels, Points and Polygons: a matched imagery/LiDAR/building-polygon candidate for multimodal experiments. Start with a suitable subset; it is not evidence for an unrelated Indian demonstration site.
- GOBS and Google Open Buildings 2.5D: context, baselines, and exploratory monitoring. Estimated heights/floors are not surveyed apartment boundaries; preserve upstream dependence.
- Bhopal LiDAR repository: an acquisition lead, not a confirmed ready-to-download dependency. The review found incomplete download information.
- buildingSMART IFC samples: candidate importer fixtures, not proof of cadastral correctness or legal unit definitions.

Maintain separate collections for a coherent end-to-end case, independent importer tests, and model training/held-out evaluation. Do not overlay unrelated cities as one survey. Even datasets from the same city require verified spatial coverage and compatible reference information. Check acquisition dates, resolution, height references, uncertainty, permissions, and source ancestry—not just bounding-box intersection.

A controlled synthetic case supports deterministic tests and a repeatable demo. It does not prove real-world extraction accuracy. Include an unfamiliar or held-out case and label synthetic parties, rights, measurements, and layouts accurately.

## 6. Correct the supplemental proposal’s risky assumptions

### Quality is not one approval score

Keep measurement quality, extraction scores, evidence completeness, geometry findings, and review status separate. Do not adopt an arbitrary weighted “trust score” or a “greater than 95% → accepted record” rule. A model score is not automatically a calibrated probability. A strong score cannot cancel missing mandatory evidence or a failed geometry check. Automated prechecks may mark a candidate ready for review; accepted status still follows the configured review workflow.

### A sensor can support only what it observed

Point-cloud floor detection requires relevant observed surfaces. Record acquisition type and coverage. Outdoor airborne points do not automatically establish internal slabs, apartment boundaries, or underground utilities. Total height divided by assumed floor height remains an estimate. Prefer suitable plans, sections, interior measurements, or reviewed BIM for interior limits.

### Elevation-product names are insufficient

Read product metadata; do not assume every file called “DEM” is bare-earth terrain. Height estimation requires a suitable surface model and compatible bare-earth reference, with checked alignment, vertical datum, units, resolution, and acquisition context. Coarse background elevation data cannot establish precise apartment levels.

### Metric calculation and solid validation need explicit contracts

Use an appropriate metric computational frame with compatible vertical units; do not calculate metre-based distances or cubic-metre volumes directly from longitude/latitude coordinates merely because they contain Z values. Preserve and document transformations to display/export coordinates.

A 2D-valid polygon is not proof of a valid 3D solid. A closed-looking mesh or PolyhedralSurface label does not guarantee that the selected operation treats it as a volume. Test supported solid construction, validation, intersection, and volume operations in the actual deployment. Keep stored boundary geometry separate from display meshes. Unsupported operations must fail visibly, not return misleading measurements. For constant-footprint extrusions, test volume = area × height; round only for display.

### Topology rules depend on meaning and declared coverage

Do not enforce “apartment inside floor inside building inside parcel” as a universal chain. A surface polygon is not automatically an infinite ownership volume; units may span storeys and infrastructure may relate to multiple parcels.

Boundary contact differs from positive-volume overlap. Shared spaces, containment, compatible rights, historical revisions, and mutually exclusive units require different checks. Run gap/completeness checks only where the selected model declares a complete partition; shafts, structural spaces, unallocated space, and unmapped regions are not interchangeable. Keep numerical tolerance separate from measurement uncertainty.

### Stable identity is not a geometry hash

Preserve supplied official ULPINs. New 3D identities remain a proposed prototype profile, not an authorized government numbering scheme or title certificate. Draft/internal identifiers can exist before review; publication as a reviewed record cannot precede acceptance.

Use stable IDs, versioned geometry, idempotent requests, and versioned fingerprints for duplicate investigation. Identical geometry does not automatically imply the same record, rights, or time period. Do not silently merge records or change the stable ID after a coordinate correction. Preserve predecessor/successor links for splits and merges.

## 7. Integrate without expanding the core unnecessarily

Preserve these logical modules: cases/access; mobile capture/sync; import/provenance; assisted extraction; unit construction; validation/evidence requests; change impact; review/identity/history; and search/export/planning. They are not nine separate services.

Keep the phase order: data and geometry feasibility → manual end-to-end web/mobile slice → reliable offline field workflow → signature review tools → evaluated AI/richer imports → reuse and pilot hardening. Fit the additions into those modules and phases rather than inventing another architecture.

Design now: measurement basis, source ancestry, temporal fields, geometry/identity contracts, and the optional IFC interface.

Build with the core review experience: evidence requests, coordinated physical/recorded comparison, permissions, exact-revision acceptance, and dependency-based change impact. Keep the thin mobile evidence loop early, followed by tested offline synchronization.

Build after spatial queries are reliable: vertical inspection and the cross-parcel planning example.

Defer until inputs and workflow are proven: broader IFC support, automatic observation-based maintenance, arbitrary complex solids, and citywide scale. Access control, audit history, versioning, and a basic underground example are not final-polish extras.

The core case remains one parcel, one two-storey building with four apartments, shared circulation, a basement, and a deliberate draft overlap. The extension adds a second parcel and a corridor linked to both. Do not enlarge the core merely to match a more elaborate external proposal.

## 8. What a good result demonstrates

A reviewer selects U03, inspects its boundary evidence, requests missing information through mobile, receives the same evidence reference on the web, corrects a draft, previews dependent-record changes, and accepts an exact revision. Current accepted records remain protected throughout. The unit can then be retrieved by its prototype identity and exported with its relationships intact.

Use genuinely computed findings and persisted relationships—not demo-specific messages. Test valid boundary contact, positive-volume overlap, permitted relationships, missing references, incompatible measurement conventions, stale approvals, offline conflicts, duplicate retries, and affected-record propagation.

Evaluate raw AI proposals separately from corrected results, and measure correction effort, evidence-retrieval effort, review completion, and missed findings. Do not invent accuracy, practitioner feedback, dataset permissions, live integrations, official adoption, or global novelty.

For product explanations or videos, show these tasks rather than technology inventories. Clearly distinguish observed geometry, draft proposals, and accepted prototype records. Include new extensions only when relevant and label unimplemented features accordingly. Keep review methodology and internal prioritization out of the public-facing deliverable unless requested.

The enduring product promise is: understand what is observed, what is recorded, why they differ, and what needs review before a record changes.