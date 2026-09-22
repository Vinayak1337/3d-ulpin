# Hackathon contract v1

> **Direction note — 23 September 2026:** This describes baseline API behavior; new USP contracts are requirements, not already implemented endpoints. Current implementation and data/testing assignments are in [USP handoff 00](usp-agent-handoffs/00-README.md) and the assigned feature file.

The shared TypeScript shapes are in packages/contracts/src/index.ts. The app API is JSON, with the successful object returned directly (no data wrapper); errors are ApiError with appropriate HTTP status.

## Application API for the workbench

- GET /api/v1/cases → CaseRecord[]. POST same path {name, description?} → CaseRecord.
- GET /api/v1/cases/:id → CaseDetail (poll while jobs queued/running).
- POST /api/v1/cases/:id/demo-inputs {dataset:"c001"|"c002"} → {sourceIds:string[]}. Reads and uploads actual fixture bytes via the normal source pipeline. Initial case has no model. Repeated operation uses Idempotency-Key.
- POST /api/v1/cases/:id/sources multipart file + profile + optional familyId → SourceRevision. Performs verified S3 write/finalization, queues inspection. Max file 16MiB. Optional Idempotency-Key.
- GET /api/v1/sources/:id/file → private original bytes through app server.
- POST /api/v1/cases/:id/prepare {spatialSourceId, levelSourceId?, controlSourceId?} → CaseDetail. Imports unit footprints, applies supported levels, records explicit draft hints only where evidence missing; no model is computed yet. Never silently prepares from an upload.
- POST /api/v1/cases/:id/apply-levels {sourceId, expectedRevision} → CaseDetail. Explicitly binds a selected inspected level source, retaining unmentioned rows. Rebind invalidates model/check freshness, even if coordinates unchanged.
- PATCH /api/v1/cases/:id/units/:unitId {expectedRevision, footprint?, lower?, upper?, calibration?} → UnitSpec. expectedRevision is the unit revision. Editing elevations manually sets changed component verified=false unless supported binding matches.
- POST /api/v1/cases/:id/units {alias,name,kind,footprint,lower,upper,levelLabel?,calibration?} → UnitSpec. Add manual traced unit.
- POST /api/v1/cases/:id/build {expectedRevision} → ProcessingJob. expectedRevision is the case revision. Actual queued Python geometry builds persisted snapshot.
- POST /api/v1/jobs/:id/retry → ProcessingJob.
- GET /api/v1/health → {ok:boolean, services:Record<string,boolean>}.

Use random UUIDs for IDs; aliases C-001/U03 are fixture labels only. Coordinates stored in metres, ring is an open list of vertices, no repeated closing point required. Frame must match, no CRS guessing. SVG/raster plan calibration accounts for image Y axis. Source upload, prepare, apply-levels, edit, and compute are explicit distinct operations.

## Private processing protocol

Bearer GEO_SERVICE_TOKEN required. POST /internal/jobs with {jobId,operation:"inspect"|"build",input}. Idempotent jobId + logical input. Returns {jobId,status:"queued"|"running"|"succeeded"|"failed"}. GET /internal/jobs/:id returns {jobId,status,result?:InspectionResult|BuildResult,error?:string}. GET /health returns {ok:true}.

Inspect input: {sourceId,profile,objectKey,sha256,bytes}; source original in S3_BUCKET via worker credentials. Verify bytes/hash against input. Return InspectionResult. Build input: BuildInput from shared contract. Actual Celery job; Redis durable broker/backend; no domain DB writes from worker. App dispatcher ingests original fingerprint results idempotently. Python unit IDs/bindings copied from input.

## Raw input profiles

- parcel-local-json-v1: {profile:"parcel-local-json-v1",frame:CoordinateFrame,features:SpatialFeature[]}. Include parcels/building as context; actual units/common/basement as units. draftLower/draftUpper are explicitly unverified scaffold suggestions and must not become evidence.
- levels-csv-v1 headers alias,lower,upper,unit,benchmark,method. Empty lower/upper allowed as incomplete evidence, malformed numbers rejected. Each row locator csv row N. r1 U03 and U04 lower blank; r2 provides supported3.0. r1 includes baseline lower-storey/common/basement rows; r2 can contain only affected upper rows.
- control-csv-v1 headers id,x,y,unit,benchmark. Local horizontal metres.
- PNG/PDF: real parseable plan reference bytes. Technical inspection reports dimensions/pages, not extracted geometry. PDF.js previews selected page in browser.

## Demo cases

C001 LOCAL-C001 BM-DEMO-A: parcel P-A [0,0]-[14,12], P-B [14,0]-[28,12]; building [2,2]-[12,10]; U01 [2,2]-[6,10] z0..3; U02 [8,2]-[12,10] z0..3; U03 above U01 draft2.8..6 (lower unverified); U04 above U02 z3..6 (lower unverified); common lower/upper [6,2]-[8,10] z0..3/3..6; basement [2,2]-[12,10] z-3..0. Expected U01 area32 volume96, U03 draft volume102.4 overlap6.4; corrected overlap0; basement240. Generate PNG/PDF/control/spatial/levels r1/r2 real files. Second case has different shapes/IDs/dimensions and independent expected overlap.
