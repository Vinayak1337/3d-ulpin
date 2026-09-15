# Complete Lake View demonstration

Lake View remains the first and only active fictional demo. Its original eight buildings, eight parcels, plans, 12 detailed floors and 60 spaces are preserved. An articulated service kiosk and a fictional road widening corridor extend that same block. The real Bronx dataset remains separate and intact.

Parcel selection shows the original recorded area, a source-backed **2D ULPIN · Demo** identifier, and confirmed associated buildings. The same parcel ID appears in the building inspector, register and direct PDF download. Parcel boundaries remain visible above decorative ground meshes; their display lift does not change analytical geometry. Labels can be toggled. Unknown land use, zoning and ownership are not invented.

`Show conflicts` highlights all current geometric findings in red. There are five building/road footprint pairs: one 12 m² building overlap and road overlaps of 36, 40, 40 and 72 m². The check also reports two related public-context findings for the kiosk. These describe the same 36 m² intersection at different semantic levels; do not sum them as separate unique encroachments. A missing parcel association for the kiosk remains an honest coverage condition. Stale checks cannot supply active highlights.

The State / District / Area control is a clearly marked, disabled filter preview, as requested. Saved-block text search remains functional.

## Start and import

Use the existing local platform, database and object storage. Do not remove volumes.

```sh
pnpm install --frozen-lockfile
pnpm platform:start
pnpm db:migrate
pnpm --filter @ulpin/web exec playwright install chromium
pnpm build
pnpm start
```

In a second terminal:

```sh
pnpm demo:seed
pnpm demo:complete
```

Open `http://127.0.0.1:3000/blocks`, choose **Lake View · demonstration**, then **12 Lake View Road**. Use **Parcels → Parcel A** for the parcel inspector, **Show conflicts** for both building and road overlaps, **Download property PDF** for the report, and **Open register / Open workspace** for the same property's spaces and original plans.

On this installation the block is `/blocks/0ded05d3-b596-46a8-9918-ab1bc0a433be`. A fresh installation obtains its own canonical IDs; `fixtures/reference-neighborhood/installed.json` records them locally.

`demo:complete` imports authored ArcGIS spatial layers using the existing ingestion, review and commit services. It imports the site/identity PDF into the kiosk's preparation packet and binds the eight fictional parcel IDs to that retained source. It runs the real overlap checks. A committed import is preserved on rerun, as are edited geometry, existing preparations and history. Original asset bindings are hash checked and never attached automatically to an edited geometry revision.

## Inputs

[Complete authored input bundle](../fixtures/lake-view-complete-inputs.zip) contains the base plans/schedules, extension, identity PDF and display assets. It excludes installed database IDs and computed results. This mixed input ZIP is **not** a shapefile upload; use the seed commands above to import each source with the correct mapping. The identity CSV is not a native level schedule.

To regenerate the extension, use Python with `scripts/reference/requirements.txt`, then:

```sh
python scripts/reference/complete-data.py
python scripts/reference/bundle.py
```

Generation never writes to application storage. Existing imported originals stay immutable.

## Duplicate demo cleanup

The two user-selected areas are hidden from active block/register/workspace directories, search and recent navigation:

- `e4eea7b8-f1f0-4ea0-bd82-29e0c2a740a3` — V2 redesign verification · synthetic.
- `8c61a45e-3ae9-4c7c-95f2-78918f23582a` — Synthetic officer UI test · not a real survey.

The cleanup verifies their exact names and synthetic status. It uses `map_areas.archived_at` and `archive_reason`, keeping originals, property histories and direct historical URLs. An operator can restore an area by clearing those two fields for its exact ID; no reimport is required. Other datasets and empty user areas are untouched.

## Verification

```sh
pnpm typecheck
pnpm build
pnpm test:ui
pnpm exec tsx scripts/reference/complete-verify.ts
cp docs/evidence/complete-demo/data-report.json /tmp/lake-view-before.json
pnpm demo:complete
COMPLETE_COMPARE=/tmp/lake-view-before.json pnpm exec tsx scripts/reference/complete-verify.ts
pnpm exec tsx scripts/reference/complete-browser.ts
REFERENCE_SNAPSHOT_PATH=docs/evidence/complete-demo/reference-persistence.json pnpm test:reference
```

Evidence is in [complete-demo](evidence/complete-demo/): actual browser captures at 1440×900 and 1920×1080, a 390 px directory check, PDF files downloaded from the actual API and UI, recorded test results, and the base-source persistence check. PDF pages were rendered and visually inspected. The seed comparison checks complete stored source, property, geometry, investigation, asset and identity payloads, not only feature counts. Web process restarts retained the imported data.

PDF rendering uses a local Chromium process with network access and JavaScript disabled, a bounded timeout, and at most two simultaneous exports. `ULPIN_PDF_CHROMIUM_PATH` can point to another installed Chromium executable. If unavailable, the API returns a clear 503 and the register still provides the browser's Print / save PDF option.

## Remaining limits

This is explicitly fictional demonstration data. It does not satisfy the separate acceptance gate for real Indian parcels, officially issued ULPINs, surveyed interiors or utility evidence. Live assisted extraction still requires the configured credentials. No invented ownership, zoning, photographic evidence or AI answers are supplied. The location filters are intentionally only a preview. No public deployment or merge was performed.
