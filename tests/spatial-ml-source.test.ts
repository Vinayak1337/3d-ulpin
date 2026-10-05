import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import type { PoolClient } from 'pg';
import { AppError } from '../packages/server/src/infrastructure/errors';
import { sha256, closeStorageClient } from '../packages/server/src/infrastructure/storage';
import { DocumentPagesService } from '../packages/server/src/modules/usp/ingestion/document-pages';
import { SpatialMlSourceService, spatialMlSourceAuthorityTx, spatialMlSourceService, spatialMlSourceBatchSchema,
  spatialMlSourcePixelReceipt, readSpatialMlObject } from '../packages/server/src/modules/spatial/spatial-ml-source';
import { createSpatialMlSourceBatch, getSpatialMlItem, getSpatialMlBatch, retrySpatialMlItem, cancelSpatialMlItem,
  admitSpatialMlDispatch, ingestSpatialMlJob, applySpatialMlItem, deriveSpatialMlGeometry, spatialMlArtifact,
  validateRetainedInference, type InferencePayload } from '../packages/server/src/modules/spatial/spatial-ml';
import { createSpatialMlFootprintDraft } from '../packages/server/src/modules/spatial/spatial-ml-footprints';

const require = createRequire(new URL('../packages/server/package.json', import.meta.url)), { S3Client } = require('@aws-sdk/client-s3');
const caseId = '10000000-0000-4000-8000-000000000001', sourceId = '10000000-0000-4000-8000-000000000002', key = '10000000-0000-4000-8000-000000000003';
const original = Buffer.from('technical byte/authority control; not an operational PDF');
const frame = { kind: 'pdf_display_page_top_left_points' as const, width: 612, height: 792, rotation: 0 };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const input = { scope: 'source' as const, caseId, caseRevision: 2, sourceId, sourceRevision: 1, sourceSha256: sha256(original),
  sourceBytes: original.length, page: 1, frame, region: { x: .2, y: .2, width: .4, height: .4 }, task: 'floor-plan' as const, modelId: 'technical-floor-model', requestKey: key };
const error = (status: number, code?: string) => (e: unknown) => e instanceof AppError && e.status === status && (!code || e.code === code);

// SQL, S3 and native-page metadata are controlled envelopes. No network, native
// process, live accepted source/job, topology qualification or model execution.
async function fixture(work: (f: any) => Promise<void>) {
  const g = globalThis as any, previousPool = g.ulpinPool, previousFetch = globalThis.fetch;
  const previousSubject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT, previousSend = S3Client.prototype.send;
  const env = { GEO_URL: 'http://technical.invalid', GEO_SERVICE_TOKEN: 'technical-control', S3_ENDPOINT: 'http://technical.invalid',
    S3_REGION: 'technical', S3_BUCKET: 'technical', S3_ACCESS_KEY: 'technical', S3_SECRET_KEY: 'technical' };
  const previousEnv = Object.keys(env).map(k => process.env[k]); Object.assign(process.env, env);
  const previousPrepare = spatialMlSourceService.prepare, previousCurrent = spatialMlSourceService.current;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'source-batch-technical-operator';
  const f: any = { batches: new Map(), items: new Map(), jobs: new Map(), objects: new Map(), sql: [], io: [], depth: 0,
    archived: false, latest: 1, subject: 'source-batch-technical-operator', caseRevision: 2, context: [],
    ready: true, sourceBytes: original, pageFrame: frame, nativeReads: 0, afterPut: () => {}, afterGet: () => {}, onLock: () => {} };
  f.objects.set('private-original-control', original);
  const clone = (x: any) => structuredClone(x);
  const client: any = { release() {}, query: async (sql: string, v: any[] = []) => {
    f.sql.push(sql); const rows = (x: any[]) => ({ rows: clone(x) });
    if (sql.startsWith('BEGIN')) { f.depth++; return rows([]); }
    if (sql.startsWith('SELECT set_config')) return rows([{ deadline_live: true }]);
    if (sql === 'COMMIT' || sql === 'ROLLBACK') { f.depth--; return rows([]); }
    if (sql.startsWith('SELECT id FROM cases')) { f.onLock(); return rows([{ id: caseId }]); }
    if (sql.includes('family_id=(SELECT family_id')) return rows([{ id: sourceId }]);
    if (sql.startsWith('SELECT case_id FROM sources')) return rows([{ case_id: caseId }]);
    if (sql.startsWith('SELECT id,revision,archived')) return rows([{ id: caseId, revision: f.caseRevision, archived: f.archived, frame: { id: 'UNASSIGNED' }, context: f.context, site_id: null }]);
    if (sql.startsWith('SELECT * FROM sources')) return rows([{ id: sourceId, case_id: caseId, family_id: sourceId, revision: 1,
      name: 'Technical byte control', sha256: input.sourceSha256, bytes: String(input.sourceBytes), object_key: 'private-original-control', mime_type: 'application/pdf',
      inspection: { documentOriginal: { version: 'source-document/1', format: 'pdf', subject: f.subject, sha256: input.sourceSha256, bytes: input.sourceBytes, receivedAt: '2026-10-05T00:00:00Z' } } }]);
    if (sql.startsWith('SELECT max(revision)')) return rows([{ revision: f.latest }]);
    if (sql.startsWith('SELECT id,request_digest FROM spatial_ml_batches')) return rows([...f.batches.values()].filter((b: any) => b.case_id === v[0] && b.source_id === v[1] && b.request_key === v[2]));
    if (sql.startsWith('INSERT INTO spatial_ml_batches')) { f.batches.set(v[0], { id: v[0], package_id: null, request_key: v[1], request_digest: v[2], scope: 'source', case_id: v[3], source_id: v[4], source_scope: clone(v[5]), created_at: new Date() }); return rows([]); }
    if (sql.startsWith('INSERT INTO jobs')) { f.jobs.set(v[0], { id: v[0], case_id: v[1], source_id: v[2], operation: 'spatial-inference',
      status: sql.includes('completed_at') ? v[3] : 'queued', input_fingerprint: sql.includes('completed_at') ? v[4] : v[3], payload: clone(sql.includes('completed_at') ? v[5] : v[4]) }); return rows([]); }
    if (sql.startsWith('SELECT case_id,source_id,operation,input_fingerprint,payload,status FROM jobs')) return rows(f.jobs.has(v[0]) ? [f.jobs.get(v[0])] : []);
    if (sql.startsWith('INSERT INTO spatial_ml_items')) { f.items.set(v[0], { batch_id: v[1], body: clone(v[4]), private_input: clone(v[5]) }); return rows([]); }
    if (sql.startsWith('SELECT id,package_id,request_key')) return rows(f.batches.has(v[0]) ? [f.batches.get(v[0])] : []);
    if (sql.startsWith('SELECT body,private_input FROM spatial_ml_items WHERE batch_id')) return rows([...f.items.values()].filter((i: any) => i.batch_id === v[0]));
    if (sql.startsWith('SELECT body,private_input FROM spatial_ml_items WHERE id')) return rows(f.items.has(v[0]) ? [f.items.get(v[0])] : []);
    if (sql.startsWith('SELECT id FROM spatial_ml_items WHERE current_job_id')) return rows([...f.items.values()].filter((i: any) => i.body.currentJobId === v[0]).map((i: any) => ({ id: i.body.id })));
    if (sql.startsWith('UPDATE spatial_ml_items')) { f.items.set(v[0], { ...f.items.get(v[0]), body: clone(v[1]), private_input: clone(v[2]) }); return rows([]); }
    if (sql.startsWith('UPDATE jobs')) { const j = f.jobs.get(v[0]); if (j && ['queued', 'running'].includes(j.status)) j.status = sql.includes("status='succeeded'") ? 'succeeded' : sql.includes("status='cancelled'") ? 'cancelled' : sql.includes("status='running'") ? 'running' : 'failed'; return rows([]); }
    if (sql.startsWith('SELECT bool_and')) return rows([{ valid: true }]); // transport control, not a PostGIS test
    throw new Error(`Unexpected controlled SQL: ${sql}`);
  } };
  f.client = client;
  g.ulpinPool = { query: client.query, connect: async () => client };
  globalThis.fetch = async () => Response.json({ models: [{ id: input.modelId, task: 'floor-plan', sha256: 'a'.repeat(64), profileVersion: 'technical-profile', ready: f.ready, reason: 'Technical unavailable control' }] });
  S3Client.prototype.send = async function(command: any) {
    assert.equal(f.depth, 0, 'object I/O must not hold mutation transactions');
    const key = command.input.Key; f.io.push(command.constructor.name);
    if (command.constructor.name === 'PutObjectCommand') { f.objects.set(key, Buffer.from(command.input.Body)); f.afterPut(); return {}; }
    assert.equal(command.constructor.name, 'GetObjectCommand'); const bytes = f.objects.get(key);
    assert(bytes, 'only a retained controlled object can be read'); f.afterGet();
    return { Body: Readable.from([bytes]), ContentLength: bytes.length, ETag: 'controlled-etag' };
  };
  const pages = new DocumentPagesService({
    authorize: async () => spatialMlSourceAuthorityTx(client, input), original: async () => { assert.equal(f.depth, 0); return f.sourceBytes; },
    inspect: async () => { assert.equal(f.depth, 0); f.nativeReads++; return { result: {
      version: 'document-pages-local/1', sourceSha256: input.sourceSha256, sourceBytes: input.sourceBytes, pageCount: 1, offset: 0, limit: 1, render: null,
      pages: [{ page: 1, label: 'Page 1', sourceLabel: null, frame: f.pageFrame, mediaBox: [0, 0, 612, 792], cropBox: [0, 0, 612, 792], boxConvention: 'pymupdf_page_rectangles/1', renderSupport: 'unsupported' }],
    } }; },
  });
  const service = new SpatialMlSourceService({ capture: (pin) => spatialMlSourceAuthorityTx(client, pin), pages: (id, q) => pages.pages(id, q),
    verify: async () => { assert.equal(f.depth, 0); if (sha256(f.sourceBytes) !== input.sourceSha256) throw new AppError(422, 'SOURCE_INTEGRITY', 'Technical changed bytes'); } });
  spatialMlSourceService.prepare = service.prepare.bind(service); spatialMlSourceService.current = service.current.bind(service);
  f.create = () => createSpatialMlSourceBatch(input);
  f.output = (item: any) => {
    const artifact = { sha256: sha256(png), bytes: png.length, width: 1, height: 1, base64: png.toString('base64'), mimeType: 'image/png' };
    const pixelRegion = [Math.floor(input.region.x * 1224), Math.floor(input.region.y * 1584),
      Math.ceil((input.region.x + input.region.width) * 1224), Math.ceil((input.region.y + input.region.height) * 1584)];
    return { schemaVersion: 'spatial-inference/1', inputFingerprint: item.inputFingerprint, task: 'floor-plan', status: 'empty',
      model: { id: input.modelId, sha256: 'a'.repeat(64), profileVersion: 'technical-profile', privateKey: 'must-not-publish' },
      raster: { ...artifact, transform: { unit: 'pixel', coordinateConvention: 'pixel-edge', page: 1, sourceWidth: 1224, sourceHeight: 1584,
        region: input.region, pixelRegion, orientation: 'PDF page rotation applied', pixelToSource: [pixelRegion[2] - pixelRegion[0], 0, pixelRegion[0], 0, pixelRegion[3] - pixelRegion[1], pixelRegion[1]], pdfPagePoints: [612, 792], pdfRenderScale: 2, renderer: 'pypdfium2', privateKey: 'must-not-publish' } },
      mask: artifact, components: [], receipt: { sourceId, sourceSha256: input.sourceSha256, modelSha256: 'a'.repeat(64), profileVersion: 'technical-profile', inputFingerprint: item.inputFingerprint,
        omittedComponents: { small: 0, complex: 0, invalid: 0, capacity: 0 }, objectKey: 'private-original-control', secret: 'must-not-publish' } };
  };
  try { await work(f); }
  finally {
    if (previousPool === undefined) delete g.ulpinPool; else g.ulpinPool = previousPool;
    globalThis.fetch = previousFetch; S3Client.prototype.send = previousSend; closeStorageClient();
    Object.keys(env).forEach((k, i) => { if (previousEnv[i] === undefined) delete process.env[k]; else process.env[k] = previousEnv[i]; });
    spatialMlSourceService.prepare = previousPrepare; spatialMlSourceService.current = previousCurrent;
    if (previousSubject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT; else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previousSubject;
  }
}

test('strict source-only input pins one actual page/frame/region and rejects package/processor fields', () => {
  assert(spatialMlSourceBatchSchema.safeParse(input).success);
  for (const extra of [{ packageId: key }, { partId: key }, { objectKey: 'caller' }, { task: 'building' }, { page: 101 }, { sourceBytes: 17 * 1024 ** 2 }, { region: { x: .9, y: 0, width: .2, height: .1 } }])
    assert(!spatialMlSourceBatchSchema.safeParse({ ...input, ...extra }).success);
});

test('queue/read/replay/retry retain canonical jobs and nullable package/part without leaking private input', async () => fixture(async f => {
  const batch = await f.create(), item = batch.items[0];
  assert.equal(batch.packageId, null); assert.equal(item.partId, null); assert.equal(item.scope?.kind, 'source');
  assert.equal(item.scope.calibration, null); assert.equal(item.scope.applicability, 'not_assessed');
  assert.equal(f.jobs.size, 1); assert.equal(f.items.size, 1); assert.equal(f.batches.size, 1);
  const firstInsert = f.sql.findIndex((s: string) => s.startsWith('INSERT INTO spatial_ml_batches'));
  assert(f.sql.slice(0, firstInsert).some((s: string) => s.includes('ORDER BY id FOR SHARE')));
  assert.equal((await f.create()).id, batch.id); assert.equal(f.jobs.size, 1);
  await assert.rejects(createSpatialMlSourceBatch({ ...input, region: { ...input.region, x: .1 } }), error(409, 'ML_REQUEST_KEY'));
  assert(!JSON.stringify(await getSpatialMlBatch(batch.id)).includes('private-original-control'));
  assert(!JSON.stringify(await getSpatialMlItem(item.id)).includes('sourceAuthority'));
  await cancelSpatialMlItem(item.id);
  const retry = await retrySpatialMlItem(item.id, key); assert.equal(retry.state, 'queued'); assert.equal(f.jobs.size, 2);
  assert.equal((await retrySpatialMlItem(item.id, key)).currentJobId, retry.currentJobId); assert.equal(f.jobs.size, 2);
  f.subject = 'revoked'; await assert.rejects(retrySpatialMlItem(item.id, key), error(403));
}));

test('current family/frame/bytes and final case/context drift refuse queue and disclosure', async () => fixture(async f => {
  f.latest = 2; await assert.rejects(f.create(), error(409)); f.latest = 1;
  f.pageFrame = { ...frame, width: 700 }; await assert.rejects(f.create(), error(409)); f.pageFrame = frame;
  f.sourceBytes = Buffer.from('changed'); await assert.rejects(f.create(), error(422)); f.sourceBytes = original;
  f.onLock = () => { f.context = [{ changed: true }]; };
  await assert.rejects(f.create(), error(409)); assert.equal(f.jobs.size, 0); assert.equal(f.batches.size, 0);
  f.onLock = () => {}; f.context = [];
  const b = await f.create(); f.caseRevision = 3;
  await assert.rejects(getSpatialMlBatch(b.id), error(409)); f.caseRevision = 2;
  f.subject = 'revoked'; await assert.rejects(getSpatialMlItem(b.items[0].id), error(403));
}));

test('queued source revocation is terminal before processor submission, while package dispatch stays compatible', async () => fixture(async f => {
  const b = await f.create(), item = b.items[0];
  assert.equal(await admitSpatialMlDispatch(item.currentJobId), true);
  f.archived = true; assert.equal(await admitSpatialMlDispatch(item.currentJobId), false);
  assert.equal(f.items.get(item.id).body.state, 'blocked'); assert.equal(f.jobs.get(item.currentJobId).status, 'failed');
  assert.equal(f.io.length, 0, 'refused dispatch never reads/writes processor artifacts');
  f.archived = false;
  const old = f.items.get(item.id); delete old.body.scope; old.body.packageId = key; old.body.partId = key; delete old.private_input.sourceAuthority;
  assert.equal(await admitSpatialMlDispatch(item.currentJobId), true);
}));

test('source-only apply, calibration and footprint routes refuse before physical writes', async () => fixture(async f => {
  const { items: [item] } = await f.create(); f.sql.length = 0;
  const calibration = { rasterSha256: sha256(png), imagePoints: [[0, 0], [1, 0]], worldPoints: [[0, 0], [1, 0]], frame: 'technical-metres', reason: 'Technical control only' };
  assert.throws(() => deriveSpatialMlGeometry(item, calibration as any), error(422, 'ML_SOURCE_ONLY'));
  await assert.rejects(applySpatialMlItem(item.id, { expectedRevision: 1, requestKey: key, entityId: key, selections: [{ componentId: key, subject: 'control' }], property: 'space.geometry', calibration }), error(422, 'ML_SOURCE_ONLY'));
  await assert.rejects(createSpatialMlFootprintDraft(item.id, {}), error(422, 'ML_SOURCE_ONLY'));
  assert(!f.sql.some((s: string) => s.startsWith('BEGIN') || s.startsWith('INSERT') || s.includes('physical-area')));
}));

test('registered source job input cannot drift independently of the item receipt', async () => fixture(async f => {
  const { items: [item] } = await f.create();
  f.jobs.get(item.currentJobId).payload.page = 2;
  assert.equal(await admitSpatialMlDispatch(item.currentJobId), false);
  assert.equal(f.items.get(item.id).body.state, 'blocked'); assert.equal(f.jobs.get(item.currentJobId).status, 'failed');
}));

test('publication, private artifact read and late cancellation retain only authorized pixel results', async () => fixture(async f => {
  const { items: [item] } = await f.create();
  await ingestSpatialMlJob(item.currentJobId, f.output(item));
  const completed = await getSpatialMlItem(item.id); assert.equal(completed.state, 'empty');
  const visible = JSON.stringify(completed); assert(!visible.includes('private-original-control')); assert(!visible.includes('must-not-publish'));
  const artifact = await spatialMlArtifact(item.id, 'mask', new URL(completed.result!.mask.url, 'http://technical.invalid'));
  assert.equal(artifact.headers.get('Cache-Control'), 'no-store'); assert.deepEqual(Buffer.from(await artifact.arrayBuffer()), png);
  f.afterGet = () => { f.subject = 'revoked'; };
  await assert.rejects(spatialMlArtifact(item.id, 'mask', new URL(completed.result!.mask.url, 'http://technical.invalid')), error(403));
}));

test('cancellation and authority changes during artifact retention fence final publication', async () => fixture(async f => {
  const { items: [item] } = await f.create();
  f.afterPut = () => { const r = f.items.get(item.id); r.body.state = 'cancelled'; f.jobs.get(item.currentJobId).status = 'cancelled'; };
  await ingestSpatialMlJob(item.currentJobId, f.output(item));
  assert.equal(f.items.get(item.id).body.state, 'cancelled'); assert.equal(f.items.get(item.id).body.result, undefined);
  f.afterPut = () => {}; const retry = await retrySpatialMlItem(item.id, key);
  // A terminal registered job is also a fence, even if an interrupted older writer
  // has not yet reflected that status on the item body.
  f.afterPut = () => { f.jobs.get(retry.currentJobId).status = 'cancelled'; };
  await ingestSpatialMlJob(retry.currentJobId, f.output(retry));
  assert.equal(f.items.get(item.id).body.result, undefined);
  f.jobs.get(retry.currentJobId).status = 'queued';
  f.afterPut = () => { f.context = [{ changed: true }]; };
  await ingestSpatialMlJob(retry.currentJobId, f.output(retry));
  assert.equal(f.items.get(item.id).body.state, 'blocked'); assert.equal(f.items.get(item.id).body.result, undefined);
}));

test('artifact stream rejects oversized, truncated and corrupt bytes before publication', async () => fixture(async f => {
  f.objects.set('test-artifact', png);
  await assert.rejects(readSpatialMlObject('test-artifact', 9 * 1024 ** 2, sha256(png), 8 * 1024 ** 2), error(413));
  await assert.rejects(readSpatialMlObject('test-artifact', png.length + 1, sha256(png), 8 * 1024 ** 2), error(422));
  await assert.rejects(readSpatialMlObject('test-artifact', png.length, 'b'.repeat(64), 8 * 1024 ** 2), error(422));
}));

const retainedRoot = process.env.ULPIN_D07_RETAINED_ROOT ?? 'E:/BhuAayam-data/task-data/d07-haryana-candidate-path-20261005-run01';
test('unchanged retained T3-2 response preserves 92 polygons/8 multipolygons and actual page/crop transport pins', { skip: !existsSync(`${retainedRoot}/production-output.json`) }, async () => {
  const bytes = readFileSync(`${retainedRoot}/production-output.json`);
  assert.equal(sha256(bytes), '97a7cf5e86abe55dd88ccb05a0cadbb0d1453ea3444aa8753bba41f610af108a');
  const raw = JSON.parse(bytes.toString()), transform = raw.raster.transform;
  const expected: InferencePayload = { schemaVersion: 'spatial-inference/1', inputFingerprint: raw.inputFingerprint, task: raw.task,
    modelId: raw.model.id, expectedModelSha256: raw.model.sha256, expectedProfileVersion: raw.model.profileVersion, page: 1, region: transform.region,
    source: { id: raw.receipt.sourceId, objectKey: 'controlled-transport-only', sha256: raw.receipt.sourceSha256, bytes: 1630108, mimeType: 'application/pdf' } };
  const output = await validateRetainedInference(raw, expected, { query: async () => ({ rows: [{ valid: true }] }) } as any);
  assert.equal(output.components.filter(c => c.geometry.type === 'Polygon').length, 92);
  assert.equal(output.components.filter(c => c.geometry.type === 'MultiPolygon').length, 8);
  const scope: any = { kind: 'source', caseId, caseRevision: 2, sourceId, sourceRevision: 1, sourceSha256: expected.source.sha256, sourceBytes: 1630108,
    page: 1, frame: { ...frame, width: 2586, height: 1694 }, region: transform.region, locator: { kind: 'pdf_page', page: 1 }, calibration: null, applicability: 'not_assessed' };
  const receipt = spatialMlSourcePixelReceipt(scope, output.raster, output.receipt);
  assert.equal(receipt.floorRepresentation?.completePolygons, false); assert.equal(receipt.floorRepresentation?.maskOnlyComponents.length, 100);
  assert.deepEqual(receipt.rasterTransform.pixelRegion, [1036, 69, 1926, 585]);
  assert.throws(() => spatialMlSourcePixelReceipt({ ...scope, frame: { ...scope.frame, width: 2700 } }, output.raster, output.receipt), error(422, 'ML_SOURCE_FRAME_MISMATCH'));
});
