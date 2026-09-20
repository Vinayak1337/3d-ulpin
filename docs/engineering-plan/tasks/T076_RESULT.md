# T076 — Shared viewport foundation implemented

20 September 2026. The source-preserving canonical projection now feeds one shared Three runtime, used through the product MapViewport and the generated reference entry. Existing Cesium profiles remain available. Exact polygons, multipart shapes, holes, rotated roads, native utility segments and nonzero bases are supported within the bounded local profile. Rendering never substitutes boxes for source shapes.

Block Map now follows the reference header, explorer rail, inspector, minimap and findings-tray composition. Narrow screens use an explorer drawer and a docked property inspector. The layout-scoped cache and local-frame camera session are shared; local orbit is never interpreted as a geographic camera.

Evidence: 23 contract/package/presentation tests, 7 runtime geometry tests, 2 session tests and production build passed. Parent browser exercised dense/spacious/independent imports, +100m floor section bounds, computed conflicts, source receipts and mobile explorer. Captures are in ../evidence/t076/. The subsequent T077 user clarification adds complete identities, source extraction and register modes; its final captures supersede these intermediate captures.

The integration review found a sample-fetch race: request allocation now precedes fetching and guards errors/results so a delayed sample cannot replace a newer import. No live datasets were seeded. Full reference photographic similarity, the complete calibrated workspace, general native-mesh/terrain streaming and unqualified source adapters are not claimed by this gate.
