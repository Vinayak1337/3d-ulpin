# Private geometry processor

This service inspects original uploaded bytes and computes local metric polygon prisms. It has no application database credentials and never writes case, source or model records. The application owns those records and ingests results only for the original input fingerprint.

## Run

The root `scripts/platform-start.sh` runs the complete local stack. Container commands are:

```sh
uvicorn geo.api:app --host 0.0.0.0 --port 8000
celery -A geo.tasks:celery_app worker --loglevel=INFO --concurrency=2
```

Compose maps HTTP to `127.0.0.1:18000`. Required private environment: `GEO_SERVICE_TOKEN`, `REDIS_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION`. Long-form S3 aliases `S3_ENDPOINT_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` are also supported. Never put actual credentials in this README, request logs or committed files.

`GET /health` is unauthenticated process liveness. The platform health script separately checks the broker, worker, storage and database. Both internal job routes require `Authorization: Bearer <GEO_SERVICE_TOKEN>`; interactive API docs are disabled.

## Processing protocol

- `POST /internal/jobs` accepts `{jobId, operation: "inspect" | "build", input}` and returns `{jobId,status}`. IDs are UUIDs. A real Celery message processes the persisted input asynchronously.
- `GET /internal/jobs/:jobId` returns `{jobId,status,result?,error?}`. It omits private object keys, payloads and signatures.
- Repeating a job ID with the same operation and canonical JSON input returns its existing state. Different input returns HTTP 409. A failed processing job is immutable; retries use a new ID.
- A temporary enqueue failure returns 503 and retains the undispatched request for a safe same-ID retry. Worker leases prevent duplicate deliveries from executing simultaneously and recover after a killed worker's lease expires.
- Redis retains job signatures, input, status and results without expiry. The platform enables AOF and a persistent volume. The separate Celery backend cache expires after one day. Application model history has its own database lifecycle.
- Tasks have a 110-second soft limit and 120-second hard limit. Inputs are limited to 16 MiB, 2,000 features and 10,000 vertices per ring. These are bounded demo operations, not arbitrary solid modelling.

Inspection input is `{sourceId,profile,objectKey,sha256,bytes}`. The worker reads the named private object and verifies actual byte length and SHA-256 before parsing. Supported profiles are spatial JSON, level CSV, control CSV, PNG and PDF as defined in `docs/IMPLEMENTATION_CONTRACT.md`.

The inspector keeps technical receipt and suitability separate: missing levels produce `needs_input` with null values, and plans require calibration/manual tracing. It does not infer footprints or dimensions from pixels. Invalid content produces an `InspectionResult` with `status: failed`; integrity, operational and build failures mark the processing job failed.

## Geometry behavior

Build input and output follow the shared `BuildInput` and `BuildResult` contracts. Named local frames use horizontal and vertical metres and an explicit benchmark. No geographic location is inferred. The app must reject cross-source reference mismatches before assembling canonical input; the worker also rejects mismatched references if supplied on units/context.

- Validate each simple polygon and constant lower/upper limits; reject holes, self-intersection, duplicate vertices, missing/nonfinite measurements, degenerate area and inverted height. A repeated closing point is normalized to an open ring.
- Compute area with Shapely and volume as `area × (upper − lower)`. Preserve unit IDs, aliases, revisions, calibration and evidence bindings. A verified elevation requires a source locator; an unverified numeric elevation remains unverified and receives its own warning.
- Compute pairwise XY intersections and common Z intervals. Positive interior intersections are `OVERLAP` errors with exact polygon footprints and elevations. Disconnected intersections receive separate regions/findings. Boundary-only contact is informational and has zero positive shared volume.
- Parcel/building footprints remain context, not competing unit volumes. Building containment is informational; extension outside supplied horizontal context produces a warning.
- Return the original input fingerprint and versioned processing method. Round computed quantities to nine decimal places to suppress floating-point noise; dimensional tolerance is `1e-9` metres or square metres as appropriate. Display offsets never enter processing input.

## Verification

```sh
python3 -m venv services/geo/.venv
services/geo/.venv/bin/pip install -r services/geo/requirements-dev.txt
cd services/geo
.venv/bin/python -m pytest
```

The suite covers both independently reasoned cases, actual original parsing, checksum/size rejection, malformed numbers/references/polygons, exact intersection highlights, correction, unchanged geometry with new evidence, context semantics, calibration rejection, auth, dispatch recovery, duplicate payloads and terminal job behavior. The root platform smoke additionally executes the real API → Redis → Celery path.
