# UI-02 Studio frame · attempt 1

Base `staging@c597d5252518b336d1cafc8852db21bdfcea13db`; source `8ea930b609da9a4f0b87f30f4f02f2edf6cd288f`; Codex `gpt-6-sol` at `xhigh`. The branch is `agent/UI-02-studio-frame`.

The shared area route now has one 56 px Studio header, a record-backed area/classification/revision scope strip, four mutually exclusive on-demand map panels, one collapsible 172 px findings tray and a 360 px inspector. On a narrow screen the inspector and left panel become sheets while the area scope remains visible. The existing Cesium viewport and 2D map remain mounted when those controls change. The header offers search with `/`, the saved-area switcher, a persisted theme preference, and explicit status/user-unavailable slots; it does not invent an account or live import state.

The D0 frame browser test confirms a single runtime ID, selected feature URL, camera stability, panel focus return, the tray, theme, 390 × 844 scope/actions, 200% zoom and reduced motion. The existing D1 journey still verifies the real source roof, original bytes, absent interiors, selection, layer visibility and source retry. Its fallback now loads its own positioning styles before the dynamically loaded map layer mounts.

## Final verification

- `pnpm --filter @ulpin/web typecheck`: exit 0.
- `pnpm --filter @ulpin/web build`: exit 0. The pre-existing GeoTIFF dynamic-dependency warning remains.
- `node scripts/usp/local-isolation.mjs --run`: exit 0, `USP isolated live: PASS`, scope `local-85a703d1db6f2e2e`.
- In that production-server run, UI-01 browser: 1 passed; UI-02 browser: 1 passed; D0/D1 journeys: 3 passed. D0/D1 import replay and project cleanup also passed.

The exact command statuses, code and artifact SHA-256 digests are in [run-summary.json](run-summary.json). The full isolated runner and browser reports are under [runs/local-85a703d1db6f2e2e](runs/local-85a703d1db6f2e2e). Fresh screenshots include selected D0 at desktop and phone in light/dark context, open Layers on both sizes, and the separately sourced D1 roof at desktop and phone.

This is a local frame and interaction pass. D0 is a synthetic fixture. D1 is one real source exterior in a local engineering display; global placement, interiors, analytical mesh volume, GPU performance and deployment remain unqualified.
