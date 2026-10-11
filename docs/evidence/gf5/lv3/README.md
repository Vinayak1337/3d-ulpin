TASK   LV3 — budgeted base additions and worker imagery            GATE GF5 / M2
WORKS  Base surfaces arrive over frames; the NYC TIFF decodes off-thread, with abort and refusals retained.
SEE IT node docs/evidence/gf5/lv3/results.mjs
INPUTS NYC 10013 multimodal pack at 1×; same real pack at 4×; headed RTX 3070 run.
GAPS   Gate partial: shader/render long tasks remain, two camera tests require deferred drawing, frozen imagery is off.
DESIGN engine.ts queues new base entries, finishes each batch's lines once, and includes base in draw completion.
       overlays.ts transfers bytes to imagery.worker.ts; imagery-pixels.ts preserves the RGBA conversion and refusals.
       Final-source fixed-id parity passes; the real imagery's 2,359,296 bytes and visible image match the prior loop.
CHECKS typecheck 0; Studio suite 1 (Studio 366 pass, two scene camera failures); scene suite 1; focused base 0;
       focused imagery 0; measurements 0; parity 0; design scan 0; diff check 0; owned ports/browser cleanup 0.
NEXT   Review the partial return before integration. Authorize draining in streaming-camera.test.ts fixtures;
       separate renderer/shader work is needed for criterion 3a and the inherited 4× slope failure.

`result.json` is the gate receipt, not a pass claim. `step0.json` records the bounded comparison and stop decision.
Large profiles, timings, screenshots and masks are outside Git under the paths in those receipts.
Timed runs precede the final wanted-list derived-order fix; final-source parity and focused tests cover that fix.
The frozen LV2 screenshot has assets present but imagery off. The additional imagery-visible comparison uses
that same fixed pose and the unchanged prior synchronous pixel loop as its control; it does not replace the
requested frozen imagery-visible baseline, which is unavailable.

The Studio acknowledgement uses `waitForDrawn` → `partIsDrawn`, which cannot settle with a nonempty base queue.
`finishDraw` publishes only built base ids. `drawnBuildings().pending` includes both queues, and the LV3 probe
requires pending zero for everything drawn. At 4×, acknowledgement backlog is measured against *all received*
parts, not just the acknowledged part; queued first additions spilling into later parts enter the slope.
The existing two camera failures assume synchronous `setBase`; their test file is outside the named ownership.
Do not rerun those failures unchanged. Add an explicit drain in those fixtures when that path is authorized.
