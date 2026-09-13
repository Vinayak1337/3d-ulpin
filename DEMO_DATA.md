# Files to show at the hackathon

The current registry presentation is **fully synthetic**. Follow the root
[registry demo guide](REGISTRY_DEMO_GUIDE.md); the public-data material below is
preserved for the separate legacy workbench.

## Ready-to-use files in this repository

| Folder | What it contains | Classification |
| --- | --- | --- |
| [fixtures/registry](fixtures/registry/) | Connected neighbourhood JSON, level CSV, labelled plan PNG/PDF and fictional rights PDF | Current synthetic registry demo: 8 m³ correction and 12/4 m³ excavation impacts. |
| [fixtures/c001](fixtures/c001/) | `spatial.json`, level/control CSVs, `plan.png`, `plan.pdf` | Synthetic two-storey/basement teaching example; demonstrates interior spaces and the 6.4 m³ correction. |
| [fixtures/c002](fixtures/c002/) | Another JSON/CSV/PNG/PDF set with different outlines | Synthetic alternative geometry; 14.4 m³ correction. |
| [fixtures/real-nyc](fixtures/real-nyc/) | Original public GeoJSON, converted spatial JSON, roof-height CSV, provenance manifest | Real public building footprint and published height; a derived exterior prism with no interior-room/floor evidence. |

GeoJSON is a standard geospatial format encoded as JSON. The original NYC file
has a FeatureCollection, geographic coordinates, MultiPolygon geometry and city
attributes. Our converted `spatial.json` is a different, explicitly limited
application format in local metres. Do not describe the converter as a universal
GeoJSON, CAD, BIM or LiDAR importer.

## Where to get the originals

- [NYC Open Data BUILDING dataset](https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue): the working real-data example supplied here.
- [Download the selected original GeoJSON](https://data.cityofnewyork.us/resource/5zhs-2jue.geojson?doitt_id=353927): exact public query for OTI/DOITT ID **353927**, BIN **2019299**. The response was saved unchanged on 13 September 2026 as `fixtures/real-nyc/original.geojson`; the manifest records its SHA-256. Live data may subsequently change.
- [City of New York metadata](https://github.com/CityOfNewYork/nyc-geo-metadata/blob/main/Metadata/Metadata_BuildingFootprints.md): explains references, geometry/height attributes, source quality and the exclusion of interior divisions.
- [NYC Open Data terms](https://opendata.cityofnewyork.us/overview/#termsofuse): public access does not mean a warranty of survey accuracy. Attribute the City of New York Office of Technology and Innovation.
- [buildingSMART IFC examples](https://technical.buildingsmart.org/standards/ifc/ifc-examples/): original BIM test files for a future IFC importer. This application cannot currently import those files; these are interoperability examples, not cadastral evidence.

## Indian data

Yes—both providers below cover India. They are public imagery-derived building
datasets, not official Indian cadastral boundaries, ownership records or issued
ULPINs. Links are also in **Sources → Demo files & public data**.

| Provider | Download | What is missing |
| --- | --- | --- |
| [Google Open Buildings](https://sites.research.google/gr/open-buildings/) | Use its download map to select a tile over India; polygon CSV files include WKT footprints, confidence and centre Plus Codes. Start with a small area, not the entire dataset. | The footprint dataset has no heights or interior floors/rooms. A Plus Code is not a ULPIN. |
| [Microsoft Global ML Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints) | Follow the current `dataset-links.csv` link in the README, filter `Location` to `India`, and download one tile. Files are gzip-compressed GeoJSON Lines, even when named `.csv.gz`. | Height is an estimated value in metres where available; `-1` means missing, not a valid elevation. No interior floor/room boundaries. |

**These are not direct uploads yet.** The working NYC adapter is specific to its
one documented building. To feed an Indian footprint, retain the original and
attribution, select a simple polygon, project it from longitude/latitude to an
appropriate local metric CRS, retain the origin, and map it into
`parcel-local-json-v1`. Supply a `levels-csv-v1` schedule with actual height
evidence and an explicit relative benchmark. Do not replace missing height with
a made-up value. Interior levels and rooms need their own plans or measurements.
The app's current PDF/PNG plan tracing and local-metre CSV/JSON inputs are usable
with Indian surveys if you already have those files and their frame/benchmark.

Google's separate [2.5D temporal dataset](https://sites.research.google/gr/open-buildings/temporal/)
also covers India and estimates building height, but distributes raster layers;
the app cannot ingest these rasters as building geometry. Use the bundled NYC
sample for a ready-to-run public-data demo until an Indian adapter is added.

## Keep the workspace picker small

The configured demo machine keeps four distinct workspaces visible: NYC public
building, C-001 before correction, C-001 guided walkthrough after correction,
and the C-002 architectural example. Repeated verification/rehearsal workspaces
are archived, not deleted. **Show archived workspaces** in the top-left picker
reveals them; direct case links continue to work. New cases remain visible.

To restore a workspace permanently to the normal list:

```sh
pnpm exec tsx scripts/archive-workspaces.ts --restore <case-uuid>
```

Omit `--restore` to archive explicit case IDs. Archiving changes only picker
visibility; sources, geometry revisions, identifiers and history are retained.

## Show the NYC example in the UI

1. Create a new workspace named **NYC public building**.
2. Select **NYC · Public building footprint**, then **Load sample inputs**.
3. Open **Sources → Demo files & public data**. Download the original GeoJSON
   and provenance manifest to show where the inputs came from. The two imported
   files are the explicitly converted footprint and roof-height schedule.
4. Choose **Prepare geometry**, select `spatial.json` and `levels-r1.csv`, leave
   the optional control source empty, then **Prepare draft spaces**.
5. Choose **Build model**. Switch to **Property volumes** to show the computed
   exterior envelope. The decorative Building mode remains conceptual.
6. Inspect `NYC-ENV353927`: footprint approximately **123.950241 m²**, relative
   height **10.207752 m**, prism volume approximately **1265.253317 m³**.
7. Show the parent **3D ULPIN · prototype** above the viewer and open
   **View identifiers**. This source has no known interior levels, so its single
   envelope space sits in **Unassigned**, not invented numbered floors.
8. Use C-001 to demonstrate the separate floor/space hierarchy and correction
   workflow. Label it synthetic when presenting it.

On the configured demo machine, [open the prepared NYC model](http://127.0.0.1:3000/?case=d1d77c93-d979-488d-be1b-792cc81b608c).
Other machines should follow the steps above to create their own case and ID.
See the [real-data UI capture](docs/images/real-data-identifiers.png).

Suggested narration: “This is a public city building footprint, not a sample
rectangle we drew. We preserve the original, project the coordinates into local
metres and use its reported roof height to compute an exterior prism. We do not
infer interior apartments from an exterior footprint. Our separate synthetic
case demonstrates how measured floor and space evidence would be organized.”

## Conversion and limits

With the local platform running, reproduce the conversion with:

```sh
pnpm exec tsx scripts/convert-nyc-demo.ts
```

It accepts only the documented single NYC building. The source polygon must
have one part and no holes; nothing is silently discarded. PostGIS transforms
EPSG:4326 into EPSG:2263, subtracts the retained origin and converts US survey
feet to metres. Roof height **33.49 ft** is multiplied by **0.3048**; zero is
defined at the building base. No absolute vertical datum transformation is
performed. Original values, coordinate origin, factors and processing version
are recorded in `provenance.json`.

This is a constant-height envelope approximation, not the volume of occupied
rooms, a detailed roof model, an Indian land record, or proof of ownership.
No floors are inferred from height. General GIS imports, IFC, DXF and point
clouds remain unsupported. The pinned files run locally without fetching the
provider again during the demo.
