import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Client, type PoolClient } from 'pg';

/**
 * S9.6g. A batch Word document's stale end and its re-queue on a real PostgreSQL/PostGIS: a throwaway database on
 * 127.0.0.1, migrated in the runtime order (the bootstrap extension, then the server's migrate), dropped at the end.
 * Skipped unless ULPIN_PG_TEST_URL names an administrative connection there. Every row is generated test_only data;
 * no original is read.
 */
const url = process.env.ULPIN_PG_TEST_URL;
const sha = '0'.repeat(64);

async function withDatabase(work: () => Promise<void>) {
  const admin = new URL(url!);
  assert.equal(admin.hostname, '127.0.0.1');
  const name = `ulpin_s96g_${randomBytes(6).toString('hex')}`;
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

/** An unbound batch case with one probed Word document item, as a batch upload leaves it. */
async function batchWordTx(client: PoolClient) {
  const { ingestionBinding } = await import('./events');
  const caseId = randomUUID(), sourceId = randomUUID();
  await client.query(`INSERT INTO cases(id,name,frame) VALUES($1,'test_only batch',$2)`,
    [caseId, { id: 'UNASSIGNED' }]);
  const documentOriginal = { version: 'source-document/1', subject: ingestionBinding(caseId).subject, format: 'docx',
    sha256: sha, bytes: 10, receivedAt: '2026-10-30T00:00:00.000Z' };
  await client.query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,
    object_key,status,inspection) VALUES($1,$2,$1,1,'test_only.docx','large-original-v1','application/octet-stream',
    10,$3,$4,'received',$5)`, [sourceId, caseId, sha, `test_only/${sourceId}`, { documentOriginal }]);
  await client.query(`INSERT INTO usp_intake_items(item_id,source_id,case_id,family,format,size_bytes,size_class,
    state,placement,card,card_sha256) VALUES($1,$1,$2,'document','docx',10,'S','reading','undecided',$3,$4)`,
  [sourceId, caseId, { format: 'docx', family: 'document' }, sha]);
  return { caseId, sourceId };
}

/** The batch's first map part binds the case to an area's site, as sourcePartDestinationTx does (run 5). */
async function bindSiteTx(client: PoolClient, caseId: string) {
  const { bindRetainedCaseTx } = await import('../../areas/areas');
  const { sourceImportDestinationTx } = await import('./source-building-import');
  const reference = { sourceCrs: 'EPSG:32643', analysisCrs: 'EPSG:32643', origin: [500000, 3100000] as [number, number],
    anchor: [75, 28] as [number, number], transformVersion: 'test_only', verticalReference: 'unknown' as const };
  const areaId = await sourceImportDestinationTx(client, { name: `test_only area ${randomUUID()}` }, reference);
  const site = (await client.query('SELECT site_id FROM map_areas WHERE id=$1', [areaId])).rows[0].site_id;
  await client.query('UPDATE cases SET site_id=NULL,revision=revision+1 WHERE id=$1', [caseId]);
  await bindRetainedCaseTx(client, caseId, { id: site });
}

test('a stale batch Word read is queued again on PostgreSQL (S9.6g)', { skip: !url }, async t => {
  await withDatabase(async () => {
    const db = await import('../../../infrastructure/db');
    await db.query(readFileSync('database/sql/00-bootstrap/postgis.sql', 'utf8'));
    await db.migrate();
    const { queueBatchDocumentTx } = await import('./documents');
    const { failDocumentJob } = await import('./document-worker');
    const jobs = async (sourceId: string) => (await db.query(`SELECT id,status,error,payload FROM jobs
      WHERE source_id=$1 ORDER BY created_at`, [sourceId])).rows;
    const words = async (sourceId: string) => (await db.query(`SELECT state,limit_reason FROM usp_intake_items
      WHERE item_id=$1`, [sourceId])).rows[0];

    await t.test('the moved site pin ends the read stale and queues one more under current pins', async () => {
      const batch = await db.transaction(batchWordTx);
      const first = (await db.transaction(client => queueBatchDocumentTx(client, batch.caseId, batch.sourceId,
        'docx'))).jobId;
      await db.transaction(client => bindSiteTx(client, batch.caseId));
      await failDocumentJob(first, 'DOCUMENT_INPUT_STALE');
      const [stale, next] = await jobs(batch.sourceId);
      assert.deepEqual([stale.id, stale.status, stale.error], [first, 'stale', 'DOCUMENT_INPUT_STALE']);
      assert.equal(next.status, 'queued');
      assert.notEqual(next.payload.caseContextSha256, stale.payload.caseContextSha256);
      assert(next.payload.caseRevision > stale.payload.caseRevision);
      assert.equal((await words(batch.sourceId)).state, 'reading');
      assert.match((await words(batch.sourceId)).limit_reason, /^Reading the paragraphs/);
      for (let end = 2; end <= 3; end++) {
        await db.transaction(client => bindSiteTx(client, batch.caseId));
        await failDocumentJob((await jobs(batch.sourceId)).at(-1)!.id, 'DOCUMENT_INPUT_STALE');
      }
      assert.deepEqual((await jobs(batch.sourceId)).map(job => job.status), ['stale', 'stale', 'stale']);
      assert.equal((await words(batch.sourceId)).state, 'failed_part');
    });

    await t.test('an officer request named by an operation keeps its stale end', async () => {
      const batch = await db.transaction(batchWordTx);
      const first = (await db.transaction(client => queueBatchDocumentTx(client, batch.caseId, batch.sourceId,
        'docx'))).jobId;
      await db.query(`INSERT INTO operations(case_id,operation_key,kind,payload_hash,result)
        VALUES($1,'document-retry:test_only','source-document',$2,$3)`, [batch.caseId, sha, { jobId: first }]);
      await db.transaction(client => bindSiteTx(client, batch.caseId));
      await failDocumentJob(first, 'DOCUMENT_INPUT_STALE');
      assert.deepEqual((await jobs(batch.sourceId)).map(job => job.status), ['stale']);
      assert.equal((await words(batch.sourceId)).state, 'failed_part');
    });

    await t.test('a superseded source rolls back to the savepoint and keeps its stale end', async () => {
      const batch = await db.transaction(batchWordTx);
      const first = (await db.transaction(client => queueBatchDocumentTx(client, batch.caseId, batch.sourceId,
        'docx'))).jobId;
      await db.query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,
        object_key,status,inspection) SELECT $2,case_id,family_id,2,name,profile,mime_type,bytes,sha256,
        object_key||'-2',status,inspection FROM sources WHERE id=$1`, [batch.sourceId, randomUUID()]);
      await failDocumentJob(first, 'DOCUMENT_INPUT_STALE');
      assert.deepEqual((await jobs(batch.sourceId)).map(job => job.status), ['stale']);
      assert.equal((await words(batch.sourceId)).state, 'failed_part');
    });
  });
});
