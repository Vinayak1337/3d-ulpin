import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { alignSamples, partWork, sampleStack, slope, taskProfile } from './profile.mjs';
import { writeEvidence } from './evidence-json.mjs';

const directory = 'docs/evidence/gf5/lv3';
const scratch = `E:/BhuAayam-data/task-data/lv3/analysis-${Date.now()}`;
const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
await mkdir(scratch, { recursive: true });

function buildingOnlyBaseActivity(run, timings) {
  return run.chunks.filter((part) => part.buildings && part.count === part.buildings).map((part) => {
    const next = run.chunks[run.chunks.indexOf(part) + 1]?.at ?? timings.end;
    const calls = timings.calls.filter((call) => call.at >= part.at && call.at < next);
    return {
      sequence: part.sequence,
      settersRebuilt: calls.filter((call) => call.name === 'setBase' && call.rebuilt).length,
      queuedBaseDrains: calls.filter((call) => call.name === 'drainBaseQueue' && call.queued > 0).length,
    };
  });
}

function summarizeWork(run, timings) {
  const baseActivity = buildingOnlyBaseActivity(run, timings);
  const maxCall = (name) => Math.max(0, ...timings.calls.filter((call) => call.name === name)
    .map((call) => call.ms));
  return {
    builtBuildingInputs: timings.calls.filter((call) => call.name === 'addBuilding').length,
    buildingOnlyParts: baseActivity.length,
    buildingOnlyBaseRebuilds: baseActivity.reduce((sum, part) => sum + part.settersRebuilt, 0),
    buildingOnlyQueuedBaseDrains: baseActivity.reduce((sum, part) => sum + part.queuedBaseDrains, 0),
    deferredInclusiveSlopeMsPerPriorBuilding: slope(partWork(run, timings)),
    slopeIncludes: ['setBuildings', 'drainBuildingQueue', 'setBase', 'drainBaseQueue'],
    maxSetBaseMs: maxCall('setBase'),
    maxDrainBaseQueueMs: maxCall('drainBaseQueue'),
    lastPartToEverythingDrawnMs: run.streamWindow.to - run.chunks.at(-1).at,
    acknowledgementsWithBacklog: timings.acks.filter((ack) => ack.pending || ack.drawn !== ack.received).length,
  };
}

async function analyze(name, folder = directory) {
  const run = await load(`${folder}/${name}.json`);
  const timings = await load(run.rawTimingFile);
  const profile = await load(run.rawCpuFile);
  const alignment = alignSamples(sampleStack(profile, timings), timings);
  const tasks = timings.tasks.filter((task) => task.ms > 50 && task.at >= run.streamWindow.from
    && task.at <= run.streamWindow.to).map((task) => taskProfile(task, timings, alignment.samples));
  const taskFile = `${scratch}/${name}-long-tasks.json`;
  await writeFile(taskFile, JSON.stringify(tasks), { flag: 'wx' });
  return {
    git: run.git,
    environment: run.environment,
    ...summarizeWork(run, timings),
    longTasksOver50: tasks.length,
    sceneOrStudioLongTaskCount: tasks.filter((task) => task.sceneOrStudioAttributable).length,
    longestTask: tasks.reduce((longest, task) => !longest || task.ms > longest.ms ? task : longest, null),
    longestTasks: [...tasks].sort((left, right) => right.ms - left.ms).slice(0, 3),
    longTasksFile: taskFile,
    raf: run.frames,
    sampleAlignment: { offsetMs: alignment.offsetMs, matchedMs: alignment.matchedMs },
    rawTimingFile: run.rawTimingFile,
    rawCpuFile: run.rawCpuFile,
  };
}

const names = ['lv3-before', 'lv3-after', 'lv3-throttled', 'lv3-headed'];
const runs = {};
for (const name of names) runs[name] = await analyze(name);
const baselines = {};
for (const name of ['lv2-after', 'lv2-throttled', 'lv2-headed']) {
  baselines[name] = await analyze(name, 'docs/evidence/gf5/lv1');
}
const parity = await load(`${directory}/parity.json`);
const pairs = [['lv2-after', 'lv3-after'], ['lv2-throttled', 'lv3-throttled'], ['lv2-headed', 'lv3-headed']];
const tails = pairs.map(([before, after]) => ({
  before, after,
  beforeMs: baselines[before].lastPartToEverythingDrawnMs,
  afterMs: runs[after].lastPartToEverythingDrawnMs,
  deltaMs: runs[after].lastPartToEverythingDrawnMs - baselines[before].lastPartToEverythingDrawnMs,
}));
const runtimeChecks = names.slice(1).map((name) => ({
  name,
  criterion1: runs[name].builtBuildingInputs === 1662 && runs[name].buildingOnlyParts === 17
    && runs[name].buildingOnlyBaseRebuilds === 0,
  criterion2: runs[name].deferredInclusiveSlopeMsPerPriorBuilding < 0.01,
}));
await writeEvidence(`${directory}/result.json`, {
  task: 'LV3', gate: 'GF5 / M2', status: 'partial; gate not passed',
  input: (await load(`${directory}/lv3-after.json`)).input,
  runs, baselines,
  finalSourceGit: parity.sourceGit,
  finalChange: 'Wanted-list derived order fix after timed runs; final source rechecked by parity and focused tests.',
  criteria: {
    runtimeChecks,
    criterion3a: {
      passed: runs['lv3-after'].sceneOrStudioLongTaskCount === 0
        && runs['lv3-throttled'].sceneOrStudioLongTaskCount === 0,
      localUnchangedBeforeCount: runs['lv3-before'].sceneOrStudioLongTaskCount,
      frozenLv2BeforeCounts: [baselines['lv2-after'].sceneOrStudioLongTaskCount,
        baselines['lv2-throttled'].sceneOrStudioLongTaskCount],
      afterCounts: [runs['lv3-after'].sceneOrStudioLongTaskCount, runs['lv3-throttled'].sceneOrStudioLongTaskCount],
    },
    criterion4: {
      requestedImageryVisibleFrozenComparison: 'unqualified: the frozen LV2 after-capture has imagery off',
      frozenCaptureParityPassed: parity.identicalApplicationIds && parity.identicalBounds
        && parity.identicalBaseBounds && parity.scene.identicalSourceBaseIds
        && parity.pixels.meanAbsoluteError255 <= 1 && parity.pixels.changedFraction <= 0.01,
      realImageryParityPassed: parity.imageryCheck.differentBytes === 0
        && parity.imageryCheck.pixels.meanAbsoluteError255 === 0,
      ...parity,
    },
    headedRtx3070: {
      verified: runs['lv3-headed'].environment.gpuRenderer.includes('RTX 3070'),
      framesOver100Before: baselines['lv2-headed'].raf.over100,
      framesOver100After: runs['lv3-headed'].raf.over100,
    },
    importTail: { passed: tails.every((tail) => tail.deltaMs <= 200), comparisons: tails },
  },
  completion: {
    function: 'SceneEngine.waitForDrawn -> partIsDrawn -> finishDraw',
    rule: 'partIsDrawn requires an empty base queue and a rendered frame; renderedBase uses built entries only.',
    measurement: 'drawnBuildings.pending includes both queues; final render requires count 1662 and pending 0.',
    baseRebuildLimit: 'Zero rebuilt setters in the 17 building-only parts; first additions are counted separately.',
    difficultOverlap: 'At 4x, 26 nonempty base drains spill into building-only arrival intervals; all enter the slope.',
  },
  failureRecovery: {
    signature: 'Cold onFirstUse shader stalls at 1x; repeated WebGL render and tree refresh costs at 4x.',
    ledger: 'step0.json boundedComparison',
    attempt: 'One scoped repair comparison; no shader, material, tree or draw-call change.',
    result: 'The two targeted causes disappear. Two shader stalls remain at 1x; 327 attributed tasks remain at 4x.',
    stopDecision: 'Stop rule (c). No further attempt or expansion beyond the base queue and imagery decode.',
    next: 'Separate authorized renderer/shader work, and a decision about the inherited 4x renderer cost.',
  },
  gaps: [
    'Criterion 3a fails at 1x and 4x; criterion 2 fails at 4x, as it already did in LV2.',
    'Two streaming-camera.test.ts assertions need to drain the deferred base queue before camera assertions.',
    'That camera test file is outside the specifically named owned test paths and was not edited.',
    'Frozen LV2 after-capture has imagery off; imagery-visible parity uses a separate prior-loop control.',
  ],
  verification: {
    typecheck: { command: 'pnpm studio:typecheck', exitCode: 0 },
    studioSuite: { command: 'pnpm studio:test', exitCode: 1, studioTestsPassed: 366,
      note: 'Two scene camera fixtures fail; Studio, API client and UI pass. Later targeted testing adds one case.' },
    sceneSuite: { command: 'pnpm --filter @ulpin/scene test', exitCode: 1,
      note: 'Two camera tests assume synchronous base geometry; no other failing test.' },
    base: { command: 'pnpm --filter @ulpin/scene exec vitest run src/base-incremental.test.ts', exitCode: 0 },
    imagery: { command: 'pnpm --filter @ulpin/studio exec vitest run src/features/map/imagery-pixels.test.ts',
      exitCode: 0 },
    measurements: { names, exitCode: 0 },
    parity: { command: 'node docs/evidence/gf5/lv3/parity.mjs', exitCode: 0 },
    uiDesignCheck: { command: 'node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging', exitCode: 0 },
    diff: { command: 'git diff --check', exitCode: 0 },
  },
  limits: [
    'Development build, CPU sampling and hooks add overhead; rAF gaps are not the long-task gate.',
    'CPU sample attribution uses LV2 calibrated alignment (+/-500 ms); direct measured call times are separate.',
    'Frozen LV2 runs have no base queue; their inclusive work includes synchronous setBase instead.',
    'Performance captures use fresh import ids; visual parity uses fixed-id source replay, as in LV2.',
    'Final source parity includes 701 base ids, identical base bounds and real worker raster byte parity.',
    'Ack backlog is measured against all parts received so far, not only the part being acknowledged.',
  ],
});
console.log(JSON.stringify({ runtimeChecks, tails, counts: names.map((name) =>
  [name, runs[name].sceneOrStudioLongTaskCount]), parity: parity.pixels }));
