# Display asset provenance

All architecture, trees, vehicles, streets, pavement, grass, texture pixels and landscaping in the interactive scene are authored procedurally for this fictional reference. No Google imagery, real photogrammetry, downloaded tree model or private survey geometry is included.

- `architecture.js`: polygon-following building display assets, canvas-generated wall/roof textures, instanced façade details.
- `environment.js`: procedural noise/paver/leaf textures, instanced canopies, simple scale vehicles, street furniture, paths and plot walls. Fixed seeds make the scene reproducible.
- `vendor/polygon-clipping.js`: polygon-clipping 0.15.7 bundled locally for robust runtime intersection/difference/union calculations. See `vendor/polygon-clipping-LICENSE.md`.
- `vendor/`: Three.js 0.186.0 and OrbitControls, MIT licensed. See `vendor/THREE-LICENSE.txt`.
- `screens/supplied-reference.png`: user-supplied design reference copied unchanged for visual comparison. It is not georeferenced and is not data for the analytical map.
- `screens/previous-map.png`: browser capture of the previous isolated prototype, retained for comparison.

Façades, roof equipment, trees and vehicles are presentation assets, not cadastral solids or ownership evidence. Canonical floor footprints, elevations and source lineage remain in the dataset. The geographic placement and vertical benchmark are explicitly fictional.
