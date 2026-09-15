# Lake View: complete fictional training block

This extension belongs to the existing Lake View neighborhood. Nothing here is a real survey, government-issued ULPIN, ownership assertion or legal encroachment decision.

The full input bundle combines the original eight articulated buildings, eight parcels, matching floor plans and schedules with a fictional widening corridor, service kiosk and parcel identity schedule. Three properties have 12 floors and 60 recorded spaces in total. A fourth retains deliberately incomplete level evidence and original plan revisions. The kiosk intentionally overlaps building B and the road corridor. The application calculates all measurements and findings after ingestion.

- `spec.json`: authored extension, projected metre coordinates and fictional parcel IDs.
- `R3.arcgis.json`: road land polygon, not an inferred centreline buffer.
- `K1.arcgis.json`: kiosk footprint and authored 3.2 m height.
- `site-and-identity-schedule.pdf`: retained original for the parcel IDs and site layout.
- `parcel-identifiers.csv`: portable identity schedule; not a native level CSV.
- `../reference-neighborhood/`: original plans, PNGs, native level/space schedules and base specification.

Import through the repository services, with the app and dispatcher running:

```sh
pnpm demo:seed       # installs or preserves the base Lake View
pnpm demo:complete   # imports extension, records IDs, checks geometry, archives two known duplicate demos
```

Do not upload the identity CSV as a level schedule. The native level CSV schema is intentionally different. The complete ZIP is an input bundle, not a shapefile upload; the commands above import its mixed inputs with their correct mappings.

Seed reruns retain committed imports, originals, property revisions and history. Edited assets are never silently rebound. Only the two explicitly identified obsolete synthetic areas are hidden from active directories, search and recents. Their historical URLs and underlying evidence remain recoverable. No real dataset is removed.

To regenerate the extension's authored files:

```sh
python scripts/reference/complete-data.py
```

Use the Python environment described in `docs/COMPLETE_DEMO.md` (ReportLab and pypdfium2). Regeneration is separate from importing; existing original bytes in object storage are immutable.
