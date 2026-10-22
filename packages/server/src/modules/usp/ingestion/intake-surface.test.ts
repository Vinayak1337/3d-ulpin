import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { INTAKE_SURFACE_VERSION, type PointBatchResult, type RasterWindowResult } from '@ulpin/contracts/usp';
import { probeOriginal } from './intake-probe';
import { fingerprint } from '../../cases/domain';
import { acceptIntakeSurfacePartTx, admitIntakeSurfaceParts, failIntakeSurfacePartTx, pointRecordsExtent,
  queueIntakeSurfaceTx, settleSurfaceItemTx, surfacePartDisplayTx, surfacePartPlacementTx, surfacePlan, surfaceReader }
  from './intake-surface';
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

type Area = { id: string; revision: number; reference: { analysisCrs: string; origin: number[] };
  extent: number[] | null; drafted?: number[] | null };

/** The area statement's answer: the stored area, its batch's drafted bounds and the key of both (SF1). */
const areaRow = (area: Area | null) => area && { ...area, drafted: area.drafted ?? null,
  key: fingerprint([area.id, area.reference, area.extent, area.drafted ?? null]) };

/**
 * An item with its first point part queued; the statements the acceptance writes, each counted. With an area, the
 * placement statement is answered as PostGIS would for a source already in the area's CRS: minus the origin, then
 * each part's envelope against the area's local extent.
 */
function ledger(area: Area | null = null, operation: 'point-batch' | 'raster-window' = 'point-batch') {
  const item: Record<string, any> = { item_id: itemId, case_id: caseId, state: 'reading', placement: 'undecided',
    plan_ref: { version: INTAKE_SURFACE_VERSION, operation, header: null }, records_seen: 0,
    limit_reason: null, parts_planned: null, parts_done: 0, family: 'point_cloud', format: 'laz',
    size_class: 'M', wave: 2, pinned_by_officer: false, parent_item_id: null };
  const parts = new Map<number, Record<string, any>>([[0, { item_id: itemId, part_index: 0, state: 'queued',
    job_id: jobId, locator: { operation, ...operation === 'point-batch' ? { batch: null } : { window: null },
      partKey: 'a'.repeat(64) }, counts: null, result_ref: null }]]);
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
    if (sql.startsWith('SELECT a.id,a.revision,a.reference,a.extent')) return one(areaRow(area));
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

test('placement binds the target EPSG code as an integer, never as a PROJ definition', async () => {
  const { client, item } = ledger(area([-200, -200, 200, 200]));
  await acceptIntakeSurfacePartTx(client, { operation: 'point-batch', jobId, resultSha256: 'c'.repeat(64),
    value: lazFirstBatch(), extent: lazBox });
  let transformed = false;
  const checked = { query: (sql: string, values: unknown[]) => {
    if (sql.startsWith('SELECT c.part,array_agg')) {
      // PostgreSQL resolves an untyped second ST_Transform argument to text, not the EPSG integer overload.
      assert.match(sql, /ST_Transform\(ST_SetSRID\(ST_MakePoint\(c\.x,c\.y\),\$4\),\$5::integer\)/);
      assert.equal(values[4], 6347);
      transformed = true;
    }
    return client.query(sql, values);
  } } as unknown as PoolClient;
  const placed = await surfacePartPlacementTx(checked, caseId, item.plan_ref.header,
    [[lazBox[0], lazBox[3]], [lazBox[2], lazBox[1]]]);
  assert.equal(placed.state, 'placed');
  assert.equal(transformed, true);
});

test('drafted bounds follow the intake package link and keep partially accepted geometry', async () => {
  const { client, item } = ledger({ ...area([0, 0, 0, 0]), extent: null, drafted: [-200, -200, 200, 200] });
  await acceptIntakeSurfacePartTx(client, { operation: 'point-batch', jobId, resultSha256: 'c'.repeat(64),
    value: lazFirstBatch(), extent: lazBox });
  const checked = { query: (sql: string, values: unknown[]) => {
    if (sql.startsWith('SELECT a.id')) {
      assert.doesNotMatch(sql, /p\.case_id=c\.id/);
      assert.match(sql, /anchor\.case_id=c\.id/);
      assert.match(sql, /anchor\.plan_ref->>'packageId'=p\.id::text/);
      assert.match(sql, /part\.state='published' AND part\.result_ref->>'packageId'=p\.id::text/);
      assert.match(sql, /NOT p\.body \? 'quarantine' OR \(p\.body->'quarantine'->>'accepted'\)::integer>0/);
    }
    return client.query(sql, values);
  } } as unknown as PoolClient;
  const placed = await surfacePartPlacementTx(checked, caseId, item.plan_ref.header,
    [[lazBox[0], lazBox[3]], [lazBox[2], lazBox[1]]]);
  assert.equal(placed.state, 'placed');
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

const sourceId = '30000000-0000-4000-8000-000000000006';
const siteId = '30000000-0000-4000-8000-000000000007';
const older = 'This part was read under an older batch context, so it is not shown as current.';
const laz = recorded.find(file => file.file === 'nyc-10013-lidar-2017.laz')!;

/** The LAZ's batch n as the reader would accept it; the first batch has its recorded extent, the others none. */
function lazBatch(n: number, points?: number) {
  const value = lazFirstBatch();
  return { operation: 'point-batch' as const, extent: n ? null : lazBox,
    value: { ...value, metadata: { ...value.metadata, sourcePointCount: points ?? value.metadata.sourcePointCount,
      batch: { start: n * 8192, count: 8192 } } } };
}

/**
 * One kept LAZ of a batch behind a fake pool, with its part rows and reader jobs. Each statement of the tick, the
 * reader's source check and enqueue, the acceptance and the tray is answered as the database would answer it.
 */
function batch(points?: number) {
  const db = { drafting: false, jobs: new Map<string, Record<string, any>>(), statements: [] as string[],
    recorded: [-200, -200, 200, 200] as number[] | null, drafted: null as number[] | null,
    current: { id: caseId, revision: 3, archived: false, frame: null as unknown, context: null,
      site_id: null as string | null } };
  const source = { id: sourceId, case_id: caseId, family_id: sourceId, revision: 1, profile: 'large-original-v1',
    sha256: laz.sha256, bytes: String(laz.bytes), object_key: `large-originals/${sourceId}/${laz.sha256}`,
    inspection: { largeOriginal: { uploadId: sourceId, operatorSubject: process.env.ULPIN_LOCAL_OPERATOR_SUBJECT,
      objectEtag: 'test_only', verifiedSha256: laz.sha256, verifiedBytes: laz.bytes,
      provenance: { origin: 'not_stated', acquiredAt: '2026-10-10T00:00:00.000Z', state: 'not_stated' },
      conversion: 'unsupported', bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed' } } };
  const item: Record<string, any> = { item_id: itemId, case_id: caseId, source_id: sourceId, state: 'planned',
    placement: 'undecided', plan_ref: { version: INTAKE_SURFACE_VERSION, operation: 'point-batch', header: null },
    records_seen: 0, limit_reason: null, parts_planned: null, parts_done: 0, family: 'point_cloud', format: 'laz',
    size_class: 'M', wave: 2 };
  const parts = new Map<number, Record<string, any>>([[0, { item_id: itemId, part_index: 0, state: 'planned',
    job_id: null, locator: { operation: 'point-batch', batch: null, partKey: 'a'.repeat(64) }, counts: null,
    result_ref: null }]]);
  const one = (row: unknown) => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
  const sorted = () => [...parts.values()].sort((a, b) => a.part_index - b.part_index);
  const pins = (jobId: string) => {
    const { caseContextSha256, accessSha256, readerSha256 } = db.jobs.get(jobId)!.payload;
    return [caseContextSha256, accessSha256, readerSha256];
  };
  const elsewhere = (part: Record<string, any>, now: string[]) => pins(part.job_id).some((v, n) => v !== now[n]);
  const area = () => db.current.site_id ? areaRow({ id: '30000000-0000-4000-8000-000000000004', revision: 2,
    reference: { analysisCrs: 'EPSG:6347', origin: [583500, 4507900] }, extent: db.recorded, drafted: db.drafted })
    : null;
  const byJob = (jobId: string) => sorted().find(part => part.job_id === jobId);
  const answer = (sql: string, values: any[]) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql) || sql.startsWith('SELECT pg_advisory_xact_lock')
      || sql.startsWith('INSERT INTO usp_job_metadata') || sql.startsWith('INSERT INTO usp_outbox')) return one({});
    if (sql.startsWith('SELECT i.item_id,i.case_id')) {
      if (sorted().some(part => part.state === 'queued')) return one(null);
      const published = sorted().filter(part => part.state === 'published');
      return one({ item_id: itemId, case_id: caseId, operation: 'point-batch',
        planned: sorted().some(part => part.state === 'planned'),
        case_now: [db.current.frame, db.current.context, db.current.site_id, db.current.archived],
        moved: Boolean(item.plan_ref.header) && (item.plan_ref.placedOn ?? null) !== (area()?.key ?? null),
        pins: published.length ? [...new Set(published.map(part => JSON.stringify(pins(part.job_id))))]
          .map(pin => JSON.parse(pin)) : null });
    }
    if (sql.startsWith('SELECT * FROM usp_intake_items') || sql.startsWith('SELECT case_id,plan_ref')
      || sql.startsWith('SELECT state,placement') || sql.startsWith('SELECT parts_planned')) return one(item);
    if (sql.startsWith('SELECT 1 FROM cases c')) return one(!db.current.site_id && db.drafting ? {} : null);
    if (sql.startsWith('SELECT id,revision,archived')) return one(db.current);
    if (sql.startsWith('SELECT * FROM sources')) return one(source);
    if (sql.startsWith('SELECT max(revision)')) return one({ revision: 1 });
    if (sql.startsWith('SELECT p.part_index,p.locator,p.result_ref')) {
      const now = values.slice(2);
      return one(sorted().some(part => part.state === 'queued') ? null : sorted().find(part =>
        part.state === 'planned' || part.state === 'published' && values[1] && elsewhere(part, now)));
    }
    if (sql.startsWith('SELECT 1 FROM jobs WHERE id=$1')) return one(db.jobs.get(values[0]));
    if (sql.startsWith('SELECT count(*)::int n FROM jobs WHERE source_id')) return one({ n: db.jobs.size });
    if (sql.startsWith('SELECT count(*)::int n FROM jobs WHERE operation')) return one({ n: [...db.jobs.values()]
      .filter(job => ['queued', 'running'].includes(job.status)).length });
    if (sql.startsWith('INSERT INTO jobs(')) {
      const [id, case_id, source_id, case_revision, input_fingerprint, payload] = values;
      db.jobs.set(id, { id, case_id, source_id, operation: 'point-batch', case_revision, input_fingerprint, payload,
        status: 'queued', error: null });
      return one({});
    }
    if (sql.startsWith('SELECT * FROM jobs WHERE id=$1') || sql.startsWith('SELECT status,error FROM jobs'))
      return one(db.jobs.get(values[0]));
    if (sql.startsWith('SELECT * FROM usp_job_metadata')) return one(null);
    // The display read's capture: the job, its metadata and the accepted attempt, as the reader accepted them.
    if (sql.startsWith('SELECT j.*,m.result_ref')) {
      const job = db.jobs.get(values[0]), digest = job && fingerprint(job.payload);
      const sha = createHash('sha256').update(values[0]).digest('hex');
      return one(job && { ...job, input_manifest_id: sourceId, input_sha256: digest, logical_state: job.status,
        scope: { kind: 'intake', workspaceId: caseId, version: job.case_revision + 1 }, accepted_fence: 1,
        result_ref: { assetId: `point:${job.id}`, version: 1, sha256: sha }, attempt_state: 'accepted',
        attempt_fence: 1, attempt_input_sha256: digest, completion_sha256: sha });
    }
    if (sql.startsWith('SELECT revision FROM cases')) return one({ revision: db.current.revision });
    if (sql.startsWith('UPDATE usp_outbox_streams')) return one({ sequence: String(db.statements.length) });
    if (sql.startsWith('UPDATE usp_intake_parts p')) {
      const marked = sorted().filter(part => part.result_ref && part.state !== 'quarantined'
        && (part.state !== 'published' || elsewhere(part, values.slice(2))));
      marked.forEach(part => { part.result_ref = { ...part.result_ref, rereadPin: values[1] }; });
      return { rows: [], rowCount: marked.length };
    }
    if (sql.startsWith('UPDATE usp_intake_items SET plan_ref=$2')) {
      item.plan_ref = values[1];
      return one({});
    }
    if (sql.startsWith("UPDATE usp_intake_parts SET state='queued'")) {
      Object.assign(parts.get(values[1])!, { state: 'queued', job_id: values[2] });
      return one({});
    }
    if (sql.startsWith('SELECT state,counts,issue_code,result_ref')) return { rows: sorted(), rowCount: parts.size };
    if (sql.startsWith('SELECT a.id,a.revision')) return one(area());
    if (sql.startsWith('SELECT count(DISTINCT auth_srid)')) return one({ n: new Set([values[0], values[1]]).size });
    if (sql.startsWith('SELECT c.part,array_agg')) return { rows: localParts(values), rowCount: 1 };
    if (sql.startsWith('UPDATE usp_intake_items SET parts_planned')) {
      Object.assign(item, { parts_planned: values[2], parts_done: values[3] });
      return one({});
    }
    if (sql.startsWith('UPDATE usp_intake_items SET state=$3')) {
      Object.assign(item, { state: values[2], placement: values[3], plan_ref: values[4], records_seen: values[5],
        limit_reason: values[6] });
      return one({});
    }
    if (sql.startsWith('SELECT item_id AS "itemId"')) return one({ itemId, state: item.state, family: item.family,
      format: item.format, sizeClass: item.size_class, wave: item.wave, pinnedByOfficer: false });
    if (sql.startsWith('SELECT p.*,i.plan_ref') || sql.startsWith('SELECT item_id,part_index,state'))
      return one(byJob(values[0]) && { ...byJob(values[0]), plan_ref: item.plan_ref });
    if (sql.startsWith('SELECT p.*,i.source_id')) return one({ ...parts.get(values[2]), source_id: sourceId,
      plan_ref: item.plan_ref });
    if (sql.startsWith("UPDATE usp_intake_parts SET state='published',job_id")) {
      const part = parts.get(values[1])!;
      if (part.result_ref?.jobId !== values[2]) return one(null);
      const { rereadPin: _pin, ...result } = part.result_ref;
      Object.assign(part, { state: 'published', job_id: values[2], result_ref: result });
      return one({});
    }
    if (sql.startsWith("UPDATE usp_intake_parts SET state='planned'")) {
      Object.assign(parts.get(values[1])!, { state: 'planned', job_id: null });
      return one({});
    }
    if (sql.startsWith("UPDATE usp_intake_parts SET state='published'")) {
      Object.assign(parts.get(values[1])!, { state: 'published', counts: values[2], result_ref: values[3] });
      return one({});
    }
    if (sql.startsWith("UPDATE usp_intake_parts SET state='quarantined'")) {
      Object.assign(parts.get(values[1])!, { state: 'quarantined', issue_code: values[2] });
      return one({});
    }
    if (sql.startsWith('INSERT INTO usp_intake_parts')) {
      (JSON.parse(values[2]) as Record<string, unknown>[]).forEach((locator, n) => parts.has(values[1] + n)
        || parts.set(values[1] + n, { item_id: itemId, part_index: values[1] + n, state: 'planned', locator }));
      return one({});
    }
    throw new Error(`Unexpected statement: ${sql.slice(0, 60)}`);
  };
  const client = { query: async (sql: string, values: any[] = []) => {
    db.statements.push(sql);
    return answer(sql, values);
  }, release: () => undefined } as unknown as PoolClient;
  /** One dispatcher tick over this pool; the statements it sent. */
  const tick = async () => {
    const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
    const previous = globals.ulpinPool, from = db.statements.length;
    globals.ulpinPool = { query: client.query, connect: async () => client };
    try {
      await admitIntakeSurfaceParts();
    } finally {
      if (previous === undefined) delete globals.ulpinPool;
      else globals.ulpinPool = previous;
    }
    return db.statements.slice(from);
  };
  /** The reader accepts the queued job of part n. */
  const accept = async (n: number) => {
    const jobId = parts.get(n)!.job_id;
    db.jobs.get(jobId)!.status = 'succeeded';
    await acceptIntakeSurfacePartTx(client, { ...lazBatch(n, points), jobId,
      resultSha256: createHash('sha256').update(jobId).digest('hex') } as never);
  };
  /** Three parts are read before the batch has an area. */
  const readThree = async () => {
    for (const n of [0, 1, 2]) {
      await tick();
      assert.equal(parts.get(n)!.state, 'queued');
      await accept(n);
    }
    assert.deepEqual(sorted().slice(0, 4).map(part => part.state), ['published', 'published', 'published', 'planned']);
    return [0, 1, 2].map(n => parts.get(n)!.job_id as string);
  };
  return { db, item, parts, client, tick, accept, readThree };
}

const contextNow = (site: string | null) => fingerprint({ frame: null, context: null, siteId: site });
const queued = (parts: Map<number, Record<string, any>>) =>
  [...parts.values()].filter(part => part.state === 'queued').map(part => part.part_index);

test('three parts read before the area binds are read again after it, one per tick, under the new context',
  async () => {
    const { db, item, parts, client, tick, accept, readThree } = batch();
    const old = await readThree();
    assert.ok(old.every(id => db.jobs.get(id)!.payload.caseContextSha256 === contextNow(null)));
    db.current.site_id = siteId;
    for (const n of [0, 1, 2]) {
      await tick();
      assert.deepEqual(queued(parts), [n]);
      const jobId = parts.get(n)!.job_id;
      assert.notEqual(jobId, old[n]);
      assert.equal(db.jobs.get(jobId)!.payload.caseContextSha256, contextNow(siteId));
      assert.match(item.limit_reason, new RegExp(`^Read again under the batch's area: ${n} of 3 parts\\. `));
      assert.equal(item.state, 'reading');
      // The part being read again keeps today's 409 words.
      await assert.rejects(surfacePartDisplayTx(client, caseId, itemId, n), { status: 409, message: older });
      await accept(n);
      assert.equal(parts.get(n)!.state, 'published');
      assert.equal(parts.get(n)!.result_ref.jobId, jobId);
      assert.deepEqual(parts.get(n)!.result_ref.earlier, [old[n]]);
    }
    assert.doesNotMatch(item.limit_reason, /Read again/);
    assert.match(item.limit_reason, /^Read 3 of 211 batches \(1726222 points, EPSG:6347\)\./);
    assert.equal(item.placement, 'on_map');
    // The old jobs stay as they were accepted: nothing is deleted.
    assert.deepEqual(old.map(id => db.jobs.get(id)?.status), ['succeeded', 'succeeded', 'succeeded']);
    assert.equal(db.jobs.size, 6);
    // Under the new context the next tick reads the next planned part.
    await tick();
    assert.deepEqual(queued(parts), [3]);
  });

test('a replayed tick queues nothing twice', async () => {
  const { db, parts, readThree, tick } = batch();
  await readThree();
  db.current.site_id = siteId;
  await tick();
  const jobs = db.jobs.size, jobId = parts.get(0)!.job_id;
  assert.equal((await tick()).length, 1);
  assert.equal(db.jobs.size, jobs);
  assert.deepEqual([queued(parts), parts.get(0)!.job_id], [[0], jobId]);
});

test('a file still waiting for its area is not read again until the area binds', async () => {
  const { db, item, parts, readThree, tick } = batch();
  const old = await readThree();
  // A footprint file of the batch is still drafting, and the batch's stated frame changed.
  db.drafting = true;
  db.current.frame = { statedBy: 'test_only' };
  const jobs = db.jobs.size;
  await tick();
  assert.equal(db.jobs.size, jobs);
  assert.deepEqual([0, 1, 2].map(n => [parts.get(n)!.state, parts.get(n)!.job_id]),
    old.map(id => ['published', id]));
  assert.doesNotMatch(item.limit_reason, /Read again/);
  db.current.site_id = siteId;
  await tick();
  assert.deepEqual(queued(parts), [0]);
});

test('when the context comes back before a read again ends, the accepted read is current again', async () => {
  const { db, item, parts, client, readThree, tick } = batch();
  const old = await readThree();
  db.current.site_id = siteId;
  await tick();
  const moved = parts.get(0)!.job_id;
  db.current.site_id = null;
  db.jobs.get(moved)!.status = 'stale';
  await failIntakeSurfacePartTx(client, moved, 'POINT_INPUT_STALE');
  assert.equal(parts.get(0)!.state, 'planned');
  await tick();
  assert.deepEqual([0, 1, 2].map(n => [parts.get(n)!.state, parts.get(n)!.job_id]),
    old.map(id => ['published', id]));
  assert.equal(parts.get(0)!.result_ref.rereadPin, undefined);
  assert.equal(item.plan_ref.reread.parts, 0);
  assert.doesNotMatch(item.limit_reason, /Read again/);
  assert.equal(item.state, 'reading');
  await tick();
  assert.deepEqual(queued(parts), [3]);
});

test('a failed read again rests quarantined with the reader\'s words and is not retried', async () => {
  const { db, item, parts, client, readThree, tick, accept } = batch();
  const old = await readThree();
  db.current.site_id = siteId;
  await tick();
  const failed = parts.get(0)!.job_id;
  Object.assign(db.jobs.get(failed)!, { status: 'failed', error: 'POINT_PROCESSING_FAILED' });
  await failIntakeSurfacePartTx(client, failed, 'POINT_PROCESSING_FAILED');
  assert.deepEqual([parts.get(0)!.state, parts.get(0)!.issue_code], ['quarantined', 'POINT_PROCESSING_FAILED']);
  assert.equal(item.state, 'failed_part');
  assert.equal(item.limit_reason,
    'A part could not be read (POINT_PROCESSING_FAILED); the original is kept with its SHA-256.');
  await assert.rejects(surfacePartDisplayTx(client, caseId, itemId, 0), { status: 409, message: older });
  for (const n of [1, 2, 3]) {
    await tick();
    assert.deepEqual(queued(parts), [n]);
    await accept(n);
  }
  assert.deepEqual([parts.get(0)!.state, parts.get(0)!.job_id], ['quarantined', failed]);
  assert.equal(db.jobs.get(old[0])!.status, 'succeeded');
});

const notYet = 'Read but not placed: the batch area has no extent yet.';
const fromDrafts = 'Placed against the extent of this batch\'s drafted footprints; '
  + 'the area has no recorded extent yet.';

test('SF1: footprints drafted after the parts were read place them at the next tick, without reading again',
  async () => {
    // The real LAZ's first two batches, as if the file held only those, so every part is read before the drafts.
    const { db, item, parts, client, tick, accept } = batch(2 * 8192);
    db.current.site_id = siteId;
    db.recorded = null;
    for (const n of [0, 1]) {
      await tick();
      await accept(n);
    }
    assert.deepEqual([item.state, item.placement], ['read', 'waiting_for_anchor']);
    assert.match(item.limit_reason, new RegExp(`^Read 2 of 2 batches .*${notYet}`));
    const before = await surfacePartDisplayTx(client, caseId, itemId, 0);
    assert.deepEqual(before.placement, { state: 'not_placed', reason: 'no_area_extent', words: notYet });
    const jobs = [...db.jobs.keys()], results = [0, 1].map(n => parts.get(n)!.result_ref);
    // The footprint file is drafted: its packages' bounds in the area's local frame.
    db.drafted = [-150, -150, 150, 150];
    await tick();
    assert.deepEqual([item.state, item.placement], ['read', 'on_map']);
    assert.match(item.limit_reason, new RegExp(`^Read 2 of 2 batches \\(16384 points, EPSG:6347\\)\\. ${fromDrafts}`));
    assert.doesNotMatch(item.limit_reason, /not placed/);
    // Nothing is read again and every earlier read is kept as it was.
    assert.deepEqual([...db.jobs.keys()], jobs);
    assert.deepEqual([0, 1].map(n => parts.get(n)!.result_ref), results);
    const display = await surfacePartDisplayTx(client, caseId, itemId, 0);
    assert.equal(display.placement.state, 'placed');
    if (display.placement.state !== 'placed') return;
    assert.deepEqual(display.placement.corners.map(c => c.map(v => Math.round(v))),
      [[-97, 141], [159, 141], [159, -144], [-97, -144]]);
    assert.match(display.placement.operation, /; area extent from the batch's drafted footprints$/);
    // Settled against that area, a replayed tick sends its one statement and writes nothing.
    assert.equal((await tick()).length, 1);
    // Once recorded, the extent is the area's own and the words no longer name the drafts.
    db.recorded = [-150, -150, 150, 150];
    db.drafted = null;
    await tick();
    assert.equal(item.placement, 'on_map');
    assert.doesNotMatch(item.limit_reason, /drafted/);
    assert.equal((await tick()).length, 1);
  });

test('SF1: a part read after the footprints are drafted is placed at once', async () => {
  const { client, item } = ledger({ ...area([0, 0, 0, 0]), extent: null, drafted: [-200, -200, 200, 200] });
  await acceptIntakeSurfacePartTx(client, { operation: 'point-batch', jobId, resultSha256: 'c'.repeat(64),
    value: lazFirstBatch(), extent: lazBox });
  assert.equal(item.placement, 'on_map');
  assert.match(item.limit_reason, new RegExp(fromDrafts));
  // Drafts inside the recorded extent widen nothing, and the words stay today's.
  const recorded = ledger({ ...area([-300, -300, 300, 300]), drafted: [-200, -200, 200, 200] });
  await acceptIntakeSurfacePartTx(recorded.client, { operation: 'point-batch', jobId, resultSha256: 'c'.repeat(64),
    value: lazFirstBatch(), extent: lazBox });
  assert.equal(recorded.item.placement, 'on_map');
  assert.doesNotMatch(recorded.item.limit_reason, /drafted/);
  // Drafts beyond it are named.
  const widened = ledger({ ...area([5000, 5000, 6000, 6000]), drafted: [-200, -200, 200, 200] });
  await acceptIntakeSurfacePartTx(widened.client, { operation: 'point-batch', jobId, resultSha256: 'c'.repeat(64),
    value: lazFirstBatch(), extent: lazBox });
  assert.equal(widened.item.placement, 'on_map');
  assert.match(widened.item.limit_reason,
    /Placed against the area's recorded extent, widened by this batch's drafted footprints\./);
});

test('SF1: a batch with no footprints keeps today\'s words, and the tick leaves it', async () => {
  const { db, item, client, tick, accept } = batch(2 * 8192);
  db.current.site_id = siteId;
  db.recorded = null;
  for (const n of [0, 1]) {
    await tick();
    await accept(n);
  }
  const words = item.limit_reason;
  assert.match(words, new RegExp(notYet));
  assert.equal(item.placement, 'waiting_for_anchor');
  assert.equal((await tick()).length, 1);
  assert.equal(item.limit_reason, words);
  const display = await surfacePartDisplayTx(client, caseId, itemId, 0);
  assert.deepEqual(display.placement, { state: 'not_placed', reason: 'no_area_extent', words: notYet });
});

/** A classic GeoTIFF's affine from its own model pixel scale and tie point (tags 33550 and 33922). */
function geoTransform(bytes: Buffer) {
  const le = bytes.toString('latin1', 0, 2) === 'II';
  const u16 = (at: number) => le ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at);
  const u32 = (at: number) => le ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at);
  const f64 = (at: number) => le ? bytes.readDoubleLE(at) : bytes.readDoubleBE(at);
  assert.equal(u16(2), 42, 'a classic TIFF');
  const ifd = u32(4), tags = new Map<number, number[]>();
  for (let n = 0; n < u16(ifd); n++) {
    const at = ifd + 2 + n * 12;
    if (u16(at + 2) === 12) tags.set(u16(at), Array.from({ length: u32(at + 4) }, (_, k) => f64(u32(at + 8) + 8 * k)));
  }
  const [sx, sy] = tags.get(33550)!, [i, j, , x, y] = tags.get(33922)!;
  return [sx, 0, x - i * sx, 0, -sy, y + j * sy];
}

/** The EPSG:3857 bounds of every coordinate of a GeoJSON in longitude and latitude (spherical Mercator). */
function mercatorBounds(geojson: unknown) {
  const box = [Infinity, Infinity, -Infinity, -Infinity], r = 6378137;
  const walk = (value: unknown): void => {
    if (!Array.isArray(value)) {
      if (value && typeof value === 'object') Object.values(value).forEach(walk);
      return;
    }
    if (typeof value[0] !== 'number') return value.forEach(walk);
    const x = r * value[0] * Math.PI / 180, y = r * Math.log(Math.tan(Math.PI / 4 + value[1] * Math.PI / 360));
    box.splice(0, 4, Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y));
  };
  walk((geojson as { features: unknown }).features);
  return box;
}

test('SF1 real NYC: the orthophoto read before its footprints are drafted is placed once they are', async t => {
  const buildings = 'E:/BhuAayam-data/task-data/nyc-zcta-10013/buildings-original.geojson';
  if (!existsSync(pack) || !existsSync(buildings)) return t.skip('The NYC pack is not on this machine.');
  const ortho = recorded.find(file => file.file === 'nyc-10013-ortho-2018.tif')!;
  const bytes = readFileSync(`${pack}/${ortho.file}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), ortho.sha256);
  const [a, b, c, d, e, f] = geoTransform(bytes);
  // The footprints' bounds in the area frame. The fake has no PostGIS, so the area's analysis CRS is the
  // orthophoto's own (test_only) and the placement statement's transform is the identity.
  const box = mercatorBounds(JSON.parse(readFileSync(buildings, 'utf8')));
  const origin = [Math.round((box[0] + box[2]) / 2), Math.round((box[1] + box[3]) / 2)];
  const held: Area = { id: '30000000-0000-4000-8000-000000000008', revision: 1,
    reference: { analysisCrs: 'EPSG:3857', origin }, extent: null, drafted: null };
  const { client, item, parts } = ledger(held, 'raster-window');
  const windows = surfacePlan({ operation: 'raster-window', value: { metadata: { sourceWidth: 768,
    sourceHeight: 768 } } as unknown as RasterWindowResult }).map(part => (part as { window: any }).window);
  const transform = (w: { x: number; y: number }) => [a, b, c + a * w.x + b * w.y, d, e, f + d * w.x + e * w.y];
  await acceptIntakeSurfacePartTx(client, { operation: 'raster-window', jobId, resultSha256: 'e'.repeat(64),
    value: { input: { sourceSha256: ortho.sha256 }, artifact: { sha256: ortho.reader.artifactSha256,
      bytes: ortho.reader.artifactBytes, mediaType: 'image/tiff' }, metadata: { sourceWidth: 768, sourceHeight: 768,
      sourceBands: 4, sourceCrsWkt: 'stated', sourceCrsAuthority: ortho.reader.crs, verticalReference: null,
      verticalReferenceStatus: 'unknown', window: windows[0], windowTransform: transform(windows[0]) } } as never });
  assert.equal(parts.size, 9);
  assert.equal(item.placement, 'waiting_for_anchor');
  assert.match(item.limit_reason, new RegExp(`^Read 1 of 9 windows \\(768 × 768 pixels, 4 bands, EPSG:3857\\)\\. `
    + notYet));
  // The footprint file is drafted; the tick settles the item again (the same call it makes).
  held.drafted = [box[0] - origin[0], box[1] - origin[1], box[2] - origin[0], box[3] - origin[1]];
  await settleSurfaceItemTx(client, itemId);
  assert.equal(item.placement, 'on_map');
  assert.match(item.limit_reason, new RegExp(fromDrafts));
  for (const window of windows) {
    const [wa, wb, wc, wd, we, wf] = transform(window), { width: w, height: h } = window;
    const at = (col: number, row: number) => [wa * col + wb * row + wc, wd * col + we * row + wf];
    const corners = [at(0, 0), at(w, 0), at(w, h), at(0, h)];
    const placed = await surfacePartPlacementTx(client, caseId, item.plan_ref.header, corners);
    assert.equal(placed.state, 'placed', JSON.stringify(window));
    if (placed.state !== 'placed') return;
    assert.deepEqual(placed.corners, corners.map(([x, y]) => [x - origin[0], y - origin[1]]));
  }
});
