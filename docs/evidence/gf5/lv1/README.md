# LV1 — incremental checkpoint, not a qualified GF5 gate

`result.json` starts with the four criteria. Only criterion 2 passes in full.
Setter-only slope falls to 0.000028 ms/prior building, but **including deferred queue work it is
0.011219**, above the 0.01 target. Performance changes stopped after this one design.

## Read

- `step0.json`: committed inventory and before measurement, before engine work.
- `lag.json`: before/after/4× results in the LV0 shape, plus full-work and render-backed counters.
- `parity.json`: the before state replayed unchanged (including application ids) at the before camera pose.
- `ui-design-check.json`: mechanical scan plus manual Studio review; scanner's scope limitation is explicit.
- `result.json`: criteria, failures, commands, safety, evidence paths and TASK–NEXT report.

Large CPU profiles, timings and 1440 screenshots stay in the task-owned data folders listed in the report.
The normal after run has 55 frame gaps over 50 ms, with a separate profile for each. Frame gaps are not GPU
measurements. Full-area `renderFrame` topped out at 40.7 ms at 1×; no look parameter was reduced.

## Reproduce from this worktree

```bash
node docs/evidence/gf5/lv1/measure.mjs
node docs/evidence/gf5/lv1/throttle.mjs
node docs/evidence/gf5/lv1/parity.mjs
node docs/evidence/gf5/lv1/compare.mjs
```

The first two commands capture `after.json` and `throttled.json`, using the supplied real NYC ZIP and
read-only LV0 Python. They own port 5234, create new LV1 scratch folders, stop Vite and verify the port is
free. The same-id replay owns and frees 5235. No backend, provider, GPU hardware job or registry write is
needed. `LV1_CAPTURE=before` selects a before capture when explicitly run against the starting engine.
A run overwrites generated LV1 evidence; preserve/check the existing committed report before replacing it.

The LV0 scripts themselves remain read-only. Their measuring algorithm was copied into LV1 to avoid
writing LV0 destinations. Probe additions count actual builds/acknowledgements. Screenshots and pose
alignment happen after profiling. The runner now saves named captures and formats compact JSON; those
packaging changes do not add another scene design or alter the frozen measured inputs.

## Qualification limits

- Deferred global tree avoidance still grows with prior building count. Base construction was only
  identity-guarded, not redesigned. Main-thread frame sampling leaves idle/compositor costs unattributed.
- At 4×, the unmodified sender's 1.5 s fallback advances parts while older geometry remains queued.
  The corrected measurement waits for actual final drawing: 1662 builds/ids, 14 acknowledgements with a
  later-part backlog. The first capture failure was a measurement assumption, not lost geometry.
- Separate upload intents produce different application ids and facade tints. Source keys and final
  bounds match. The fixed-id replay has RGB MAE 0.987542, but 2.42% pixels change by >8: still over the
  predeclared 1% tolerance. Normal camera poses differ because appends no longer reset the camera.
- Existing tests for all callers pass. Register, review workspace, roofprint map and portal screenshots
  were not captured; their live-scene behaviour is not claimed as qualified.
- Final review found a detail-promoted building could be picked/labelled before its first frame. A
  failing regression and a draw-proof guard fix that edge case. This interaction-only correction followed
  the performance capture; no second performance design or graphics tuning was attempted.
