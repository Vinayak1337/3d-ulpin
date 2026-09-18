# Input family support plan
The original 25-family catalog is preserved; this table defines a delivery strategy, not verified format support. An input can be preserved, parsed, normalized as a candidate, and usable for a particular purpose at different times. A permissive upload alone never means all four stages passed.

A profile must name version, geometry/dimension limits, required sidecars, units/CRS/vertical references, field mappings, output types, safety/resource bounds, exact source locators, unmapped-field policy, operation-key semantics and qualifying fixtures. The same adapter can support one geometry layer while rejecting another. Parser installation is not semantic support.

## I01 — Existing 3d-ulpin records
Planned stage: **R1**.

Legacy read adapter and parity; new model does not replace historical IDs.

Boundary: Reconcile physical IDs and registry IDs explicitly; preserve previous identifiers and references.

Tasks: T009 T010. Actual capability remains to be verified on the named profile.


## I02 — Cadastral parcels and 2D ULPIN references
Planned stage: **R1 subset**.

Existing bounded parcel GIS/identifier profiles; no national issuance or validity claim.

Boundary: ULPIN alone supplies an identifier, not a boundary; preserve issuer, source validity and ambiguous matches.

Tasks: T004 T011. Actual capability remains to be verified on the named profile.


## I03 — Building footprints and city GIS
Planned stage: **R1 subset**.

Qualified current GIS footprint profiles with unknown heights and roof/ground roles.

Boundary: A roof outline is not automatically ground occupation; unknown height stays unknown.

Tasks: T007 T011. Actual capability remains to be verified on the named profile.


## I04 — Administrative boundaries and work areas
Planned stage: **R1 subset**.

Existing areas plus non-exclusive memberships; authoritative boundary integration deferred.

Boundary: Administrative hierarchy is not physical containment or ownership; coverage may overlap.

Tasks: T004 T028. Actual capability remains to be verified on the named profile.


## I05 — Roads, streets and paths
Planned stage: **R1 subset**.

Supported line/surface roads with explicit width/height; richer alignment formats are elected later.

Boundary: Centreline, physical surface and recorded road land remain separate; crossing does not prove connectivity.

Tasks: T011 T018 T053. Actual capability remains to be verified on the named profile.


## I06 — Rail, metro, bridges and tunnels
Planned stage: **R3**.

Extension boundary only initially; bridges/overpasses may be synthetic topology fixtures, not a full rail adapter.

Boundary: Do not infer a junction at an overpass or derive track geometry from service schedules.

Tasks: T018 T053. Actual capability remains to be verified on the named profile.


## I07 — Water, sewer, drainage, gas and telecom assets
Planned stage: **R1 subset**.

Supported utility/declared profile fixtures; actual as-built formats and accurate depth require evidence.

Boundary: Depth needs a reference surface; diameter is not a restriction width; keep unknown alignment/depth distinct.

Tasks: T007 T018. Actual capability remains to be verified on the named profile.


## I08 — Electricity networks and equipment
Planned stage: **R1 subset / R3 richer**.

Supported generic utility context only; full electrical connectivity/profile ingestion is later.

Boundary: Electrical connectivity is not identical to geometric proximity; overhead shape may be unknown.

Tasks: T018 T053. Actual capability remains to be verified on the named profile.


## I09 — Structured BIM
Planned stage: **R3**.

One selected IFC version/export profile per task; no complete or lossless BIM claim.

Boundary: Interpret units, nested placements and map conversion; IfcSpace is not automatically a registered flat; preserve unsupported constructs.

Tasks: T053. Actual capability remains to be verified on the named profile.


## I10 — Semantic city models
Planned stage: **R3**.

Selected CityJSON/CityGML profiles; semantic/placement and source LOD mappings tested.

Boundary: Do not equate source LOD with evidence completeness or flatten multipart objects into boxes.

Tasks: T053. Actual capability remains to be verified on the named profile.


## I11 — CAD plans, sections and alignments
Planned stage: **R3**.

CAD attachment preservation only if supported by a safe receipt path; semantic CAD extraction deferred.

Boundary: Units and layer meaning may be absent; a closed polyline need not mean a property boundary; SDK/dependency checks required.

Tasks: T005 T053. Actual capability remains to be verified on the named profile.


## I12 — Floor plans and building sections
Planned stage: **R1 attachment / R2 workflow**.

Existing permitted plan attachments; calibration and editing follow later interface gates.

Boundary: Attachment works without extraction. Scale, geographic placement and vertical placement are separate readiness gates.

Tasks: T005 T040 T044. Actual capability remains to be verified on the named profile.


## I13 — Floor, flat and room schedules
Planned stage: **R1 subset**.

Existing strict CSV level/space schedules and canonical interchange; arbitrary spreadsheets require a new mapping profile.

Boundary: A table does not imply room geometry; floor labels are not numeric heights; reported areas are not recomputed areas.

Tasks: T011 T012. Actual capability remains to be verified on the named profile.


## I14 — Survey control and measured features
Planned stage: **R1 existing controls / R3 expansion**.

Retain current named control/frame facts; new GNSS/total-station/LandXML profiles separately qualified.

Boundary: Raw/processed data must be distinguished; a CRS name alone does not establish vertical comparability or survey quality.

Tasks: T006 T054. Actual capability remains to be verified on the named profile.


## I15 — Raw GNSS and correction products
Planned stage: **R3**.

Raw GNSS assets and specialized processing are deferred; raw observations do not define parcels.

Boundary: Do not draw parcel boundaries directly from raw observations; specialized processing and quality review required.

Tasks: T054. Actual capability remains to be verified on the named profile.


## I16 — LiDAR and other point clouds
Planned stage: **R3**.

Typed cloud asset boundary now; real LAS/LAZ/E57 processing and segmentation deferred.

Boundary: No point-per-row requirement; sensor sampling and occlusion do not prove interiors, ownership or complete watertight solids.

Tasks: T007 T054. Actual capability remains to be verified on the named profile.


## I17 — Terrain and surface elevation
Planned stage: **R1 declared ground fixture / R3 raster**.

First renderer can use explicit synthetic/base ground; true DEM/DTM/DSM ingest needs a qualified coverage profile.

Boundary: Do not silently use top-of-roof DSM as bare ground; vertical datum, gaps and resolution are mandatory metadata.

Tasks: T018 T054. Actual capability remains to be verified on the named profile.


## I18 — Aerial imagery and photogrammetry
Planned stage: **R1 permitted context / R3 photogrammetry**.

Aerial context remains attributed evidence; georeferencing/reconstruction is not assumed from screenshots.

Boundary: An ordinary screenshot is not a georeferenced survey; preserve acquisition date, resolution and processing lineage.

Tasks: T005 T054. Actual capability remains to be verified on the named profile.


## I19 — Existing visual 3D models
Planned stage: **R1 supplied assets subset**.

Use existing revision-bound models and compiler outputs; qualify formats/metadata and distinguish display from analytical suitability.

Boundary: A visually rich mesh may have no interiors, usable semantic IDs, watertight solid or measurement suitability.

Tasks: T017 T020 T021. Actual capability remains to be verified on the named profile.


## I20 — Land/building registration and property records
Planned stage: **R1 existing registry / R3 external**.

Adapt existing records; authorized external registry connectors and legal validation are separate.

Boundary: Record metadata without geometry remains searchable but unplaced; a document scan or importer is not legal adjudication.

Tasks: T009 T055. Actual capability remains to be verified on the named profile.


## I21 — Residents, occupancies, leases and organizations
Planned stage: **R3**.

Define private identity separation now; real resident/lease data and full access system are later authorized work.

Boundary: Living in a flat, owning it and logging into the app are distinct. Do not put PII or agreement URLs in public tiles.

Tasks: T005 T049 T055. Actual capability remains to be verified on the named profile.


## I22 — Water bodies, vegetation, terrain use and context
Planned stage: **R1 supported context / R3 richer**.

Render supplied/declared contextual shapes only; ecology, water level and land-cover ingestion need profiles.

Boundary: A shoreline, bed, flood envelope and measured water level are different representations.

Tasks: T018 T054. Actual capability remains to be verified on the named profile.


## I23 — Web services and continuously delivered datasets
Planned stage: **R1 existing service paths / R3 expansion**.

Retain existing bounded acquisition where available; every new service needs paging, rights and completeness checks.

Boundary: Protocol is not a domain type; WMS images are not raw features; handle paging, rate limits, rights and incomplete acquisitions.

Tasks: T011 T049 T053 T054. Actual capability remains to be verified on the named profile.


## I24 — Manual, AI-assisted and synthetic inputs
Planned stage: **R1 fixtures / R2 editing**.

Canonical synthetic fixtures and controlled existing/manual candidates; AI never bypasses review.

Boundary: AI output cannot self-approve; preserve source locators and operator/model versions; synthetic alternatives must not contaminate observed world.

Tasks: T008 T012 T045 T046. Actual capability remains to be verified on the named profile.


## I25 — Sensors and time-varying observations
Planned stage: **R3**.

Time-series/sensor asset boundary only initially; streaming observation integrations deferred.

Boundary: Not every observation revises the static building mesh; separate sampling quality from cadastral evidence.

Tasks: T054 T055. Actual capability remains to be verified on the named profile.
