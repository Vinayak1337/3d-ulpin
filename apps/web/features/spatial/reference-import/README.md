# Reference package → canonical candidate

This is a bounded compatibility adapter, not a writer or a second canonical store.

`adaptReferenceScene(originalJsonText)` accepts the synthetic normalized reference schema **1.0.0** and returns a validated `ulpin-spatial/2` input, the actual `buildCoreSnapshot` candidate, the exact input text and SHA-256, original parsed records, source-revision bindings and explicit diagnostics. No database or storage writes occur. Raw GeoJSON, raster, point cloud and arbitrary native models require their own adapters.

- Physical IDs, geometry IDs and numeric geometry revisions are preserved. Historical geometry remains in the input; `geometryId` explicitly selects the active representation. Missing geometry retains identity.
- Source revision strings are not converted into invented ordinals. Deterministic immutable source reference IDs bind the original source ID, revision token and supplied hash. Bindings preserve their original values. Source assets are metadata-only and unavailable in storage until a real receipt writer registers their bytes.
- Every geometry has an exact JSON pointer to its received normalized record. Source record locators are preserved verbatim, not guessed as row/page locators. The normalized receipt does not prove original survey authenticity.
- The shared core validates polygon topology, multipart geometry, holes, relationships and named metre/up frames. `contains` becomes the appropriate `associated_parcel` or reversed `part_of` relation. Unsupported relationship profiles remain in the receipt with diagnostics.
- Polygons with supplied base/height become prisms, including negative and nonzero bases. Unknown height retains a footprint with no analytical volume. No new official identifiers, rights or conflict decisions are fabricated.
- Core XY/prism profiles cannot represent arbitrary XYZ alignments. Such native geometry remains in the receipt and receives an unavailable representation with `UNSUPPORTED_3D_ALIGNMENT`. It is never flattened, smoothed or substituted by a box.
- Raw observations, rights, issues, identifier assertions, lineage and presentation remain receipt-only, not silently promoted to verified canonical facts. This first adapter is a geometry/identity gate.

`projectReferenceScene(adapted, { frameId?, anchor? })` explicitly projects the canonical candidate into the existing **ulpin-spatial/1 renderer DTO**. That DTO compiles through the existing `compileSpatialSnapshot` implementation. World tile compilation needs a supplied, provenance-labelled WGS84 anchor; source UTM metadata is not an implicit coordinate transformation. Multiple unrelated frames require explicit frame selection. Unknown elevation may use a labelled display zero plane, never an analytical interval. Canonical selection bindings accompany the DTO.

`toReferenceRenderScene(adapted, { frameId? })` projects supported canonical geometry back into the existing pure Three builder shape with `projectionVersion: ulpin-reference-render/1` and the canonical snapshot digest. It preserves multipart footprints and holes, derives bounded extent from coordinates, retains known source base as display-only placement when height is missing, and leaves unavailable objects without invented geometry. It strips unqualified `sceneDecoration`: a separate validated presentation sidecar belongs above this boundary. The raw received presentation remains in `originalText`/`source`.

Run the focused gate:

```sh
pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/t075-reference-adapter.test.ts
```

Tests include dense and independent renamed fixtures, rotated concave geometry, multipart wings, courtyard area, +100 m placement, negative base, unknown height, missing geometry, malformed holes, revision retention, stale source tokens, multi-frame isolation and the actual shared tile compiler. They establish data/compiler compatibility, not visual acceptance or arbitrary-format support.
