import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import * as contracts from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { caseRetentionBudgetTx } from './retention-budget';

const profiles = {
  kml: ['kml-native-v1', contracts.KML_LIMITS],
  'raster-window': ['geotiff-raster-v1', contracts.RASTER_WINDOW_LIMITS],
  'point-batch': ['laz-point-v1', contracts.POINT_BATCH_LIMITS],
  citygml: ['citygml-native-v1', contracts.CITYGML_LIMITS],
  cityjson: ['cityjson-native-v1', contracts.CITYJSON_LIMITS],
  dxf: ['dxf-native-v1', contracts.DXF_LIMITS],
  geoparquet: ['geoparquet-native-v1', contracts.GEOPARQUET_LIMITS],
  gltf: ['gltf-native-v1', contracts.GLTF_LIMITS],
  ifc: ['ifc-native-v1', contracts.IFC_LIMITS],
  obj: ['obj-native-v1', contracts.OBJ_LIMITS],
} as const;
type Format = keyof typeof profiles;
type Row = [string, string, number];
const rows = (format: Format, count = 64, bytes = 1): Row[] =>
  Array.from({ length: count }, () => ['A', profiles[format][0], bytes]);

// Execute each actual call site (or its base block) and real SQL on disposable metadata, never stored originals.
async function admit(format: Format, retained: Row[], caseId = 'B', addBytes = 1) {
  const path = `packages/server/src/modules/usp/ingestion/${format}.ts`;
  const source = process.env.S13O_BASE ? execFileSync('git', ['show', `068c1da7:${path}`], { encoding: 'utf8' })
    : readFileSync(path, 'utf8');
  const pattern = /      (?:const budget=[\s\S]*?|await caseRetentionBudgetTx[^\n]+)\n(?=      const original=)/;
  const block = source.match(pattern);
  assert.ok(block, `Retention check missing from ${format}`);
  const run = new (Object.getPrototypeOf(async function () {}).constructor)(
    'client', 'caseId', 'file', `${format.replaceAll('-', '_').toUpperCase()}_LIMITS`,
    'AppError', 'caseRetentionBudgetTx', block[0]);
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE sources(case_id,profile,bytes,family_id,revision)');
  retained.forEach((row, i) => db.prepare('INSERT INTO sources VALUES(?,?,?,?,?)').run(...row, 'same-family', i + 1));
  const client = { query: async (sql: string, args: string[] = []) => {
    assert.match(sql, /^SELECT /);
    // Only PostgreSQL casts/placeholders change; no scope or quota predicate is mocked.
    const compatible = sql.replace(/::(?:int|text)/g, '').replace(/\$\d+/g, '?');
    return { rows: [db.prepare(compatible).get(...args)] };
  } };
  try {
    await run(client, caseId, { bytes: { length: addBytes } }, profiles[format][1], AppError, caseRetentionBudgetTx);
    assert.equal(db.prepare('SELECT count(*) n FROM sources').get()!.n, retained.length);
  } finally {
    db.close();
  }
}
function refusal(format: Format, limit: string, count: number, bytes: number) {
  return (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 429);
    assert.equal(error.code, `${format.split('-')[0].toUpperCase()}_RETENTION_BUDGET`);
    assert.match(error.message, new RegExp(`This case retains ${count} .+ sources and ${bytes} bytes`));
    assert.deepEqual(error.details, { limit, freesAt: null });
    assert.ok(error.message.includes(`limits are 64 sources and ${profiles[format][1].retainedBytes / 1024 ** 2} MiB`));
    assert.match(error.message, /Existing originals stay, so add more files in another case\./);
    return true;
  };
}

test('64 KML sources in case A leave case B its own retained-source budget', async () => {
  await admit('kml', rows('kml'));
});

test('64 KML revisions in one case refuse with the case count, bytes, limits and next action', async () => {
  await admit('kml', rows('kml', 63), 'A');
  await assert.rejects(admit('kml', rows('kml'), 'A'), refusal('kml', 'case_retained_sources', 64, 64));
});

test('the byte limit refuses in its own case, not another; all ten profiles use their unchanged limits', async () => {
  for (const format of Object.keys(profiles) as Format[]) {
    const bytes = profiles[format][1].retainedBytes;
    const retained = rows(format, 1, bytes);
    await admit(format, [...retained, ['B', 'another-profile', bytes]]);
    await admit(format, rows(format, 1, bytes - 1), 'A');
    await assert.rejects(admit(format, retained, 'A'), refusal(format, 'case_retained_bytes', 1, bytes));
  }
});

for (const format of ['raster-window', 'point-batch'] as const) {
  test(`${format} keeps other cases independent and counts every retained family revision`, async () => {
    await admit(format, rows(format));
    await admit(format, rows(format, 63), 'A');
    await assert.rejects(admit(format, rows(format), 'A'), refusal(format, 'case_retained_sources', 64, 64));
  });
}
