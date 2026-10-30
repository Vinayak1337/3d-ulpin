import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import type { PoolClient } from 'pg';
import { INTAKE_SURFACE_VERSION, INTAKE_SURFACE_LIMITS, RASTER_WINDOW_LIMITS, POINT_BATCH_LIMITS,
  PointBatchInputSchema, type PointBatchResult, type RasterWindowResult } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { dispatchTick } from '../../cases/processing';
import { stableUuid } from './intake-run';
import { intakeItem } from './intake-ledger';
import { pointReaderSha } from './point-batch';
import { probeOriginal } from './intake-probe';
import { fingerprint } from '../../cases/domain';
import { acceptIntakeSurfacePartTx, admitIntakeSurfaceParts, failIntakeSurfacePartTx, pointRecordsExtent,
  queueIntakeSurfaceTx, settleSurfaceItemTx, surfacePartDisplayTx, surfacePartPlacementTx, surfacePlan, surfaceReader }
  from './intake-surface';
import type { IntakeSourceRow } from './intake-context';
import { sourcePartDestinationTx } from './source-building-import';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'intake-surface-protocol';
const pack = 'E:/BhuAayam-data/task-data/nyc-10013-multimodal/upload';
// The three NYC originals and what the existing native readers recorded of each at its first part (AU3).
const recorded = JSON.parse(readFileSync('docs/evidence/gf1/au3/result.json', 'utf8')).files as {
  file: string; bytes: number; sha256: string; reader: Record<string, any> }[];

/** Synthetic projected raster; these are protocol controls, not survey or registry truth. */
const rasterControl = (authority: string | null = 'EPSG:32618'): RasterWindowResult => ({
  input: { sourceSha256: 'a'.repeat(64) },
  artifact: { sha256: 'b'.repeat(64), bytes: 100, mediaType: 'image/tiff' },
  metadata: { sourceWidth: 10, sourceHeight: 10, sourceBands: 1,
    sourceCrsWkt: authority === null ? null : 'synthetic stated CRS', sourceCrsAuthority: authority,
    verticalReferenceStatus: 'unknown', verticalReference: null,
    window: { x: 0, y: 0, width: 10, height: 10 }, windowTransform: [1, 0, 500000, 0, -1, 4500010] },
} as unknown as RasterWindowResult);

/** The area/bootstrap statements answered without a runtime. Case UPDATE is an actual async gate, held until
 * COMMIT; two transactions that read the same unbound batch cannot insert two destinations. */
function bootstrapLedger() {
  const base = ledger(null, 'raster-window');
  const current = { id: caseId, name: 'test_only raster batch', site_id: null as string | null,
    archived: false, frame: { id: 'UNASSIGNED' } };
  let destination: Area | null = null, tail = Promise.resolve();
  const counts = { sites: 0, areas: 0 }, statements: string[] = [];
  const one = (row: unknown) => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
  const connect = () => {
    let release: (() => void) | undefined;
    return { release: () => undefined, query: async (sql: string, values: any[] = []) => {
      statements.push(sql);
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
        if (sql !== 'BEGIN') { release?.(); release = undefined; }
        return one({});
      }
      if (sql.startsWith('SELECT id,name,site_id,archived,frame FROM cases')) {
        assert.match(sql, /FOR UPDATE$/);
        const before = tail;
        tail = new Promise<void>(resolve => { release = resolve; });
        await before;
        return one({ ...current });
      }
      if (sql.startsWith('SELECT id,site_id,archived,frame FROM cases')) return one({ ...current });
      if (sql.startsWith('SELECT 1 FROM spatial_ref_sys')) return one(values[0] === 99999 ? null : {});
      if (sql.startsWith('WITH geographic AS')) {
        assert.match(sql, /ST_Transform\(ST_SetSRID\(ST_MakePoint\(x,y\),\$3\),4326\)/);
        assert.match(sql, /floor\(\(\(w\+e\)\/2\+180\)\/6\)/);
        assert.match(sql, /x1-x0<=50000 AND y1-y0<=50000/);
        assert.equal(values[2], 32618);
        return one({ srid: 32618, x0: 500000, y0: 4500000, width: 10, height: 10,
          lon: -75, lat: 40.65, version: 'test_only transform' });
      }
      if (sql.startsWith('INSERT INTO registry_sites')) { counts.sites++; return one({}); }
      if (sql.startsWith('INSERT INTO map_areas')) {
        counts.areas++;
        destination = { id: values[0], revision: 0, reference: values[2], extent: null };
        return one({});
      }
      if (sql.startsWith('UPDATE map_areas SET extent')) {
        assert.match(sql, /extent=\$2::jsonb/);
        assert.equal(typeof values[1], 'string', 'A jsonb extent must not be a PostgreSQL array parameter.');
        destination!.extent = JSON.parse(values[1]);
        return one({});
      }
      if (sql.startsWith('UPDATE cases SET site_id')) { current.site_id = values[1]; return one({}); }
      if (sql.startsWith('SELECT a.id,a.revision')) return one(areaRow(destination));
      if (sql.startsWith('SELECT * FROM usp_intake_items')) return one(base.item);
      if (sql.startsWith('UPDATE usp_intake_items SET plan_ref=jsonb_set')) return one({});
      if (sql.startsWith("SELECT i.plan_ref->'header'")) return one({
        authority: base.item.plan_ref.header?.authority, corners: base.parts.get(0)!.result_ref?.sourceCorners });
      if (sql.startsWith('SELECT i.item_id,i.case_id')) return one({ item_id: itemId, case_id: caseId,
        operation: 'raster-window', planned: false, pins: null,
        case_now: [current.frame, null, current.site_id, false],
        unbound: !current.site_id && Boolean(base.item.plan_ref.header?.authority),
        moved: (base.item.plan_ref.placedOn ?? null) !== (areaRow(destination)?.key ?? null) });
      return base.client.query(sql, values);
    } } as unknown as PoolClient;
  };
  const client = connect();
  const tick = async () => {
    const globals = globalThis as typeof globalThis & { ulpinPool?: unknown }, previous = globals.ulpinPool;
    globals.ulpinPool = { query: client.query, connect: async () => client };
    try { await admitIntakeSurfaceParts(); }
    finally {
      if (previous === undefined) delete globals.ulpinPool;
      else globals.ulpinPool = previous;
    }
  };
  return { ...base, client, connect, tick, counts, statements, current, area: () => destination };
}

test('a raster-only batch creates its first area on the tick, then reuses it and later vector draft bounds',
  async () => {
    const db = bootstrapLedger(), value = rasterControl(), original = structuredClone(value);
    await acceptIntakeSurfacePartTx(db.client, { operation: 'raster-window', jobId,
      resultSha256: 'c'.repeat(64), value });
    assert.equal(db.item.placement, 'waiting_for_anchor');
    await db.tick();
    assert.deepEqual(db.counts, { sites: 1, areas: 1 });
    assert.equal(db.item.placement, 'on_map');
    assert.deepEqual(db.area()!.extent, [0, 0, 10, 10]);
    assert.equal(db.area()!.reference.analysisCrs, 'EPSG:32618');
    assert.deepEqual(db.area()!.reference.origin, [500000, 4500000]);
    assert.equal(db.current.site_id, db.area()!.id);
    assert.deepEqual(value, original);
    const corners = db.parts.get(0)!.result_ref.sourceCorners;
    assert.equal((await surfacePartPlacementTx(db.client, caseId, db.item.plan_ref.header, corners)).state, 'placed');
    await db.tick();
    assert.deepEqual(db.counts, { sites: 1, areas: 1 });
    // A later vector publishes a package in this retained reference: its draft bounds widen the display extent.
    db.area()!.drafted = [-20, -30, 50, 60];
    await db.tick();
    assert.equal(db.item.placement, 'on_map');
    assert.match(db.item.limit_reason, /widened by this batch's drafted footprints/);
    assert.deepEqual(db.counts, { sites: 1, areas: 1 });
    const lock = db.statements.findIndex(sql => sql.includes('FROM cases WHERE id=$1 FOR UPDATE'));
    assert.ok(lock >= 0 && lock < db.statements.findIndex(sql => sql.startsWith('INSERT INTO registry_sites')));
  });

const sqlModule = process.env.S13X_PGLITE_MODULE
  ?? 'E:/ulpin-tmp/s7-20a/pg-test/node_modules/@electric-sql/pglite/dist/index.js';
test('the first source part stores a JSON extent using its real UPDATE in PostgreSQL', {
  skip: !existsSync(sqlModule) && 'Set S13X_PGLITE_MODULE to the isolated PGlite module.',
}, async t => {
  const { PGlite } = await import(pathToFileURL(sqlModule).href);
  const sqlDb = new PGlite();
  t.after(() => sqlDb.close());
  await sqlDb.exec('CREATE TABLE map_areas(id text PRIMARY KEY,extent jsonb)');
  const db = bootstrapLedger(), updates: string[] = [];
  const checked = { query: async (sql: string, values: any[] = []) => {
    if (sql.startsWith('INSERT INTO map_areas'))
      await sqlDb.query('INSERT INTO map_areas(id) VALUES($1)', [values[0]]);
    if (sql.startsWith('UPDATE map_areas SET extent')) {
      updates.push(sql);
      assert.equal(typeof values[1], 'string');
      assert.deepEqual(JSON.parse(values[1]), [0, 0, 10, 10]);
      assert.match(sql, /extent=\$2::jsonb/);
      await sqlDb.query(sql, values);
    }
    return db.client.query(sql, values);
  } } as unknown as PoolClient;
  assert.equal(await sourcePartDestinationTx(checked, caseId, 'EPSG:32618',
    [[500000, 4500000], [500010, 4500010]]), true);
  assert.equal(updates.length, 1);
  const rows = (await sqlDb.query('SELECT extent FROM map_areas WHERE id=$1', [db.area()!.id])).rows;
  assert.deepEqual(rows, [{ extent: [0, 0, 10, 10] }]);
  assert.equal(db.current.site_id, db.area()!.id);
});

test('the bootstrap fake refuses an array parameter for the jsonb extent', async () => {
  const db = bootstrapLedger();
  await assert.rejects(db.client.query('UPDATE map_areas SET extent=$2::jsonb WHERE id=$1',
    [itemId, [0, 0, 10, 10]]), /must not be a PostgreSQL array/);
});

test('two accepted parts racing to bind the same batch create exactly one site and area', async () => {
  const db = bootstrapLedger(), corners = [[500000, 4500000], [500010, 4500010]];
  const bind = async () => {
    const client = db.connect();
    await client.query('BEGIN');
    try { return await sourcePartDestinationTx(client, caseId, 'EPSG:32618', corners); }
    finally { await client.query('COMMIT'); }
  };
  assert.deepEqual((await Promise.all([bind(), bind()])).sort(), [false, true]);
  assert.deepEqual(db.counts, { sites: 1, areas: 1 });
  assert.equal(db.current.site_id, db.area()!.id);
});

for (const authority of [null, 'EPSG:99999', 'unresolved']) {
  test(`a first raster with CRS ${authority} stays unplaced and creates no area`, async () => {
    const db = bootstrapLedger();
    await acceptIntakeSurfacePartTx(db.client, { operation: 'raster-window', jobId,
      resultSha256: 'c'.repeat(64), value: rasterControl(authority) });
    await db.tick();
    assert.deepEqual(db.counts, { sites: 0, areas: 0 });
    assert.equal(db.item.placement, 'not_understood');
    assert.match(db.item.limit_reason, authority ? /does not resolve to an EPSG/ : /states no coordinate system/);
    assert.equal(db.current.site_id, null);
  });
}

test('a stated WKT without a resolved authority is not misreported as an unstated CRS', async () => {
  const db = bootstrapLedger(), value = rasterControl();
  value.metadata.sourceCrsAuthority = null;
  await acceptIntakeSurfacePartTx(db.client, { operation: 'raster-window', jobId,
    resultSha256: 'c'.repeat(64), value });
  await db.tick();
  assert.deepEqual(db.counts, { sites: 0, areas: 0 });
  assert.equal(db.item.placement, 'not_understood');
  assert.match(db.item.limit_reason, /stated coordinate system does not resolve/);
  assert.doesNotMatch(db.item.limit_reason, /states no coordinate system/);
});

test('each NYC original plans 9, 16 and 53 preview parts after its overview', async t => {
  const expected: Record<string, [string, number]> = { 'nyc-10013-ortho-2018.tif': ['raster-window', 9],
    'nyc-10013-dem-2017.tif': ['raster-window', 16], 'nyc-10013-lidar-2017.laz': ['point-batch', 53] };
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
    const first = plan[0];
    assert.deepEqual(first, operation === 'raster-window'
      ? { operation, window: { ...file.reader.window, step: 1 } }
      : { operation, batch: { start: 0, count: 32_768, step: 1 } }, file.file);
    assert.equal(new Set(plan.map(part => JSON.stringify(part))).size, parts, file.file);
  }
});

test('preview grids stay within 64 parts and the reader history covers three pins', () => {
  for (const [width, height] of [[1, 1], [255, 257], [2048, 2048], [2049, 2049], [100_000, 20_000]]) {
    const plan = surfacePlan({ operation: 'raster-window',
      value: { metadata: { sourceWidth: width, sourceHeight: height } } as RasterWindowResult });
    assert.ok(plan.length >= 1 && plan.length <= 64);
    const windows = plan.map(p => p.operation === 'raster-window' ? p.window! : assert.fail());
    const step = windows[0].step!;
    assert.ok(Math.ceil(Math.max(width, height) / step) <= 2048);
    assert.ok(step === 1 || Math.ceil(Math.max(width, height) / (step / 2)) > 2048);
    assert.equal(windows.reduce((sum, w) => sum + w.width * w.height, 0),
      Math.ceil(width / step) * Math.ceil(height / step));
    for (const w of windows) {
      assert.ok(w.x + (w.width - 1) * step < width);
      assert.ok(w.y + (w.height - 1) * step < height);
    }
  }
  for (const total of [1, 32_768, 2_097_152, 2_097_153, POINT_BATCH_LIMITS.sourcePoints]) {
    const plan = surfacePlan({ operation: 'point-batch',
      value: { metadata: { sourcePointCount: total } } as PointBatchResult });
    assert.ok(plan.length >= 1 && plan.length <= 64);
    const batches = plan.map(p => p.operation === 'point-batch' ? p.batch! : assert.fail());
    assert.equal(batches.reduce((sum, b) => sum + b.count, 0), Math.ceil(total / batches[0].step!));
  }
  assert.equal(RASTER_WINDOW_LIMITS.jobsPerSource, (1 + 64) * 3);
  assert.ok(POINT_BATCH_LIMITS.jobsPerSource >= 611);
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

test('ordinary LAS and LAZ versions and non-waveform formats use the point reader', () => {
  for (const version of ['1.2', '1.3', '1.4']) {
    const formats = version === '1.4' ? [0, 1, 2, 3, 6, 7, 8] : [0, 1, 2, 3];
    for (const format of formats) for (const compression of ['las', 'laz']) {
      const card = { family: 'point_cloud', format: compression, formatVersion: version,
        point: { format, scale: null }, counts: { points: 10 }, raster: null } as never;
      assert.deepEqual(surfaceReader(card, 1024), { operation: 'point-batch' }, `${compression} ${version}/${format}`);
    }
  }
});

test('above a reader limit the original is kept and the limit is named', () => {
  const card = { family: 'point_cloud', format: 'las', formatVersion: '1.3', point: { format: 4, scale: null },
    counts: { points: 10 }, raster: null };
  for (const format of [4, 5, 9, 10]) {
    const reader = surfaceReader({ ...card, point: { format, scale: null } } as never, 1024) as { limit: string };
    assert.match(reader.limit, /waveform formats 4\/5\/9\/10 are not read/);
    assert.match(reader.limit, new RegExp(`this is LAS 1\\.3 format ${format}`));
  }
  for (const formatVersion of ['1.1', '1.5']) {
    const reader = surfaceReader({ ...card, formatVersion, point: { format: 1 } } as never, 1024);
    assert.match((reader as { limit: string }).limit, /LAS 1\.2, 1\.3 or 1\.4/);
  }
  const invalid = surfaceReader({ ...card, point: { format: 6 } } as never, 1024);
  assert.match((invalid as { limit: string }).limit, /this is LAS 1\.3 format 6/);
  const readable = { ...card, point: { format: 1 }, counts: { points: POINT_BATCH_LIMITS.sourcePoints } };
  assert.deepEqual(surfaceReader(readable as never, POINT_BATCH_LIMITS.originalBytes), { operation: 'point-batch' });
  const oversized = surfaceReader(readable as never, POINT_BATCH_LIMITS.originalBytes + 1);
  assert.match((oversized as { limit: string }).limit, /point cloud of at most 1024 MiB/);
  const over = surfaceReader({ ...readable, counts: { points: POINT_BATCH_LIMITS.sourcePoints + 1 } } as never, 1024);
  assert.match((over as { limit: string }).limit, /at most 500 million points/);
  const raster = { family: 'raster', format: 'geotiff', raster: null, counts: {} };
  assert.deepEqual(surfaceReader(raster as never, 401575010), { operation: 'raster-window' });
  for (const bands of [5, 8, 64, 256])
    assert.deepEqual(surfaceReader({ ...raster, counts: { bands } } as never, 1024), { operation: 'raster-window' });
  const big = surfaceReader(raster as never, 2 * 1024 ** 3 + 1);
  assert.match((big as { limit: string }).limit, /raster of at most 2048 MiB/);
  for (const [width, height] of [[50_000, 50_000], [228_531, 131_847]]) {
    const wide = surfaceReader({ ...raster, raster: { width, height } } as never, 1024);
    assert.deepEqual(wide, { operation: 'raster-window' }, 'pixel count alone must not keep a raster off the map');
  }
});

test('a waveform source stays kept with words and queues no point part', async () => {
  const { client, item, parts } = ledger();
  item.plan_ref = null;
  parts.clear();
  const source = { id: itemId, case_id: caseId, profile: 'large-original-v1', bytes: 1024 } as IntakeSourceRow;
  const card = { family: 'point_cloud', format: 'las', formatVersion: '1.3',
    point: { format: 4, scale: null }, counts: { points: 2 }, raster: null } as never;
  const keptClient = { query: (sql: string, values: unknown[]) => sql.startsWith('SELECT * FROM usp_intake_items')
    ? { rows: [item], rowCount: 1 } : client.query(sql, values) } as unknown as PoolClient;
  assert.equal(await queueIntakeSurfaceTx(keptClient, source, card), true);
  assert.deepEqual([item.state, item.placement, item.plan_ref], ['probed', 'not_understood', null]);
  assert.match(item.limit_reason, /waveform formats 4\/5\/9\/10 are not read/);
  assert.match(item.limit_reason, /the original is kept with its SHA-256/);
  assert.equal(parts.size, 0);
});

test('a native format-6 batch gives the XY extent of its records', () => {
  const records = Buffer.alloc(60);
  records.writeInt32LE(100, 0); records.writeInt32LE(-50, 4);
  records.writeInt32LE(300, 30); records.writeInt32LE(20, 34);
  assert.deepEqual(pointRecordsExtent(records, [0.5, 0.5, 0.5], [500, 4000, 0]), [550, 3975, 650, 4010]);
  assert.equal(pointRecordsExtent(new Uint8Array(0), [1, 1, 1], [0, 0, 0]), null);
  for (const length of [20, 26, 28, 34, 36, 38]) {
    const native = Buffer.alloc(2 * length);
    native.writeInt32LE(100, 0); native.writeInt32LE(-50, 4);
    native.writeInt32LE(300, length); native.writeInt32LE(20, length + 4);
    assert.deepEqual(pointRecordsExtent(native, [0.5, 0.5, 0.5], [500, 4000, 0], length),
      [550, 3975, 650, 4010]);
  }
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
    if (sql.startsWith('SELECT 1 FROM spatial_ref_sys')) return one({});
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
  assert.equal(parts.size, 54);
  assert.equal(parts.get(0)!.state, 'published');
  assert.equal(parts.get(0)!.locator.batch, null);
  assert.deepEqual(parts.get(53)!.locator.batch, { start: 52 * 32_768, count: 1726222 - 52 * 32_768, step: 1 });
  assert.equal(new Set([...parts.values()].map(part => part.locator.partKey)).size, 54);
  assert.deepEqual([item.state, item.placement, item.parts_planned, item.parts_done, item.records_seen],
    ['reading', 'waiting_for_anchor', 54, 1, 8192]);
  assert.equal(item.plan_ref.header.vertical.status, 'known');
  assert.match(item.limit_reason, /^Read 1 of 54 batches \(1726222 points, EPSG:6347\)\./);
  assert.match(item.limit_reason, /every 1st point/);
  assert.match(item.limit_reason, /Display only: no height, measurement or record is taken from it\.$/);
  const after = { ...count };
  await acceptIntakeSurfacePartTx(client, accepted);
  assert.deepEqual(count, after);
  assert.equal(parts.size, 54);
});

test('the stated NYC COPC count plans 62 batches at step 6 through the source tail', async () => {
  const { client, item, parts } = ledger();
  const value = lazFirstBatch(), total = 12_036_869, overviewStep = Math.ceil(total / 32_768);
  // A stated-size acceptance control, not a native read of the COPC or an evaluation truth.
  value.metadata = { ...value.metadata, sourcePointCount: total,
    batch: { start: 0, count: Math.ceil(total / overviewStep), step: overviewStep } };
  await acceptIntakeSurfacePartTx(client, { operation: 'point-batch', jobId, resultSha256: 'c'.repeat(64),
    value, extent: null });
  assert.equal(parts.size, 63);
  assert.deepEqual(item.plan_ref.header.preview, { step: 6 });
  assert.deepEqual([item.plan_ref.header.planned, item.plan_ref.header.total], [63, 63]);
  assert.match(item.limit_reason, /every 6th point/);
  for (let k = 0; k < 62; k++) {
    const batch = parts.get(k + 1)!.locator.batch;
    assert.deepEqual(batch, { start: k * 32_768 * 6,
      count: Math.min(32_768, Math.ceil((total - k * 32_768 * 6) / 6)), step: 6 });
    assert.ok(batch.start + (batch.count - 1) * batch.step < total);
  }
  const last = parts.get(62)!.locator.batch;
  assert.ok(last.start + last.count * last.step >= total);
  assert.equal(parts.get(0)!.locator.batch, null);
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
    const limitMiB = profile === 'raster' ? 2048 : POINT_BATCH_LIMITS.originalBytes / 1024 ** 2;
    const sha = 'd'.repeat(64), sourceId = '30000000-0000-4000-8000-000000000005';
    const over = (limitMiB + 1) * 1024 ** 2;
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
    assert.equal(item.limit_reason, `Kept. The ${profile} reader reads an original of at most ${limitMiB} MiB `
      + `with this batch's own kept receipt; its kept receipt states ${limitMiB + 1} MiB, `
      + `over the reader's ${limitMiB} MiB bound, so it is not read or on the map; `
      + 'the original is kept with its SHA-256.');
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
function batch(points?: number, operation: 'point-batch' | 'raster-window' = 'point-batch', preview = false) {
  const original = operation === 'point-batch' ? laz
    : recorded.find(file => file.file === 'nyc-10013-ortho-2018.tif')!;
  const db = { clock: 0, drafting: false, jobs: new Map<string, Record<string, any>>(), statements: [] as string[],
    recorded: [-200, -200, 200, 200] as number[] | null, drafted: null as number[] | null,
    current: { id: caseId, revision: 3, archived: false, frame: null as unknown, context: null,
      site_id: null as string | null } };
  const source = { id: sourceId, case_id: caseId, family_id: sourceId, revision: 1, profile: 'large-original-v1',
    sha256: original.sha256, bytes: String(original.bytes),
    object_key: `large-originals/${sourceId}/${original.sha256}`,
    inspection: { largeOriginal: { uploadId: sourceId, operatorSubject: process.env.ULPIN_LOCAL_OPERATOR_SUBJECT,
      objectEtag: 'test_only', verifiedSha256: original.sha256, verifiedBytes: original.bytes,
      provenance: { origin: 'not_stated', acquiredAt: '2026-10-10T00:00:00.000Z', state: 'not_stated' },
      conversion: 'unsupported', bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed' } } };
  const item: Record<string, any> = { item_id: itemId, case_id: caseId, source_id: sourceId, state: 'planned',
    placement: 'undecided', plan_ref: { version: INTAKE_SURFACE_VERSION, operation, header: null },
    records_seen: 0, limit_reason: null, parts_planned: null, parts_done: 0,
    family: operation === 'point-batch' ? 'point_cloud' : 'raster',
    format: operation === 'point-batch' ? 'laz' : 'geotiff',
    size_class: 'M', wave: 2, parent_item_id: null, member_path: null, name: original.file,
    size_bytes: original.bytes, card: null, card_sha256: null, probe_version: null, pinned_by_officer: false,
    created_at: '2026-10-11T00:00:00.000Z', updated_at: '2026-10-11T00:00:00.000Z' };
  const parts = new Map<number, Record<string, any>>([[0, { item_id: itemId, part_index: 0, state: 'planned',
    job_id: null, locator: { operation, ...operation === 'point-batch' ? { batch: null } : { window: null },
      partKey: 'a'.repeat(64) }, counts: null,
    result_ref: null }]]);
  // Historical point plans keep their old header and parts; preview=true starts before first acceptance.
  if (operation === 'point-batch' && !preview) {
    const m = lazFirstBatch().metadata, total = points ?? m.sourcePointCount;
    const all = Math.ceil(total / 8192), planned = Math.min(all, POINT_BATCH_LIMITS.jobsPerSource);
    item.plan_ref.header = { operation, crsStated: true, authority: m.horizontalAuthority,
      vertical: { status: m.verticalReferenceStatus, name: m.verticalReference }, size: [total], planned, total: all };
    for (let n = 1; n < planned; n++) parts.set(n, { item_id: itemId, part_index: n, state: 'planned',
      locator: { operation, batch: { start: n * 8192, count: Math.min(8192, total - n * 8192) },
        partKey: fingerprint({ sourceSha256: source.sha256, part: n }) } });
  }
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
      return one({ item_id: itemId, case_id: caseId, operation,
        planned: sorted().some(part => part.state === 'planned'),
        case_now: [db.current.frame, db.current.context, db.current.site_id, db.current.archived],
        moved: Boolean(item.plan_ref.header) && (item.plan_ref.placedOn ?? null) !== (area()?.key ?? null),
        pins: published.length ? [...new Set(published.map(part => JSON.stringify(pins(part.job_id))))]
          .map(pin => JSON.parse(pin)) : null });
    }
    if (sql.startsWith('SELECT * FROM usp_intake_items') || sql.startsWith('SELECT case_id,plan_ref')
      || sql.startsWith('SELECT state,placement') || sql.startsWith('SELECT parts_planned')) return one(item);
    if (sql.startsWith('SELECT 1 FROM cases c')) {
      // A file still preparing its packages keeps the batch waiting for its area, as a reading one does.
      assert.match(sql, /'reading','preparing'\)/);
      return one(!db.current.site_id && db.drafting ? {} : null);
    }
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
      db.jobs.set(id, { id, case_id, source_id, operation, case_revision, input_fingerprint, payload,
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
    if (sql.startsWith('UPDATE usp_intake_items SET plan_ref=jsonb_set')) {
      assert.doesNotMatch(sql, /updated_at/);
      assert.match(sql, /admissionTriedAt/);
      item.plan_ref.admissionTriedAt = new Date(Date.UTC(2026, 9, 11) + ++db.clock).toISOString();
      return one({});
    }
    if (sql.includes("SET plan_ref=plan_ref-'admissionIssue'")) {
      delete item.plan_ref.admissionIssue;
      delete item.plan_ref.admissionSqlState;
      return one({});
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
    if (sql.startsWith('SELECT 1 FROM spatial_ref_sys')) return one({});
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
    if (sql.startsWith('UPDATE usp_intake_items') && sql.includes('updated_at='))
      item.updated_at = new Date(Date.UTC(2026, 9, 11) + ++db.clock).toISOString();
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
    const job = db.jobs.get(jobId)!;
    job.status = 'succeeded';
    const accepted = lazBatch(n, points), total = accepted.value.metadata.sourcePointCount;
    const step = Math.ceil(total / POINT_BATCH_LIMITS.batchPoints);
    accepted.value.metadata.batch = job.payload.batch ?? { start: 0, count: Math.ceil(total / step), step };
    await acceptIntakeSurfacePartTx(client, { ...accepted, jobId,
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

for (const stated of [false, true]) test(`every point display keeps the first header range (stated=${stated})`,
  async () => {
    const { db, item, parts, client, tick } = batch(undefined, 'point-batch', true);
    await tick();
    const firstJob = parts.get(0)!.job_id, value = lazFirstBatch();
    // Synthetic header control: native Z = raw Z * 0.5 + 100, never sampled from point records.
    if (stated) Object.assign(value.metadata, { scale: [1, 1, 0.5], offset: [0, 0, 100],
      sourceBounds: [0, 0, 90, 1, 1, 150] });
    db.jobs.get(firstJob)!.status = 'succeeded';
    await acceptIntakeSurfacePartTx(client, { operation: 'point-batch', jobId: firstJob, value, extent: lazBox,
      resultSha256: createHash('sha256').update(firstJob).digest('hex') });
    const range = item.plan_ref.header.valueRange;
    if (stated) assert.deepEqual([range.kind, range.low, range.high], ['z', -20, 100]);
    else assert.equal(range, undefined);
    await tick();
    const nextJob = parts.get(1)!.job_id;
    db.jobs.get(nextJob)!.status = 'succeeded';
    await acceptIntakeSurfacePartTx(client, { operation: 'point-batch', jobId: nextJob, value, extent: lazBox,
      resultSha256: createHash('sha256').update(nextJob).digest('hex') });
    const before = JSON.stringify([...parts.values()]);
    for (const n of [0, 1]) {
      const display = await surfacePartDisplayTx(client, caseId, itemId, n);
      assert.deepEqual(display.valueRange, range);
      if (!stated) assert.equal('valueRange' in JSON.parse(JSON.stringify(display)), false);
    }
    assert.equal(JSON.stringify([...parts.values()]), before, 'Display never changes stored parts or hashes.');
  });

const contextNow = (site: string | null) => fingerprint({ frame: null, context: null, siteId: site });
const queued = (parts: Map<number, Record<string, any>>) =>
  [...parts.values()].filter(part => part.state === 'queued').map(part => part.part_index);

test('an overview queues while the vector drafts; part 1 waits, then part 0 is reread under the area', async () => {
  const { db, item, parts, tick, accept } = batch(undefined, 'point-batch', true);
  db.drafting = true;
  await tick();
  assert.deepEqual(queued(parts), [0]);
  const first = parts.get(0)!.job_id;
  assert.equal(db.jobs.get(first)!.payload.batch, null);
  await accept(0);
  await tick();
  assert.deepEqual(queued(parts), []);
  assert.equal(parts.get(1)!.state, 'planned');
  db.current.site_id = siteId;
  await tick();
  assert.deepEqual(queued(parts), [0]);
  assert.notEqual(parts.get(0)!.job_id, first);
  assert.equal(db.jobs.get(parts.get(0)!.job_id)!.payload.batch, null);
  await accept(0);
  assert.deepEqual(item.plan_ref.header.preview, { step: 1 });
  await tick();
  assert.deepEqual(queued(parts), [1]);
});

test('a legacy raster keeps its header and parts and rereads the explicit old first window', async t => {
  if (!existsSync(pack)) return t.skip('The NYC pack is not on this machine.');
  const transform = geoTransform(readFileSync(`${pack}/nyc-10013-ortho-2018.tif`));
  const { db, item, parts, tick, client } = batch(undefined, 'raster-window');
  item.plan_ref.header = { operation: 'raster-window', crsStated: false, authority: null,
    vertical: { status: 'unknown', name: null }, size: [768, 768, 4], planned: 9, total: 9 };
  for (let n = 1; n < 9; n++) parts.set(n, { item_id: itemId, part_index: n, state: 'planned',
    locator: { operation: 'raster-window', window: { x: n % 3 * 256, y: Math.floor(n / 3) * 256,
      width: 256, height: 256 }, partKey: fingerprint({ part: n }) } });
  const header = structuredClone(item.plan_ref.header);
  const locators = structuredClone([...parts.values()].map(p => p.locator));
  await tick();
  const job = db.jobs.get(parts.get(0)!.job_id)!;
  assert.deepEqual(job.payload.window, { x: 0, y: 0, width: 256, height: 256 });
  // Acceptance of a reread must not replan a legacy item or add preview words.
  const ortho = recorded.find(file => file.file === 'nyc-10013-ortho-2018.tif')!;
  await acceptIntakeSurfacePartTx(client, { operation: 'raster-window', jobId: job.id,
    resultSha256: 'e'.repeat(64), value: { input: { sourceSha256: ortho.sha256 },
      artifact: { sha256: ortho.reader.artifactSha256, bytes: ortho.reader.artifactBytes, mediaType: 'image/tiff' },
      metadata: { window: job.payload.window, windowTransform: transform } } as never });
  assert.deepEqual(item.plan_ref.header, header);
  assert.deepEqual([...parts.values()].map(p => p.locator), locators);
  assert.equal(parts.size, 9);
  assert.doesNotMatch(item.limit_reason, /preview/);
});

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
      if (n === 0) assert.deepEqual(db.jobs.get(jobId)!.payload.batch, { start: 0, count: 8192 });
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

test('part 0 can be read again while the area is drafting; later parts still wait', async () => {
  const { db, parts, readThree, tick, accept } = batch();
  const old = await readThree();
  // A footprint file of the batch is still drafting, and the batch's stated frame changed.
  db.drafting = true;
  db.current.frame = { statedBy: 'test_only' };
  const jobs = db.jobs.size;
  await tick();
  assert.equal(db.jobs.size, jobs + 1);
  assert.deepEqual(queued(parts), [0]);
  assert.notEqual(parts.get(0)!.job_id, old[0]);
  await accept(0);
  await tick();
  assert.equal(db.jobs.size, jobs + 1);
  assert.deepEqual(queued(parts), []);
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

/** Metadata-only acceptance control using the real ortho's affine; the stated dimensions may be varied. */
function rasterFirstRead(width: number, height: number, transform: number[]): RasterWindowResult {
  const ortho = recorded.find(file => file.file === 'nyc-10013-ortho-2018.tif')!;
  const [a, b, c, d, e, f] = transform, step = Math.ceil(Math.max(width, height) / 256);
  return { input: { sourceSha256: ortho.sha256 }, artifact: { sha256: ortho.reader.artifactSha256,
    bytes: ortho.reader.artifactBytes, mediaType: 'image/tiff' }, metadata: { sourceWidth: width, sourceHeight: height,
    sourceBands: 4, sourceCrsWkt: 'stated', sourceCrsAuthority: ortho.reader.crs, verticalReference: null,
    verticalReferenceStatus: 'unknown', window: { x: 0, y: 0, width: Math.ceil(width / step),
      height: Math.ceil(height / step), step }, windowTransform: [a * step, b * step, c, d * step, e * step, f] }
  } as unknown as RasterWindowResult;
}

test('only a one-band overview with stated min and max keeps a band display range', async () => {
  for (const [bands, stated] of [[1, true], [1, false], [3, true]] as const) {
    const { client, item, parts } = ledger(null, 'raster-window');
    // Synthetic metadata-only control; no pixels or native-reader result are invented as evaluation truth.
    const value = rasterFirstRead(512, 256, [1, 0, 0, 0, -1, 0]);
    Object.assign(value.metadata, { sourceBands: bands,
      bands: [{ index: 1, dtype: 'float32', nodata: null, ...(stated ? { validMin: -20, validMax: 100 } : {}) }] });
    await acceptIntakeSurfacePartTx(client, { operation: 'raster-window', jobId, value,
      resultSha256: 'e'.repeat(64) });
    const range = item.plan_ref.header.valueRange;
    if (bands === 1 && stated) assert.deepEqual([range.kind, range.low, range.high], ['band', -20, 100]);
    else assert.equal(range, undefined);
    parts.get(1)!.job_id = jobId;
    parts.get(0)!.job_id = null;
    value.metadata.bands[0].validMin = 40;
    await acceptIntakeSurfacePartTx(client, { operation: 'raster-window', jobId, value,
      resultSha256: 'f'.repeat(64) });
    assert.deepEqual(item.plan_ref.header.valueRange, range, 'Later part ranges never replace the item range.');
  }
});

test('a stated 40000 by 30000 raster plans 5 by 4 tiles at step 32, all inside its source', async t => {
  if (!existsSync(pack)) return t.skip('The NYC pack is not on this machine.');
  const transform = geoTransform(readFileSync(`${pack}/nyc-10013-ortho-2018.tif`));
  const { client, item, parts } = ledger(null, 'raster-window');
  await acceptIntakeSurfacePartTx(client, { operation: 'raster-window', jobId, resultSha256: 'e'.repeat(64),
    value: rasterFirstRead(40_000, 30_000, transform) });
  assert.equal(parts.size, 21);
  assert.deepEqual(item.plan_ref.header.preview, { step: 32 });
  assert.match(item.limit_reason, /A preview at 1:32/);
  assert.equal(parts.get(0)!.locator.window, null);
  for (let k = 0; k < 20; k++) {
    const w = parts.get(k + 1)!.locator.window, x = k % 5 * 256 * 32, y = Math.floor(k / 5) * 256 * 32;
    assert.deepEqual(w, { x, y, width: Math.min(256, Math.ceil((40_000 - x) / 32)),
      height: Math.min(256, Math.ceil((30_000 - y) / 32)), step: 32 });
    assert.ok(w.x + (w.width - 1) * w.step < 40_000);
    assert.ok(w.y + (w.height - 1) * w.step < 30_000);
  }
});

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
    value: rasterFirstRead(768, 768, [a, b, c, d, e, f]) });
  assert.equal(parts.size, 10);
  assert.deepEqual(item.plan_ref.header.preview, { step: 1 });
  assert.equal(item.placement, 'waiting_for_anchor');
  assert.match(item.limit_reason, /A preview at 1:1 \(full resolution\)/);
  assert.match(item.limit_reason, new RegExp(notYet));
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

type AdmissionItem = { world: ReturnType<typeof batch>; failure?: unknown;
  failAfterEnqueue?: boolean; failIssueWrite?: boolean };

/** Restore the SQL double's item, parts and jobs when the owning transaction rolls back. */
function surfaceRollback(entry: AdmissionItem) {
  const { item, parts, db } = entry.world;
  const saved = structuredClone({ item, parts, jobs: db.jobs });
  return () => {
    for (const key of Object.keys(item)) delete item[key];
    Object.assign(item, saved.item);
    parts.clear();
    for (const [index, part] of saved.parts) parts.set(index, part);
    db.jobs.clear();
    for (const [id, job] of saved.jobs) db.jobs.set(id, job);
  };
}

function surfaceConnection(entries: AdmissionItem[]) {
  let entry: AdmissionItem | undefined, rollback: (() => void) | undefined;
  return { release: () => {}, query: async (sql: string, values: any[] = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) {
      if (sql === 'ROLLBACK') rollback?.();
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT * FROM usp_intake_items')) {
      entry = entries[Number(values[0].slice(4))];
      rollback = surfaceRollback(entry);
      if (sql.endsWith('FOR UPDATE') && entry.failIssueWrite) throw new Error('PRIVATE_ISSUE_TEXT');
    }
    assert.ok(entry, 'Each transaction addresses its own item.');
    if (entry.failure && (entry.failAfterEnqueue ? sql.startsWith('SELECT status,error FROM jobs')
      : sql.startsWith('SELECT * FROM sources'))) throw entry.failure;
    if (sql.startsWith('SELECT count(*)::int n FROM jobs WHERE operation')) {
      const operation = entry.world.item.plan_ref.operation;
      const n = entries.flatMap(value => [...value.world.db.jobs.values()])
        .filter(job => job.operation === operation && ['queued', 'running'].includes(job.status)).length;
      return { rows: [{ n }], rowCount: 1 };
    }
    return entry.world.client.query(sql, values);
  } };
}

/** Multiplex the existing SQL double into independent items; reader capacity is shared across them. */
async function withSurfaces(entries: AdmissionItem[], run: () => Promise<void>) {
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
  const previous = globals.ulpinPool;
  const query = async (sql: string, values: any[] = []) => {
    if (sql.startsWith('SELECT i.item_id,i.case_id')) {
      const rows = [];
      for (const [index, entry] of entries.entries()) {
        const due = await entry.world.client.query(sql, values);
        rows.push(...due.rows.map(row => ({ ...row, item_id: `due-${String(index).padStart(4, '0')}` })));
      }
      if (sql.includes("ORDER BY i.plan_ref->>'admissionTriedAt' NULLS FIRST,i.item_id")) rows.sort((a, b) => {
        const marker = (id: string) => entries[Number(id.slice(4))].world.item.plan_ref.admissionTriedAt ?? '';
        return marker(a.item_id).localeCompare(marker(b.item_id)) || a.item_id.localeCompare(b.item_id);
      });
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  };
  globals.ulpinPool = { query, connect: async () => surfaceConnection(entries) };
  try { await run(); }
  finally {
    if (previous === undefined) delete globals.ulpinPool;
    else globals.ulpinPool = previous;
  }
}

/** Stored by 6323b054: the reader hash, locator key and stable id predate LP1; input has no recordLength. */
async function preLp1Point() {
  const world = batch();
  await world.readThree();
  const reader = '2d53cd71d81e62199948a52d73fd4dddd4dc6e408743d9dccee25524b968e763';
  const jobs = [...world.db.jobs.values()];
  world.db.jobs.clear();
  for (const part of world.parts.values()) {
    const { partKey: _old, ...locator } = part.locator;
    part.locator.partKey = fingerprint({ version: INTAKE_SURFACE_VERSION, sourceSha256: laz.sha256,
      readerSha256: reader, locator });
    if (part.state !== 'published') continue;
    const job = jobs.find(job => job.id === part.job_id)!;
    const pin = fingerprint({ context: job.payload.caseContextSha256, access: job.payload.accessSha256 });
    const id = stableUuid(`${INTAKE_SURFACE_VERSION}:${itemId}:1:${part.locator.partKey}:${pin}`);
    job.id = id;
    job.payload = PointBatchInputSchema.parse({ ...job.payload, jobId: id, readerSha256: reader });
    assert.equal(Object.hasOwn(job.payload, 'recordLength'), false);
    job.input_fingerprint = fingerprint(job.payload);
    part.job_id = id;
    part.result_ref.jobId = id;
    world.db.jobs.set(id, job);
  }
  return world;
}

test('one dispatcher tick admits a new TIF and LAZ beside a pre-LP1 item, without reusing its old reader job',
  async () => {
    const old = await preLp1Point(), tif = batch(undefined, 'raster-window'), fresh = batch();
    const earlier = [...old.db.jobs.values()].map(job => structuredClone(job));
    const from = old.db.statements.length;
    await withSurfaces([{ world: old }, { world: tif }, { world: fresh }], async () => {
      assert.equal(await dispatchTick(), 0);
      // LQ1: the tick starts its one surface admission pass without awaiting it; let that pass finish here.
      for (let turn = 0; turn < 100 && [old, tif, fresh].some(world => !queued(world.parts).length); turn++)
        await new Promise(resolve => setImmediate(resolve));
    });
    assert.deepEqual(queued(tif.parts), [0]);
    assert.deepEqual(queued(fresh.parts), [0]);
    assert.deepEqual(queued(old.parts), [0]);
    assert.equal(old.db.jobs.get(old.parts.get(0)!.job_id)!.payload.readerSha256, pointReaderSha());
    assert.equal(old.db.jobs.size, earlier.length + 1);
    for (const job of earlier) assert.deepEqual(old.db.jobs.get(job.id), job);
    assert.equal(old.parts.size, 211);
    for (const world of [old, tif, fresh]) {
      assert.equal(world.item.plan_ref.admissionTriedAt, undefined);
      const statements = world.db.statements.slice(world === old ? from : 0);
      assert.ok(!statements.some(sql => sql.startsWith('UPDATE') && /admissionTriedAt|clock_timestamp/.test(sql)),
        'Progress adds no fairness or timestamp write beyond admission itself.');
    }
  });

for (const failure of [new Error('PRIVATE_SOURCE_TEXT'), new AppError(500, 'SURFACE_TEST_FAULT', 'PRIVATE_TEXT')]) {
  test(`an ${failure.name} on one item records an admission issue and still admits later surfaces`, async () => {
    const old = await preLp1Point(), tif = batch(undefined, 'raster-window'), fresh = batch();
    const before = intakeItem(old.item);
    await withSurfaces([{ world: old, failure }, { world: tif }, { world: fresh }], admitIntakeSurfaceParts);
    assert.deepEqual(queued(tif.parts), [0]);
    assert.deepEqual(queued(fresh.parts), [0]);
    assert.equal(old.parts.get(3)!.state, 'planned');
    assert.equal(old.db.jobs.size, 3);
    assert.equal(old.item.plan_ref.admissionIssue,
      failure instanceof AppError ? 'SURFACE_TEST_FAULT' : 'SURFACE_ADMISSION_FAILED');
    assert.match(old.item.limit_reason, /Admission deferred/);
    const after = intakeItem(old.item);
    assert.notEqual(after.limitReason, before.limitReason);
    assert.notEqual(after.updatedAt, before.updatedAt);
    assert.ok(Date.parse(old.item.plan_ref.admissionTriedAt));
    assert.doesNotMatch(old.item.limit_reason, /PRIVATE|unsupported|could not be read/);
  });
}

for (const [state, expected] of [['22P02', '22P02'], ['23505', '23505'], ['42p01', '42p01'],
  ['22P02\n', undefined], ['22P0', undefined], ['22P020', undefined], ['22P_2', undefined],
  [22002, undefined], [undefined, undefined]] as const) {
  test(`admission retains only a five-character SQLSTATE (${JSON.stringify(state)}) and no error text`, async () => {
    const world = batch(), failure = Object.assign(new Error('PRIVATE_SQL_MESSAGE'), {
      code: state, detail: 'PRIVATE_SQL_DETAIL', query: 'PRIVATE_SQL_QUERY',
    });
    const entry: AdmissionItem = { world, failure };
    await withSurfaces([entry], async () => {
      await admitIntakeSurfaceParts();
      assert.equal(world.item.plan_ref.admissionIssue, 'SURFACE_ADMISSION_FAILED');
      assert.equal(world.item.plan_ref.admissionSqlState, expected);
      assert.doesNotMatch(JSON.stringify(world.item), /PRIVATE_SQL/);
      assert.doesNotMatch(JSON.stringify(intakeItem(world.item)), /admissionSqlState|22P02|23505|42p01/);
      // A later non-database error must not keep the previous database diagnosis.
      entry.failure = new Error('PRIVATE_NEXT_MESSAGE');
      await admitIntakeSurfaceParts();
      assert.equal(world.item.plan_ref.admissionSqlState, undefined);
      assert.doesNotMatch(JSON.stringify(world.item), /PRIVATE_/);
    });
  });
}

test('an application error keeps its own code, not a SQLSTATE', async () => {
  const world = batch(), failure = new AppError(500, 'ABCDE', 'PRIVATE_APPLICATION_MESSAGE');
  await withSurfaces([{ world, failure }], admitIntakeSurfaceParts);
  assert.equal(world.item.plan_ref.admissionIssue, 'ABCDE');
  assert.equal(world.item.plan_ref.admissionSqlState, undefined);
  assert.doesNotMatch(JSON.stringify(world.item), /PRIVATE_APPLICATION/);
});

test('a failure after enqueue rolls back the new job and keeps a deferred item retryable', async () => {
  const old = batch(), tif = batch(undefined, 'raster-window'), fresh = batch();
  const entry: AdmissionItem = { world: old,
    failure: Object.assign(new Error('PRIVATE_ENQUEUE_TEXT'), { code: '22P02' }), failAfterEnqueue: true };
  await withSurfaces([entry, { world: tif }, { world: fresh }], async () => {
    await admitIntakeSurfaceParts();
    assert.equal(old.db.jobs.size, 0);
    assert.equal(old.parts.get(0)!.state, 'planned');
    assert.equal(old.item.plan_ref.admissionIssue, 'SURFACE_ADMISSION_FAILED');
    assert.equal(old.item.plan_ref.admissionSqlState, '22P02');
    assert.deepEqual(queued(tif.parts), [0]);
    assert.deepEqual(queued(fresh.parts), [0]);
    entry.failure = undefined;
    const from = old.db.statements.length;
    await admitIntakeSurfaceParts();
    const recovery = old.db.statements.slice(from);
    const authority = recovery.findIndex(sql => sql.startsWith('SELECT * FROM sources'));
    const clear = recovery.findIndex(sql => sql.includes("plan_ref=plan_ref-'admissionIssue'"));
    assert.ok(authority >= 0 && clear > authority, 'Recovery preserves source-before-item lock order.');
  });
  assert.equal(old.db.jobs.size, 1);
  assert.deepEqual(queued(old.parts), [0]);
  assert.equal(old.item.plan_ref.admissionIssue, undefined);
  assert.equal(old.item.plan_ref.admissionSqlState, undefined);
  assert.doesNotMatch(old.item.limit_reason, /deferred|PRIVATE|could not be read/);
});

test('even failed issue recording does not block later surfaces or log exception content', async () => {
  const old = batch(), tif = batch(undefined, 'raster-window'), fresh = batch();
  const messages: string[] = [], warn = console.warn;
  console.warn = message => messages.push(String(message));
  try {
    await withSurfaces([{ world: old, failure: new Error('PRIVATE_SOURCE_TEXT'), failIssueWrite: true },
      { world: tif }, { world: fresh }], admitIntakeSurfaceParts);
  } finally { console.warn = warn; }
  assert.deepEqual(queued(tif.parts), [0]);
  assert.deepEqual(queued(fresh.parts), [0]);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /SURFACE_ADMISSION_FAILED.*could not be recorded/);
  assert.doesNotMatch(messages[0], /PRIVATE/);
});

test('an invalid stored locator is quarantined as an admission defect, not a reader refusal', async () => {
  const old = batch(), tif = batch(undefined, 'raster-window'), fresh = batch();
  old.parts.get(0)!.locator.batch = { start: -1, count: 8192 };
  await withSurfaces([{ world: old }, { world: tif }, { world: fresh }], admitIntakeSurfaceParts);
  assert.deepEqual(queued(tif.parts), [0]);
  assert.deepEqual(queued(fresh.parts), [0]);
  assert.equal(old.parts.get(0)!.issue_code, 'SURFACE_LOCATOR_INVALID');
  assert.equal(old.item.state, 'failed_part');
  assert.match(old.item.limit_reason, /stored locator is invalid/);
  assert.doesNotMatch(old.item.limit_reason, /unsupported|could not be read/);
  assert.equal(old.db.jobs.size, 0);
});

async function waitingBatch() {
  const world = batch();
  await world.tick();
  await world.accept(0);
  world.db.drafting = true;
  return world;
}

test('a no-progress tick changes only its private fairness marker, not the public item or updatedAt', async () => {
  const world = await waitingBatch();
  const before = intakeItem(world.item), updated = world.item.updated_at, clock = world.db.clock;
  for (let n = 0; n < 2; n++) {
    const statements = await world.tick();
    assert.equal(world.item.updated_at, updated);
    assert.deepEqual(intakeItem(world.item), before);
    assert.equal(world.item.plan_ref.admissionTriedAt,
      new Date(Date.UTC(2026, 9, 11) + clock + n + 1).toISOString());
    assert.equal(statements.filter(sql => /^(INSERT|UPDATE)/.test(sql)).length, 1);
    assert.ok(!statements.some(sql => sql.includes('updated_at=')));
  }
});

test('a busy reader changes only the private marker and keeps the planned part', async () => {
  const world = batch();
  for (let n = 0; n < POINT_BATCH_LIMITS.active; n++)
    world.db.jobs.set(`busy-${n}`, { status: 'running' });
  const before = intakeItem(world.item);
  await world.tick();
  assert.deepEqual(intakeItem(world.item), before);
  assert.ok(Date.parse(world.item.plan_ref.admissionTriedAt));
  assert.equal(world.parts.get(0)!.state, 'planned');
  assert.equal(world.db.jobs.size, POINT_BATCH_LIMITS.active);
});

test('oldest private markers go first, with item id breaking ties rather than public updatedAt', async () => {
  const newer = '2026-10-11T00:00:00.000Z', older = '2026-10-10T00:00:00.000Z';
  const entries = [];
  for (let n = 0; n <= INTAKE_SURFACE_LIMITS.page; n++) {
    const world = await waitingBatch();
    world.item.plan_ref.admissionTriedAt = newer;
    entries.push({ world });
  }
  entries.at(-1)!.world.item.plan_ref.admissionTriedAt = older;
  // Public recency must not determine scheduling.
  entries.at(-1)!.world.item.updated_at = '2026-10-12T00:00:00.000Z';
  await withSurfaces(entries, admitIntakeSurfaceParts);
  assert.notEqual(entries.at(-1)!.world.item.plan_ref.admissionTriedAt, older);
  assert.notEqual(entries[0].world.item.plan_ref.admissionTriedAt, newer);
  assert.equal(entries.at(-2)!.world.item.plan_ref.admissionTriedAt, newer);
});

test('a full page of items waiting for an area yields to new surfaces on the next tick', async () => {
  const waiting = [];
  for (let n = 0; n < INTAKE_SURFACE_LIMITS.page; n++) waiting.push({ world: await waitingBatch() });
  const tif = batch(undefined, 'raster-window'), fresh = batch();
  await withSurfaces([...waiting, { world: tif }, { world: fresh }], async () => {
    await admitIntakeSurfaceParts();
    assert.equal(tif.db.jobs.size + fresh.db.jobs.size, 0);
    await admitIntakeSurfaceParts();
  });
  assert.deepEqual(queued(tif.parts), [0]);
  assert.deepEqual(queued(fresh.parts), [0]);
  assert.ok(waiting.every(entry => entry.world.parts.get(1)!.state === 'planned'));
});
