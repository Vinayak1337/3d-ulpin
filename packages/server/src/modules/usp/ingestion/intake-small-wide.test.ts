import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { afterEach, mock, test } from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';
import type { PoolClient } from 'pg';
import type { IntakeCard } from '@ulpin/contracts/usp';
import { settings } from '../../../infrastructure/config';
import { sha256 } from '../../../infrastructure/storage';
import type { IntakeSourceRow } from './intake-context';
import { intakeReaderRoute } from './intake-draft';
import { citeIntakeReceipt, intakeItem } from './intake-ledger';
import { inspectGeojsonExtent, INTAKE_WIDE_GEOJSON_REASON, utmForward } from './intake-package-extent';
import { probeOriginal } from './intake-probe';
import { prepareRetainedGeojsonTx } from './service';

const wide = readFileSync(new URL('./fixtures/sw1-small-wide.geojson', import.meta.url));
const sourceId = '20000000-0000-4000-8000-000000000002';
const subject = 'small-wide-test';

function collection(coordinates: number[][], crs?: string): Buffer {
  return Buffer.from(JSON.stringify({ type: 'FeatureCollection',
    ...(crs ? { crs: { type: 'name', properties: { name: crs } } } : {}),
    features: coordinates.map(position => ({ type: 'Feature', properties: {},
      geometry: { type: 'Point', coordinates: position } })),
  }));
}

function source(bytes: Uint8Array): IntakeSourceRow {
  return { id: sourceId, case_id: sourceId, family_id: sourceId, revision: 1, name: 'test_only.geojson',
    bytes: bytes.length, sha256: sha256(bytes), profile: 'large-original-v1', object_key: 'test_only',
    status: 'needs_input', inspection: { largeOriginal: { operatorSubject: subject,
      verifiedBytes: bytes.length, verifiedSha256: sha256(bytes) } } };
}

async function card(bytes: Uint8Array): Promise<IntakeCard> {
  return probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, 'test_only.geojson');
}

function storedMeasurement(bytes: Uint8Array): IntakeSourceRow {
  const row = source(bytes);
  row.inspection!.intakeExtent = inspectGeojsonExtent(bytes);
  return row;
}

afterEach(() => mock.restoreAll());

test('a small wide GeoJSON takes streaming from its measured inspection before any draft', async () => {
  assert(wide.length < 16 * 1024 ** 2);
  const measured = inspectGeojsonExtent(wide)!;
  assert.equal(measured.fitsOneArea, false);
  assert.deepEqual(measured.bounds, [-74, 40.7, -71.799, 40.701]);
  assert.equal(intakeReaderRoute(await card(wide), storedMeasurement(wide)), 'streamed_geojson');
});

test('a compact small GeoJSON keeps the bounded path', async () => {
  const compact = collection([[-74, 40.7], [-73.999, 40.701]]);
  assert.equal(inspectGeojsonExtent(compact)?.fitsOneArea, true);
  assert.equal(intakeReaderRoute(await card(compact), storedMeasurement(compact)), 'bounded_geojson');
});

const nycPath = 'E:/BhuAayam-data/task-data/nyc-zcta-10013/buildings-original.geojson';

test('the public NYC footprint original remains compact and bounded (foreign test_only)',
  { skip: !existsSync(nycPath) }, async () => {
    const bytes = readFileSync(nycPath);
    const measured = inspectGeojsonExtent(bytes)!;
    assert.equal(measured.fitsOneArea, true);
    const probed = await card(bytes);
    // Its complete count comes from the retained inspection, not the 64 KiB head.
    const row = storedMeasurement(bytes);
    row.inspection!.manualProfile = { featureCount: JSON.parse(bytes.toString('utf8')).features.length };
    assert.equal(intakeReaderRoute(probed, row), 'bounded_geojson');
  });

test('a declared unmeasurable system keeps the existing bounded route, never guessed from ranges', async () => {
  const bytes = collection([[100, 200], [200000, 200]], 'EPSG:7755');
  assert.equal(inspectGeojsonExtent(bytes), null);
  assert.equal(intakeReaderRoute(await card(bytes), storedMeasurement(bytes)), 'bounded_geojson');
});

test('projected extents use the same measure as cuts, including the 50 km rule below one degree', async () => {
  for (const distance of [49000, 51000]) {
    const start = utmForward(32618, -74, 40.7);
    const bytes = collection([start, [start[0] + distance, start[1]]], 'EPSG:32618');
    assert.equal(inspectGeojsonExtent(bytes)?.fitsOneArea, distance < 50000);
    assert.equal(intakeReaderRoute(await card(bytes), storedMeasurement(bytes)),
      distance < 50000 ? 'bounded_geojson' : 'streamed_geojson');
  }
});

test('derivatives still take streaming even when compact or unmeasurable', async () => {
  for (const key of ['nativeDerivative', 'tableDerivative']) {
    const bytes = collection([[1, 2]], 'EPSG:7755');
    const row = storedMeasurement(bytes);
    row.inspection![key] = {};
    assert.equal(intakeReaderRoute(await card(bytes), row), 'streamed_geojson');
  }
});

test('the existing bounded adapter measures wide bytes without a processor or a second original', async () => {
  const row = source(wide);
  const statements: string[] = [];
  mock.method(S3Client.prototype, 'send', async (command: { constructor: { name: string } }) => {
    assert.equal(command.constructor.name, 'GetObjectCommand');
    return { Body: Object.assign(Readable.from([wide]), { transformToByteArray: async () => wide }),
      ContentLength: wide.length, ETag: 'test-only' };
  });
  for (const name of ['s3Endpoint', 's3Region', 's3Bucket', 's3AccessKey', 's3SecretKey'] as const) {
    mock.getter(settings, name, () => 'test-only');
  }
  mock.method(globalThis, 'fetch', async () => {
    assert.fail('A wide file must not need the bounded processor before choosing streaming.');
  });
  const client = { query: async (sql: string) => {
    statements.push(sql);
    return { rows: [] };
  } } as unknown as PoolClient;
  assert.equal(await prepareRetainedGeojsonTx(client, row), false);
  assert.equal(row.inspection!.intakeExtent.fitsOneArea, false);
  assert.equal(row.inspection!.manualProfile, undefined);
  assert.equal(intakeReaderRoute(await card(wide), row), 'streamed_geojson');
  assert.equal(statements.length, 1);
  assert.match(statements[0], /^UPDATE sources SET inspection=/);
  assert.equal(row.sha256, sha256(wide));
  assert.equal(row.profile, 'large-original-v1');
});

test('the item keeps its wide-file explanation beside later reading and officer-layout words', async () => {
  const measured = citeIntakeReceipt(await card(wide), storedMeasurement(wide));
  assert(measured.limits.includes(INTAKE_WIDE_GEOJSON_REASON));
  const projected = intakeItem({ item_id: sourceId, source_id: sourceId, case_id: sourceId,
    parent_item_id: null, member_path: null, name: 'test_only.geojson', family: 'vector', format: 'geojson',
    size_bytes: wide.length, size_class: 'S', wave: 1, state: 'reading', placement: 'undecided', card: measured,
    card_sha256: 'a'.repeat(64), probe_version: measured.version, plan_ref: null, parts_planned: null,
    parts_done: 0, records_seen: 0, limit_reason: 'An officer states the layout.', pinned_by_officer: false,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' });
  assert.match(projected.limitReason!, /read in parts because its features spread wider than one map area/);
  assert.match(projected.limitReason!, /Every feature stays a candidate/);
  assert.match(projected.limitReason!, /An officer states the layout/);
});
