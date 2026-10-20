import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Client } from 'pg';
import { AppError } from '../../infrastructure/errors';
import { DISPATCH_HEAD_OF_LINE_MS, DISPATCH_OPERATIONS, DispatchReservations, dispatchCost } from './dispatch-lanes';
import { dispatchTick } from './processing';

type Sent = { sql: string; values: unknown[] };
/** Runs `run` on a pool that answers each statement with `answer`'s rows. */
async function withPool<T>(answer: (sql: string) => object[], run: (sent: Sent[]) => Promise<T>): Promise<T> {
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
  const previous = globals.ulpinPool;
  const sent: Sent[] = [];
  globals.ulpinPool = { query: async (sql: string, values: unknown[] = []) => {
    sent.push({ sql, values });
    const rows = answer(sql);
    return { rows, rowCount: rows.length };
  } };
  try {
    return await run(sent);
  } finally {
    if (previous === undefined) delete globals.ulpinPool;
    else globals.ulpinPool = previous;
  }
}

/** The selection dispatchTick sends and its lane columns, captured from a pool that holds no jobs. */
async function selection(): Promise<Sent> {
  const sent = await withPool(() => [], async sent => {
    assert.equal(await dispatchTick(), 0);
    return sent;
  });
  // The selection, the jobs the processor holds, then the kept surfaces' part admission (SB1).
  assert.equal(sent.length, 3);
  assert.match(sent[1].sql.replace(/\s+/g, ' '),
    /AND NOT operation=ANY\(\$1::text\[\]\) AND \(status='running' OR \(status='queued' AND dispatched_at IS NOT NULL/);
  const inProcess = sent[1].values[0] as string[];
  assert.ok(inProcess.includes('point-batch') && !inProcess.includes('spatial-inference'));
  assert.match(sent[2].sql, /FROM usp_intake_items i\s+WHERE i.plan_ref->>'version'=\$1/);
  return sent[0];
}

test("the dispatcher takes probes first, then each file's oldest job in its lane", async () => {
  const { sql, values } = await selection();
  const flat = sql.replace(/\s+/g, ' ');
  assert.match(flat,
    /PARTITION BY COALESCE\(lanes.lane,'other'\), COALESCE\(jobs.source_id::text,jobs.case_id::text\)/);
  assert.match(flat, /LEFT JOIN unnest\(\$1::text\[\],\$2::text\[\]\) AS lanes\(operation,lane\)/);
  assert.match(flat, /WHERE jobs.status IN \('queued','running'\) AND jobs.operation NOT LIKE 'usp:%'/);
  assert.match(flat, /ranked ORDER BY lane='probe' DESC, file_rank, created_at LIMIT 12$/);
  const [operations, lanes] = values as [string[], string[]];
  assert.equal(lanes[operations.indexOf('point-batch')], 'point');
  assert.equal(lanes[operations.indexOf('spatial-inference')], 'gpu');
});

test('every operation the dispatcher names has a lane', () => {
  const source = readFileSync(new URL('./processing.ts', import.meta.url), 'utf8');
  const named = new Set([...source.matchAll(/operation\s*===?\s*["']([a-z0-9-]+)["']/g)].map(match => match[1]));
  assert.ok(named.size > 20);
  for (const operation of named) assert.ok(Object.hasOwn(DISPATCH_OPERATIONS, operation), operation);
});

/** The lines dispatchTick warns when its packet-pdf worker throws `thrown`. */
async function warnedFor(thrown: unknown): Promise<string[]> {
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
  const previous = globals.ulpinPool;
  const warned: string[] = [];
  const warn = console.warn;
  // Only the job selection holds the packet; the surface admission finds no kept part.
  globals.ulpinPool = { query: async (sql: string) => sql.includes('FROM jobs')
    ? { rows: [{ id: 'pdf-1', operation: 'packet-pdf' }], rowCount: 1 } : { rows: [], rowCount: 0 } };
  console.warn = (...line: unknown[]) => { warned.push(line.map(String).join(' ')); };
  try {
    let finished!: () => void;
    const settled = new Promise<void>(resolve => { finished = resolve; });
    assert.equal(await dispatchTick({ packetPdf: async () => {
      setImmediate(finished);
      throw thrown;
    } }), 1);
    await settled;
  } finally {
    console.warn = warn;
    if (previous === undefined) delete globals.ulpinPool;
    else globals.ulpinPool = previous;
  }
  assert.ok(warned.every(line => !line.includes('SECRET_MARKER_TEXT')));
  return warned;
}

test('a background worker\'s error is kept in the log by its code, never its message', async () => {
  const line = (code: string) => `The packet-pdf worker dispatched from job pdf-1 ended with error code ${code}`;
  assert.deepEqual(await warnedFor(new AppError(409, 'STALE_REVISION', 'SECRET_MARKER_TEXT')),
    [line('STALE_REVISION')]);
  assert.deepEqual(await warnedFor(Object.assign(new Error('SECRET_MARKER_TEXT'), { code: '23514' })), [line('23514')]);
  assert.deepEqual(await warnedFor(new Error('SECRET_MARKER_TEXT in /data/plan.pdf')), [line('Error')]);
  assert.deepEqual(await warnedFor('SECRET_MARKER_TEXT'), [line('unknown')]);
});

/** A job created `seconds` after a fixed start, as the tick reads it. */
const job = (id: string, operation: string, seconds = 0) =>
  ({ id, operation, created_at: new Date(Date.UTC(2026, 9, 21) + seconds * 1000) });
const at = (seconds: number) => Date.UTC(2026, 9, 22) + seconds * 1000;

test('a 1 GiB raster part and a 954 MiB page image on a 1.5 GiB budget start one after the other', () => {
  const held = new DispatchReservations();
  assert.ok(held.admit(job('raster', 'raster-window'), 1536, [], at(0)));
  assert.equal(held.admit(job('page', 'intake-page-image'), 1536, [], at(0)), false);
  held.release('raster');
  assert.ok(held.admit(job('page', 'intake-page-image'), 1536, [], at(1)));
});

test('a job over the whole budget runs alone, and nothing joins it', () => {
  const held = new DispatchReservations();
  assert.ok(held.admit(job('probe', 'inspect'), 512, [], at(0)));
  assert.equal(held.admit(job('raster', 'raster-window'), 512, [], at(0)), false);
  held.release('probe');
  assert.ok(held.admit(job('raster', 'raster-window'), 512, [], at(1)));
  assert.equal(held.admit(job('probe', 'inspect'), 512, [], at(1)), false);
});

test('the gpu lane never runs two jobs at once, counting a job the processor holds', () => {
  const held = new DispatchReservations();
  const big = 1_000_000;
  assert.ok(held.admit(job('chip', 'spatial-inference'), big, [], at(0)));
  assert.equal(held.admit(job('dataset', 'dataset-spatial-inference'), big, [], at(0)), false);
  assert.ok(held.admit(job('table', 'chunk-mapping'), big, [], at(0)));
  held.release('chip');
  const processor = [job('elsewhere', 'spatial-inference')];
  assert.equal(held.admit(job('dataset', 'dataset-spatial-inference'), big, processor, at(1)), false);
  assert.ok(held.admit(job('dataset', 'dataset-spatial-inference'), big, [], at(2)));
  // A job both held here and read from the processor's rows is counted once.
  held.release('table');
  assert.ok(held.admit(job('raster', 'raster-window'), 2000, [job('dataset', 'dataset-spatial-inference')], at(3)));
});

test('an operation no lane names is other, never dropped', () => {
  assert.deepEqual(dispatchCost('mystery-operation'), { lane: 'other', mib: 512 });
  assert.ok(new DispatchReservations().admit(job('odd', 'mystery-operation'), 1, [], at(0)));
});

test('a big job refused for memory stops newer jobs after the head-of-line wait, then starts when the rest drains',
  () => {
    const held = new DispatchReservations();
    const budget = 1100;
    const wait = DISPATCH_HEAD_OF_LINE_MS / 1000;
    assert.ok(held.admit(job('small-1', 'kml-native', 0), budget, [], at(0)));
    assert.equal(held.admit(job('big', 'raster-window', 10), budget, [], at(100)), false);
    assert.ok(held.admit(job('small-2', 'geoparquet-native', 20), budget, [], at(100)));
    held.release('small-1');
    assert.ok(held.admit(job('small-3', 'kml-native', 150), budget, [], at(100 + wait)));
    assert.equal(held.admit(job('big', 'raster-window', 10), budget, [], at(100 + wait)), false);
    assert.equal(held.admit(job('small-4', 'geoparquet-native', 200), budget, [], at(101 + wait)), false);
    assert.ok(held.admit(job('probe', 'inspect', 210), budget, [], at(101 + wait)));
    assert.equal(held.admit(job('big', 'raster-window', 10), budget, [], at(102 + wait)), false);
    for (const id of ['small-2', 'small-3', 'probe']) held.release(id);
    assert.equal(held.admit(job('small-4', 'geoparquet-native', 200), budget, [], at(103 + wait)), false);
    assert.ok(held.admit(job('big', 'raster-window', 10), budget, [], at(103 + wait)));
    assert.deepEqual(held.refusedJobIds(), []);
    held.release('big');
    assert.ok(held.admit(job('small-4', 'geoparquet-native', 200), budget, [], at(104 + wait)));
  });

test('a refused job that no longer waits blocks nothing', () => {
  const held = new DispatchReservations();
  assert.ok(held.admit(job('small-1', 'kml-native', 0), 1100, [], at(0)));
  assert.equal(held.admit(job('big', 'raster-window', 10), 1100, [], at(0)), false);
  held.keepRefused([]);
  assert.ok(held.admit(job('small-2', 'geoparquet-native', 20), 1100, [], at(1000)));
});

type Tick = { rows: object[]; budget: string; packetPdf?: (jobId: string) => Promise<void>; elsewhere?: object[] };
/** One dispatcher tick with fake jobs and DISPATCH_MEMORY_MIB at `budget`; returns the jobs sent to the processor. */
async function tickWith({ rows, budget, packetPdf = async () => {}, elsewhere = [] }: Tick): Promise<string[]> {
  const saved = ['DISPATCH_MEMORY_MIB', 'GEO_URL', 'GEO_SERVICE_TOKEN'].map(name => [name, process.env[name]] as const);
  const fetching = globalThis.fetch;
  const sentToProcessor: string[] = [];
  Object.assign(process.env, { DISPATCH_MEMORY_MIB: budget, GEO_URL: 'http://processor.test',
    GEO_SERVICE_TOKEN: 'test-only' });
  globalThis.fetch = async (_url, init) => {
    sentToProcessor.push(JSON.parse(String(init?.body)).jobId);
    throw new Error('no processor in this test');
  };
  try {
    await withPool(sql => sql.includes('AS file_rank') ? rows
      : sql.includes('dispatched_at IS NOT NULL') ? elsewhere : [], async () => {
      assert.equal(await dispatchTick({ packetPdf }), rows.length);
    });
    return sentToProcessor;
  } finally {
    globalThis.fetch = fetching;
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const pdf = { ...job('pdf-1', 'packet-pdf'), attempts: 0 };
const odd = { ...job('odd-1', 'mystery-operation', 5), attempts: 0, dispatched_at: null };

test('a single queued job starts on the first tick, even over the budget', async () => {
  const started: string[] = [];
  const packetPdf = async (jobId: string) => { started.push(jobId); };
  await tickWith({ rows: [pdf], budget: '1', packetPdf });
  await settle();
  assert.deepEqual(started, ['pdf-1']);
  await tickWith({ rows: [pdf], budget: '1', packetPdf });
  await settle();
  assert.deepEqual(started, ['pdf-1', 'pdf-1']);
});

test('a job that does not fit waits until the running job ends, and an unknown operation then runs', async () => {
  let finish!: () => void;
  const running = new Promise<void>(resolve => { finish = resolve; });
  assert.deepEqual(await tickWith({ rows: [pdf, odd], budget: '1000', packetPdf: () => running }), []);
  finish();
  await settle();
  assert.deepEqual(await tickWith({ rows: [odd], budget: '1000' }), ['odd-1']);
});

test('an inference job the processor runs keeps a second one from being sent until it has succeeded', async () => {
  const second = { ...job('chip-2', 'dataset-spatial-inference', 5), attempts: 0, dispatched_at: null };
  const elsewhere = [job('chip-1', 'spatial-inference')];
  assert.deepEqual(await tickWith({ rows: [second], budget: '100000', elsewhere }), []);
  assert.deepEqual(await tickWith({ rows: [second], budget: '100000' }), ['chip-2']);
});

// The selection's meaning needs PostgreSQL; a temporary jobs table shadows any real one for this session only.
const database = process.env.ULPIN_DISPATCH_TEST_DATABASE_URL;
/** The ids the selection picks from the jobs `fill` adds to a temporary table. */
async function picked(fill: (add: (id: string, operation: string, source: string | null, minutes: number,
  status?: string, due?: number) => Promise<unknown>) => Promise<void>): Promise<string[]> {
  const { sql, values } = await selection();
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    await client.query(`CREATE TEMPORARY TABLE jobs (id text PRIMARY KEY, operation text NOT NULL,
      status text NOT NULL, next_attempt_at timestamptz NOT NULL, created_at timestamptz NOT NULL, source_id text,
      case_id text NOT NULL)`);
    await fill((id, operation, source, minutes, status = 'queued', due = 0) => client.query(
      `INSERT INTO jobs VALUES($1,$2,$3,now()+make_interval(mins=>$5),now()-make_interval(mins=>$4),$6,'case-1')`,
      [id, operation, status, minutes, due, source]));
    return (await client.query(sql, values)).rows.map(job => job.id);
  } finally {
    await client.end();
  }
}

test('211 parts of one point cloud cannot hold back a table, and a probe goes first', { skip: !database }, async () => {
  const ids = await picked(async add => {
    for (let index = 0; index < 211; index++) await add(`laz-${index}`, 'point-batch', 'laz', 300 - index);
    await add('other-0', 'point-batch', 'laz-2', 50);
    await add('other-1', 'point-batch', 'laz-2', 40);
    await add('vector', 'streaming-vector', 'laz', 400);
    await add('odd', 'mystery-operation', null, 30);
    await add('table', 'chunk-mapping', 'csv', 1);
    await add('probe', 'inspect', 'new', 0);
    await add('done', 'point-batch', 'laz', 500, 'succeeded');
    await add('later', 'point-batch', 'laz', 500, 'queued', 3);
    await add('usp-step', 'usp:packet', 'laz', 500);
  });
  assert.deepEqual(ids, ['probe', 'vector', 'laz-0', 'other-0', 'odd', 'table', 'laz-1', 'other-1', 'laz-2', 'laz-3',
    'laz-4', 'laz-5']);
});

test('a lone file still offers twelve jobs when nothing else waits', { skip: !database }, async () => {
  const ids = await picked(async add => {
    for (let index = 0; index < 15; index++) await add(`chip-${index}`, 'spatial-inference', 'tif', 100 - index);
  });
  assert.deepEqual(ids, Array.from({ length: 12 }, (_, index) => `chip-${index}`));
});
