import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { surfacePartPlacementTx } from '../../../packages/server/src/modules/usp/ingestion/intake-surface';

// Capture the real placement statement. Coordinates are AU3's first NYC LAZ batch, not a made-up map.
let statement = '';
let parameters: unknown[] = [];
const client = { query: async (sql: string, values: unknown[]) => {
  if (sql.startsWith('SELECT a.id')) return { rows: [{ id: 'test_only', revision: 1,
    reference: { analysisCrs: 'EPSG:32618', origin: [583500, 4507900] },
    extent: [-200, -200, 200, 200], drafted: null }] };
  if (sql.startsWith('SELECT count(DISTINCT auth_srid)')) return { rows: [{ n: 2 }] };
  statement = sql;
  parameters = values;
  return { rows: [] };
} } as unknown as PoolClient;
await surfacePartPlacementTx(client, 'test_only', { authority: 'EPSG:6347' } as never,
  [[583402.5958, 4508041.3854], [583659.1058, 4507755.5254]]);

const literal = (value: unknown) => Array.isArray(value) ? `ARRAY[${value.map(literal).join(',')}]` : String(value);
function compare(sql: string) {
  const input = `BEGIN READ ONLY;\nPREPARE placement AS ${sql};\n`
    + "SELECT parameter_types FROM pg_prepared_statements WHERE name='placement';\n"
    + `EXECUTE placement(${parameters.map(literal).join(',')});\nROLLBACK;\n`;
  const result = spawnSync('docker', ['exec', '-i', 'ulpin-reh-02-postgres-1', 'psql', '-X',
    '-U', 'ulpin_reh_02', '-d', 'ulpin_reh_02', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8' });
  return { exit: result.status, output: result.stdout.trim(), error: result.stderr.trim() };
}
const before = compare(statement.replace('$5::integer', '$5'));
const after = compare(statement);
assert.notEqual(before.exit, 0);
assert.match(before.error, /could not parse proj string '32618'/);
assert.equal(after.exit, 0);
assert.match(after.output, /integer,integer/);
writeFileSync('docs/evidence/sfa1/placement-sql.json', JSON.stringify({ before, after }, null, 2) + '\n',
  { flag: 'wx' });
console.log(JSON.stringify({ before, after }, null, 2));
