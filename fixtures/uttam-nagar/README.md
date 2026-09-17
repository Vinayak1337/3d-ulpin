# Delhi / Uttam Nagar bounded study

Two distinct local areas are installed through the existing HTTP ingestion, mapping, review, commit, preparation and registry services. No computed finding is injected into a database. Existing Lake View and Bronx data are preserved.

## Open

http://127.0.0.1:3000/delhi is the city-to-block study page, with the retained Delhi NCT boundary and input downloads.

The reference is 113 observed OSM building outlines and 35 road centrelines. Heights and interiors remain unknown. The synthetic copy adds invented heights, assumed road widths, three fake parcels, an invented test corridor and kiosk, and 36 spaces on nine floors across three buildings. Twenty-seven fictional occupant labels and nine common-use groups are source-bound shared-use records, not ownership claims or actual household data.

## Reproduce in another initialized local environment

Build the current code and start the platform/web app first. It must include the reference-document rights validation and synthetic-neighbour isolation changes. Then, from the repository root:

```powershell
node scripts/uttam-nagar/import-osm-reference.mjs
node scripts/uttam-nagar/import-fictional-rooms.mjs layers
node scripts/uttam-nagar/import-fictional-rooms.mjs interiors
```

Optional environment variables: ULPIN_TEST_BASE_URL selects the running app (default http://127.0.0.1:3000); UTTAM_DATA_DIR selects this data directory. Runtime checkpoints and locally generated schedules are under .runtime/uttam-nagar-study and must not be committed. The scripts preserve committed packages and completed details on a checkpointed rerun. They refuse an identically named unmanaged area rather than overwrite or silently duplicate it. Each check creates append-only check history.

The room plan source uses EPSG:32643 coordinates. The installer converts those to the newly installed area's explicit local frame and prepares the geometry through the real worker. The source CSVs in scenario/ record this installation's derived schedules; the installer generates fresh frame-bound schedules for a new installation. Stored originals are never rewritten.

## Input and result distinctions

prepared/ contains the unchanged selected OSM shapes. sources/ retains the bounded raw response, query, Nominatim records and download receipts. scenario/ contains openly labelled authored test inputs. Delhi-wide coverage is the boundary only, not all buildings of Delhi. Source and licensing details and official-registration research are in SOURCE_NOTES.md.

Do not display synthetic heights, parcel outlines, residents, road widths or invented overlap findings as real land information. Re-run the reference check after scenario installation to verify it remains isolated. Geographic proximity alone must not join a fictional copy into observed reference checks.
