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

`SourceBuildingFeature`/`SourceBuildingPackage` describe this variant explicitly. The historical GIS-only
`PhysicalFeature` type is not widened; runtime legacy readers must not assume every visible building has
geometry. The canonical projector and analytical input filter handle the null variant. Generic registry
editing still requires a footprint; source-only correction editing is a separate remaining contract seam.
