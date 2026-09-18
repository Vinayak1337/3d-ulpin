# T001 subtask: repair the inherited browser observation contract

## Reproduction and scope

The inherited f082441 hosted run 35342357727 fails its browser step. The same
production build on Windows times out waiting for `[data-tile-canvas]`, with no
page exception or failed asset response. The captured browser actually displays
the generated neighbourhood. Source inspection confirms that the test's stable
host/list/quantity markers were removed from the current JSX while the script
still requires them. Its zero-document text assertion also predates the current
label. This is an instrumentation mismatch, not evidence that the map failed to
render, and not a reason to relax geometry/navigation assertions.

## Change plan

1. Restore a stable tile-host marker and its actual manifest URL. Continue deriving
   ready/load/memory/camera values from Cesium callbacks, never hard-code success.
   Clear stale host telemetry when loading or disposing a publication.
2. Expose each existing list button's canonical entity ID, and the actual numeric
   horizontal-area value, alongside existing formatted accessible UI text.
3. Update only the zero-attachment text expectation to the current visible label.
   A subsequent actual capture showed Cesium requesting `.glb?v=<publication>`.
   Qualify the URL pathname, not the string suffix, and verify a fetched GLB's
   header/version/length. Keep a bounded public request trace for diagnosis.
4. Rebuild with no active production server, then run the complete browser suite.
   Retain its GLB request, canvas identity, quantity, unit, 2D, gesture, dataset
   return, responsive and error assertions. Failures discovered after the first
   fixed selector are diagnosed, not removed or marked successful by default.

## Boundaries and exit

No scene geometry, fixture dimensions, IDs, data writes, materials or layout are
changed by this repair. Read the installed Next 16.3.5 client directive guide
before editing these existing client components. User visual acceptance and
hardware/GPU capacity remain separate from this software-WebGL baseline.
Acceptance: actual production-browser suite passes and every restored marker
contains its real source/state value. Rollback is a code-only revert.
