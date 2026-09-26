# Retained real-source reference notes

Updated 26 September 2026. This preserves source lineage from the former demonstration guide; it is not a seed/import walkthrough or proof that a current route has passed. Active source requirements are [H23](docs/usp-agent-handoffs/23-india-data-and-delivery-plan.md), [H28](docs/usp-agent-handoffs/28-data-acquisition-and-finale-tests.md) and the [delivery policy](docs/usp-agent-handoffs/current-delivery-policy.md).

Retain `fixtures/real-nyc/` originals, manifest, hashes and deterministic extraction history. This is an exterior footprint/published-height source, not interior, title or Indian operational evidence. Recheck source permission and current service support before any separately assigned use. Discover new Indian operational/test inputs from data.gov.in or their responsible official issuer; vendor predictions and community maps are not official substitutes.

## Where to get the originals

- [NYC Open Data BUILDING dataset](https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue): the working real-data example supplied here.
- [Download the selected original GeoJSON](https://data.cityofnewyork.us/resource/5zhs-2jue.geojson?doitt_id=353927): exact public query for OTI/DOITT ID **353927**, BIN **2019299**. The response was saved unchanged on 13 September 2026 as `fixtures/real-nyc/original.geojson`; the manifest records its SHA-256. Live data may subsequently change.
- [City of New York metadata](https://github.com/CityOfNewYork/nyc-geo-metadata/blob/main/Metadata/Metadata_BuildingFootprints.md): explains references, geometry/height attributes, source quality and the exclusion of interior divisions.
- [NYC Open Data terms](https://opendata.cityofnewyork.us/overview/#termsofuse): public access does not mean a warranty of survey accuracy. Attribute the City of New York Office of Technology and Innovation.
- [buildingSMART IFC examples](https://technical.buildingsmart.org/standards/ifc/ifc-examples/): original BIM test files for a future IFC importer. This application cannot currently import those files; these are interoperability examples, not cadastral evidence.

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

The former synthetic-file and seeded-case navigation instructions are retired. Historical guide text remains at `92e4d04cdeaaa2d8ccc65680c6fea1675dcee88a:DEMO_DATA.md`. Do not restore retired packages to follow it.
