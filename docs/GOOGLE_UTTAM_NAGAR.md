# Google Open Buildings: Delhi download and verified Uttam Nagar integration

## What is installed

This study uses the actual **Google Research Open Buildings V3** polygon download, not building outlines scraped from Google Maps. A bounded OpenStreetMap download supplies road centrelines and the selection boundary. Source footprints and invented 3D/occupancy records are kept in different application areas.

| Area | Local ID | Contents |
|---|---|---|
| Google Uttam Nagar — public footprints and roads | `276dc595-97c4-4253-bf47-db4a12fd542b` | 15 selected Google detections and 35 clipped OSM road/path segments; no invented heights or inhabitants |
| Google Uttam Nagar — FICTIONAL 3D registry | `457bac4c-1c6c-4157-a12a-1d44ba3c1bcf` | Separate synthetic copies of the 15 outlines, 35 assumed-width road corridors and one invented conflict corridor |

Open the two areas at `/blocks/<area-id>`. The synthetic register contains three detailed buildings:

| Building | Canonical building ID | Floors | Spaces | Fictional individuals |
|---|---|---:|---:|---:|
| UN-A | `32de2af6-bf96-49e4-8730-f8f856dcee6b` | 3 | 9 | 6 |
| UN-B | `24254d19-43c5-445a-9389-70e180cbef1e` | 4 | 12 | 8 |
| UN-C | `71e63a99-6c58-40de-ab13-1c6a4fdef1ea` | 2 | 6 | 4 |

Each floor has two invented apartment/room records plus one invented shared-access space. Totals are **9 floors, 27 spaces, 18 fictional individual occupants and 9 fictional common-access groups**. All party entries use the existing `shared_use` record type, are source-linked, and explicitly disclaim real residence or ownership. These are not official registrations or official ULPINs. No cadastral parcel or real parcel identifier was supplied for this Google study.

## Actual Delhi download

The regional Google shard `391_buildings.csv.gz` was downloaded from the official Google bucket, with **7,189,068,430 compressed bytes and 73,380,259 rows**. The region is larger than Delhi.

Using the OpenStreetMap Delhi administrative relation `1942586`, the pipeline retained source rows whose polygon centroid is inside that boundary. The output contains **2,432,825 detections**, preserving original CSV field values, WKT geometry and confidence scores. This is not a claim that Delhi has exactly that many distinct real buildings: model detections have omission and commission errors.

On the verified Windows installation:

```text
E:\Projects\uttam-nagar-import-20260917\downloads\391_buildings.csv.gz
E:\Projects\uttam-nagar-import-20260917\data\delhi-google-open-buildings-v3.csv.gz
E:\Projects\uttam-nagar-import-20260917\delhi-extract-report.json
```

The Delhi-only compressed CSV is **235,760,358 bytes**. SHA-256:

```text
cdd065b5a4d6816a9e40d68c72ae988021006c74f1024a97e3544d459668283d
```

The large regional download and Delhi extract remain local, outside Git and outside the small demonstration-input bundle. The entire Delhi dataset was **not loaded into the app's local 3D viewer**; only the bounded block was imported.

## Block selection and accuracy limits

The selected study polygon is about **18,858.56 m² / 1.89 hectares**, near longitude `77.0621305`, latitude `28.6207789`. It was generated from an enclosed OSM street-centreline network. It is an analysis block, **not an official ward, cadastral parcel or registered layout block**.

There are **91 source detections** in the selected block. The main imported layer uses the provider's tile-level estimated 80%-precision confidence threshold of **0.801**, leaving **15** detections. The other **76** lower-confidence detections are retained in `00-all-google-detections.geojson`; they were not silently destroyed or replaced with invented footprints. The threshold is a regional calibration, not a measured accuracy guarantee for Uttam Nagar or any individual building. The sparse high-confidence view is therefore not a complete inventory of houses on the street.

The V3 model inference was performed in May 2023. The underlying imagery may be older, and the download date is not its capture date. Building outlines, road centrelines and administrative boundaries are not a common-date survey. No height, floor layout, building use, address, inhabitant or ownership was inferred from the Google polygons.

## Synthetic geometry and conflict

The synthetic copy has invented exterior heights. The three detailed interiors use authored inset rectangles, divided into two rooms and common access, with assumed 3 m floor heights. The supplied PNG plans are visibly labelled fictional and not surveyed. Native CSV level schedules are converted into actual worker-computed spaces and committed through normal geometry and registry review.

For road display, a **6 m width** is an explicitly invented scenario assumption about each OSM centreline, not a measured street width or legal road reservation. An additional invented corridor deliberately crosses UN-A. Independent projected-geometry calculation gives **64.84958794616 m²** of intersection. The running application's fresh check measured approximately **64.850 m²**, within the verification tolerance. This demonstrates a real calculation on fictional test inputs, **not a finding of real encroachment**.

The check also reports other intersections of the assumed road buffers and scenario outlines. Those must not be presented as observed violations. The scenario-isolation policy prevents unrelated fictional copies at the same coordinates from automatically contaminating the public reference or this scenario's checks.

## Registration research

The Delhi land-record portal exposes Khasra/Khatauni and Jamabandi lookup and a GIS link. The current NGDRS citizen e-search requires a name, mobile number, CAPTCHA and OTP. The downloaded Google/OSM identifiers do not establish a validated crosswalk to those cadastral/deed identifiers or to individual rooms.

No authoritative same-footprint/same-room ownership or occupant record was established for this selected block. This does not imply that records do not exist. No access barrier was bypassed and no actual private household directory was collected. The requested fallback therefore uses clearly fictional residents and shared-use allocations, each linked to a retained authored source.

## Reproduce the bounded import

**Normal update / another computer:** use [UTTAM_NAGAR_SETUP.md](UTTAM_NAGAR_SETUP.md)
and `pnpm data:uttam:install`. It restores the exact saved Google and OSM reference
and fictional datasets, with identifiers preserved, without replaying the import
or replacing the base snapshot. The commands below are the earlier, advanced
source-replay workflow and must not be run on top of that saved-data bundle.

The app must be running locally, with the Docker platform and `REPO_DATA=true` repository mode already initialized. From the repository root in PowerShell:

```powershell
node scripts/google-uttam/import.mjs fixtures/google-uttam context
node scripts/google-uttam/import.mjs fixtures/google-uttam details
node scripts/google-uttam/import.mjs fixtures/google-uttam residents
node scripts/google-uttam/verify-and-record.mjs ..\uttam-nagar-import-20260917\evidence\google-new-run
```

The importer uses ordinary HTTP upload, field mapping, missing-height decisions, preview/review, recording, preparation facts, worker processing and registry review. It does not insert application records directly with SQL. Its private checkpoint is `.runtime/google-uttam/installed.json`. Preserve that file: it binds source hashes to local IDs and permits resumption without overwriting already recorded data. Do not copy these local IDs into a different database or delete its checkpoint and blindly reimport.

For a fresh Google acquisition, the Python scripts in `scripts/google-uttam/` run in the already available `ulpin-geo:local` Docker image. Bind an acquisition folder to `/work` and the scripts directory read-only to `/scripts`. `acquire.py plan`, `download` and `extract` perform bounded source acquisition and the Delhi filter; `osm_roads.py`, `prepare.py` and `complete_bundle.py` prepare the selected inputs. Inspect the source-plan sizes before starting another 7.19 GB download. Existing acquisition outputs are intentionally not overwritten.

## Verification and evidence

The recorded acceptance checks original Google geometry/confidence preservation, unknown real heights, public-versus-fictional separation, all detailed floors/spaces, fictional party labels and source links, exact source-file hashes, actual worker-computed geometry, a new UI-triggered conflict check, PDF export, room/party search, original document preview, workspace access and reload persistence. It also checks that Lake View remains at 22 features and Bronx at 62.

The pre-task database-row fingerprint comparison passed with every original row preserved. All 497 original snapshot object keys were checked again for identical bytes, MIME type and metadata. Additions are expected; strict whole-snapshot equality is not appropriate after importing new areas.

Recordings and reports from the original acquisition are saved under `E:\Projects\uttam-nagar-import-20260917\evidence`. The exported PDF was rendered and inspected. No environment files or service credentials belong in the shareable package. The bounded inputs, implementation and additive saved-data transfer are now included in the repository; this does not publicly deploy the application.

## Sources and licensing

- Google dataset description, fields, limitations and licence choice: https://sites.research.google/gr/open-buildings/
- Exact shard: https://storage.googleapis.com/open-buildings-data/v3/polygons_s2_level_4_gzip/391_buildings.csv.gz
- Threshold table: https://storage.googleapis.com/open-buildings-data/v3/score_thresholds_s2_level_4.csv
- Delhi boundary: https://www.openstreetmap.org/relation/1942586
- Bounded OSM road source: https://api.openstreetmap.org/api/0.6/map?bbox=77.053,28.615,77.069,28.629
- OSM attribution and licensing: https://www.openstreetmap.org/copyright
- Delhi land records: https://dlrc.delhi.gov.in/
- NGDRS citizen e-search: https://ngdrs.delhi.gov.in/NGDRS_DL/DLSearch/citizenloginesearch

Credit **Google Research Open Buildings V3** for predicted outlines and **OpenStreetMap contributors** for boundary/road context. Google offers CC BY 4.0 or ODbL 1.0; this combined geographic study is distributed using the ODbL 1.0 option to retain compatibility with its OSM-derived selections. Authored scenario inputs are identified as derivatives and are not endorsed by either provider.
