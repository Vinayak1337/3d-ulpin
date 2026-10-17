# DA1 / GF1 — real authority map originals

**Five unchanged originals cover all six requested kinds; three foreign authority families, all `test_only`.**
No product/test changes, conversion, filtering, upload/import, labels, models or provider calls.
These are issuing-portal-generated exports, not local conversions or third-party mirror downloads.
Exact URLs, native paths, SHA-256, acquisition times, fields, CRS and licences: [result.json](result.json).
Originals and neighbouring receipts: `E:/BhuAayam-data/datasets/map-formats/`, outside Git.

| Kind | Authority / format | Bytes | Features | CRS / disposition |
| --- | --- | ---: | ---: | --- |
| 1 — footprint ZIP | Tweed Shire Council / Shapefile | 12,849 | 88 | EPSG:28356; retained |
| 2 — footprint GPKG | Tweed Shire Council / GeoPackage | 151,552 | 88 | EPSG:28356; retained |
| 3 — authority KML/KMZ | Tweed Shire Council / KMZ | 16,243 | 88 | KML semantics; retained |
| 4 — GeoJSON, 16–64 MiB | Niagara Falls / GeoJSON | 26,660,992 | 42,247 | EPSG:2958; retained |
| 5 — GeoJSON, 100 MiB–1 GiB | Halifax / GeoJSON | 107,832,285 | 172,409 | EPSG:3857; retained |
| 6 — ZIP/GPKG ≤16 MiB, ≤2,000 | Same Tweed ZIP and GPKG | as above | 88 each | Both qualify |

Kind 5 meets ≤500,000 features. Usable originals: **134,673,921 bytes**; including excluded Kitchener:
**265,057,731 bytes**, plus small metadata/control responses, below **3 GiB**. HEAD size preceded every usable GET.
Initial E: free space: **581,797,883,904 bytes**, **2026-10-11 08:03:29 IST**; final observation in result.json.
ZIP DBF/SHX counts, read-only GPKG counts/SRS, KMZ Placemarks and streaming GeoJSON counts match publishers.
KMZ `doc.kml` has 88 Polygon Placemarks; attributes use HTML descriptions, no `Data`/`SimpleData` declarations.
No explicit EPSG was invented for KML. Vertical references remain null/unqualified throughout.
Halifax Polygon/MultiPolygon/null geometries are unchanged; publisher outlines include rooflines/pedways/podiums.

## Discovery and closed dispositions

India-first search: approximately **08:03–08:13 IST**, then foreign authorities; [issuing URLs](india-search.json).

| Candidate / route | Disposition |
| --- | --- |
| OGD / NWIC / KSRSAC | No matching original located; administrative boundaries do not count |
| SOI / Bhuvan / Pune | Login/cart, written permission or purpose/CAPTCHA; **needs owner**, no bypass |
| Other Indian municipal hosts | DNS/timeout/403; transport gaps, not proof of absent authority data |
| Existing libkml KML/KMZ | Software demonstrations, not authority records; unchanged, no duplicate |
| Redlands / Calgary university copy | OWNER field / restrictive copying permission; not acquired |
| Bend / Cambridge / Peterborough | Dynamic export has no size bound; not acquired |
| Bloomington / Hobart | Pending or unsized export; no polling/repeated download loop |
| Toronto SolarTO | 604,382 rows exceed kind 5 ceiling; not acquired |
| Kitchener large GeoJSON | Person names in NOTES; **excluded**, replaced by Halifax |

Tweed CC BY version is unstated; attribution **Tweed Shire Council, Council Buildings**.
Niagara and Halifax issuer Open Government Licences are **1.0**; licence links and attribution are in result.json.
Kitchener schema-only preflight missed names in free text. Excluded bytes remain isolated, unchanged, outside Git;
no personal values are copied into evidence or sent to providers. Schema-only screening is insufficient for notes.
Existing Halifax/Kitchener learning splits remain untouched; format inspection does not authorize learning use.

## Failures, checks and handoff

Canonical ArcGIS GET returned Pending control JSON after ready HEAD; HEAD-resolved export GET fixed retrieval.
Kitchener's 183-byte control and Niagara's refused Pending artifact are excluded, never counted as originals.
Non-200 HEAD now refuses acquisition. Niagara's separately offered native variant required no local reprojection.
The old profiling reader failed escaped bytes; evidence inspection reused production MemberReader, unchanged.
Original hashes/HEAD sizes, six-kind bounds, native counts and additive catalogue/scope checks pass:
[checks.json](checks.json).
Contract check exits **1**, already at baseline: `API-DOC: runtime receipt changed`; [diagnosis](check-baseline.json).
Three CRLF checkout receipts match LF pins; catalogue also needs lead-owned pin refresh after integration.
No unowned OpenAPI/pin/runtime files changed; no mismatch bypassed. No UI check or GF1 runtime pass applies.
Acquisition/inspection scripts and per-file receipts remain external; their hashes/locations are in result.json.

TASK DA1 — real map originals. WORKS Five unchanged originals cover kinds 1–6.
SEE IT This table and result.json. INPUTS Tweed small inputs; Halifax large/null-geometry input.
GAPS Indian access/permission, Kitchener privacy exclusion, contract pins/EOL, product intake untested.
DESIGN Additive catalogue/source index plus measured receipts; no competing module or authority.
COMMITS Final response records the requested commit. CHECKS Byte/count/size/cap pass; contract blocked.
NEXT Lead review/integrate, refresh owned pins/EOL; separate intake owner reuses these exact originals.
