import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AppError } from '../../../infrastructure/errors';

// Execute admission SQL on disposable metadata; translate only PostgreSQL casts and JSON text extraction.
const path = 'packages/server/src/modules/usp/ingestion/streamed-profile.ts';
const source = process.env.S13N_BASE
  ? execFileSync('git', ['show', `${process.env.S13N_BASE}:${path}`], { encoding: 'utf8' })
  : readFileSync(path, 'utf8');
const block = source.slice(source.indexOf('      const active=Number'),
  source.indexOf('      const jobId=randomUUID(),base='));
const admission = new (Object.getPrototypeOf(async function () {}).constructor)(
  'client', 'limits', 'AppError', 'caseId', block) as
  (client: unknown, limits: unknown, error: unknown, caseId: string) => Promise<void>;
const sqlReader = String.raw`
import json, sqlite3, sys
sql, params, rows = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
db.executescript('''CREATE TABLE usp_streamed_profile_imports(
job_id,raw_job_id,source_id,state,created_at,case_id); CREATE TABLE jobs(id,payload);''')
for i, (sid, state, raw, pins, case) in enumerate(rows):
    db.execute('INSERT INTO usp_streamed_profile_imports VALUES(?,?,?,?,?,?)', (str(i),raw,sid,state,i,case))
    db.execute('INSERT INTO jobs VALUES(?,?)', (str(i),json.dumps(pins)))
print(db.execute(sql, params).fetchone()[0])
`;
type Row = [string, string, string, Record<string, unknown>, string];
const row = (id: string, state = 'sealed', raw = 'raw', pins = {}, caseId = 'case'): Row =>
  [id, state, raw, pins, caseId];
function client(rows: Row[]) {
  return { query: async (sql: string, params: string[] = []) => {
    assert.match(sql, /^SELECT count/);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE)\b/);
    const compatible = sql.replace(/(j|nj)\.payload->>'(\w+)'/g, "CAST($1.payload->>'$2' AS TEXT)")
      .replaceAll('::int', '').replaceAll('$1', '?');
    const n = Number(execFileSync('python', ['-c', sqlReader], {
      input: JSON.stringify([compatible, params, rows]), encoding: 'utf8',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    }).trim());
    return { rows: [{ n }] };
  } };
}
// Raise only the test's active limit to reach history with queued/running rows; production stays at four.
const admit = (rows: Row[], active = 129) => admission(client(rows), { active }, AppError, 'case');

test('128 completed profiles in case A do not spend case B history', async () => {
  await admit(Array.from({ length: 128 }, (_, i) => row(`source-${i}`, 'sealed', 'raw', {}, 'other')));
});

test('128 live profiles refuse with this case, the count and what frees a slot', async () => {
  await assert.rejects(admit(Array.from({ length: 128 }, (_, i) => row(`live-${i}`, 'queued'))), error => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'STREAMED_PROFILE_HISTORY');
    assert.equal(error.status, 429);
    assert.match(error.message, /This case holds 128 live or current profiles/);
    assert.deepEqual(error.details, { limit: 'case_profiles', freesAt: null });
    assert.match(error.message, /slot frees.*newer reading supersedes.*another case/s);
    return true;
  });
});

test('100 failed plus 10 live profiles admit', async () => {
  const rows = Array.from({ length: 100 }, (_, i) => row(`failed-${i}`, 'failed'));
  rows.push(...Array.from({ length: 10 }, (_, i) => row(`live-${i}`, 'running')));
  await admit(rows);
});

test('only current sealed pins and live work count; supersession never deletes receipts', async () => {
  const query = block.match(/client.query\(`(SELECT count\(\*\)::int n FROM [\s\S]*?)`,\[caseId\]\)/)?.[1];
  assert.ok(query);
  const count = async (rows: Row[]) => (await client(rows).query(query, ['case'])).rows[0].n;
  assert.equal(await count([row('a'), row('b')]), 2);
  assert.equal(await count([row('a'), row('a')]), 2);
  for (const [raw, pins] of [['new-raw', {}], ['raw', { readerSha256: 'new' }],
    ['raw', { profilerSha256: 'new' }]] as const) {
    const rows = [row('a'), row('a', 'failed', raw, pins)];
    const before = JSON.stringify(rows);
    assert.equal(await count(rows), 0);
    assert.equal(JSON.stringify(rows), before);
    rows[0][1] = 'running';
    assert.equal(await count(rows), 1);
  }
  assert.equal(await count(['failed', 'stale'].map(state => row('a', state))), 0);
});

test('four active profiles anywhere still refuse before case history', async () => {
  await assert.rejects(admit(Array.from({ length: 4 }, (_, i) => row(`a-${i}`, 'running', 'raw', {}, 'other')), 4),
    { code: 'STREAMED_PROFILE_CAPACITY' });
});
