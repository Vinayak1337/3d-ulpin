# T057 — normalized neighbourhood renderer and shared 3D interface

Authorized priority: complete the existing-data bridge, then enhance 3D visuals/UI;
ML follows the visual milestone. T009 is the integration prerequisite. This focused
task does not wait for every bulk importer or implement a second cadastral model.
Existing T010 onward acceptance requirements remain, not silently marked complete.

## Current evidence and target

The inspected REF-15 map anchor is scene-led: architectural depth, continuous
streets, legible ground, restrained selection and concise panels. The inherited
calibration is a working tiled scene, but its distant framing, repetitive facade,
flat materials and ground/globe overlap do not match that visual standard. Source
neighbourhoods must use the same rendering infrastructure, not a locality-specific
map or a screenshot. Preserve all real footprint/road coordinates and unknowns.

## Implementation sequence

1. Add a display-only projection from the normalized read result into the existing
   renderer profile. Keep original canonical references and analytical geometry in
   the input; only rendering positions are derived. Geographic coordinates use
   explicit WGS84/ECEF-to-local placement for a relative display plane, not a claim
   of surveyed ground or vertical accuracy. Supplied relative height may produce
   labelled massing; unknown height remains an outlined/flat footprint, not a
   fabricated building. Unplaced interiors remain linked records, not guessed rooms.
2. Serve bounded, digest-pinned in-memory render artifacts via local-only read
   routes. No file writes, original replacement, DB publication pointer or public
   source cache. Bound memory, lifetime and concurrent compilation; validate every
   request's area/world/digest/asset path and keep the old valid scene on failure.
3. Let the same explorer/viewer consume calibration or a selected saved area, with
   selection resolving exact normalized IDs/representations. Add explicit links
   from the existing block to its enhanced scene and back to its property register.
   Calculate the inspector's measurements from canonical analytical records only,
   never from display-plane meshes or diagram-width alignments.
4. Improve shared complete-neighbourhood materials, consistent lighting, framing,
   source-preserving selection outlines, ground contact, street treatment and
   synthetic-only architectural detail. Add subtle generated material texture with
   proper filtered glTF UVs, not a static image posing as the map. No engine switch.
5. Improve panel hierarchy, source/missing-data states, camera controls and mobile
   access to selection details. Keep one mounted canvas across panel changes and
   preserve selected identities during tile/loading updates.

## Verification and edge cases

Pure tests cover display projection without source mutation, coordinate/height
limits, unknown footprints, holes, line-vs-surface meaning, original ID/measurement
invariance, deterministic texture/assets, and cache/route boundaries. Re-run core,
spatial and UI regressions plus generated drift/type/build checks. Actual browser
checks must fetch GLBs, pick an object on the canvas, keep one viewer, operate
2D/3D/layers/focus/held gestures, inspect saved-area metadata and render 390px and
desktop layouts without trapped controls. Inspect real screenshots against the
anchor and in alternate camera positions before reporting visual progress.

## Boundaries and completion

This task produces a functioning improved explorer on normalized existing data,
not national-scale delivery, new ML segmentation or complete replacement of every
legacy screen. Exact source-use attribution remains visible. UI implementation
verification and final user visual acceptance are distinct; do not invent the
latter. Rollback is disabling the new explorer/derived routes and reverting style
changes; no persisted data needs restoring.
