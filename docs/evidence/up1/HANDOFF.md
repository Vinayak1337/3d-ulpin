TASK   UP1 — reader limits before upload; early batch progress            GATE GF-RECOVERY (Studio scope only)
WORKS  See reader eligibility before retaining, then watch sequential uploads and retry them on the batch page.
SEE IT `pnpm --filter @ulpin/studio test src/features/intake`
INPUTS Niagara Falls 2018 footprints (good resume); NYC footprint box (failed bound-part resume), both test_only.
GAPS   Transport is mocked; live capacity, browser reload/zoom and frame times are not qualified.

## Design

- `upload-model.ts` has one `readerEligibility` forecast from name/size. The dialog does not read headers today.
  Ambiguous JSON/ZIP and unknown extensions stay unknown; this does not alter retain routing or block retention.
- `packages/contracts/src/upload-reader-limits.ts` re-exports reader constants. Its narrow declaration avoids
  pulling backend schema implementation into Studio's stricter typecheck. Native GIS had only a Python constant:
  its exported ceiling is checked against that processor constant in the reader test.
- `useRetainBatch.ts` creates/checks the case, seeds the existing query cache, navigates, then continues the same
  `retainBatch` loop. Cache updates contain outcomes, waiting words and the active command, not file bytes.
- `BatchUploadProgress.tsx` subscribes to that cache, shows bytes/parts/current file, carries retry/cancel and the
  leave warning, refreshes the tray after each outcome, and hands reload receipts back to N04's existing component.
  Waiting names are saved after navigation's words so files not started yet are not forgotten.

## Verification

`result.json` records the 199 passing intake tests, Studio/API/server typechecks, controls, real-input sizes and
resolved setup/test failures. Existing N04 tests use the real GeoJSON bytes with mocked transport; the new forecast
checks only their names/sizes. The 2 GiB TIFF control allocates no large file. No Docker, DB or provider was used.
`ui-design-check.md` records the source/DOM review and the scanner's Studio coverage limitation.

## Next

No server change is needed for this scope. Keep the reader ceilings and small-file routing unchanged here.
Before claiming the live presentation is qualified, rehearse a multi-file drop, interrupted upload/reload/resume,
keyboard and 200% zoom on the authorized runtime. The remaining AUD1 routing/reader/closure gaps are separate work.
