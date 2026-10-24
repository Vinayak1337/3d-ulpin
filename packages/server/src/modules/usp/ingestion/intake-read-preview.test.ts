import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import type { PoolClient } from 'pg';
import { S3Client } from '@aws-sdk/client-s3';
import { readFileSync } from 'node:fs';
import { IntakeReadPreviewPageSchema, STREAMING_VECTOR_LIMITS as limits } from '@ulpin/contracts/usp';
import { localOperatorSubject } from '../principal';
import { AppError } from '../../../infrastructure/errors';
import { sourceRecord } from './streaming-vector-reader';
import { featureExtent, measurableCrs } from './intake-package-extent';
import { readIntakeReadPreview } from './intake-read-preview';

const caseId = '35000000-0000-4000-8000-000000000001';
const itemId = '35000000-0000-4000-8000-000000000002';
const sourceId = '35000000-0000-4000-8000-000000000003';
const rawJobId = '35000000-0000-4000-8000-000000000004';
const hash = 'a'.repeat(64);
process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'read-preview-protocol';
// test_only protocol geometry; never an operational record or expected source fact.
const feature = (geometry = { type: 'Polygon',
  coordinates: [[[75, 0, 12], [75, 1, 12], [76, 1, 12], [75, 0, 12]]] } as any) => ({
  type: 'Feature', id: 'test_only-key', properties: { name: 'test_only-name' }, geometry,
});

function fixture(features = Array.from({ length: 500 }, () => feature())) {
  const source = { id: sourceId, case_id: caseId, family_id: sourceId, revision: 1, bytes: 20_000_000,
    sha256: hash, profile: 'large-original-v1', object_key: 'original-must-not-be-read', name: 'test_only.geojson',
    status: 'received', inspection: { largeOriginal: { uploadId: sourceId, operatorSubject: localOperatorSubject(),
      objectEtag: 'test_only', verifiedSha256: hash, verifiedBytes: 20_000_000, conversion: 'unsupported',
      bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed', provenance: {
        issuer: 'Protocol fixture', originalUrl: 'https://example.invalid/test_only',
        acquiredAt: '2026-10-25T00:00:00.000Z', permissionReference: 'test_only', limitations: [],
        state: 'caller_declared' } } } };
  const item = { item_id: itemId, source_id: sourceId, parent_item_id: null,
    card: { format: 'geojson', crs: { state: 'stated', code: 'EPSG:4326' } } };
  const state = { published: 3, running: true };
  const chunks: any[][] = [];
  let offset = 0, partBytes = 0;
  features.forEach((value, index) => {
    const raw = Buffer.from(JSON.stringify(value));
    const record = sourceRecord({ index, start: offset, end: offset + raw.length,
      raw, feature: value, valueIssueCode: null });
    offset += raw.length;
    const size = Buffer.byteLength(JSON.stringify(record));
    if (!chunks.length || chunks.at(-1)!.length === limits.chunkFeatures
      || partBytes + size > limits.chunkBytes - 1024) {
      chunks.push([]);
      partBytes = 0;
    }
    chunks.at(-1)!.push(record);
    partBytes += size;
  });
  const statements: string[] = [], reads: number[] = [];
  const client = { release() {}, query: async (sql: string, values: any[] = []) => {
    statements.push(sql);
    assert.match(sql, /^(SELECT|BEGIN|COMMIT|ROLLBACK)/);
    if (sql.includes('FROM usp_intake_items')) return { rows: [item] };
    if (sql.includes('FROM cases')) return { rows: [{ id: caseId, revision: 1, archived: false }] };
    if (sql.includes('FROM sources')) return { rows: [source] };
    if (sql.includes('FROM operations')) return { rows: [{ job_id: rawJobId }] };
    if (sql.includes('usp_streaming_vector_slots')) return { rows: chunks.map((records, index) => ({
      chunk_index: index, last: records.at(-1).featureIndex,
    })).filter(slot => slot.chunk_index < values[1] && slot.last > values[2]).slice(0, 32) };
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    assert.fail(sql);
  } } as unknown as PoolClient;
  const deps: any = { transaction: async (action: (c: PoolClient) => unknown) => action(client), reader: {
    status: async () => ({ sourceRevision: 1, sourceSha256: hash, framing: 'feature-collection', issueCode: null,
      status: state.running ? 'running' : 'completed', nextPublishIndex: state.published }),
    chunk: async (_case: string, _source: string, _job: string, index: number) => {
      assert.ok(index < state.published, 'unpublished chunks stay unread');
      reads.push(index);
      return { payload: { records: chunks[index] }, slot: { lastFeatureIndex: chunks[index].at(-1).featureIndex } };
    },
  } };
  const read = (after?: number) => readIntakeReadPreview(caseId, itemId, { after }, deps);
  const seal = (metadata: Record<string, unknown>) => {
    state.published = chunks.length;
    state.running = false;
    const receipt = { version: 'streamed-map-original/1', coverage: 'sealed', unknownRemainder: false,
      sourceId, sourceRevision: 1, sourceBytes: source.bytes, sourceSha256: hash, readerVersion: 'geojson-stream/2',
      rawJobId, framing: 'feature-collection', parts: chunks.length, features: features.length,
      accepted: features.length, quarantined: 0, rawManifestSha256: hash, collectionMetadata: metadata,
      reference: { sourceCrs: 'EPSG:4326', evidence: 'test_only', coordinateUnit: 'degree' } };
    Object.assign(source.inspection, { streamedMapReceipt: receipt });
    return receipt;
  };
  return { source, item, state, chunks, deps, read, seal, client, reads, statements };
}

test('five test_only chunks: only 0–2 while running; after returns accepted features once in order', async t => {
  const f = fixture();
  f.chunks[1][5].disposition = 'quarantined';
  const storage = t.mock.method(S3Client.prototype, 'send', async () => assert.fail('No original read or write'));
  const first = await f.read();
  assert.deepEqual(f.reads, [0, 1, 2]);
  assert.equal(first.features.length, 299);
  assert.equal(first.chunksRead, 3);
  assert.equal(first.reading, true);
  assert.match(first.words, /Preview.*not a record, not reviewed, not placed/);
  assert.match(first.words, /Packages follow/);
  assert.doesNotMatch(JSON.stringify(first), /properties|test_only-key|name/);
  assert.equal(IntakeReadPreviewPageSchema.safeParse({ ...first,
    features: [{ ...first.features[0], properties: {} }] }).success, false);
  assert.deepEqual(first.features[0].geometry,
    { type: 'Polygon', coordinates: [[[75, 0], [75, 1], [76, 1], [75, 0]]] });
  f.state.published = 5;
  f.state.running = false;
  const last = await f.read(first.next!);
  assert.equal(last.features.length, 200);
  assert.equal(last.next, null);
  assert.match(last.words, /reader has finished.*packages/);
  assert.deepEqual([...first.features, ...last.features].map(value => value.featureIndex),
    Array.from({ length: 500 }, (_, index) => index).filter(index => index !== 105));
  assert.equal(storage.mock.callCount(), 0);
  assert.ok(f.statements.every(sql => sql.startsWith('SELECT')));
});

test('WGS 84 UTM 43N converts the known central-meridian point to 1e-7 degrees; Z is dropped', async () => {
  const f = fixture([feature({ type: 'Point', coordinates: [500000, 0, 9] })]);
  f.state.published = 1;
  f.item.card.crs.code = 'EPSG:32643';
  const page = await f.read();
  const coordinates = (page.features[0].geometry as { coordinates: number[] }).coordinates;
  assert.ok(Math.abs(coordinates[0] - 75) < 1e-7 && Math.abs(coordinates[1]) < 1e-7);
});

test('unsupported EPSG:7755 and unread CRS give no features, no part reads and explicit CRS words', async () => {
  for (const code of ['EPSG:7755', null]) {
    const f = fixture();
    f.item.card.crs.code = code as any;
    const page = await f.read();
    assert.deepEqual(page.features, []);
    assert.match(page.words, /needs a stated, supported CRS/);
    assert.deepEqual(f.reads, []);
  }
  const stale = fixture();
  stale.source.revision++;
  await assert.rejects(stale.read(), (error: unknown) =>
    error instanceof AppError && error.code === 'INTAKE_READ_PREVIEW_PIN');
});

test('2000-feature and 4 MiB coordinate bounds resume inside a chunk without repeats', async () => {
  for (const geometry of [{ type: 'Point', coordinates: [75, 0] }, { type: 'LineString',
    coordinates: Array.from({ length: 400 }, () => [75.12345678912345, 28.12345678912345]) }]) {
    const f = fixture(Array.from({ length: 2100 }, () => feature(geometry)));
    f.state.published = f.chunks.length;
    f.state.running = false;
    const indices: number[] = [];
    let after: number | undefined;
    do {
      const page = await f.read(after);
      assert.ok(page.features.length <= 2000);
      assert.ok(page.features.reduce((sum, value) => sum + Buffer.byteLength(JSON.stringify(value.geometry)), 0)
        <= 4 * 1024 * 1024);
      indices.push(...page.features.map(value => value.featureIndex));
      after = page.next ?? undefined;
    } while (after !== undefined);
    assert.deepEqual(indices, Array.from({ length: 2100 }, (_, index) => index));
  }
});

test('real NYC and area originals wait for their late CRS; sealed outlines and named conversions match', async () => {
  for (const path of ['fixtures/real-nyc/original.geojson', 'fixtures/real-area/original.geojson']) {
    const original = JSON.parse(readFileSync(path, 'utf8')), f = fixture(original.features);
    f.state.published = f.chunks.length;
    f.item.card.crs.code = null as any;
    assert.deepEqual((await f.read()).features, []);
    f.seal({ crs: original.crs });
    const page = await f.read();
    assert.equal(page.features.length, original.features.length);
    assert.deepEqual(page.features.map(value => value.geometry),
      original.features.map((value: any) => value.geometry));
    assert.doesNotMatch(JSON.stringify(page), /properties|base_bbl|height_roof/);
  }
  for (const code of ['EPSG:3857', 'EPSG:32743']) {
    const crs = measurableCrs({ crs: { type: 'name', properties: { name: code } } })!;
    const input = feature({ type: 'Point', coordinates: [500000, 1000000] });
    const control = fixture([input]);
    control.state.published = 1;
    control.item.card.crs.code = code;
    const converted = await control.read();
    assert.deepEqual(converted.features[0].geometry,
      { type: 'Point', coordinates: featureExtent(input, crs)!.geographic });
  }
});

test('sealed metadata permits no-crs and CRS84; mismatched receipts never imply degrees', async () => {
  for (const metadata of [{}, { crs: { type: 'name', properties: { name: 'OGC:CRS84' } } }]) {
    const f = fixture();
    f.item.card.crs.code = null as any;
    const receipt = f.seal(metadata);
    assert.equal((await f.read()).features.length, 500);
    receipt.sourceSha256 = 'b'.repeat(64);
    assert.deepEqual((await f.read()).features, []);
  }
});

test('M and mixed dimensions stay refused; original authority and published parts are required', async () => {
  const f = fixture([feature({ type: 'Point', coordinates: [75, 0, 12, 4] }),
    feature({ type: 'LineString', coordinates: [[75, 0], [75, 1, 12]] })]);
  f.state.published = 1;
  assert.deepEqual((await f.read()).features, []);
  f.state.published = 0;
  await assert.rejects(f.read(), (error: unknown) => error instanceof AppError && error.status === 404);
  f.source.inspection.largeOriginal.operatorSubject = 'another-context';
  await assert.rejects(f.read(), (error: unknown) => error instanceof AppError && error.status === 403);
});

test('route rejects unknown/repeated queries before reading, and refuses a non-large item', async t => {
  createRequire(new URL('../../../../../../apps/api/package.json', import.meta.url))('reflect-metadata');
  const controllerPath = '../../../../../../apps/api/src/modules/ingestion/ingestion.controller';
  const { IngestionController } = await import(controllerPath);
  const controller = new IngestionController({} as never), f = fixture();
  const globals = globalThis as unknown as { ulpinPool: unknown }, prior = globals.ulpinPool;
  globals.ulpinPool = { connect: async () => f.client };
  t.after(() => { globals.ulpinPool = prior; });
  for (const suffix of ['?extra=1', '?after=0&after=1']) assert.throws(() =>
    controller.intakeReadPreview(caseId, itemId, { originalUrl: `/read-preview${suffix}` } as any),
  (error: unknown) => error instanceof AppError && error.code === 'INTAKE_READ_PREVIEW_QUERY');
  f.source.profile = 'geojson-manual-v1';
  Object.assign(f.source.inspection, { actor: localOperatorSubject() });
  await assert.rejects(controller.intakeReadPreview(caseId, itemId, { originalUrl: '/read-preview' } as any),
    (error: unknown) => error instanceof AppError && error.code === 'INTAKE_READ_PREVIEW_ITEM');
  assert.equal(IntakeReadPreviewPageSchema.safeParse({}).success, false);
});
