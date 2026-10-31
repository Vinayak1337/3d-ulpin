import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { Client, type PoolClient } from 'pg';

/**
 * S9.6r. Run 7's deadlocks on a real PostgreSQL/PostGIS: a stale batch document's end appended to the case stream
 * and then locked the case FOR UPDATE to queue its re-read, while a batch registration held the case and appended.
 * A throwaway database on 127.0.0.1, migrated in the runtime order (the bootstrap extension, then the server's
 * migrate), dropped at the end. Skipped unless ULPIN_PG_TEST_URL names an administrative connection there. Every row
 * is generated test_only data; no original is read.
 */
const url = process.env.ULPIN_PG_TEST_URL;
const sha = '0'.repeat(64);
const ROUNDS = 60;

async function withDatabase(work: () => Promise<void>) {
  const admin = new URL(url!);
  assert.equal(admin.hostname, '127.0.0.1');
  const name = `ulpin_s96r_${randomBytes(6).toString('hex')}`;
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

/** A batch case with one Word document whose read is queued, and one plain original not yet registered. */
async function batchTx(client: PoolClient) {
  const { ingestionBinding } = await import('./events');
  const { queueBatchDocumentTx } = await import('./documents');
  const caseId = randomUUID(), wordId = randomUUID(), plainId = randomUUID();
  await client.query(`INSERT INTO cases(id,name,frame) VALUES($1,'test_only batch',$2)`,
    [caseId, { id: 'UNASSIGNED' }]);
  const documentOriginal = { version: 'source-document/1', subject: ingestionBinding(caseId).subject, format: 'docx',
    sha256: sha, bytes: 10, receivedAt: '2026-10-31T00:00:00.000Z' };
  await client.query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,
    object_key,status,inspection) VALUES($1,$2,$1,1,'test_only.docx','large-original-v1','application/octet-stream',
    10,$3,$4,'received',$5)`, [wordId, caseId, sha, `test_only/${wordId}`, { documentOriginal }]);
  await client.query(`INSERT INTO usp_intake_items(item_id,source_id,case_id,family,format,size_bytes,size_class,
    state,placement,card,card_sha256) VALUES($1,$1,$2,'document','docx',10,'S','reading','undecided',$3,$4)`,
  [wordId, caseId, { format: 'docx', family: 'document' }, sha]);
  await client.query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,
    object_key,status,inspection) VALUES($1,$2,$1,1,'test_only.csv','test_only-v1','text/csv',10,$3,$4,'received',
    '{}'::jsonb)`, [plainId, caseId, sha, `test_only/${plainId}`]);
  const { jobId } = await queueBatchDocumentTx(client, caseId, wordId, 'docx');
  return { caseId, wordId, plainId, jobId };
}

const sqlState = (error: unknown) => (error as { code?: string } | null)?.code;

test('case locks and case stream appends never deadlock on PostgreSQL (S9.6r)', { skip: !url }, async t => {
  await withDatabase(async () => {
    const db = await import('../../../infrastructure/db');
    await db.query(readFileSync('database/sql/00-bootstrap/postgis.sql', 'utf8'));
    await db.migrate();
    const { appendCaseIngestionTx } = await import('./events');
    const { documentCaseTx } = await import('./document-context');
    const { intakeCaseTx } = await import('./intake-context');
    const { failDocumentJob } = await import('./document-worker');
    const { IntakeService } = await import('./intake-service');

    await t.test('the old order, stream first and case FOR UPDATE second, is a cycle', async () => {
      const batch = await db.transaction(batchTx);
      const change = { kind: 'source.retained' as const, sourceId: batch.plainId, sourceRevision: 1,
        status: 'needs_input' as const };
      const [streamFirst, caseFirst] = [await db.pool().connect(), await db.pool().connect()];
      try {
        await streamFirst.query('BEGIN');
        await caseFirst.query('BEGIN');
        await appendCaseIngestionTx(streamFirst, batch.caseId, change);
        await intakeCaseTx(caseFirst, batch.caseId, true);
        const outcomes = await Promise.allSettled([
          appendCaseIngestionTx(caseFirst, batch.caseId, change),
          delay(50).then(() => documentCaseTx(streamFirst, batch.caseId, true)),
        ]);
        assert.deepEqual(outcomes.filter(outcome => outcome.status === 'rejected')
          .map(outcome => sqlState((outcome as PromiseRejectedResult).reason)), ['40P01']);
      } finally {
        for (const client of [streamFirst, caseFirst]) {
          await client.query('ROLLBACK');
          client.release();
        }
      }
    });

    await t.test(`a stale re-queue beside a batch registration, ${ROUNDS} rounds, no 40P01`, async () => {
      const deadlocks = new Set<unknown>();
      const counted = (error: unknown) => {
        if (sqlState(error) === '40P01') deadlocks.add(error);
        throw error;
      };
      const run = (work: Promise<unknown>) => work.catch(counted).catch(error => {
        if (sqlState(error) !== '40P01') throw error;
      });
      // Count each rolled-back registration transaction before the route's retry runs it again.
      const intake = new IntakeService({
        probe: async (): Promise<never> => { throw new Error('test_only probe'); },
        transaction: action => db.transaction(action).catch(counted),
      });
      for (let round = 0; round < ROUNDS; round++) {
        const batch = await db.transaction(batchTx);
        const stagger = round % 3;
        await Promise.all([
          run(delay(stagger).then(() => failDocumentJob(batch.jobId, 'DOCUMENT_INPUT_STALE'))),
          run(intake.register(batch.caseId, { requestKey: randomUUID(), sourceId: batch.plainId })),
        ]);
        const jobs = (await db.query(`SELECT status FROM jobs WHERE source_id=$1 ORDER BY created_at`,
          [batch.wordId])).rows.map(job => job.status);
        assert.deepEqual(jobs, ['stale', 'queued']);
      }
      assert.equal(deadlocks.size, 0);
    });
  });
});
