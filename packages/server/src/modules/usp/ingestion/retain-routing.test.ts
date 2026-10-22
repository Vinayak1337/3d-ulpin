import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import type { Pool, PoolClient } from 'pg';
import { SourceProfileSchema, TabularSourceProfileSchema, type IntakeCard } from '@ulpin/contracts/usp';
import { settings } from '../../../infrastructure/config';
import { sha256 } from '../../../infrastructure/storage';
import { ManualIngestionService, assertTableByteKind, prepareRetainedGeojsonTx } from './service';
import { intakeReaderRoute } from './intake-draft';
import { inspectTabularSource } from './tabular-source';
import { probeOriginal } from './intake-probe';
import { intakeNameWords } from './intake-text';
import { geojsonFeatureCount } from './registry';
import { intakeDraftLimit } from './intake-draft';
import { isRetainedMapOriginal } from './retained-map-original';
import { surfaceReader } from './intake-surface';
import type { IntakeSourceRow } from './intake-context';

const root = 'E:/BhuAayam-data/';
const nycPath = root + 'datasets/nyc-10013/files/buildings-original.geojson';
const pdfPath = root + 'datasets/rera-storeys/RERAP2311201700019-3/bihar-magnolia-sanctioned-layout-original.pdf';
const nyc = readFileSync(nycPath);
const pdf = readFileSync(pdfPath);
const subject = 'rt1-routing-test';
const caseId = '10000000-0000-4000-8000-000000000001';
const sourceId = '10000000-0000-4000-8000-000000000002';
const globals = globalThis as unknown as { ulpinPool?: Pool };
let savedPool: Pool | undefined;
let savedSubject: string | undefined;

beforeEach(() => {
  savedPool = globals.ulpinPool;
  savedSubject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = subject;
});
afterEach(() => {
  globals.ulpinPool = savedPool;
  if (savedSubject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = savedSubject;
  mock.restoreAll();
});

async function probe(bytes: Uint8Array, name: string): Promise<IntakeCard> {
  return probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, name);
}

function stored(bytes: Uint8Array, name: string): IntakeSourceRow {
  return { id: sourceId, case_id: caseId, family_id: sourceId, revision: 1, name,
    profile: 'large-original-v1', bytes: bytes.length, sha256: sha256(bytes),
    object_key: `large-originals/${sourceId}/original`, status: 'needs_input',
    inspection: { largeOriginal: { operatorSubject: subject, verifiedBytes: bytes.length,
      verifiedSha256: sha256(bytes), objectEtag: '"rt1-test"' } } };
}

function storage(bytes: Uint8Array) {
  for (const name of ['s3Endpoint', 's3Region', 's3Bucket', 's3AccessKey', 's3SecretKey'] as const)
    mock.getter(settings, name, () => 'rt1-test-only');
  const objects = new Map<string, Uint8Array>();
  const calls: string[] = [];
  mock.method(S3Client.prototype, 'send', async (command: { constructor: { name: string }; input: any }) => {
    const { Key: key, Body: body } = command.input;
    calls.push(command.constructor.name);
    if (command.constructor.name === 'PutObjectCommand') {
      objects.set(key, body);
      return {};
    }
    assert.notEqual(command.constructor.name, 'DeleteObjectCommand', 'no committed original may be deleted');
    const value = objects.get(key) ?? bytes;
    return { Body: Object.assign(Readable.from([value]), { transformToByteArray: async () => value }),
      ContentLength: value.length, ETag: '"rt1-test"' };
  });
  return { objects, calls };
}

test('a real PDF named .json is routed by PDF bytes, while a non-PDF named .pdf is kept with honest words',
  async () => {
    const card = await probe(pdf, 'plan.json');
    assert.equal(intakeReaderRoute(card, stored(pdf, 'plan.json')), 'pdf');
    assert.equal(intakeNameWords(card, 'plan.json'), 'Named .json, read as PDF.');
    const unknown = await probe(Buffer.from('test_only unrecognised bytes'), 'not-a-pdf.pdf');
    assert.equal(unknown.format, 'unknown');
    assert.equal(intakeNameWords(unknown, 'not-a-pdf.pdf'),
      'Named .pdf, its bytes are not a PDF: kept, not read.');
  });

test('CityJSON named .json is recognised as CityJSON, never sent to the GeoJSON collection adapter', async () => {
  // Generated test_only structure, not a city record or a claim of supported CityJSON model extraction.
  const bytes = Buffer.from('{"type":"CityJSON","version":"2.0","CityObjects":{},"vertices":[]}');
  const card = await probe(bytes, 'city.json');
  assert.equal(intakeReaderRoute(card, stored(bytes, 'city.json')), 'cityjson');
  assert.equal(intakeNameWords(card, 'city.json'), 'Named .json, read as CityJSON.');
});

test('a small 2,500-feature collection uses streaming instead of the bounded feature refusal', async () => {
  // Test-only repetition of unchanged real geometries; not a publisher original or independent records.
  const original = JSON.parse(nyc.toString('utf8'));
  const bytes = Buffer.from(JSON.stringify({ ...original,
    features: Array.from({ length: 2500 }, (_, index) => original.features[index % original.features.length]) }));
  assert(bytes.length < 16 * 1024 * 1024);
  assert.equal(geojsonFeatureCount(bytes), 2500);
  const source = stored(bytes, 'dense.geojson');
  const io = storage(bytes);
  let writes = 0;
  const client = { query: async () => {
    writes++;
    return { rows: [] };
  } } as unknown as PoolClient;
  assert.equal(intakeReaderRoute(await probe(bytes, source.name), source), 'inspect_geojson');
  assert.equal(await prepareRetainedGeojsonTx(client, source), false);
  assert.equal(writes, 0, 'no bounded profile is written for an over-feature-limit original');
  assert.deepEqual(io.calls, ['GetObjectCommand']);
  const counted = await probe(bytes, source.name);
  counted.counts.features = geojsonFeatureCount(bytes);
  assert.equal(intakeReaderRoute(counted, source), 'streamed_geojson');
});

test('REH9 act 1 keeps its bounded footprints, CSV table, raster and point-cloud readers', async () => {
  const inputs = [
    [nycPath, 'bounded_geojson'],
    [root + 'datasets/nyc-10013-linked/nyc-landmarks-preservation-commission/gpmc-yuvp.csv', 'csv'],
    [root + 'task-data/nyc-10013-multimodal/upload/nyc-10013-ortho-2018.tif', 'geotiff'],
    [root + 'task-data/nyc-10013-multimodal/upload/nyc-10013-lidar-2017.laz', 'laz'],
  ];
  for (const [path, expected] of inputs) {
    const bytes = readFileSync(path), source = stored(bytes, basename(path));
    const card = await probe(bytes, source.name);
    if (card.format === 'geojson') card.counts.features = geojsonFeatureCount(bytes);
    assert.equal(intakeReaderRoute(card, source), expected, path);
    if (expected === 'geotiff') assert.deepEqual(surfaceReader(card, bytes.length), { operation: 'raster-window' });
    if (expected === 'laz') assert.deepEqual(surfaceReader(card, bytes.length), { operation: 'point-batch' });
    if (expected === 'csv') await assertTableByteKind(bytes,
      { format: 'csv', sheet: 'csv', table: null, headerRows: [1] });
  }
});

for (const geometry of ['Point', 'LineString', 'Polygon']) {
  test(`a retained small ${geometry} collection named .txt gets the existing bounded profile`, async () => {
    // Generated test_only protocol shapes, never operational geometry or evaluation truth.
    const coordinates = { Point: [1, 2], LineString: [[1, 2], [2, 3]],
      Polygon: [[[1, 2], [2, 2], [2, 3], [1, 2]]] }[geometry];
    const bytes = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [
      { type: 'Feature', id: 'test_only', properties: {}, geometry: { type: geometry, coordinates } },
    ] }));
    storage(bytes);
    const source = stored(bytes, 'map.txt');
    mock.getter(settings, 'geoUrl', () => 'http://rt1.invalid');
    mock.getter(settings, 'geoToken', () => 'test-only');
    mock.method(globalThis, 'fetch', async () => Response.json({ format: 'geojson',
      sourceSha256: sha256(bytes), featureCount: 1, sourceCrs: 'EPSG:4326', crsUnit: 'degree',
      crsEvidence: 'test_only processor evidence', geometryTypes: [geometry], fields: [], layer: null }));
    const statements: string[] = [];
    const client = { query: async (sql: string) => {
      statements.push(sql);
      return { rows: [] };
    } };
    assert.equal(await prepareRetainedGeojsonTx(client as unknown as PoolClient, source), true);
    const card = await probe(bytes, source.name);
    card.crs.state = 'stated';
    const { schemaFingerprint: _hash, ...profile } = source.inspection!.manualProfile;
    SourceProfileSchema.omit({ source: true, caseId: true, workspaceRevision: true,
      workspaceFingerprint: true }).parse(profile);
    assert.equal(intakeReaderRoute(card, source), 'bounded_geojson');
    assert.equal(intakeDraftLimit({ card } as never, source), null);
    assert(isRetainedMapOriginal(source));
    assert.equal(intakeNameWords(card, source.name), 'Named .txt, read as GeoJSON.');
    assert.equal(statements.length, 1);
    assert.equal(source.profile, 'large-original-v1', 'original authority and source pin stay unchanged');
    assert.equal(await prepareRetainedGeojsonTx(client as unknown as PoolClient, source), true);
    assert.equal(statements.length, 1, 'a repeated probe reuses the bounded profile');
  });
}

test('table selections are advisory: CSV as XLSX and PDF as CSV are refused before any table parser', async () => {
  const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] };
  await assert.rejects(assertTableByteKind(pdf, selection), { code: 'TABLE_BYTE_KIND' });
  await assert.rejects(assertTableByteKind(Buffer.from('Key,Value\nA,B\n'),
    { ...selection, format: 'xlsx', sheet: 'test_only' }), { code: 'TABLE_BYTE_KIND' });
  await assertTableByteKind(Buffer.from('Key,Value\nA,B\n'), selection);
});

test('a CSV selection reads tab-delimited and one-column text, never workbook or PDF bytes', async () => {
  const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] };
  // Generated test_only header and value; not a building record.
  for (const text of ['BIN\tName\n1001\tA\n', 'BIN\n1001\n']) {
    const bytes = Buffer.from(text);
    await assertTableByteKind(bytes, selection);
    assert.equal(inspectTabularSource(bytes, selection).records, 1);
  }
  const workbook = readFileSync(root + 'datasets/messy-india/rbi-development-table-18/original.xlsx');
  await assert.rejects(assertTableByteKind(workbook, selection), { code: 'TABLE_BYTE_KIND' });
  await assert.rejects(assertTableByteKind(pdf, selection), { code: 'TABLE_BYTE_KIND' });
});

/** Only the existing retain protocol: committed source rows survive later reader failures. No PostgreSQL needed. */
class RetainStore {
  revision = 0;
  sources: Record<string, any>[] = [];
  operations = new Map<string, { payload_hash: string; result: unknown }>();
  statements: string[] = [];
  query = async (text: string, args: any[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    this.statements.push(sql);
    const rows = this.answer(sql, args);
    return { rows, rowCount: rows.length };
  };
  private answer(sql: string, args: any[]): any[] {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return [];
    if (sql.startsWith('SELECT id,revision FROM cases') || sql.startsWith('SELECT revision FROM cases'))
      return [{ id: caseId, revision: this.revision }];
    if (sql.includes('FROM registry_case_feature_mappings') || sql.includes('FROM import_packages')) return [];
    if (sql.startsWith('SELECT payload_hash,result FROM operations')) {
      const prior = this.operations.get(args[1]);
      return prior ? [prior] : [];
    }
    if (sql.startsWith('INSERT INTO operations')) {
      this.operations.set(args[1], { payload_hash: args[2], result: args[3] });
      return [];
    }
    if (sql.startsWith('SELECT id,family_id,revision,sha256 FROM sources')) return this.sources;
    if (sql.startsWith('SELECT id FROM sources WHERE case_id=')
      || sql.startsWith('SELECT * FROM sources WHERE case_id='))
      return this.sources.filter(row => row.inspection.manualProfile);
    if (sql.startsWith('SELECT * FROM sources WHERE id=')) return this.sources.filter(row => row.id === args[0]);
    if (sql.includes('max(revision)')) return [{ revision: 1 }];
    if (sql.startsWith('SELECT id,revision FROM sources WHERE case_id=')) return this.sources;
    if (sql.startsWith('SELECT id FROM sources WHERE id=')) return this.sources.filter(row => row.id === args[0]);
    const written = this.write(sql, args);
    if (written) return written;
    throw new Error(`Unexpected retain SQL: ${sql}`);
  }
  private write(sql: string, args: any[]): any[] | null {
    if (sql.startsWith('INSERT INTO sources')) {
      const keys = ['id', 'case_id', 'family_id', 'revision', 'name', 'profile', 'mime_type', 'bytes',
        'sha256', 'object_key', 'inspection'];
      this.sources.push(Object.fromEntries(keys.map((key, index) => [key, args[index]])));
      return [];
    }
    if (sql.startsWith('UPDATE cases SET revision=revision+1')) {
      this.revision++;
      return [];
    }
    if (sql.startsWith('UPDATE sources SET mime_type=')) {
      const source = this.sources.find(row => row.id === args[0])!;
      source.mime_type = args[1];
      source.inspection = { ...source.inspection, ...JSON.parse(args[2]) };
      return [];
    }
    if (sql.startsWith('INSERT INTO usp_outbox')) return [];
    if (sql.startsWith('UPDATE usp_outbox_streams')) return [{ sequence: '1' }];
    return null;
  }
  install() {
    globals.ulpinPool = { query: this.query,
      connect: async () => ({ query: this.query, release() {} }) } as never;
  }
}

test('the table dialog keeps wrong-kind bytes first, including on replay, without a table receipt or deletion',
  async () => {
    const io = storage(pdf), store = new RetainStore();
    store.install();
    const request = { requestKey: crypto.randomUUID(), expectedWorkspaceRevision: 0, format: 'csv',
      selection: { format: 'csv', sheet: 'csv', table: null, headerRows: [1] } };
    const read = () => new ManualIngestionService().retain(caseId, request, { name: 'misnamed.csv', bytes: pdf });
    await assert.rejects(read(), { code: 'TABLE_BYTE_KIND' });
    await assert.rejects(read(), { code: 'TABLE_BYTE_KIND' });
    assert.equal(store.sources.length, 1);
    assert.equal(store.revision, 1);
    assert.equal(store.sources[0].inspection.manualProfile, undefined);
    assert.equal(io.objects.size, 1);
    assert.equal(sha256([...io.objects.values()][0]), sha256(pdf));
    assert.equal(io.calls.filter(call => call === 'PutObjectCommand').length, 1);
    const inserted = store.statements.findIndex(sql => sql.startsWith('INSERT INTO sources'));
    assert(store.statements.indexOf('COMMIT', inserted) > inserted);
  });

test('the LPC register still gets a bounded table receipt after retention, and replays without a second original',
  async () => {
    const bytes = readFileSync(root
      + 'datasets/nyc-10013-linked/nyc-landmarks-preservation-commission/gpmc-yuvp.csv');
    const io = storage(bytes), store = new RetainStore();
    store.install();
    const request = { requestKey: crypto.randomUUID(), expectedWorkspaceRevision: 0, format: 'csv',
      selection: { format: 'csv', sheet: 'csv', table: null, headerRows: [1] } };
    const read = () => new ManualIngestionService().retain(caseId, request, { name: 'register.csv', bytes });
    const profile = TabularSourceProfileSchema.parse(await read());
    assert(profile.records > 0);
    assert.equal(profile.source.sourceSha256, sha256(bytes));
    assert.deepEqual(await read(), profile);
    assert.equal(store.sources.length, 1);
    assert.equal(io.objects.size, 1);
    assert.equal(store.revision, 1);
  });

test('GeoJSON inventory runs only after the durable receipt, even for CityJSON named .json', async () => {
  const bytes = Buffer.from('{"type":"CityJSON","version":"2.0","CityObjects":{},"vertices":[]}');
  const io = storage(bytes), store = new RetainStore();
  store.install();
  await assert.rejects(new ManualIngestionService().retain(caseId,
    { requestKey: crypto.randomUUID(), expectedWorkspaceRevision: 0, format: 'geojson' },
    { name: 'city.json', bytes }), { code: 'UNSUPPORTED_PROFILE' });
  assert.equal(store.sources.length, 1);
  assert.equal(io.objects.size, 1);
  assert.equal(store.sources[0].inspection.manualProfile, undefined);
  assert.equal(sha256([...io.objects.values()][0]), sha256(bytes));
});
