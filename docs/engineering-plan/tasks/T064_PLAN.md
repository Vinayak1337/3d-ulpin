# T064 — Inspect files and simplify GIS intake

See [Studio UX plan](../STUDIO_UX_PLAN.md) for user intent, audit and preservation contract.

## Scope

Replace front-loaded technical GIS form with file-first inspection and safe metadata defaults.

## Implementation boundary

Reuse native parsers for bounded preflight of format/CRS/layers/fields and candidate ID/name columns. Do not browser-read binaries as text. Detect sole layer and declared CRS; preserve ambiguity/error handling; generate stable namespace for new import and retain it through retries. Put specialist settings in disclosure. Keep geometry meaning explicit where ambiguous. Reuse original import/review/commit APIs.

Preserve previous T060/T061 changes in the dirty working tree. One task at a time; no subagent spawning from workers. Parent owns shared backlog and result acceptance.

## Verification

Projected native files, multiple layers, missing/conflicting CRS, malformed files and ID ambiguity; original-byte preservation; browser file-to-draft review; typecheck/build.

Do not claim user acceptance from automated tests. Record actual checks, changed files, remaining limits and next-task handoff.

## Audit handoff

Current ImportForm performs a first-20-JSON-feature key scan and always posts `sourceCrs=EPSG:4326`; replace that with server inspection. Public area route form accepts an optional sourceCrs already. `services/geo/geo/native_gis.py` has bounded `_raw`, `_gpkg`, `_shapefile` routines (16 MiB input, 64 MiB expansion; read-only/immutable SQLite with trusted_schema off and progress timeout). Reuse/refactor those guards for metadata; do not introduce a weaker second parser. Private geo endpoint `/internal/area/{operation}` maps synchronous operations in `geo/api.py`; public new inspection endpoint can call through existing geo request helper. GeoJSON RFC7946 and accepted CRS84 source legitimately establish EPSG:4326; ArcGIS metadata must be respected. Missing projected metadata must remain unresolved, never guessed from coordinate size.

## Corrected reference gate

T069 completed first per latest user steering. Use design/officer-studio-v3/DESIGN_BRIEF.md and REVIEW.md plus the actual revised screenshots as the presentation/interaction target. Do not copy errors from superseded original or exploratory draft images. Keep actual app capabilities honest while implementing these tasks sequentially.
