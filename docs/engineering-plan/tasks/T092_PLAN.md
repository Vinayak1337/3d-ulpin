# T092 — render imported LiDAR, imagery and elevation sources

Decode existing Lake View binary originals from the verified ZIP into disposable source-view buffers. Preserve original packages, canonical geometry/digests, IDs and saved records. The same path applies to new imports and reopening saved data; no seed or migration.

Use explicit normalized lidar/imagery/elevation asset records for source path, named local metre frame, affine alignment and vertical benchmark. Validate against source bytes and raster headers; reject unsupported/mismatched frames rather than guessing. Support bounded uncompressed LAS and RGB/single-band GeoTIFF. LAZ compressed-equivalent files remain downloadable; no claim of independent LAZ decoding.

Map data selector: building model, point cloud, imagery, DEM and DSM, choosing among available source assets. Source views hide authored scenery so the data is visible. Optional building-model comparison overlay. Concise counts/elevation legend; provenance and limitations in expandable source details. Existing points and imagery are synthetic, not a real drone/LiDAR acquisition. Rendering does not extract buildings or establish ownership.

Bound point/raster decoding and GPU work, exclude no-data cells, apply local E/N/up -> Three X/Y/-Z exactly once, dispose GPU buffers with the shared runtime. Test original binary counts, georeferencing, changed bytes affect output, malformed/truncated/misaligned sources, no-data and preservation. Browser verify all four views, switching back, floor search/register and mobile scrolling. Build, publish main and deploy the existing demo without changing data.
