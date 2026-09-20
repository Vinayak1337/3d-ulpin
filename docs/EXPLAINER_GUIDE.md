# Inside 3D ULPIN — presentation guide

Open **http://127.0.0.1:3000/explain** with the local web app running. The page
is separate from Studio and needs no database or inference requests to present
its retained examples. Choose **Present** for browser full screen.

## A five-minute explanation

1. **The walkthrough → Source:** show the published floor plan and explain that
   original evidence is preserved separately from the inference raster.
2. **Extract:** toggle the regions, then switch to the aerial example. Both use
   actual historical worker output, not generated overlays. Explain that the
   amber floor-plan contour includes merged spaces and still requires review.
3. **Calibrate:** show how the test's two authored controls place 768 pixels
   across 40 metres. These are synthetic test controls, not surveyed dimensions.
4. **Build:** switch between the retained footprint and its 3 m test extrusion;
   rotate the schematic projection. The area and volume come from the retained
   geometry-worker receipt. The presentation does not recompute canonical data.
5. **Record:** explain source/model/calibration/level lineage and the historical
   technical revision. Visiting this page does not create or change a record.
6. **The architecture:** select components to explain the browser, application,
   database, dispatcher, storage, private job service and worker. Results return
   through the dispatcher; the worker has no application database access.
7. **The evidence:** give the actual sample sizes and IoU results. Distinguish
   pretrained-model integration from training a new model or survey acceptance.

Each stage has a short **Say it this way** presenter note. Previous/Next and
direct stage selection work independently of the main section navigation.

## Evidence and implementation

The original evidence is in `docs/evidence/t061/workflow/` and
`docs/evidence/t061/models/`. The presentation's two PNGs are byte-identical
copies of the retained inference rasters. Its polygon paths and prism footprint
derive from `batch-after-worker-retry.json` and `built-model.json`.

`apps/web/features/explainer/evidence.json` contains only the retained example
data used by this presentation. Source revisions, artifacts and current app data
remain independent. The custom SVG projection is explanatory, not the product's
shared spatial viewport or a geometry-editing interface.

The complete city ZIP showcase reads declared geometry and schedules and opens
a draft preview. It does not demonstrate ML reconstruction from its binary
attachments. See `LAKE_VIEW_SOURCE_SHOWCASE.md` for that separate walkthrough.

The UI has been checked at desktop, tablet and phone widths, including source
switching, overlays, calibration markers, 2D/3D projection, component selection,
report downloads and full-screen presentation. Run
`node outputs/ml-explainer/verify.mjs` against the local app to repeat the checks.
