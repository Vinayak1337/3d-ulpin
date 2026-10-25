import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { Readable } from 'node:stream';
import type { StreamingVectorRecord } from '@ulpin/contracts/usp';
import { dispatchFixtureSelection, type SelectionFixtureJob } from './dispatch-selection.fixture';
import { DISPATCH_LANES, dispatchCost, dispatchHeapBudgetMiB } from './dispatch-lanes';
import { probeOriginal } from '../usp/ingestion/intake-probe';
import { readZipMember } from '../usp/ingestion/intake-zip';
import { loadProfileWorker, profileWorkerFixture } from '../usp/ingestion/streamed-profile-worker.fixture';
import { readStreamingFeatures, sourceRecord } from '../usp/ingestion/streaming-vector-reader';

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
const globals = globalThis as typeof globalThis & { ulpinPool?: unknown; lq1Replay?: Controls; s13cProfile?: unknown };
async function removeReplay(folder: string) {
  for (const name of await readdir(folder)) await rm(join(folder, name));
  await rmdir(folder);
}

async function withReplay(run: (folder: string) => Promise<void>) {
  const folder = await mkdtemp('E:/ulpin-tmp/s3-7-replay-');
  const previousPool = globals.ulpinPool, previousControls = globals.lq1Replay, previousProfile = globals.s13cProfile;
  const budget = process.env.DISPATCH_MEMORY_MIB;
  process.env.DISPATCH_MEMORY_MIB = '1536';
  try {
    await run(folder);
  } finally {
    globals.ulpinPool = previousPool;
    globals.lq1Replay = previousControls;
    globals.s13cProfile = previousProfile;
    if (budget === undefined) delete process.env.DISPATCH_MEMORY_MIB;
    else process.env.DISPATCH_MEMORY_MIB = budget;
    await removeReplay(folder);
  }
}

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
async function loadDriver(folder: string, baseline: boolean | 'lane'): Promise<Driver> {
  const revision = baseline === 'lane' ? 'a8c67f15' : '70560f89';
  let source = baseline ? execFileSync('git', ['show', `${revision}:packages/server/src/modules/cases/processing.ts`],
    { encoding: 'utf8' }) : await readFile(sourcePath, 'utf8');
  if (baseline === 'lane') {
    const lanes = execFileSync('git', ['show', `${revision}:packages/server/src/modules/cases/dispatch-lanes.ts`],
      { encoding: 'utf8' }).replace("'@ulpin/contracts/usp'",
      JSON.stringify(resolve(dirname(sourcePath), '../../../../contracts/src/usp/index.ts')));
    const path = join(folder, 'before-lanes.ts');
    await writeFile(path, lanes);
    source = source.replace("'./dispatch-lanes'", JSON.stringify(path));
  }
  const workers = new Set(['intake-large-worker', 'streaming-vector-worker', 'streamed-profile-worker',
    'chunk-mapping-worker', 'intake-native-derivative-worker']);
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

function admissionPeaks(rows: Row[], budgetMiB = 1536) {
  const active = rows.filter(row => row.status === 'running').map(row => dispatchCost(row.operation));
  const memory = active.reduce((sum, cost) => sum + cost.mib, 0);
  const vector = active.filter(cost => cost.lane === 'vector').length;
  const stream = active.filter(cost => cost.lane === 'stream').length;
  assert.ok(memory <= budgetMiB, 'the unchanged memory budget bounds every start');
  assert.ok(memory <= dispatchHeapBudgetMiB(), 'these in-process jobs also fit the unchanged heap budget');
  assert.ok(vector <= DISPATCH_LANES.vector.concurrency, 'the unchanged vector cap bounds every start');
  assert.ok(stream <= (DISPATCH_LANES.stream?.concurrency ?? 0), 'the stream cap bounds every start');
  return { memory, vector, stream };
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

function replayState(mixed = false) {
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
  if (mixed) {
    // Twelve scheduling stubs, not twelve acquired files: reuse the measured member's spans above.
    const operations = ['streaming-vector', 'streaming-vector', 'streamed-profile', 'intake-large',
      'chunk-mapping', 'streaming-vector', 'streamed-profile', 'intake-large', 'chunk-mapping',
      'streaming-vector', 'streamed-profile', 'intake-large'];
    const stages: Record<string, string> = { 'intake-large': 'start', 'streamed-profile': 'profile' };
    operations.forEach((operation, index) =>
      enqueue(`replay-${index}`, operation, stages[operation] ?? 'raw', index, epoch));
  } else {
    // Six newly created layers precede the older member's new state-key job in job FIFO.
    layers.forEach((name, index) => enqueue(name, 'intake-large', 'start', index + 1, epoch - 10 + index));
    enqueue(member, 'intake-large', 'start', 0, epoch);
  }
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

async function runReplay(driver: Driver, tick: (milliseconds: number) => void, mixed = false) {
  const state = replayState(mixed);
  const files = [...new Set(state.rows.map(row => row.source_id))];
  globals.lq1Replay = { worker: state.worker, surface: state.surface };
  globals.ulpinPool = { query: async (sql: string, values: unknown[]) => {
    const rows = sql.includes('AS file_rank') ? dispatchFixtureSelection(sql, values, state.rows) : [];
    return { rows, rowCount: rows.length };
  } };
  for (let turns = 0; turns < 2000 && state.questions.size < files.length; turns++) {
    const wake = driver.dispatchWakeVersion();
    await tickToCompletion(driver, state, tick);
    await flush();
    if (wake !== driver.dispatchWakeVersion()) continue;
    const next = Math.min(Date.now() + 750, ...state.events.map(event => event.at));
    advance(state, next, tick);
    await flush();
  }
  assert.equal(state.questions.size, files.length, 'all siblings must make progress within the bounded replay');
  const firstDispatches = files.map(file => state.dispatched.find(row => row.id.startsWith(`${file}:`))!.at);
  const first = firstDispatches[files.indexOf(member)];
  const layout = state.questions.get(member)!;
  // Drain the single detached pass before its globals are restored; no background work leaks into other tests.
  while (state.events.length) {
    advance(state, Math.min(...state.events.map(event => event.at)), tick);
    await flush();
  }
  return { memberFirstDispatchMs: first, memberLayoutMs: layout,
    allFirstDispatchMs: Math.max(...firstDispatches),
    totalFirstDispatchMs: firstDispatches.reduce((sum, ms) => sum + ms, 0),
    firstTickStreaming: state.dispatched.filter(event => event.at === 0
      && state.rows.find(row => row.id === event.id)?.operation === 'streaming-vector').length,
    allLayoutsMs: Math.max(...state.questions.values()), ...state.stats(),
    dispatches: state.dispatched.length };
}

test('twelve-file replay starts two streaming readers in one tick and lowers every-file dispatch time', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: epoch });
  await withReplay(async folder => {
    const before = await runReplay(await loadDriver(folder, 'lane'), ms => t.mock.timers.tick(ms), true);
    t.mock.timers.setTime(epoch);
    const after = await runReplay(await loadDriver(folder, false), ms => t.mock.timers.tick(ms), true);
    assert.equal(before.firstTickStreaming, 1);
    assert.equal(after.firstTickStreaming, 2);
    assert.ok(after.totalFirstDispatchMs < before.totalFirstDispatchMs);
    assert.ok(after.allFirstDispatchMs < before.allFirstDispatchMs);
    console.log(JSON.stringify({ qualification: '12 scheduling stubs, measured REH16 member spans; not runtime',
      baseline: 'a8c67f15', before, after }));
  });
});

test('all four reader sets retain lane and memory bounds across ticks and release only their own jobs', async () => {
  await withReplay(async folder => {
    const driver = await loadDriver(folder, false);
    for (const operation of ['streaming-vector', 'streamed-profile', 'chunk-mapping', 'intake-large']) {
      const cost = dispatchCost(operation), concurrency = DISPATCH_LANES[cost.lane].concurrency;
      for (const capacity of [concurrency, 1]) {
        process.env.DISPATCH_MEMORY_MIB = String(capacity === 1 ? cost.mib * 2 - 1 : cost.mib * concurrency);
        const started: string[] = [], finish = new Map<string, () => void>();
        const rows = Array.from({ length: concurrency + 1 }, (_, index) => ({ id: `${operation}-${index}`, operation,
          source_id: `file-${index}`, case_id: 'slot-control', created_at: new Date(epoch + index) }));
        globals.lq1Replay = { surface: async () => {}, worker: id => {
          started.push(id);
          return new Promise<void>(resolve => { finish.set(id, resolve); });
        } };
        globals.ulpinPool = { query: async (sql: string, values: unknown[]) => {
          const picked = sql.includes('AS file_rank') ? dispatchFixtureSelection(sql, values, rows) : [];
          return { rows: picked, rowCount: picked.length };
        } };
        try {
          await driver.dispatchTick();
          assert.equal(started.length, capacity, `${operation}: first tick respects lane/memory`);
          await driver.dispatchTick();
          assert.equal(started.length, capacity, 'held jobs never start twice; the next reader waits');
          rows.splice(0, capacity);
          finish.get(started[0])!();
          await flush();
          await driver.dispatchTick();
          assert.equal(started.length, capacity + 1, 'one completion frees exactly one slot');
        } finally {
          for (const release of finish.values()) release();
          await flush();
        }
      }
    }
  });
});

test('run 2 stream replay: a later ZIP starts within one tick while both whole-file readers run', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: epoch });
  await withReplay(async folder => {
    process.env.DISPATCH_MEMORY_MIB = '2048';
    const driver = await loadDriver(folder, false), state = replayState();
    state.rows.length = 0;
    const peaks = { memory: 0, heap: 0, vector: 0, stream: 0 };
    globals.lq1Replay = { surface: async () => {}, worker: async id => {
      const row = state.rows.find(row => row.id === id)!;
      assert.equal(row.status, 'queued');
      row.status = 'running';
      const active = admissionPeaks(state.rows, 2048);
      for (const key of ['memory', 'vector', 'stream'] as const) peaks[key] = Math.max(peaks[key], active[key]);
      peaks.heap = peaks.memory; // Every operation in this replay runs in this process.
      state.dispatched.push({ id, at: Date.now() - epoch });
      // Run 2 CN1 wall spans; 1 s parts are scheduling stubs, not measured conversion performance.
      const duration = ({ 'streaming-vector': 522_668, 'streamed-profile': 523_639 } as Record<string, number>)
        [row.operation] ?? 1000;
      await new Promise<void>(finish => { state.events.push({ at: Date.now() + duration, finish }); });
      row.status = 'succeeded';
    } };
    globals.ulpinPool = { query: async (sql: string, values: unknown[]) => {
      const rows = sql.includes('AS file_rank') ? dispatchFixtureSelection(sql, values, state.rows) : [];
      return { rows, rowCount: rows.length };
    } };
    state.enqueue('cn1', 'streaming-vector', 'raw', 0);
    state.enqueue('cn1', 'streamed-profile', 'profile', 0);
    await driver.dispatchTick();
    await flush();
    t.mock.timers.tick(750);
    for (let index = 0; index < 43; index++) state.enqueue('zip', 'intake-large', `part-${index}`, 750);
    state.enqueue('zip', 'intake-native-derivative', 'derivative', 750);
    for (let turns = 0; turns < 800 && state.rows.some(row => row.status !== 'succeeded'); turns++) {
      await tickToCompletion(driver, state, ms => t.mock.timers.tick(ms));
      const next = Math.min(Date.now() + 750, ...state.events.map(event => event.at));
      advance(state, next, ms => t.mock.timers.tick(ms));
      await flush();
    }
    const firstZipMs = state.dispatched.find(row => row.id.startsWith('zip:'))!.at;
    console.log(JSON.stringify({ replay: 'run 2 shape, offline only', firstZipMs, peaks,
      memoryBudgetMiB: 2048, heapBudgetMiB: dispatchHeapBudgetMiB() }));
    assert.ok(firstZipMs - 750 <= 750, 'the ZIP must start within one tick of creation, not after stream EOF');
    assert.equal(state.rows.filter(row => row.status === 'succeeded').length, 46);
    assert.deepEqual(peaks, { memory: 1865, heap: 1865, vector: 2, stream: 2 });
  });
});

test('a long raw reader cannot block a small ZIP member profile or its mapping',
  { skip: !existsSync(archivePath) }, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: epoch });
    await withReplay(async folder => {
      // Read the real development member into its usual bounded raw chunks; the long reader is a scheduling stub.
      const zip = await readFile(archivePath);
      const extracted = await readZipMember(async (start, end) => zip.subarray(start, end), zip.length,
        member, 3 * 1024 ** 2);
      const records: StreamingVectorRecord[] = [];
      await readStreamingFeatures(Readable.from([Buffer.from(extracted.bytes)]), 'feature-collection',
        async feature => { records.push(sourceRecord(feature)); });
      const large = profileWorkerFixture(), small = profileWorkerFixture(10);
      const workers = new Map([
        [large.input.jobId, await loadProfileWorker(folder, large)],
        [small.input.jobId, await loadProfileWorker(folder, small)],
      ]);
      for (let index = 0; index < records.length; index += 100) small.publish(records.slice(index, index + 100));
      small.raw.state = 'completed';
      small.raw.unknown_remainder = false;
      process.env.DISPATCH_MEMORY_MIB = '927'; // One raw (415) plus one profile (512), not an increased cap.
      const driver = await loadDriver(folder, false), state = replayState();
      state.rows.length = 0;
      let finishRaw!: () => void, profileRun: Promise<void> | undefined;
      let peakMemoryMiB = 0;
      const addProfile = (fixture: typeof small, itemCreated: number) => state.rows.push({
        id: fixture.input.jobId, source_id: fixture.input.sourceId, case_id: fixture.input.caseId,
        operation: 'streamed-profile', created_at: new Date(), status: 'queued', itemCreated, stage: 'profile',
      });
      const fixtures = [large, small];
      globals.lq1Replay = { surface: async () => {}, worker: async id => {
        const row = state.rows.find(row => row.id === id)!;
        row.status = 'running';
        peakMemoryMiB = Math.max(peakMemoryMiB, admissionPeaks(state.rows, 927).memory);
        state.dispatched.push({ id, at: Date.now() - epoch });
        const fixture = fixtures.find(value => value.input.jobId === id);
        if (fixture) {
          profileRun = workers.get(id)!.runStreamedProfileJob(id);
          await profileRun;
          row.status = fixture.job.status;
          if (fixture === small && row.status === 'succeeded')
            state.enqueue('zip', 'chunk-mapping', 'map', 750);
        } else if (row.stage === 'raw') {
          await new Promise<void>(resolve => { finishRaw = resolve; });
          row.status = 'succeeded';
        } else row.status = 'succeeded';
      } };
      const query = async (sql: string, values: any[] = []) => {
        if (sql.startsWith('SELECT id::text')) return { rows: [], rowCount: 0 };
        if (sql.includes('AS file_rank')) {
          const eligible = state.rows.filter(row => !fixtures.some(fixture => fixture.input.jobId === row.id
            && fixture.job.next_attempt_at.getTime() > Date.now()));
          const rows = dispatchFixtureSelection(sql, values, eligible);
          return { rows, rowCount: rows.length };
        }
        const fixture = fixtures.find(value => value.input.jobId === values[0]
          || value.input.rawJobId === values[0]) ?? large;
        return fixture.query(sql, values);
      };
      globals.ulpinPool = { query, connect: async () => ({ query, release() {} }) };
      try {
        state.enqueue('large', 'streaming-vector', 'raw', 0);
        addProfile(large, 0);
        await driver.dispatchTick();
        await profileRun;
        await flush();
        assert.ok(state.dispatched.some(row => row.id === large.input.jobId));
        assert.equal(large.attempts.length, 0, 'a waiting profile spends no claim');
        t.mock.timers.tick(750);
        addProfile(small, 750);
        await driver.dispatchTick();
        await profileRun;
        await flush();
        const admitted = state.dispatched.find(row => row.id === small.input.jobId)!;
        assert.equal(admitted.at, 750, 'the small profile gets the released slot and all 512 MiB within one tick');
        await driver.dispatchTick();
        await flush();
        assert.ok(state.dispatched.some(row => row.id === 'zip:map'));
        assert.equal(state.rows.find(row => row.id === 'large:raw')?.status, 'running');
        assert.equal(small.generations.get(small.raw.sealed_chunks)?.coverage, 'sealed');
        assert.ok(peakMemoryMiB <= 927 && peakMemoryMiB <= dispatchHeapBudgetMiB());
        console.log(JSON.stringify({ replay: 'offline long-reader shape, real ZIP member; mapping scheduling stub',
          member, features: records.length, profileAdmissionMs: admitted.at - 750,
          mappingStartsMs: state.dispatched.find(row => row.id === 'zip:map')!.at,
          peakMemoryMiB, peakHeapMiB: peakMemoryMiB, memoryBudgetMiB: 927 }));
      } finally {
        finishRaw?.();
        await flush();
      }
    });
  });

test('two large files finish all four interleaved readers, including profiles arriving before raw', async () => {
  await withReplay(async folder => {
    process.env.DISPATCH_MEMORY_MIB = '4096';
    const driver = await loadDriver(folder, false), state = replayState();
    state.rows.length = 0;
    const finish = new Map<string, () => void>(), done = new Set<string>();
    const raw = new Map(['a', 'b'].map(file => [file, new Promise<void>(resolve => { finish.set(file, resolve); })]));
    globals.lq1Replay = { surface: async () => {}, worker: async id => {
      const row = state.rows.find(row => row.id === id)!;
      row.status = 'running';
      admissionPeaks(state.rows, 4096);
      // Profiles wait for raw EOF; the raw reader never waits for profile consumption.
      await raw.get(row.source_id);
      row.status = 'succeeded';
      done.add(id);
    } };
    globals.ulpinPool = { query: async (sql: string, values: unknown[]) => {
      const rows = sql.includes('AS file_rank') ? dispatchFixtureSelection(sql, values, state.rows) : [];
      return { rows, rowCount: rows.length };
    } };
    try {
      for (const [file, operation] of [['a', 'streamed-profile'], ['b', 'streamed-profile'],
        ['a', 'streaming-vector'], ['b', 'streaming-vector']]) {
        state.enqueue(file, operation, operation, 0);
        await driver.dispatchTick();
        await flush();
        assert.equal(state.rows.filter(row => row.status === 'running').length, state.rows.length);
      }
    } finally {
      for (const release of finish.values()) release();
      await flush();
    }
    assert.equal(done.size, 4, 'neither pair waits on its own stream slots');
    assert.equal(state.rows.filter(row => row.status === 'succeeded').length, 4);
  });
});

test('REH16 job-mix replay: an older member is dispatched before its six sibling layers without raising caps',
  { skip: !existsSync(archivePath) }, async t => {
    const input = await realMix();
    t.mock.timers.enable({ apis: ['Date'], now: epoch });
    await withReplay(async folder => {
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
    });
  });
