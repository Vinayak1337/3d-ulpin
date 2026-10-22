import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Client } from 'pg';
import { AppError } from '../../infrastructure/errors';
import { DISPATCH_HEAD_OF_LINE_MS, DISPATCH_OPERATIONS, DispatchReservations, dispatchCost } from './dispatch-lanes';
import { dispatchTick, dispatchWakeVersion, waitForDispatch } from './processing';

type Sent = { sql: string; values: unknown[] };
/** Runs `run` on a pool that answers each statement with `answer`'s rows. */
async function withPool<T>(answer: (sql: string, values: unknown[]) => object[] | Promise<object[]>,
  run: (sent: Sent[]) => Promise<T>): Promise<T> {
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
  const previous = globals.ulpinPool;
  const sent: Sent[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    sent.push({ sql, values });
    const rows = await answer(sql, values);
    return { rows, rowCount: rows.length };
  };
  globals.ulpinPool = { query, connect: async () => ({ query, release: () => {} }) };
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
  // Read occupied lanes before selection, then admit kept surfaces' parts (SB1).
  assert.equal(sent.length, 3);
  assert.match(sent[0].sql.replace(/\s+/g, ' '),
    /AND NOT operation=ANY\(\$1::text\[\]\) AND \(status='running' OR \(status='queued' AND dispatched_at IS NOT NULL/);
  const inProcess = sent[0].values[0] as string[];
  assert.ok(inProcess.includes('point-batch') && !inProcess.includes('spatial-inference'));
  assert.match(sent[2].sql, /FROM usp_intake_items i\s+WHERE i.plan_ref->>'version'=\$1/);
  return sent[1];
}

test("the dispatcher takes probes first, then each file's oldest job in its lane", async () => {
  const { sql, values } = await selection();
  const flat = sql.replace(/\s+/g, ' ');
  assert.match(flat,
    /PARTITION BY COALESCE\(lanes.lane,'other'\), COALESCE\(jobs.source_id::text,jobs.case_id::text\)/);
  assert.match(flat, /LEFT JOIN unnest\(\$1::text\[\],\$2::text\[\]\) AS lanes\(operation,lane\)/);
  assert.match(flat, /WHERE jobs.status IN \('queued','running'\) AND jobs.operation NOT LIKE 'usp:%'/);
  assert.match(flat, /NOT jobs.id::text=ANY\(\$3::text\[\]\) AND NOT jobs.operation=ANY\(\$4::text\[\]\)/);
  assert.match(flat, /NOT EXISTS \(SELECT 1 FROM usp_job_attempts a WHERE a.job_id=jobs.id/);
  assert.match(flat, /a.state='active' AND a.lease_until>now\(\)/);
  assert.match(flat, /jobs.dispatched_at IS NOT NULL AND NOT jobs.operation=ANY\(\$6::text\[\]\)/);
  assert.match(flat, /OR NOT COALESCE\(lanes.lane,'other'\)=ANY\(\$5::text\[\]\)/);
  assert.match(flat, /ranked ORDER BY lane='probe' DESC, file_rank, created_at LIMIT 12$/);
  const [operations, lanes, held, unavailable] = values as [string[], string[], string[], string[]];
  assert.deepEqual(held, []);
  assert.deepEqual(unavailable, []);
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

type Tick = { rows: object[]; budget: string; packetPdf?: (jobId: string) => Promise<void>; elsewhere?: object[];
  document?: (jobId: string) => Promise<void>; privateMvt?: (jobId: string) => Promise<void>;
  selected?: (selection: Sent) => void };
/** One dispatcher tick with fake jobs and DISPATCH_MEMORY_MIB at `budget`; returns the jobs sent to the processor. */
async function tickWith({ rows, budget, packetPdf = async () => {}, elsewhere = [],
  document, privateMvt, selected }: Tick): Promise<string[]> {
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
      : sql.includes('dispatched_at IS NOT NULL') ? elsewhere : [], async sent => {
      assert.equal(await dispatchTick({ packetPdf, document, privateMvt }), rows.length);
      selected?.(sent[1]);
      await Promise.resolve();
      await Promise.resolve();
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

test('a busy singleton and its queued followers leave the twelve-row ready window until it finishes', async () => {
  let finish!: () => void;
  const running = new Promise<void>(resolve => { finish = resolve; });
  try {
    await tickWith({ rows: [pdf], budget: '100000', packetPdf: () => running });
    await tickWith({ rows: [odd], budget: '100000', selected: ({ values }) => {
      assert.deepEqual(values[2], ['pdf-1']);
      assert.deepEqual(values[3], ['packet-pdf']);
    } });
  } finally {
    finish();
    await settle();
  }
  await tickWith({ rows: [], budget: '100000', selected: ({ values }) => {
    assert.deepEqual(values[2], []);
    assert.deepEqual(values[3], []);
  } });
});

for (const [operation, runner] of [['document-extraction', 'document'], ['private-mvt', 'privateMvt']] as const) {
  test(`${operation} keeps its reservation but does not delay the next dispatcher tick`, async () => {
    let finish!: () => void;
    const running = new Promise<void>(resolve => { finish = resolve; });
    const first = { ...job('background-1', operation), attempts: 0 };
    const second = { ...job('background-2', operation, 1), attempts: 0 };
    const started: string[] = [];
    let began!: () => void;
    const begun = new Promise<void>(resolve => { began = resolve; });
    const run = (id: string) => { started.push(id); began(); return running; };
    const tick = tickWith({ rows: [first], budget: '1000', [runner]: run });
    try {
      await begun;
      const returned = await Promise.race([tick.then(() => true), settle().then(() => false)]);
      assert.equal(returned, true, 'dispatch must return before the background job completes');
      assert.deepEqual(started, ['background-1']);
      assert.deepEqual(await tickWith({ rows: [second, odd], budget: '1000', [runner]: run,
        selected: ({ values }) => {
          assert.deepEqual(values[2], ['background-1']);
          assert.deepEqual(values[3], [], 'non-singleton work must retain lane admission');
        } }), []);
      assert.deepEqual(started, ['background-1'], 'the held memory still bounds admission');
    } finally {
      finish();
      await tick;
      await settle();
    }
    assert.deepEqual(await tickWith({ rows: [odd], budget: '1000' }), ['odd-1']);
  });
}

// The selection's meaning needs PostgreSQL; temporary tables shadow any real ones for this session only.
const database = process.env.ULPIN_DISPATCH_TEST_DATABASE_URL;
/** The ids the selection picks from the jobs `fill` adds to a temporary table. */
async function picked(fill: (add: (id: string, operation: string, source: string | null, minutes: number,
  status?: string, due?: number, dispatched?: boolean) => Promise<unknown>) => Promise<void>,
  attempts: { jobId: string; state: string; seconds: number }[] = [], fullLanes: string[] = []): Promise<string[]> {
  const { sql, values } = await selection();
  values[4] = fullLanes;
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    await client.query(`CREATE TEMPORARY TABLE jobs (id text PRIMARY KEY, operation text NOT NULL,
      status text NOT NULL, next_attempt_at timestamptz NOT NULL, created_at timestamptz NOT NULL, source_id text,
      case_id text NOT NULL, dispatched_at timestamptz)`);
    await client.query(`CREATE TEMPORARY TABLE usp_job_attempts
      (job_id text NOT NULL, state text NOT NULL, lease_until timestamptz NOT NULL)`);
    await fill((id, operation, source, minutes, status = 'queued', due = 0, dispatched = false) => client.query(
      `INSERT INTO jobs VALUES($1,$2,$3,now()+make_interval(mins=>$5),now()-make_interval(mins=>$4),$6,'case-1',
        CASE WHEN $7::boolean THEN now() ELSE NULL END)`,
      [id, operation, status, minutes, due, source, dispatched]));
    for (const attempt of attempts) await client.query(
      'INSERT INTO usp_job_attempts VALUES($1,$2,now()+make_interval(secs=>$3))',
      [attempt.jobId, attempt.state, attempt.seconds]);
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

test('ready selection skips busy workers and live leases, but expired and fenced jobs stay eligible',
  { skip: !database }, async () => {
    let finish!: () => void;
    const running = new Promise<void>(resolve => { finish = resolve; });
    try {
      await tickWith({ rows: [pdf], budget: '100000', packetPdf: () => running });
      const ids = await picked(async add => {
        for (let index = 0; index < 20; index++) await add(`pdf-${index}`, 'packet-pdf', `source-${index}`, 100);
        await add('live', 'streaming-vector', 'raw', 5, 'running');
        await add('expired', 'streaming-vector', 'raw-2', 4, 'running');
        await add('fenced', 'streaming-vector', 'raw-3', 3, 'running');
        await add('table', 'chunk-mapping', 'csv', 2);
      }, [
        { jobId: 'live', state: 'active', seconds: 180 },
        { jobId: 'expired', state: 'active', seconds: -1 },
        { jobId: 'fenced', state: 'fenced', seconds: 180 },
      ]);
      assert.deepEqual(ids, ['expired', 'fenced', 'table']);
    } finally {
      finish();
      await settle();
    }
  });

test('a lone file still offers twelve jobs when nothing else waits', { skip: !database }, async () => {
  const ids = await picked(async add => {
    for (let index = 0; index < 15; index++) await add(`chip-${index}`, 'spatial-inference', 'tif', 100 - index);
  });
  assert.deepEqual(ids, Array.from({ length: 12 }, (_, index) => `chip-${index}`));
});

test('full-lane followers cannot hide short jobs or block processor polls', { skip: !database }, async () => {
  const ids = await picked(async add => {
    for (let index = 0; index < 20; index++) await add(`vector-${index}`, 'kml-native', `source-${index}`, 100);
    await add('poll', 'projected-vector', 'sent', 101, 'running', 0, true);
    await add('short', 'intake-run', 'batch', 1);
  }, [], ['vector']);
  assert.deepEqual(ids, ['poll', 'short']);
});

test('two occupied vector slots leave room in selection for a short link job without increasing capacity', () => {
  const held = new DispatchReservations();
  const big = 100000;
  assert.ok(held.admit(job('raw', 'streaming-vector'), big, [], at(0)));
  assert.ok(held.admit(job('profile', 'streamed-profile'), big, [], at(0)));
  assert.deepEqual(held.unavailableLanes([]), ['vector']);
  assert.equal(held.admit(job('conductor', 'intake-large'), big, [], at(233)), false);
  assert.ok(held.admit(job('short', 'intake-run'), big, [], at(233)));
  held.release('raw');
  assert.deepEqual(held.unavailableLanes([]), []);
  assert.ok(held.admit(job('conductor', 'intake-large'), big, [], at(234)));
});

test('a full vector lane cannot spend all twelve ready rows ahead of a short document job on fakes', async () => {
  let finish!: () => void;
  const running = new Promise<void>(resolve => { finish = resolve; });
  const holders = [job('tile-1', 'private-mvt'), job('tile-2', 'private-mvt')];
  try {
    await tickWith({ rows: holders, budget: '100000', privateMvt: () => running });
    const ready = Array.from({ length: 20 }, (_, index) => job(`vector-${index}`, 'projected-vector'));
    ready.push(pdf);
    const started: string[] = [];
    // Fake only row selection, using the real tick's excluded-lane parameter before its LIMIT 12.
    await withPool((sql, values) => {
      if (!sql.includes('AS file_rank')) return [];
      const full = (values[4] ?? []) as string[];
      return ready.filter(row => !full.includes(dispatchCost(row.operation).lane)).slice(0, 12);
    }, async () => {
      assert.equal(await dispatchTick({ packetPdf: async id => { started.push(id); } }), 1);
      assert.deepEqual(started, ['pdf-1']);
      await settle();
    });
  } finally {
    finish();
    await settle();
  }
});

test('durable processor holdings close a lane once, even during its local transport reservation', () => {
  const held = new DispatchReservations();
  const first = job('first', 'projected-vector');
  assert.ok(held.admit(first, 100000, [], at(0)));
  assert.deepEqual(held.unavailableLanes([first]), []);
  assert.deepEqual(held.unavailableLanes([first, job('second', 'projected-vector')]), ['vector']);
});

async function withProcessorFetch(fetching: typeof fetch, run: () => Promise<void>) {
  const savedFetch = globalThis.fetch;
  const saved = ['GEO_URL', 'GEO_SERVICE_TOKEN'].map(name => [name, process.env[name]] as const);
  Object.assign(process.env, { GEO_URL: 'http://processor.invalid', GEO_SERVICE_TOKEN: 'protocol' });
  globalThis.fetch = fetching;
  try {
    await run();
  } finally {
    globalThis.fetch = savedFetch;
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

type StalledProcessor = { begun: Promise<void>; finish: () => void; calls: () => number };
async function withStalledProcessor(run: (processor: StalledProcessor) => Promise<void>) {
  let finish!: () => void;
  let calls = 0;
  const blocked = new Promise<Response>((_resolve, reject) => {
    finish = () => reject(new Error('fake transport stopped'));
  });
  let began!: () => void;
  const begun = new Promise<void>(resolve => { began = resolve; });
  const fetching = () => {
    calls++;
    began();
    return blocked;
  };
  await withProcessorFetch(fetching, () => run({ begun, finish, calls: () => calls }));
}

for (const dispatched of [false, true]) {
  test(`a stalled processor ${dispatched ? 'poll' : 'submission'} cannot delay a short job or start twice`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: at(0) });
    await withStalledProcessor(async processor => {
      const row = { ...odd, dispatched_at: dispatched ? new Date(at(0)) : null };
      let rows: object[] = [row];
      await withPool(sql => sql.includes('AS file_rank') ? rows : [], async sent => {
        const tick = dispatchTick();
        try {
          await processor.begun;
          assert.equal(await Promise.race([tick.then(() => true), settle().then(() => false)]), true);
          t.mock.timers.tick(233000);
          rows = [row, pdf];
          const started: string[] = [];
          await dispatchTick({ packetPdf: async id => { started.push(id); } });
          assert.deepEqual(started, ['pdf-1'], 'short work starts before the long transport returns');
          assert.equal(processor.calls(), 1, 'no duplicate submission or poll while in flight');
          const selections = sent.filter(statement => statement.sql.includes('AS file_rank'));
          assert.ok((selections[1].values[2] as string[]).includes(row.id));
        } finally {
          processor.finish();
          await tick;
          await settle();
        }
      });
    });
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function submissionSnapshotFixture() {
  const submission = deferred<Response>();
  const snapshot = deferred<object[]>();
  const snapshotBegan = deferred<void>();
  const row = { ...odd, created_at: new Date() };
  const state = { blockSnapshot: false, active: false, rows: [row] as object[] };
  const fetching: typeof fetch = async (_url, init) => init?.method === 'POST' ? submission.promise
    : new Response(JSON.stringify({ jobId: row.id, status: 'queued' }));
  const answer = (sql: string) => {
    if (sql.includes('AS file_rank')) return state.rows;
    if (sql.startsWith('UPDATE jobs SET status=$2')) state.active = true;
    if (!sql.includes('dispatched_at IS NOT NULL')) return [];
    if (!state.blockSnapshot) return state.active ? [row] : [];
    snapshotBegan.resolve();
    return snapshot.promise;
  };
  return { submission, snapshot, snapshotBegan, row, state, fetching, answer };
}

test('submission resources remain reserved across a stale durable snapshot, then transfer without a capacity gap',
  async () => {
    const fixture = submissionSnapshotFixture();
    const { state, row } = fixture;
    const budget = process.env.DISPATCH_MEMORY_MIB;
    process.env.DISPATCH_MEMORY_MIB = '1000';
    const started: string[] = [];
    const packetPdf = async (id: string) => { started.push(id); };
    try {
      await withProcessorFetch(fixture.fetching, () => withPool(fixture.answer, async sent => {
        await dispatchTick();
        state.blockSnapshot = true;
        state.rows = [pdf];
        const tick = dispatchTick({ packetPdf });
        await fixture.snapshotBegan.promise;
        fixture.submission.resolve(new Response(JSON.stringify({ jobId: row.id, status: 'queued' })));
        await settle();
        fixture.snapshot.resolve([]);
        await tick;
        const selected = sent.filter(statement => statement.sql.includes('AS file_rank')).at(-1)!;
        assert.ok((selected.values[2] as string[]).includes(row.id), 'old snapshot cannot release the local hold');
        assert.deepEqual(started, []);
        state.blockSnapshot = false;
        await dispatchTick({ packetPdf });
        assert.deepEqual(started, [], 'fresh durable holding still consumes memory');
        state.active = false;
        await dispatchTick({ packetPdf });
        assert.deepEqual(started, ['pdf-1']);
        await settle();
      }));
    } finally {
      if (budget === undefined) delete process.env.DISPATCH_MEMORY_MIB;
      else process.env.DISPATCH_MEMORY_MIB = budget;
    }
  });

test('completion wakes selection before the 750 ms poll and a completion during a tick is not lost', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: at(0) });
  let finish!: () => void;
  const running = new Promise<void>(resolve => { finish = resolve; });
  try {
    await tickWith({ rows: [pdf], budget: '100000', packetPdf: () => running });
    const version = dispatchWakeVersion();
    let woke = false;
    const waiting = waitForDispatch(version).then(() => { woke = true; });
    await Promise.resolve();
    assert.equal(woke, false);
    finish();
    await settle();
    await waiting;
    assert.equal(Date.now(), at(0), 'no poll interval elapsed');
    await waitForDispatch(version);
  } finally {
    finish();
    await settle();
  }
});

test('a nonterminal processor poll does not wake a busy loop', async () => {
  const row = { ...odd, created_at: new Date(), dispatched_at: new Date() };
  const reply = async () => new Response(JSON.stringify({ jobId: row.id, status: 'running' }));
  await withProcessorFetch(reply, async () => {
    const version = dispatchWakeVersion();
    await withPool(sql => sql.includes('AS file_rank') ? [row] : [], async () => {
      await dispatchTick();
      await settle();
    });
    assert.equal(dispatchWakeVersion(), version);
  });
});

test('idle dispatch still waits for the fallback poll', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let woke = false;
  const waiting = waitForDispatch(dispatchWakeVersion()).then(() => { woke = true; });
  t.mock.timers.tick(749);
  await Promise.resolve();
  assert.equal(woke, false);
  t.mock.timers.tick(1);
  await waiting;
});
