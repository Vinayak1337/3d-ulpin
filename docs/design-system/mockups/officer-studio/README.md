# Officer Studio mockup reference

The layout, interaction and state reference for every Studio, Verify, Portal and Admin screen. It records the interactive mockup made in Claude Design (project "Officer Studio mockups transfer", `OfficerStudio.dc.html`, imported 25 September 2026) so coding agents can build the same UI without access to the private project.

**Replicate the UI, not the data.** The mockup was drawn around one worked example. None of its names, codes, numbers, file names, dates or people belong in the product, its fixtures or its tests. Every value on screen comes from the loaded records through the [view model schema](view-model.schema.json), and every source format reaches the screens through the same intake path. Nothing in the product labels data as invented; the scope strip shows the dataset's own recorded classification.

| File | Use it for |
| --- | --- |
| This README | Frame, interaction model, states, any-format intake, how to use it with the plan |
| [screens.md](screens.md) | Each screen's layout, components and bindings, grouped by the gate that builds it |
| [view-model.schema.json](view-model.schema.json) | What each screen reads, as a projection of the existing contracts in `packages/contracts` |

Authority is unchanged: [H99](../../../usp-agent-handoffs/99-ui-ux-and-integration.md) owns routes, selection, caches and V-shots; the [design system](../../README.md) owns tokens, components, map styling and copy. This reference shows how those rules look assembled. Where it disagrees with either, they win and this file is corrected.

## Rules for building from the mockup

1. **Bind, never paste.** A label, count, level list, legend entry, code, file name or date on screen is a binding to a field in the schema. Fixed UI copy (button labels, status words, the notes such as "Screening only. Not a clearance or dig permission.") is interface text and is kept verbatim.
2. **Nothing is shaped by the example.** No code assumes a ground-plus-N building, a fixed storey height, a floor naming pattern, a unit count, one parcel per building, one level per space, a basement count or a particular utility. Levels, spaces, rights categories, utility kinds and legend rows are whatever the data holds, in its order and with its labels.
3. **Empty is a state, not a gap.** With no data a screen shows its Empty state; with partial data it shows *Unknown*, *Not assessed* or *Estimated* exactly where the gap is. Never fill a gap with a sample, a zero or a plausible value.
4. **Badges come from the record.** *Test fixture*, *Seeded test case*, *Replayed from rehearsal* and *Illustrative* appear only when the record's provenance flags say so. The scope strip shows `scope.classification` (observed, planned, hypothetical, synthetic, unknown or mixed). No screen hard-codes a disclaimer.
5. **Tests use their own inputs.** Fixtures come from DATA under [H28](../../../usp-agent-handoffs/28-data-acquisition-and-finale-tests.md). A test may check that a layout zone exists or a state renders; it must not assert a value that only exists in the mockup.
6. **Use the repository runtime.** The mockup drew its scene with a small Three.js file; the product keeps the shared Cesium runtime ([H22](../../../usp-agent-handoffs/22-rendering-and-sparse-data.md)). Port the behaviour described below, not that file. The mockup's own component bundle stays outside the repository; build with the repo tokens and the components listed in [components.md](../../components.md).
7. **Tokens.** The mockup's variables are the repository tokens without the `ui-` prefix: `--primary` is `--ui-primary`, `--rail-right` is `--ui-right-rail-width`, `--rail-right-wide` is `--ui-right-rail-wide`, `--tray-height` is `--ui-bottom-tray-height`, `--header-studio` is `--ui-header-height`, `--bg` is `--ui-background`, `--ink-muted` is `--ui-muted`, `--soil-top` is `--ui-map-soil-top`. Dialog widths are 760 px (`dialog-md`) and 960 px (`dialog-lg`); page content caps at 1600 px, Portal content at 1200 px.

## The Studio frame

At 1440 × 900 the map page is a three-row grid: 56 px top bar, 36 px scope strip, then the work area with 16 px padding and 16 px gaps. Other Studio pages drop the scope strip.

```
┌ top bar 56 ─ wordmark · Batches Map Register · area · Live|Snapshot · language · More · theme · user ┐
├ scope strip 36 ─ [Layers][Spaces][Sources][Checks] │ area · revision or import progress · badges · crumbs … Add files ┤
│ ┌ left panel 308 ┐ ┌ canvas (radius 12) ─────────────────────────────┐ ┌ inspector 360 ┐ │
│ │ one of four    │ │ toolbar TL          level rail TR (building/    │ │ one selected  │ │
│ │ panels, closed │ │                      level modes, ends 64 above │ │ thing         │ │
│ │ by default     │ │ banner TL+60 (stale/error/no 3D, max 520)       │ │               │ │
│ │                │ │ legend BL     hint pill BC      readout BR      │ │               │ │
│ └────────────────┘ ├ tray 172 (import stream or findings) ───────────┤ └───────────────┘ │
│                    └─────────────────────────────────────────────────┘                   │
```

- Columns: `[308px left panel if open] minmax(0,1fr) [360px inspector if something is selected]`. The inspector widens to 400 px when it holds an evidence preview.
- The map section is `minmax(0,1fr)` plus a 172 px tray row only while the tray has content.
- Floating map pieces are 16 px from the canvas edges, surface background, 1 px strong border, radius 12, floating shadow.
- Readout (bottom-right, mono 12 px): `frame.horizontal.crs` · ground elevation · vertical reference label, a 40 px scale bar with its length, and **N**.
- Hint pill (bottom-centre, pointer-events none): "Select a building" in area mode with nothing selected, "Select a floor" in building mode, "Select a unit" in level mode with no space.
- The scope strip's crumbs show the path of the selection (building / level / space, or building / Underground or / Findings); earlier crumbs are links that step back.
- The header's More menu lists full-product screens as disabled items with a *Planned* badge; the language menu offers English with Hindi marked *Planned* for the Studio.

## Interaction model

Selection state is `{mode, building, level, space, finding, view, render, colourBy, panel}` ([schema `Selection`](view-model.schema.json)). It is shared by the map, register and workspace and survives 2D/3D, Model/Volumes, theme and panel changes.

| From | Input | Result |
| --- | --- | --- |
| area, nothing selected | click a building | select it: fills the inspector, halo on the building |
| area, building selected | click the same building | building mode: level rail appears |
| building | click a storey or pick a level on the rail | level mode for that level |
| level | click a space | select the space; inspector shows the space |
| level with a space | click empty ground | clear the space, stay on the level |
| area or building | click empty ground | clear the selection, back to area |
| any map mode | Underground or Impact screening tool | underground mode on the selected building's context |
| any | open a finding (tray, Checks panel, check row) | findings mode, Volumes render, that finding in the inspector |

**Escape** unwinds one step at a time: close the dialog → clear the space → leave level, findings or underground for building → leave building for area → clear the selection. Clicks while a dialog is open do nothing on the map.

**Camera.** Each change of mode, level or 2D/3D eases to a preset for that mode over 600 ms (ease-out cubic) and any drag cancels the ease. 2D is the same target seen from directly above at the same distance. Area: high oblique of the whole area. Building: oblique of the building. Level: closer oblique at the level's height. Underground: low view from the street side looking at the section. Findings: close view of the finding's geometry. Deviation: oblique of the building in both panes. Presets are computed from the bounding box of what is shown, never from fixed coordinates. The camera never moves on its own during an import.

**What the scene shows per mode.**

| Mode | Scene |
| --- | --- |
| area | Grey massing with a line at every known slab; parcels as thin outlines with the Parcel ULPIN at the centroid when asserted; selected building in primary with a halo, others at `--ui-opacity-context` |
| building | As area, closer; level rail visible |
| level | Levels above the chosen one are ghosts; the chosen level's shell is replaced by its spaces, coloured by the active Colour by with labels; the selected space in primary with a halo; estimated levels hatched |
| underground | Ground and flats at `--ui-opacity-ground-cut`; soil section; depth ruler with ticks every 5 m to the deepest known band; below-ground levels shown; each utility band as a tube in its `--ui-utility-*` colour with "quality · tolerance" label and a sleeve only when tolerance is known; unknown bands hatched "No survey"; the trench as a dashed outline with the column above it highlighted |
| findings | Volumes render, everything ghosted except the participants (ink outline); the finding's own geometry as a `--ui-mark-critical` hatched solid with its quantity label |
| deviation | Split viewport with one synced camera: left sanctioned, right observed; the difference geometry hatched critical with its label on the right pane only |

Labels are HTML overlays projected from 3D anchors (selected: primary pill; codes: mono muted; critical: danger pill; depth ticks: bare mono; space labels: white with a soft shadow, the selected one as a primary pill). Hide a label when its anchor is behind the camera or off screen.

**Import.** While an import runs the inspector is empty, the tray holds the ImportStream, and each saved object appears in place with a 200 ms grow-in; nothing moves the camera.

**Assignment.** After **Assign code** the dialog closes and a toast (bottom-centre, 6 s) shows the *Assigned* badge, the shortened code and **Make Property Card**.

## Inspector variants

The inspector holds one thing and re-keys (220 ms slide-in) when that thing changes.

| Selection | Title and status | Facts (all bound) | Footer |
| --- | --- | --- | --- |
| Building | `building.label`, status; Parcel ULPIN line | address, level summary, space count, open findings as a badge that opens findings; readiness meter for the named task | **Explore floors** (or disabled "Select a unit" in level mode) · **Open register** |
| Space, reviewed | `space.label`, status; code if assigned; location line | level with lower–upper elevation and vertical reference; computed area with its evidence chip; declared area with its chip and difference badge; share; further facts; restricted fields as *Restricted* with the role | **Assign code** → then **Property Card** · **Review area** |
| Space, draft | `space.label`, *Draft*; location line | level; anything missing as *Unknown* | **Request evidence** |
| Finding | FindingCard: severity, check version, title, calculation lines, evidence chips | — | the finding's allowed actions |
| Underground | DigColumn over the depth range: each band with its depth, colour and label; unknown bands hatched | — | **Export screening report** · **Request survey** |

A read-only role sees the same inspector with the primary action disabled and "Blocked: read-only role…" beneath it.

## States

Every screen renders these from data. The mockup's state switcher (Default, Empty, Loading, Stale, Error, Snapshot, No 3D, Replayed, Restricted, Mapping unavailable) is how to check them; the triggers are:

| State | Trigger in the view model | Treatment |
| --- | --- | --- |
| Empty | the list or building has no members | one sentence on what is missing and one **Add files** action, centred over the canvas or in the table |
| Loading | a read is pending | skeletons in the final layout; the scene hides records but keeps ground |
| Stale | `scope.stale` | warning banner naming the newer source, **Rebuild** |
| Error | `scope.error` or `file.error` | danger banner with message and fix, **Choose** for a CRS |
| Snapshot | `scope.status.kind = snapshot` | header shows "Snapshot" and its time instead of Live |
| No 3D | WebGL unavailable or a phone | the level's plan sheet plus the spaces list, same selection; info banner |
| Replayed | `replayedAt` on a model answer | neutral badge with the date wherever that answer shows |
| Restricted | `Value.state = withheld` with `requiredRole` | *Restricted* badge and the role; actions disabled with the reason |
| Mapping unavailable | `intake.provider = unavailable` | proposed mappings become *Manual*; warning "Automatic mapping unavailable. Map manually or save for later." |
| Unknown, Estimated, Not assessed, Not comparable, Blocked, CRS unverified | per-value states | as in the [UI brief states table](../../ui-brief.md#states-every-screen-needs) |

## Any format in, the same screens out

The Studio never branches its layout on file type. Intake turns any upload into the same records, and the screens read those records.

1. **Profile.** Each file gets a detected profile (`IntakeFile.profile`) with a family: vector, table, document, image, raster, point cloud, 3D model, BIM, archive, text or other. An unknown or unsupported file is still received, hashed and listed with that state; a *Planned* profile says so. New formats are added as profiles in the ingestion registry ([H14](../../../usp-agent-handoffs/14-adaptive-ingestion-and-progressive-review.md)), not as new screens.
2. **Frame.** The CRS is declared, verified, unverified, absent or not spatial. Unverified shows **Choose**; absent blocks placement with an actionable error but keeps the original.
3. **Mapping.** Fields map to registry concepts as *Proposed* (model output awaiting approval), *Reused mapping* (an approved recipe matched) or *Manual*. Only uncertain mappings ask one inline question built from the field and candidate concept, with Yes, No and Choose field. Unit conversions come from the conversion registry.
4. **Nothing dropped.** Fields with no concept yet travel as `attributes` with their literal source name and locator, and the inspector lists them under Source attributes. A later mapping promotes them without re-import.
5. **Evidence by locator.** Every value keeps its evidence pointer. The evidence viewer chooses its preview from the locator kind (page region, rows, feature, image region, JSON pointer, model element, point set, raster window), so a new format with an existing locator kind needs no new viewer.
6. **Shape from data.** Levels, spaces, rights, utility kinds, legend rows and counts are read from the records. A building with no levels renders as massing with "height unknown"; a space spanning levels appears on each of them.

## How agents use this with the plan

Pick work from [H29](../../../usp-agent-handoffs/29-agent-task-cards.md) as usual. Each UI card names the screens it builds in [screens.md](screens.md); read that section, the schema definitions it binds and the design-system pages it cites, then build on the existing routes and shared map path. A screen is finished when its bindings read real records through the ports, its states render from data, and its V-shot matches this reference in layout and state (values will differ and should).

| Gate | Cards | Screens |
| --- | --- | --- |
| GF2 | UI-01, UI-02, UI-03, UI-04 | frame and tokens; S1–S5, S9–S11 |
| GF3 | UI-05 | S6–S8, S12, S13 |
| GF4 | PACK-01 with UI | S14, P4L |
| GF5 | UI-06, UI-07 | captures and journeys over all finale screens |
| full_product | FP-PUBLIC and later | P1–P7, A1–A7, S15–S19 |
