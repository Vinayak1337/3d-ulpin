import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from 'pg';
import { dispatchTick } from './processing';

/** The selection dispatchTick sends, captured from a pool that holds no jobs. */
async function selection(): Promise<string> {
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
  const previous = globals.ulpinPool;
  const sent: string[] = [];
  globals.ulpinPool = { query: async (sql: string) => {
    sent.push(sql);
    return { rows: [], rowCount: 0 };
  } };
  try {
    assert.equal(await dispatchTick(), 0);
  } finally {
    if (previous === undefined) delete globals.ulpinPool;
    else globals.ulpinPool = previous;
  }
  assert.equal(sent.length, 1);
  return sent[0];
}

test('the dispatcher takes the operations in turn, each one\'s oldest job first', async () => {
  const sql = (await selection()).replace(/\s+/g, ' ');
  assert.match(sql, /SELECT \*, row_number\(\) OVER \(PARTITION BY operation ORDER BY created_at\) AS operation_rank/);
  assert.match(sql, /FROM jobs WHERE status IN \('queued','running'\) AND operation NOT LIKE 'usp:%'/);
  assert.match(sql, /AND next_attempt_at<=now\(\)\) ranked ORDER BY operation_rank, created_at LIMIT 12$/);
});

test('a background worker\'s error is kept in the log, not discarded', async () => {
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
  const previous = globals.ulpinPool;
  const warned: string[] = [];
  const warn = console.warn;
  globals.ulpinPool = { query: async () => ({ rows: [{ id: 'pdf-1', operation: 'packet-pdf' }], rowCount: 1 }) };
  console.warn = (line: string) => { warned.push(line); };
  try {
    let finished!: () => void;
    const settled = new Promise<void>(resolve => { finished = resolve; });
    await dispatchTick({ packetPdf: async () => {
      setImmediate(finished);
      throw new Error('reader attempt 1 lost its lease');
    } });
    await settled;
  } finally {
    console.warn = warn;
    if (previous === undefined) delete globals.ulpinPool;
    else globals.ulpinPool = previous;
  }
  assert.deepEqual(warned,
    ['The packet-pdf worker dispatched from job pdf-1 ended with an error: reader attempt 1 lost its lease']);
});

// The selection's meaning needs PostgreSQL; a temporary jobs table shadows any real one for this session only.
const database = process.env.ULPIN_DISPATCH_TEST_DATABASE_URL;
test('an old backlog of one operation no longer hides another operation\'s job', { skip: !database }, async () => {
  const sql = await selection();
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    await client.query(`CREATE TEMPORARY TABLE jobs (id text PRIMARY KEY, operation text NOT NULL,
      status text NOT NULL, next_attempt_at timestamptz NOT NULL, created_at timestamptz NOT NULL)`);
    const add = (id: string, operation: string, minutes: number, status = 'queued', due = 0) => client.query(
      `INSERT INTO jobs VALUES($1,$2,$3,now()+make_interval(mins=>$5),now()-make_interval(mins=>$4))`,
      [id, operation, status, minutes, due]);
    for (let index = 0; index < 14; index++) await add(`run-${index}`, 'intake-run', 100 - index);
    await add('run-done', 'intake-run', 200, 'succeeded');
    await add('large-later', 'intake-large', 5);
    await add('large-oldest', 'intake-large', 10);
    await add('large-waiting', 'intake-large', 50, 'queued', 3);
    await add('usp-step', 'usp:packet', 300);
    await add('profile', 'streamed-profile', 20, 'running');
    const before = await client.query(`SELECT * FROM jobs WHERE status IN ('queued','running')
      AND operation NOT LIKE 'usp:%' AND next_attempt_at<=now() ORDER BY created_at LIMIT 12`);
    assert(!before.rows.some(job => job.operation === 'intake-large'));
    const after = await client.query(sql);
    assert.deepEqual(after.rows.map(job => job.id), ['run-0', 'profile', 'large-oldest', 'run-1', 'large-later',
      'run-2', 'run-3', 'run-4', 'run-5', 'run-6', 'run-7', 'run-8']);
  } finally {
    await client.end();
  }
});

test('an unguarded operation alone still gets twelve parallel jobs', { skip: !database }, async () => {
  const sql = await selection();
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    await client.query(`CREATE TEMPORARY TABLE jobs (id text PRIMARY KEY, operation text NOT NULL,
      status text NOT NULL, next_attempt_at timestamptz NOT NULL, created_at timestamptz NOT NULL)`);
    for (let index = 0; index < 15; index++) await client.query(
      `INSERT INTO jobs VALUES($1,'spatial-inference','queued',now(),now()-make_interval(mins=>$2))`,
      [`chip-${index}`, 100 - index]);
    const after = await client.query(sql);
    assert.deepEqual(after.rows.map(job => job.id), Array.from({ length: 12 }, (_, index) => `chip-${index}`));
  } finally {
    await client.end();
  }
});
