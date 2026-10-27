// Analyze frozen before/LV1 and captured LV2 runs; no server or source acquisition.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { slope, partWork, sampleStack, alignSamples, taskProfile } from './profile.mjs';
import { comparePixels } from './pixels.mjs';
import { writeEvidence } from './evidence-json.mjs';

const directory = 'docs/evidence/gf5/lv1';
const scratch = `E:/BhuAayam-data/task-data/lv1/lv2-analysis-${Date.now()}`;
const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
const captures = ['before', 'after', 'lv2-after', 'lv2-throttled', 'lv2-headed'];
await mkdir(scratch, { recursive: true });

function baseWork(run) {
  let base = 0;
  return run.chunks.filter((part) => part.count > part.buildings).map((part, index) => {
    const point = { x: base, part: index, y: part.baseApplyMs, arriving: part.count - part.buildings };
    base += point.arriving;
    return point;
  });
}

async function analyze(name) {
  const run = await load(`${directory}/${name}.json`);
  const timings = await load(run.rawTimingFile);
  const profile = await load(run.rawCpuFile);
  const alignment = alignSamples(sampleStack(profile, timings), timings);
  const samples = alignment.samples;
  const tasks = timings.tasks.filter((task) => task.at >= run.streamWindow.from
    && task.at <= run.streamWindow.to && task.ms > 50).map((task) => taskProfile(task, timings, samples));
  const taskFile = `${scratch}/${name}-long-tasks.json`;
  await writeFile(taskFile, JSON.stringify(tasks), { flag: 'wx' });
  const work = partWork(run, timings);
  const base = baseWork(run);
  const frames = timings.calls.filter((call) => call.name === 'renderFrame');
  const scene = await load(run.rawTimingFile.replace('/timings.json', '/scene.json'));
  return {
    git: run.git, setterSlopeMsPerPriorBuilding: run.hypothesis.slopeMsPerPriorBuilding,
    deferredInclusiveSlopeMsPerPriorBuilding: name === 'before' ? null : slope(work),
    built: name === 'before' ? run.hypothesis.summedBuildingsPassedToReplacement
      : timings.calls.filter((call) => call.name === 'addBuilding').length,
    buildingOnlyBaseRebuilds: name === 'before' ? 17
      : work.slice(1).reduce((sum, part) => sum + part.baseRebuilds, 0),
    baseSlopeMsPerPriorFeature: slope(base), baseSlopeMsPerPriorPart: slope(base.map((point) =>
      ({ x: point.part, y: point.y }))), baseParts: base,
    longTasksOver50: tasks.length,
    sceneOrStudioLongTaskCount: tasks.filter((task) => task.sceneOrStudioAttributable).length,
    remainingLongTasks: name === 'lv2-after' || name === 'lv2-headed' ? tasks : undefined,
    sampleAlignment: { offsetMs: alignment.offsetMs, matchedMs: alignment.matchedMs },
    longTasksFile: taskFile, raf: run.frames, environment: run.environment,
    importCompleteMs: run.startToCompleteMs, finalDrawMs: run.startToLastDrawMs,
    maxFullAreaRenderFrameMs: Math.max(...frames.filter((call) => call.buildings === 1662).map((call) => call.ms)),
    acknowledgements: timings.acks?.length ?? null,
    acknowledgementsWithLaterBacklog: timings.acks?.filter((ack) => ack.pending || ack.drawn !== ack.received).length,
    scene: { bounds: scene.bounds, drawn: scene.ids.length, padBatches: scene.padBatches,
      baseBounds: scene.baseBounds, framedBounds: scene.framedBounds },
  };
}

const results = {};
for (const name of captures) results[name] = await analyze(name);
const parity = await load(`${directory}/lv2-parity.json`);
const oldParity = await load(`${directory}/parity.json`);
const diagnosis = await load(`${directory}/lv2-diagnosis-assets-present.json`);
const before = await load(`${directory}/before.json`);
const originalRegions = diagnosis.regions.map((region) => region.name === 'assetErrorNote'
  ? { ...region, x: 28, y: 628, width: 379, height: 56 } : region);
const frozenLv1Pixels = await comparePixels(before.rawTimingFile.replace('/timings.json', '/final.png'),
  oldParity.screenshot, oldParity.rect, `${scratch}/lv1-frozen-difference.png`, originalRegions);
await writeEvidence(`${directory}/lv2-comparison.json`, {
  runs: results, parity, frozenLv1Pixels, diagnosisFile: `${directory}/lv2-diagnosis-assets-present.json`,
  measurementChange: '3a uses PerformanceObserver long tasks >50 ms; rAF gaps are stated, not the gate.',
  attributionLimit: 'Call boundaries are direct; CDP offset calibrated by overlap with measured calls, +/-500 ms.',
  taskAttributionRule: 'Scene calls overlap or samples include scene/Studio source; decoder noted separately.',
  frozenDifferenceImage: `${scratch}/lv1-frozen-difference.png`,
});
console.log(JSON.stringify({ results, frozenLv1Pixels, parity }));
