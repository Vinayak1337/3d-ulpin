import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { surfacePartPlacementTx } from '../../../packages/server/src/modules/usp/ingestion/intake-surface';

const path = 'packages/server/src/modules/usp/ingestion/intake-surface.ts';
const caseId = 'ce260ba2-ad3c-47f9-a5e4-4a4bc355c2aa';
let statement = '';
const client = { query: async (sql: string) => {
  statement = sql;
  return { rows: [] };
} } as unknown as PoolClient;
await surfacePartPlacementTx(client, caseId, { authority: 'EPSG:6347' } as never, []);
const oldSource = spawnSync('git', ['show', `1f25407b:${path}`], { encoding: 'utf8' }).stdout;
const bounds = (source: string) => /const draftedBounds = `([\s\S]+?)`;/.exec(source.replaceAll('\r\n', '\n'))![1];
const oldStatement = statement.replace(bounds(readFileSync(path, 'utf8')), bounds(oldSource));
assert.notEqual(oldStatement, statement);
function select(sql: string) {
  const input = `BEGIN READ ONLY;\nSELECT row_to_json(t) FROM (${sql.replace('$1', `'${caseId}'`)}) t;\nROLLBACK;`;
  const result = spawnSync('docker', ['exec', '-i', 'ulpin-reh-02-postgres-1', 'psql', '-X', '-At',
    '-U', 'ulpin_reh_02', '-d', 'ulpin_reh_02', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split('\n').find(line => line.startsWith('{'))!);
}
const before = select(oldStatement);
const after = select(statement);
assert.equal(before.drafted, null);
assert.equal(after.extent, null);
assert.deepEqual(after.drafted.map((value: number) => Math.round(value)), [0, 0, 1673, 1679]);
writeFileSync('docs/evidence/sfa1/bounds-sql.json', JSON.stringify({ caseId, before, after }, null, 2) + '\n',
  { flag: 'wx' });
console.log(JSON.stringify({ before, after }, null, 2));
