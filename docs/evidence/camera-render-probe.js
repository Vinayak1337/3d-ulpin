// Playwright CLI run-code function. Browser-only diagnostic, no source/record mutations.
// Counts actual WebGL-drawn animation intervals, not idle RAF ticks or GPU-present events.
async (page) => {
  await page.goto('http://127.0.0.1:3000/areas/9e77c608-bac7-4d56-9ac7-3032cc49074d', {waitUntil: 'networkidle'});
  await page.locator('canvas').waitFor({state: 'visible'});
  await page.evaluate(() => {
    const probe = {active: false, draws: 0, totalDraws: 0, frames: [], rafTicks: 0, start: 0};
    window.__ulpinFrameProbe = probe;
    for (const Type of [WebGLRenderingContext, WebGL2RenderingContext]) {
      for (const method of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        const original = Type.prototype[method];
        if (!original) continue;
        Type.prototype[method] = function (...args) {
          if (probe.active) { probe.draws++; probe.totalDraws++; }
          return original.apply(this, args);
        };
      }
    }
    function sample(time) {
      if (probe.active) {
        probe.rafTicks++;
        if (probe.draws) { probe.frames.push(time - probe.start); probe.draws = 0; }
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  const box = await page.locator('canvas').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.evaluate(() => { const p = window.__ulpinFrameProbe; p.start = performance.now(); p.active = true; });
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 15, {steps: 180});
  await page.mouse.move(x - 5, y - 3, {steps: 180});
  await page.mouse.up();
  return page.evaluate(() => {
    const p = window.__ulpinFrameProbe; p.active = false;
    const durationMs = performance.now() - p.start;
    const deltas = p.frames.slice(1).map((v, i) => v - p.frames[i]).sort((a, b) => a - b);
    return {durationMs, drawnFrames: p.frames.length, actualGlDrawCalls: p.totalDraws, rafTicks: p.rafTicks,
      drawnFramesPerSecond: p.frames.length / (durationMs / 1000),
      p95DrawnFrameIntervalMs: deltas[Math.ceil(deltas.length * .95) - 1]};
  });
}
