import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Client, type PoolClient } from 'pg';

/**
 * S9.5a. The own map area SQL on a real PostgreSQL/PostGIS: a throwaway database on 127.0.0.1, migrated in the
 * runtime order (the bootstrap extension, then the server's migrate), dropped at the end. Skipped unless
 * ULPIN_PG_TEST_URL names an administrative connection there. Every row and corner is generated test_only data in
 * an arbitrary UTM 43N frame; none is a survey input.
 */
const url = process.env.ULPIN_PG_TEST_URL;
const crs = 'EPSG:32643';
const origin: [number, number] = [500000, 3100000];
const box = (x: number, y: number, side: number) => [[x, y], [x + side, y], [x + side, y + side], [x, y + side]];
const far = box(700000, 3100000, 1000);
const near = box(500500, 3100500, 500);

async function withDatabase(work: (name: string) => Promise<void>) {
  const admin = new URL(url!);
  assert.equal(admin.hostname, '127.0.0.1');
  const name = `ulpin_s95a_${randomBytes(6).toString('hex')}`;
  const client = new Client({ connectionString: admin.href });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${name}`);
    try {
      admin.pathname = `/${name}`;
      process.env.DATABASE_URL = admin.href;
      process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'test_only-operator';
      await work(name);
    } finally {
      await (await import('../../../infrastructure/db')).closePool();
      await client.query(`DROP DATABASE ${name} WITH (FORCE)`);
    }
  } finally {
    await client.end();
  }
}

async function caseWithAreaTx(client: PoolClient) {
  const { sourceImportDestinationTx } = await import('./source-building-import');
  const reference = { sourceCrs: crs, analysisCrs: crs, origin, anchor: [75, 28] as [number, number],
    transformVersion: 'test_only', verticalReference: 'unknown' as const };
  const areaId = await sourceImportDestinationTx(client, { name: 'test_only batch area' }, reference);
  await client.query(`UPDATE map_areas SET extent='[0,0,2000,2000]' WHERE id=$1`, [areaId]);
  const caseId = randomUUID();
  await client.query(`INSERT INTO cases(id,name,frame,site_id) VALUES($1,'test_only batch',$2,$3)`,
    [caseId, { id: `AREA-${areaId}` }, areaId]);
  return { caseId, areaId };
}

async function sourceTx(client: PoolClient, caseId: string, name: string, inspection: object = {}) {
  const id = randomUUID();
  await client.query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,
    object_key,status,inspection) VALUES($1,$2,$1,1,$3,'large-original-v1','application/octet-stream',10,$4,$5,
    'inspected',$6)`, [id, caseId, name, '0'.repeat(64), `test_only/${id}`, inspection]);
  return id;
}

/** A raster read in one published part whose source corners are `corners`, as acceptIntakeSurfacePartTx leaves it. */
async function surfaceItemTx(client: PoolClient, caseId: string, name: string, corners: number[][]) {
  const itemId = randomUUID(), sourceId = await sourceTx(client, caseId, name);
  const header = { operation: 'raster-window', crsStated: true, authority: crs,
    vertical: { status: 'unknown', name: null }, size: [8, 8, 1], planned: 1, total: 1, preview: { step: 1 } };
  await client.query(`INSERT INTO usp_intake_items(item_id,source_id,case_id,family,format,size_bytes,size_class,
    state,placement,plan_ref,parts_planned,parts_done) VALUES($1,$2,$3,'raster','geotiff',10,'S','read',
    'not_understood',$4,1,1)`, [itemId, sourceId, caseId,
    { version: 'intake-surface/1', operation: 'raster-window', header }]);
  await client.query(`INSERT INTO usp_intake_parts(item_id,part_index,locator,state,result_ref)
    VALUES($1,0,$2,'published',$3)`, [itemId, { operation: 'raster-window', window: null, partKey: 'test_only' },
    { sourceCorners: corners }]);
  return { itemId, header };
}

const item = async (itemId: string) => (await (await import('../../../infrastructure/db'))
  .query('SELECT placement,plan_ref FROM usp_intake_items WHERE item_id=$1', [itemId])).rows[0];
const areaCount = async () => Number((await (await import('../../../infrastructure/db'))
  .query('SELECT count(*) n FROM map_areas')).rows[0].n);

test('own map areas on PostgreSQL (S9.5a)', { skip: !url }, async t => {
  await withDatabase(async () => {
    const db = await import('../../../infrastructure/db');
    await db.query(readFileSync('database/sql/00-bootstrap/postgis.sql', 'utf8'));
    await db.migrate();
    const surface = await import('./intake-surface');
    const own = await import('./source-building-import');
    const large = await import('./intake-large-worker');
    const batch = await db.transaction(caseWithAreaTx);

    await t.test('a far raster gets its own area, named as the manifest names it, once', async () => {
      const { itemId } = await db.transaction(client => surfaceItemTx(client, batch.caseId, 'far.tif', far));
      await surface.admitIntakeSurfaceParts();
      const { placement, plan_ref: plan } = await item(itemId);
      assert.equal(plan.admissionIssue, undefined, 'the admission tick commits (no 42703)');
      assert.ok(plan.ownAreaId);
      assert.equal(placement, 'on_map');
      assert.equal(plan.placedArea, plan.ownAreaId);
      const area = (await db.query('SELECT name,site_id,reference FROM map_areas WHERE id=$1',
        [plan.ownAreaId])).rows[0];
      assert.equal(area.name, 'far.tif');
      assert.notEqual(area.site_id, batch.areaId);
      assert.equal(area.reference.analysisCrs, crs);
      const areas = await areaCount();
      await surface.admitIntakeSurfaceParts();
      assert.equal(await areaCount(), areas, 'a later tick makes no second area');
    });

    await t.test('a moved batch area settles the item again under the new key', async () => {
      const { itemId } = await db.transaction(client => surfaceItemTx(client, batch.caseId, 'far-2.tif',
        box(900000, 3300000, 800)));
      await surface.admitIntakeSurfaceParts();
      const before = (await item(itemId)).plan_ref.placedOn;
      await db.query(`UPDATE map_areas SET extent='[0,0,3000,3000]' WHERE id=$1`, [batch.areaId]);
      await surface.admitIntakeSurfaceParts();
      const after = (await item(itemId)).plan_ref;
      assert.notEqual(after.placedOn, before);
      assert.equal(after.admissionIssue, undefined);
      await db.transaction(client => surface.settleSurfaceItemTx(client, itemId));
      assert.equal((await item(itemId)).plan_ref.placedOn, after.placedOn);
    });

    await t.test('a near raster is placed in the batch area and makes no area', async () => {
      const areas = await areaCount();
      const { itemId, header } = await db.transaction(client => surfaceItemTx(client, batch.caseId, 'near.tif',
        near));
      await db.transaction(client => surface.settleSurfaceItemTx(client, itemId));
      await surface.admitIntakeSurfaceParts();
      const { placement, plan_ref: plan } = await item(itemId);
      assert.equal(placement, 'on_map');
      assert.equal(plan.ownAreaId, undefined);
      assert.equal(plan.placedArea, batch.areaId);
      assert.equal(await areaCount(), areas);
      const placed = await db.transaction(client => surface.surfacePartPlacementTx(client, batch.caseId,
        header as never, near, batch.areaId));
      assert.equal(placed.state, 'placed');
    });

    await t.test('a part is placed in its own area with corners from that area origin', async () => {
      const { itemId, header } = await db.transaction(client => surfaceItemTx(client, batch.caseId, 'far-3.tif',
        box(650000, 3200000, 400)));
      await surface.admitIntakeSurfaceParts();
      const ownAreaId = (await item(itemId)).plan_ref.ownAreaId;
      const placed = await db.transaction(client => surface.surfacePartPlacementTx(client, batch.caseId,
        header as never, box(650000, 3200000, 400), ownAreaId));
      assert.equal(placed.state, 'placed');
      if (placed.state !== 'placed') return;
      assert.equal(placed.areaId, ownAreaId);
      assert.deepEqual(placed.corners[0].map(Math.round), [0, 0]);
      const batchPlaced = await db.transaction(client => surface.surfacePartPlacementTx(client, batch.caseId,
        header as never, box(650000, 3200000, 400), batch.areaId));
      assert.equal(batchPlaced.state, 'not_placed');
    });

    await t.test('a UTM-sized footprint gets a UTM area; a too-wide one gets web Mercator', async () => {
      const utm = await db.transaction(client => own.sourcePartOwnAreaTx(client, 'test_only utm', 'EPSG:4326',
        [[75, 28], [75.02, 28], [75.02, 28.02], [75, 28.02]]));
      const wide = await db.transaction(client => own.sourcePartOwnAreaTx(client, 'test_only wide', 'EPSG:4326',
        [[70, 20], [80, 20], [80, 30], [70, 30]]));
      const rows = (await db.query('SELECT id,reference,extent FROM map_areas WHERE id IN ($1,$2)',
        [utm, wide])).rows;
      const of = (id: string | null) => rows.find(row => row.id === id)!;
      assert.equal(of(utm).reference.analysisCrs, 'EPSG:32643');
      assert.ok(of(utm).extent[2] > 1900 && of(utm).extent[2] < 2100);
      assert.equal(of(wide).reference.analysisCrs, 'EPSG:3857');
      assert.ok(of(wide).extent[2] > 1_000_000);
      assert.equal(await db.transaction(client => own.sourcePartOwnAreaTx(client, 'test_only', 'EPSG:0', near)),
        null);
    });

    await t.test('a far converted layer gets one recorded area of its own; a near one keeps the batch area',
      async () => {
        const lineage = { nativeDerivative: { crs } };
        const farId = await db.transaction(client => sourceTx(client, batch.caseId, 'outlines.geojson', lineage));
        const nearId = await db.transaction(client => sourceTx(client, batch.caseId, 'near.geojson', lineage));
        const frame = { analysisCrs: crs, origin };
        assert.equal(await db.transaction(client => own.beyondAreaOriginTx(client, crs, frame, far)), true);
        assert.equal(await db.transaction(client => own.beyondAreaOriginTx(client, crs, frame, near)), false);
        const areas = await areaCount();
        const first = await db.transaction(client => large.farLayerAreaTx(client, farId, 'outlines', frame, far));
        assert.ok(first);
        const again = await db.transaction(client => large.farLayerAreaTx(client, farId, 'outlines', frame, far));
        assert.equal(again, first, 'a retry uses the recorded area');
        assert.equal(await db.transaction(client => large.farLayerAreaTx(client, nearId, 'near', frame, near)),
          null);
        assert.equal(await areaCount(), areas + 1);
        const row = (await db.query('SELECT name,site_id,reference FROM map_areas WHERE id=$1', [first])).rows[0];
        assert.equal(row.name, 'outlines');
        assert.equal(row.site_id, first);
        assert.equal(row.reference.analysisCrs, crs);
        assert.equal((await large.layerArea({ caseId: batch.caseId, sourceId: farId }))?.id, first);
        assert.equal((await large.layerArea({ caseId: batch.caseId, sourceId: nearId }))?.id, batch.areaId);
      });
  });
});
