import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { Pool } from 'pg';
import ts from 'typescript';

const root = 'packages/server/src/modules/';
const source = (file: string) => process.env.S13U_BASE
  ? execFileSync('git', ['show', `${process.env.S13U_BASE}:${root}${file}.ts`], { encoding: 'utf8' })
  : readFileSync(`${root}${file}.ts`, 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const compile = (body: string) => ts.transpileModule(body, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replaceAll('export ', '');
type Db = { query: (sql: string, values?: unknown[]) => Promise<unknown> };

/** Execute each production transaction's case prefix, before its item/job/target writes. */
function prefix(kind: 'draft' | 'run') {
  const file = source(`usp/ingestion/${kind === 'draft' ? 'intake-draft' : 'intake-run-worker'}`);
  const start = file.indexOf(kind === 'draft' ? '  await lockSourceCaseDestinationTx(client, input.caseId);'
    : '    if (repeatable) await client.query');
  const end = file.indexOf(kind === 'draft' ? '  const { source, binding }' : '    assertRunBinding', start);
  assert.ok(start >= 0 && end > start);
  const helper = source('cases/source-case-lock');
  const helperStart = helper.indexOf('export async function lockCaseEnqueueTx');
  const definition = helperStart < 0 ? '' : helper.slice(helperStart);
  return new AsyncFunction('client', 'input', 'run', 'repeatable', 'lockCase',
    'lockSourceCaseDestinationTx', 'intakeCaseTx', compile(definition + '\n' + file.slice(start, end)));
}
async function pin(kind: 'draft' | 'run', client: Db, caseId: string) {
  const intakeCase = (db: Db, id: string, lock = false) => db.query(
    `SELECT id,revision FROM cases WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
  // The other transaction is workspace(), which does not take the advisory destination gate.
  await prefix(kind)(client, { caseId }, { input: { caseId } }, false, false, async () => {}, intakeCase);
}
const insert = (table: string) => table === 'jobs'
  ? "INSERT INTO jobs(id,case_id,operation) VALUES($1,$2,'intake-large') ON CONFLICT (id) DO NOTHING"
  : 'INSERT INTO usp_outbox_streams(stream_id) VALUES($1) ON CONFLICT DO NOTHING';

/** Two-client row/unique-key model only; SQLSTATE proof belongs to the opt-in PostgreSQL tests below. */
async function model(kind: 'draft' | 'run', table: string) {
  const held = new Map<string, Map<string, boolean>>();
  const waits = new Map<string, { on: string; resource: string; write: boolean; done: () => void }>();
  let blocked!: () => void;
  const barrier = new Promise<void>(resolve => { blocked = resolve; });
  const take = async (who: string, resource: string, write: boolean) => {
    const other = [...(held.get(resource) ?? [])].find(([owner, exclusive]) => owner !== who && (write || exclusive));
    if (other) {
      if (waits.get(other[0])?.on === who) throw new Error('case/unique-key lock-order cycle');
      await new Promise<void>(done => {
        waits.set(who, { on: other[0], resource, write, done });
        blocked();
      });
    }
    if (!held.has(resource)) held.set(resource, new Map());
    held.get(resource)!.set(who, write);
  };
  const release = (who: string) => {
    for (const owners of held.values()) owners.delete(who);
    for (const [owner, wait] of waits) if (wait.on === who) { waits.delete(owner); wait.done(); }
  };
  const client = (who: string): Db => ({ query: async sql => {
    if (sql.includes('FROM cases') && sql.includes('FOR ')) await take(who, 'case', sql.includes('UPDATE'));
    if (sql.startsWith('INSERT')) {
      const resource = sql.includes('INTO jobs') ? 'job' : 'stream';
      await take(who, resource, true);
      if (resource === 'job') await take(who, 'case', false); // jobs.case_id foreign key
    }
  } });
  await client('workspace').query('SELECT id FROM cases FOR UPDATE');
  const writer = (async () => {
    try {
      await pin(kind, client('writer'), randomUUID());
      await client('writer').query(insert(table));
      if (table !== 'jobs') await client('writer').query(insert('jobs'));
    } finally { release('writer'); }
  })();
  await barrier;
  const workspace = (async () => {
    try { await client('workspace').query(insert(table)); } finally { release('workspace'); }
  })();
  const outcomes = await Promise.allSettled([writer, workspace]);
  assert.deepEqual(outcomes.map(row => row.status === 'rejected' ? String(row.reason) : 'ok'), ['ok', 'ok']);
}

test('the early case lock is KEY SHARE, not a reader-blocking UPDATE or a wider SHARE', async () => {
  const helper = source('cases/source-case-lock');
  const start = helper.indexOf('export async function lockCaseEnqueueTx');
  assert.ok(start >= 0);
  const take = new AsyncFunction('client',
    compile(helper.slice(start)) + '\nreturn lockCaseEnqueueTx(client, "case");');
  const queries: string[] = [];
  await take({ query: async (sql: string) => { queries.push(sql); } });
  assert.deepEqual(queries, ['SELECT id FROM cases WHERE id=$1 FOR KEY SHARE']);
});

for (const kind of ['draft', 'run'] as const) for (const table of ['jobs', 'usp_outbox_streams']) {
  test(`${kind}: case lock precedes ${table} and its later foreign-key wait (model)`, () => model(kind, table));
  test(`${kind}: no 40P01 between case-first workspace and ${table} (PostgreSQL)`, {
    skip: !process.env.S13U_TEST_DATABASE_URL,
  }, async () => {
    const url = new URL(process.env.S13U_TEST_DATABASE_URL!);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '25432');
    assert.match(url.pathname, /^\/ulpin_(?:t001|usptest)_/);
    const pool = new Pool({ connectionString: url.href, max: 2, connectionTimeoutMillis: 2000 });
    const a = await pool.connect(), b = await pool.connect();
    const schema = `test_enqueue_${randomUUID().replaceAll('-', '')}`;
    const caseId = randomUUID(), jobId = randomUUID(); // test_only lock rows, not survey inputs
    try {
      await a.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`);
      await a.query(`CREATE TABLE cases(id uuid PRIMARY KEY,revision int DEFAULT 0);
        CREATE TABLE jobs(id uuid PRIMARY KEY,case_id uuid REFERENCES cases(id),operation text);
        CREATE TABLE usp_outbox_streams(stream_id uuid PRIMARY KEY)`);
      await a.query('INSERT INTO cases(id) VALUES($1)', [caseId]);
      await b.query(`SET search_path TO ${schema}`);
      await a.query("BEGIN; SET LOCAL statement_timeout='8000ms'");
      await b.query("BEGIN; SET LOCAL statement_timeout='8000ms'");
      await a.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [caseId]);
      const pid = (await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      const writer = (async () => {
        try {
          await pin(kind, b, caseId);
          await b.query(insert(table), table === 'jobs' ? [jobId, caseId] : [jobId]);
          if (table !== 'jobs') await b.query(insert('jobs'), [jobId, caseId]);
          await b.query('COMMIT');
        } catch (error) { await b.query('ROLLBACK'); throw error; }
      })();
      // Barrier is the actual wait-for edge, not a timing guess. Only these two backends participate.
      let waiting = false;
      for (let poll = 0; poll < 100 && !waiting; poll++) {
        waiting = (await a.query('SELECT cardinality(pg_blocking_pids($1))>0 waiting', [pid])).rows[0].waiting;
        if (!waiting) await delay(10);
      }
      assert.ok(waiting, 'writer must be blocked by workspace before the conflicting insert');
      const workspace = (async () => {
        try {
          await a.query(insert(table), table === 'jobs' ? [jobId, caseId] : [jobId]);
          await a.query('COMMIT');
        } catch (error) { await a.query('ROLLBACK'); throw error; }
      })();
      const outcomes = await Promise.allSettled([writer, workspace]);
      assert.deepEqual(outcomes.map(row => row.status === 'rejected'
        ? (row.reason as { code: string }).code : 'ok'), ['ok', 'ok']);
    } finally {
      await a.query('ROLLBACK');
      await b.query('ROLLBACK');
      await a.query(`DROP SCHEMA ${schema} CASCADE`);
      a.release();
      b.release();
      await pool.end();
    }
  });
}
