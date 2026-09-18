# ADR-004 — preserve the shared viewport and qualify Cesium incrementally

Status: accepted candidate boundary, not final visual acceptance.

Keep `MapViewport` and `createMapRuntime` as the common renderer boundary. The
existing area/local-model/tile layers are compatibility adapters, not independent
page-owned engines. Keep server data/cache, selection/session and GPU lifetimes
separate. Specialized calibrated plan or section views may project the same
canonical geometry without creating a competing property model.

Cesium 1.145.0 is the first candidate because it is installed and the actual
T001 browser loaded real compiled GLB/3D Tiles, retained one live canvas across
panels and exercised navigation. This does not qualify all picking/clipping,
context-loss, streaming capacity, device or visual requirements. Demonstrate a
specific blocker before replacing the engine.

The current deterministic compiler and two calibration neighbourhoods are useful
fixtures, not a complete multi-source pipeline or approved architectural quality.
Preserve geometry and source limits while improving common recipes, streets,
materials, grounding and contextual inspection. Never replace the canvas with an
anchor image or introduce a separate locality-specific renderer to imitate it.
