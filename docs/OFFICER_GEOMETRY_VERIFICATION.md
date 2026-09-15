# Officer geometry and native adapter verification

Verified locally on **15 September 2026**. This report covers the private Python processing lane, not full officer-browser acceptance or acquisition of surveyed Indian utility depths.

## Executed evidence

From `services/geo`:

```sh
.venv/bin/pytest -o addopts='' -q --tb=short
```

Current full-suite result: **163 passed in 2.13 seconds**. This includes the existing geometry/job/registry regressions, the unchanged 62-building NYC snapshot, officer/native adapter and batch profile cases, and the V2 compatibility test retaining the existing levels CSV `method` column as text. Tests use independently authored synthetic fixtures unless they explicitly read the preserved NYC source; synthetic fixtures are not real survey evidence.

The bounded batch profile test covers stable identities, evidence gating, empty batches, duplicate IDs, feature count and total vertex limits. It is included in the current full-suite run above. An authenticated live two-feature batch returned HTTP 200, preserved both identities, resolved the source-bound invert profile to the expected −2.5/−1.5 m centre elevations, and left the unbound profile without resolved positions. Redis and worker readiness remained true after that earlier batch rebuild.

The latest V2 document-assignment update rebuilt only geo and worker; both reported healthy. `pnpm exec tsx scripts/verify-case-document-copy.ts` passed the actual route handler, database, S3 and private native parser integration. It verifies atomic ownership/hash/profile/stale-revision rejection; exact PDF/PNG/CSV bytes and original case history retained; per-part copied-source provenance; concurrent retry identity; and direct uploads still supported. Its allocated synthetic records and objects were cleaned afterward. The optional CSV `method` column remains source text and does not increase evidentiary authority.

The geo and worker images were rebuilt from the current Python sources with `pyproj==3.6.1` and `pyshp==2.3.1`. Only the processing containers were recreated; database, Redis and object-storage volumes were not reset. The authenticated live officer check returned an exact 20 m² outside strip and 2 m rectangular extension. After the final rebuild, `/profile` returned HTTP 200 and correctly resolved the synthetic, source-bound depth example to centre elevations of −2.5 m. `/check` returned HTTP 200 for a documented restriction with geometric-intersection and rule-evidence findings and no positive physical collision volume. `/internal/ready` reported Redis and worker ready. These service checks do not claim a browser rehearsal.

## Spatial acceptance results

| Fixture | Independently specified expectation | Verified processing behavior |
| --- | --- | --- |
| G01 | 120 m² occupation, 100 m² parcel, 20 m² outside strip, 20 m² road overlap, 2 m rectangular extension | Exact polygon difference/intersection and rectangular-strip extension pass; result geometry is the strip |
| G02 | Equal total areas with a 1 m translation still give 10 m² outside | Pass; no total-area subtraction |
| G03 | Shared boundary is 0 m² with a separate contact | Pass; the 10 m contact line is retained |
| G04 | Two confirmed adjacent parcels form one 100 m² union | Pass; outside area is zero |
| G05 | Courtyard polygon is 96 m²; two 2×2 parts total 8 m² | Native normalization and exact overlay pass; holes and parts remain intact |
| G06 | Roof projection is not ground occupation; no confirmed parcel needs a question | Pass; no nearest-parcel substitution or ground-occupation accusation |
| G07 | Public-layer overlaps of 20 m² and 10 m² share a unique union of 20 m² | Pass; per-layer overlap and unique union remain separate |
| V01 | Basement and rectangular utility prisms intersect by 3 m³ | Pass: 6 m² horizontal intersection × 0.5 m vertical overlap |
| V02 | Separated and touching vertical intervals have 0 m³ | Pass; separation and contact have distinct findings |
| V03 | Missing/different vertical reference cannot produce a physical collision | Pass; horizontal relationship and focused evidence request remain |
| V04 | Supplied invert/crown values plus diameter yield the same centreline | Pass on a declared synthetic profile; the computed positions agree exactly |

Additional tests cover stale confirmed-association participant revisions, compatible approved-versus-observed outlines, public lines without assumed buffering, circular/sloping volume restrictions, ground evidence required for depth conversion, recomputation instead of trusting cached positions, native endpoint authentication, invalid metadata, and rejection of synthetic-source promotion through status mapping.

**G05 does not claim unrestricted detailed-registry conversion.** Detailed preparation accepts one simple Polygon or unwraps a one-part MultiPolygon into the same exact derived outline while preserving the original claim. True multipart footprints and courtyard rings remain blocked from this narrower detailed preparation path; they are never filled or dropped. The area checker itself supports exact constant prisms with polygon holes and multipart footprints.

## Meaning and evidence boundaries

`semantics.geometryRole` distinguishes ground occupation, roof projection, approved outline, recorded parcel, public-road land, road surface, public land, physical utility and documented restriction. The top-level `geometryRole` is a compatibility alias. Floor count, source/approval status, dates and uncertainty are typed independently of height and world status.

Only explicitly confirmed, evidenced, current parcel associations define the parcel union. A changed `fromRevision` or `toRevision` requires reconfirmation. The checker never uses nearest geometry as proof of association. Approved-versus-observed comparison additionally requires an explicit evidenced comparison and matching declared level references.

Findings retain all participants, exact result geometry, applicable quantities, source/feature revisions, method, evidence and numerical tolerances. Where supplied, declared horizontal uncertainty is reported separately; it does not erase the exact result. Unknown uncertainty remains unknown. Geometric findings do not establish ownership, illegality, a road reserve or an easement. Overlapping public layers are not summed as a unique area.

`documented_restriction` can produce a geometric intersection and an applicable-rule evidence request. It cannot produce a physical pipe-collision finding. A line described as public context does not become land area through an arbitrary buffer.

## Cross-block membership integration

`pnpm exec tsx scripts/verify-block-membership.ts` passed against actual local PostGIS, object storage and the private processor using allocated synthetic fixtures, then removed those fixtures and originals. One utility remained one stored identity while participating in groups belonging to two map areas. Multiple group memberships did not duplicate it in the selected block. An unrelated overlapping area was excluded from ordinary map context.

The test independently checked projected local coordinates and profile positions in the second area's frame, unchanged source/geographic geometry and owning record, a consistent non-stale completed check, and invalidation when the owning utility source/profile changed. A 2,001-feature owned/member set failed with an explicit limit. The shared loader and neighbour/check fingerprint paths retain the same features and frame rules. Web typecheck and standalone verification-script typecheck passed. This tests current server functions and services; it is not a claim that the newly changed route has already been rebuilt and rehearsed in the browser.

## Utility profile support

Canonical profile levels and cross-section dimensions use metres. Supported meanings are centre, invert, crown and depth below ground. Interpolation is either supplied per-vertex levels or explicitly selected linear interpolation between endpoint levels. Depth conversion requires ground levels at each alignment vertex, matching ground/utility references, a declared depth target and bound ground evidence.

`POST /internal/area/profile` takes `{feature}` and returns `{utilityProfile, method}`, or takes `{features}` and returns `{profiles: [{id?, sourceKey?, utilityProfile}], method}`. A batch contains only utilities with canonical profiles and stable identities; empty batches are allowed. It recomputes the centreline from source profile values and ignores caller-provided cached `resolved` positions. Profiles without bound source evidence remain unresolved. The application can call it after attaching source locators or for a read-only interpretation of an older stored profile.

| Profile | Placement output | Collision support |
| --- | --- | --- |
| Evidenced Polygon/MultiPolygon plus constant lower/upper bounds | Exact footprint and vertical interval | Exact prism intersection when both references match |
| Constant-level rectangular utility alignment | Centreline; flat-ended, miter-joined rectangular corridor footprint | Exact intersection of that explicitly modeled constant corridor prism |
| Circular cross section with supplied levels | Diameter-derived centreline positions | Display/section positions only; no exact circular solid m³ |
| Sloping profile | Explicitly interpolated/per-vertex centreline positions | Display/section positions only; no exact sloping solid m³ |
| Missing depth, cross section, meaning or datum | Original horizontal alignment and focused unresolved requirements | No asserted underground position or physical volume |
| Different datums or building-relative zero | References retained separately | No automatic datum transformation or cross-building collision |

The rectangular corridor is a defined model with flat ends and miter joins, not a circular pipe or assumed legal corridor. Actual same-area utility acquisition, surveyed ground/depth references and validation against real utility evidence remain external acceptance gates. These synthetic profile tests do not satisfy that real-data gate.

## Native format capability matrix

| Input | Supported native profile | Explicit limits / remaining boundary |
| --- | --- | --- |
| GeoJSON | WGS84 longitude/latitude FeatureCollection; Point/MultiPoint, LineString/MultiLineString, Polygon/MultiPolygon | Exact known legacy OGC CRS84 declaration accepted with warning; other CRS overrides and Z/M rejected |
| ArcGIS JSON | Explicit EPSG WKID/source CRS; 2D points, paths and unordered shell/hole rings | Curves, Z/M, ambiguous touching/overlapping rings and incomplete transfer flags rejected |
| GeoPackage | One selected 2D native feature table; source CRS and mapped columns; standard binary geometry decoded | Read-only SQLite; multiple layers require selection; views, virtual tables, raster-only, extended/Z/M geometry unsupported; not a full GeoPackage conformance validator |
| Shapefile ZIP | Matching `.shp`, `.shx`, `.dbf`, `.prj`; optional supported `.cpg`; 2D point/line/polygon/multipoint | Unsafe paths, symlinks, encryption, duplicate members, missing companions, Z/M/MultiPatch and inconsistent/deleted record sets rejected |
| CSV level schedule | Required `alias,lower,upper,unit,benchmark`; optional `label,level,method,footprint_wkt,frame` | Strict typed candidates with row/cell locators; `method` retained as text only; no guessed schema or free-text numbers; missing lower/upper yields questions |
| CSV footprint WKT | Valid Polygon/MultiPolygon in a named local metre frame | Does not create geographic placement; a reviewed placement transform is still required |
| PDF | Native text with exact page locators | Empty native-text pages remain unresolved; no OCR or PDF rasterization in this adapter |
| DOCX | Native body paragraphs/direct table cells with locators | Drawings, headers, footnotes, nested tables and text boxes require separate interpretation |
| UTF-8 text | Native lines and line locators | References only; no automatic unstructured fact inference |
| PNG/JPEG | Preserved reference images; explicitly selected crop derivatives | EXIF-normalized native crop only; no geometric measurement or fact inference by the crop tool |
| DXF, IFC, DWG, unspecified BIS/other extensions | No tested native profile in this lane | Explicitly unsupported until a sampled adapter and validation exist |

GeoPackage/Shapefile originals remain unchanged binary source assets in application storage; decoded and projected representations are derivatives. Their returned adapter metadata includes source hash, layer and units. Native CSV candidates include subject, property, canonical value/unit, reference, source part index and exact row/cell locator, for application association and review.

## Processing bounds

- Area import: at most 2,000 features, 100,000 total vertices, 10,000 vertices per feature, 256 geometry parts/rings and a 50 km local extent/origin bound.
- Spatial work: bounded 20,000 candidate-pair budgets; dense/incomplete checks fail explicitly instead of reporting an empty successful result.
- Native GIS container: 16 MiB; Shapefile ZIP at most 1,000 members and 64 MiB expanded; GeoPackage read has a five-second SQLite progress limit.
- Documents: 10 MiB, 100 PDF pages, 250,000 text characters; strict CSV at most 2,000 rows.
- Image derivative: source at most 16 MiB/40 megapixels; explicit normalized region required, output at most 4 MiB/4 megapixels. Output records source/derivative hashes, pixel region, dimensions and orientation.

The private endpoints remain service-authenticated: `/internal/area/normalize`, `/check`, `/extract`, `/crop` and `/profile`. They execute no document instructions and provide no unrestricted shell, database mutation or model publication capability.
