# Geographic area workflow

This release adds a local physical-observation workflow around the existing registry: acquire or upload a bounded source, normalize all features in one geographic frame, resolve missing evidence, review a package, record it, and inspect its surroundings. A building exterior does not create apartments, ownership or an official ULPIN. The original local C-001/C-002 and detailed registry workflows remain separate regression cases.

## Start locally

Run from the repository root with the existing local environment and storage volumes:

```sh
pnpm platform:start
pnpm db:migrate
pnpm dev
```

Open `http://127.0.0.1:3000/areas`. The application API accepts local origins; the Python API uses the private service bearer token. Keep credentials in the existing local environment, not source files. Run `pnpm platform:health` to inspect the local services. No database reset is required for the additive area schema.

## Operator journey

1. Open **Data sources** and select **NYC building footprints → Open saved snapshot**. The bundled source contains 62 actual Bronx building footprints around source feature `353927`; it is foreign public data, with no Indian cadastral identity claim. The provider attribution, source terms and retrieval date remain visible.
2. Inspect the proposed package in the map. Current recorded features and a proposed update remain separate. **Fit area** keeps the surroundings in view; **Focus selection** is optional. Use the 2D/3D views to inspect footprints and supported exterior envelopes.
3. To use another native layer, choose **Import GIS**. Set its format, namespace, stable source ID field, physical feature type and source CRS. Choose the current area to retain its projection and origin. Map a height field only when its units and meaning are known. Reuse the same namespace and source IDs for a corrected source revision.
4. Resolve evidence questions by keeping a footprint in 2D or entering an explicitly labeled display estimate with a reason. Unknown height remains `null`. Add PDF, DOCX, text, PNG or JPEG references to the intended feature in the pending package. Native text receives page/paragraph/table/line locators; image interpretation remains manual. Facts transcribed from documents retain their source association, and competing claims remain reviewable.
5. Choose **Review proposed update**. The private processor checks the effective area snapshot, replacing the proposed feature's current revision. Review reports geometric intersections and coverage gaps; it does not decide legal encroachment.
6. Record the reviewed physical observations with a written acknowledgement. If the package or neighbours changed after review, refresh the proposal baseline and run review again. Original files, source links, package revisions, feature revisions and the review fingerprint are retained.
7. Search a loaded source ID, own permanent ID, or supported external identifier. Matching features load their containing area with surrounding context. Multiple matches remain explicit. An absent identifier means **Not present in loaded data**; it is not a national validity check.

## Saved acquisition and live acquisition

**Open saved snapshot** reads the preserved file, checks its SHA-256, and records that an earlier snapshot was opened. It does not claim a new download. **Refresh source** attempts a fresh request to the curated NYC endpoint and preserves its returned bytes and request metadata. Counts before and after the bounded query, fetched feature count and distinct source keys must reconcile. A failed or partial transfer is not reported as complete.

The current live adapter is intentionally limited to the catalog's fixed Bronx extent and at most 100 features. It requests only allowed fields, orders by source ID and rejects overflow. It does not implement arbitrary URL scraping, unrestricted district downloads or general provider pagination. Saved data can be prepared and reviewed locally when the provider is unavailable.

The GMDA entry remains metadata-only with acquisition disabled. Reuse authorization, actual feature access, locality, administrative code authority, building semantics, coincident roads/parcels and useful height/depth evidence remain unresolved. Catalog availability alone does not establish permission to redistribute data.

## Coordinate and height evidence

The normalized model retains source geometry, source CRS, a recorded transformation version, WGS84 geographic geometry and local analytical geometry. Actual pyproj transformations project all features into one suitable WGS84 UTM frame in metres, then subtract one retained area origin. Local coordinate objects use a GeoJSON-shaped syntax but are **not RFC 7946 geographic GeoJSON**.

GeoJSON imports require longitude/latitude WGS84. The exact legacy declaration `urn:ogc:def:crs:OGC:1.3:CRS84` used by the unchanged NYC snapshot is explicitly recognized with a warning. Other legacy or projected declarations fail instead of being relabeled. ArcGIS exports require an explicit supported WKID/source CRS. When adding layers, reuse `analysisCrs` and `origin`; the incoming layer has its own `sourceCrs`.

Native Polygon holes, MultiPolygon parts, LineString, MultiLineString, Point and MultiPoint inputs are preserved. Unsupported curved geometries, Z/M coordinates, invalid rings and nonfinite coordinates are rejected rather than flattened or dropped. The processing adapter allows at most 2,000 features, 100,000 total vertices, 10,000 vertices per feature and a bounded extent of 50 km. Dense checks exceeding 20,000 relevant candidate pairs fail with a request to split the area.

Source heights with explicit metre/foot units support a building-relative exterior approximation; feet are converted to metres. A floor count does not automatically become height. Display estimates remain estimated, and missing height is not replaced with zero or a default extrusion. Cross-building and utility volume checks require aligned elevations, depths, references and geometry that this area workflow does not yet provide.

## Synthetic crossing scenarios

In **Area checks → Synthetic crossing scenario**, choose **Synthetic road** or **Synthetic utility**. This prepares a candidate package; review it and record it through the same observation workflow before checking the current area.

`createAreaScenario(areaId, expectedRevision, kind)` in `apps/web/lib/server/area-scenario.ts` prepares a road or utility package through the same `ingestArea` boundary. The target is an existing observed building, preferring source key `353927` and otherwise selecting a stable source-key order. Its first exterior polygon's local bounding box supplies the authored demonstration geometry; adding the retained origin produces projected ArcGIS coordinates for normal ingestion.

The road is a **SYNTHETIC physical road footprint**. The utility is a **SYNTHETIC 2D utility line with unknown depth**. Both retain synthetic classification, stable namespace/source keys, explanatory source bytes and normal review/recording requirements. They assert no actual road, utility, easement or rights restriction. The helper never supplies expected findings: the Python processor calculates the horizontal relationship against the loaded geometry. A utility intersection must retain its unresolved vertical-evidence finding.

## Area API

All public paths below are under `/api/v1`. Mutation requests carry the applicable `expectedRevision` or `expectedAreaRevision`; responses return updated revisions.

| Method and path | Purpose |
| --- | --- |
| `GET /source-catalog` | Curated metadata, supported acquisition routes and reuse gates |
| `POST /acquisitions/probe` | Probe the supported bounded source count |
| `POST /acquisitions` | Open saved or refresh live source; body includes `sourceId`, `mode`, `requestKey` |
| `GET /acquisitions/:id` | Read preserved acquisition metadata |
| `GET /areas`, `GET /areas/:id/context` | Read area index, current features, package history and latest check |
| `POST /areas/:id/scenario` | Prepare an explicitly synthetic crossing package; body includes `expectedRevision` and `kind` |
| `POST /import-packages` | Import an acquisition or multipart native GIS file with explicit mappings |
| `GET /import-packages/:id` | Resume a persisted package |
| `GET /import-packages/:id/questions` | Read unresolved and answered evidence questions |
| `POST /import-packages/:id/documents` | Attach originals to explicit package feature IDs |
| `POST /import-packages/:id/facts` | Add an operator-transcribed claim bound to a source part |
| `POST /import-packages/:id/answers` | Save missing-height or competing-claim resolution with its reason |
| `POST /import-packages/:id/review` | Compute reproducible review of the effective snapshot |
| `POST /import-packages/:id/correction` | Start a new editable proposal from recorded observations, preserving prior package history |
| `POST /import-packages/:id/rebase` | Refresh a correction's current baseline before a new review |
| `POST /import-packages/:id/commit` | Record the reviewed observations and acknowledgement |
| `POST /area-checks`, `GET /area-checks/:id` | Compute and retrieve a persisted bounded check |
| `GET /resolve?identifier=...` | Resolve a loaded identifier without administrative filters |
| `POST /external-identifiers` | Bind an explicitly evidenced external identifier to a selected target |

The private Python routes are `POST /internal/area/normalize`, `/check` and `/extract`. They are service operations, not browser endpoints. Native document extraction accepts up to 10 MiB, at most 100 PDF pages and 250,000 extracted characters. It executes no document instructions and invents no facts. Documents requiring OCR, geometry calibration, nested-table interpretation or missing vertical references remain unresolved.

## Verification and remaining scope

The area adapter regression suite covers source geometry preservation, shared origins, actual projection, holes/multiparts, contact versus positive overlap, unknown heights, utility vertical gaps, field allowlists, malformed documents, source locators, private endpoint authentication and the actual 62-feature NYC snapshot. On 14 September 2026, the complete Python service suite passed **115 tests**, and `pnpm typecheck` passed with the scenario helper. The subsequent [area release verification](AREA_VERIFICATION.md) records the production build, service integration and browser checks.

Useful verification commands, from the repository root:

```sh
pnpm typecheck
pnpm exec tsx scripts/verify-area.ts
pnpm test:api
pnpm test:registry
```

For Python, run from `services/geo`:

```sh
.venv/bin/pytest -o addopts='' -q
```

The area integration script is a runnable rehearsal, not a claim that every command above passed during this document's preparation. Native extraction and operator resolution work without cloud AI. Nous/vision assistance is not integrated here. Real coincident roads, public land, utilities, surveyed shared vertical references, parcel-to-building associations and officially evidenced ULPIN bindings remain data and implementation gates. Detailed legal spaces, cadastral certification, district-scale rendering, automatic interiors and underground collision volumes are outside this area slice.
