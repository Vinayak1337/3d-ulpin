# T078 — Reference city and performance pass

20 September 2026, solo implementation as requested. The accepted property-register design is retained. New default is `/studio/showcase`, loading `/reference/showcase-anchor.zip`.

## Result

New authored source-only fixture reconstructs REF-01 composition: pale medium-rise buildings, open park, parcel edges, road junctions, surrounding city blocks and focal red conflict building. 49 buildings, 184 floor records, 189 unit records and 188 fictional resident records. Source files normalize through the existing shared schema on load; originals and old demonstration ZIPs are preserved. Computed outside-parcel and road intersections are both 21.6 m² and overlap, so are not summed. All identifiers remain explicitly fictional.

The image pack has no original 3D city dataset. This is an interactive authored reconstruction, not recovered survey data or a photograph placed over the map. Procedural facade/vegetation appearance still differs from the photographic-style reference. Exact visual parity is not claimed; user visual review remains open.

## Performance

`createBlockBatches` combines floor facade instance transforms and cap geometry into disposable building-level draw batches. Source arrays, named-frame measurements and floor geometry remain unchanged. Block draw batches decrease 1,601 → 392 (76%). Register and sections use individual original floor groups. Tests verify unchanged bounds and building pick identity.

Foliage triangle/alpha overdraw is reduced, world-label dimensions cached, moving labels updated at most ~15 Hz, thumbnails downsampled to 400px and deferred until stationary. Motion uses a lower pixel ratio and returns to full stationary quality. Render-on-demand remains in place.

Production browser continuous orbit at 1672 × 941: 6.94ms mean frame interval, 7ms p95; CPU render 2.43ms mean / 2.9ms p95. Viewport map area 993 × 814; motion pixel ratio 0.8. Measured on the 49-building scene before the final park/tree-spacing adjustment (that adjustment reduces foliage). Local synthetic benchmark only; see evidence/t078/orbit-benchmark.json.

## Checks

45 source/contract/integration tests and 15 runtime geometry/records/floor tests pass; final anchor generator regression passes after the park adjustment. Production build including TypeScript passes. Browser verified floor-ID search, source-linked residents, register, selected-floor section mode and exploded plates; no browser errors. Actual captures and side-by-side comparison: evidence/t078/.

The active preview does not require database/worker writes. During final verification the linked database was unavailable; no database restart, migration, reseed or overwrite was attempted. Previously stopped unused map/dev servers remain stopped.

Final serving state: production web only on port 3000 (`pnpm --filter @ulpin/web start`); disconnected dispatcher stopped to avoid unused background work. Reference comparison also available at `/reference/review/index.html`. Native CUA screenshots were verified visually after the full-page browser API returned blank images.
