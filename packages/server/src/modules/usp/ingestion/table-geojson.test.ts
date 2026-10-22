import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { localOperatorSubject } from '../principal';
import { probeOriginal } from './intake-probe';
import { streamedSourceReference } from './streamed-map-receipt';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';
import { placeTableRows, queueTableGeojsonTx, tablePlacementWords, writeTableGeojson,
  type IntakeTableGeojsonInput, type TableGeojsonDependencies, type TablePlacementPlan } from './table-geojson';
import { readTableWindows } from './tabular-stream';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'table-geojson-protocol';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const caseId = '40000000-0000-4000-8000-000000000001';
const itemId = '40000000-0000-4000-8000-000000000002';
const sourceId = '40000000-0000-4000-8000-000000000003';
const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1], delimiter: ',' as const,
  encoding: 'utf-8' as const };
type Coordinates = TablePlacementPlan['coordinates'];

// test_only tables written here; their values are coordinates typed for the test, not records of any place.
const LON_LAT = Buffer.from('ward,longitude,latitude\nWard 1,77.5946,12.9716\nWard 2,77.6100,12.9800\nWard 3,,\n'
  + 'Ward 4,77.6200,12.9900\nWard 5,77.6300,13.0000\n');
const WKT = Buffer.from('plot,outline\n'
  + 'P-1,"POLYGON ((776500.25 1434500, 776520 1434500, 776520 1434520, 776500.25 1434500))"\n'
  + 'P-2,"MULTIPOLYGON (((776600 1434600, 776610 1434600, 776610 1434610, 776600 1434600)))"\n'
  + 'P-3,near the temple\n');

function plan(bytes: Buffer, headers: string[], coordinates: Coordinates, crs = 'EPSG:4326'): TablePlacementPlan {
  return { source: { id: sourceId, revision: 1, sha256: sha(bytes), name: 'table.csv', bytes: bytes.length },
    selection, headers, coordinates, crs };
}

async function written(bytes: Buffer, table: TablePlacementPlan, read?: typeof readTableWindows) {
  const parts: string[] = [];
  const counts = await writeTableGeojson(Readable.from([bytes]), table, async text => { parts.push(text); }, read);
  return { counts, parts, geojson: Buffer.from(parts.join('')) };
}

/** What the large GeoJSON path reads from the derivative: its card, accepted features and declared system. */
async function largePath(geojson: Buffer, name: string) {
  const card = await probeOriginal(async (start, end) => geojson.subarray(start, end), geojson.length, name);
  let accepted = 0;
  const closure = await readStreamingFeatures(Readable.from([geojson]), 'feature-collection', async item => {
    accepted += Number(sourceRecord(item).disposition === 'accepted');
  });
  return { card, accepted, features: closure.features, reference: streamedSourceReference(closure.metadata) };
}

test('a longitude/latitude CSV of 5 rows, one blank: 4 points with row locators and 1 skipped', async () => {
  const table = plan(LON_LAT, ['ward', 'longitude', 'latitude'], { kind: 'columns', x: 1, y: 2 });
  const { counts, geojson } = await written(LON_LAT, table);
  assert.deepEqual(counts, { rows: 5, features: 4, skipped: { no_coordinates: 1 } });
  const features = JSON.parse(geojson.toString()).features;
  assert.deepEqual(features.map((feature: any) => feature.geometry.type), ['Point', 'Point', 'Point', 'Point']);
  assert.deepEqual(features.map((feature: any) => feature.tableRow),
    [2, 3, 5, 6].map(row => ({ sourceId, sourceRevision: 1, sha256: sha(LON_LAT), row })));
  assert.deepEqual(features[1].properties, { ward: 'Ward 2', longitude: '77.6100', latitude: '12.9800' });
  // The numbers are the cells' own text; nothing is rounded, moved or placed at 0,0.
  assert.ok(geojson.includes('"coordinates":[77.6100,12.9800]'));
  assert.equal(tablePlacementWords(counts, { name: 'wards.geojson', crs: 'EPSG:4326' }), 'Placed 4 rows on the map; '
    + '1 row skipped: 1 had no coordinates. They are taken in as their own GeoJSON file, wards.geojson, in '
    + 'EPSG:4326 as stated by the officer.');
  const read = await largePath(geojson, 'wards.geojson');
  assert.deepEqual([read.card.family, read.card.format, read.features, read.accepted], ['vector', 'geojson', 4, 4]);
  assert.deepEqual([read.reference.sourceCrs, read.reference.coordinateUnit], ['EPSG:4326', 'degree']);
});

test('a row whose coordinate cell is not a number is skipped and named so', async () => {
  const bytes = Buffer.from('id,x,y\na,77.5,12.9\nb,12.5 N,77.1\nc,,12.0\n');
  const { counts } = await written(bytes, plan(bytes, ['id', 'x', 'y'], { kind: 'columns', x: 1, y: 2 }));
  assert.equal(tablePlacementWords(counts, null), 'Placed 1 row on the map; 2 rows skipped: 1 had no coordinates, '
    + '1 had text that is not a number.');
});

test('a WKT column stated in EPSG:32643 gives polygons in that declared system, unprojected', async () => {
  const table = plan(WKT, ['plot', 'outline'], { kind: 'wkt', column: 1 }, 'EPSG:32643');
  const { counts, geojson } = await written(WKT, table);
  assert.deepEqual(counts, { rows: 3, features: 2, skipped: { not_wkt: 1 } });
  const collection = JSON.parse(geojson.toString());
  assert.deepEqual(collection.crs, { type: 'name', properties: { name: 'EPSG:32643' } });
  assert.deepEqual(collection.features.map((feature: any) => feature.geometry.type), ['Polygon', 'MultiPolygon']);
  assert.deepEqual(collection.features[0].geometry.coordinates[0][0], [776500.25, 1434500]);
  assert.match(tablePlacementWords(counts, null), /1 had text that is not WKT of a point, line or polygon\.$/);
  const read = await largePath(geojson, 'plots.geojson');
  assert.deepEqual([read.accepted, read.card.crs.state], [2, 'stated']);
  assert.deepEqual([read.reference.sourceCrs, read.reference.coordinateUnit], ['EPSG:32643', 'unknown']);
});

test('a table of 25,000 rows is read and written in windows, never whole', async () => {
  const rows = 25_000;
  function* chunks() {
    yield 'id,lon,lat\n';
    for (let start = 0; start < rows; start += 1000) {
      yield Array.from({ length: 1000 }, (_, offset) => `${start + offset},77.${start + offset},12.5\n`).join('');
    }
  }
  const bytes = Buffer.from([...chunks()].join(''));
  const windows: number[] = [];
  const read: typeof readTableWindows = (body, source, onWindow) => readTableWindows(body, source,
    async (window, headers) => {
      windows.push(window.rows.length);
      await onWindow(window, headers);
    });
  const parts: number[] = [];
  const table = plan(bytes, ['id', 'lon', 'lat'], { kind: 'columns', x: 1, y: 2 });
  const counts = await writeTableGeojson(Readable.from(chunks()), table, async text => { parts.push(text.length); },
    read);
  assert.deepEqual(windows, [10_000, 10_000, 5_000]);
  // The head, one write per window, and the tail: no write holds more than one window's features.
  assert.equal(parts.length, 5);
  assert.equal(counts.features, rows);
});

/** A source row as the batch keeps a table read as a table: its receipt and the table read's profile. */
function tableSource(bytes: Buffer, headers: string[], profile = true) {
  return { id: sourceId, case_id: caseId, family_id: sourceId, revision: 1, bytes: bytes.length, sha256: sha(bytes),
    profile: 'tabular-manual-v1', object_key: `sources/${sourceId}`, name: 'plots.csv', status: 'needs_input',
    inspection: { actor: localOperatorSubject(), ...(profile ? { manualProfile: { version: 'manual-tabular/1',
      headers, tabular: { selection, sourceBytes: bytes.length, admission: { kind: 'case_original', issuer: null,
        origin: 'officer_supplied', licence: 'unconfirmed', containsPersonalData: 'unknown' } } } } : {}) } };
}

/** The statements the queue and the job issue, over in-memory rows; any other statement fails the test. */
function ledger(original: ReturnType<typeof tableSource>) {
  const sources = new Map<string, any>([[original.id, original]]);
  const jobs: any[] = [];
  const item = { item_id: itemId, case_id: caseId, source_id: original.id, parent_item_id: null, plan_ref: null,
    state: 'probed', placement: 'undecided', records_seen: 0, limit_reason: 'Kept as a CSV table.' };
  const answers: [string, (values: any[]) => any[]][] = [
    ['SELECT * FROM usp_intake_items', () => [item]],
    ['SELECT 1 FROM jobs', () => jobs.filter(job => ['queued', 'running'].includes(job.status))],
    ['SELECT id,revision,archived FROM cases', () => [{ id: caseId, revision: 4, archived: false }]],
    ['SELECT revision FROM cases', () => [{ revision: 4 }]],
    ['INSERT INTO jobs', values => { jobs.push({ id: values[0], case_id: values[1], source_id: values[2],
      operation: 'intake-table-geojson', case_revision: values[3], input_fingerprint: values[4], payload: values[5],
      status: 'queued' }); return []; }],
    ['SELECT * FROM jobs', values => jobs.filter(job => job.id === values[0])],
    ['SELECT * FROM usp_job_metadata', () => []], ['INSERT INTO usp_job_metadata', () => []],
    ['SELECT * FROM sources', values => [sources.get(values[1])]],
    ['SELECT id FROM sources', values => [...sources.values()].filter(row => row.sha256 === values[1]
      && row.inspection.tableDerivative?.originalSha256 === values[2])],
    ['UPDATE sources', values => { sources.get(values[0]).inspection.tableDerivative = values[1]; return []; }],
    ['SELECT state,placement,plan_ref', () => [item]],
    ['UPDATE usp_intake_items SET state=', values => { Object.assign(item, { state: values[2], placement: values[3],
      plan_ref: values[4], records_seen: values[5], limit_reason: values[6] }); return []; }],
    ['SELECT item_id AS', () => [{ itemId, state: item.state, family: 'table', format: 'csv', sizeClass: 'S', wave: 3,
      pinnedByOfficer: false }]],
    ['UPDATE usp_outbox_streams', () => [{ sequence: '1' }]], ['INSERT INTO usp_outbox', () => []],
  ];
  const statements: string[] = [];
  const client = { query: async (sql: string, values: any[] = []) => {
    statements.push(sql);
    const answer = answers.find(([start]) => sql.startsWith(start));
    if (!answer) throw new Error(`Unexpected SQL: ${sql}`);
    const rows = answer[1](values);
    return { rows, rowCount: rows.length };
  } } as unknown as PoolClient;
  return { client, sources, item, jobs, statements };
}

test('no coordinate system stated: refused with a question, nothing queued and none assumed', async () => {
  const { client, statements } = ledger(tableSource(WKT, ['plot', 'outline']));
  await assert.rejects(queueTableGeojsonTx(client, tableSource(WKT, ['plot', 'outline']), { requestKey: randomUUID(),
    coordinates: { kind: 'wkt', column: 1 }, crs: null }), (error: any) => error.code === 'TABLE_PLACEMENT_CRS_UNSTATED'
    && error.status === 422 && /^Which coordinate system are these coordinates in\?/.test(error.message));
  assert.deepEqual(statements, []);
});

test('a stated system queues one job pinning the table read; a column past the table or an unread file is refused',
  async () => {
    const original = tableSource(WKT, ['plot', 'outline']);
    const { client, jobs, item } = ledger(original);
    const request = { requestKey: randomUUID(), coordinates: { kind: 'wkt' as const, column: 1 }, crs: 'EPSG:32643' };
    await assert.rejects(queueTableGeojsonTx(client, original, { ...request,
      coordinates: { kind: 'columns', x: 1, y: 2 } }), { code: 'TABLE_PLACEMENT_COLUMN' });
    await assert.rejects(queueTableGeojsonTx(client, tableSource(WKT, [], false), request),
      { code: 'TABLE_PLACEMENT_NOT_READ' });
    const jobId = await queueTableGeojsonTx(client, original, request);
    assert.deepEqual(jobs.map(job => [job.id, job.payload.crs, job.payload.headers, job.payload.tabular.selection]),
      [[jobId, 'EPSG:32643', ['plot', 'outline'], selection]]);
    assert.equal(item.limit_reason,
      'Placing the rows of this table on the map in EPSG:32643, as stated by the officer.');
    await assert.rejects(queueTableGeojsonTx(client, original, { ...request, requestKey: randomUUID() }),
      { status: 409 });
  });

/** The byte receipt /uploads drives, standing in for storage: it hashes each part and keeps the bytes it was sent. */
function receipt(sources: Map<string, any>, kept: Map<string, Buffer>) {
  let parts: Buffer[] = [];
  let file: { filename: string };
  return {
    create: async (_case: string, input: any) => {
      file = input;
      parts = [];
      return { id: randomUUID(), revision: 1, currentCaseRevision: 4 };
    },
    claimPart: async (_case: string, id: string) => ({ id }),
    receivePart: async (_claim: unknown, bytes: Uint8Array) => {
      parts.push(Buffer.from(bytes));
      return { id: 'upload', revision: 1 + parts.length, currentCaseRevision: 4 };
    },
    failPart: async () => {},
    finalize: async (_case: string, _id: string, input: { sha256: string }) => {
      const bytes = Buffer.concat(parts);
      assert.equal(sha(bytes), input.sha256);
      const id = randomUUID();
      sources.set(id, { id, sha256: input.sha256, name: file.filename, inspection: {} });
      kept.set(id, bytes);
      return { source: { sourceId: id } };
    },
    abort: async () => {},
  } as unknown as TableGeojsonDependencies['large'];
}

test('the job keeps the derivative once with its lineage, enrols it and words the item', async () => {
  const original = tableSource(WKT, ['plot', 'outline']);
  const { client, sources, item, jobs } = ledger(original);
  await queueTableGeojsonTx(client, original, { requestKey: randomUUID(), coordinates: { kind: 'wkt', column: 1 },
    crs: 'EPSG:32643' });
  const input: IntakeTableGeojsonInput = jobs[0].payload;
  const kept = new Map<string, Buffer>();
  const registered: any[] = [];
  let opened = 0;
  const dependencies: TableGeojsonDependencies = {
    transaction: (async (work: (c: PoolClient) => unknown) => work(client)) as TableGeojsonDependencies['transaction'],
    open: async () => { opened++; return Readable.from([WKT]); },
    register: async (_case, raw) => { registered.push(raw); return {}; },
    large: receipt(sources, kept),
  };
  const [child] = await placeTableRows(input, dependencies);
  assert.equal(sources.get(child).name, 'plots.geojson');
  assert.deepEqual(sources.get(child).inspection.tableDerivative, { version: 'table-derivative/1',
    conversion: 'table_rows_to_geojson@1', originalSourceId: sourceId, originalSourceRevision: 1,
    originalSha256: sha(WKT), originalItemId: itemId, format: 'csv', layer: 'csv',
    coordinates: { kind: 'wkt', column: 1 }, crs: 'EPSG:32643', crsSource: 'officer_stated', features: 2,
    notWritten: 1, skipped: { not_wkt: 1 },
    locator: 'Each feature names its table row in its tableRow member: sourceId, sourceRevision, sha256, row.' });
  assert.deepEqual(registered.map(entry => entry.sourceId), [child]);
  assert.equal(JSON.parse(kept.get(child)!.toString()).features.length, 2);
  assert.deepEqual([item.state, item.records_seen], ['read', 3]);
  assert.equal(item.limit_reason, 'Placed 2 rows on the map; 1 row skipped: 1 had text that is not WKT of a point, '
    + 'line or polygon. They are taken in as their own GeoJSON file, plots.geojson, in EPSG:32643 as stated by '
    + 'the officer.');
  // The table is read twice, to measure and to keep; a rerun finds the kept child by its lineage and hash.
  assert.equal(opened, 2);
  assert.deepEqual(await placeTableRows(input, dependencies), [child]);
  assert.equal(kept.size, 1);
});
