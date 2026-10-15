import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { query } from '../../../../packages/server/src/infrastructure/db';
import { areaContext } from '../../../../packages/server/src/modules/areas/areas';
import { canonicalBuilding } from '../../../../packages/server/src/modules/registry/canonical-building';

type Statement = { text: string; values?: unknown[]; ms: number };
const SAMPLE = 20;
const pg = createRequire(resolve('packages/server/package.json'))('pg');
let recording: Statement[] | null = null;

/** Time every statement the product's own pool sends while recording; the statements themselves are unchanged. */
function patchClient() {
  const original = pg.Client.prototype.query;
  if (original.ad1) return;
  const patched = function (this: unknown, ...args: any[]) {
    const started = performance.now();
    const result = original.apply(this, args);
    const text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
    if (recording && text && result?.then) {
      const entry: Statement = { text, values: Array.isArray(args[1]) ? args[1] : args[0]?.values, ms: 0 };
      recording.push(entry);
      result.then(() => { entry.ms = performance.now() - started; }, () => {});
    }
    return result;
  };
  patched.ad1 = true;
  pg.Client.prototype.query = patched;
}

async function recorded<T>(read: () => Promise<T>) {
  recording = [];
  const started = performance.now();
  try {
    const value = await read();
    return { value, ms: Math.round(performance.now() - started), statements: recording };
  } finally {
    recording = null;
  }
}

function grouped(statements: Statement[]) {
  const groups = new Map<string, { text: string; values?: unknown[]; count: number; ms: number }>();
  for (const statement of statements) {
    const key = statement.text.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK|SET |SAVEPOINT|RELEASE)/i.test(key)) continue;
    const group = groups.get(key) ?? { text: key, values: statement.values, count: 0, ms: 0 };
    group.count += 1;
    group.ms += statement.ms;
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => right.ms - left.ms);
}

/** One read-only EXPLAIN (ANALYZE, BUFFERS) of a recorded SELECT with its first recorded values. */
async function explain(text: string, values?: unknown[]) {
  if (!/^\s*(SELECT|WITH)/i.test(text)) return null;
  const plan = (await query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${text}`, values ?? [])).rows[0]['QUERY PLAN'][0];
  const root = plan.Plan;
  return { executionMs: plan['Execution Time'], planningMs: plan['Planning Time'], node: root['Node Type'],
    rows: root['Actual Rows'], sharedHit: root['Shared Hit Blocks'], sharedRead: root['Shared Read Blocks'] };
}

async function topStatements(statements: Statement[], limit = 4) {
  const groups = grouped(statements).slice(0, limit);
  return Promise.all(groups.map(async group => ({ sql: group.text.slice(0, 400), count: group.count,
    totalMs: Math.round(group.ms), explain: await explain(group.text, group.values).catch(error => ({
      failure: String(error.message) })) })));
}

/** Where the area read's time goes: the context read and a sample of the per-building canonical reads. */
export async function areaReadTiming(areaId: string) {
  patchClient();
  const context = await recorded(() => areaContext(areaId)).catch(error => ({ error }));
  if ('error' in context) return { context: { refusal: { code: context.error.code, message: context.error.message } } };
  const bytes = Buffer.byteLength(JSON.stringify(context.value));
  const buildings = context.value.features.filter(feature => feature.kind === 'building');
  const sample = buildings.slice(0, SAMPLE);
  const building = await recorded(async () => {
    for (const feature of sample) await canonicalBuilding(feature.id, 'current', context.value);
  });
  const perBuildingMs = sample.length ? building.ms / sample.length : 0;
  return {
    context: { ms: context.ms, bytes, features: context.value.features.length, statements: context.statements.length,
      top: await topStatements(context.statements) },
    buildingReads: { sampled: sample.length, ms: building.ms, perBuildingMs: Math.round(perBuildingMs),
      statementsPerBuilding: sample.length ? Math.round(building.statements.length / sample.length) : 0,
      top: await topStatements(building.statements),
      projectedAreaBuildingsMs: Math.round(perBuildingMs * buildings.length / 4),
      note: 'canonical-area.ts projects every building through canonicalBuilding, four at a time.' },
  };
}

export async function drawableBuildings(areaId: string) {
  return Number((await query(`SELECT count(*) FROM physical_features WHERE area_id=$1 AND revision>0
    AND body->>'kind'='building' AND GeometryType(geographic_geometry) IN ('POLYGON','MULTIPOLYGON')`,
  [areaId])).rows[0].count);
}
