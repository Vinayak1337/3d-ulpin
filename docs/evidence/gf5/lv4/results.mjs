import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { alignSamples, sampleStack, taskProfile } from '../lv3/profile.mjs';
import { writeEvidence } from './evidence-json.mjs';

const directory = 'docs/evidence/gf5/lv4';
const scratch = `E:/BhuAayam-data/task-data/lv4/analysis-${Date.now()}`;
await mkdir(scratch, { recursive: true });
const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
const keyHash = (key) => createHash('sha256').update(key).digest('hex').slice(0, 16);

function programCounts(run, programs) {
  const first = new Set(programs.firstDrawn.map((program) => program.cacheKey));
  const late = programs.final.filter((program) => !first.has(program.cacheKey));
  const beforeStream = programs.events.filter((event) => event.at < run.streamWindow.from);
  return {
    beforeFeatureStream: new Set(beforeStream.map((event) => event.cacheKey)).size,
    createdDuringFeatureStream: programs.events.filter((event) => event.at >= run.streamWindow.from).length,
    firstPartDrawn: programs.firstDrawn.length,
    everythingDrawn: programs.final.length,
    createdAfterFirstDrawn: late.length,
    late: late.map((program) => ({ id: program.id, type: program.type, keyHash: keyHash(program.cacheKey) })),
    final: programs.final.map((program) => ({
      type: program.type, keyHash: keyHash(program.cacheKey), name: program.name,
    })),
  };
}

function rankedFunctions(samples, tasks, key) {
  const totals = new Map();
  for (const sample of samples) {
    if (!tasks.some((task) => sample.at >= task.at && sample.at < task.at + task.ms)) continue;
    const names = key === 'self' ? [sample.stack[0]] : new Set(sample.stack);
    for (const name of names) totals.set(name, (totals.get(name) ?? 0) + sample.ms);
  }
  return [...totals].filter(([name]) => !name.startsWith('('))
    .sort((left, right) => right[1] - left[1]).slice(0, 3);
}

function warmSummary(run, timings, samples) {
  const state = run.warmUp;
  if (!state) return null;
  const tasks = timings.tasks.filter((task) => task.at < state.endedAt && task.at + task.ms > state.startedAt)
    .map((task) => taskProfile(task, timings, samples));
  const caused = tasks.filter((task) => samples.some((sample) => sample.at >= task.at
    && sample.at <= task.at + task.ms && sample.stack.some((name) =>
      ['compileSerial', 'compileParallel', 'compileObjects'].includes(name))));
  const maximum = (values) => values.reduce((best, value) => !best || value.ms > best.ms ? value : best, null);
  return {
    ...state,
    elapsedMs: state.endedAt - state.startedAt,
    finishedBeforeFirstPartArrived: state.endedAt < run.streamWindow.from,
    longestObservedTaskDuringWarmInterval: maximum(tasks),
    longestTaskWithWarmUpSamples: maximum(caused),
    maximumMeasuredCompileCallMs: Math.max(0, ...timings.calls.filter((call) => call.name === 'compile'
      && call.at >= state.startedAt && call.at < state.endedAt).map((call) => call.ms)),
    overlapLimit: 'Initial ordinary rendering also occurs in the warm interval; it is not a warm carrier render.',
    compileCallsDuringInterval: timings.calls.filter((call) => call.name === 'compile'
      && call.at >= state.startedAt && call.at < state.endedAt).length,
    fallback: state.parallel ? 'KHR polling' : 'One compile and uniform/attribute link check per rAF',
  };
}

async function analyze(name) {
  const run = await load(`${directory}/${name}.json`);
  const timings = await load(run.rawTimingFile);
  const profile = await load(run.rawCpuFile);
  const alignment = alignSamples(sampleStack(profile, timings), timings);
  const tasks = timings.tasks.filter((task) => task.ms > 50 && task.at >= run.streamWindow.from
    && task.at <= run.streamWindow.to);
  const profiled = tasks.map((task) => taskProfile(task, timings, alignment.samples));
  const profilesPath = `${scratch}/${name}-long-tasks.json`;
  await writeFile(profilesPath, JSON.stringify(profiled), { flag: 'wx' });
  return {
    recordedGit: run.git,
    environment: run.environment,
    programs: programCounts(run, timings.programs),
    pageLoadToFirstFeatureFrameMs: run.firstPartDrawAt,
    pageLoadToFirstPartFullyDrawnMs: timings.acks[0]?.at ?? null,
    firstArrivalToFirstDrawnMs: run.firstPartDrawAt - run.streamWindow.from,
    lastArrivalToEverythingDrawnMs: run.lastPartToEverythingDrawnMs,
    warmUp: warmSummary(run, timings, alignment.samples),
    sceneOrStudioLongTasks: profiled.filter((task) => task.sceneOrStudioAttributable).length,
    allLongTasksOver50: profiled.length,
    topThreeSelf: rankedFunctions(alignment.samples, tasks, 'self'),
    topThreeInclusive: rankedFunctions(alignment.samples, tasks, 'inclusive'),
    longestTask: profiled.reduce((best, task) => !best || task.ms > best.ms ? task : best, null),
    profilesPath,
    rawTimingFile: run.rawTimingFile,
    rawCpuFile: run.rawCpuFile,
    frames: run.frames,
  };
}

const runs = {};
const names = ['lv4-before', 'lv4-before-headed', 'lv4-after', 'lv4-headed', 'lv4-throttled'];
for (const name of names) runs[name] = await analyze(name);
const comparisons = [['lv4-before', 'lv4-after'], ['lv4-before-headed', 'lv4-headed']]
  .map(([before, after]) => ({
    before, after,
    firstDrawDeltaMs: runs[after].pageLoadToFirstFeatureFrameMs - runs[before].pageLoadToFirstFeatureFrameMs,
    firstWholePartDeltaMs: runs[after].pageLoadToFirstPartFullyDrawnMs
      - runs[before].pageLoadToFirstPartFullyDrawnMs,
    arrivedToFirstDrawDeltaMs: runs[after].firstArrivalToFirstDrawnMs - runs[before].firstArrivalToFirstDrawnMs,
    finalDrawDeltaMs: runs[after].lastArrivalToEverythingDrawnMs - runs[before].lastArrivalToEverythingDrawnMs,
  }));
const parity = await load(`${directory}/parity.json`);
const step0 = await load(`${directory}/step0.json`);
await writeEvidence(`${directory}/result.json`, {
  task: 'LV4', gate: 'GF5 / M2', status: 'stopped under rule (d); checkpoint, not a gate pass',
  finalSourceGit: parity.sourceGit,
  input: (await load(`${directory}/lv4-after.json`)).input,
  runs, comparisons,
  criteria: {
    zeroLatePrograms: ['lv4-after', 'lv4-headed'].every((name) => runs[name].programs.createdAfterFirstDrawn === 0),
    criterion3aHeaded: runs['lv4-headed'].sceneOrStudioLongTasks === 0,
    criterion3aSoftware: runs['lv4-after'].sceneOrStudioLongTasks === 0,
    fourTimes: { lv3Before: 327, after: runs['lv4-throttled'].sceneOrStudioLongTasks,
      topThreeSelf: runs['lv4-throttled'].topThreeSelf },
    firstVisibleFeatureDelayPassed: comparisons.every((comparison) => comparison.firstDrawDeltaMs <= 200),
    firstWholePartDelayPassed: comparisons.every((comparison) => comparison.firstWholePartDeltaMs <= 200),
    finalDrawDelayPassed: comparisons.every((comparison) => comparison.finalDrawDeltaMs <= 200),
    parityPassed: parity.identicalApplicationIds && parity.identicalBounds && parity.identicalBaseBounds
      && parity.pixels.meanAbsoluteError255 <= 1 && parity.pixels.changedFraction <= 0.01,
  },
  parity,
  step0TableFile: 'docs/evidence/gf5/lv4/step0.json:tables',
  shaderSources: step0.source,
  boundedComparison: {
    ledger: 'bounded-change.json', initialAttempt: 'initial-attempt.json',
    result: 'Exact keys and zero stream shader stalls after one bounded change; headless page-to-first draw +214.6 ms.',
    stop: 'Rule (d): +214.6 ms exceeds the +200 ms bound after the one allowed change. No second tuning approach.',
    next: 'Review this checkpoint; constructor begins only after metadata, not during upload/probe.',
  },
  qualification: [
    'Timed final runs precede disposal cleanup in the same helper; final-source parity and all package tests pass.',
    'Cleanup releases retained depth carriers and cancels a disposed engine; no further timed run after the stop.',
    'Development StrictMode constructs two engines; pre-cleanup timings include compilation from both.',
    'A full final-source timing receipt is therefore still needed before integration; none is claimed here.',
    'Page-load timing uses the navigation performance clock; normalization/server timing variance is included.',
    'Conservative stop uses first visible feature frame (+214.6 ms), not a later first whole-part acknowledgement.',
    'Whole-part acknowledgement improves by 238.8 ms headless and grows by 108 ms headed; both are also reported.',
    'Warm-up finishes after the first part arrives in all final runs; queues correctly wait for readiness.',
    'The initial sky/background program is an ordinary pre-feature render, never a drawn warm carrier.',
    'Scene bindings, appearance and anchors are unchanged; same-key depth entries are retired with the engine.',
    'At 4x no renderer or tree optimization was attempted; detailed task profiles stay outside Git.',
  ],
  checks: [
    { command: 'pnpm studio:typecheck', exitCode: 0 },
    { command: 'pnpm studio:test', exitCode: 0, scene: 44, studio: 367, apiClient: 2, ui: 7 },
    { command: 'node docs/evidence/gf5/lv4/parity.mjs', exitCode: 0 },
    { command: 'node docs/evidence/gf5/lv4/results.mjs', exitCode: 0 },
    { command: 'git diff --check', exitCode: 0 },
    { command: 'Owned ports 5234/5235 freePort checks and browser tasklist checks', exitCode: 0 },
  ],
});
console.log(JSON.stringify({ counts: names.map((name) => [name, runs[name].sceneOrStudioLongTasks]),
  comparisons, parity: parity.pixels }));
