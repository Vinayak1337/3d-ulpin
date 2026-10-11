TASK   DA2 — NYC building-linked table and public reports       GATE GF1 / GF2 data prerequisite
WORKS  Read unchanged authority CSV/PDFs locally and reproduce literal-key coverage against the presentation pack.
SEE IT `PYTHONDONTWRITEBYTECODE=1 python docs/evidence/gf1/da2/inspect.py`
INPUTS LPC table BIN 1002934 + Holland Plaza report; duplicate BIN 1001550 + long, keyless SoHo district report.
GAPS   No PDF key literal; permission unconfirmed; pack has 1,662 features, not 1,661; no runtime gate passed.

## Retained files

Publisher **LPC** = New York City Landmarks Preservation Commission, the same NYC authority family as the pack.
**P** = `E:/BhuAayam-data/datasets/nyc-10013-linked/nyc-landmarks-preservation-commission/`.
Every retained path is P + the file column, unchanged server basename; each has `<file>.receipt.json` beside it.
**U** = licence **not stated, permission unconfirmed**; [NYC terms][terms] returned HTTP 403.
Exact URLs, receipts, hashes, columns and every count/example are in [result.json](result.json).

| File | Publisher / URL | Format / bytes | Rows/pages | Key / words | Licence | SHA-256 (12) |
|---|---|---|---|---|---|---|
| gpmc-yuvp.csv | LPC / [export][csv] | CSV / 87,352 | 753 rows | bin; bbl | U | 3c9528513383 |
| 2537.pdf | LPC / [PDF][holland] | PDF / 3,676,385 | 18 pages | 75 Varick Street | U | 2efaa36052c1 |
| 2362.pdf | LPC / [PDF][soho] | PDF / 10,071,817 | 207 pages | 275 Canal Street | U | 1321f5e90309 |

Total: **13,835,554 bytes**, below 300 MiB. PDFs had HEAD sizes; CSV HEAD said zero, GET had no Content-Length.
CSV count 753 was read before fetch; the body was bounded. One original GET per file, no retry/resume required.
Portal export selects nine columns and Manhattan BBL range 1001400000–1002409999; it is not the full dataset.
No owner/applicant/architect/name/notes columns selected; historical style names are categories, not person records.
All 753 rows were read: address cells start with digits; no e-mail cells; material/style/type categories checked.
No local subset/join was saved. BIN has numeric portal schema for 753 rows; 1,662 pack BINs are string literals.

## Literal coverage — all 1,662 unchanged pack features

| Table → building key | Exactly one row | Several rows | No rows | Rows matching no building |
|---|---:|---:|---:|---:|
| bin → bin | 612 | 33 | 1,017 | 60 |
| bbl → base_bbl | 419 | 55 | 1,188 | 261 |

Empty building keys: **0** for both. Repeated BINs: **0**; repeated BBL values: **118**, affecting **267 buildings**.
Portal BIN schema is numeric, but CSV and pack values are strings with identical digit forms; no normalisation.
Leading-zero/decimal-point/form-only differences: **0**. All requested case examples (keys only) are in the receipts.

Both PDFs have readable native text on every page; no OCR. **No key literal; names by address and tax block/lot.**
Holland PDF page 1: `75 Varick Street`; `Borough of Manhattan Tax Map Block 226, Lot 1`.
SoHo PDF page 53 (printed 48): `275 Canal Street`; `Borough of Manhattan Tax Map Block 209, Lot 35`.
Related keys read from pack/table: Holland 1002934 / 1002260001; SoHo example 1002696 / 1002090035.
These keys are **not in either PDF**, were not composed from block/lot, and are not accepted building associations.
Historical people and firm names occur in these authority public reports, not private-party application filings.
SoHo's 590,926 native text characters exceed AU4's proposed 250,000-character cap; Holland's 41,392 fit.

## Excluded / owner / lead

Full [LPC table][full] excluded: owner/developer/architect/name/notes fields; retained portal-selected columns instead.
[LPC permit applications][permits] excluded: owner/applicant names and addresses; no filing fetched.
[Individual Landmark Sites][sites] was memory-only discovery, not a second retained table.
[Another district report][other] received HEAD only; document search stopped, no third PDF.
[NYC report index][index] and terms pages returned 403; no login/CAPTCHA was established or bypassed.
Public LPC ArcGIS popup/service links verified the PDF URLs; their exact selected metadata queries are in receipts.
Owner: permission review before broader use; no other access prerequisite blocks local reading.
Lead: **AU4 can walk CSV bin → bin (or bbl → base_bbl) with plural/missing outcomes; PDFs force a no-key,
address/block-lot citation decision, never a composed exact-key tie.**

DESIGN `inspect.py` reads originals in memory; receipts/result pin facts; catalogue adds one entry per retained file.
CHECKS Inspector, contract pin refresh and final API check exit 0; initial missing-report link failure resolved.
PINS   Ran `pnpm exec tsx --tsconfig apps/api/tsconfig.json scripts/api/refresh-contract.ts` with the base commit.
       Only datasets.json's source pin changed; generated OpenAPI content is identical to baseline.
NEXT Review fallback citation handling and SoHo kept-not-read cap; no product changes, upload or provider call.

[csv]: https://data.cityofnewyork.us/resource/gpmc-yuvp.csv?%24select=bin%2Cbbl%2Cborough%2Cdes_addres%2Cstyle_prim%2Cdate_low%2Cdate_high%2Cmat_prim%2Cbuild_type&%24where=borough%3D%27MN%27+AND+bbl+%3E%3D+%271001400000%27+AND+bbl+%3C%3D+%271002409999%27&%24limit=50000
[holland]: https://s-media.nyc.gov/agencies/lpc/lp/2537.pdf
[soho]: https://s-media.nyc.gov/agencies/lpc/lp/2362.pdf
[terms]: https://www.nyc.gov/home/terms-of-use.page
[full]: https://data.cityofnewyork.us/api/views/gpmc-yuvp/rows.csv?accessType=DOWNLOAD
[permits]: https://data.cityofnewyork.us/d/dpm2-m9mq
[sites]: https://data.cityofnewyork.us/d/buis-pvji
[other]: https://s-media.nyc.gov/agencies/lpc/lp/2591.pdf
[index]: https://www.nyc.gov/site/lpc/designations/designation-reports.page
