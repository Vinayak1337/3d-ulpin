# Delhi / Uttam Nagar source register

Acquired 17 September 2026 IST. OpenStreetMap snapshot: 2026-09-16T20:48:53Z.

## Geometry and licensing

OpenStreetMap contributors supply the reusable geographic data. Attribution and license: https://www.openstreetmap.org/copyright and https://opendatacommons.org/licenses/odbl/1-0/ . OSM data and its derived geographic scenario files in this folder are supplied under ODbL 1.0. The scenario is fictional and is not endorsed by OSM or any authority.

Delhi boundary: https://www.openstreetmap.org/relation/1942586 via Nominatim. This is the NCT community administrative polygon, not cadastral parcel data. The normalizer's 50 km local-analysis bound was not relaxed to force the Delhi-wide polygon into a property parcel.

Uttam Nagar locality: https://www.openstreetmap.org/node/7840142234 . The detailed study uses [77.0594,28.6204,77.0618,28.6223] in longitude/latitude order. It is an analyst-selected window, not an official block. Fully contained buildings were retained without clipping their outlines; road lines were clipped to this window. Raw Overpass response, exact query and download receipts are retained under sources/.

The selected extract contains 113 building outlines and 35 road segments. All buildings were tagged building=yes; the tag alone does not establish residential use. Heights and floor plans were not supplied. Actual road-land width is also unknown. No private resident or owner directory was downloaded.

The observed reference area keeps these limits. A distinct synthetic copy uses assumed heights, invented road widths, three fictional parcels, three buildings with authored rooms, fictional resident labels and a deliberately invented conflict corridor and kiosk. These are input fixtures, not real encroachment findings. Do not combine their claims with the reference layer as if they were observations.

Google Maps was used as a location reference, not as the imported source dataset. Google Maps terms: https://www.google.com/help/terms_maps/ . No map tiles, satellite photographs or building polygons were scraped from Google Maps.

## Official registration research

- Delhi land-record portal: https://dlrc.delhi.gov.in/ and https://dlrc.delhi.gov.in/Default.aspx . Khasra/Khatauni/Jamabandi records need their relevant cadastral identification; the downloaded OSM way IDs do not supply that crosswalk.
- DORIS: https://esearch.delhigovt.nic.in/ . Its public landing page states that SR offices migrated to NGDRS.
- Current registration landing page: https://ngdrs.delhi.gov.in/NGDRS_DL/ . It separates citizen search for DORIS before January 2024 and NGDRS after January 2024.
- DDA scanned-ledger catalogue: https://dda.gov.in/scanned_ledgers_files . Uttam Nagar is named, but a validated same-footprint/same-room record was not established from this catalogue.

Outcome: no authoritative polygon-to-parcel, room, household or deed matching was established for this selected study. This is NOT a claim that records do not exist. A verified property/plot identifier and appropriate source evidence are required before attaching real ownership assertions. All occupant allocations currently added by this study are explicitly fictional shared-use examples, never official ownership claims.

## Data available

The whole Delhi download here is its boundary only. Detailed buildings and roads are the Uttam Nagar window. The broader raw source query is a roughly 2 km neighbourhood cache, not an all-Delhi building archive. Filenames ending .geojson contain geographic EPSG:4326 coordinates; native room schedules are generated in the installed scenario's explicit local-metre frame.
