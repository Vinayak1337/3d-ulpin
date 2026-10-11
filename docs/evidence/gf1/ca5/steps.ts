import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import type { ImportPackage, PhysicalFeature } from '@ulpin/contracts';
import { closePool, migrate, pool, query } from '../../../../packages/server/src/infrastructure/db';
import { settings } from '../../../../packages/server/src/infrastructure/config';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { closeStorageClient } from '../../../../packages/server/src/infrastructure/storage';
import { ingestArea, reviewPackage, commitPackage, createPackageCorrection, getPackage }
  from '../../../../packages/server/src/modules/areas/areas';
import { checkAssociations } from '../../../../packages/server/src/modules/officer/officer';

const folder = 'E:/BhuAayam-data/datasets/nyc-10013/files/';
const buildingsPath = `${folder}buildings-original.geojson`;
const buildingsHash = '107561166456f2c3aa4d6c6510c46e3b9a7c9eb91824762fbf7ba47b0d05ac8e';
const python = 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const profile = JSON.parse(readFileSync('scripts/demo-import/nyc-profile.json', 'utf8'));
const comparison = process.env.ULPIN_CA5_LONG_ACQUISITION === 'true';
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const round = (value: number) => Math.round(value * 1000) / 1000;
const objects = new Map<string, Buffer>();
const steps: Record<string, unknown>[] = [];
const processors: Record<string, unknown>[] = [];
const sourceHashes: Record<string, string> = {};
let server: Server | undefined;
let activeReview: ReviewTelemetry | undefined;

interface ReviewTelemetry {
  packageId: string;
  enrichmentStarted?: number;
  enrichmentEnded?: number;
  projections: number;
  check?: { featureIds: string[]; findingCount: number; findingsByCode: Record<string, number>; coverage: string[] };
  associationScopes: string[][];
  currentIds: string[];
}

function ownedBox() {
  const nonce = process.env.ULPIN_CA5_NONCE;
  assert.match(nonce ?? '', /^[a-f0-9]{16}$/);
  const container = process.env.ULPIN_CA5_CONTAINER!;
  assert.equal(container, `ulpin-ca5-tmp-${nonce}`);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'ca5_control');
  assert.equal(url.password, '');
  assert.equal(url.pathname, `/ca5_${nonce}`);
  for (const [key, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'CA5']]) {
    assert.equal(execFileSync('docker', ['inspect', '--format',
      `{{ index .Config.Labels "${key}" }}`, container], { encoding: 'utf8' }).trim(), value);
  }
}

function databaseProfile() {
  if (comparison) {
    // One bounded comparison: same eight connections/queries, longer acquisition allowance only in this box.
    const globals = globalThis as unknown as { ulpinPool?: Pool };
    globals.ulpinPool = new Pool({ connectionString: settings.databaseUrl, max: 8, connectionTimeoutMillis: 60000 });
  }
  const database = pool();
  const original = database.query.bind(database);
  database.query = (async (text: string, values: any[] = []) => {
    const telemetry = activeReview;
    if (telemetry?.check && text.startsWith('SELECT a.*') && !telemetry.enrichmentStarted) {
      telemetry.enrichmentStarted = performance.now();
    }
    if (telemetry && text.includes('FROM property_associations')) {
      telemetry.associationScopes.push(structuredClone(values[0]));
      if (telemetry.check) telemetry.enrichmentEnded = performance.now();
    }
    if (telemetry && text.startsWith('SELECT ST_AsGeoJSON(ST_Transform(ST_SetSRID(ST_Translate')) {
      telemetry.projections++;
    }
    const result = await original(text, values);
    if (telemetry && text.startsWith('SELECT body FROM physical_features WHERE area_id=')) {
      telemetry.currentIds = result.rows.map(row => row.body.id);
    }
    return result;
  }) as typeof database.query;
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
  processors.push({ operation, wallMs: round(performance.now() - started), disposition: parsed.disposition,
    featureCount: parsed.features?.length, findingCount: parsed.findings?.length });
  if (operation === 'check' && activeReview) {
    const findingsByCode: Record<string, number> = {};
    for (const finding of parsed.findings) findingsByCode[finding.code] = (findingsByCode[finding.code] ?? 0) + 1;
    activeReview.check = { featureIds: data.features.map((feature: any) => feature.id),
      findingCount: parsed.findings.length, findingsByCode, coverage: parsed.coverage };
  }
  return parsed;
}

async function requestBytes(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const value of request) chunks.push(Buffer.from(value));
  return Buffer.concat(chunks);
}

async function serve(request: IncomingMessage, response: ServerResponse) {
  const bytes = await requestBytes(request);
  const path = request.url!.split('?')[0];
  if (path.startsWith('/internal/area/')) {
    const result = processGeometry(path.split('/').at(-1)!, JSON.parse(bytes.toString()));
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
  process.env.S3_BUCKET = 'ca5-memory-originals';
  process.env.GEO_URL = endpoint;
  process.env.GEO_SERVICE_TOKEN = randomBytes(24).toString('hex');
}

async function measured(step: string, work: () => Promise<unknown>) {
  const started = performance.now();
  try {
    const observed = await work();
    const entry = { step, wallMs: round(performance.now() - started), observed };
    steps.push(entry);
    console.log(JSON.stringify({ completed: step, ...entry }));
    return observed;
  } catch (error: any) {
    steps.push({ step, wallMs: round(performance.now() - started),
      error: { code: error.code, message: error.message } });
    throw error;
  }
}

function telemetryResult(telemetry: ReviewTelemetry) {
  const end = telemetry.enrichmentEnded ?? performance.now();
  return { checkedFeatures: telemetry.check?.featureIds.length, rawFindings: telemetry.check?.findingCount,
    rawFindingsByCode: telemetry.check?.findingsByCode, projectionsDispatched: telemetry.projections,
    enrichmentWindowMs: telemetry.enrichmentStarted ? round(end - telemetry.enrichmentStarted) : null,
    enrichmentComplete: telemetry.enrichmentEnded !== undefined,
    timingMethod: 'First enrichment area-read dispatch to post-enrichment fingerprint association dispatch; '
      + 'failure stops the window at review rejection. No product function is replaced.',
    associationScopeSizes: telemetry.associationScopes.map(ids => ids.length),
    recordedContextRead: telemetry.currentIds.length };
}

async function reviewNative(pkg: ImportPackage) {
  activeReview = { packageId: pkg.id, projections: 0, associationScopes: [], currentIds: [] };
  try {
    const reviewed = await reviewPackage(pkg.id, pkg.revision);
    assert.deepEqual(await getPackage(pkg.id), reviewed, 'The review must be stored by the product.');
    const telemetry = activeReview;
    const findingsByCode: Record<string, number> = {};
    for (const finding of reviewed.review!.findings) {
      findingsByCode[finding.code] = (findingsByCode[finding.code] ?? 0) + 1;
    }
    assert(telemetry.check?.featureIds.every(id => pkg.features.some(feature => feature.id === id)));
    const output = { packageId: pkg.id, state: reviewed.state, findings: reviewed.review!.findings.length,
      findingsByCode, coverage: reviewed.review!.coverage, ...telemetryResult(telemetry) };
    return { reviewed, output, telemetry };
  } catch (error: any) {
    steps.push({ step: 'review telemetry at failure', observed: telemetryResult(activeReview) });
    throw error;
  } finally {
    activeReview = undefined;
  }
}

async function nativeImport() {
  const bytes = readFileSync(buildingsPath);
  assert.equal(bytes.length, 1103282);
  assert.equal(hash(bytes), buildingsHash);
  sourceHashes[buildingsPath] = buildingsHash;
  const pkg = await ingestArea({ bytes, filename: 'buildings-original.geojson', format: 'geojson',
    namespace: 'nyc-building-footprints', name: 'NYC native admission test_only',
    mapping: { kind: 'building', idField: 'doitt_id', identifierFields: ['bin'] }, worldStatus: 'observed' });
  assert.equal(pkg.features.length, 1661);
  assert(pkg.features.every(feature => feature.geometryRole === 'unknown'
    && feature.semantics?.evidenceState === 'unresolved' && feature.height.value === null));
  return pkg;
}

async function revisionPair(areaId: string) {
  return (await query(`SELECT a.revision area_revision,s.revision site_revision FROM map_areas a
    JOIN registry_sites s ON s.id=a.site_id WHERE a.id=$1`, [areaId])).rows[0];
}

async function verifyExteriors(pkg: ImportPackage, reservations: Map<string, any>) {
  const rows = (await query(`SELECT r.*,h.body history,h.site_revision FROM registry_records r
    JOIN registry_revisions h ON h.record_id=r.id AND h.revision=1 WHERE r.site_id=$1`, [pkg.areaId])).rows;
  assert.equal(rows.length, 1661);
  for (const row of rows) {
    const feature = pkg.features.find(feature => feature.id === row.id)!;
    assert(feature);
    assert.equal(row.revision, 1);
    assert.deepEqual(row.body, { ...reservations.get(row.id), id: row.id, siteId: row.site_id,
      identifier: row.identifier, revision: 1,
      evidence: feature.evidence.map(entry => ({
        sourceId: entry.sourceRevisionId, locator: `feature ${entry.featureId}`,
      })) });
    assert.deepEqual(row.history, row.body);
    assert.deepEqual(row.body.footprint, []);
    assert.deepEqual(row.body.rights, []);
    assert.equal(row.body.geometry, undefined);
  }
  assert.equal(new Set(rows.map(row => row.site_revision)).size, 1);
  const counts = (await query(`SELECT
    (SELECT count(*)::int FROM usp_geometry_qualifications) qualifications,
    (SELECT count(*)::int FROM usp_command_receipts WHERE operation='qualify_geometry') qualification_receipts,
    (SELECT count(*)::int FROM registry_revisions) registry_history,
    (SELECT count(*)::int FROM physical_features WHERE revision=1) physical_revision_one`)).rows[0];
  assert.equal(counts.qualifications, 0);
  assert.equal(counts.qualification_receipts, 0);
  assert.equal(counts.registry_history, 1661);
  assert.equal(counts.physical_revision_one, 1661);
  return { ...counts, exactReservationAndEvidencePreserved: true, sharedSiteRevision: rows[0].site_revision };
}

async function recordBuildings(reviewed: ImportPackage) {
  const before = await revisionPair(reviewed.areaId);
  const reservations = new Map((await query('SELECT id,body FROM registry_records WHERE site_id=$1',
    [reviewed.areaId])).rows.map(row => [row.id, row.body]));
  const started = performance.now();
  const committed = await commitPackage(reviewed.id, reviewed.revision,
    'CA5 test_only: publisher footprint observations; unknown roles/heights; '
      + 'unresolved overlaps are not legal findings.');
  const commitWallMs = round(performance.now() - started);
  const after = await revisionPair(reviewed.areaId);
  assert.equal(after.area_revision - before.area_revision, 1);
  assert.equal(after.site_revision - before.site_revision, 1);
  return { committed, output: { before, after, commitWallMs, carCommitWallMs: 7556.158,
    ...await verifyExteriors(committed, reservations) } };
}

async function hydrographyImport(areaId: string) {
  const path = `${folder}hydrography.geojson`;
  const bytes = readFileSync(path);
  const source = profile.layers.find((layer: any) => layer.name === 'hydrography.geojson');
  assert.equal(hash(bytes), source.sha256);
  sourceHashes[path] = source.sha256;
  const document = JSON.parse(bytes.toString());
  const fields = Object.keys(document.features[0].properties);
  const key = fields.find(field => /^(objectid|object_id|id)$/i.test(field));
  assert(key || document.features[0].id !== undefined);
  return ingestArea({ bytes, filename: 'hydrography.geojson', format: 'geojson', areaId,
    namespace: 'ca5-nyc-hydrography', name: 'NYC hydrography original test_only',
    mapping: { kind: 'public_land', ...(key ? { idField: key } : {}) }, worldStatus: 'observed' });
}

async function verifyHydroFingerprint(reviewed: ImportPackage, telemetry: ReviewTelemetry) {
  assert.equal(telemetry.currentIds.length, 1661);
  assert.equal(telemetry.check?.featureIds.length, reviewed.features.length);
  assert(telemetry.currentIds.every(id => !telemetry.check!.featureIds.includes(id)));
  assert(reviewed.review!.coverage.some(line => line.startsWith('1661 recorded features')));
  const current = (await query('SELECT body FROM physical_features WHERE area_id=$1 AND revision>0',
    [reviewed.areaId])).rows.map(row => row.body as PhysicalFeature);
  const features = [...current, ...reviewed.features].sort((a, b) => a.id.localeCompare(b.id));
  const area = (await query('SELECT reference,revision FROM map_areas WHERE id=$1', [reviewed.areaId])).rows[0];
  const value = { features, associations: await checkAssociations(features.map(feature => feature.id)),
    reference: area.reference, areaRevision: area.revision, packageRevision: reviewed.revision,
    validator: 'area-check-officer-v1' };
  assert.equal(hash(JSON.stringify(value)), reviewed.review!.inputFingerprint);
  assert.notEqual(hash(JSON.stringify({ ...value, features: reviewed.features })), reviewed.review!.inputFingerprint);
  return { effectiveRecordedBuildings: current.length, checkContainsRecordedBuildings: false,
    fullFingerprintVerified: true, omittedContextStillPinsCommit: true };
}

async function secondLayer(areaId: string) {
  const pkg = await hydrographyImport(areaId);
  const { reviewed, output, telemetry } = await reviewNative(pkg);
  const fingerprint = await verifyHydroFingerprint(reviewed, telemetry);
  const before = await revisionPair(areaId);
  const started = performance.now();
  const committed = await commitPackage(reviewed.id, reviewed.revision,
    'CA5 test_only: hydrography candidate only; 1661 unqualified recorded footprints were explicitly not assessed.');
  const after = await revisionPair(areaId);
  assert.equal(committed.state, 'COMMITTED');
  assert.equal(after.area_revision, before.area_revision + 1);
  assert.equal(after.site_revision, before.site_revision);
  return { ...output, ...fingerprint, committedState: committed.state, before, after,
    commitWallMs: round(performance.now() - started) };
}

async function correctionRefusal(packageId: string) {
  const correction = await createPackageCorrection(packageId, randomUUID());
  assert(correction.features.every(feature => feature.revision === 1));
  try {
    await reviewPackage(correction.id, correction.revision);
    throw new Error('A recorded unqualified correction unexpectedly passed.');
  } catch (error: any) {
    assert.equal(error.status, 422);
    assert.equal(error.code, 'USP_GEOMETRY_PAYLOAD_UNQUALIFIED');
    assert.equal(error.message, 'Spatial analysis is not assessed: changed or unqualified geometry '
      + 'requires its own canonical qualification.');
    assert.equal((await getPackage(correction.id)).review, undefined);
    return { packageId: correction.id, ownRecordedFeatures: correction.features.length,
      status: error.status, code: error.code, message: error.message, reviewWritten: false };
  }
}

async function journey() {
  let imported!: ImportPackage;
  await measured('1 ingest native original', async () => {
    imported = await nativeImport();
    return { packageId: imported.id, areaId: imported.areaId, candidates: imported.features.length,
      quarantine: imported.quarantine, noRoleMapped: true, unknownHeights: true };
  });
  let reviewed!: ImportPackage;
  await measured('1 product review', async () => {
    const result = await reviewNative(imported);
    reviewed = result.reviewed;
    return result.output;
  });
  await measured('2 product commit', async () => (await recordBuildings(reviewed)).output);
  await measured('3 second native layer over recorded buildings', () => secondLayer(imported.areaId));
  await measured('4 recorded correction refuses', () => correctionRefusal(imported.id));
  await measured('model draft prerequisite', async () => ({ runtimeAttempted: false,
    reason: 'No accepted inference receipt/pixels on this box; no model result or controls fabricated.',
    test: 'native-review.test.ts reuses the retained real K2c roofprint draft and asserts the exact refusal.' }));
}

async function finish() {
  closeStorageClient();
  if (server) {
    server.closeIdleConnections();
    await new Promise<void>(resolve => server!.close(() => resolve()));
  }
  await closePool();
  for (const [path, expected] of Object.entries(sourceHashes)) assert.equal(hash(readFileSync(path)), expected);
}

async function main() {
  ownedBox();
  let failure: unknown;
  try {
    databaseProfile();
    await measured('migrations', async () => {
      await query(sql('bootstrap.postgis'));
      await migrate();
      return { bootstrap: 'bootstrap.postgis then infrastructure/db.migrate()' };
    });
    await standIns();
    await journey();
  } catch (error: any) {
    failure = { code: error.code, message: error.message, stack: error.stack };
    process.exitCode = 1;
  } finally {
    await finish();
    console.log(JSON.stringify({ task: 'CA5', comparison,
      pool: { max: 8, connectionTimeoutMillis: comparison ? 60000 : 5000 },
      sourceHashes, originalHashesUnchanged: true, steps, processors, failure,
      scaffolding: [], qualificationsProduced: false,
      network: 'Loopback SQL and byte/geo stand-ins; PROJ_NETWORK=OFF; no GPU or provider' }));
  }
}

main().catch(error => {
  console.log(JSON.stringify({ failed: true, code: error.code, message: error.message }));
  process.exitCode = 1;
});
