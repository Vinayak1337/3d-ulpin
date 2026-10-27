import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { admitIntakeSurfaceParts } from '../../../packages/server/src/modules/usp/ingestion/intake-surface';
import { dispatchLaneParameters } from '../../../packages/server/src/modules/cases/dispatch-lanes';

const caseId = '76f1cdb3-1407-40b4-b9a2-20cea1c53380';
function select(sql: string) {
  assert(/^\s*SELECT\b/.test(sql));
  const result = spawnSync('docker', ['exec', '-i', 'ulpin-reh-02-postgres-1', 'psql', '-X',
    '-U', 'ulpin_reh_02', '-d', 'ulpin_reh_02', '-v', 'ON_ERROR_STOP=1'],
  { input: `BEGIN READ ONLY;\n${sql};\nROLLBACK;\n`, encoding: 'utf8' });
  return { sql, exit: result.status, output: result.stdout.trim(), error: result.stderr.trim() };
}

let admission = '';
const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
globals.ulpinPool = { query: async (sql: string, values: string[]) => {
  admission = sql.replace('$1', `'${values[0]}'`);
  return { rows: [] };
} };
await admitIntakeSurfaceParts();
delete globals.ulpinPool;
const processing = readFileSync('packages/server/src/modules/cases/processing.ts', 'utf8');
const laneSql = /`SELECT \* FROM \(SELECT jobs\.[\s\S]*?LIMIT 12`/.exec(processing)![0].slice(1, -1);
const arrays = dispatchLaneParameters().map(values => `ARRAY[${values.map(value => `'${value}'`).join(',')}]`);
const evidence = {
  at: new Date().toISOString(),
  parts: select(`SELECT i.item_id,i.state,i.family,p.state AS part_state,j.operation,j.status,j.error,
    count(p.part_index)::int AS parts,min(p.job_id::text) AS first_job_id
    FROM usp_intake_items i LEFT JOIN usp_intake_parts p ON p.item_id=i.item_id
    LEFT JOIN jobs j ON j.id=p.job_id WHERE i.case_id='${caseId}'
    GROUP BY i.item_id,i.state,i.family,p.state,j.operation,j.status,j.error ORDER BY i.item_id,p.state`),
  jobs: select(`SELECT operation,status,error,count(*) FROM jobs WHERE case_id='${caseId}'
    GROUP BY operation,status,error ORDER BY operation,status`),
  lanes: select(laneSql.replace('SELECT * FROM', 'SELECT id,operation,status,lane,file_rank FROM')
    .replace('$1', arrays[0]).replace('$2', arrays[1])),
  admission: select(admission),
};
const name = process.argv[2] ?? 'diagnosis';
writeFileSync(`docs/evidence/sfa1/${name}.json`, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(evidence, null, 2));
