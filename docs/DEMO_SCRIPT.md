# Five-minute C-001 demonstration

Purpose: explain how separate source files become an inspectable property-space
model, why unsupported measurements stay visible, and how new evidence resolves
a computed conflict. Every sample is generated teaching data; this is a local
draft workbench, not an official registry.

## Before presenting

Start **Start Demo.command** or run `pnpm demo`, keep the terminal open, and open
[http://127.0.0.1:3000](http://127.0.0.1:3000). Check that
[application health](http://127.0.0.1:3000/api/v1/health) reports `ok:true` and all
five service checks are true. Use a comfortably wide browser window so the
source tree, viewer and inspector are visible together.

Use a fresh workspace for the story. Existing workspaces, including previous
rehearsals and labelled Regression cases, remain available in the selector.
Set floor separation back to zero when explaining physical intersections.

## Click-through and narration

| Time | Do this | Explain or verify |
| --- | --- | --- |
| 0:00–0:30 | Click the **+** next to the workspace selector. Enter **C-001 walkthrough** in **Workspace name**, then **Create workspace**. Choose **C-001 · Reference building** and **Load sample inputs**. | “We start from real uploaded files, with no prebuilt model.” Loading imports spatial JSON, initial level CSV, controls, PNG and PDF through the normal storage/inspection pipeline. |
| 0:30–1:05 | Open **Sources** and select `levels-r1.csv`. Wait until inspection finishes. Show the missing lower limits for U03 and U04. | “A received file can be incomplete evidence. A draft value can support exploration without becoming a verified measurement.” `needs input` is expected for the incomplete levels and uncalibrated plan references. |
| 1:05–1:35 | Click **Prepare geometry**. Confirm **Footprint source = spatial.json · r1**, **Level evidence = levels-r1.csv · r1**, and **Control reference = controls.csv · r1**. Click **Prepare draft spaces**. | Seven editable draft spaces appear. Preparation joins footprints and levels but has not yet computed a model. U03's lower hint is **2.8 m**, explicitly unverified. |
| 1:35–2:15 | Click **Build model**, wait for processing, select **3D model** or **Split**, and set **Visible floor** to **All floors**. Select U03 in **Spaces**. | The worker computes the stored model. U01 is **32 m² / 96 m³**; U03 is **102.4 m³**; the basement is **240 m³**. Select a unit to inspect its dimensions and linked source revisions. |
| 2:15–3:00 | Open **Checks**, select the U01/U03 volumetric-overlap finding, and inspect the highlighted region and contributing sources. | “This is the actual intersecting volume: **32 m² × (3.0 − 2.8) m = 6.4 m³**.” The highlighted band is between **2.8 and 3.0 m**. Camera and floor separation do not change these stored quantities. |
| 3:00–3:40 | Open **Sources**, click **Load revised demo levels**, and wait for `levels-r2.csv · r2` inspection. Select it and inspect the U03/U04 rows. Click **Apply this level evidence**. | “Uploading r2 alone did not change the model. This explicit action binds its measured **3.0 m** lower limits.” U04 also receives a new evidence revision even though its numerical lower limit was already 3.0 m. |
| 3:40–4:20 | Click **Rebuild model** and wait. Open **Checks** again. | The summary becomes **No positive-volume overlaps** for the current revision: **0 m³** positive overlap. Boundary-contact information can remain; touching floors are distinct from intersecting interiors. U03 volume becomes **96 m³**. |
| 4:20–5:00 | Open **History**, inspect the sequence, refresh the browser, and reselect the same workspace if needed. | The corrected model, source revisions and edits persist. “We can explain which measurements produced the result, change them deliberately, and compute again.” |

The left navigation label is **Checks**; individual results are findings inside
that pane. If the inspector is hidden, use **Show inspector** in the viewer
toolbar. The currently selected workspace is also encoded in the `?case=` URL.

## Explore after the main story

- Switch between **Building** and **Property volumes**. The façade and landscaping
  are illustrative; the stored footprints, elevations and quantities stay the same.
  Use **Reveal basement** for a cutaway of the site and **Focus model** for a larger
  viewport. Selecting an overlap finding automatically opens the measured volumes.
- Select a space, change **Lower** or **Upper**, and click **Save limits**. A
  changed manual measurement becomes unverified; **Rebuild model** computes its
  effect. For the evidence-backed correction above, apply r2 instead of typing
  the same number manually.
- Use **Plan** to edit an outline, or open a PNG/PDF source and choose
  **Open reference & trace**, then **Calibrate & trace**. Calibration and tracing
  instructions are in [INPUT_GUIDE.md](INPUT_GUIDE.md). A trace adds another
  space; it can overlap an existing one.
- Start another workspace and choose **C-002 · Alternate footprint**. Its
  differently shaped inputs produce **14.4 m³ → 0 m³** after revised evidence
  and rebuilding, providing an independent second example.

## Recover without losing work

| Situation | Action |
| --- | --- |
| Files show `processing` or a build is pending | Wait for the queue to finish; the workbench polls it. If it stalls, inspect application health and the running web/dispatcher terminal. |
| A job fails | Read **Processing needs attention** in the inspector. Fix the reported input or service, then **Retry**; create a fresh build if candidate inputs changed. |
| “Draft changed” / previous-revision results | Click **Rebuild model**. The older model remains visible until fresh processing succeeds. |
| Expected 6.4 m³ is missing | Confirm this is a fresh C-001 workspace prepared with `levels-r1.csv`, with U03 lower **2.8 m**. Create another workspace for a clean rehearsal. |
| The overlap remains after r2 upload | Select the inspected r2 source, **Apply this level evidence**, then **Rebuild model**. Receipt alone is intentionally insufficient. |
| You need to restart | Stop the web terminal, run `pnpm platform:stop`, then `pnpm demo`. Existing volumes and `.env` must remain. |

**Prepare again** reimports selected footprints and levels and can replace draft
edits. Do not use it for the r2 correction above. Preserve earlier rehearsal
cases instead of deleting shared database or object-storage volumes.
