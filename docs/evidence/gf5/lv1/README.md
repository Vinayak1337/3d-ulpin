# LV2 — resumed LV1 checkpoint (partial)

The camera, pads and incremental base are complete. **Criterion 3a still fails**: a 71 ms task contains
64.6 ms of initial base construction; a 67 ms task decodes retained imagery. No second performance design
was attempted to hide those costs. The final report is `result.json`; the previous report is `lv1-result.json`.

| Criterion | Before | LV1 | LV2 |
| --- | ---: | ---: | ---: |
| Full part-work slope, ms/prior building | 0.125430 | 0.011219 | 0.005923 |
| Building inputs built / building-only base rebuilds | 15,857 / 17 | 1,662 / 0 | 1,662 / 0 |
| Main-thread tasks >50 ms during stream (revised 3a) | 33 | 9 | 2 |
| Fixed-id pixels changed by >8 | 0% | 2.4215% | 0.3245% |

## The review findings

- `setImportStreaming(active)` follows arrived **surface and building** bounds. One pointer/wheel
  interaction, a selection or a non-area mode ends following. Refits occur only on plan-bound growth,
  with one interruptible 600 ms flight, never during a flight. Reduced motion jumps. The area pose now
  fits every box corner; the old preset's radius alone still clipped corners in the first LV2 capture.
- The frozen LV1 difference is **88.72% missing-asset error note, 10.68% text labels, 0.60% shadow-frustum**.
  All 129 non-UI residual pixels match the controlled shadow-difference mask. Pads, trees, building tints
  and edges account for none of the >8 residual. The earlier replay copied state but omitted retained
  TIFF/LAZ assets. Restoring those assets fixes the error note without changing renderer code.
- Pads are merged per drained frame for draw calls, not to fix pixels. Measured whole-area pad build:
  19.3 ms; a 24-building batch: at most 6.4 ms. The final software run has 57 pad meshes, not 1,662.
  Removal rebuilds only the owning batch. Shadow code and all look parameters remain unchanged.
- Base surfaces reconcile by id; parcel/kerb/lane lines merge per arriving part. Old surfaces and line
  batches retain identity. Changes/removals repair their batch only; utilities and anchors reconcile too.
  Base slope falls from +0.141518 (LV1) to **−0.049070 ms/prior base feature**. Initial construction is
  still synchronous, so this alone does not qualify the main-thread task gate.

## Evidence

`lag.json` retains the frozen LV1 before/after numbers and points to LV2. `lv2-comparison.json` contains
all three stages, every remaining task's top function, and paths to raw profiles. CPU sample alignment
is calibrated against named measured call intervals; direct call boundaries and task durations remain
the authority. Animation-frame gaps are stated, **not** the revised gate.

One headed Chrome run used the RTX 3070 (confirmed by the WebGL renderer string): p50 **7.1 ms**, p95
**24.8 ms**, longest **166.1 ms**, 6 gaps >50 ms and 3 >100 ms. Cold base builds and renderer `onFirstUse`
remain visible; full-area `renderFrame` max was 21.8 ms. The browser closed at the end. The 4× run built
all 1,662 inputs; its overlapping sender fallback is record-only and unchanged.

`lv2-parity.json` replays the before state's actual ids/records in 96-feature parts, with retained assets
and the before camera pose: exact ids and raw bounds, RGB MAE 0.103617/255, 0.3245% changed pixels.
Its neighboring `natural.png` and the measured run's `final.png` show the whole area kept in frame.
`lv2-callers.json` lists four 1440 screenshots of the actual caller components. Swiss placement/heights
remain unknown and its scene is empty; portal and roofprint use retained real records. These are isolated
read-only captures, not a live-backend journey. The UI design check states that limitation.

## Reproduce (owned worktree, no backend)

```bash
LV1_CAPTURE=lv2-after node docs/evidence/gf5/lv1/measure.mjs
LV1_CAPTURE=lv2-throttled LV1_CPU_RATE=4 node docs/evidence/gf5/lv1/measure.mjs
LV1_CAPTURE=lv2-headed LV2_HEADED=1 node docs/evidence/gf5/lv1/measure.mjs
LV2_PARITY=1 node docs/evidence/gf5/lv1/parity.mjs
node docs/evidence/gf5/lv1/lv2-callers.mjs
node docs/evidence/gf5/lv1/lv2-analyze.mjs
```

The headed command requires exclusive GPU ownership. One browser per command; each server owns and
frees 5234 or 5235. Raw data/screenshots live in new folders under the owned LV1 scratch directory.
Commands overwrite only generated evidence in this pack; preserve the committed report first.
The pre-pad diagnosis is frozen in its JSON/images; running `lv2-diagnose.mjs` now diagnoses current code,
not the older revision. `shadow-difference.mjs` analyzes only the existing images, with no scene mutation.

**Next:** lead review/integration decision, then a separate bounded task for frame-budgeted base additions
and moving imagery decoding off the main thread. Nothing was pushed, merged or rebased here.
