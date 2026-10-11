import { readFile } from 'node:fs/promises';
import { alignSamples, sampleStack, taskProfile } from './profile.mjs';
import { writeEvidence } from './evidence-json.mjs';

const directory = 'docs/evidence/gf5/lv3';
const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
const run = await load(`${directory}/lv3-before.json`);
const timings = await load(run.rawTimingFile);
const profile = await load(run.rawCpuFile);
const alignment = alignSamples(sampleStack(profile, timings), timings);
const tasks = timings.tasks.filter((task) => task.ms > 50 && task.at >= run.streamWindow.from
  && task.at <= run.streamWindow.to).map((task) => taskProfile(task, timings, alignment.samples));
const call = timings.calls.find((call) => call.name === 'setBase' && call.ms > 50);
const names = ['addBaseEntry', 'rebuildBaseLines', 'updateBaseDerived', 'apply', 'followArrivedContent'];
const samples = alignment.samples.filter((sample) => sample.at >= call.at && sample.at < call.at + call.ms);
const table = names.map((name) => ({
  function: name,
  inclusiveSampleMs: samples.filter((sample) => sample.stack.includes(name))
    .reduce((sum, sample) => sum + sample.ms, 0),
}));
await writeEvidence(`${directory}/step0.json`, {
  baselineGit: run.git,
  command: 'LV1_CAPTURE=lv3-before node docs/evidence/gf5/lv3/measure.mjs',
  harnessDeviation: 'LV1 rejects lv3-before and writes to LV1; copied unchanged algorithm with LV3 output routing.',
  sceneOrStudioLongTasks: tasks.filter((task) => task.sceneOrStudioAttributable).length,
  tasks,
  base: { partSequence: 2, arrivingFeatures: 96, setterMs: call.ms, table,
    limit: 'Inclusive 1 ms CPU samples; zero means unsampled, not zero cost. Rows may overlap.' },
  buildingPattern: [
    'setBuildings reconciles whole-list truth and queues only new ids in insertion order.',
    'renderFrame drains the queue once, with BUILDING_BUDGET_MS = 4.',
    'The drain checks elapsed time after each geometry addition.',
    'Pending pads are merged once per drained frame, then bounds and apply are updated.',
    'finishDraw records rendered ids; waitForDrawn waits for a frame, not merely arrival.',
  ],
  imagery: { width: 768, height: 768, bands: 4, projectedCSTypeGeoKey: 3857,
    mainThread: ['fetch (asynchronous)', 'inflate', 'readRasters', 'per-pixel RGBA loop', 'putImageData'],
    sceneImageType: 'HTMLCanvasElement', imageBitmapAccepted: false,
    decision: 'Transfer RGBA bytes; keep canvas and putImageData on main thread without changing scene types.' },
  lidarLongTask: tasks.some((task) => task.topInclusive.some(([name]) => name === 'lidarOverlay')),
  additionalCause: 'Three cold shader first-use tasks (onFirstUse) appear; not either named repair.',
  boundedComparison: {
    hypothesis: 'Cold software-renderer shader first-use is separate from base construction and TIFF decode.',
    baseline: 'Unchanged staging captured above, including assets.',
    attempt: 'Measure repaired code once under the same cold harness; no shader or material changes in this task.',
    success: 'No scene/Studio task >50 ms in stream.',
    stop: 'If shader first-use remains, report its profile without further out-of-scope repair.',
  },
});
console.log(JSON.stringify({ tasks, table }));
