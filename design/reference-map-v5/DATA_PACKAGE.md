# Dense fictional block data package

This is the reproducible T073 dense-block specimen. The previous T072 scene, both source ZIPs, schema, reports, generator and documentation are preserved in `data/archive/t072-reference-v5/`. The earlier `bulk-studio-v4` fixture is unchanged. The active dataset has a new namespace `NEEM-DENSE-FICTIONAL-02`, revision `fictional-dense-v2`; familiar display IDs B01/B12 remain local to this dataset. No database, application seed, repository snapshot or live service was modified. All coordinates, heights, units, controls, styles and geographic placement are explicitly **synthetic**; none describes surveyed property, legal rights or official identity issuance.

## Files to use

- `data/reference-scene.json`: normalized scene for the isolated renderer.
- `data/neem-reference-dataset.zip`: complete downloadable package with original generated source bytes, normalized exchange, local master, schema, manifest and README.
- `data/neem-reference-gis.zip`: smaller GIS layer package for extracting individual uploadable layers.
- `data/downloads.json`: actual ZIP byte lengths and SHA-256 values for download UI.
- `data/validation-report.json`: measured source round-trip, declared-versus-computed conflict checks and existing adapter results.
- `data/spatial-checks.json`: exact Shapely oracle, also included in the package.
- `dataset/`: the same source files without ZIP packaging.

A ZIP containing several GeoJSON files is **not** a Shapefile ZIP. The existing application's native GIS ZIP path expects a Shapefile set. Extract and upload an individual GeoJSON layer there. A prototype package loader can instead read `normalized.json`; its integration is separate from this generator/validator.

## Scene and analytical contract

The authored block is 120×115 metres with 82 compact buildings on contiguous, mostly 8×16m plots. Front setbacks are 0–0.25m, side walls attach, footprints vary with small entrance/rear notches and heights vary across three to five storeys. Building union area covers approximately **75.52%** of the extent. This is a fictional spatial configuration inspired by tightly packed plotted/informal colonies, not a claim about the shape, occupancy or legality of any real Delhi neighborhood.

One 8m collector spans x=56–64; six 3m lanes span y=16–19, 35–38, 54–57, 73–76, 92–95 and 112–115. The only public open area is the 128m² pocket court `PARK01` at [64,38]–[72,54]. Two tree points sit inside that court. Three explicit parked cars sit in the collector; no inherited wide-suburb car positions or lawns are assumed. `sceneDecoration.urbanForm` is `dense_plotted`, ground is paved and decorative plot walls are disabled.

B01 is Neem House, near [48,46]. Its envelope is 16×17m with the original rear notch, five above-ground floors at 3.1m intervals, a basement from −3.1m to 0m, two flats and common circulation per above-ground floor. Floor/space polygons are coherently remapped into the new envelope; flat areas are approximately 103m² and 113m². B12 still has null height/floor count and remains footprint-only. Totals are **196 objects: 82 buildings, 82 parcels, six floors, 16 spaces, seven roads, one public area and two utilities**. There are eight actual source-file records, six feature batches and five open issues.

### Computed spatial configurations

The geometry intentionally includes valid attachments and distinct positive-area conflicts. These are calculated with Shapely from canonical polygons in the common metre frame; no red region is manually painted or assigned solely by a building ID.

| Configuration | Computed result | Meaning |
|---|---|---|
| 68 neighboring building pairs | Shared boundary length > 0; intersection area = 0 | Valid shared-wall plan contact; no area-overlap issue |
| B02 / B03 | 9.48m² footprint intersection, 12.4m shared height interval, 117.552m³ overlap of the authored extrusions | Deliberate building overlap; both IDs remain separate |
| B01 / P01 | 16m² outside linked parcel | The building's front extends 1m beyond the plot across a 16m frontage |
| B01 / R03 | 16m² intersection with the 3m lane | The same front strip occupies lane geometry; a separate road relationship |
| B03 / P03 | 9.48m² outside its linked parcel | The deliberate 0.6m shift producing the adjacent building overlap also crosses the plot boundary |
| B12 | Height unavailable | Evidence completeness issue, not a spatial conflict or reason for red fill |

Road and parcel tests are planar and do not claim a volume. Shared-wall contact alone is not an encroachment. These are geometric review findings on synthetic objects, **not ownership, statutory or legal determinations**. The physical building overlap's volume is supported only by the explicit authored extrusion heights and common benchmark; unknown height or a different frame would prevent that volume calculation.

The included schema explicitly extends issue records with `origin` and `evidence`: operation method/version, frame/datum, source geometry IDs and versions, computed area, optional overlap height/volume, numeric tolerances, exact `intersectionGeometry` as a MultiPolygon and `legalFinding: false`. Issue IDs are stable combinations of code and object IDs. The three spatial codes are `BUILDING_OVERLAP`, `ROAD_OVERLAP` and `OUTSIDE_PARCEL`. Missing-height evidence remains a separate issue.

`spatialChecks.buildingPairs` retains all shared-wall and positive-area pairs. `parcelEncroachments` and `roadOverlaps` retain the complete computed inventories. `spatialChecks.blocks` contains 13 exact Shapely union geometries for connected building groups, with all contributing geometry versions and **independent object IDs retained**. A union is a display/analysis grouping, not a new property identity or merged ownership. Intersection and union coordinates are local metres, not RFC 7946 geographic coordinates.

The browser runtime independently recomputes spatial issues on load/import rather than trusting this source oracle after edits. Its live report is separate from the preserved `spatialChecks` snapshot. Consumers must not present the archived oracle or its union blocks as newly computed truth after changing inputs; recompute or invalidate them using the geometry references.

`sceneDecoration` still separates synthetic facade detail, roof equipment and camera intent from analytical geometry. Rooftop equipment may extend up to 2.1m above the canonical roof as declared display decoration, must remain within the actual footprint and is excluded from measured building height. It must not invent walls or roofs for B12 while height is unknown.

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

The normalized exchange retains the v4 object/source/geometry/relation arrays and identifiers B01/B12. Its included schema adds display metadata through `sceneDecoration`, a typed `spatialChecks` oracle and computed issue evidence. Base object/source/geometry/relation fields remain unchanged. The proposed v1.1 native-solid model in the earlier data model remains a proposal: this specimen uses explicit polygons and floor intervals, not native solid topology.

## Generate and verify

Requirements: Python 3 with `pyproj`, `shapely` and `jsonschema`. The development verification used an isolated environment under `/tmp/bulk-studio-schema-venv`; it did not alter application dependencies.

```sh
python3 design/reference-map-v5/generate-data.py
python3 design/reference-map-v5/validate-data.py
```

The generator uses deterministic authored values and fixed ZIP entry timestamps. `manifest.json` records SHA-256 and lengths for every other package file; it does not hash itself. The validator reads the actual source files, transforms each of 86 source features back to the canonical frame, verifies IDs/geometry/heights and null preservation, checks raw source/lineage hashes and lengths, checks CSV assertions, validates polygon topology and floor/space containment, independently recomputes all intended conflicts and exact union blocks, validates schema, and compares ZIP CRC/inventory/entry bytes to the source directory. It calls the existing app's `inspect_gis` and `normalize_area` as read-only pure functions for all five supported feature families. No network, database or service mutation occurs.

Measured maximum source-file round-trip XY error: approximately 1.92×10⁻⁹m. This is numerical transformation agreement for fictional inputs, **not survey accuracy**. Existing app adapter checks passed for 82 buildings, 82 parcels, seven roads, one public-land area and two utilities, with B12's height remaining null. The full result is in `data/validation-report.json`.
