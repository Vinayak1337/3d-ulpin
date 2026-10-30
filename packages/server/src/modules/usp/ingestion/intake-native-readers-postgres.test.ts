import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Client, type PoolClient } from 'pg';

/**
 * S9.6j. The CityGML reading's settle beside a conversion queued at probe, on a real PostgreSQL/PostGIS: a throwaway
 * database on 127.0.0.1, migrated in the runtime order (the bootstrap extension, then the server's migrate), dropped
 * at the end. Skipped unless ULPIN_PG_TEST_URL names an administrative connection there. Every row is generated
 * test_only data; no original is read.
 */
const url = process.env.ULPIN_PG_TEST_URL;
const zero = '0'.repeat(64);

async function withDatabase(work: () => Promise<void>) {
  const admin = new URL(url!);
  assert.equal(admin.hostname, '127.0.0.1');
  const name = `ulpin_s96j_${randomBytes(6).toString('hex')}`;
  const client = new Client({ connectionString: admin.href });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${name}`);
    try {
      admin.pathname = `/${name}`;
      process.env.DATABASE_URL = admin.href;
      process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'test_only-operator';
      await work();
    } finally {
      await (await import('../../../infrastructure/db')).closePool();
      await client.query(`DROP DATABASE ${name} WITH (FORCE)`);
    }
  } finally {
    await client.end();
  }
}

/** A probed CityGML item whose reading `readerJobId` is cited, with a conversion job of `status` when given. */
async function citygmlItemTx(client: PoolClient, caseId: string, readerJobId: string, status?: string) {
  const sourceId = randomUUID(), itemId = randomUUID();
  await client.query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,
    object_key,status,inspection) VALUES($1,$2,$1,1,'test_only.gml','large-original-v1','application/gml+xml',10,
    $3,$4,'inspected','{}')`, [sourceId, caseId, zero, `test_only/${sourceId}`]);
  await client.query(`INSERT INTO usp_intake_items(item_id,source_id,case_id,family,format,size_bytes,size_class,
    state,placement,card,card_sha256,plan_ref,limit_reason) VALUES($1,$2,$3,'model3d','citygml',10,'S','reading',
    'undecided',$4,$5,$6,'test_only conversion words')`, [itemId, sourceId, caseId,
    { format: 'citygml', family: 'model3d' }, zero, { nativeReaderJobId: readerJobId }]);
  if (status) await client.query(`INSERT INTO jobs(id,case_id,source_id,operation,status,case_revision,
    input_fingerprint,payload) VALUES($1,$2,$3,'intake-native-derivative',$4,0,'test_only','{}')`,
  [randomUUID(), caseId, sourceId, status]);
  return { sourceId, itemId };
}

test('a CityGML reading settles beside its conversion on PostgreSQL (S9.6j)', { skip: !url }, async t => {
  await withDatabase(async () => {
    const db = await import('../../../infrastructure/db');
    await db.query(readFileSync('database/sql/00-bootstrap/postgis.sql', 'utf8'));
    await db.migrate();
    const { settleIntakeNativeReaderTx } = await import('./intake-native-readers');
    const caseId = randomUUID();
    await db.query(`INSERT INTO cases(id,name,frame) VALUES($1,'test_only batch','{"id":"UNASSIGNED"}')`, [caseId]);
    const row = async (itemId: string) => (await db.query(`SELECT state,placement,plan_ref,limit_reason
      FROM usp_intake_items WHERE item_id=$1`, [itemId])).rows[0];
    const conversions = async (sourceId: string) => Number((await db.query(`SELECT count(*) n FROM jobs
      WHERE source_id=$1 AND operation='intake-native-derivative'`, [sourceId])).rows[0].n);

    await t.test('beside a queued or ended conversion, no end writes words or queues another', async () => {
      for (const status of ['queued', 'succeeded', 'failed']) {
        const readerJobId = randomUUID();
        const { sourceId, itemId } = await db.transaction(client => citygmlItemTx(client, caseId, readerJobId, status));
        const before = await row(itemId);
        for (const code of ['CITYGML_OUTPUT_LIMIT', 'CITYGML_PROCESSING_FAILED']) {
          await db.transaction(client => settleIntakeNativeReaderTx(client, caseId, readerJobId,
            { format: 'citygml', status: 'failed', code }));
        }
        assert.deepEqual(await row(itemId), before, status);
        assert.equal(await conversions(sourceId), 1);
      }
    });

    await t.test('with no conversion, a stopped reading writes its words as before S9.6j', async () => {
      const readerJobId = randomUUID();
      const { sourceId, itemId } = await db.transaction(client => citygmlItemTx(client, caseId, readerJobId));
      await db.transaction(client => settleIntakeNativeReaderTx(client, caseId, readerJobId,
        { format: 'citygml', status: 'failed', code: 'CITYGML_PROCESSING_FAILED' }));
      const settled = await row(itemId);
      assert.deepEqual([settled.state, settled.placement, settled.plan_ref], ['read', 'not_understood',
        { nativeReaderJobId: readerJobId }]);
      assert.match(settled.limit_reason, /CITYGML_PROCESSING_FAILED/);
      assert.equal(await conversions(sourceId), 0);
    });
  });
});
