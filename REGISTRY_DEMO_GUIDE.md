# 3D property registry — hackathon demo guide

This is the current presentation guide. The Word guide in this folder covers the preserved legacy workbench.

## Start and load

1. Run `pnpm demo` from the project root, or double-click **Start Demo.command** on the configured Mac. Keep the terminal open.
2. Open [the registry](http://127.0.0.1:3000/). On a fresh database, choose **Load synthetic neighbourhood** and allow inspection and building to finish. The first load can take about a minute.
3. **Nandan block** contains two adjoining buildings, four separate floor records, fourteen spatial units and two parcels. Both buildings display together in the plan and Cesium property-volume view.

The launcher requires Bash: use WSL on Windows. The browser application and its container services are not inherently WSL-only, but a native Windows launcher has not been tested. Initial dependency/image installation needs internet; the prepared demonstration uses local assets and services.

Everything in this site is synthetic: coordinates, plans, measurements, parties and rights. The frame is **LOCAL-NANDAN-DEMO**, the benchmark is **BM-NANDAN-SYNTHETIC**, and all dimensions are metres. The scene has no asserted geographic location.

## Story 1 — find a space and review a correction

1. Click **Find records**, then search **Household A-201**. Select **A-201**. Its footprint is **40 m²**, limits **3–6 m**, and volume **120 m³**.
2. Show the permanent identifier in its record. **Copy link** opens the same record after restarting or correcting it. The site namespace does not grow with its children; A-201 has the suffix **S004** in the seeded site.
3. Open **rights.pdf** under Recorded rights. It names the fictional household and claim. Open **spatial.json** and **levels.csv** under Boundary evidence to show the actual stored originals and their revisions. **Download** exports the record, history, frame, relationships, rights and source hashes.
4. Click **Propose correction**. In Drafts, change the lower elevation from **3** to **2.8**, then **Save draft** and **Build and check**.
5. Select the overlap finding. The affected footprint is **4 × 10 = 40 m²**, and the vertical intersection is **0.2 m**: **40 × 0.2 = 8 m³**. Recording is blocked. The current registry record still has its previous geometry and rights.
6. Restore the draft lower elevation to **3**, save and build/check again. Review the before/after values, neighbours and source evidence. Manually edited bounds remain explicitly unverified until supported again; the warning requires a written acknowledgement.
7. Enter an acknowledgement such as “Synthetic demo correction checked against levels.csv; manual elevation status acknowledged.” Choose **Record in demo registry**. The ID stays the same and a new revision appears in history.

This records a technical demonstration review. It does not issue an official ULPIN, confer ownership or make a legal determination. A second edit must go through another review. If another record changes after checks were prepared, refresh the registry and build fresh checks before recording.

## Story 2 — inspect a vertical stack

Choose **Above / below**, enter **X = 4, Y = 6**, and **Inspect vertical stack**, or click a point on the plan.

| Record | Elevations | Meaning |
| --- | --- | --- |
| BASE | −3–0 m | One shared basement serving both buildings |
| A-101 | 0–3 m | Ground apartment |
| A-201 | 3–6 m | Upper apartment |

At **X = 12, Y = 6**, records from both buildings touch the shared wall. The result includes all touching records and labels boundary contact separately. Context parcels and buildings do not compete with their enclosed spaces as ownership volumes.

## Story 3 — excavation impact

1. Choose **Excavation impact** → **Load demo proposal**. This loads the footprint `[10,11]–[14,14]` and elevations **−5–0 m**. For an arbitrary proposal, use **Draw footprint**, click corners, and enter the lower/upper limits.
2. Choose **Check impact**. Select each result to highlight its actual intersection. Results identify the current registry revision, permanent IDs, elevations, related buildings, fictional parties and evidence.

| Affected record | Independent calculation | Positive volume |
| --- | --- | --- |
| BASE | 4 m across × 1 m deep in plan × 3 m vertically | **12 m³** |
| UTIL | 4 m across × 1 m deep in plan × 1 m vertically | **4 m³** |

The proposal also touches ground apartments at elevation zero. Those rows correctly report **0 m³ boundary contact**; they are not positive-volume conflicts. A proposal never becomes a registered property. Results cover known records only and do not certify excavation clearance.

## Original files and repeatability

Open **Sources** in the registry to preview or download the five inspected originals. They are also in [fixtures/registry](fixtures/registry/): `spatial.json`, `levels.csv`, `plan.png`, `plan.pdf`, and `rights.pdf`. These are authored demo inputs, not downloaded Indian surveys. The JSON and CSV use the application's documented local-metre profiles; PDF/PNG plans are visual references. No BIM, LiDAR, drone, DEM or AI importer is claimed.

The seed uploads through the existing source inspection pipeline, prepares units, runs the real queued Python build, creates explicit registry drafts, checks neighbours and commits a reviewed snapshot. Repeating the seed resumes an incomplete load or returns the existing site; it does not reset subsequent operator changes. PDF/PNG inspection can retain `needs_input` for geometric tracing while the parsed page remains usable as a human-reviewed document reference.

**Add records** supports a new evidenced draft, importing a built workspace, and creating a new synthetic site. Compatible workspaces use **Import as draft**. If a workspace declares a different frame or benchmark, **Import into separate site** preserves that frame and opens the new site’s draft. It does not place unrelated coordinates inside Nandan. Repeated imports reuse the linked site/draft. **Prepare source inputs** opens the existing workbench in the site's frame. New rights must be entered with a source revision and locator; arbitrary imported geometry never creates a party or right. The Nandan seed alone uses its authored fictional rights schedule.

Old case URLs, downloads, histories and the C-001/C-002 stories remain under **Preparation workspaces**. They stay separate until explicitly imported. Archived rehearsal workspaces remain addressable by their original URLs.

## Verification and recovery

```sh
pnpm typecheck
pnpm test:registry
pnpm test:registry-allocation
pnpm test:api
services/geo/.venv/bin/python -m pytest services/geo/tests -q
```

The registry integration test exercises real draft reviews and creates additional immutable revisions in Nandan block. Run it before presenting, rather than expecting history to contain only revision 1. The allocation test uses and removes only its own unpublished temporary records. The API regression creates legacy rehearsal workspaces; archive those explicit test IDs to keep the selector tidy.

If loading fails, inspect the on-screen error and local service health. Run `pnpm demo` to recover the platform. For a code rebuild, stop the current application terminal with Ctrl+C before rerunning it. Never delete database/storage volumes to reset the presentation.

See [registry format and API](docs/REGISTRY.md) and [verification evidence](docs/REGISTRY_TEST_EVIDENCE.md).

## Map controls

The registry opens with the entire site in 3D and no selected record. Building A and Building B are labelled; they share a wall. Choose **Plan** for the local site map or **Plan + 3D** for both views. **Entire site** clears spatial filters and restores the whole-site camera. **Filters** contains building, floor and elevation controls. Select a space to open its record; close the panel to recover the full map. **Find records** opens search on demand. Source evidence, related records and history remain expandable. The map uses the declared local-metre frame, not a geographic basemap.
