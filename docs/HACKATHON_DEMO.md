# Hackathon demo — 3D ULPIN

> **Direction note — 23 September 2026:** This is a retained baseline demonstration, not evidence that the new features or datasets are finished. Current implementation and data/testing assignments are in [USP handoff 00](usp-agent-handoffs/00-README.md) and the assigned feature file.

Start at http://127.0.0.1:3000/studio/datasets. Keep the local web server, dispatcher, PostgreSQL/PostGIS, object storage, Redis and private worker running.

## Five-minute walkthrough

1. **Area import and map (one minute).** Open saved Lake View. It contains 49 authored fictional buildings and 184 supplied floors. Pan/orbit, select a building, inspect its property register and search its building/floor ID. Floor identifiers use the building identifier followed by `:floorNum`. These are internal demo identities, not official issuance. Source geometry produced this map; the whole city was not inferred by ML.
2. **Bulk source package (30 seconds).** Show the source receipt and original ZIP. The complete dummy package is downloadable from `/reference/lake-view-complete.zip`; it includes GIS layers, imagery, LAS/LAZ, DEM/DSM, control CSVs, floor PDFs and schedules. Supported adapter profiles normalize supplied records; file receipt alone is not reconstruction. Shiv Vihar is a separate saved synthetic dataset using the supplied MASTER structure.
3. **Actual ML (one minute).** Choose **Prepare with ML**. In **Choose sources**, select the aerial JPEG or a floor-plan PDF/page and run extraction. Or select the existing retained result to avoid waiting. Toggle the overlay and select regions. Explain: “AI proposes pixels, and we retain the exact source, model and output. The officer can reject mistakes.” Lake View has actual floor-plan and building runs, including visible errors and omissions.
4. **Measurement and review (one minute).** Select the earlier aerial run with “review saved.” Its documented synthetic controls give one candidate an area of 369 m². Explicitly authored 0–3 m demo levels yield 1107 m³. Inspect the saved note/evidence and download the proposal. Explain that these levels were not inferred, and the proposal does not replace the map or establish ownership.
5. **Visual ML explanation (90 seconds).** Open **Present**. Start with **Public test sample**: **Building extraction** shows the real OAM image → RF-DETR roof pixels → 8 polygon candidates. **Room segmentation** shows the real CubiCasa floor plan → predicted room classes → 75 candidate regions (including wall fragments, not 75 rooms). Each mask is the exact retained output, recolored only for visibility. Use **Hide image** to isolate the extracted outlines. Explain: “The pretrained model predicts pixels. Our pipeline traces those pixels into reviewable geometry and retains the original evidence.” Colors identify classes; timing is recorded inference time, not a running animation. Then switch **Example** to **This dataset** for Lake View's actual runs; its synthetic input and errors are deliberately preserved. Return to review for calibration and source processing.

Direct live walkthrough of the reviewed example:
http://127.0.0.1:3000/studio/processing/22b196c2-b467-4f38-9252-5b4c5e3a2f14?view=explain&run=de6763fd-e6dc-4ec1-80bd-f471d9385d36

Presentation and architecture:
http://127.0.0.1:3000/explain

## What to say about the remaining work

“We have a working local path for source retention, normalized supplied geometry, map/record inspection, actual image/plan inference and reviewed measured proposals. Full point-cloud floor reconstruction, real-world survey/model qualification, comprehensive 3D ownership topology and the guarded handoff of these new proposals into canonical records remain engineering work. Official 3D ULPIN issuance is not claimed.”

Shiv Vihar's saved package currently contains structured JSON, not image/PDF evidence. Show its existing map; attach actual suitable image/PDF originals before claiming ML processing for it. Do not substitute another neighbourhood's images.

The visual presentation labels public test samples separately from current-dataset runs. Public imagery is never attached to Lake View or used to imply its city was reconstructed. The separate `/explain` route retains historical architecture/evaluation material.
