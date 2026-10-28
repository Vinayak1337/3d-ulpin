import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Pool } from 'pg';
import { CELL_DERIVATIVE_RULE, CellDerivativeLineageSchema } from '@ulpin/contracts/usp';
import { byteParts, receiveLargeLayer } from './intake-zip-layers';
import { LargeOriginalService } from './large-original';
import { NativeDerivativeLineageSchema } from './intake-native-derivative';
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

function publicationPool(memory: ReturnType<typeof memoryPool>, expectedLineage: unknown) {
  const { db, pool } = memory;
  const fault = { active: true };
  const transactional = { ...pool, connect: async () => {
    const client = await pool.connect();
    let snapshot: typeof db;
    return { release: () => client.release(), query: async (sql: string, values?: any[]) => {
      if (sql === 'BEGIN') snapshot = structuredClone(db);
      if (sql === 'ROLLBACK') Object.assign(db, snapshot!);
      const result = await client.query(sql, values);
      if (sql.startsWith('INSERT INTO sources')) {
        assert.deepEqual(values![7].nativeDerivative, expectedLineage);
        if (fault.active) throw new Error('Injected failure after source insert before receipt retention');
      }
      return result;
    } };
  } } as unknown as Pool;
  return { pool: transactional, fault };
}

test('native receipt and lineage commit together, roll back together, and replay keeps one child', async () => {
  const memory = memoryPool(caseId);
  const { db } = memory;
  const storage = memoryStorage();
  const bytes = Buffer.from('{"type":"FeatureCollection","features":[]}');
  const parentHash = sha(Buffer.from('test_only parent'));
  const lineage = NativeDerivativeLineageSchema.parse({ version: 'native-derivative/1',
    conversion: 'native_gis_to_geojson@1', readerVersion: 'protocol/1', originalSourceId: randomUUID(),
    originalSourceRevision: 1, originalSha256: parentHash, originalItemId: randomUUID(), format: 'gpkg',
    layer: 'outlines', ordinal: 0, crs: 'EPSG:4326', crsSource: 'stated', features: 0, notWritten: 0,
    sidecar: { objectKey: `native-derivatives/${parentHash}/0/sidecar-${sha(bytes)}`,
      bytes: bytes.length, sha256: sha(bytes) } });
  const { pool, fault } = publicationPool(memory, lineage);
  await withPool(pool, async () => {
    const service = new LargeOriginalService(storage.storage);
    const created = await service.create(caseId, { requestKey: randomUUID(), expectedCaseRevision: 0,
      filename: 'outlines.geojson', mediaType: 'application/octet-stream', sha256: sha(bytes), bytes: bytes.length,
      provenance: { origin: 'not_stated', acquiredAt: '2026-10-22T00:00:00.000Z' } });
    const claim = await service.claimPart(caseId, created.id, { requestKey: randomUUID(),
      expectedRevision: created.revision, expectedCaseRevision: 0, partNumber: 1, sha256: sha(bytes) });
    const received = await service.receivePart(claim, bytes);
    const input = { requestKey: randomUUID(), expectedRevision: received.revision,
      expectedCaseRevision: 0, sha256: sha(bytes) };
    await assert.rejects(service.finalize(caseId, created.id, input, lineage), /Injected failure/);
    assert.equal(db.sources.size, 0);
    assert.equal(db.uploads[0].state, 'receiving');
    assert.equal(db.case.revision, 0);
    // Stored original bytes survive the rollback and are verified and reused by this same receipt.
    fault.active = false;
    const retry = { ...input, expectedRevision: db.uploads[0].revision };
    const final = await service.finalize(caseId, created.id, retry, lineage);
    assert.equal(db.uploads[0].state, 'retained');
    assert.equal(db.sources.size, 1);
    const replay = await service.finalize(caseId, created.id, retry, lineage);
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

test('TC2: own drafts admit ordinary and derived receipts; outside packages and properties refuse', async () => {
  const { db, pool } = memoryPool(caseId);
  const service = new LargeOriginalService(memoryStorage().storage);
  // test_only bytes; the batch's table and another item's draft package are named, not read.
  const bytes = Buffer.from('{"type":"FeatureCollection","features":[]}');
  const batchSourceId = '10000000-0000-4000-8000-000000000004';
  db.case.batchSources.add(batchSourceId);
  db.case.packages.push({ id: '10000000-0000-4000-8000-000000000005', state: 'READY_FOR_REVIEW',
    source_ids: [batchSourceId] });
  async function* parts() {
    yield bytes;
  }
  const keep = (fence: { revision: number; batchSourceId: string }) => receiveLargeLayer(caseId, fence,
    { name: 'derived.geojson', bytes: bytes.length, sha256: sha(bytes) }, byteParts(parts()), { large: service });
  await withPool(pool, async () => {
    const kept = await keep({ revision: 0, batchSourceId });
    assert.equal(db.sources.get(kept)?.sha256, sha(bytes));
    const ordinary = await service.create(caseId, { requestKey: randomUUID(),
      expectedCaseRevision: db.case.revision, filename: 'upload.geojson', mediaType: 'application/octet-stream',
      sha256: sha(bytes), bytes: bytes.length,
      provenance: { origin: 'not_stated', acquiredAt: '2026-10-22T00:00:00.000Z' } });
    assert.equal(ordinary.state, 'receiving');
    db.case.packages.push({ id: randomUUID(), state: 'READY_FOR_REVIEW', source_ids: [randomUUID()] });
    await assert.rejects(keep({ revision: db.case.revision, batchSourceId }), { code: 'STALE_REVISION' });
    db.case.packages.pop();
    db.case.properties.push(caseId);
    await assert.rejects(keep({ revision: db.case.revision, batchSourceId }), { code: 'STALE_REVISION' });
  });
  assert.equal(db.sources.size, 1);
});
