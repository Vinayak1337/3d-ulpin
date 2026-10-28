import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, mock, test } from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';
import { SourceProfileSchema, type ArchiveMemberLineage } from '@ulpin/contracts/usp';
import { settings } from '../../../infrastructure/config';
import { sha256 } from '../../../infrastructure/storage';
import { memoryPool, withPool } from './large-original-memory.test-fixture';
import { ManualIngestionService } from './service';

const bytes = readFileSync('fixtures/google-uttam/block-boundary.geojson');
const file = { name: 'block-boundary.geojson', bytes };
const savedSubject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;

afterEach(() => {
  mock.restoreAll();
  if (savedSubject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = savedSubject;
});

/** Only processor and object I/O are stubbed; retain and its package-rule transactions run unchanged. */
function authority() {
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'tc3-test-only';
  const caseId = randomUUID(), archiveId = randomUUID();
  const { db, pool } = memoryPool(caseId);
  db.case.revision = 7;
  db.case.packages.push({ id: randomUUID(), state: 'READY_FOR_REVIEW', source_ids: [archiveId] });
  db.case.batchSources.add(archiveId);
  const lineage: ArchiveMemberLineage = { version: 'zip-layer/1', parentSourceId: archiveId,
    parentSourceRevision: 1, parentSha256: sha256('test_only archive pin'), parentItemId: randomUUID(),
    memberPath: 'uttam/block-boundary.geojson', ordinal: 0, memberBytes: bytes.length,
    compressedBytes: bytes.length, crc32: 0, memberSha256: sha256(bytes) };
  const request = { format: 'geojson', requestKey: randomUUID(), expectedWorkspaceRevision: 7 };
  const service = new ManualIngestionService();
  return { caseId, archiveId, db, pool, lineage, request, service };
}

function processorAndStorage() {
  for (const name of ['s3Endpoint', 's3Region', 's3Bucket', 's3AccessKey', 's3SecretKey'] as const)
    mock.getter(settings, name, () => 'tc3-test-only');
  mock.getter(settings, 'geoUrl', () => 'http://tc3.invalid');
  mock.getter(settings, 'geoToken', () => 'test-only');
  const objects = new Map<string, Uint8Array>();
  mock.method(S3Client.prototype, 'send', async (command: { constructor: { name: string }; input: any }) => {
    if (command.constructor.name === 'PutObjectCommand') {
      objects.set(command.input.Key, command.input.Body);
      return {};
    }
    assert.equal(command.constructor.name, 'GetObjectCommand', 'committed originals must never be deleted');
    return { Body: { transformToByteArray: async () => objects.get(command.input.Key)! } };
  });
  const fetch = mock.method(globalThis, 'fetch', async () => Response.json({ format: 'geojson',
    sourceSha256: sha256(bytes), featureCount: JSON.parse(bytes.toString()).features.length,
    sourceCrs: 'EPSG:4326', crsUnit: 'degree', crsEvidence: 'test_only processor boundary stub',
    geometryTypes: ['Polygon'], fields: [], layer: null }));
  return { objects, fetch };
}

test('TC3: a small ZIP member is kept through retain after a sibling drafted; replay keeps no second source',
  async () => {
    const context = authority();
    const { service, caseId, request, lineage, db, pool } = context;
    const io = processorAndStorage();
    await withPool(pool, async () => {
      const result = SourceProfileSchema.parse(await service.retain(caseId, request, file, lineage));
      assert.equal(result.source.sourceSha256, sha256(bytes));
      assert.equal(result.workspaceRevision, 8);
      assert.deepEqual(db.sources.get(result.source.sourceId)?.inspection.archiveMember, lineage);
      assert.equal((await service.inspectAny(caseId, result.source.sourceId)).source.sourceId,
        result.source.sourceId, 'non-table receipts can also be read back beside the batch drafts');
      assert.deepEqual(await service.retain(caseId, request, file, lineage), result);
      const duplicate = await service.retain(caseId, { ...request, requestKey: randomUUID() }, file, lineage);
      assert.equal(duplicate.source.sourceId, result.source.sourceId);
      assert.equal((await service.retain(caseId, { ...request, requestKey: randomUUID() }, file))
        .source.sourceId, result.source.sourceId, 'a sibling drop needs no lineage exemption');
      db.case.batchSources.clear();
      await assert.rejects(service.retain(caseId, request, file, lineage), { code: 'STALE_REVISION' });
      db.case.batchSources.add(lineage.parentSourceId);
      db.case.properties.push(randomUUID());
      await assert.rejects(service.retain(caseId, request, file, lineage), { code: 'STALE_REVISION' });
    });
    assert.equal(db.sources.size, 1);
    assert.equal(io.objects.size, 1);
    assert.equal(io.fetch.mock.callCount(), 1);
    assert.equal(db.case.revision, 8);
  });

test('TC3: processor failure still keeps a batch member original; retry attaches its receipt without a copy',
  async () => {
    const { service, caseId, request, lineage, db, pool } = authority();
    const io = processorAndStorage();
    io.fetch.mock.mockImplementationOnce(async () => Response.json({}, { status: 503 }));
    await withPool(pool, async () => {
      await assert.rejects(service.retain(caseId, request, file, lineage), { code: 'AREA_PROCESSING' });
      assert.equal(db.sources.size, 1);
      const [original] = db.sources.values();
      assert.equal(original.inspection.manualProfile, undefined);
      const result = await service.retain(caseId, request, file, lineage);
      assert.equal(result.source.sourceId, original.id);
    });
    assert.equal(db.sources.size, 1);
    assert.equal(io.objects.size, 1);
    assert.equal(db.case.revision, 8);
  });

for (const refusal of ['package outside batch', 'source outside batch', 'property link'] as const) {
  test(`TC3: retain still refuses ${refusal} before processor or storage I/O`, async () => {
    const { service, caseId, request, lineage, db, pool } = authority();
    const io = processorAndStorage();
    if (refusal === 'package outside batch') db.case.packages.push({ id: randomUUID(),
      state: 'READY_FOR_REVIEW', source_ids: [randomUUID()] });
    if (refusal === 'source outside batch') db.case.batchSources.clear();
    if (refusal === 'property link') {
      db.case.packages.length = 0;
      db.case.properties.push(randomUUID());
    }
    await withPool(pool, () => assert.rejects(service.retain(caseId, request, file,
      refusal === 'package outside batch' ? undefined : lineage), { code: 'STALE_REVISION' }));
    assert.equal(db.sources.size, 0);
    assert.equal(io.objects.size, 0);
    assert.equal(io.fetch.mock.callCount(), 0);
    assert.equal(db.case.revision, 7);
  });
}

test('TC3: a caller cannot put a batch exemption in the retain request body', async () => {
  const { service, caseId, request, archiveId, db, pool } = authority();
  const io = processorAndStorage();
  await withPool(pool, () => assert.rejects(service.retain(caseId,
    { ...request, batchSourceId: archiveId }, file)));
  assert.equal(db.sources.size, 0);
  assert.equal(io.objects.size, 0);
  assert.equal(io.fetch.mock.callCount(), 0);
});
