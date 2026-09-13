# Files to show at the hackathon

## Ready-to-use files in this repository

| Folder | What it contains | Classification |
| --- | --- | --- |
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
