# Bronx public building area

`original.geojson` preserves the exact bytes returned by the [NYC Open Data BUILDING API](https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue). It contains **62 real building footprints**, selected within a small box around the existing OTI 353927 example. Attribution: City of New York Office of Technology and Innovation (OTI).

The [manifest](manifest.json) records the complete URL, positive field allowlist, retrieval timestamp, response headers, original SHA-256, count responses, source CRS and suitability findings. Count before and after download both returned 62, matching 62 distinct DOITT_ID values. The query limit was 100; no pagination or truncation occurred. `within_box` selects contained polygons; buildings crossing the box boundary are outside this query.

All 62 geometries are single-part MultiPolygons without holes; all have positive reported roof heights (12–59.55 feet). Geometry sources include photogrammetric and manual methods. Source edit dates span 2017-08-22 to 2026-06-11. The returned longitude/latitude geometry is EPSG:4326; use a suitable projected CRS (for example EPSG:2263 or UTM EPSG:32618) and subtract **one retained area origin** before using local metres. The runtime area reference records its actual transformation; this raw fixture performs none. The source metadata discourages using provider shape-area fields; none were requested.

Roof height means height above each building's ground. Retain 0.3048 metres/foot as an explicit height conversion. The provider describes NAVD88 for some ground-elevation methods but does not declare an individual datum per feature. Building-relative envelopes are physical approximations; they do not establish a common vertical survey, floors, rooms, rights, parcel boundaries or Indian ULPIN associations. BIN values are source identifiers and may not be unique.

The `evidence/` directory preserves exact metadata, terms and count-response bytes. [NYC Open Data terms](https://opendata.cityofnewyork.us/overview/#termsofuse) apply to this local informational demonstration; the data has no warranty and the City does not endorse this application. Do not relabel the source as public domain or a Creative Commons license.

GMDA's built-up metadata was successfully read during the same acquisition. Its item information has empty `licenseInfo` and `accessInformation`. Only metadata is cached: feature acquisition remains disabled until applicable reuse authorization is established. No personal GMDA field values were requested. See [source catalog](../../apps/web/lib/source-catalog.ts).

Reproduce the source request using `query` and the exact URL recorded for `original.geojson` in the manifest, after checking current source terms. The live dataset can change; preserve this snapshot and create a new revision rather than overwriting it.
