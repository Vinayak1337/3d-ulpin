TASK   LV4 — programs ready before first use            GATE GF5 / M2
WORKS  The measured warm-up prepares all 13 programs before streamed meshes appear; 1× stream shader stalls are gone.
SEE IT node docs/evidence/gf5/lv4/results.mjs
INPUTS NYC 10013 multimodal pack at 1× software, headed RTX 3070, and 4× software.
GAPS   Conservative timing stop: first visible feature frame +214.6 ms headless; final disposal cleanup is not timed.
DESIGN warm-programs.ts compiles engine material/attribute carriers and matching depth variants without drawing them.
       engine.ts starts one attempt; its two drains wait until settled, with rejection/2 s timeout fail-open.
       Fixtures declare readiness; tests cover readiness, rejection, timeout, disposal and queue acknowledgement.
CHECKS studio:typecheck 0; studio:test 0 (44 scene, 367 Studio, 2 API client, 7 UI); parity 0; diff check 0.
NEXT   Review the checkpoint and timing definition before another authorized run; no second tuning approach taken.

## Measured result, not a gate pass

- Baseline: two shader-first-use tasks in each 1× environment; inventories and stall table are in `step0.json`.
- After one bounded correction: zero stream long tasks in each 1× environment, and zero late programs, 13 → 13.
- First **visible feature frame**: page-to-frame +214.6 ms software, +131.8 ms GPU; this conservative measure triggered
  stop (d). Part-arrival-to-frame increases by only 124.7 ms software and decreases by 4.3 ms GPU.
- First **complete part**, timed at acknowledgement: −238.8 ms software, +108 ms GPU. These are different measures;
  neither is hidden. Last-arrival-to-all-drawn: +15.6 ms / +1 ms.
- Parity against LV3: identical ids and building/base bounds; RGB MAE 0.003785/255; changed fraction 0.000174.
- At 4×: 353 attributed long tasks, beside LV3's 327. No renderer/tree optimization was attempted.

## Baseline stall table

| Run / frame start (ms) | Task (ms) | Programs created | Material / first object kind |
| --- | ---: | --- | --- |
| Software / 20732.2 | 239 | 6, 7, 8 | publicLand surface, crown/trunk instanced trees |
| Software / 21167.5 | 216 | 9–12 | Three shadow-depth variants and bldg prism |
| RTX 3070 / 19652 | 105 | 6, 7, 8 | publicLand surface, crown/trunk instanced trees |
| RTX 3070 / 19871.3 | 100 | 9–12 | Three shadow-depth variants and bldg prism |

Names, types, full cache keys, individual first-use times and the 13-program inventory are in `step0.json`.
Each final measured 1× run has 13 programs at the first feature frame and at everything drawn, with zero created later.

## Warm-up and checkpoint

The engine is constructed at metadata, not during the earlier upload/probe page. Warm-up finishes after the first
part arrives: 289.2 ms software, 176.1 ms GPU, 813.9 ms at 4×. The full warm-window profiles are in `result.json`;
initial ordinary background rendering overlaps this window and is distinguished from warm carrier compilation.
Without KHR, one program is compiled and its uniforms/attributes initialized per frame. With KHR, readiness is polled.
Three normalizes the deprecated PCFSoft shadow type on its initial ordinary frame; compiling before it gives wrong keys.
Depth carriers use the real light/shadow counts, a fogless context and linear output, matching the actual shadow pass.
The internal background shader already exists at metadata; no replacement background or carrier is drawn.

The final source adds disposal cleanup after the timed comparison: retained depth materials are released with the
engine's building material, and pending carriers are canceled when that engine is disposed. Tests and parity cover
this source; **the timed receipt predates that cleanup**. Development StrictMode constructed two engines, so the
pre-cleanup timings include duplicate attempts. No further timed run was made after the stop, and no full final-source
performance claim is made. Review/authorization is needed to qualify that checkpoint, not another speculative approach.

Raw program keys, per-frame creation, material first-use times, CPU profiles, masks and screenshots stay outside Git
under each run's `rawTimingFile` / `rawCpuFile`. `compact.mjs` trims summaries without deleting raw data.
