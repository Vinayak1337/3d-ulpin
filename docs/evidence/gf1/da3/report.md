TASK   DA3 — publisher words for NYC height fields       GATE GF1 data prerequisite
WORKS  Read the unchanged publisher metadata and reproduce pack height-literal counts locally.
SEE IT `PYTHONDONTWRITEBYTECODE=1 python docs/evidence/gf1/da3/inspect.py`
INPUTS Authority HEIGHT_ROOF definition + difficult missing-unit/conditional GROUND_ELEVATION definition.
GAPS   Neither field has a stated unit; portal spelling map and nearest revision unverified; no runtime gate.

## Retained original

**OTI** = City of New York Office of Technology and Innovation.
**P** = `E:/BhuAayam-data/datasets/nyc-10013-linked/nyc-office-of-technology-and-innovation/`.
Path below is P + file, with `<file>.receipt.json` beside it. Receipt pins acquisition time in IST and unchanged bytes.
**U** = licence **not stated, permission unconfirmed**; section 1 links [Terms of Use][terms], not fetched.
The receipt records no licence grant; result.json separately records the publisher's linked terms.

| File | Publisher / URL | Format / bytes | Licence | Retained path | SHA-256 (12) |
|---|---|---|---|---|---|
| Metadata_BuildingFootprints.md | OTI / [original][original] | Markdown / 12,973 | U | P + file | 520c8ef5bb68 |

One GET, total 12,973 bytes, below 50 MiB. No account, login, form, CAPTCHA or agreement; nothing uploaded or sent
to a provider. City Employees links excluded, not opened. No access route established as needing the owner.

## Publisher's words — section 3, Attribute Information

`HEIGHT_ROOF` (Shapefile `HEIGHTROOF`), original line 43:
> The height of the roof above the ground elevation, not height above sea level.

Its availability note says exactly:
> Records where this is zero or NULL mean that this information was not available.

**Unit: not stated.** Horizontal US foot, accuracy feet and capture thresholds do not state this field's unit.
`GROUND_ELEVATION` (Shapefile `GROUNDELEV`), original line 42:
> Lowest Elevation at the building ground level. Calculated from LiDAR or photogrammetrically.

**Unit: not stated.** The same row conditionally bases the value on North American Vertical Datum of 1988 when
collected photogrammetrically or from modern sources; it is not a blanket datum assertion for the pack.
The exact Markdown sentence, including the datum link, is retained as concatenated quote parts in result.json.

Pack names `height_roof` and `ground_elevation` are recorded separately: **mapping unverified**.
The document lists attribute and Shapefile spellings, not portal API spellings; no list showing both was retained.
No case-folding guess is made. Search stopped immediately on this document's missing field unit, as instructed.

## Dataset and date match; pack counts

Pack README has no dictionary; source-info/manifest.json lists LiDAR/DEM/imagery, **not the buildings download**.
The unchanged buildings hash matches `scripts/demo-import/nyc-profile.json /layers/0`, dataset `5zhs-2jue`, issuer OTI.
The existing real-sources.md postal-area entry links that dataset to this official metadata; exact query remains absent.
Metadata date literal is `10/09/2025`. Bytes equal `fixtures/real-area/evidence/nyc-building-metadata.md`.
Its catalogue receipt records 13 September 2026 acquisition, before the pack's 27 September multimodal assembly.
Thus the words were retained contemporaneously, not merely a later changed page. **Nearest historical revision and
buildings fetch time are not established**; no history search after the required stop.

All 1,662 original features counted, not the 1,661 accepted geometry denominator; numeric strings remain strings.
Present (including null): 1662. Null: 0. Absent: 0. Zero: 0. Negative: 0.
Smallest value as written: 9.
Largest value as written: 570.26712859.

The publisher's document does not state unit; nothing may be stated from it.

DESIGN `inspect.py` verifies receipt, exact quotes, contemporary byte equality and read-only literal counts.
       `result.json` pins the finding; catalogues add one entry only. No product/test changes or derived data.
CHECKS Inspector, contract pin refresh and API check recorded in result.json; no GF1 runtime gate claimed.
PINS   Refresh command uses base `94e504b19367d051a6f45a15b870db44048c8cdb`; generated OpenAPI stays unchanged.
NEXT   Lead keeps heights unknown/flat; owner reviews permission before broader use. No unit declaration qualified.

[original]:
  https://raw.githubusercontent.com/CityOfNewYork/nyc-geo-metadata/main/Metadata/Metadata_BuildingFootprints.md
[terms]: https://opendata.cityofnewyork.us/overview/#termsofuse
