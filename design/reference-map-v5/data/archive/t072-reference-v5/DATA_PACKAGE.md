# Fictional reference neighborhood data package

This is a separate, reproducible T072 specimen. The earlier `bulk-studio-v4` fixture is unchanged. No database, application seed, repository snapshot or live service was modified. All coordinates, heights, units, controls, styles and geographic placement are explicitly **synthetic**; none describes surveyed property, legal rights or official identity issuance.

## Files to use

- `data/reference-scene.json`: normalized scene for the isolated renderer.
- `data/neem-reference-dataset.zip`: complete downloadable package with original generated source bytes, normalized exchange, local master, schema, manifest and README.
- `data/neem-reference-gis.zip`: smaller GIS layer package for extracting individual uploadable layers.
- `data/downloads.json`: actual ZIP byte lengths and SHA-256 values for download UI.
- `data/validation-report.json`: measured source round-trip and existing adapter results.
- `dataset/`: the same source files without ZIP packaging.

A ZIP containing several GeoJSON files is **not** a Shapefile ZIP. The existing application's native GIS ZIP path expects a Shapefile set. Extract and upload an individual GeoJSON layer there. A prototype package loader can instead read `normalized.json`; its integration is separate from this generator/validator.

## Scene and analytical contract

The authored extent is 180×180 metres. There are 28 individually identified buildings and plots, four connected street corridors represented by polygons, two park objects and two underground utilities. All building footprints are closed, varied polygons rather than a single resized template. Twenty-seven buildings have authored heights and one (B12) has a known footprint with null height/floor count. B12 remains footprint-only with a blocking missing-height issue.

B01 is Neem House, near [86,87], with a 16×18m envelope, a rear notch, 268m² footprint, five above-ground floors at 3.1m intervals and one basement from −3.1m to 0m. Each above-ground floor contains two flats and common circulation. Flat areas are approximately 109m² and 120m², computed from their actual closed rings; basement parking is separate. There are 16 space objects and six floor objects. Shared floor boundaries do not imply an ownership assertion. Totals are 86 objects, 86 geometry versions, eight actual source files represented by source records/metadata, six feature batches and one open issue.

The primary streets intersect at [60,62]; second streets cross at x=124 and y=126. Widths are 8–12m. Road object `attributes.centerline` is explicitly in the named local frame; road geometry is a surface polygon so rendering can join crossings. These are distinct road corridor objects; overlaps at intersections do not assert duplicate parcel ownership. The compact park immediately east of B01 is `PARK01`, spanning [99,70]–[118,120]. `PARK02` is the larger grove in the northeast.

`sceneDecoration` contains 45 trees, park paths, camera intent and deterministic building styles. Architecture is explicitly decorative, with facade inset limited to 0.9m. Rooftop equipment may extend up to 2.1m above the canonical roof only as declared display decoration, must remain inside its actual footprint and is excluded from analytical building height. Trees, textures, facade detail and roof equipment never count as cadastral records or evidence. A roof model must not be added to B12 while height is unknown.

## Source formats and transformation

The supplied Drive specimen informed the package structure, not these new shapes: separate vector layers, schedule/control CSVs, immutable local master, normalized JSON and a source manifest. The new floor-space outlines are deliberately authored fictional geometry. They are not inferred from the Drive floor schedule, whose unit polygons were unavailable.

The application code in `services/geo/geo/gis_inspection.py` and `area.py` accepts RFC 7946 longitude/latitude GeoJSON and rejects arbitrary projected `crs` overrides. Accordingly, every exported `.geojson` geometry contains actual WGS84 longitude/latitude with no custom CRS field. Local metre arrays are never mislabeled as geographic GeoJSON.

The declared synthetic placement is reversible:

1. Canonical coordinates use `LOCAL-NEEM-REFERENCE-M`, x east/y north, metres.
2. Add projected origin `[714000, 3160000]` metres to local XY.
3. Interpret the resulting coordinates in EPSG:32643 (UTM zone 43N).
4. Transform to EPSG:4326 with longitude/latitude axis order.
5. On import, transform back to EPSG:32643 and subtract the same origin.

This is a fictional placement in a geographic frame, not a georeferenced real survey. The vertical datum is `DEMO-BM-01`, an authored zero benchmark with no relation to national MSL or an ellipsoid. Heights/base elevations remain separate properties. Utility exports use 2D source lines plus `vertex_elevations_m`, explicitly in that fictional datum, so a generic GIS reader does not mistake authored depth for GPS altitude. The package adapter restores XYZ; the existing generic area adapter only verifies the 2D line.

## Mapping and compatibility

`import-mapping.json` declares field names, revision/identity namespace, exact transformation and roles. Feature IDs and `object_id` agree and survive reorder/reimport. Original full source features are retained in `sourceRecords.attributes`; lineage fingerprints hash the canonical serialized full feature. Each source references its actual generated bytes, SHA-256 and length. Normalization does not reuse a filename or row position as canonical identity.

| Source file | Existing application support checked | Mapping |
|---|---|---|
| `buildings.geojson` | GIS inspection and building normalization | `kind=building`, `idField=object_id`, `nameField=name`, `heightField=height_m`, `heightUnit=m` |
| `parcels.geojson` | GIS inspection and parcel normalization | `kind=parcel`, same ID/name fields; no height mapping |
| `roads.geojson` | GIS inspection and road normalization | `kind=road`, same ID/name fields; no height mapping |
| `open_areas.geojson` | GIS inspection and public-land normalization | `kind=public_land`, same ID/name fields; no height mapping |
| `utilities.geojson` | GIS inspection and 2D utility normalization | `kind=utility`, same ID/name fields; authored depth is separate evidence |
| `floor_spaces.geojson` | This package's schema and full geometry/ID round-trip | Existing area adapter has no floor/space feature kind; preserve hierarchy through the normalized exchange adapter |
| `floor_schedule.csv` | CSV parsed and all space area assertions checked against polygons | Supporting authored schedule; not a replacement for boundaries |
| `survey_controls.csv` | CSV parsed and five synthetic XY controls checked against transform | Synthetic transformation checks, not observed GNSS |

For all supported app imports use `worldStatus=synthetic` and retain `analysisCrs=EPSG:32643`, `origin=[714000,3160000]` to reproduce this exact local frame. The existing area adapter's vertical reference is building-relative; these pure-function checks do not prove it retains the package's custom vertical benchmark, floor hierarchy or all unmapped attributes. No claim of complete live-app ingestion is made.

The normalized exchange retains the v4 object/source/geometry/relation arrays and identifiers B01/B12. Its included schema adds optional display metadata through `sceneDecoration`; the analytical fields remain unchanged. The proposed v1.1 native-solid model in the earlier data model remains a proposal: this specimen uses explicit polygons and floor intervals, not native solid topology.

## Generate and verify

Requirements: Python 3 with `pyproj`, `shapely` and `jsonschema`. The development verification used an isolated environment under `/tmp/bulk-studio-schema-venv`; it did not alter application dependencies.

```sh
python3 design/reference-map-v5/generate-data.py
python3 design/reference-map-v5/validate-data.py
```

The generator uses deterministic authored values and fixed ZIP entry timestamps. `manifest.json` records SHA-256 and lengths for every other package file; it does not hash itself. The validator reads the actual source files, transforms each of 86 source features back to the canonical frame, verifies IDs/geometry/heights and null preservation, checks raw source/lineage hashes and lengths, checks CSV assertions, validates polygon topology and containment, validates schema, and compares ZIP CRC/inventory/entry bytes to the source directory. It calls the existing app's `inspect_gis` and `normalize_area` as read-only pure functions for all five supported feature families. No network, database or service mutation occurs.

Measured maximum source-file round-trip XY error: approximately 1.98×10⁻⁹m. This is numerical transformation agreement for fictional inputs, **not survey accuracy**. Existing app adapter checks passed for 28 buildings, 28 parcels, four roads, two public-land areas and two utilities, with B12's height remaining null. The full result is in `data/validation-report.json`.
