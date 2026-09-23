# Lake View — complete import demo

> **Direction note — 23 September 2026:** These are existing labelled source packages, not the newly prepared D0–D7 packs. Keep their originals, ZIPs and identities; do not reseed or reset data for cleanup. Current implementation and data/testing assignments are in [USP handoff 00](../docs/usp-agent-handoffs/00-README.md) and the assigned feature file.

Import **lake-view-complete.zip**. Leave it zipped. [The canonical unpacked originals](../design/reference-map-v5/data/lake-view-complete/) are available for inspection. The redundant `lake-view-files/` copy was removed; do not upload the originals again as a second dataset.

This is an authored fictional neighbourhood, not real survey evidence or official ULPIN issuance. The package is byte-identical to the complete Lake View source package already used by the app.

## Import and render

1. Keep the local app and its services running. Open http://127.0.0.1:3000/studio/showcase.
2. Click **Import** in the top bar.
3. Click **Choose a dataset ZIP or JSON** and select `data-source/lake-view-complete.zip` from this project.
4. The receipt should show **49 buildings, 184 floors, 189 units/spaces and 50 source files**. Its two geometry findings are intentional.
5. Click **Review on map**. The complete Lake View scene is rendered from the normalized supplied geometry.
6. Click **Save dataset** to keep it in the dataset list. The same package fingerprint reuses the existing saved Lake View record, preserving its original files, IDs and history. Saving is separate from approving property geometry or issuing official IDs.
7. Use the **Map** navigation to open the dataset directory and reopen Lake View. Use the saved ID returned by this environment; do not copy a historical machine-specific dataset UUID.

## What to demonstrate

- Pan/orbit the map and select a building. Search `DEMO-2D-ANCHOR-P01`, `DEMO-3D-ANCHOR-B01`, or floor `DEMO-3D-ANCHOR-B01:1`.
- Open **2 findings to review**. B01 extends **21.6 m² outside P01** and overlaps **Lake View Lane (R04) by 21.6 m²**. These describe the same authored affected strip; do not add them together. The red building/intersection marks the location. Use **Inspect** to jump to B01.
- Open its property register for the supplied floors, fictional occupants, rights and original documents.
- Open the saved dataset's ML processing page for separate aerial-image and floor-plan inference. Each B01 plan is a one-page PDF; the property schedule is six pages and is a supporting document, not a floor plan.

## How the full map is built

ZIP → verified source files → GeoJSON/CSV adapters → shared normalized data → 3D map and register.

The full map comes from supplied building/parcel/floor geometries and schedules. It is **not reconstructed from the tiny aerial preview by ML**. Point clouds, elevation rasters and document originals are retained in this importer; their presence does not imply automatic reconstruction from every format.

Included: parcels/buildings/floors/spaces/roads/public-land/utilities GeoJSON; schedules, fictional residents and separate rights/parties CSV; synthetic control CSV/GPKG; GeoPackage; six floor-plan PDFs and SVG; survey and property reports; LAS/LAZ; orthomosaic JPEG/GeoTIFF; DEM/DSM; MASTER/normalized schema examples; manifests and checksums. There are 52 ZIP members including manifests.

## ML and conflicts — explain them separately

The retained building runs produced **10 candidate regions**, not 49 verified buildings. The result list scrolls. The 220 × 230 synthetic preview differs from real aerial training imagery; roofs may be missed or merged. No components were dropped by the polygon-size/capacity filters in those building runs. The count does not establish detection accuracy or one-to-one building correspondence.

The map checks positive-area building overlaps, parcel containment and road overlaps from the supplied geometry. Compatible known vertical ranges distinguish separated structures from overlapping building volumes. Shared edges are not collisions. The current Lake View check completed with no skipped comparisons and two findings; this is not proof that every possible data problem is detected. The preview checker is limited to 100 buildings and qualified local-metre polygon comparisons.

ML misses are **not automatically linked to map buildings** as discrepancy flags. That needs calibrated, registered image-to-map comparison and reviewed matching. Existing ML proposals remain separate from canonical map geometry.

Conflicts are **not automatically repaired**. Two overlapping footprints can represent bad alignment, duplicated records or valid structures at different heights. The correct source and ownership cannot be inferred by clipping away a building. Preserve originals; inspect and correct the appropriate revision with evidence.

`import-verification.json` records normalized counts and computed findings. `SHA256SUMS.txt` verifies the ZIP. No fixture generation or database reset is needed.

## Shiv Vihar

`shiv-vihar-complete.zip` is a byte-identical copy of the supplied `provided-master.zip` package. Import it separately through the same file chooser, Review on map, then Save dataset. It contains 32 buildings, five supplied floors, 26 schedule spaces and five declared sources. This package is synthetic too. Missing floor geometry, residents and official 2D ULPINs remain unavailable.

## Preferred upload entry

Open **Add files** from Batches or Maps, choose a complete ZIP, verify the **Review dataset** counts, then **Save dataset → Open map**. Manifest-backed packages are recognized automatically; raw Shapefile ZIPs retain the GIS inspection flow. Map → Import remains supported. An identical file reuses its saved dataset; an archived dataset becomes active again.
