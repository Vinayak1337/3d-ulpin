# Dense block map reference

Open `http://127.0.0.1:3013/?scene=dense#map`. This fictional Delhi-style plotted block has 82 tightly packed buildings, shared walls, narrow galis and computed building/road/parcel findings. `comparison.html` shows the supplied reference, previous spacious scene and actual browser captures.

```sh
python3 -m http.server 3013 --bind 127.0.0.1 --directory design/reference-map-v5
```

## Explore the spatial cases

- B01 extends 16m² beyond P01 and into Gali 2. Its actual intersection strip is highlighted.
- B02 and B03 overlap by 9.48m², with 117.552m³ of common volume. Both keep their own geometry/identity and can be independently selected.
- B03 also extends 9.48m² outside P03. Areas from different checks are not added together.
- 68 shared-wall contacts have zero intersection area and are not conflicts.
- B12 has a footprint but no height; no walls are invented.

Click **4 spatial findings** to jump to affected buildings. Find a property, direct selection and repeated clicks on an overlap also work. Try orthographic 2D, focal floor/space selection, isolation, separation, section cuts and basement/utility views.

`deriveSpatialChecks(data)` runs on every load/import. It recomputes findings from current polygons instead of relying on demo IDs. Concave shapes, holes, touching walls, unknown vertical evidence and vertically separated solids are covered by tests. Source coordinates are not separated or moved to improve presentation. Display façade/roof/tree assets remain distinct from analytical geometry.

## Data and checks

The downloadable package includes six WGS84 GeoJSON layers, two CSV sources, normalized local-metre JSON, source master, schema, spatial-check oracle, mapping and a 14-file SHA-256 manifest. ZIP/JSON preview loading validates the package, source fingerprints, frame and record links; source changes trigger new spatial checks. Exact adapter boundaries and synthetic placement are in DATA_PACKAGE.md. The previous specimen is archived under `data/archive/t072-reference-v5/`.

```sh
node design/reference-map-v5/verify-spatial.mjs
node design/reference-map-v5/verify-spatial-browser.mjs
node design/reference-map-v5/verify-map.mjs http://127.0.0.1:3013/ docs/engineering-plan/evidence/t073/map
node design/reference-map-v5/verify-upload.mjs
node design/reference-map-v5/data/upload-contract-test.mjs
python3 design/reference-map-v5/validate-data.py
```

Python validation needs pyproj, shapely and jsonschema; the isolated environment used `/tmp/bulk-studio-schema-venv/bin/python`. Results are recorded in `docs/engineering-plan/evidence/t073/`: 29 map checks, 11 import checks, 8 browser arrangement checks and 16 runtime geometry checks passed. All 196 source features round-trip with original-byte/hash/ZIP verification. The test runner creates only test-owned corrupted ZIPs under `.runtime/t072-import/`.

Measured locally on Apple M3/ANGLE Metal at 1120×845 DPR1: continuous orbit ~30Hz, CPU submission average 4.19ms, opening 988 calls/316,650 triangles. Idle rendering stops. Device results vary.

This remains an isolated reference, with synthetic evidence and procedural materials. Product shared-viewport integration and full native-solid/terrain support are separate. Preview currently accepts up to 100 buildings, 500 objects and a 2km extent in one canonical east/north/up metre frame. Runtime MultiPolygon arithmetic does not imply MultiPolygon rendering support. Geometric intersections require review; they do not determine ownership. The live application remains empty.

ASSETS.md documents authored display assets and bundled open-source licenses.
