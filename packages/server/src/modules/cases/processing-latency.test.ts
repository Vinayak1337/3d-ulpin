import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { dispatchFixtureSelection, type SelectionFixtureJob } from './dispatch-selection.fixture';
import { DISPATCH_LANES, dispatchCost } from './dispatch-lanes';
import { probeOriginal } from '../usp/ingestion/intake-probe';
import { readZipMember } from '../usp/ingestion/intake-zip';

// REH16's development ZIP, not evaluation truth. Durations are QW1 bAlone's measured job spans for this member.
// Layer stubs deliberately use the same measured spans, not invented per-layer performance measurements.
const archivePath = 'E:/BhuAayam-data/task-data/reh14/act2/zp1-geojson-kml-csv.zip';
const member = 'nyc-footprints-2100.geojson';
const layers = ['Placemarks', 'Highlighted Icon', 'Paths', 'Google Campus', 'Extruded Polygon',
  'Absolute and Relative'];
const spans = { start: 140, raw: 6170, profile: 6830, question: 13 };
const epoch = Date.UTC(2026, 9, 22);
const sourcePath = fileURLToPath(new URL('./processing.ts', import.meta.url));
type Row = SelectionFixtureJob & { status: string; itemCreated: number; stage: string };
type Event = { at: number; finish: () => void };
type Driver = { dispatchTick: () => Promise<number>; dispatchWakeVersion: () => number };
type Controls = { worker: (id: string) => Promise<void>; surface: () => Promise<void> };
const globals = globalThis as typeof globalThis & { ulpinPool?: unknown; lq1Replay?: Controls };
async function flush() {
  for (let turn = 0; turn < 30; turn++) {
    await Promise.resolve();
  }
}

async function realMix() {
  const zip = await readFile(archivePath);
  const read = async (start: number, end: number) => zip.subarray(start, end);
  const card = await probeOriginal(read, zip.length, 'zp1-geojson-kml-csv.zip');
  assert.deepEqual(card.members.map(row => row.name).sort(),
    ['kmlsamples.kml', member, 'nycha-addresses-prefix-128.csv'].sort());
  const geojson = await readZipMember(read, zip.length, member, 3 * 1024 ** 2);
  const features = JSON.parse(Buffer.from(geojson.bytes).toString('utf8')).features.length;
  assert.equal(features, 2100);
  const watch = await readFile('E:/BhuAayam-data/task-data/reh16/watch-zp-alone.jsonl', 'utf8');
  const observed = new Set(watch.trim().split(/\r?\n/).map(line => JSON.parse(line).name as string)
    .filter(name => name.endsWith('.geojson') && name !== member));
  assert.deepEqual([...observed].sort(), layers.map(name => `${name}.geojson`).sort());
  return { path: archivePath, sha256: createHash('sha256').update(zip).digest('hex'), bytes: zip.length,
    member, features, layers: observed.size, csv: 'nycha-addresses-prefix-128.csv',
    csvJob: 'none: Open the table was not pressed in REH16' };
}

/** Only dependency imports change: both versions execute their actual tick, reservations and worker finally paths. */
async function loadDriver(folder: string, baseline: boolean): Promise<Driver> {
  let source = baseline ? execFileSync('git', ['show', '70560f89:packages/server/src/modules/cases/processing.ts'],
    { encoding: 'utf8' }) : await readFile(sourcePath, 'utf8');
  const workers = new Set(['intake-large-worker', 'streaming-vector-worker', 'streamed-profile-worker']);
  source = source.replace(/import \{(\w+)\} from '(\.\.\/usp\/ingestion\/([^']+))';/g,
    (original, name: string, _specifier: string, module: string) => {
      if (workers.has(module)) return `const ${name} = (id: string) => globalThis.lq1Replay.worker(id);`;
      if (module === 'intake-surface') return `const ${name} = () => globalThis.lq1Replay.surface();`;
      return original;
    });
  // A fixed disk answer isolates scheduling; this mix reserves zero scratch in the unchanged real reservations.
  source = source.replace('dispatchScratchBudgetMiB,type DispatchJob', 'type DispatchJob');
  source = `const dispatchScratchBudgetMiB = async () => 8192;\n${source}`;
  source = source.replace(/(['"])(\.\.?\/[^'"]+)\1/g,
    (_match, _quote: string, specifier: string) => JSON.stringify(resolve(dirname(sourcePath), specifier)));
  const path = join(folder, baseline ? 'before.ts' : 'after.ts');
  await writeFile(path, source);
  return import(pathToFileURL(path).href) as Promise<Driver>;
}

function admissionPeaks(rows: Row[]) {
  const active = rows.filter(row => row.status === 'running').map(row => dispatchCost(row.operation));
  const memory = active.reduce((sum, cost) => sum + cost.mib, 0);
  const vector = active.filter(cost => cost.lane === 'vector').length;
  assert.ok(memory <= 1536, 'the unchanged memory budget bounds every start');
  assert.ok(vector <= DISPATCH_LANES.vector.concurrency, 'the unchanged vector cap bounds every start');
  return { memory, vector };
}

type ReplayWorkerState = { rows: Row[]; dispatched: { id: string; at: number }[]; questions: Map<string, number>;
  enqueue: (name: string, operation: string, stage: string, itemCreated: number, created?: number) => void;
  delay: (milliseconds: number) => Promise<void> };

async function replayWorker(state: ReplayWorkerState, id: string) {
  const row = state.rows.find(row => row.id === id)!;
  assert.equal(row.status, 'queued', 'a held job must never dispatch twice');
  row.status = 'running';
  const peaks = admissionPeaks(state.rows);
  state.dispatched.push({ id, at: Date.now() - epoch });
  await state.delay(spans[row.stage as keyof typeof spans]);
  row.status = 'succeeded';
  if (row.stage === 'start') {
    state.enqueue(row.source_id, 'streaming-vector', 'raw', row.itemCreated);
    state.enqueue(row.source_id, 'streamed-profile', 'profile', row.itemCreated);
  } else if (row.stage === 'question') state.questions.set(row.source_id, Date.now() - epoch);
  else if (state.rows.filter(other => other.source_id === row.source_id && ['raw', 'profile'].includes(other.stage))
    .every(other => other.status === 'succeeded')) {
    state.enqueue(row.source_id, 'intake-large', 'question', row.itemCreated);
  }
  return peaks;
}

function replayState() {
  const rows: Row[] = [], events: Event[] = [], dispatched: { id: string; at: number }[] = [];
  const questions = new Map<string, number>();
  let surfacePasses = 0, activeSurfaces = 0, peakSurfaces = 0, peakMemoryMiB = 0, peakVector = 0;
  const enqueue = (name: string, operation: string, stage: string, itemCreated: number, created = Date.now()) => {
    rows.push({ id: `${name}:${stage}`, source_id: name, case_id: 'rehearsal-zip-control', operation,
      created_at: new Date(created), status: 'queued', itemCreated, pinned: false, wave: 1, stage });
  };
  const delay = (milliseconds: number) => new Promise<void>(finish => {
    events.push({ at: Date.now() + milliseconds, finish });
  });
  const worker = async (id: string) => {
    const peaks = await replayWorker({ rows, enqueue, delay, dispatched, questions }, id);
    peakMemoryMiB = Math.max(peakMemoryMiB, peaks.memory);
    peakVector = Math.max(peakVector, peaks.vector);
  };
  const surface = async () => {
    surfacePasses++;
    activeSurfaces++;
    peakSurfaces = Math.max(peakSurfaces, activeSurfaces);
    // Cadence perturbation, not a claim that REH16 measured this helper: 18.25 s + polling is about 19 s.
    await delay(18_250);
    activeSurfaces--;
  };
  // Six newly created layers precede the older member's new state-key job in job FIFO.
  layers.forEach((name, index) => enqueue(name, 'intake-large', 'start', index + 1, epoch - 10 + index));
  enqueue(member, 'intake-large', 'start', 0, epoch);
  return { rows, events, dispatched, questions, enqueue, worker, surface,
    stats: () => ({ surfacePasses, peakSurfaces, peakMemoryMiB, peakVector }) };
}

type Replay = ReturnType<typeof replayState>;
function advance(state: Replay, to: number, tick: (milliseconds: number) => void) {
  tick(Math.max(0, to - Date.now()));
  const due = state.events.filter(event => event.at <= Date.now());
  for (const event of due) {
    state.events.splice(state.events.indexOf(event), 1);
    event.finish();
  }
}

async function tickToCompletion(driver: Driver, state: Replay, tick: (milliseconds: number) => void) {
  let done = false;
  const pending = driver.dispatchTick().then(() => { done = true; });
  await flush();
  while (!done) {
    assert.ok(state.events.length, 'no unmodelled asynchronous dependency may hang the replay');
    advance(state, Math.min(...state.events.map(event => event.at)), tick);
    await flush();
  }
  await pending;
}

async function runReplay(driver: Driver, tick: (milliseconds: number) => void) {
  const state = replayState();
  globals.lq1Replay = { worker: state.worker, surface: state.surface };
  globals.ulpinPool = { query: async (sql: string, values: unknown[]) => {
    const rows = sql.includes('AS file_rank') ? dispatchFixtureSelection(sql, values, state.rows) : [];
    return { rows, rowCount: rows.length };
  } };
  for (let turns = 0; turns < 2000 && state.questions.size < 7; turns++) {
    const wake = driver.dispatchWakeVersion();
    await tickToCompletion(driver, state, tick);
    await flush();
    if (wake !== driver.dispatchWakeVersion()) continue;
    const next = Math.min(Date.now() + 750, ...state.events.map(event => event.at));
    advance(state, next, tick);
    await flush();
  }
  assert.equal(state.questions.size, 7, 'all siblings must make progress within the bounded replay');
  const first = state.dispatched.find(row => row.id.startsWith(`${member}:`))!.at;
  const layout = state.questions.get(member)!;
  // Drain the single detached pass before its globals are restored; no background work leaks into other tests.
  while (state.events.length) {
    advance(state, Math.min(...state.events.map(event => event.at)), tick);
    await flush();
  }
  return { memberFirstDispatchMs: first, memberLayoutMs: layout,
    allLayoutsMs: Math.max(...state.questions.values()), ...state.stats(),
    dispatches: state.dispatched.length };
}

test('REH16 job-mix replay: an older member is dispatched before its six sibling layers without raising caps',
  { skip: !existsSync(archivePath) }, async t => {
    const input = await realMix();
    t.mock.timers.enable({ apis: ['Date'], now: epoch });
    const folder = await mkdtemp('E:/ulpin-tmp/lq1-replay-');
    const previousPool = globals.ulpinPool, previousControls = globals.lq1Replay;
    const budget = process.env.DISPATCH_MEMORY_MIB;
    process.env.DISPATCH_MEMORY_MIB = '1536';
    try {
      const before = await runReplay(await loadDriver(folder, true), ms => t.mock.timers.tick(ms));
      t.mock.timers.setTime(epoch);
      const after = await runReplay(await loadDriver(folder, false), ms => t.mock.timers.tick(ms));
      assert.equal(after.memberFirstDispatchMs, 0);
      assert.ok(before.memberFirstDispatchMs > after.memberFirstDispatchMs + 100_000);
      assert.ok(after.memberLayoutMs < 180_000);
      assert.equal(after.peakSurfaces, 1);
      assert.equal(before.dispatches, 28);
      assert.equal(after.dispatches, 28);
      console.log(JSON.stringify({ qualification: 'offline calibrated scheduling replay, not runtime latency',
        checkpoint: 'fan-out complete; sibling job FIFO precedes an older member item\'s follow-up',
        input, spansMs: spans, surfaceDelayMs: 18_250, memoryBudgetMiB: 1536, before, after }));
    } finally {
      globals.ulpinPool = previousPool;
      globals.lq1Replay = previousControls;
      if (budget === undefined) delete process.env.DISPATCH_MEMORY_MIB;
      else process.env.DISPATCH_MEMORY_MIB = budget;
      await rm(folder, { recursive: true, force: true });
    }
  });
