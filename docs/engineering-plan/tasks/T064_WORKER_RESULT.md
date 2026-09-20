# T064 worker result — file-first GIS intake

20 September 2026. Implementation ready for parent build/browser review. No commit or push. The running app and reference gallery were not stopped or rebuilt by this worker. Earlier T060–T063 changes and T069 references were preserved.

## Delivered

- A read-only `POST /api/v1/import-packages/inspect` operation calls authenticated private `POST /internal/area/inspect-gis`. Validated content determines format; filename is used only for the editable title. Nothing is persisted by inspection.
- Native inspection uses the existing GeoPackage/Shapefile readers. Their 16 MiB source limit, 64 MiB ZIP expansion limit, path/companion/Z/M/geometry checks, feature/vertex bounds, read-only immutable SQLite, trusted-schema disabling and five-second query timer remain. GeoPackage EPSG/WKT conflicts now fail explicitly. Inspection lists multiple layers before requiring selection; it never merges them.
- JSON inspection validates complete bounded feature collections, geometry and declared references. RFC 7946/accepted CRS84 establish WGS84; ArcGIS collection/feature declarations are respected. Missing ArcGIS CRS is unresolved; conflicting references fail. No coordinate-size guessing.
- Attribute ID suggestions require recognized identity naming plus completeness, uniqueness and valid scalar IDs across all rows. Complete unique GeoJSON Feature IDs are also supported without rewriting source properties. Omitting a public import's attribute ID mapping requires revalidation of actual retained Feature IDs, preventing silent row-number fallback.
- Name suggestions use a sole recognized complete textual name field; repeated names are valid. Preflight returns field metadata, never attribute value samples.
- Filename-derived title remains editable. Generated namespace is deterministic from source SHA and selected layer, separating reused IDs across layers. Layer changes update the generated namespace unless the officer edited it. Same bytes/layer yield the same namespace on retry/reselection.
- File-first form shows the selected file, detected reference/layer and a compact boundary-meaning/source-origin question area. Missing CRS/ID/layer controls appear only when needed. A combined plain-language boundary selector sets typed kind/meaning; explicit advanced overrides, height fields/units/benchmark, utility endpoint levels/cross section and destination remain available.
- Current destination and fictional/mixed dataset context are visible; selected area defaults to current destination. Source origin is an explicit choice. No format or EPSG:4326 default is presented before inspection.
- Existing import/review/record APIs, byte retention and source acquisition catalogue remain. Unrelated import/export mode tabs were removed; callers' `initialMode` still opens standalone export. Three concise stages replace the five-stage duplicate progress list. Mixed document intake is not advertised.
- Stale inspection responses cannot overwrite a later selection; removal/closing aborts staged inspection. Closing intake discards staged UI selections without deleting retained imports.

## Exact implementation files

- `services/geo/geo/gis_inspection.py` (new)
- `services/geo/geo/native_gis.py`
- `services/geo/geo/api.py`
- `services/geo/tests/test_gis_inspection.py` (new)
- `packages/contracts/src/gis-inspection.ts` (new)
- `packages/contracts/src/index.ts` (one export added)
- `apps/web/lib/server/gis-inspection.ts` (new)
- `apps/web/lib/server/area-routes.ts`
- `apps/web/lib/server/areas.ts` (inspection operation added to existing geo helper)
- `apps/web/features/officer/block/useGisInspection.ts` (new)
- `apps/web/features/officer/block/ImportForm.tsx`
- `apps/web/features/officer/block/DataTools.tsx`
- `apps/web/features/officer/block/data-tools.css`
- `tests/gis-inspection.test.ts` (new)
- This result document.

## Checks

Worker checks completed:

- `pnpm exec tsx --test tests/gis-inspection.test.ts`: **11/11 passed**. Covers original bytes, declared CRS/layer, deterministic namespace/retry, layer identity separation, missing/empty/oversized files, actual streamed request size without Content-Length, malformed multipart, processor errors and retained Feature-ID enforcement.
- `pnpm typecheck`: **passed** after final UI changes.
- `git diff --check` for modified tracked implementation files: **passed**.
- Python compilation for new inspection, refactored native reader and new parser tests: **passed**.
- Parent ran the mounted private inspection/native-adapter/area suite: **90/90 passed before the final two Feature-ID/name tests**. Parent is rerunning final mounted tests and owns private service rebuild, production build and browser checks. Host Python lacks pytest; no claim of locally executed private pytest is made here.

Read and applied the corrected `05-add-files.png`, DESIGN_BRIEF/REVIEW, frontend-design and React review skills; read the installed Next route-handler documentation before route changes.

## Browser fixtures and suggested review

Created explicitly fictional files with stdlib SQLite/WKB/JSON writers under `.runtime/t064-fixtures` (uncommitted runtime fixtures):

- `T064-fictional-projected.gpkg`: sole buildings layer, two polygon features with complete IDs/names, EPSG:32643.
- `T064-fictional-multiple-layers.gpkg`: buildings/parcels layers intentionally reuse source IDs; select each and compare generated namespaces.
- `T064-fictional-projected.json`: ArcGIS polygon with EPSG:32643.
- `T064-fictional-missing-crs.json`: same ArcGIS polygon without CRS; officer must supply documented CRS.

Upload projected GeoPackage, confirm detected EPSG:32643 and automatic ID/name, choose fictional origin + building meaning, continue through real draft review, and verify retained original hash. Check malformed upload/retry, no-ID source, multiple layers, Feature IDs without attribute IDs, utility settings, close/reopen staged selection, and a narrow viewport. Parent already owns the live app and browser evidence.

## Limits and later-task handoff

- Native missing CRS/.prj remains an actionable source-repair rejection, matching the existing ingestion contract. Only absent ArcGIS CRS can be supplied manually here. A missing native reference is never guessed or silently relabelled.
- One GIS source/layer per intake; mixed PDF/image/schedule intake and its full-page routing remain T066. The source acquisition catalogue and standalone exports retain their existing paths.
- The public preflight bounds actual streamed body bytes at 17 MiB (multipart overhead), then the original file at 16 MiB; no binary is read as browser text.
- Existing title/namespace/destination changes still follow existing ingestion identity semantics. Changing the source namespace deliberately is an advanced operation; filename alone is never an overwrite command.
- File metadata is not factual/geometry acceptance. Actual normalization, review, checks and explicit recording remain authoritative.
- No visual acceptance claim. Parent production build, real-browser upload/review, accessibility/responsive check and preservation audit are pending at this handoff.
