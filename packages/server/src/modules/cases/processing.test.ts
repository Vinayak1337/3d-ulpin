import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Client } from 'pg';
import { AppError } from '../../infrastructure/errors';
import { DISPATCH_OPERATIONS, DispatchReservations, dispatchCost } from './dispatch-lanes';
import { dispatchTick } from './processing';

type Sent = { sql: string; values: unknown[] };
/** Runs `run` on a pool whose job selection holds `rows`; every other statement finds nothing. */
async function withPool<T>(rows: object[], run: (sent: Sent[]) => Promise<T>): Promise<T> {
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
  const previous = globals.ulpinPool;
  const sent: Sent[] = [];
  globals.ulpinPool = { query: async (sql: string, values: unknown[] = []) => {
    sent.push({ sql, values });
    return sql.includes('AS file_rank') ? { rows, rowCount: rows.length } : { rows: [], rowCount: 0 };
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
  const sent = await withPool([], async sent => {
    assert.equal(await dispatchTick(), 0);
    return sent;
  });
  // The selection, then the kept surfaces' part admission (SB1).
  assert.equal(sent.length, 2);
  assert.match(sent[1].sql, /FROM usp_intake_items i\s+WHERE i.plan_ref->>'version'=\$1/);
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

test('a 1 GiB raster part and a 954 MiB page image on a 1.5 GiB budget start one after the other', () => {
  const held = new DispatchReservations();
  assert.ok(held.admit('raster', 'raster-window', 1536));
  assert.equal(held.admit('page', 'intake-page-image', 1536), false);
  held.release('raster');
  assert.ok(held.admit('page', 'intake-page-image', 1536));
});

test('a job over the whole budget runs alone, and nothing joins it', () => {
  const held = new DispatchReservations();
  assert.ok(held.admit('probe', 'inspect', 512));
  assert.equal(held.admit('raster', 'raster-window', 512), false);
  held.release('probe');
  assert.ok(held.admit('raster', 'raster-window', 512));
  assert.equal(held.admit('probe', 'inspect', 512), false);
});

test('the gpu lane never runs two jobs at once', () => {
  const held = new DispatchReservations();
  assert.ok(held.admit('chip', 'spatial-inference', 1_000_000));
  assert.equal(held.admit('dataset', 'dataset-spatial-inference', 1_000_000), false);
  assert.ok(held.admit('table', 'chunk-mapping', 1_000_000));
  held.release('chip');
  assert.ok(held.admit('dataset', 'dataset-spatial-inference', 1_000_000));
});

test('an operation no lane names is other, never dropped', () => {
  assert.deepEqual(dispatchCost('mystery-operation'), { lane: 'other', mib: 512 });
  assert.ok(new DispatchReservations().admit('odd', 'mystery-operation', 1));
});

/** One dispatcher tick over `rows` with DISPATCH_MEMORY_MIB at `budget`, a fake packet-pdf runner, and no processor. */
async function tickWith(rows: object[], budget: string, packetPdf: (jobId: string) => Promise<void>): Promise<Sent[]> {
  const stated = process.env.DISPATCH_MEMORY_MIB;
  const fetching = globalThis.fetch;
  process.env.DISPATCH_MEMORY_MIB = budget;
  globalThis.fetch = async () => { throw new Error('no processor in this test'); };
  try {
    return await withPool(rows, async sent => {
      assert.equal(await dispatchTick({ packetPdf }), rows.length);
      return sent;
    });
  } finally {
    globalThis.fetch = fetching;
    if (stated === undefined) delete process.env.DISPATCH_MEMORY_MIB;
    else process.env.DISPATCH_MEMORY_MIB = stated;
  }
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const touched = (sent: Sent[], jobId: string) => sent.some(({ values }) => values[0] === jobId);
const pdf = { id: 'pdf-1', operation: 'packet-pdf', attempts: 0 };
const odd = { id: 'odd-1', operation: 'mystery-operation', attempts: 0, dispatched_at: null };

test('a single queued job starts on the first tick, even over the budget', async () => {
  const started: string[] = [];
  await tickWith([pdf], '1', async jobId => { started.push(jobId); });
  await settle();
  assert.deepEqual(started, ['pdf-1']);
  await tickWith([pdf], '1', async jobId => { started.push(jobId); });
  await settle();
  assert.deepEqual(started, ['pdf-1', 'pdf-1']);
});

test('a job that does not fit waits until the running job ends, and an unknown operation then runs', async () => {
  let finish!: () => void;
  const running = new Promise<void>(resolve => { finish = resolve; });
  const first = await tickWith([pdf, odd], '1000', () => running);
  assert.equal(touched(first, 'odd-1'), false);
  finish();
  await settle();
  const second = await tickWith([odd], '1000', async () => {});
  assert.ok(touched(second, 'odd-1'));
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
