import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AppError } from '../../../infrastructure/errors';

// Execute the real admission block, including its SQL, on a disposable in-memory SQL reader.
// SQLite adapters below only translate PostgreSQL casts and JSON text extraction; no quota predicate is mocked.
const path = 'packages/server/src/modules/usp/ingestion/chunk-mapping.ts';
const source = process.env.S13L_BASE ? execFileSync('git', ['show', `89c7e4d9:${path}`], { encoding: 'utf8' })
  : readFileSync(path, 'utf8');
const block = source.slice(source.indexOf('      const active=Number'),
  source.indexOf('      const jobId=randomUUID(),base='));
const admission = new (Object.getPrototypeOf(async function () {}).constructor)(
  'client', 'limits', 'AppError', block) as (client: unknown, limits: unknown, error: unknown) => Promise<void>;
const sqlReader = String.raw`
import json, sqlite3, sys
sql, rows, revision, recipe = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
db.executescript('''CREATE TABLE usp_chunk_mapping_imports(
job_id,raw_job_id,source_id,source_revision,state,created_at);
CREATE TABLE jobs(id,payload); CREATE TABLE sources(id,case_id,family_id,revision);
CREATE TABLE usp_mapping_recipes(source_id,id,revision,state,body);''')
for i, row in enumerate(rows):
    sid, state, raw, pins = row
    db.execute('INSERT INTO usp_chunk_mapping_imports VALUES(?,?,?,?,?,?)', (str(i),raw,sid,1,state,i))
    db.execute('INSERT INTO jobs VALUES(?,?)', (str(i),json.dumps(pins)))
for sid in set(row[0] for row in rows):
    db.execute('INSERT INTO sources VALUES(?,?,?,?)', (sid,'case',sid,1))
    if revision:
        db.execute('INSERT INTO sources VALUES(?,?,?,?)', (sid+'-new','case',sid,2))
    if recipe:
        db.execute('INSERT INTO usp_mapping_recipes VALUES(?,?,?,?,?)',
                   (sid,'recipe',2,'approved','{"planHash":"new"}'))
print(db.execute(sql).fetchone()[0])
`;
type Row = [string, string, string, Record<string, unknown>];
function client(rows: Row[], revision = false, recipe = false) {
  return { query: async (sql: string) => {
    assert.match(sql, /^SELECT count/);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE)\b/);
    const compatible = sql.replace(/(j|nj)\.payload->>'(\w+)'/g, "CAST($1.payload->>'$2' AS TEXT)")
      .replace(/(r\.\w+)::text/g, 'CAST($1 AS TEXT)').replaceAll('::int', '');
    const n = Number(execFileSync('python', ['-c', sqlReader], {
      input: JSON.stringify([compatible, rows, revision, recipe]), encoding: 'utf8',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    }).trim());
    return { rows: [{ n }] };
  } };
}
const row = (id: string, state = 'completed', raw = 'raw', pins = {}): Row => [id, state, raw, pins];
const admit = (reader: ReturnType<typeof client>) => admission(reader, { active: 4 }, AppError);

test('200 superseded mapping receipts plus 10 live rows admit another mapping without deleting history', async () => {
  const states = ['completed', 'failed', 'stale', 'completed_with_rejections', 'disabled', 'unavailable'];
  const rows = Array.from({ length: 200 }, (_, i) => row('same-source', states[i % states.length], `raw-${i}`));
  rows.push(row('same-source', 'completed', 'current-raw'));
  rows.push(...Array.from({ length: 9 }, (_, i) => row(`live-${i}`, 'needs_input')));
  const before = JSON.stringify(rows);
  await admit(client(rows));
  assert.equal(JSON.stringify(rows), before);
});

test('128 live mappings refuse with the live count and what frees a slot', async () => {
  const rows = Array.from({ length: 128 }, (_, i) => row(`live-${i}`, 'needs_input'));
  await assert.rejects(admit(client(rows)), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'MAPPING_HISTORY_CAPACITY');
    assert.match(error.message, /128 live or current mappings/);
    assert.match(error.message, /slot frees.*work finishes.*source revision, recipe or raw reader supersedes/s);
    return true;
  });
});

test('current completed pins count; changed source, recipe and raw reader do not; work always counts', async () => {
  const pattern = /client.query\(`(SELECT count\(\*\)::int n FROM usp_chunk_mapping_imports m[\s\S]*?)`\)/;
  const query = block.match(pattern)?.[1];
  assert.ok(query);
  const count = async (rows: Row[], revision = false, recipe = false) =>
    (await client(rows, revision, recipe).query(query)).rows[0].n;
  assert.equal(await count([row('a'), row('b', 'completed_with_rejections')]), 2);
  assert.equal(await count([row('a')], true), 0);
  assert.equal(await count([row('a')], false, true), 0);
  assert.equal(await count([row('a', 'completed', 'raw',
    { recipeId: 'recipe', recipeRevision: 2, planHash: 'new' })], false, true), 1);
  assert.equal(await count([row('a'), row('a', 'failed', 'new-raw')]), 0);
  assert.equal(await count([row('a'), row('a', 'stale', 'raw', { readerSha256: 'new' })]), 0);
  assert.equal(await count(['queued', 'running', 'needs_input'].map(state => row('a', state)), true, true), 3);
  assert.equal(await count(['failed', 'stale', 'disabled', 'unavailable'].map(state => row('a', state))), 0);
});
