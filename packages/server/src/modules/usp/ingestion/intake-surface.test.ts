import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { INTAKE_SURFACE_VERSION, type PointBatchResult, type RasterWindowResult } from '@ulpin/contracts/usp';
import { probeOriginal } from './intake-probe';
import { acceptIntakeSurfacePartTx, pointRecordsExtent, queueIntakeSurfaceTx, surfacePartPlacementTx, surfacePlan,
  surfaceReader } from './intake-surface';
import type { IntakeSourceRow } from './intake-context';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'intake-surface-protocol';
const pack = 'E:/BhuAayam-data/task-data/nyc-10013-multimodal/upload';
// The three NYC originals and what the existing native readers recorded of each at its first part (AU3).
const recorded = JSON.parse(readFileSync('docs/evidence/gf1/au3/result.json', 'utf8')).files as {
  file: string; bytes: number; sha256: string; reader: Record<string, any> }[];

test('each NYC original is taken by its existing reader and plans 9, 16 and 211 parts', async t => {
  const expected: Record<string, [string, number]> = { 'nyc-10013-ortho-2018.tif': ['raster-window', 9],
    'nyc-10013-dem-2017.tif': ['raster-window', 16], 'nyc-10013-lidar-2017.laz': ['point-batch', 211] };
  if (!existsSync(pack)) return t.skip('The NYC pack is not on this machine.');
  for (const file of recorded) {
    const bytes = readFileSync(`${pack}/${file.file}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.file);
    const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, file.file);
    const [operation, parts] = expected[file.file];
    assert.deepEqual(surfaceReader(card, bytes.length), { operation }, file.file);
    const plan = operation === 'raster-window'
      ? surfacePlan({ operation, value: { metadata: file.reader } as unknown as RasterWindowResult })
      : surfacePlan({ operation: 'point-batch', value: { metadata: file.reader } as unknown as PointBatchResult });
    assert.equal(plan.length, parts, file.file);
    // The planned first part is the part the reader read first.
    assert.deepEqual(plan[0], operation === 'raster-window' ? { operation, window: file.reader.window }
      : { operation, batch: file.reader.batch }, file.file);
    assert.equal(new Set(plan.map(part => JSON.stringify(part))).size, parts, file.file);
  }
});

test('the DEM signature-only probe is not yet read, never a missing coordinate system', async t => {
  if (!existsSync(pack)) return t.skip('The NYC pack is not on this machine.');
  const bytes = readFileSync(`${pack}/nyc-10013-dem-2017.tif`);
  const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, 'dem.tif');
  assert.deepEqual(surfaceReader(card, bytes.length), { operation: 'raster-window' });
  const dem = recorded.find(file => file.file === 'nyc-10013-dem-2017.tif')!.reader;
  assert.equal(dem.crs, 'EPSG:2263');
  assert.equal(dem.verticalReferenceStatus, 'unknown');
  assert.equal(dem.verticalReference, null);
});

test('above a reader limit the original is kept and the limit is named', () => {
  const card = { family: 'point_cloud', format: 'laz', formatVersion: '1.2', point: { format: 1, scale: null },
    counts: { points: 10 }, raster: null } as never;
  const reader = surfaceReader(card, 1024) as { limit: string };
  assert.match(reader.limit, /LAS 1\.4 point format 6 only; this is LAZ 1\.2 format 1/);
  const big = surfaceReader({ family: 'raster', format: 'geotiff', raster: null, counts: {} } as never, 17 * 1024 ** 2);
  assert.match((big as { limit: string }).limit, /^Kept \(17 MiB\)\. The batch reads a raster of at most 16 MiB/);
});

test('a native format-6 batch gives the XY extent of its records', () => {
  const records = Buffer.alloc(60);
  records.writeInt32LE(100, 0); records.writeInt32LE(-50, 4);
  records.writeInt32LE(300, 30); records.writeInt32LE(20, 34);
  assert.deepEqual(pointRecordsExtent(records, [0.5, 0.5, 0.5], [500, 4000, 0]), [550, 3975, 650, 4010]);
  assert.equal(pointRecordsExtent(new Uint8Array(0), [1, 1, 1], [0, 0, 0]), null);
});

/** The double's answer to the placement statement; the transform is the identity (same EPSG code). */
function localParts([xs, ys, ids, from, to, ox, oy, x0, y0, x1, y1]: any[]) {
  assert.equal(from, to);
  const groups = new Map<number, number[][]>();
  ids.forEach((id: number, n: number) => groups.set(id, [...groups.get(id) ?? [], [xs[n] - ox, ys[n] - oy]]));
  return [...groups].map(([part, points]) => {
    const px = points.map(p => p[0]), py = points.map(p => p[1]);
    return { part, xs: px, ys: py, meets: Math.min(...px) <= x1 && Math.max(...px) >= x0 && Math.min(...py) <= y1
      && Math.max(...py) >= y0 };
  });
}

const caseId = '30000000-0000-4000-8000-000000000001';
const itemId = '30000000-0000-4000-8000-000000000002';
const jobId = '30000000-0000-4000-8000-000000000003';

type Area = { id: string; revision: number; reference: { analysisCrs: string; origin: number[] }; extent: number[] };

/**
 * An item with its first point part queued; the statements the acceptance writes, each counted. With an area, the
 * placement statement is answered as PostGIS would for a source already in the area's CRS: minus the origin, then
 * each part's envelope against the area's local extent.
 */
function ledger(area: Area | null = null) {
  const item: Record<string, any> = { item_id: itemId, case_id: caseId, state: 'reading', placement: 'undecided',
    plan_ref: { version: INTAKE_SURFACE_VERSION, operation: 'point-batch', header: null }, records_seen: 0,
    limit_reason: null, parts_planned: null, parts_done: 0, family: 'point_cloud', format: 'laz',
    size_class: 'M', wave: 2, pinned_by_officer: false, parent_item_id: null };
  const parts = new Map<number, Record<string, any>>([[0, { item_id: itemId, part_index: 0, state: 'queued',
    job_id: jobId, locator: { operation: 'point-batch', batch: null, partKey: 'a'.repeat(64) }, counts: null,
    result_ref: null }]]);
  const count = { writes: 0, events: 0 };
  const one = (row: unknown) => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
  const client = { query: async (sql: string, values: any[] = []) => {
    if (sql.startsWith('SELECT p.*,i.plan_ref FROM usp_intake_parts p'))
      return one([...parts.values()].filter(part => part.job_id === values[0]).map(part => ({ ...part,
        plan_ref: item.plan_ref }))[0]);
    if (sql.startsWith("UPDATE usp_intake_parts SET state='published'")) {
      count.writes++;
      Object.assign(parts.get(values[1])!, { state: 'published', counts: values[2], result_ref: values[3] });
      return one({});
    }
    if (sql.startsWith('INSERT INTO usp_intake_parts')) {
      count.writes++;
      (JSON.parse(values[2]) as Record<string, unknown>[]).forEach((locator, n) => parts.has(values[1] + n)
        || parts.set(values[1] + n, { item_id: itemId, part_index: values[1] + n, state: 'planned', locator }));
      return one({});
    }
    if (sql.startsWith('UPDATE usp_intake_items SET plan_ref=$2')) {
      count.writes++;
      item.plan_ref = values[1];
      return one({});
    }
    if (sql.startsWith('SELECT state,counts,issue_code,result_ref FROM usp_intake_parts'))
      return { rows: [...parts.values()].sort((a, b) => a.part_index - b.part_index), rowCount: parts.size };
    if (sql.startsWith('SELECT a.id,a.revision,a.reference,a.extent FROM cases')) return one(area);
    if (sql.startsWith('SELECT count(DISTINCT auth_srid)')) return one({ n: new Set([values[0], values[1]]).size });
    if (sql.startsWith('SELECT c.part,array_agg')) return { rows: localParts(values), rowCount: 1 };
    if (sql.startsWith('SELECT case_id,plan_ref FROM usp_intake_items') || sql.startsWith('SELECT state,placement')
      || sql.startsWith('SELECT parts_planned')) return one(item);
    if (sql.startsWith('UPDATE usp_intake_items SET parts_planned')) {
      count.writes++;
      Object.assign(item, { parts_planned: values[2], parts_done: values[3] });
      return one({});
    }
    if (sql.startsWith('UPDATE usp_intake_items SET state=$3')) {
      count.writes++;
      Object.assign(item, { state: values[2], placement: values[3], plan_ref: values[4], records_seen: values[5],
        limit_reason: values[6] });
      return one({});
    }
    if (sql.startsWith('SELECT item_id AS "itemId"')) return one({ itemId, state: item.state, family: item.family,
      format: item.format, sizeClass: item.size_class, wave: item.wave, pinnedByOfficer: false });
    if (sql.startsWith('SELECT revision FROM cases')) return one({ revision: 3 });
    if (sql.startsWith('INSERT INTO usp_outbox_streams')) return one({});
    if (sql.startsWith('UPDATE usp_outbox_streams')) return one({ sequence: String(count.events + 1) });
    if (sql.startsWith('INSERT INTO usp_outbox(')) {
      count.events++;
      return one({});
    }
    throw new Error(`Unexpected statement: ${sql.slice(0, 60)}`);
  } } as unknown as PoolClient;
  return { client, item, parts, count };
}

/** The LAZ's first accepted batch as its reader recorded it (AU3): 1,726,222 points, EPSG:6347, NAVD88 height. */
function lazFirstBatch(): PointBatchResult {
  const reader = recorded.find(file => file.file === 'nyc-10013-lidar-2017.laz')!;
  return { input: { sourceSha256: reader.sha256 }, artifact: { sha256: reader.reader.artifactSha256,
    bytes: reader.reader.artifactBytes, mediaType: reader.reader.artifactMediaType },
  metadata: { sourcePointCount: reader.reader.sourcePointCount, batch: reader.reader.batch, crsWkt: 'stated',
    horizontalAuthority: reader.reader.crs, verticalReference: reader.reader.verticalReference,
    verticalReferenceStatus: reader.reader.verticalReferenceStatus } } as unknown as PointBatchResult;
}

test('an accepted first part plans the rest once; its replay writes no second part', async () => {
  const { client, item, parts, count } = ledger();
  const accepted = { operation: 'point-batch' as const, jobId, resultSha256: 'c'.repeat(64), value: lazFirstBatch(),
    extent: [583402.5958, 4507755.5254, 583659.1058, 4508041.3854] };
  await acceptIntakeSurfacePartTx(client, accepted);
  assert.equal(parts.size, 211);
  assert.equal(parts.get(0)!.state, 'published');
  assert.deepEqual(parts.get(210)!.locator.batch, { start: 210 * 8192, count: 1726222 - 210 * 8192 });
  assert.equal(new Set([...parts.values()].map(part => part.locator.partKey)).size, 211);
  assert.deepEqual([item.state, item.placement, item.parts_planned, item.parts_done, item.records_seen],
    ['reading', 'waiting_for_anchor', 211, 1, 8192]);
  assert.equal(item.plan_ref.header.vertical.status, 'known');
  assert.match(item.limit_reason, /^Read 1 of 211 batches \(1726222 points, EPSG:6347\)\./);
  assert.match(item.limit_reason, /Display only: no height, measurement or record is taken from it\.$/);
  const after = { ...count };
  await acceptIntakeSurfacePartTx(client, accepted);
  assert.deepEqual(count, after);
  assert.equal(parts.size, 211);
});

test('enrolling the same kept original again changes nothing', async () => {
  const { client, item, count } = ledger();
  await acceptIntakeSurfacePartTx(client, { operation: 'point-batch', jobId, resultSha256: 'c'.repeat(64),
    value: lazFirstBatch(), extent: null });
  const after = { ...count };
  const source = { id: itemId, case_id: caseId, profile: 'large-original-v1', bytes: 11110715 } as IntakeSourceRow;
  const card = { family: 'point_cloud', format: 'laz', formatVersion: '1.4', point: { format: 6, scale: null },
    counts: { points: 1726222 }, raster: null } as never;
  const queried: string[] = [];
  const watched = { query: (sql: string, values: unknown[]) => {
    queried.push(sql);
    return sql.startsWith('SELECT * FROM usp_intake_items') ? { rows: [item], rowCount: 1 }
      : client.query(sql, values);
  } } as unknown as PoolClient;
  assert.equal(await queueIntakeSurfaceTx(watched, source, card), true);
  assert.equal(queried.filter(sql => /^(INSERT|UPDATE)/.test(sql)).length, 0);
  assert.deepEqual(count, after);
});

const area = (extent: number[]): Area => ({ id: '30000000-0000-4000-8000-000000000004', revision: 2,
  reference: { analysisCrs: 'EPSG:6347', origin: [583500, 4507900] }, extent });
const lazBox = [583402.5958, 4507755.5254, 583659.1058, 4508041.3854];

test('a part whose corners meet the batch area is on the map; the item follows', async () => {
  const { client, item } = ledger(area([-200, -200, 200, 200]));
  await acceptIntakeSurfacePartTx(client, { operation: 'point-batch', jobId, resultSha256: 'c'.repeat(64),
    value: lazFirstBatch(), extent: lazBox });
  assert.equal(item.placement, 'on_map');
  assert.doesNotMatch(item.limit_reason, /outside|not placed/);
  const placed = await surfacePartPlacementTx(client, caseId, item.plan_ref.header,
    [[lazBox[0], lazBox[3]], [lazBox[2], lazBox[1]]]) as any;
  assert.equal(placed.state, 'placed');
  assert.deepEqual(placed.corners.map((c: number[]) => c.map(v => Math.round(v))), [[-97, 141], [159, -144]]);
});

test('a part read outside the batch area is not on the map, and says so', async () => {
  const { client, item } = ledger(area([5000, 5000, 6000, 6000]));
  await acceptIntakeSurfacePartTx(client, { operation: 'point-batch', jobId, resultSha256: 'c'.repeat(64),
    value: lazFirstBatch(), extent: lazBox });
  assert.equal(item.placement, 'not_understood');
  assert.match(item.limit_reason, /Read, outside this area: its corners do not meet the batch area's extent\./);
  const placed = await surfacePartPlacementTx(client, caseId, item.plan_ref.header,
    [[lazBox[0], lazBox[3]], [lazBox[2], lazBox[1]]]);
  assert.deepEqual(placed, { state: 'not_placed', reason: 'outside_area',
    words: 'Read, outside this area: its corners do not meet the batch area\'s extent.' });
});

for (const [name, profile, family, format] of [['TIFF', 'raster', 'raster', 'geotiff'],
  ['LAZ', 'point', 'point_cloud', 'laz']] as const) {
  test(`a kept ${name} whose receipt is over its reader's bound rests with words; the publish goes on`, async () => {
    const sha = 'd'.repeat(64), sourceId = '30000000-0000-4000-8000-000000000005', over = 17 * 1024 ** 2;
    const item: Record<string, any> = { item_id: itemId, case_id: caseId, source_id: sourceId, plan_ref: null,
      state: 'probed', placement: 'undecided', records_seen: 0, limit_reason: null, parts_planned: null, parts_done: 0,
      family, format, size_class: 'S', wave: 1 };
    const statements: string[] = [];
    const one = (row: unknown) => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
    const client = { query: async (sql: string, values: any[] = []) => {
      statements.push(sql);
      if (sql.startsWith('SELECT * FROM usp_intake_items') || sql.startsWith('SELECT state,placement')
        || sql.startsWith('SELECT parts_planned')) return one(item);
      if (/^(SAVEPOINT|ROLLBACK TO SAVEPOINT|RELEASE SAVEPOINT)/.test(sql)) return one(null);
      if (sql.startsWith('SELECT id,revision,archived')) return one({ id: caseId, revision: 1, archived: false,
        frame: {}, context: {}, site_id: null });
      if (sql.startsWith('SELECT * FROM sources')) return one({ id: sourceId, case_id: caseId,
        profile: 'large-original-v1', sha256: sha, bytes: 1024 ** 2, object_key: `large-originals/${sourceId}/${sha}`,
        inspection: { largeOriginal: { operatorSubject: process.env.ULPIN_LOCAL_OPERATOR_SUBJECT,
          verifiedSha256: sha, verifiedBytes: over } } });
      if (sql.startsWith("SELECT inspection->'largeOriginal'")) return one({ bytes: String(over) });
      if (sql.startsWith('UPDATE usp_intake_items SET state=$3')) {
        Object.assign(item, { state: values[2], placement: values[3], plan_ref: values[4], limit_reason: values[6] });
        return one({});
      }
      if (sql.startsWith('SELECT item_id AS "itemId"')) return one({ itemId, state: item.state, family, format,
        sizeClass: 'S', wave: 1, pinnedByOfficer: false });
      if (sql.startsWith('SELECT revision FROM cases')) return one({ revision: 3 });
      if (sql.startsWith('INSERT INTO usp_outbox_streams') || sql.startsWith('INSERT INTO usp_outbox(')) return one({});
      if (sql.startsWith('UPDATE usp_outbox_streams')) return one({ sequence: '1' });
      throw new Error(`Unexpected statement: ${sql.slice(0, 60)}`);
    } } as unknown as PoolClient;
    const card = { family, format, formatVersion: profile === 'point' ? '1.4' : null,
      point: profile === 'point' ? { format: 6, scale: null } : null, counts: { points: 1000, bands: 1 },
      raster: null } as never;
    const source = { id: sourceId, case_id: caseId, profile: 'large-original-v1', bytes: 1024 ** 2 } as IntakeSourceRow;
    assert.equal(await queueIntakeSurfaceTx(client, source, card), true);
    assert.deepEqual([item.state, item.placement, item.plan_ref], ['probed', 'not_understood', null]);
    assert.equal(item.limit_reason, `Kept. The ${profile} reader reads an original of at most 16 MiB with this `
      + 'batch\'s own kept receipt; its kept receipt states 17 MiB, over the reader\'s 16 MiB bound, so it is not '
      + 'read or on the map; the original is kept with its SHA-256.');
    assert.doesNotMatch(item.limit_reason, /\d{5,}/);
    assert.ok(statements.includes('ROLLBACK TO SAVEPOINT intake_surface_source'));
    assert.equal(statements.filter(sql => /usp_intake_parts|INTO jobs/.test(sql)).length, 0);
  });
}
