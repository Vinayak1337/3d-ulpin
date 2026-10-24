# K2 admission diagnosis

- `reviewPackage` (also called by `/prepare`) computes the effective GIS features, then calls
  `requireQualifiedGeometryRecords('FIND', 'area_feature', features)` before calling the spatial checker.
- That guard matches complete feature bodies against `usp_analytic_geometry`. The two retained GMDA roads
  are fresh revision-zero proposals and have no accepted canonical qualification. They must not acquire
  analytical eligibility by being labelled official, source-supported or reviewed.
- The exception happens before the review transaction: no package revision increment, `REVIEWED` state,
  or review fingerprint is persisted.
- `commitPackage` consequently refuses because `pkg.review` is absent (the same `STALE_REVISION` code
  covers missing/stale review). This is consequential, not evidence of an independent revision defect.
  No stale-revision fix or separate stale-revision regression is justified.

## Narrow admission

The existing multipart `POST /api/v1/import-packages` now also accepts `format=document_buildings`,
`metadata` conforming to `SourceBuildingImportSchema`, and unchanged PDF originals under their declared
keys. Existing document intake retains each original and queues native inspection. The same import-package,
physical-feature, source-link, registry-identity and revision tables are used; there is no new route/store,
seed, geometry qualification or external provider.

Source-only `/review` and `/prepare` require **all** geometry fields to be null, placement unknown, original
revision/hash/access pins intact, and no staged extracted parts. They explicitly report spatial checks,
placement, footprint and elevation as not assessed. Conflicting human transcriptions remain alternatives.
Ordinary GIS review still requires qualification. Package commit checks the exact source-review fingerprint,
package/area/record revisions and source authority, then records empty-footprint registry buildings and
null-geometry physical declarations together. It cannot replace geometry or rights.

## Runtime-found original/extraction seam

The first Tower `/prepare` attempt returned `DOCUMENT_STAGE_UNAVAILABLE`: the generic package reader
required an accepted extraction receipt even though these are explicitly human-cited originals, not staged
extracted text. Receiving the four PDFs also made earlier native job inputs stale against the newer case
revision. The fix uses existing `documentSourceTx` plus `documentAuthorityTx(..., 'original')` for this
original-only variant, retaining subject/site/latest-source/hash checks and prohibiting staged parts. Ordinary
GIS and extracted-document authority is unchanged. A focused regression proves no extraction/job query or
write is needed for a valid original citation, and a wrong site is still denied. Tower then prepared and
committed through the same APIs. No native or OCR observation was adopted as a fact.

## Administrative context

The same route also accepts `format=administrative_context`, one unchanged native ArcGIS polygon original,
a pinned area, explicit source ID/name fields and no building declarations. Names, native rings and source
CRS remain pinned in the existing package. Review/commit records `AdministrativeUnit`/area membership
references, not physical features, registry parcels or public land. The canonical area has a separate cited
`administrativeContext` array: backend-projected ENU candidate polygons, administrative role and explicit
`not_assessed` analytical eligibility. Native `Area=0` values are not converted to measured area. Existing
road centrelines stay retained, width unknown, and remain qualification-gated GIS proposals.

`SourceBuildingFeature`/`SourceBuildingPackage` describe this variant explicitly. The historical GIS-only
`PhysicalFeature` type is not widened; runtime legacy readers must not assume every visible building has
geometry. The canonical projector and analytical input filter handle the null variant. Generic registry
editing still requires a footprint; source-only correction editing is a separate remaining contract seam.
