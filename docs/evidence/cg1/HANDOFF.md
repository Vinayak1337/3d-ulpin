TASK   CG1 — CityGML ground outlines with stated envelope systems            GATE AUD2 (offline only)
WORKS  A public LOD2 CityGML yields one EPSG:25832 Building outline through the existing GeoJSON candidate path.
SEE IT E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe -B -m pytest -p no:cacheprovider services/geo/tests/test_citygml_outline.py -q
INPUTS Building_and_garage_LOD2-EPSG25832.gml (good) + Building_LOD1-LocalEngineeringCRS.gml (difficult), public OGC test_only originals.
GAPS   Image rebuild, CityGML profile requalification and runtime rehearsal remain; no runtime gate is claimed.

## Design and reader decision

- `native_citygml.py` now resolves effective `srsName` and `srsDimension` from each enclosing feature's own
  `gml:boundedBy/gml:Envelope`, nearest first, with nearer geometry declarations taking precedence. The old
  ancestor-only inventory fields remain literal and unchanged; `effectiveDeclaration` includes the original
  attribute locator. Tuple dimensions are never guessed. This implements the approved policy change that B3D1
  open point 1 required.
- `citygml_outline.py` consumes that projection. A Building uses its own `lod0FootPrint`, else its GroundSurface
  polygons at the first source-declared GroundSurface LoD. No roof edge, solid silhouette or composed part is
  used. Properties cite the supplied `gml:id`, basis, LoD and polygon element/byte locators. Sidecar positions are
  Building element ordinals. Closed rings and source x,y,z are retained; height stays unknown.
- `native_gis.py` reuses the derivative writer and `_horizontal_epsg`. The good file has one Building and one
  BuildingPart: only the Building produces an outline. Its compound URN supplies horizontal EPSG:25832, named
  explicitly in `crsBasis`. The local original stays unplaced and names `#local-CRS-1`; its anchor is not used.
- `outlinesConverted` queues accepted CityGML readings through the existing native derivative job (the summary
  has no CRS field, so the converter qualifies placement). `derivativeFormat`, kinds and lineage admit CityGML.
  The parent retains its native reading citation, and the child takes the existing streamed GeoJSON path.
  No registry/package/target insert is added to native settlement; officer review remains required.

## Pins and limits

Changing the reader policy necessarily changes the existing content-derived CityGML reader/profile pins.
Their hash lists already include `native_citygml.py`, so no list or stored profile was edited. The profile owner
must requalify before native reads run. `native_gis.py` also changes the existing document-reader pin; pending
jobs under old pins may be stale. Independent document-pin coverage for the new outline module remains that
seam owner's decision, as with B3D1.

Inline supported polygons only; XLinks are not expanded. Unclosed rings, unusable dimensions and mixed horizontal
systems stop conversion in words. Source z is retained with unit/reference unstated, never measured height.

## Verification and next

`result.json` records exact commands and exit codes: 34 TS tests pass; geo tests 43 pass / one optional ADE test
skipped; backend typecheck, diff whitespace and new-file line lengths pass. Initial red tests and the corrected
implementation/test errors are recorded there. Dependencies were installed from the offline cache only.

Next: requalify pins and rebuild the image; rehearse both originals through intake, verify the GeoJSON child,
streamed package/targets, review and confirmation, reload/replay idempotency and local-system words. No Docker,
runtime, image build, credentials, restricted data or closed evaluation paths were used; nothing was pushed.
