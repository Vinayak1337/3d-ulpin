# UI-02 · Studio frame handoff

**Status:** implemented and verified in a disposable local production run. Base `staging@c597d5252518b336d1cafc8852db21bdfcea13db`; tested source `9495b36d8eed12cb7bf1fc05142a1c9468aeadac`; branch `agent/UI-02-studio-frame`. Agent: Codex / `gpt-6-sol` / `xhigh`. Callback: `ulpin-UI-02-attempt-1`.

The shared Studio header is 56 px and keeps Batches, Map and Register, search with `/`, saved-area switching, a persisted light/dark preference and explicit status/user-unavailable slots. The area route has a 36 px strip for its recorded name, classification, revision, selected record trail and Add files/Export actions. Its Layers, Spaces, Sources and Checks controls open one 308 px panel at a time over the same map. The selected inspector is 360 px, expands to 400 px for an open source preview, and collapses to a sheet below the scope strip on phone. The findings list uses the single 172 px tray.

The existing shared Cesium and 2D viewports remain mounted through panel/theme/mode changes. Source-world, selection and record URLs remain canonical. The D1 source-error fallback imports its own existing viewport stylesheet so Retry is positioned and clickable before the dynamic map layer loads. The lead explicitly confirmed this one-file ownership transfer; source, geometry and resource behavior were unchanged.

## Evidence

- [Attempt 1 summary and all SHA-256 digests](attempt-1/run-summary.json)
- [Final production runner receipt](attempt-1/runs/local-5bc2828c25c5188f/runner-receipt.json): 22 commands exited 0, including isolated setup/import replay, UI-01, UI-02, D0/D1 journeys and cleanup.
- [UI-02 browser report](attempt-1/runs/local-5bc2828c25c5188f/browser-report.json): 1 passed, 0 failed.
- [D0/D1 browser report](attempt-1/runs/local-5bc2828c25c5188f/d0-d1-browser-report.json): 3 passed, 0 failed.
- [Selected D0 desktop](attempt-1/runs/local-5bc2828c25c5188f/screenshots/d0-selected-light-1440.png), [selected D0 phone](attempt-1/runs/local-5bc2828c25c5188f/screenshots/d0-selected-dark-390.png), [open dark Layers desktop](attempt-1/runs/local-5bc2828c25c5188f/screenshots/d0-layers-dark-1440.png), [open dark Layers phone](attempt-1/runs/local-5bc2828c25c5188f/screenshots/d0-layers-dark-390.png), [real D1 roof desktop](attempt-1/runs/local-5bc2828c25c5188f/screenshots/d1-roof-desktop.png), [real D1 roof phone](attempt-1/runs/local-5bc2828c25c5188f/screenshots/d1-mobile-roof.png).

Browser assertions check a single map runtime ID, stable camera and feature URL through every panel, 2D/3D continuity, source-preview width, close/Escape focus return, the one findings tray, theme persistence after reload, 390 × 844 scope/actions, 200% zoom and reduced motion. The D1 journey also verifies the original source hash, roof surfaces, absent interiors, layer toggles, selection and retry after a failed source request. TypeScript and the guarded production build exited 0; the known GeoTIFF dynamic-dependency warning remains.

This is an engineering frame pass. D0 is synthetic, and D1 qualifies one real source exterior in a local display. It does not establish real-source accuracy, global placement, interior records, analytical mesh volume, GPU performance, learning or deployment.
