# Map and 3D

The map is quiet by default and colour appears only where a question is being asked. Neutral massing, one green selection, and a **Colour by** control that swaps in exactly one legend at a time.

## Base scene

- Ground `map-ground`, roads `map-road`, public land `map-public-land`, water `map-water`. Parcels are 1px `map-parcel-line` outlines with no fill; the parcel ULPIN label sits at the centroid in `id-code` on a `radius-4` chip with `map-halo`.
- Buildings are neutral massing in `map-building` with `map-building-edge` slab lines at every recorded level, so floors read without colour.
- Two render styles, switched in the toolbar: **Model** (lit massing with conceptual façade detail) and **Volumes** (exact property prisms, flat-shaded, edges on). Checks, measurements and findings always open in Volumes.
- Light comes from the south-west at 45 degrees, soft shadows on. No sky gradient: the scene sits on `map-ground` in light and dark.

## Selection and focus

- Hover: 1px `primary` outline. Selected: `map-selected` fill (when no colour-by mode is on), 3px `primary` outline, 2px `map-halo` around it, and a leader-line label.
- Everything outside the selection or the isolated floor drops to `opacity-context`. Hidden floors show as `opacity-ghost` outlines, never disappear.
- Selection is shared across map, spaces list, inspector and URL. Switching 2D and 3D, Model and Volumes, or light and dark never loses it.

## Colour by (one at a time)

| Mode | What colours | Tokens | Legend |
| --- | --- | --- | --- |
| None (default) | Only the selection | `map-selected` | none |
| Rights | Every space by rights class | `rights-exclusive`, `rights-shared`, `rights-public`; no rights evidence = `readiness-unknown` hatch | 3 swatches + Unknown |
| Readiness | Spaces by readiness for the chosen task | `seq-250` to `seq-700`; Unknown = `readiness-unknown` hatch | ramp + Unknown |
| Findings | Participants of open findings only | `mark-critical`, `mark-serious`, `mark-warning`; others at `opacity-context` | severity + count |
| Utilities | Underground networks by type | `utility-*` (APWA code) | type list |

Rights uses three hues only, because neighbouring units must stay distinguishable for every reader; sub-types (residential, shop, parking) show as icons and labels, not more colours. Every coloured mode shows direct labels on the selected floor and a legend in the bottom-left corner.

## Evidence and record status (always on)

These two channels are independent of colour, so they work in every mode.

| Channel | Meaning | Treatment |
| --- | --- | --- |
| Fill | Surveyed or measured | Solid fill |
| Fill | From a plan or document | Solid fill, lighter by one step |
| Fill | Estimated (height, level, depth) | 45 degree hatch over the fill |
| Fill | Illustrative (façade, trees, mesh) | `opacity-ghost`, not pickable, never measured |
| Outline | Recorded | Solid 1px edge |
| Outline | Draft or provisional | Dashed 1px edge |
| Outline | Retired (after split or merge) | Dotted edge, `opacity-ghost` |

## Findings

A finding highlights only its participants and the exact geometry at issue: an overlap is drawn as its own solid in `mark-critical` with a 45 degree hatch and a value label ("6.4 m³ overlap"). Contact and containment are never drawn in red. Selecting a finding switches to Volumes, frames all participants and opens it in the inspector.

## Floors, sections and underground

- **Level rail**: a vertical control on the right edge of the canvas listing every level top to bottom (roof, floors, ground, basements) with its lower elevation; the vertical reference is named once at the top ("m · SD-1"). Level order comes from the source (stilt, mezzanine, lower ground and rooftop structures included). Selecting a level isolates it; shift-select keeps levels above as ghosts.
- **Explode**: separates floors vertically for explanation. A banner reads "Display only. Measurements unchanged."
- **Section cut**: a draggable plane; cut faces are hatched `soil-top` below ground and `surface` above.
- **Underground**: the ground plane drops to `opacity-ground-cut`, a depth ruler appears on the left edge in metres below ground, basements and utilities become pickable. Utilities are tubes in their `utility-*` colour. A sleeve appears only when the source states a positional tolerance; otherwise the tube carries its quality letter (A to D) and "tolerance not stated". Quality letters are never converted into metre buffers. Areas with no utility survey show a `readiness-unknown` hatch labelled "No survey".
- **Air-rights envelope**: the legally buildable volume above a building is a wireframe box in `rights-public` dashes over `sky-band`, labelled with its height cap.

## Tools and readouts

Floating toolbar (top-left of the canvas): Select, Measure distance, Measure area, Section, Impact screening, Underground, 2D/3D, Model/Volumes, Reset camera. Bottom-right: zoom, north arrow, scale bar. Bottom edge: a coordinate readout in `data-num` showing easting, northing, elevation and the named frame (for example "EPSG:32643 · 212.40 m · SD-1").

## Camera

Three saved views per building: Plan (top-down, orthographic), Oblique (45 degree), Section (orthographic side). Camera moves take 600 ms and stop on any input. Double-click frames the clicked object.
