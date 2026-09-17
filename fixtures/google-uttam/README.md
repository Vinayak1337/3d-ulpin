# Google Uttam Nagar — bounded input bundle

The source is Google Research Open Buildings V3, with OpenStreetMap road and selection context. This is distinct from the neighbouring OSM-only studies. See `../../docs/GOOGLE_UTTAM_NAGAR.md` for exact source URLs, licensing, verification, local IDs and reproducible commands.

`00-all-google-detections.geojson` retains all **91** model detections inside the selected street block. `01-google-building-footprints.geojson` contains the **15** detections meeting the explicit **0.801** tile confidence threshold; the threshold is not an accuracy guarantee for this block. `02-osm-road-centrelines.geojson` contains **35 clipped road/path segments**, with no inferred legal width.

`03-DEMO-building-envelopes.geojson`, `04-DEMO-road-corridors.geojson` and `05-DEMO-road-conflict.geojson` are **separate invented scenario inputs**. Heights, 6 m road widths and the proposed crossing are not observed facts. The PNG plans and `synthetic-interior-spec.json` author three fictional buildings with 9 floors, 27 spaces and fictional shared-use allocations. No genuine owner, resident, deed number or cadastral parcel is asserted.

`block-boundary.geojson` is a computed street-enclosed analysis extent, not an official parcel or administrative block. `selection-report.json` records the count, threshold, raw-source hashes, selection bounds and independent synthetic-intersection calculation. The full Delhi archive is retained outside the repository, not bundled here.

The files preserve public source geometry and do not include Google Maps imagery. Credit Google Research Open Buildings V3 and OpenStreetMap contributors. Geographic inputs and their authored derivatives in this combined bundle use the ODbL 1.0 licence option; see the source documentation for provider terms and limitations.
