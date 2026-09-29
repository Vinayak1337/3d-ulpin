# BhuAayam: launch data and complete demo coverage

28 September 2026 · Review of the retained launch productions

## Direction for the next film

Combine the first film’s restrained composition with the broader journey retained in **BhuAayam Launch 2** and the newer desktop video. The full story has three parts:

1. **Understand a place:** heterogeneous inputs, mapping, progressive delivery, layers and spatial inspection.
2. **Prove a record:** documents, floors and units, cited facts, discrepancies and officer review.
3. **Use the result:** register, Property Card, verification, public request and status tracking.

Keep the citizen → officer → citizen loop. It explains why the spatial and evidence work matters. The next film should also show a source document opening and a meaningful review outcome; those deserve more attention than another city orbit.

The earlier playbook’s 105-second outline is a compact narrative spine. For the complete inventory below, start with a **roughly three-minute main film**, then adjust after the animatic. This is an editing estimate, not a fixed requirement. Do not lose requested capabilities to meet an arbitrary duration.

## What was reviewed

| Material | What it provides |
| --- | --- |
| [BhuAayam Launch](</Users/vinayak/Desktop/BhuAayam Launch/README.md>) | The 52-second 1080p/30 fps film, source, source manifest, render receipt, export contact sheet and selected review stills. The reference for visual restraint. |
| [Launch 2 main capture](</Users/vinayak/Desktop/BhuAayam Launch 2/capture/capture.json>) | 23 named steps, 2,045 timestamped frames, 77 action events and 29 SSE events. All final step flags are `ok: true`; no page errors are recorded. All 23 end-state stills were visually inspected in contact sheets. |
| [Launch 2 extra capture](</Users/vinayak/Desktop/BhuAayam Launch 2/capture-extra/capture.json>) | City hero, aerial and LiDAR shots: 629 frames across three successful steps. All three end-state stills inspected. The manifest has no final `finished` field, although the individual clips have end times. |
| [Launch 2 rehearsal](</Users/vinayak/Desktop/BhuAayam Launch 2/capture-rehearsal/capture.json>) | Earlier failed attempts. Preserve them as history; use the later main capture as the workflow reference. |
| [Desktop launch](</Users/vinayak/Desktop/BhuAayam-launch.mp4>) | Media metadata inspected: 3:16, 1080p/30 fps with stereo audio. |
| [Desktop launch v2](</Users/vinayak/Desktop/BhuAayam-launch-v2.mp4>) | Media metadata and 22 timestamped frames sampled across the 3:35.57 film. Adds an AI/ML explanation, adaptive intake and 3D findings to the coverage reference. |
| Dataset files and capture scripts | GeoJSON/CSV counts, PDF page counts and selected source pages checked; capture actions read to distinguish an opened menu from a completed operation. |

This was an asset and content review. It was not a new live-app test, normal-speed audiovisual review or verification of every claim in the films. A successful capture step means its scripted actions completed; it does not establish backend correctness or release readiness. No app, dataset, original or existing film was modified.

## The data available to show

### A. Official NYC spatial sources

The [NYC upload pack](</Users/vinayak/Desktop/3D Ulpin/apps/studio/datasets/nyc-10013>) contains eight files:

| Input | Useful film moment |
| --- | --- |
| `buildings-original.geojson` | Building footprints, source heights and building selection. |
| `roadbed.geojson` | Road context and progressive map assembly. |
| `sidewalk.geojson` | Separate pedestrian context rather than treating all open space alike. |
| `parks.geojson` | Park polygons and their spatial relationships to buildings. |
| `hydrography.geojson` | Water context and the boundary of the displayed place. |
| `nyc-10013-ortho-2018.tif` | Georeferenced imagery over the covered subset. |
| `nyc-10013-lidar-2017.laz` | Point-cloud source and the available display derivative. |
| `nyc-10013-dem-2017.tif` | Elevation input and its recorded limitations. |

The [source manifest](</Users/vinayak/Desktop/3D Ulpin/apps/studio/datasets/nyc-10013/source-info/manifest.json>) also retains coverage, originals and derivatives. The LiDAR extract lists 1,726,222 points; this is an input count, not evidence that the displayed overlay renders every raw point. The imagery and elevation sources have different dates and coverage. DEM vertical units/datum remain unqualified in this manifest, and the pack makes no verified drone-acquisition claim.

**Choose counts from the selected new build.** The original has 1,662 building features. The main demonstration capture reports 2,363 accepted vector features with one repaired for display; the backend source index records 1,661 admitted building proposals and one rejected geometry. These are different processing outcomes. Do not mix their counts, statuses or selected buildings in one supposedly continuous capture.

The saved aerial and LiDAR shots leave substantial opaque building massing over the overlays. Reframe the covered subset and use existing visibility controls where appropriate so the viewer can actually see what the layer adds. Keep the aerial date, LiDAR date and approximate-alignment qualification meaningful at playback size.

### B. Historical Lake View walkthrough

The [dataset README](</Users/vinayak/Desktop/ulpin-frontend/apps/studio/datasets/README.md>) explicitly identifies Lake View as a historical fixture, separate from the official NYC data. It supplies the richer workflow reference; it does not establish real ownership, official issuance or actual survey findings.

| Retained asset | Contents checked | What to show |
| --- | --- | --- |
| `1-area/lake_view_survey.geojson` | 54 polygons: 22 parcels, 22 buildings, four roads, four public-land features and two utilities. | Area intake, mapping questions, context and building selection. |
| `2-building/levels.csv` | Ten explicit rows with lower/upper levels and datum `SD-1`. | Reading a vertical schedule and preserving its reference. |
| `2-building/unit_inventory.csv` | 48 rows with unit, level, carpet area in square feet and use. | Structured unit intake and the resulting register. |
| `2-building/plan_F7.pdf` | Three pages; page 3 shows the unit layout and 69.30 m² carpet area for the detailed unit. | Open the exact source page and connect its geometry/area to the selected flat. |
| `2-building/sale_deed_704.pdf` | Two pages; clause 2 on page 2 declares 72.00 m² and a 1.84% undivided share. | Show a source disagreement without replacing either value. |
| `2-building/deed_of_declaration.pdf` | Four pages; Schedule B on page 4 lists shares and displays a 99.51% total. | Shared interests and an unresolved consistency issue. |

The capture’s before/after facts show the selected building’s register growing from **0 to 88 records**, with **12 level records** afterwards. The UI shows **48 units**. These numbers describe different entities. The ten explicit CSV rows must not be narrated as twelve surveyed levels; additional or estimated levels need their actual source/status.

**Recommended evidence sequence:** choose F7 → Flat 704 → open the plan’s 69.30 m² → open the deed’s 72.00 m² → show the discrepancy → show what the officer can review or record → retain the source references in the result. This is a stronger explanation than a floating “Evidence” label.

These exact Lake View values are inventory facts about the retained fixture. A new real-data demonstration must obtain its values from its chosen records, not copy them as sample content.

### C. Register, holders and residents

The saved workflow includes register tabs and holder/resident information. A separate six-page `Building 756019 · Register extract.pdf` also sits in the building-data folder; it is not one of the five documents submitted by the Launch 2 capture script.

The frontend’s [sample registry generator](</Users/vinayak/Desktop/ulpin-frontend/scripts/demo-import/sample-registry.mjs>) generates people, deed references and layouts deterministically for the presentation build. Its register-like labels and digest-shaped values do not make it an official acquired register. Treat these screens as retained demonstration behavior when scoping a new film, and trace any replacement residents/rights data to its own sources.

The record relationships worth explaining are **building → level → unit → evidence → shares/rights → occupants**, with public visibility governed separately. A whole desktop table of names is less useful than one clear relationship and an understandable result.

## Complete coverage map

“Captured” below refers to retained demonstration pixels. “Explain” refers to motion graphics that need their own accurate wording. “Add” identifies footage needed to make the product outcome clear.

| Capability | Existing reference | Direction for the new film |
| --- | --- | --- |
| Mixed-source intake and profiling | `nyc-upload`; v2 around 00:33 | **Captured.** Show formats, contents and reference-system handling at a readable crop. |
| Adaptive field mapping | v2 around 00:43–01:13 and 01:53 | **Explain + capture.** Pair a compact mapping diagram with an actual proposal/confirmation state. |
| AI-to-ML learning and handoff | v2 around 01:03–01:13 | **Explain conditionally.** Preserve the idea, but validate its current implementation status before presenting it as running behavior. |
| Progressive map delivery | `nyc-stream`, `lake-upload`; v2 around 01:23 and 02:03 | **Captured.** Show a useful intermediate result and completion. Editing speed is not a processing benchmark. |
| City, heights, imagery and LiDAR | `nyc-city`, `nyc-height`, `nyc-tools`, extra `aerial` and `lidar` | **Captured.** Make each layer’s contribution visible; trim repeated orbits. |
| Search, selection and source overview | `building-before`; v2 around 01:33 | **Captured.** Keep the selected object recognisable across map and inspector. |
| Citizen request with attachments | `portal-search`, `public-request` | **Captured.** Show the missing register, the request and its receipt. |
| Officer handling | `officer-review` | **Captured.** Show take-up, decision and the next useful action. |
| Documents becoming a floor/unit register | `officer-documents`, `floor-stream`, `floors` | **Captured.** Show recognised document roles and the before/after state. |
| Exact unit inspection | `unit`; v2 around 02:33 | **Captured.** Choose one unit to carry the evidence and result story. |
| Source document inspection | Source PDFs exist; no dedicated open-document step in the main 23-step capture | **Add.** Capture the plan/deed viewer, correct page/locator and return to the same unit. |
| Deviations and 3D findings | `deviation`; v2 around 02:23 and 02:53 | **Captured in part.** Show the basis and meaning; add a review/action outcome if the film promises resolution. |
| Register, shares and residents | `register`; v2 around 01:43 | **Captured in part.** Show the relevant relationship. Export menu opening is not a completed file export. |
| Reviewed details, code and card | `property-card` | **Captured.** Show the actual review/assignment result; retain “proposed” and technical-record qualifications. |
| Verification and revision history | `verify` | **Captured.** Show the code’s record/revision result. The retained link is same-device; do not imply a deployed public verifier. |
| Underground screening | `underground`; v2 around 03:03 | **Captured.** Keep the visible “Unknown — no utility survey” result; do not frame it as surveyed clearance. |
| Public result and request tracking | `portal-updated`, `track` | **Captured.** Close the citizen loop and preserve released-only visibility. |
| Exported artifact | Menu in `register`; separate retained PDF | **Add if included.** Perform a new export, open the resulting file and link it to the exact source record/revision. |

## Three issues to resolve before filming

1. **Data and version continuity.** Choose the new dataset/build and follow the same subject. The older cut, main capture and desktop v2 use different buildings or flats. Do not splice them into an apparent single transaction. Preserve the official NYC versus historical fixture distinction.
2. **Evidence and decisions.** Add the actual document-viewer moment and one meaningful reviewed outcome. Existing source files and attractive status badges alone do not complete that story. The retained footage includes open findings and unknowns; do not imply they all become resolved.
3. **Explanatory claims.** V2’s AI/ML panels include training curves, counters and a promoted model. Those animations are not runtime receipts. The current [migration ledger](../orchestration/NESTJS_MIGRATION.md) records the learning candidate as offline, without production promotion. Keep any architecture explanation tied to current evidence and label proposed behavior where applicable. Likewise, standards badges and “any format” copy do not prove universal interoperability or input support.

The main capture is enough to plan the story. These gaps call for a small set of targeted captures, not a new exhaustive test campaign or changes to the frontend by this review task.

## Suggested complete-film timing

| Time | Story beat |
| --- | --- |
| 0–6 s | Spatial hook and BhuAayam proposition. |
| 6–18 s | The actual source families and what the officer needs to understand. |
| 18–34 s | Profiling/mapping; a concise, accurately framed architecture explanation if included. |
| 34–47 s | Progressive delivery into a usable scene. |
| 47–61 s | Spatial layers, search and one selected building. |
| 61–77 s | Citizen request → officer take-up and acceptance. |
| 77–91 s | Document import → floors and units appear. |
| 91–104 s | Explore the level and select the story’s unit. |
| 104–124 s | Open source evidence, expose a discrepancy and show review. |
| 124–139 s | Spatial findings/deviation and the underground screening limit. |
| 139–154 s | Register, relevant shares/occupancy and export if it belongs in scope. |
| 154–166 s | Property Card → verification/revision result. |
| 166–175 s | Updated public view and tracked request outcome. |
| 175–180 s | Brand close and accurate next action. |

This is a first editing budget. The short final sequences may need more time once real captures and audio are assembled. Extend them rather than hide outcomes behind rapid cuts. Use the first film’s clarity throughout: a few large ideas, legible UI crops, restrained accents and three memorable product reveals.

## Review references

- [Production playbook](LAUNCH_VIDEO_PLAYBOOK.md).
- Main capture manifest SHA-256: `fb956be01f569c783c3b233ab113dcdd91a484fad235fd808d5cacd95ca868ed`.
- Extra capture manifest SHA-256: `73beac86cccc167eff8452b9a8184407a0bd118b594e397a4116a5c272327311`.
- [F7 plan](</Users/vinayak/Desktop/ulpin-frontend/apps/studio/datasets/2-building/plan_F7.pdf>), [sale deed](</Users/vinayak/Desktop/ulpin-frontend/apps/studio/datasets/2-building/sale_deed_704.pdf>) and [declaration](</Users/vinayak/Desktop/ulpin-frontend/apps/studio/datasets/2-building/deed_of_declaration.pdf>): selected relevant pages rendered and visually inspected.
- [Current source index](../api/real-sources.md) and [status vocabulary](../usp-agent-handoffs/99-ui-ux-and-integration.md).

Folder names do not establish authorship; this review does not attribute either source project to a particular assistant.
