import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import { closePool, migrate, pool, query, transaction } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { closeStorageClient } from '../../../../packages/server/src/infrastructure/storage';
import { ingestArea, commitPackage, reviewPackage, getPackage, getArea, createPackageCorrection,
  areaGeo } from '../../../../packages/server/src/modules/areas/areas';
import { checkAssociations, enrichFindings } from '../../../../packages/server/src/modules/officer/officer';
import { exteriorOnlySql } from '../../../../packages/server/src/modules/registry/exterior-only';
import { captureRegistrySnapshot } from '../../../../packages/server/src/modules/usp/snapshots';
import { localRequestContext } from '../../../../packages/server/src/modules/usp/principal';

const python = 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const folder = 'E:/BhuAayam-data/datasets/nyc-10013/files/';
const originalPath = `${folder}buildings-original.geojson`;
const expectedHash = '107561166456f2c3aa4d6c6510c46e3b9a7c9eb91824762fbf7ba47b0d05ac8e';
const profile = JSON.parse(readFileSync('scripts/demo-import/nyc-profile.json', 'utf8'));
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const round = (value: number) => Math.round(value * 1000) / 1000;
const context = () => localRequestContext(randomUUID());
const statements = new Map<string, { text: string; values: any[]; wallMs: number }>();
const steps: any[] = [];
const reviews: any[] = [];
const rejectedSql: any[] = [];
const objects = new Map<string, Buffer>();
const processors: any[] = [];
let server: Server | undefined;

function assertOwned() {
  const nonce = process.env.ULPIN_CAR_NONCE;
  assert.match(nonce ?? '', /^[a-f0-9]{16}$/);
  const container = process.env.ULPIN_CAR_CONTAINER!;
  assert.equal(container, `ulpin-car-tmp-${nonce}`);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'car_control');
  assert.equal(url.password, '');
  assert.equal(url.pathname, `/car_${nonce}`);
  for (const [key, expected] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'CAR']]) {
    assert.equal(execFileSync('docker', ['inspect', '--format',
      `{{ index .Config.Labels "${key}" }}`, container], { encoding: 'utf8' }).trim(), expected);
  }
}

function subject(text: string) {
  if (text.includes('WITH RECURSIVE closure(id)')) return 'targetRecordRows';
  if (text.startsWith('SELECT f.id,f.area_id') && text.includes('f.record_id=ANY')) return 'targetRows.features';
  if (text.includes("body->'documentPins' AS document_pins")) return 'featureDocumentIds';
  if (text.includes(') latest WHERE EXISTS')) return 'scopedDeclarations';
  if (text.includes('FROM physical_features p JOIN registry_records r')) return 'exterior.candidates';
  if (text.startsWith('SELECT s.id,s.revision FROM registry_sites')) return 'exterior.siteLock';
  if (text.startsWith('SELECT id,site_id,kind,identifier,revision,body FROM registry_records')) {
    return 'exterior.recordLock';
  }
  return null;
}

function traceSql() {
  pool().on('connect', client => {
    const original = client.query.bind(client);
    client.query = ((...args: any[]) => {
      // pg.Pool.query uses a callback; do not strand the pool by converting that overload to a promise.
      if (typeof args.at(-1) === 'function') return (original as any)(...args);
      const [text, values = []] = args;
      return (async () => {
      const started = performance.now();
      try {
        const result = await original(text, values);
        const name = subject(text);
        if (name && !statements.has(name)) statements.set(name,
          { text, values: structuredClone(values), wallMs: round(performance.now() - started) });
        return result;
      } catch (error: any) {
        if (/^[0-9A-Z]{5}$/.test(error.code ?? '')) rejectedSql.push({ subject: subject(text), text,
          server: { code: error.code, message: error.message, detail: error.detail, position: error.position } });
        throw error;
      }
      })();
    }) as typeof client.query;
  });
}

function processGeometry(operation: string, data: any) {
  assert(['normalize', 'check'].includes(operation));
  const code = 'import sys,json;sys.path.insert(0,"services/geo");'
    + 'from geo.area import normalize_area,check_area;'
    + `print(json.dumps(${operation === 'normalize' ? 'normalize_area' : 'check_area'}(json.load(sys.stdin))))`;
  const started = performance.now();
  const result = spawnSync(python, ['-B', '-c', code], { input: JSON.stringify(data), encoding: 'utf8',
    timeout: 60000, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' } });
  if (result.status !== 0) throw new Error(`Product Python ${operation} refused: ${result.stderr.trim()}`);
  const parsed = JSON.parse(result.stdout);
  processors.push({ operation, wallMs: round(performance.now() - started),
    disposition: parsed.disposition, featureCount: parsed.features?.length, findingCount: parsed.findings?.length });
  return parsed;
}

async function serve(request: IncomingMessage, response: ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const value of request) chunks.push(Buffer.from(value));
  const bytes = Buffer.concat(chunks);
  const path = request.url!.split('?')[0];
  if (path.startsWith('/internal/area/')) {
    const operation = path.split('/').at(-1)!;
    const result = processGeometry(operation, JSON.parse(bytes.toString()));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(result));
    return;
  }
  if (request.method === 'PUT') {
    assert(!objects.has(path), 'Original byte map is immutable.');
    objects.set(path, bytes);
    response.writeHead(200, { ETag: `"${hash(bytes)}"` });
    response.end();
  } else if (request.method === 'GET' && objects.has(path)) {
    const object = objects.get(path)!;
    response.writeHead(200, { 'Content-Length': object.length, 'Content-Type': 'application/octet-stream' });
    response.end(object);
  } else if (request.method === 'HEAD' && objects.has(path)) {
    response.writeHead(200, { 'Content-Length': objects.get(path)!.length });
    response.end();
  } else if (request.method === 'DELETE') {
    objects.delete(path);
    response.writeHead(204);
    response.end();
  } else {
    response.writeHead(404);
    response.end();
  }
}

async function standIns() {
  server = createServer((request, response) => {
    serve(request, response).catch(error => {
      response.writeHead(422, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ detail: error.message }));
    });
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}`;
  process.env.S3_ENDPOINT = endpoint;
  process.env.S3_ACCESS_KEY = randomBytes(12).toString('hex');
  process.env.S3_SECRET_KEY = randomBytes(24).toString('hex');
  process.env.S3_BUCKET = 'car-memory-originals';
  process.env.GEO_URL = endpoint;
  process.env.GEO_SERVICE_TOKEN = randomBytes(24).toString('hex');
}

async function measured(step: string, expected: string, work: () => Promise<any>) {
  const started = performance.now();
  try {
    const observed = await work();
    steps.push({ step, expected, observed, wallMs: round(performance.now() - started) });
    console.log(JSON.stringify({ completed: step, ...steps.at(-1) }));
    return observed;
  } catch (error: any) {
    steps.push({ step, expected, error: { code: error.code, message: error.message },
      wallMs: round(performance.now() - started) });
    throw error;
  }
}

async function importBuildings(bytes: Buffer, areaId?: string, namespace = 'nyc-building-footprints') {
  return ingestArea({ bytes, filename: 'buildings-original.geojson', format: 'geojson', namespace,
    name: 'NYC 10013 exterior SQL qualification (test_only)', areaId,
    mapping: { kind: 'building', idField: 'doitt_id', identifierFields: ['bin'] }, worldStatus: 'observed',
    acquisitionId: areaId ? `CAR subset/reimport of ${expectedHash}` : `CAR unchanged ${expectedHash}` });
}

async function scaffoldReview(packageId: string) {
  const pkg = await getPackage(packageId);
  try {
    const reviewed = await reviewPackage(pkg.id, pkg.revision);
    reviews.push({ packageId, scaffolding: false });
    return reviewed;
  } catch (error: any) {
    if (error.code !== 'USP_GEOMETRY_PAYLOAD_UNQUALIFIED') throw error;
    reviews.push({ packageId, scaffolding: true, prerequisite: { code: error.code, message: error.message } });
  }
  const area = await getArea(pkg.areaId);
  const replaced = new Set(pkg.features.map(feature => feature.id));
  const prior = (await query('SELECT body FROM physical_features WHERE area_id=$1 AND revision>0', [pkg.areaId]))
    .rows.map(row => row.body).filter(feature => !replaced.has(feature.id));
  // All run packages use this one area; no unrecorded foreign area geometry is silently added.
  const features = [...prior, ...pkg.features].sort((a, b) => a.id.localeCompare(b.id));
  const associations = await checkAssociations(features.map(feature => feature.id));
  const result = await areaGeo<any>('check', { features, associations, reference: area.reference });
  const findings = await scaffoldFindings(result.findings, features, area);
  pkg.revision++;
  pkg.state = 'REVIEWED';
  pkg.review = { areaRevision: area.revision, packageRevision: pkg.revision,
    inputFingerprint: hash(JSON.stringify({ features, associations, reference: area.reference,
      areaRevision: area.revision, packageRevision: pkg.revision, validator: 'area-check-officer-v1' })),
    findings, coverage: result.coverage };
  await transaction(async client => {
    await client.query('UPDATE import_packages SET revision=$2,state=$3,body=$4 WHERE id=$1',
      [pkg.id, pkg.revision, pkg.state, pkg]);
    await client.query('INSERT INTO import_package_revisions(package_id,revision,body) VALUES($1,$2,$3)',
      [pkg.id, pkg.revision, pkg]);
  });
  return pkg;
}

async function scaffoldFindings(findings: any[], features: any[], area: any) {
  // Same product projection with the already-read reference. Re-reading all area statistics per finding
  // exhausted the acquisition deadline concurrently, then exceeded 600 seconds serially after commit.
  const source = readFileSync('packages/server/src/modules/officer/officer.ts', 'utf8');
  const match = /"(SELECT ST_AsGeoJSON\(ST_Transform\(ST_SetSRID\(ST_Translate[^"\n]+)"/.exec(source);
  assert(match);
  const output = [];
  for (const finding of findings) {
    const [enriched] = await enrichFindings([{ ...finding, geometry: undefined }], features, area.id);
    const geographicGeometry = finding.geometry ? JSON.parse((await query(match[1],
      [JSON.stringify(finding.geometry), ...area.reference.origin,
        Number(area.reference.analysisCrs.split(':')[1])])).rows[0].value) : undefined;
    output.push({ ...enriched, geometry: finding.geometry, geographicGeometry });
  }
  return output;
}

async function revisions(areaId: string) {
  return (await query(`SELECT a.revision area_revision,s.revision site_revision,a.site_id
    FROM map_areas a JOIN registry_sites s ON s.id=a.site_id WHERE a.id=$1`, [areaId])).rows[0];
}

async function commitReviewed(packageId: string) {
  const reviewed = await scaffoldReview(packageId);
  const reservations = new Map((await query('SELECT id,body FROM registry_records WHERE site_id=$1',
    [reviewed.areaId])).rows.map(row => [row.id, row.body]));
  const before = await revisions(reviewed.areaId);
  const started = performance.now();
  const committed = await commitPackage(reviewed.id, reviewed.revision,
    'CAR throwaway qualification only: native exterior observations, unknown heights, no rights.');
  return { committed, reservations, before, after: await revisions(committed.areaId),
    transactionWallMs: round(performance.now() - started) };
}

async function verifyCommit(pkg: any, reservations: Map<string, any>) {
  const rows = (await query(`SELECT r.*,v.site_revision,v.body history FROM registry_records r
    JOIN registry_revisions v ON v.record_id=r.id AND v.revision=1
    WHERE r.site_id=$1 AND r.id=ANY($2::uuid[])`, [pkg.areaId, pkg.features.map((feature: any) => feature.id)])).rows;
  const eligible = pkg.features.filter((feature: any) => feature.kind === 'building'
    && feature.worldStatus === 'observed' && feature.representation === 'physical_exterior');
  assert.equal(rows.length, eligible.length);
  for (const row of rows) {
    const feature = eligible.find((item: any) => item.id === row.id);
    assert(feature);
    assert.equal(row.revision, 1);
    assert.equal(row.body.representation, 'physical_exterior');
    assert.deepEqual(row.body.footprint, []);
    assert.equal(row.body.geometry, undefined);
    assert.deepEqual(row.body.rights, []);
    assert.deepEqual(row.body.evidence, feature.evidence.map((entry: any) => ({
      sourceId: entry.sourceRevisionId, locator: `feature ${entry.featureId}` })));
    assert.deepEqual(row.body, { ...reservations.get(row.id), id: row.id, siteId: row.site_id,
      identifier: row.identifier, revision: 1, evidence: row.body.evidence });
    assert.deepEqual(row.history, row.body);
  }
  const history = (await query('SELECT count(*)::int count FROM registry_revisions WHERE record_id=ANY($1::uuid[])',
    [rows.map(row => row.id)])).rows[0].count;
  assert.equal(history, rows.length);
  assert.equal(new Set(rows.map(row => row.site_revision)).size, 1);
  return { nativeBuildings: eligible.length, recordedRevisionOne: rows.length, historyRows: history,
    sharedSiteRevision: rows[0].site_revision, representationsAndEvidenceExact: true,
    otherReservationFieldsPreserved: true,
    sourceRejected: pkg.quarantine?.rejected ?? 0, rejectionReasons: pkg.quarantine?.rejections ?? [] };
}

function placementSql() {
  const source = readFileSync('packages/server/src/modules/officer/officer-preparation.ts', 'utf8');
  const match = /`(SELECT 1 FROM registry_records r WHERE site_id=\$1 AND revision>0 AND NOT [^`]+)`/.exec(source);
  assert(match);
  return match[1].replace("${exteriorOnlySql('r')}", exteriorOnlySql('r'));
}

async function placement(siteId: string, target: any, rawFeature: any) {
  const text = placementSql();
  assert.equal((await query(text, [siteId])).rows.length, 0);
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    // Three existing source points, no invented geometry; deliberately only a rolled-back guard control.
    const points = rawFeature.geometry.coordinates[0][0].slice(0, 3);
    assert.equal(points.length, 3);
    await client.query("UPDATE registry_records SET body=jsonb_set(body,'{footprint}',$2::jsonb) WHERE id=$1",
      [target.ref.id, JSON.stringify(points)]);
    assert.equal((await client.query(text, [siteId])).rows.length, 1);
    return { sql: text, exteriorOnlyRows: 0, rolledBackThreeSourcePointsRows: 1 };
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function refusal(work: () => Promise<any>, status: number, code: string) {
  try {
    await work();
    throw new Error('Expected refusal but operation succeeded.');
  } catch (error: any) {
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return { status: error.status, code: error.code };
  }
}

function members(manifest: any) {
  const counts: Record<string, number> = {};
  for (const member of manifest.members) counts[member.pin.ref.namespace] = (counts[member.pin.ref.namespace] ?? 0) + 1;
  return counts;
}

async function targetCaptures(siteId: string, target: any, records: any[]) {
  const selection = { kind: 'targets' as const, pins: [target] };
  const first = await captureRegistrySnapshot(context(), siteId, selection);
  assert.deepEqual(members(first), { area_feature: 1, registry_record: 1, registry_site: 1, source_revision: 1 });
  assert(first.members.some((member: any) => member.pin.ref.namespace === 'registry_site'
    && member.pin.revision === 0));
  assert(first.members.some((member: any) => member.pin.ref.id === target.ref.id
    && member.pin.ref.namespace === 'area_feature'));
  const feature = (await query('SELECT body FROM physical_features WHERE record_id=$1 AND revision>0',
    [target.ref.id])).rows[0].body;
  assert(first.members.some((member: any) => member.pin.ref.namespace === 'area_feature'
    && member.pin.ref.id === feature.id && member.pin.revision === feature.revision));
  assert(first.members.some((member: any) => member.pin.ref.namespace === 'source_revision'
    && member.pin.ref.id === feature.sourceRevisionId));
  const times: number[] = [];
  for (let run = 0; run < 5; run++) {
    const started = performance.now();
    const repeated = await captureRegistrySnapshot(context(), siteId, selection);
    assert.equal(repeated.digest, first.digest);
    times.push(round(performance.now() - started));
  }
  times.sort((a, b) => a - b);
  const pins = records.slice(0, 100).map(row => ({ ref: { namespace: 'registry_record', id: row.id }, revision: 1 }));
  const started = performance.now();
  const hundred = await captureRegistrySnapshot(context(), siteId, { kind: 'targets', pins });
  const hundredMs = round(performance.now() - started);
  assert.equal(members(hundred).registry_record, 100);
  const refused = await refusal(() => captureRegistrySnapshot(context(), siteId,
    { kind: 'targets', pins: [...pins, target] }), 422, 'USP_SELECTION');
  return { digest: first.digest, members: members(first), target,
    repeatFive: { times, p50Ms: times[2], maxMs: times[4] },
    hundred: { members: members(hundred), wallMs: hundredMs }, hundredOne: refused };
}

async function unrelatedFile(siteId: string) {
  const path = `${folder}hydrography.geojson`;
  const bytes = readFileSync(path);
  const source = profile.layers.find((layer: any) => layer.name === 'hydrography.geojson');
  assert.equal(hash(bytes), source.sha256);
  const document = JSON.parse(bytes.toString());
  const first = document.features[0];
  const fields = Object.keys(first.properties);
  const key = fields.find(field => /^(objectid|object_id|id)$/i.test(field));
  assert(key || first.id !== undefined, 'Need an actual source id, not a generated native key.');
  const priorCases = (await query('SELECT DISTINCT case_id FROM import_packages WHERE area_id=$1', [siteId]))
    .rows.map(row => row.case_id);
  const pkg = await ingestArea({ bytes, filename: 'hydrography.geojson', format: 'geojson',
    namespace: 'car-nyc-hydrography', name: 'NYC hydrography original (test_only)', areaId: siteId,
    mapping: { kind: 'public_land', ...(key ? { idField: key } : {}) }, worldStatus: 'observed' });
  const retained = (await query('SELECT id,case_id,sha256 FROM sources WHERE id=$1',
    [pkg.sourceRevisionIds[0]])).rows[0];
  assert.equal(pkg.areaId, siteId);
  assert(!priorCases.includes(retained.case_id));
  assert.equal(hash(readFileSync(path)), source.sha256);
  return { source: retained, packageId: pkg.id, areaId: pkg.areaId, separateCase: true,
    path, bytes: bytes.length, sha256: source.sha256,
    featureCount: pkg.features.length, originalHashUnchanged: true };
}

function costlyNodes(node: any, result: any[] = []) {
  if (['Seq Scan', 'Function Scan', 'CTE Scan', 'WorkTable Scan'].includes(node['Node Type'])) {
    result.push({ type: node['Node Type'], relation: node['Relation Name'], alias: node.Alias,
      function: node['Function Name'], rows: node['Actual Rows'], loops: node['Actual Loops'],
      rowsReadIncludingFilter: (node['Actual Rows'] + (node['Rows Removed by Filter'] ?? 0)) * node['Actual Loops'],
      totalMs: node['Actual Total Time'], sharedHitBlocks: node['Shared Hit Blocks'] });
  }
  for (const child of node.Plans ?? []) costlyNodes(child, result);
  return result;
}

async function explain(name: string, statement: { text: string; values: any[]; wallMs: number }) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.text}`, statement.values);
    const plan = result.rows[0]['QUERY PLAN'][0];
    return { name, sql: statement.text, recordedStatementWallMs: statement.wallMs,
      executionMs: plan['Execution Time'], planningMs: plan['Planning Time'],
      costlyNodes: costlyNodes(plan.Plan), plan };
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function scaleDocumentScan(bytes: Buffer, areaId: string) {
  const count = async () => (await query(`SELECT count(*)::int count FROM import_packages
    WHERE jsonb_array_length(body->'features')=1661`)).rows[0].count;
  const before = await count();
  const started = performance.now();
  const newPackages = [];
  for (let packs = before; packs < 10; packs++) {
    // Native reimports in new cases, not fabricated rows. Leave these proposals unreviewed/uncommitted.
    const pkg = await importBuildings(bytes, areaId, `car-nyc-scale-observation-${packs + 1}`);
    assert.equal(pkg.features.length, 1661);
    newPackages.push(pkg.id);
  }
  assert.equal(await count(), 10);
  const statement = statements.get('featureDocumentIds');
  assert(statement);
  return { measured: true, beforeFullPacks: before, afterFullPacks: 10, newPackages,
    acquisitionWallMs: round(performance.now() - started),
    note: 'Eight test-only observation namespaces, same real bytes; reservations stay revision 0; no review rows.',
    plan: await explain('featureDocumentIds.tenFullPacks', statement) };
}

async function plans(bytes: Buffer, areaId: string) {
  const outputs = [];
  for (const [name, statement] of statements) outputs.push(await explain(name, statement));
  assert.equal(outputs.length, 7);
  return { statements: outputs, tenFullPacks: await scaleDocumentScan(bytes, areaId) };
}

async function earlyPackages(bytes: Buffer) {
  const imported = await measured('import', 'Product ingestArea retains real file; no heights inferred', async () => {
    const pkg = await importBuildings(bytes);
    return { packageId: pkg.id, areaId: pkg.areaId, features: pkg.features.length, quarantine: pkg.quarantine,
      sourceRevisionIds: pkg.sourceRevisionIds };
  });
  const first = await measured('1 commit', 'Native exteriors recorded once; site/area each +1', async () => {
    const result = await commitReviewed(imported.packageId);
    assert.equal(result.after.site_revision - result.before.site_revision, 1);
    assert.equal(result.after.area_revision - result.before.area_revision, 1);
    return { ...await verifyCommit(result.committed, result.reservations), before: result.before, after: result.after,
      transactionWallMs: result.transactionWallMs };
  });
  await measured('1b single-package JSON scan', 'Measure featureDocumentIds with one full package', async () => {
    const row = (await query('SELECT id FROM registry_records WHERE site_id=$1 ORDER BY id LIMIT 1',
      [imported.areaId])).rows[0];
    await captureRegistrySnapshot(context(), imported.areaId, { kind: 'targets', pins: [{
      ref: { namespace: 'registry_record', id: row.id }, revision: 1,
    }] });
    const statement = statements.get('featureDocumentIds');
    assert(statement);
    return { packages: (await query('SELECT count(*)::int count FROM import_packages')).rows[0].count,
      featureCount: imported.features, plan: await explain('featureDocumentIds.oneFullPack', statement) };
  });
  await measured('2 no new buildings', 'Correction commits already-recorded buildings; site unchanged', async () => {
    const pkg = await createPackageCorrection(imported.packageId, randomUUID());
    const result = await commitReviewed(pkg.id);
    assert.equal(result.after.site_revision, result.before.site_revision);
    return { packageId: pkg.id, buildingsAlreadyRecorded: result.committed.features.length,
      siteRevision: result.after.site_revision, transactionWallMs: result.transactionWallMs };
  });
  return { imported, first };
}

async function journey(bytes: Buffer) {
  const { imported, first } = await earlyPackages(bytes);
  const records = (await query('SELECT id,revision FROM registry_records WHERE site_id=$1 ORDER BY id',
    [imported.areaId])).rows;
  const target = { ref: { namespace: 'registry_record', id: records[0].id }, revision: 1 };
  await measured('3 placement', 'No detailed row; three source points produce one row then rollback',
    () => placement(imported.areaId, target, JSON.parse(bytes.toString()).features[0]));
  await measured('4 site snapshot', '413 USP_SCOPE_LIMIT', () => refusal(() =>
    captureRegistrySnapshot(context(), imported.areaId, { kind: 'site' }), 413, 'USP_SCOPE_LIMIT'));
  const captured = await measured('5 target snapshots', 'One closure; 100 pins pass; 101 refused',
    () => targetCaptures(imported.areaId, target, records));
  await lateArrivals(imported.areaId, target, captured.digest, bytes);
  await measured('7 stale pin', '409 USP_STALE_TARGET', () => refusal(() => captureRegistrySnapshot(context(),
    imported.areaId, { kind: 'targets', pins: [{ ...target, revision: 0 }] }), 409, 'USP_STALE_TARGET'));
  await measured('8 plans', 'Seven real EXPLAIN ANALYZE plans plus ten native packs; locks rolled back',
    () => plans(bytes, imported.areaId));
  await measured('9 qualification ids', 'No fabricated qualification receipt', async () => ({ skipped: true,
    reason: 'recordGeometryQualificationTx needs an accepted qualify_geometry receipt from a qualified processor; '
      + 'no such processor/input for citation-only exterior. No receipt or geometry was invented.',
    memberId: 'Existing @ mismatch is not runtime-qualified by this run.' }));
  return { imported, first, captured };
}

async function lateArrivals(siteId: string, target: any, digest: string, bytes: Buffer) {
  await measured('6 unrelated source', 'Real second source case; D1 unchanged', async () => {
    const retained = await unrelatedFile(siteId);
    const next = await captureRegistrySnapshot(context(), siteId, { kind: 'targets', pins: [target] });
    assert.equal(next.digest, digest);
    return { ...retained, digestUnchanged: true };
  });
  await measured('6 new exterior', 'One actual source-feature subset recorded; site +1; D1 unchanged', async () => {
    const original = JSON.parse(bytes.toString());
    const subset = Buffer.from(JSON.stringify({ ...original, features: [original.features[0]] }));
    const pkg = await importBuildings(subset, siteId, 'car-nyc-native-subset-qualification');
    const result = await commitReviewed(pkg.id);
    assert.equal(result.after.site_revision - result.before.site_revision, 1);
    const next = await captureRegistrySnapshot(context(), siteId, { kind: 'targets', pins: [target] });
    assert.equal(next.digest, digest);
    return { packageId: pkg.id, ...await verifyCommit(result.committed, result.reservations),
      siteBefore: result.before.site_revision, siteAfter: result.after.site_revision, digestUnchanged: true,
      transactionWallMs: result.transactionWallMs, derivative: { originalSha256: expectedHash, originalFeatureIndex: 0,
        sha256: hash(subset), bytes: subset.length, method: 'Exact original native feature in a one-feature collection',
        note: 'Separate test-only observation namespace; not a claim of a new real building.' } };
  });
}

async function main() {
  assertOwned();
  const bytes = readFileSync(originalPath);
  assert.equal(bytes.length, 1103282);
  assert.equal(hash(bytes), expectedHash);
  let failure: any;
  try {
    traceSql();
    await measured('migrations', 'Project bootstrap and full migrations', async () => {
      await query(sql('bootstrap.postgis'));
      await migrate();
      return { runner: 'bootstrap.postgis; infrastructure/db.migrate()' };
    });
    await standIns();
    await journey(bytes);
  } catch (error: any) {
    failure = { code: error.code, message: error.message, stack: error.stack };
    process.exitCode = 1;
  } finally {
    closeStorageClient();
    if (server) {
      server.closeIdleConnections();
      await new Promise<void>(resolve => server!.close(() => resolve()));
    }
    await closePool();
    assert.equal(hash(readFileSync(originalPath)), expectedHash);
    console.log(JSON.stringify({ input: { path: originalPath, sha256: expectedHash, bytes: bytes.length,
      use: 'test_only', hashUnchanged: true }, steps, reviews, processors, rejectedSql, failure,
      scaffolded: ['import_packages revision/state/body review', 'import_package_revisions reviewed body'],
      storedObjects: objects.size,
      network: 'Only loopback PostgreSQL and local byte/geo stand-ins; PROJ_NETWORK=OFF' }));
  }
}

main().catch(error => {
  console.log(JSON.stringify({ failed: true, code: error.code, message: error.message }));
  process.exitCode = 1;
});
