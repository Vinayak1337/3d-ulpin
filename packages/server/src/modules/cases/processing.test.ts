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

test('the dispatcher selects each operation\'s oldest job before ordering by age', async () => {
  const sql = (await selection()).replace(/\s+/g, ' ');
  assert.match(sql, /SELECT DISTINCT ON \(operation\) \* FROM jobs WHERE status IN \('queued','running'\)/);
  assert.match(sql, /operation NOT LIKE 'usp:%' AND next_attempt_at<=now\(\) ORDER BY operation,created_at\) oldest/);
  assert.match(sql, /ORDER BY created_at LIMIT 12$/);
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
    assert.deepEqual(after.rows.map(job => job.id), ['run-0', 'profile', 'large-oldest']);
  } finally {
    await client.end();
  }
});
