TASK   DA6 — large real NYC GeoJSON in CRS84                GATE GF1 data prerequisite
WORKS  Read one unchanged authority response large enough for the pending large-file package path.
SEE IT `pnpm exec tsx docs/evidence/gf1/da6/inspect.ts`
INPUTS Large CRS84 rectangle + difficult whole-file RECORD_LIMIT refusal; first pack and DA4 key comparisons.
GAPS   Product profile unavailable above 2,000 features; independent column hash only; permission unconfirmed.

## Retained original

**OTI** = City of New York Office of Technology and Innovation.
**P** = `E:/BhuAayam-data/datasets/nyc-second-area/nyc-office-of-technology-and-innovation/`.
**F** = `5zhs-2jue-box-w74.025-s40.700-e73.940-n40.800.geojson`; path P + F,
with `<file>.receipt.json` beside it. **U** = licence **not stated, permission unconfirmed**.

| File | Publisher / URL | Format / bytes | Rows | Licence | Retained path | SHA-256 (12) |
|---|---|---|---|---|---|---|
| F | OTI / [exact query][file] | GeoJSON / 43,263,076 | 48,686 | U | P + F | 0d4dd71eb16d |

Licence re-read from [portal metadata][metadata]: `licenseId: null`, no grant stated for this dataset.
DA4's publisher-linked [Terms of Use][terms] remain a link, not a licence grant. Foreign `test_only`, NYC geography.
One HTTP 200 body, completed at 10:59:51 IST on 11 October; no second file fetch, stitching, clipping or conversion.
No account, login, token, form, CAPTCHA or click-through needed; nothing uploaded or sent to a provider.
No existing file under the dataset directories changed. Exact counts, URLs, hash and receipt are in result.json.

## Rectangle and sizing

DA4: 1,175,483 / 1,417 = **829.5575 bytes per feature**. Two count requests, before any file fetch:

| Rectangle `[west, south, east, north]` (degrees) | Count | Estimated bytes | Decision |
|---|---:|---:|---|
| `[-74.025, 40.700, -73.940, 40.820]` | 54,067 | 44,851,686 | Reduce to stay below even SODA 2.0's cap |
| `[-74.025, 40.700, -73.940, 40.800]` | 48,686 | 40,387,837 | Fetch once with `$limit=50000` |

Returned **48,686**, equal to the second count, **43,263,076 bytes** (41.26 MiB): meets both requested bands.
[Limit documentation][limit] states default 1,000, SODA 2.0 maximum 50,000, SODA 2.1/3.0 no maximum.
Endpoint version was not inferred; the chosen limit works within either documented maximum. No truncation observed.
DA4's [within_box interface][query] supplies the same northwest/southeast latitude/longitude ordering.

## Read-only inventory

One whole `FeatureCollection`, no trailing content; every feature is a `Feature`.
Top-level member, **exactly as written**:

```json
"crs" : { "type": "name", "properties": { "name": "urn:ogc:def:crs:OGC:1.3:CRS84" } }
```

Geometry types: **MultiPolygon 48,686; null 0; all others 0**. No geometry validity or placement qualification.
`doitt_id`: **48,686 distinct; 0 repeated values; 0 extra occurrences; absent 0; null 0**.
First three repeated-key positions: **none** (positions would be zero-based `/features/<index>`).
Keys shared with first pack: **1,662**; with DA4: **1,417**. Neither comparison coerces a key.
All fifteen property paths have non-null type **string**; result.json lists every path and null/absence count.
`name` has **47,875 explicit nulls**, distinct from absent values; no strings parsed into numbers or measurements.

DA4's actual product `inspectedProfile` refuses the whole original with HTTP-equivalent **413 RECORD_LIMIT**,
because `geojsonInventory` allows at most 2,000 features. No limit removed and no subset profiled.
The inspector reuses DA4's pure-function loader and product JSON framing only, excluding runtime imports.
An **independent streamed aggregation**, not the product profile, lists path/type pairs and computes a comparable
hash from the same four inputs. Its hash `e9b0eeee7699a39a3f325868bd9f6742c886b9277d7a272194eef4bf46d901cc`
matches DA4. No database, server, importing, derived copy or property interpretation; no GF1 runtime gate passed.

Retained `E:/BhuAayam-data/datasets/nyc-second-area/nyc-office-of-technology-and-innovation/5zhs-2jue-box-w74.025-s40.700-e73.940-n40.800.geojson`: `48686` features, `43263076` bytes, declares CRS84, `0` repeated building keys, fingerprint `e9b0eeee7699` (`same as` DA4's file).
The sentence's fingerprint is the **independent comparable hash**, not a successful product profile.

DESIGN `inspect.ts` reuses pure readers; result/discovery and external receipt retain observations and provenance.
       Catalogues add one entry; refreshed source pin only, no product/test changes or existing originals changed.
CHECKS Inspector and API contract check exit 0; pin refreshed against base recorded in result.json.
NEXT   Lead can use the original in the pending large-file path; broader permission still needs owner review.

[file]: https://data.cityofnewyork.us/resource/5zhs-2jue.geojson?%24where=within_box%28the_geom%2C40.800%2C-74.025%2C40.700%2C-73.940%29&%24limit=50000
[metadata]: https://data.cityofnewyork.us/api/views/5zhs-2jue.json
[query]: https://dev.socrata.com/docs/functions/within_box.html
[limit]: https://dev.socrata.com/docs/queries/limit.html
[terms]: https://opendata.cityofnewyork.us/overview/#termsofuse
