TASK   DA4 — second NYC-area building file                 GATE GF1 data prerequisite
WORKS  Read an unchanged second authority file and reproduce the column mismatch against the presentation pack.
SEE IT `pnpm exec tsx docs/evidence/gf1/da4/inspect.ts`
INPUTS First NYC pack + second real NYC rectangle with additional columns; no synthetic or held-out input.
GAPS   Columns differ; permission unconfirmed; this does not qualify the remembered-layout walk or a runtime gate.

## Retained original

**OTI** = City of New York Office of Technology and Innovation.
**P** = `E:/BhuAayam-data/datasets/nyc-second-area/nyc-office-of-technology-and-innovation/`.
**F** = `5zhs-2jue-box-w74.003-s40.732-e73.992-n40.740.geojson`; retained path is P + F,
with `<file>.receipt.json` beside it. **U** = licence **not stated, permission unconfirmed**.
Portal dataset metadata has `licenseId: null`; DA3 publisher metadata links [Terms of Use][terms], not a grant.

| File | Publisher / URL | Format / bytes | Licence | Retained path | SHA-256 (12) |
|---|---|---|---|---|---|
| F | OTI / [exact query][file] | GeoJSON / 1,175,483 | U | P + F | 4a5735dd57c0 |

[One count request][count] answered **1,417**; one file fetch retained **1,417 features**, below 1,900 and 16 MiB.
The [documented within_box interface][query] lists Multipolygon support and northwest/southeast latitude/longitude.
The [resource GeoJSON form][format] preserves string-valued numbers and declared CRS84, like the first file.
No columns selected, no export tried, no second rectangle or file fetch after the mismatch; bytes unchanged.
No account, token, login, form, CAPTCHA or agreement required; nothing uploaded or sent to any provider.

## Bounds, identity and literal inventory

Bounding boxes are `[west, south, east, north]` in the files' declared CRS84 coordinate units (degrees):
- First: `[-74.014238892183, 40.713672513704, -73.994438791934, 40.728887061137]`.
- Query rectangle: `[-74.003, 40.732, -73.992, 40.740]`, **north**, gap **0.003112938863 degrees**.
- Second bytes: `[-74.002996787755, 40.732001369785, -73.991997601055, 40.740001459498]`.
  Actual extent gap **0.003114308648 degrees**; neither rectangle nor second extent touches the first extent.
  Portal-returned geometry extends slightly beyond the requested east/north edges; nothing clipped or corrected.

E1b's layout identifies buildings by `doitt_id` (`steps.ts:222`): **0 keys in common**;
first 1,662 unique, second 1,417 unique. Geometry: **MultiPolygon 1,417**, all other types 0.
`height_roof`: **present 1,417; null 0; absent 0; numeric zero 0; numeric negative 0**.
All 1,417 values are **strings**, not numbers; no parsing, conversion, unit or meaning assigned.

## Product fingerprint — mismatch, stopped

First: `e27f2b29af7483c178b6fc8d8ad439d6f347db32ccba785d84b47c9688cbf638`.
Second: `e9b0eeee7699a39a3f325868bd9f6742c886b9277d7a272194eef4bf46d901cc`.
Version, declared CRS84/evidence and MultiPolygon inventory match. Every original path/type pair matches.
Seven additional `/features/*/properties/` paths have type `string`: **construction_year, last_status_type,
mappluto_bbl, name, objectid, shape_area, shape_length**. Each is absent from the first profile, not explicit null.

`inspect.ts` runs registry.ts's unchanged `geojsonInventory` and `inspectedProfile` function bodies through tsx,
in an isolated VM. Imports are excluded because storage.ts transitively loads `.env`; the SHA-256 primitive,
version literal and escape helper are supplied locally. Empty limitations are outside the fingerprint.
Inspection inputs follow gis_inspection.py's sorted field/type inventory and exact declared-CRS84 evidence.
This **is the product fingerprint function**, not an independent hash formula; no DB, server or geometry-validity
qualification. Source/function hashes and all path/type pairs are recorded in result.json. No product/test changes.

The second file's columns differ from the first: `construction_year, last_status_type, mappluto_bbl, name,
objectid, shape_area, shape_length: absent in first, string in second`; a remembered layout will not be proposed for it.

DESIGN Inspector reads immutable originals; result/receipt pin facts; catalogues add one entry, preserving history.
CHECKS Inspector, API contract refresh with base commit, and final API check exit 0, recorded in result.json.
PINS   Refresh used base `6f6a9eb3dd8a6944774b7e62b8cc7e653b14d11b`; only datasets.json's source pin changed.
       Generated OpenAPI has no content diff; initial API check needed that expected catalogue-pin refresh.
NEXT   Lead needs a same-column authority original for the walk; no removal/rename/cast is authorized here.

[file]: https://data.cityofnewyork.us/resource/5zhs-2jue.geojson?%24where=within_box%28the_geom%2C40.740%2C-74.003%2C40.732%2C-73.992%29&%24limit=2000
[count]: https://data.cityofnewyork.us/resource/5zhs-2jue.json?%24select=count%28%2A%29&%24where=within_box%28the_geom%2C40.740%2C-74.003%2C40.732%2C-73.992%29
[query]: https://dev.socrata.com/docs/functions/within_box.html
[format]: https://dev.socrata.com/docs/formats/geojson.html
[terms]: https://opendata.cityofnewyork.us/overview/#termsofuse
