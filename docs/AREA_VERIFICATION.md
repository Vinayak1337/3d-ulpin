# Area release verification — 14 September 2026

This report describes checks performed for the geographic area implementation. It does not promote older review documents or synthetic fixtures to new survey evidence.

## Recorded presentation data

- Area: **Bronx building context around OTI 353927** (`9e77c608-bac7-4d56-9ac7-3032cc49074d`).
- Current area revision: **1**, containing **62 observed building exteriors**.
- Source: unchanged NYC Open Data response, SHA-256 `869c5dc4fb50d71be4f62f4a2936c29bd95ade14c712bdf4f51986841d82771a`; acquisition manifest and source terms are in `fixtures/real-area`.
- Analysis: actual transformation from source longitude/latitude to **EPSG:32618**, then subtraction of one retained area origin. Source roof heights in feet are converted to metres; each base remains building-relative.
- Identifier **353927** resolves to `3DU-4YEZ30HEP79NB9NHSG6B64J1TD:B023`, retaining the surrounding area. The identifier is a NYC source feature key, not an official ULPIN.
- Recorded-area check produced **six boundary-contact findings**, each with zero positive overlap area. It explicitly reports absent roads/public-land/utilities and unavailable shared vertical evidence. It does not establish absence of encroachment or underground conflicts.

No synthetic road or utility was recorded into this presentation area during the walkthrough. Those controls create separately labeled proposals when an operator requests them.

## Executed checks

| Check | Result |
| --- | --- |
| Production `pnpm build` | Passed; all new and legacy routes compiled |
| `pnpm typecheck` | Passed |
| TypeScript unit suite | 18 passed |
| Complete Python service suite | 115 passed, including 56 area tests and the actual 62-feature source |
| `pnpm test:api` | 17 non-disruptive API regression checks passed on the production server |
| `pnpm test:registry` | Six scenario groups passed against actual services |
| `pnpm test:registry-reimport` | Passed: concurrent retries, corrections, stable identities, source/history/rights retention, legacy mapping adoption |
| `pnpm test:area` | Six integration groups passed against actual API, PostGIS, object storage and processor |
| Desktop and 390px browser inspection | Passed: saved source acquisition, proposed/current rendering, review, acknowledgement, recording, refresh, global search, and area checks |
| Browser with external HTTP(S) blocked | Saved 62-feature area rendered; 340 local requests, including 319 Cesium assets, zero external attempts and zero browser errors; same-origin blob workers allowed |
| Production document UI | Text attachment, exact line locator, human claim and claim selection passed in an isolated synthetic area; proposed 9 m/current empty, original 6 m claim retained; temporary data removed |
| Production service health after restart | Database, object storage, processor, Redis and worker all ready |

The area integration verifies 62 real footprints and height conversions, holes with an independently expected **96 m²** area, multipart geometry totaling **8 m²**, an independently expected **12 m²** road overlap, unknown/estimated heights, source-located document claims, draft/current isolation, immutable correction history, stale review rejection, explicit rebasing, global identifier ambiguity, and synthetic utility horizontal crossing with unresolved depth. It also verifies removal of an original allocated by a failed attempt while accepted originals remain readable. Temporary integration areas and their referenced objects are removed using their own allocated identities.

## Limits that remain visible

The live acquisition connector supports the one cataloged bounded NYC extent. GMDA is metadata-only pending reuse authorization and actual coincident source verification. Geographic ingestion supports native GeoJSON and ArcGIS JSON, not every GIS/CAD format. Documents use native text extraction and operator transcription; Nous/vision assistance has not been integrated or benchmarked. Detailed rights review remains in the existing registry. This release does not construct surveyed foundations, underground pipe volumes, apartment interiors, national ULPIN coverage or legal encroachment conclusions from exterior footprints.
