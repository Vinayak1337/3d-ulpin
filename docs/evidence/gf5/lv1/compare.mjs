// Reanalyse captured runs only. No server, registry, source acquisition or provider request.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { comparePixels } from './pixels.mjs';
import { writeEvidence } from './evidence-json.mjs';
import { slope, partWork, sampleStack, frameProfile } from './profile.mjs';

const directory = 'docs/evidence/gf5/lv1';
const scratch = `E:/BhuAayam-data/task-data/lv1/comparison-${Date.now()}`;
await mkdir(scratch, { recursive: true });
const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
const round = (key, value) => typeof value === 'number' ? Math.round(value * 1000000) / 1000000 : value;

async function pixels(before, after) {
  const rect = await load(`${after}/canvas-rect.json`);
  return {
    natural: await comparePixels(`${before}/final.png`, `${after}/final.png`, rect),
    aligned: await comparePixels(`${before}/final.png`, `${after}/aligned.png`, rect),
    rect,
  };
}

const before = await load(`${directory}/before.json`);
const after = await load(`${directory}/after.json`);
const difficult = await load(`${directory}/throttled.json`);
const runs = [before, after, difficult];
const timings = await Promise.all(runs.map((run) => load(run.rawTimingFile)));
const folders = runs.map((run) => run.rawTimingFile.replace(/\/timings.json$/, ''));
const scenes = await Promise.all(folders.map((folder) => load(`${folder}/scene.json`)));
const work = partWork(after, timings[1]);
async function sourceKeys(folder) {
  const { readdir } = await import('node:fs/promises');
  const jobs = (await readdir(`${folder}/transport`)).filter((name) => /^d30d[0-9a-f-]+$/.test(name));
  const state = await load(`${folder}/transport/${jobs[0]}/state.json`);
  return state.features.filter((feature) => feature.kind === 'building')
    .map((feature) => `${feature.datasetNamespace}:${feature.sourceKey}`).sort();
}

const keys = await Promise.all(folders.map(sourceKeys));
for (let index = 0; index < runs.length; index++) {
  const points = timings[index].calls.filter((call) => call.name === 'setBuildings' && call.after > 0)
    .map((call) => ({ x: call.before, y: call.ms }));
  runs[index].hypothesis.slopeMsPerPriorBuilding = slope(points);
  runs[index].hypothesis.sceneCostGrows = slope(points) >= 0.01;
}
const profiles = await Promise.all(runs.map((run) => load(run.rawCpuFile)));
const samples = sampleStack(profiles[1], timings[1]);
const remaining = timings[1].frames.filter((frame) => frame.at >= after.streamWindow.from
  && frame.at <= after.streamWindow.to + 17 && frame.ms > 50)
  .map((frame) => frameProfile(frame, timings[1], samples));
await writeFile(`${scratch}/remaining-frames.json`, JSON.stringify(remaining, round));
function renderTiming(timings) {
  const rendered = timings.calls.filter((call) => call.name === 'renderFrame');
  const full = rendered.filter((call) => call.buildings === 1662);
  const draining = timings.calls.filter((call) => call.name === 'drainBuildingQueue' && call.queued);
  return {
    maxRenderFrameMs: Math.max(...rendered.map((call) => call.ms)),
    maxFullAreaRenderFrameMs: Math.max(...full.map((call) => call.ms)),
    maxQueueStepIncludingGlobalTreesMs: Math.max(...draining.map((call) => call.ms)),
  };
}

const comparison = {
  setterSlopeMsPerPriorBuilding: {
    before: before.hypothesis.slopeMsPerPriorBuilding, after: after.hypothesis.slopeMsPerPriorBuilding,
  },
  deferredInclusiveSlopeMsPerPriorBuilding: slope(work),
  actualInputsBuilt: {
    before: before.hypothesis.summedBuildingsPassedToReplacement,
    after: timings[1].calls.filter((call) => call.name === 'addBuilding').length,
  },
  wholeListInputSumLimit: 'LV0 sums all setter inputs; that is not the number built by the incremental engine.',
  baseRebuildsInBuildingOnlyParts: {
    before: 17, after: work.slice(1).reduce((sum, part) => sum + part.baseRebuilds, 0),
  },
  identicalIds: JSON.stringify(scenes[0].ids) === JSON.stringify(scenes[1].ids),
  identicalSourceBuildingKeys: JSON.stringify(keys[0]) === JSON.stringify(keys[1]),
  identityLimit: 'normalize.py:12-16 derives application ids from each upload intent. Facade tint uses those ids.',
  identicalBounds: JSON.stringify(scenes[0].bounds) === JSON.stringify(scenes[1].bounds),
  finalBounds: scenes[1].bounds,
  pixels: await pixels(folders[0], folders[1]),
  sameIdentityReplay: await load(`${directory}/parity.json`),
  tolerance: { meanAbsoluteError255: 1, changedFractionAbove8: 0.01 },
  framesProfile: `${scratch}/remaining-frames.json`,
  remainingFrameProfiles: remaining.length,
  renderTiming: renderTiming(timings[1]),
  throttledRenderTiming: renderTiming(timings[2]),
  remainingFrameSampleGroupsMs: remaining.reduce((totals, frame) => {
    for (const [name, ms] of Object.entries(frame.groupsMs)) totals[name] = (totals[name] ?? 0) + ms;
    return totals;
  }, {}),
  profileLimit: 'CPU sample alignment uses end-of-probe minus CDP duration, approximate by a few ms.',
  normalAcks: timings[1].acks.length,
  normalAcksWithBacklog: timings[1].acks.filter((ack) => ack.pending || ack.drawn !== ack.received).length,
  throttledAcks: timings[2].acks.length,
  throttledAcksWithBacklog: timings[2].acks.filter((ack) => ack.pending || ack.drawn !== ack.received).length,
  throttledIds: scenes[2].ids.length,
  throttledInputBuilds: timings[2].calls.filter((call) => call.name === 'addBuilding').length,
  partApplication: work,
};
console.log(JSON.stringify(comparison, round, 2));
await writeEvidence(`${directory}/lag.json`, { before, after, difficult, comparison });
