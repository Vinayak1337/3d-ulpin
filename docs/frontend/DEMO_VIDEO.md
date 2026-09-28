# Finale demo video — runbook

Branch `frontend/studio`, worktree `/Users/vinayak/Desktop/ulpin-frontend`. Everything below runs in one Studio session.

## Start

```
pnpm studio:demo            # Studio on 127.0.0.1:5188 with the city upload server and the local data layer
```

Optional: the Nest API on 3188 (health and capabilities only; the demo does not need it).

Before recording, open `http://127.0.0.1:5188/studio/work?reset-session` once. It clears imports, codes, cards and requests. Record at 1920 × 1080.

## Files to upload

| Step | Files |
| --- | --- |
| Lake View area | `apps/studio/datasets/1-area/lake_view_survey.geojson` |
| Lake View Residence floors | `apps/studio/datasets/2-building/` (all five) |
| City | `~/.codex/task-data/nyc-zcta-10013-context/nyc-10013-official-context.zip` |

## Shot list (about 6 minutes)

| Time | Beat | Where | What to do |
| --- | --- | --- | --- |
| 0:00 | 1 Problem | Slide | Records that disagree: deed, plan and survey |
| 0:30 | 2 Upload | Add files | Drop the Lake View survey; we propose a mapping; Start import; the map fills (roads, parcels, buildings) |
| 1:10 | 3 Floors | Lake View Residence → Add files | Drop the five building files; levels stack G + 3 → G + 8 |
| 1:40 | 3 Deviation | Open register → Deviation check | Sanctioned G + 8 against drone survey: +1 storey, 118 m²; Create finding |
| 2:20 | 4 Units | Explore floors → F8 → Flat 801 | Level, carpet area, share with source chips; Record reviewed details; Assign code |
| 3:00 | 5 Checks | Map → findings mode | 16.3 m³ overlap Flat 101 / Flat 201 shown in 3D with the calculation; Apply level evidence |
| 3:40 | 6 Underground | Underground mode | Water main and metro corridor; draw a trench; screening is not a dig permission |
| 4:20 | 7 Card | Property Card | QR → verification page with the same revision and hash chain |
| 4:50 | 8 City | Add files → NYC ZIP | 2,363 features stream in; zoom out over the city; pick any building → floors, flats, residents |
| 5:30 | Register | Register → Residents; Export | Holders and residents per floor; Building register (PDF); Register data package (ZIP: consolidated registry JSON, CSV tables, Excel, CityJSON, manifest with SHA-256) |
| 5:45 | Portal | `/portal` | Search by 3D ULPIN or parcel ULPIN; request floor data or a change of holder; officer sees it under Register |

Use Flat 801 or Flat 704 for the card: their carpet area and share are on record (Flat 702's are Unknown).

## Data on screen

- Lake View, and the floors, flats, shares and residents of the NYC buildings, are sample registry data served through the local API routes. The NYC footprints, heights, roads, parks and water are the official NYC open data files.
- Enhanced view (facades, windows, trees, textures) is illustrative styling from the renderer.
- Say this in the narration or the closing slide. Don't present sample people or deeds as real records.

## AI in the video

The app does not call a model in this build. Show AI as a narrated motion-graphic segment, labelled as the pipeline being built:

- Messy files in, and an agent proposes the mapping ("this column is height in feet"). The officer confirms; deterministic code converts.
- Plan pages become room candidates, which are reviewed on the plan (S9 review screen).
- Photos or drone points become a height or storey estimate, feeding the deviation check.

Keep what is shown running separate from what is planned; the closing slide uses *implemented / planned*.
