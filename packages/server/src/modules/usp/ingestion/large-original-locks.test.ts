import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Pool } from 'pg';
import { LargeOriginalService, uploadSlotVersion, waitForUploadSlot } from './large-original';
import { memoryPool, memoryStorage, withPool } from './large-original-memory.test-fixture';
import { sha256 } from '../../../infrastructure/storage';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'upload-lock-test';

test('receipt metadata is case-first without UPDATE; publication stays exclusive and storage is outside quota',
  async () => {
    const caseId = randomUUID(), memory = memoryPool(caseId), { storage } = memoryStorage();
    const statements: string[] = [];
    let quotaHeld = false;
    const pool = { query: memory.pool.query.bind(memory.pool), connect: async () => {
      const client = await memory.pool.connect();
      return { release: () => client.release(), query: async (sql: string, values: any[]) => {
        statements.push(sql);
        if (sql.includes('large-original-quota-v1')) quotaHeld = true;
        const result = await client.query(sql, values);
        if (/^(COMMIT|ROLLBACK)/.test(sql)) quotaHeld = false;
        return result;
      } };
    } } as unknown as Pool;
    for (const name of ['putPartObject', 'readPartObject', 'putOriginalStream', 'verifyObjectStream',
      'assertLargeOriginalStorageProfile'] as const) {
      const original = storage[name];
      (storage as any)[name] = (...args: any[]) => {
        assert.equal(quotaHeld, false, name);
        return (original as Function)(...args);
      };
    }
    const service = new LargeOriginalService(storage), bytes = Buffer.from('test_only receipt bytes');
    await withPool(pool, async () => {
      const created = await service.create(caseId, { requestKey: randomUUID(), expectedCaseRevision: 0,
        filename: 'receipt.bin', mediaType: 'application/octet-stream', bytes: bytes.length, sha256: sha256(bytes),
        provenance: { origin: 'not_stated', acquiredAt: '2026-10-29T00:00:00Z' } });
      const caseLock = statements.findIndex(sql => sql.includes('FROM cases') && sql.includes('FOR KEY SHARE'));
      assert.ok(caseLock >= 0 && caseLock < statements.findIndex(sql => sql.includes('large-original-quota-v1')));
      statements.length = 0;
      const claim = await service.claimPart(caseId, created.id, { requestKey: randomUUID(), expectedRevision: 1,
        expectedCaseRevision: 0, partNumber: 1, sha256: sha256(bytes) });
      const received = await service.receivePart(claim, bytes);
      assert.ok(statements.some(sql => sql.includes('usp_source_uploads') && sql.includes('FOR UPDATE')));
      assert.ok(!statements.some(sql => sql.includes('FROM cases') && sql.includes('FOR UPDATE')));
      statements.length = 0;
      await service.read(caseId, created.id);
      assert.ok(!statements.some(sql => sql.includes('FROM cases') && sql.includes('FOR ')));
      statements.length = 0;
      const version = uploadSlotVersion();
      const wake = waitForUploadSlot(version, null, Date.now() + 60_000);
      const finished = await service.finalize(caseId, created.id, { requestKey: randomUUID(),
        expectedRevision: received.revision, expectedCaseRevision: 0, sha256: sha256(bytes) });
      await wake;
      assert.equal(finished?.state, 'retained');
      assert.ok(uploadSlotVersion() > version);
      const publication = statements.findIndex(sql => sql.includes('FROM cases') && sql.includes('FOR UPDATE'));
      assert.ok(publication >= 0);
      assert.ok(statements.slice(publication).findIndex(sql => sql.startsWith('INSERT INTO sources')) > 0);
      await waitForUploadSlot(version, null, Date.now() + 60_000); // A completion during refusal is not lost.
    });
  });

test('concurrent same-key admission is replayed after the quota lock, never inserted twice', async () => {
  const caseId = randomUUID(), memory = memoryPool(caseId), service = new LargeOriginalService(memoryStorage().storage);
  const input = { requestKey: randomUUID(), expectedCaseRevision: 0, filename: 'receipt.bin',
    mediaType: 'application/octet-stream', bytes: 1, sha256: sha256(Buffer.from('x')),
    provenance: { origin: 'not_stated', acquiredAt: '2026-10-29T00:00:00Z' } };
  const created = await withPool(memory.pool, () => service.create(caseId, input));
  let serialized = false, reads = 0, uploadLocks = 0;
  const pool = { connect: async () => {
    const client = await memory.pool.connect();
    return { release: () => client.release(), query: async (sql: string, values: any[]) => {
      if (sql === 'BEGIN') serialized = false;
      if (sql.includes('large-original-quota-v1')) serialized = true;
      if (sql.startsWith('SELECT * FROM usp_source_uploads WHERE case_id=$1 AND operator_subject')) {
        reads++;
        const rows = serialized ? memory.db.uploads : [];
        return { rows, rowCount: rows.length };
      }
      if (sql.includes('usp_source_uploads') && sql.includes('FOR UPDATE')) {
        assert.equal(serialized, false, 'a replay must not reverse upload then quota order');
        uploadLocks++;
      }
      const result = await client.query(sql, values);
      if (sql === 'COMMIT') serialized = false;
      return result;
    } };
  } } as unknown as Pool;
  await withPool(pool, async () => {
    assert.equal((await service.create(caseId, input)).id, created.id);
    assert.equal(reads, 2);
    assert.equal(uploadLocks, 1, 'replayed status is a coherent upload/parts snapshot');
    assert.equal(memory.db.uploads.length, 1);
    await assert.rejects(service.create(caseId, { ...input, filename: 'changed.bin' }), { code: 'STALE_REVISION' });
    assert.equal(memory.db.uploads.length, 1);
  });
});

test('a remote slot completion is polled after thirty seconds, not in a busy loop', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let woke = false;
  const waiting = waitForUploadSlot(uploadSlotVersion(), null, Date.now() + 60_000).then(() => { woke = true; });
  t.mock.timers.tick(29_999);
  await Promise.resolve();
  assert.equal(woke, false);
  t.mock.timers.tick(1);
  await waiting;
  assert.equal(woke, true);
});
