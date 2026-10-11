TASK   DA5 — small real GeoJSON with declared projected CRS       GATE GF1 data prerequisite
WORKS  Read one unchanged authority parcel export within the 2,000-feature / 16 MiB bounds.
SEE IT Run the read-only command below; result.json pins the same observations.
INPUTS Condominium parcels; three multipart features and missing/repeated parcel keys in that same file.
GAPS   Foreign test_only; parcels include application-stage records; no GF1 runtime qualification.

## Retained original

**F** = `Niagara_Falls_Condominiums_7254610803234545967.geojson` (unchanged server basename).
**P** = `E:/BhuAayam-data/datasets/map-formats/niagara-falls/`; retained path P + F.
Receipt: P + F + `.receipt.json`. All exact source URLs, IST times and hashes are in [result.json](result.json).

| File | Publisher / URL | Format | Bytes | Licence | Retained path | SHA-256 (12) |
|---|---|---|---:|---|---|---|
| F | City of Niagara Falls / [download][export] | GeoJSON | 157,817 | OGL 1.0 | P + F | dece86e3bc85 |

The [publisher item][item] describes condominium property parcels, registered or in the application process.
This is the entire 155-feature municipal dataset, not a locally selected area or building-footprint subset.
Buildings were preferred; the first facility-parcel fetch was excluded after personal dedications were found.
**Two file GETs total**, each HEAD-sized: excluded facility export 586,756 bytes; retained parcel export 157,817.
No further fetch; no account, login, form, token, CAPTCHA or click-through agreement was required.
Discovery, item, layer, count and terms pages are recorded in result.json; nothing was sent or uploaded anywhere.
The excluded task-created inspection checkpoint was discarded; every pre-task original/receipt is untouched.

**Licence re-read for this dataset:** [Open Government Licence–Niagara Falls 1.0][terms], updated November 2022.
The dataset item's licence links these terms. Copy/adapt/distribute permitted with attribution; personal information,
unauthorized third-party rights and official symbols excluded; no warranty/endorsement. Local foreign `test_only`.
Attribution: “Contains information licensed under the Open Government Licence–Niagara Falls.”
All 155 property rows screened: development/address names, codes, categories and plan URLs; no person records,
contact lines or personal remarks found. Place/development names are not treated as owner or applicant names.

## Bytes as written

Exact top-level member: `"crs":{"type":"name","properties":{"name":"EPSG:2958"}}`.
Portal default used: plain GeoJSON download, no CRS option or output-system parameter requested.
Offline CRS lookup confirms a projected declaration; no coordinate operation was performed.
FeatureCollection: **155 features**; **152 Polygon, 3 MultiPolygon, 0 null**.
Extrema, numbers only: x **649726.0876 — 659573.8631**; y **4767147.0001 — 4778143.4699**.

| Property | Value types | Distinct non-empty / features | Null |
|---|---|---:|---:|
| OBJECTID | integer | 155 / 155 | 0 |
| PID | integer, null | 151 / 155 | 3 |
| CONDO_ID | integer, null | 152 / 155 | 2 |
| NAME | string, null | 149 / 155 | 5 |
| conNo | string, null | 153 / 155 | 1 |
| TYPE | string | 6 / 155 | 0 |
| STATUS | string | 3 / 155 | 0 |
| CONREGDATE | string, null | 119 / 155 | 22 |
| CONLEVELS | string, null | 11 / 155 | 11 |
| CONNOUNITS | string, null | 76 / 155 | 6 |
| URL | string, null | 120 / 155 | 35 |
| AREA_SQM | number | 155 / 155 | 0 |
| LENGTH_M | number | 155 / 155 | 0 |

All 13 properties are present on all features; no empty strings. Samples/counts retained in result.json.
Candidate-identifier observation: **OBJECTID, AREA_SQM and LENGTH_M each have 155 distinct non-empty values
on 155 features**. Counts only, not an identifier choice or claim that measurements are stable identifiers.
Null and repeated parcel keys remain unchanged; no association, registry, rights or learning claim.

## Checks / handoff

```bash
PYTHONDONTWRITEBYTECODE=1 PROJ_NETWORK=OFF \
  E:/BhuAayam-data/ml/venv-k3a-geo/Scripts/python.exe docs/evidence/gf1/da5/read-original.py
```

Reader exits 0 and compares bytes, SHA-256, CRS, geometry counts, properties and extrema with the saved evidence.
Default Python lacked pyproj; no install attempted. The first script name shadowed stdlib inspect; renamed before use.
Ran `pnpm exec tsx --tsconfig apps/api/tsconfig.json scripts/api/refresh-contract.ts` with base commit
`92b4d921bb62bb970669c6f3061c6bea5ca82b07`: exit 0; only datasets.json's source pin changed, OpenAPI unchanged.
`PYTHONDONTWRITEBYTECODE=1 python scripts/api/check.py`: exit 0 (310 operations, 351 schemas).
No product/test change or runtime import occurred.
DESIGN Read-only reader + external original/receipt + measured result; one additive catalogue/source-index entry.
NEXT Lead reviews this data prerequisite; implementing and walking declared-CRS intake is a separate task.

Retained
`E:/BhuAayam-data/datasets/map-formats/niagara-falls/Niagara_Falls_Condominiums_7254610803234545967.geojson`:
155 polygon features, `crs` member `"crs":{"type":"name","properties":{"name":"EPSG:2958"}}`, 157817 bytes,
candidate identifier OBJECTID (155/155; AREA_SQM and LENGTH_M also 155/155; no choice).

[export]: https://hub.arcgis.com/api/download/v1/items/f657095d520a421a93f0eec753027c29/geojson?layers=0
[item]: https://www.arcgis.com/sharing/rest/content/items/f657095d520a421a93f0eec753027c29?f=json
[terms]: https://open.niagarafalls.ca/pages/terms-of-use
