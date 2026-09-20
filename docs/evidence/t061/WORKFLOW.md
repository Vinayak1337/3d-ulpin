# Actual local spatial-ML workflow verification

The verifier creates one new, explicitly named synthetic verification property.
Its context footprint, metric controls, benchmark and levels are authored test
values. The floor-plan and overhead raster originals are published evaluation
sources, retained byte for byte with their attribution documents. They are not
surveys of the fictional test property. Existing datasets are not changed.

Use a running production web server, dispatcher and private API/Celery worker with
the matching pinned model manifest and installed weights. Both profiles must pass
readiness before the verifier creates any records. The default sample directory
is `/tmp/ulpin-ml-spike`; `ML_SAMPLE_DIR` can point to the same attributed inputs
elsewhere. The default output is `docs/evidence/t061/workflow`.

```sh
pnpm exec tsx scripts/ml/verify-workflow.ts
node scripts/ml/browser-workflow.mjs
pnpm exec tsx scripts/ml/verify-workflow.ts --record
node scripts/ml/browser-workflow.mjs --recorded
```

The first command retains sources, runs real Celery inference, checks immutable
artifacts, and sends one exact room contour to unreviewed preparation facts. A
separate roof component enters the ordinary area draft flow. The batch includes a
published empty evaluation tile and an unsupported image page, so successful,
empty and failed results are independently retained. Stale revisions, wrong
raster hashes, conflicting request keys and duplicate applications are checked.

The browser command uses full bundled Chromium and the retained checkpoint. It
reads real API results, inspects source pixels/regions/receipts, toggles overlays,
checks narrow layout and reload restoration, and blocks unexpected API writes.
The final command retries the failed page through the actual worker, explicitly
reviews the generated facts, runs the normal private geometry build, and records
the synthetic 3D unit. Exact contour vertices, area and volume are checked. The
roof proposal follows ordinary review/commit while its height remains unknown.
The fourth command opens the exact recorded unit in the real 3D register and
checks ready rendering, canonical selection, reload and an unchanged dossier.

`workflow/state.json` is an execution checkpoint and identifies every new record.
Reusing the same output directory resumes that test property. Use a new
`ML_VERIFY_DIR` only when intentionally starting another independent verification.
After diagnosing and fixing a real worker failure, `--retry-failed` retries the
same valid-page items with checkpointed request keys, preserving their prior
attempts. `ML_RECOVERY_RUN` names that specific recovery (default
`runtime-recovery-1`); use another name only for an intentional additional retry.
Neither command deletes retained originals or implicitly refreshes the repository
snapshot. A failing run keeps its checkpoint and error; readiness or layout errors
must not be reclassified as successful results.

The source licensing and the narrow evaluation scope remain visible. These runs
prove the local reviewed-assistance workflow, not cadastral/survey accuracy,
Indian field qualification, model generalization or physical-device acceptance.
