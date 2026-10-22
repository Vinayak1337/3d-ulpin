import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { CELL_DERIVATIVE_RULE, CellDerivativeLineageSchema } from '@ulpin/contracts/usp';
import { byteParts, receiveLargeLayer } from './intake-zip-layers';
import { LargeOriginalService } from './large-original';
import { memoryPool, memoryStorage, withPool } from './large-original-memory.test-fixture';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'large-original-small-protocol';
const caseId = '10000000-0000-4000-8000-000000000003';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('a cell lineage is published with the original and exact finalization replay retains no second child', async () => {
  const { db, pool } = memoryPool(caseId);
  await withPool(pool, async () => {
    const service = new LargeOriginalService(memoryStorage().storage);
    const bytes = Buffer.from('{"type":"FeatureCollection","features":[{"type":"Feature","geometry":null}]}');
    const lineage = CellDerivativeLineageSchema.parse({ version: 'cell-derivative/1',
      parentSourceId: randomUUID(), parentSourceRevision: 2, parentSha256: sha(Buffer.from('parent')),
      parentItemId: randomUUID(), parentName: 'parent.geojson', cellKey: 'utm-32620-e12-n123-l234-b270',
      rule: CELL_DERIVATIVE_RULE, features: 1, members: { key: `large-originals/${randomUUID()}/${sha(Buffer.from('ranges'))}`,
        sha256: sha(Buffer.from('ranges')), bytes: 6, format: 'cell-feature-ranges-jsonl/1' } });
    const created = await service.create(caseId, { requestKey: randomUUID(), expectedCaseRevision: 0,
      filename: 'cell.geojson', mediaType: 'application/octet-stream', sha256: sha(bytes), bytes: bytes.length,
      provenance: { origin: 'not_stated', acquiredAt: '2026-10-22T00:00:00.000Z' } });
    const claim = await service.claimPart(caseId, created.id, { requestKey: randomUUID(),
      expectedRevision: created.revision, expectedCaseRevision: 0, partNumber: 1, sha256: sha(bytes) });
    const received = await service.receivePart(claim, bytes);
    const finalInput = { requestKey: randomUUID(), expectedRevision: received.revision,
      expectedCaseRevision: 0, sha256: sha(bytes) };
    const final = await service.finalize(caseId, created.id, finalInput, lineage);
    const [source] = [...db.sources.values()];
    assert.deepEqual(source!.inspection.cellDerivative, lineage);
    assert.equal(source!.inspection.archiveMember, undefined);
    const replay = await service.finalize(caseId, created.id, finalInput, lineage);
    assert.equal(replay?.source?.sourceId, final?.source?.sourceId);
    assert.equal(db.sources.size, 1);
  });
});

test('a 3 KB PDF is admitted, received as one part and retained as an original of its exact bytes', async () => {
  const { db, pool } = memoryPool(caseId);
  const { objects, storage } = memoryStorage();
  await withPool(pool, async () => {
    const bytes = new Uint8Array(3 * 1024).map((_, index) => index % 251);
    const service = new LargeOriginalService(storage);
    const created = await service.create(caseId, { requestKey: randomUUID(), expectedCaseRevision: 0,
      filename: 'plan.pdf', mediaType: 'application/octet-stream', sha256: sha(bytes), bytes: bytes.length,
      provenance: { origin: 'not_stated', acquiredAt: '2026-10-17T00:00:00.000Z' } });
    assert.equal(created.partCount, 1);
    const guard = { expectedRevision: created.revision, expectedCaseRevision: 0 };
    const claim = await service.claimPart(caseId, created.id,
      { ...guard, requestKey: randomUUID(), partNumber: 1, sha256: sha(bytes) });
    const received = await service.receivePart(claim, bytes);
    assert.equal(received.receivedBytes, bytes.length);
    const final = await service.finalize(caseId, created.id, { requestKey: randomUUID(),
      expectedRevision: received.revision, expectedCaseRevision: 0, sha256: sha(bytes) });
    assert.equal(final?.state, 'retained');
    assert.deepEqual(final?.source && { sha256: final.source.sha256, bytes: final.source.bytes },
      { sha256: sha(bytes), bytes: bytes.length });
    assert.equal(db.sources.size, 1);
    assert.deepEqual(new Uint8Array(objects.get([...db.sources.values()][0]!.object_key)!), bytes);
  });
});

test('TC2: a batch item\'s derived receipt is kept in a case its batch\'s drafts made packages of; an upload with '
  + 'no batch item, or any receipt in a property\'s case, is still refused', async () => {
  const { db, pool } = memoryPool(caseId);
  const service = new LargeOriginalService(memoryStorage().storage);
  // test_only bytes; the batch's table and another item's draft package are named, not read.
  const bytes = Buffer.from('{"type":"FeatureCollection","features":[]}');
  const batchSourceId = '10000000-0000-4000-8000-000000000004';
  db.case.batchSources.add(batchSourceId);
  db.case.packages.push('10000000-0000-4000-8000-000000000005');
  async function* parts() {
    yield bytes;
  }
  const keep = (fence: { revision: number; batchSourceId: string }) => receiveLargeLayer(caseId, fence,
    { name: 'derived.geojson', bytes: bytes.length, sha256: sha(bytes) }, byteParts(parts()), { large: service });
  await withPool(pool, async () => {
    const kept = await keep({ revision: 0, batchSourceId });
    assert.equal(db.sources.get(kept)?.sha256, sha(bytes));
    // The package rule still holds an officer's upload, and a source that is no batch item names no exemption.
    await assert.rejects(service.create(caseId, { requestKey: randomUUID(), expectedCaseRevision: db.case.revision,
      filename: 'upload.geojson', mediaType: 'application/octet-stream', sha256: sha(bytes), bytes: bytes.length,
      provenance: { origin: 'not_stated', acquiredAt: '2026-10-22T00:00:00.000Z' } }), { code: 'STALE_REVISION' });
    await assert.rejects(keep({ revision: db.case.revision, batchSourceId: randomUUID() }), { code: 'STALE_REVISION' });
    db.case.properties.push(caseId);
    await assert.rejects(keep({ revision: db.case.revision, batchSourceId }), { code: 'STALE_REVISION' });
  });
  assert.equal(db.sources.size, 1);
});
