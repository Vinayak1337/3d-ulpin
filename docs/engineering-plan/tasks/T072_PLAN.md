# T072 — Recreate the reference-quality 3D map

Status: implemented as an isolated reference prototype; see T072_RESULT.md. User visual acceptance remains open. Implementation explicitly authorized by the user on 20 September 2026. User request: the supplied reference has a better 3D map; first plan, then recreate it. This task plans the map itself; it does not resume the complete app redesign or restore cleared application data.

## Target and current gap

Primary visual target: `/Users/vinayak/Downloads/3D_ULPIN_V2_REDESIGN_PACK_FINAL/images/anchors/01-block-map-anchor.png`. Secondary: `design/officer-studio-v3/02-map.png` for the simplified inspector. Current baseline: `design/bulk-studio-v4/screens/08-map.png`.

Recreate the original's oblique aerial composition, believable residential massing, varied façades/roof silhouettes, road intersections, pavements, plot boundaries, mature landscaping, material texture and directional depth. Preserve the newer prototype's focused controls and single inspector. The supplied raster supports an appearance reference, not exact hidden geometry or surveyed measurements.

The current scene is schematic. Its largest problems are structural: B01 has a 52×34m envelope and only 12.8m height; many other buildings repeat the same broad footprint; roads are three parallel strips; 13 trees provide little canopy. Flat materials and uniform windows amplify this. Changing lighting alone will not correct the massing or urban layout.

## Scope and deliverable

One new, isolated, explicitly synthetic reference neighbourhood, one improved map renderer and a captured visual comparison. Retain the existing fixture as a regression specimen. Do not stretch its canonical geometry to imitate the image. Do not seed the empty live application. Reuse the validated object/source/frame/geometry/relation contract and keep every visible property selectable by its own ID.

Implementation proceeds one phase at a time, with a screenshot/checkpoint after each phase. Functional checks alone do not constitute visual acceptance.

## Phase 1 — Neighbourhood composition and geometry

Author a separate reference specimen in a named local metre frame. Use compact residential plots, varied building footprints and 3–6 storeys where explicitly authored, two intersecting streets, side lanes, a coherent park/open area and perimeter context. Start with one focal building and one surrounding block; extend only after its proportions match the reference's character. A rough target is 20–30 context buildings, adjusted for composition rather than inventing visible counts.

Use plausible scale anchors: approximately 12–20m residential building envelopes where appropriate, 6–12m streets, correctly scaled kerbs/cars/people. These are fictional design inputs, not dimensions inferred from the screenshot. Preserve closed rings, courtyards/holes, per-floor geometry and unit links. Give the focal building coherent interior spaces and a basement/utility example. Include one footprint-only object with unknown height for regression.

Set the initial camera from the reference: an oblique downward city view, focal building near the visual centre, surrounding fabric extending to viewport edges, little unused ground, no horizon. Fit and Focus remain separate actions. Capture the plain geometry at desktop and tablet before adding detail.

Exit: readable street hierarchy, credible residential proportions, varied silhouettes and a convincing composition in neutral materials.

## Phase 2 — Architectural detail

Develop a small deterministic library of façade/roof treatments applied within each authored building envelope: recessed-looking windows, frames, floor ledges, entrance cues, appropriate balconies, roof parapets, stair cores and occasional rooftop equipment. Vary by building identity while maintaining a coherent local architectural language. Add façade detail from wall orientation/ring segments rather than substituting rectangular buildings.

Keep decorative architectural components separate from canonical boundary solids. Their source is explicitly authored/synthetic. Floor-associated decorations must travel with their floor during isolation or separation. Unknown-height objects receive no invented walls. Imported future high-detail meshes retain an object/space ID mapping and are display assets, not replacement cadastral geometry.

Exit: the focal building and neighbours look residential at close and neighbourhood distances, with coherent floor levels and no repetitive window wallpaper.

## Phase 3 — Materials and street environment

Use locally stored, licensed or authored small repeatable textures: concrete/plaster, roof surfaces, asphalt, pavements and grass. Include physically based roughness/normal variation where it improves depth without obscuring cadastral overlays. Track external asset origin/license. No Google imagery or other third-party 3D dataset is assumed available.

Construct connected street surfaces and clean junctions, kerbs, pavements, crossings and road markings. Add boundary walls/gates and planting inside appropriate fictional plots. Use a few lightweight tree species with varied size/rotation and dense, believable canopy; add limited parked vehicles and street furniture as scale cues. These remain toggleable scene decoration, distinct from recorded infrastructure or rights.

Exit: ground has meaningful material/land-use variation, streets connect, park canopy reads naturally and decoration does not hide parcel/building selection.

## Phase 4 — Light, shadows and image finish

Tune directional daylight, environment illumination and material response together. Use soft cast/contact shadows, restrained ambient occlusion and balanced tone mapping. Avoid the current washed-out green tint and overbright roofs. Dynamic shadow bounds should follow the relevant scene extent rather than waste shadow resolution over empty ground.

The installed Three.js package includes GLTF loading, environment loading and postprocessing modules, but the standalone prototype currently vendors only core and OrbitControls. Explicitly vendor required add-ons and their imports if chosen; the first block can use core geometry, instancing and authored textures. Use add-ons only as needed. Verify clipping and transparency before enabling postprocessing globally. Keep anti-aliasing and readable fine overlays; avoid cinematic depth-of-field that obscures property evidence.

Exit: buildings sit convincingly on the ground; façades, trees and roofs have visible depth without crushed shadows or blown highlights.

## Phase 5 — Cadastral interactions and display contract

Use a true orthographic plan camera for 2D while keeping the perspective camera for 3D. Reapply existing working controls: orbit/pan/zoom, 2D/3D, Fit/North/Focus, search-to-focus, closable inspector, exact floor and space selection, hide-above/isolate, floor separation, section plane, underground alignment and return-to-map context.

Selection uses restrained green outline/tint that preserves material detail; amber denotes incomplete evidence and red is reserved for a selected actual test conflict. Avoid tinting all surfaces equally. Parcel lines and unit boundaries remain legible above textures. Labels need distance-aware visibility and collision reduction. Keep a clear selected-property label and source/reference status.

Maintain two related representations:

- Analytical geometry: canonical polygons/solids, metre frame, benchmark, IDs, source evidence and immutable revisions. Measures/checks use these only.
- Display assets: façades, textured meshes, vegetation, shadows, display levels of detail and decoration linked to those IDs. They never assert new ownership or alter analytical extents.

For future real data, an adapter supplies canonical records plus optional native imagery/point-cloud/mesh assets and placement lineage. It does not need a new page-specific viewer. Missing geometry/reference remains unavailable, and unsupported native solids do not get silently converted to boxes. The separate proposed v1.1 native-solid contract still requires actual implementation/validation before being claimed supported.

Exit: all existing map interactions remain usable with the richer scene, and selected unit geometry remains exact and identifiable.

## Phase 6 — Performance and visual verification

Use shared geometry/materials, instancing for repeated decoration, distance-based detail and bounded texture sizes. Replace the current approximately 1,045 individual window meshes with grouped instances before adding detail. Render on interaction/state changes and while camera damping settles instead of spending full render cost while idle. Start with the focal block; measure before increasing surrounding context. Reduce optional shadows/vegetation/detail for lower graphics capability without changing canonical features.

Target a responsive desktop/tablet scene and approximately 30fps or better on the actual test machine during orbit; record the measured viewport/hardware and observed frame times rather than claim general performance. Document load time, asset payload and context loss/fallback behaviour. WebGL fallback must keep property retrieval available.

Capture at least: opening neighbourhood, focal building close-up, 2D parcel view, selected floor/unit, section view, underground view and tablet layout. Compare the opening and close-up directly with the original reference at a similar viewport/camera. Check real canvas changes as well as state transitions. Validate fixture identity/geometry, absence of missing-height extrusion, selection/overlay accuracy and unchanged live-app data.

Exit: side-by-side captures show the intended visual quality, interaction checks pass and measured rendering behaviour is acceptable. User visual review remains distinct from implementation completion.

## First implementation step

Build only the new neighbourhood composition and focal building proportions. Produce the first reference-versus-render comparison before detailed façades, environment assets or further application work. This catches the current scene's largest mismatch at its source.
