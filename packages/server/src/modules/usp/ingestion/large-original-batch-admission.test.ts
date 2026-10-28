import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sha256 } from '../../../infrastructure/storage';
import { LargeOriginalService } from './large-original';
import { memoryPool, memoryStorage, withPool } from './large-original-memory.test-fixture';
import { lockUnassignedSourceCase } from './service';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'batch-admission-test-only';
const bytes = readFileSync('fixtures/google-uttam/block-boundary.geojson');
const refusal = {
  code: 'STALE_REVISION',
  message: 'This source case is now associated with a package or property; reopen its current context.',
};
type Database = ReturnType<typeof memoryPool>['db'];
const input = () => ({ requestKey: randomUUID(), expectedCaseRevision: 0, filename: 'block-boundary.geojson',
  mediaType: 'application/octet-stream', bytes: bytes.length, sha256: sha256(bytes),
  provenance: { origin: 'not_stated' as const, acquiredAt: '2026-10-22T00:00:00.000Z' } });

function ownDraft(db: Database, sourceId = randomUUID(), state = 'READY_FOR_REVIEW') {
  db.case.batchSources.add(sourceId);
  db.case.packages.push({ id: randomUUID(), state, source_ids: [sourceId] });
}

for (const arrival of ['before admission', 'after part claim', 'after part bytes stored']) {
  test(`batch drafts ${arrival} admit ordinary receipts, parts, replay and exact-byte finalization`, async () => {
    const caseId = randomUUID(), { db, pool } = memoryPool(caseId);
    const { storage, objects } = memoryStorage();
    const putPart = storage.putPartObject;
    storage.putPartObject = async (...args) => {
      const stored = await putPart(...args);
      if (arrival === 'after part bytes stored') ownDraft(db);
      return stored;
    };
    const service = new LargeOriginalService(storage);
    await withPool(pool, async () => {
      if (arrival === 'before admission') {
        // Each package cites its own source item, including ZIP-member and cell-file items.
        ownDraft(db);
        ownDraft(db, randomUUID(), 'NEEDS_INPUT');
        ownDraft(db, randomUUID(), 'REVIEWED');
      }
      const created = await service.create(caseId, input());
      assert.equal(db.uploads[0].body.batchSourceId, undefined, 'ordinary dropped receipt has no batch hint');
      const part = { requestKey: randomUUID(), expectedRevision: created.revision,
        expectedCaseRevision: 0, partNumber: 1, sha256: sha256(bytes) };
      const claim = await service.claimPart(caseId, created.id, part);
      if (arrival === 'after part claim') ownDraft(db);
      db.case.revision++;
      const received = await service.receivePart(claim, bytes);
      assert.equal(received.receivedBytes, bytes.length);
      assert.equal((await service.claimPart(caseId, created.id, part)).token, null, 'saved part replays');
      const final = await service.finalize(caseId, created.id, { requestKey: randomUUID(),
        expectedRevision: received.revision, expectedCaseRevision: 0, sha256: sha256(bytes) });
      assert.equal(final?.state, 'retained');
      assert.equal(final.source?.sha256, sha256(bytes));
      assert.equal(final.source?.bytes, bytes.length);
      assert.equal(db.sources.size, 1);
      assert.deepEqual(objects.get(db.sources.get(final.source!.sourceId)!.object_key), bytes);
      assert.equal(db.case.revision, 2, 'sibling advance and original publication both survive');
    });
  });
}

for (const barrier of ['manual package outside batch', 'property link']) {
  for (const stage of ['admission', 'part claim', 'part receive', 'finalization']) {
    test(`${barrier} still refuses ${stage} with the existing words, even with a batch hint`, async () => {
      const caseId = randomUUID(), { db, pool } = memoryPool(caseId);
      const sourceId = randomUUID(), { storage, objects } = memoryStorage();
      const service = new LargeOriginalService(storage);
      db.case.batchSources.add(sourceId);
      const block = () => {
        ownDraft(db, sourceId);
        if (barrier === 'property link') db.case.properties.push(caseId);
        else db.case.packages.push({ id: randomUUID(), state: 'READY_FOR_REVIEW', source_ids: [randomUUID()] });
      };
      await withPool(pool, async () => {
        if (stage === 'admission') {
          block();
          await assert.rejects(service.create(caseId, input(), sourceId), refusal);
          assert.equal(db.uploads.length, 0);
          return;
        }
        const created = await service.create(caseId, input(), sourceId);
        const part = { requestKey: randomUUID(), expectedRevision: created.revision,
          expectedCaseRevision: 0, partNumber: 1, sha256: sha256(bytes) };
        if (stage === 'part claim') {
          block();
          await assert.rejects(service.claimPart(caseId, created.id, part), refusal);
          assert.equal(db.parts.length, 0);
          return;
        }
        const claim = await service.claimPart(caseId, created.id, part);
        if (stage === 'part receive') {
          block();
          await assert.rejects(service.receivePart(claim, bytes), refusal);
          assert.equal(objects.size, 0, 'refused before storage');
          return;
        }
        const received = await service.receivePart(claim, bytes);
        block();
        await assert.rejects(service.finalize(caseId, created.id, { requestKey: randomUUID(),
          expectedRevision: received.revision, expectedCaseRevision: 0, sha256: sha256(bytes) }), refusal);
        assert.equal(db.sources.size, 0);
        assert.equal(objects.size, 1, 'only the already received temporary part exists');
      });
    });
  }
}

for (const invalid of ['missing sources', 'null sources', 'empty sources', 'non-array sources',
  'mixed own and outside sources', 'RECEIVED', 'COMMITTED']) {
  test(`a package with ${invalid} is not an intake draft and cannot be bypassed by naming an item`, async () => {
    const caseId = randomUUID(), { db, pool } = memoryPool(caseId);
    const sourceId = randomUUID();
    ownDraft(db, sourceId);
    const pkg = db.case.packages[0];
    if (['RECEIVED', 'COMMITTED'].includes(invalid)) pkg.state = invalid;
    else if (invalid === 'missing sources') pkg.source_ids = undefined;
    else if (invalid === 'null sources') pkg.source_ids = null;
    else if (invalid === 'empty sources') pkg.source_ids = [];
    else if (invalid === 'non-array sources') pkg.source_ids = sourceId;
    else pkg.source_ids = [sourceId, randomUUID()];
    const client = await pool.connect();
    try {
      await assert.rejects(lockUnassignedSourceCase(client, caseId, sourceId), refusal);
    } finally {
      client.release();
    }
  });
}
