# Bulk 3D ULPIN — proposed interface

> **Direction note — 23 September 2026:** Historical standalone prototype retained for reference; not an alternative product, schema authority or new dataset. Current implementation and data/testing assignments are in [USP handoff 00](../../docs/usp-agent-handoffs/00-README.md) and the assigned feature file.

This is an isolated interactive design reference, not the implementation on port 3000. It uses a separately authored fictional dataset. The live application remains empty.

Run from the repository root:

```sh
python3 -m http.server 3012 --bind 127.0.0.1 --directory design/bulk-studio-v4
```

Open `http://127.0.0.1:3012/#map` for the map or `#batches` for the workflow. `gallery.html` presents the captured screens together. Three.js is vendored locally with its MIT license; no CDN or remote basemap is needed.

## Screens and interactions

- `#batches`: three actual fixture batches, status filters, partial recording counts and parent dependencies.
- `#import`: local file metadata preview or seven-entry sample receipt; three sources contain embedded records and four are metadata-only descriptors. No uploads or AI inference occur.
- `#review`: unknown-height exception. Deferring preserves the footprint, missing value and issue.
- `#review/plan`: floor/space selection, source-linked authored geometry, proposal overlay and a local correction note. This is not a scanned plan or extracted AI result.
- `#record/BATCH-01`: bounded selection table, inclusion of parents, cascading child exclusion, relationship/revision scope and explicit acknowledgement. Changing scope invalidates acknowledgement. Recording affects this browser tab only.
- `#map`: actual WebGL geometry, orbit/pan/zoom, 2D/3D, layers, property search, closeable inspector, floor isolation/hide-above, spaces, floor separation, section height and underground alignment. Map context survives navigation to the register and back.
- `#register`: searchable building directory. `#register/B01` opens floors/spaces, rights, readable evidence, history and a JSON export of the fictional record. Other buildings correctly show no interior geometry when none was supplied.

## Important distinctions

Official parcel 2D ULPIN assertions are separate from proposed system IDs. This fixture has no supplied official ULPIN and invents none. Rights remain unverified and separate from geometry. A source schedule area does not become a unit polygon. Missing height does not become a default extrusion. Local metres are not geographic coordinates.

The supplied Drive dataset was independently identified as synthetic. See [SOURCE_INVENTORY.md](SOURCE_INVENTORY.md) for the exact 16 content-inspected files, producer claims versus inspected content, and metadata-only/binary inspection limits. Our Neem Quarter fixture is newly authored to exercise those data concepts; it is not represented as a converted Shiv Vihar survey.

## Model and future adapters

[DATA_MODEL.md](DATA_MODEL.md) defines identity, observations, source revision/locator preservation, coordinate frames, geometry versions, relations, rights, batch idempotency and normalization mappings. [schema.json](schema.json) validates the v1 prototype exchange. The document also proposes a concrete v1.1 solid/surface/native-payload contract; that extension is not yet implemented by the schema or map renderer.

The map consumes Polygon footprints, individual floor/space polygons and LineString roads/utilities from the fixture. Façade windows and tree crowns are declared visual decoration. Perspective/exploded/section views do not change measurements. The section view clips rendered surfaces; it does not construct analytically validated cut faces. No official-standard compliance, statutory acceptance, production scalability or full modality processing is claimed.

## Validation

```sh
python3 design/bulk-studio-v4/validate-fixture.py --require-jsonschema
node design/bulk-studio-v4/verify.mjs
```

The first command requires `jsonschema`; semantic checks run without it if the flag is omitted. A temporary validation environment was used without changing repository dependencies. Browser verification uses the existing Playwright launcher. Evidence is in `docs/evidence/t071/verification.json` and its neighboring screenshots. The test is read-only toward the live application and asserts no requests to port 3000.

## Design decisions

- Retain the reference's green/white spatial workspace, remove repeated photos/statistics/issue trays.
- Replace individual-property entry with batch receipt, automatic organisation and exception review.
- One contextual map inspector; secondary layers and source facts appear on demand.
- Readable desktop typography, clear units, keyboard focus, modest motion and responsive tablet layout.
- Separate source status, processing readiness, review decision, geometry completeness and recording state.
- Bounded tables and a persistent scope summary for large deliveries; the sample is small and is not a scale benchmark.

[REFERENCE_AUDIT.md](REFERENCE_AUDIT.md) contains the source-image comparison, checks and production gaps. Appllama was not connected; the prototype used the supplied images and the relevant public-sector guidance from the taste and frontend-design skills.
