# Importable Lake View source showcase

Open `http://127.0.0.1:3000/studio/showcase`. Download `/reference/lake-view-complete.zip`, choose **Import**, select the downloaded ZIP, then **Review on map**. The same flow is linked from **Batches → Open import demo**. Click **Save dataset** after opening the draft to persist it. A ready-to-import copy and current instructions are in `data-source/README.md`. No seed script, database reset or manually filled property form is needed.

The package reconstructs the existing authored reference-style city: 49 parcels/buildings, 184 floors, 189 spaces, 188 fictional resident records, 234 separate fictional rights/parties and nine synthetic control points. B01 intentionally intersects its parcel edge and Lake View Lane; each positive-area finding is about 21.6 m². They describe overlapping evidence, not two independent areas to add together.

1. Upload the ZIP. The importer verifies original hashes, reads vectors/schedules/controls/parties/rights, matches supplied IDs and builds the canonical draft.
2. Inspect the receipt: 50 source files, 12 read and matched, 38 retained supporting originals. Two computed findings require review.
3. Open the map. Use **Map tools** for layers or the property list. Select the red B01 building and inspect its road/parcel findings.
4. Search `DEMO-3D-ANCHOR-B01:1` or `DEMO-2D-ANCHOR-P01`. Floor identifiers follow `building3DId:floorNumber`; the basement is `:-1`. These are fictional internal IDs, never official issuance.
5. Choose **Open register**. Explore 3D / exploded / elevation / section, select a floor, then use Residents, Rights and Evidence. Download the linked original plan or fictional rights schedule.
6. **Download dataset → Original source package** exports byte-identical input. Geometry/source identifiers remain independent of visual styling.

## Included source formats

- Primary GeoJSON layers: parcels, buildings, floors, spaces, road surfaces, public land and a below-ground utility alignment.
- CSV: floor/unit schedule, fictional occupants, separate parties and rights, GNSS/CORS-shaped synthetic survey controls.
- `MASTER_SCENE.json` with the observed source vocabulary; ten normalized v1 schema families, relationship links and a normalization report. Core field names and container shapes were compared with the supplied source files. Extra base elevations, explicit unit polygons, affine transforms and fictional rights are documented authored extensions.
- GeoPackage parcels and 3D control points, independently read with Fiona and compared against the source vectors.
- Six focal-building floor-plan PDFs, SVG, plan manifest; survey-control PDF; fictional property schedule PDF; DOCX dataset report.
- LAS 1.4 / point format 7 and LAZ, with identical XYZ/classification arrays: 62,886 synthetic ground/roof samples. Manifest values are computed from these files.
- GeoTIFF orthomosaic, DEM and DSM, plus a display-only JPEG. Exact named local frame, shared north-up affine placement and synthetic vertical benchmark. No geodetic/EPSG position or real acquisition time is invented.
- Source-asset fingerprints, links, computed conflict report, floor-plan generation report and readable limitations.

The ZIP has 52 members including its two manifests. The original provided MASTER/normalized packages and previous authored demonstrations remain separate and unchanged. Empty MASTER collections mean no feature of that category was authored; they are not omitted or invented source evidence.

## Evidence boundary

This import builds geometry from the declared GeoJSON and schedules. It reads controls and source assertions but does not align new real-world surveys automatically. PDF/GPKG/LAS/LAZ/raster originals are retained, downloadable evidence; this browser profile does not claim to extract geometry from those binaries. It does not deduplicate equivalent representations by importing them twice.

The complete ZIP first opens a draft preview through the shared adapter. **Save dataset** now retains its originals and canonical source snapshot, and makes it reopenable from the dataset directory (T083). Reimporting identical package bytes reuses the existing saved record. Saved-dataset ML runs and reviews are separate retained candidates (T084), not automatic publication or statutory issuance. General raw point-cloud reconstruction, image-to-map discrepancy matching and guarded promotion of new ML proposals into canonical records remain open.

To regenerate the new fixture only, install `scripts/spatial/requirements-complete-showcase.txt` in an isolated Python environment and run `scripts/spatial/generate-complete-showcase.py`. Verify using `scripts/spatial/verify-complete-showcase.py` and `tests/t079-complete-source.test.ts`. These scripts do not seed live services or modify earlier receipts.
