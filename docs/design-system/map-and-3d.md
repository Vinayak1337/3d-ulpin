# Map and 3D

The scene is quiet by default and colour appears only where a question is being asked: neutral massing, one green selection, and a **Colour by** control that swaps in exactly one legend at a time. Runtime is the existing Cesium path (H22, H99); these rules style it.

## Base scene

- Ground `--ui-map-ground`, roads `--ui-map-road`, public land `--ui-map-public-land`, water `--ui-map-water`. Parcels are 1 px `--ui-map-parcel-line` outlines with no fill; the parcel ULPIN label sits at the centroid in mono on a 4 px chip with `--ui-map-halo`.
- Buildings are neutral massing in `--ui-map-building` with `--ui-map-building-edge` slab lines at every recorded level, so floors read without colour. A building with no known height is drawn flat, labelled "height unknown", never extruded to a guess.
- Two render styles in the toolbar: **Model** (lit massing, optional context mesh) and **Volumes** (exact property prisms, flat-shaded, edges on). Checks, measurements and findings always open in Volumes.
- Light from the south-west at 45°, soft shadows. No sky gradient.
- An orthophoto or photogrammetry mesh is an optional context layer (`representation: context_mesh`): never pickable as a property, never measured.

## Selection and focus

- Hover: 1 px primary outline. Selected: `--ui-map-selected` fill when no Colour by mode is on, 3 px primary outline, 2 px halo, leader-line label.
- Everything outside the selection or isolated floor drops to `--ui-opacity-context`; hidden floors show as `--ui-opacity-ghost` outlines, never disappear.
- Selection is shared across map, lists, inspector and URL (H99 section 6). Switching 2D/3D, Model/Volumes or theme never loses selection or camera.

## Colour by (one at a time)

| Mode | What colours | Tokens | Legend |
| --- | --- | --- | --- |
| None (default) | Only the selection | `--ui-map-selected` | none |
| Rights | Every space by rights class | `--ui-rights-exclusive`, `--ui-rights-shared`, `--ui-rights-public`; no rights evidence = unknown hatch | 3 swatches + Unknown |
| Readiness | Spaces by readiness for one named task | `--ui-seq-250` to `--ui-seq-700`; unknown = `--ui-readiness-unknown` hatch | ramp + Unknown |
| Findings | Participants of open findings only | `--ui-mark-critical`, `--ui-mark-serious`, `--ui-mark-warning`; others at context opacity | severity + count |
| Utilities | Underground networks by type | `--ui-utility-*` (APWA) | type list + "No survey" |

Rights uses three hues only so neighbouring units stay distinguishable for every reader; sub-types (residential, shop, parking) are icons and labels. Every coloured mode shows direct labels on the selected floor and a legend bottom-left.

## Evidence and record status (always on)

Independent of colour, so they work in every mode and for colour-blind readers. They follow `geometryClass` (H22 Z1).

| Channel | Meaning | Treatment |
| --- | --- | --- |
| Fill | `evidence_linked`, surveyed or measured | Solid fill |
| Fill | `evidence_linked`, from a plan or document | Solid fill, one step lighter |
| Fill | `estimated` (height, level, depth) | 45° hatch over the fill, "est." after numbers |
| Fill | `illustrative` (façade, trees, generic floor spacing) | Ghost opacity, not pickable, never measured |
| Outline | Recorded | Solid 1 px edge |
| Outline | Draft or candidate | Dashed 1 px edge |
| Outline | Retired | Dotted edge, ghost opacity |

AI candidates (building outlines, rooms) are dashed primary outlines labelled "AI candidate", accepted or rejected one at a time. A candidate is never drawn as a surveyed boundary.

## Findings

A finding highlights only its participants and the exact geometry at issue. An overlap is its own solid in `--ui-mark-critical` with a 45° hatch and a value label ("6.4 m³ overlap"). Contact and containment are never red. `Not assessed` shows as a grey hatched box with the reason, never as "no conflict". Selecting a finding switches to Volumes, frames all participants and opens it in the inspector. Findings are listed in deterministic order: blocking, then severity, then size.

## Floors, sections and underground

- **Level rail** on the right edge of the canvas lists every level top to bottom: rooftop structures, terrace, floors, mezzanines, ground, stilt, lower ground, basements. Each shows its lower elevation with the vertical reference once at the top ("m · site datum SD-1"). Level order comes from the source, not elevation. Unknown elevations show "?" with the hatch. Arrow keys move; shift-select keeps upper levels as ghosts.
- **Explode** separates floors for explanation with a banner "Display only. Measurements unchanged."
- **Section** is a draggable plane; cut faces are hatched `--ui-map-soil-top` below ground. Clipping is display only; FIND results remain the analytical authority.
- **Underground:** ground drops to `--ui-opacity-ground-cut`, a depth ruler appears on the left in metres below ground, basements and utilities become pickable. Utilities are tubes in their APWA colour. **A sleeve appears only when the source states a positional tolerance;** otherwise the tube shows its quality letter badge (A–D) and "tolerance not stated". Quality letters are never converted to metre buffers. Areas with no utility survey show the unknown hatch labelled "No survey"; absence is never drawn as clear.
- **Corridors** (metro tunnel or viaduct, pipeline right of user) are labelled volumes over or under the parcels they burden, with "Test fixture" when authored.
- **Air-rights envelope** (full_product): a dashed `--ui-rights-public` wireframe over `--ui-map-sky-band`, labelled "remaining permissible floor area, not a right".

## Tools and readouts

Floating toolbar (top-left of the canvas): Select, Measure distance, Measure area, Section, Impact screening (draw a trench or volume), Underground, then 2D/3D, Model/Volumes, Reset camera. Bottom-right: zoom, north arrow, scale bar. Bottom edge: coordinate readout in mono with easting, northing, height and the named frames, for example "EPSG:32643 · 212.40 m · site datum SD-1".

## Camera

Three saved views per building: Plan (top-down orthographic), Oblique (45°) and Section (orthographic side). Camera moves take 600 ms and stop on any input. Double-click frames the object. Returning from the register restores camera and selection; streamed assets never auto-fit the camera.

## Fonts on the map

Cesium rasterises labels with whatever font is loaded when the label is created. Call `document.fonts.load()` for Noto Sans and Noto Sans Devanagari before creating labels, and test a Hindi label offline.
