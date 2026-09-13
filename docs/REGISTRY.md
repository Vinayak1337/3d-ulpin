# Registry data and API

The registry is additive to preparation cases. A case does not become a registered property simply because it has a successful build. One site owns one named local-metre frame and benchmark. The current implementation accepts single-ring polygon prisms with constant lower and upper elevations, at most 100 current volumetric spaces per site and 150 total records per check. Holes, multipolygons, curved solids and cross-frame queries are rejected.

## Identity and revisions

`3DU-<26-character Crockford Base32 site UUID>` is independent of all case IDs. Suffixes `:P001`, `:B001`, `:F001` and `:S001` identify parcels, buildings, floors and spaces. Allocation holds a site row lock; unique constraints protect suffixes. Reserved records retain their allocation even while unpublished. New-record requests require a persistent UUID `requestKey`, so concurrent retries return the original draft and identity. Existing-target correction requests reuse an open linked draft.

Names, floor labels and building memberships are mutable revision data. They are not encoded into permanent space IDs. Official parcel ULPINs are stored separately; the synthetic site cannot assert one.

`registry_records` stores the current body and indexed footprint. `registry_revisions` stores append-only application snapshots. `registry_links` and `registry_rights` mirror the associations in the current body. A shared basement or cross-parcel corridor has one spatial identity with multiple relationships, rather than duplicate geometry. Parties and rights always reference an existing source revision and locator.

Review preparation captures the expected draft and site revisions, proposed bodies, previous bodies, findings and an input fingerprint. Commit locks the site, draft and review; verifies revisions and a recomputed combined candidate/neighbour fingerprint; enforces blocking errors and warning acknowledgement; then updates current records and appends history atomically. A committed review's retry returns its existing result. Any intervening site change requires fresh checks. This is technical demo review, not formal cadastral acceptance.

Cases, original source objects and old geometry snapshots are retained. Explicit imports preserve legacy space IDs as record lookup aliases. Legacy floor groups map to a corresponding floor where one exists; otherwise their lookup retains the original workspace meaning. Workspace namespace aliases describe the original preparation workspace, not the entire site's identity. No name-based merge or automatic publication of old workspaces occurs.

## Routes

All routes below are relative to `/api/v1`, local-only and return typed JSON errors. Existing case, source, build and original-download routes remain available.

| Method and route | Purpose |
| --- | --- |
| GET / POST `/sites` | List sites / create a named frame and site |
| GET `/sites/:uuid` | Current records, sources and drafts |
| POST `/registry-demo` | Idempotent synthetic source-to-review seed |
| GET `/registry?q=&site=` | Search current IDs, aliases, names and parties |
| GET `/resolve/:identifier` | Resolve a site, current record or imported legacy meaning |
| GET `/registry/:identifier` | Current record, site and revision history; accepts imported space aliases |
| GET `/registry/:identifier/export` | Download the application JSON record |
| POST `/sites/:uuid/drafts` | `{recordId}` for correction, or `{body,requestKey}` for a new record |
| GET / PATCH `/registry-drafts/:uuid` | Read / edit `{expectedRevision,recordId,body}` |
| POST `/registry-drafts/:uuid/review` | `{expectedRevision,expectedSiteRevision}` |
| POST `/registry-reviews/:uuid/commit` | `{acknowledgement}` |
| POST `/sites/:uuid/workspace` | Create a source-preparation case in the declared site frame |
| POST `/sites/:uuid/import` | Explicitly import `{caseId,expectedRevision}` as a draft |
| POST `/sites/:uuid/query` | Point stack or proposed-volume intersection |

Query bodies contain the exact `frame` and either `{mode:"point",point:[x,y]}` or `{mode:"volume",footprint:[[x,y],...],lower,upper}`. A repeatable-read PostGIS snapshot uses the GiST footprint index for candidate selection. The private Python service reuses the polygon and interval routines for actual intersection quantities and highlight geometry. Results include `registryRevision`, frame, synthetic classification, each record, boundary-contact status and positive intersection pieces. Merely touching volumes have zero intersection volume.

## Export format `3d-ulpin-registry-v1`

This is documented application JSON, not a standard cadastral exchange format or geographic GeoJSON. The top-level object contains:

- `schema`, `classification` and `limitations` identifying the format and demo scope.
- `site`: persistent namespace, named frame, benchmark and registry revision used when resolving the record.
- `record`: persistent ID, kind/use, alias/name, current revision, footprint and optional computed prism geometry, relationships, rights, evidence and `synthetic` flag.
- `history`: retained record bodies, their record/site revision numbers and timestamps.
- `provenance.sources`: referenced original source revisions, including family/revision IDs, file names, MIME types, byte counts, SHA-256 hashes, inspection results and timestamps. The original bytes remain available through existing source download endpoints.

Geometry areas and volumes come from processing in the named metre frame. Rendering coordinates and camera transforms are not measurements. Source receipt, parsed suitability, draft geometry, computed findings and technical recording remain distinct stages.
