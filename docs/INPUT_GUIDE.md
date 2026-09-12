# Understanding and trying the inputs

The MVP turns explicit local footprints and elevations into editable property-space prisms. All supplied C-001/C-002 files are **synthetic teaching inputs**. They do not establish surveyed dimensions, ownership or an official identity.

## What each file contributes

| Input profile | Contribution | What still needs an operator |
| --- | --- | --- |
| `parcel-local-json-v1` | Named metric frame; parcel/building context; unit, common-space and basement footprints. | Select it in **Prepare draft spaces**. Optional `draftLower`/`draftUpper` are unverified hints. |
| `levels-csv-v1` | Lower/upper elevations, benchmark, measurement method and row locators, joined to footprints by exact alias. | Resolve missing components; explicitly apply revised evidence. |
| `control-csv-v1` | Known horizontal coordinates used to align a plan. | Click corresponding image points in the same order. |
| `plan-png-v1` / `plan-pdf-v1` | Original plan reference; inspection reports image dimensions or PDF pages. | Select a page, calibrate, and trace a new outline manually. |

Uploads preserve original bytes, hashes and source revisions. **Received**, **inspected**, **prepared** and **computed** are different states. A plan marked `needs_input` can be perfectly valid: it still needs calibration. An incomplete level schedule can also be used while missing components remain explicitly unverified.

This minimal spatial file is valid and uses the same U01/U03 coordinates as C-001:

```json
{
  "profile": "parcel-local-json-v1",
  "frame": {"id":"LOCAL-C001","horizontalUnit":"m","verticalUnit":"m","benchmark":"BM-DEMO-A"},
  "features": [
    {"alias":"U01","name":"Ground west apartment","kind":"unit","levelLabel":"Ground","footprint":[[2,2],[6,2],[6,10],[2,10]]},
    {"alias":"U03","name":"Upper west apartment","kind":"unit","levelLabel":"Level 1","footprint":[[2,2],[6,2],[6,10],[2,10]],"draftLower":2.8}
  ]
}
```

Its initial level schedule can be:

```csv
alias,lower,upper,unit,benchmark,method
U01,0,3,m,BM-DEMO-A,synthetic teaching measurement
U03,,6,m,BM-DEMO-A,synthetic teaching measurement
```

The blank U03 lower cell means **no supporting measurement**. Its separate JSON hint of 2.8 m permits a draft prism, but never supplies evidence. In the full fixture, U04 also has a blank lower cell; its 3.0 m hint is numerically correct and still unverified. Typing 3.0 m manually into U03 can remove the geometric overlap while leaving the evidence warning. Applying the inspected r2 schedule supplies support for both:

```csv
alias,lower,upper,unit,benchmark,method
U03,3,6,m,BM-DEMO-A,synthetic teaching measurement
U04,3,6,m,BM-DEMO-A,synthetic teaching measurement
```

The real C-001 control file is:

```csv
id,x,y,unit,benchmark
CP-A,2,2,m,BM-DEMO-A
CP-B,12,10,m,BM-DEMO-A
```

## Walk through the complete story

1. Load C-001 demo inputs, or import its actual files. Initial loading deliberately excludes `levels-r2.csv` and creates no model.
2. Inspect the sources. Select `spatial.json`, `levels-r1.csv` and optionally `controls.csv` in **Prepare draft spaces**. Review seven candidate spaces and the unverified lower limits.
3. Choose **Build model**. The Python worker computes quantities and findings; open the U01/U03 overlap to inspect the actual intersecting region and source bindings.
4. Upload the actual `levels-r2.csv`, preferably as the next revision of the level-source family. Wait for inspection, then explicitly apply this level evidence. Uploading alone does not change units.
5. Rebuild. U03's lower limit becomes 3.0 m; its positive overlap disappears. U04 has new evidence despite unchanged dimensions, so its checks also need this fresh build. Reopen the case to inspect the persisted result and history.

Re-preparing imports the selected source footprints again and can replace current draft edits. Use **Apply level evidence** for the correction step, not another preparation from r1.

| Independent check | C-001 | C-002 |
| --- | --- | --- |
| Spaces | 7 | 5 |
| Main footprint | Apartment: `4 × 8 = 32 m²` | L-shape: `8 × 8 − 4 × 4 = 48 m²` |
| Lower / draft upper volume | U01 **96**, U03 **102.4 m³** | ELBOW-A **120**, ELBOW-B **134.4 m³** |
| Initial overlap | `32 × (3 − 2.8) = 6.4 m³` | `48 × (2.5 − 2.2) = 14.4 m³` |
| Corrected positive overlap | **0 m³** | **0 m³** after lower 2.5 m |
| Other checks | Basement **240 m³** | Triangle **12 m² / 30 m³**; circulation **32 m² / 80 m³**; basement **300 m³** |

These values check the JSON/CSV model. Hand tracing raster pixels produces approximate coordinates and need not reproduce the exact JSON areas.

## Calibrate and trace a plan

Open the PNG or PDF source and choose **Calibrate & trace**. For PDFs, select **page 1** first. Click the first red control marker, then the second; enter their world X/Y values in metres and choose **Use calibration**. Click each outline corner in order, give the new space a unique alias, enter lower/upper limits, and save. This adds a space; tracing on top of an existing space can correctly produce another overlap.

| Case / marker order | World metres | PNG / PDF.js viewport at scale 1 | Current PDF canvas at scale 1.5 |
| --- | --- | --- | --- |
| C-001 A: CP-A | `(2, 2)` | `(218, 682)` | `(327, 1023)` |
| C-001 B: CP-B | `(12, 10)` | `(611, 368)` | `(916.5, 552)` |
| C-002 A: CTRL-X | `(0, 0)` | `(203, 697)` | `(304.5, 1045.5)` |
| C-002 B: CTRL-Y | `(12, 10)` | `(616, 353)` | `(924, 529.5)` |

Both originals are 1400 × 900; the browser currently renders PDF pages at 2100 × 1350. Coordinates above describe the source/canvas, not positions on your laptop screen. Click the visible markers rather than entering pixel numbers. Image Y increases downward; the calibration accounts for this when converting to local world coordinates. C-002 uses `LOCAL-C002` / `BM-DEMO-B`, so do not reuse C-001's benchmark.

## Limits to keep in mind

Use metres, finite values, exact matching aliases, simple outlines without holes and constant lower/upper elevations. Choose the actual file profile; ordinary geographic GeoJSON and latitude/longitude inputs are unsupported. Each upload is limited to 16 MiB. There is no automatic scanned-plan extraction, perspective correction, terrain, sloped-solid modelling, authentication workflow or formal acceptance/official identity issuance. Building/parcel containment is context; boundary contact is not positive overlap. No AI key is needed for this deterministic demo.
