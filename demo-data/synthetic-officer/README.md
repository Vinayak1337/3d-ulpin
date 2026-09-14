# Synthetic officer workflow fixtures

These authored files are **software fixtures, not a survey, title record, permission, or observed utility**. Do not present them as an Indian pilot or source evidence about a real property.

The ArcGIS JSON files use EPSG:32643 around easting 500000/northing 3100000 solely to exercise conversion. The plan CSV polygons use the retained local test area frame, `AREA-8c61a45e-3ae9-4c7c-95f2-78918f23582a`. On a newly created area, replace that frame with its actual declared metre frame before importing plans. Never rename an existing frame to imply calibration.

- Buildings: three synthetic exteriors; no interior floors inferred from heights.
- A plan + levels: one 6 × 6 m room with 0–3 m limits. Revised levels change upper to 4 m as a separate document; the prior source remains.
- B missing-upper plan + upper reference: independent 4 × 4 m room, explicit missing-value workflow then 0–3 m limits.
- Parcel: 100 m² boundary under A's 120 m² footprint, intentionally producing 20 m² outside area after an evidenced association is reviewed.
- Utility: 24 m alignment with authored centre levels −1.2 to −2 m and 0.8 m circular diameter; supports positioned display, not implemented exact circular/sloping volume checks.

Named benchmarks are synthetic. Reproduce through Import GIS and the selected property's Prepare panel. Native CSV sources require `alias,lower,upper,unit,benchmark`; blank lower/upper values remain missing, optional label/level/footprint_wkt/frame describe the measured-source schema.

Full actual UI sequence and stable fixture identifiers: [Officer UI verification](../../docs/OFFICER_UI_VERIFICATION.md).
