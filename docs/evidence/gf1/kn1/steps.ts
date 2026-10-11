import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import type { ImportPackage, PhysicalFeature } from '../../../../packages/contracts/src';
import { AnyMappingReceiptSchema, AnySourceProfileSchema, IntakeConfirmationSchema,
  IntakeItemSchema, IntakeManifestSchema, IntakeTargetPageSchema, MappingPlanSchema, MappingReceiptSchema,
  type MappingReceipt, type SourceProfile } from '../../../../packages/contracts/src/usp';
import { z } from '../../../../apps/api/node_modules/zod/index.js';
import { importPackage, sourceCase } from '../../../../apps/api/src/modules/intake/wire-schemas';
import { closePool, migrate, pool, query, transaction } from '../../../../packages/server/src/infrastructure/db';
import { settings } from '../../../../packages/server/src/infrastructure/config';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { closeStorageClient } from '../../../../packages/server/src/infrastructure/storage';
import { fingerprint } from '../../../../packages/server/src/modules/cases/domain';
import { dispatchTick } from '../../../../packages/server/src/modules/cases/processing';
import { createIntakeTargetsTx } from '../../../../packages/server/src/modules/usp/ingestion/intake-targets';
import { intakeHttp, rejectedHttp, startHttp, stopHttp } from './http';

const folder = 'E:/BhuAayam-data/datasets/nyc-10013/files/';
const python = 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const objects = new Map<string, Buffer>();
const hashes = new Map<string, string>();
const results: Record<string, unknown> = {};
const finished = new Map<string, () => void>();
const failures: unknown[] = [];
const layers = [
  { name: 'buildings-original.geojson', kind: 'building' },
  { name: 'hydrography.geojson', kind: 'public_land' },
  { name: 'parks.geojson', kind: 'public_land' },
  { name: 'roadbed.geojson', kind: 'road' },
  { name: 'sidewalk.geojson', kind: 'road' },
];
const server = createServer((request, response) => {
  serve(request, response).catch(error => {
    response.writeHead(422, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ detail: error.message }));
  });
});

function ownedBox() {
  const nonce = process.env.ULPIN_KN1_NONCE;
  assert.match(nonce ?? '', /^[a-f0-9]{16}$/);
  const container = process.env.ULPIN_KN1_CONTAINER!;
  assert.equal(container, `ulpin-kn1-tmp-${nonce}`);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'kn1_control');
  assert.equal(url.password, '');
  assert.equal(url.pathname, `/kn1_${nonce}`);
  assert.equal(process.env.ULPIN_MODEL_GATEWAY_ENABLED, '0');
  for (const [key, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'KN1']]) {
    assert.equal(execFileSync('docker', ['inspect', '--format',
      `{{ index .Config.Labels "${key}" }}`, container], { encoding: 'utf8' }).trim(), value);
  }
}

function observeJobs() {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  globals.ulpinPool = new Pool({ connectionString: settings.databaseUrl, max: 8, connectionTimeoutMillis: 10000 });
  pool().on('connect', client => {
    const original = client.query.bind(client);
    const committing = new Set<string>();
    client.query = ((...args: any[]) => {
      if (typeof args.at(-1) === 'function') return (original as any)(...args);
      const [text, values = []] = args;
      return (original as any)(...args).then((result: unknown) => {
        if (text.startsWith('UPDATE jobs SET status=')
          && (text.includes("'succeeded'") || text.includes("'failed'"))) committing.add(String(values[0]));
        if (text === 'COMMIT') {
          for (const jobId of committing) finished.get(jobId)?.();
          committing.clear();
        }
        if (text === 'ROLLBACK') committing.clear();
        return result;
      });
    }) as typeof client.query;
  });
}

function geometry(operation: string, data: unknown) {
  assert(['normalize', 'check', 'inspect-gis'].includes(operation));
  const module = operation === 'inspect-gis' ? 'geo.gis_inspection' : 'geo.area';
  let method = 'check_area';
  if (operation === 'inspect-gis') method = 'inspect_gis';
  if (operation === 'normalize') method = 'normalize_area';
  const code = 'import sys,json;sys.path.insert(0,"services/geo");'
    + `from ${module} import ${method};print(json.dumps(${method}(json.load(sys.stdin))))`;
  const result = spawnSync(python, ['-B', '-c', code], { input: JSON.stringify(data), encoding: 'utf8',
    timeout: 60000, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' } });
  if (result.status !== 0) throw new Error(`Product Python ${operation} refused: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

function storage(request: IncomingMessage, response: ServerResponse, path: string, bytes: Buffer) {
  if (request.method === 'PUT') {
    assert(!objects.has(path), 'Original byte map is immutable.');
    objects.set(path, bytes);
    response.writeHead(200, { ETag: `"${hash(bytes)}"` });
    response.end();
  } else if (request.method === 'GET' && objects.has(path)) {
    const object = objects.get(path)!;
    const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
    const body = range ? object.subarray(Number(range[1]), Number(range[2]) + 1) : object;
    response.writeHead(range ? 206 : 200, { 'Content-Length': body.length, ETag: `"${hash(object)}"`,
      ...(range ? { 'Content-Range': `bytes ${range[1]}-${Number(range[1]) + body.length - 1}/${object.length}` }
        : {}) });
    response.end(body);
  } else if (request.method === 'HEAD' && objects.has(path)) {
    response.writeHead(200, { 'Content-Length': objects.get(path)!.length,
      ETag: `"${hash(objects.get(path)!)}"` });
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

async function serve(request: IncomingMessage, response: ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const value of request) chunks.push(Buffer.from(value));
  const bytes = Buffer.concat(chunks);
  const path = request.url!.split('?')[0];
  if (path.startsWith('/internal/area/')) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(geometry(path.split('/').at(-1)!, JSON.parse(bytes.toString()))));
  } else storage(request, response, path, bytes);
}

async function standIns() {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}`;
  process.env.S3_ENDPOINT = endpoint;
  process.env.S3_ACCESS_KEY = randomBytes(12).toString('hex');
  process.env.S3_SECRET_KEY = randomBytes(24).toString('hex');
  process.env.S3_BUCKET = 'kn1-memory-originals';
  process.env.GEO_URL = endpoint;
  process.env.GEO_SERVICE_TOKEN = randomBytes(24).toString('hex');
  const fetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.hostname, '127.0.0.1', 'Non-loopback fetch is forbidden.');
    return fetch(input, init);
  };
}

function bytes(name: string) {
  assert(layers.some(layer => layer.name === name));
  const original = readFileSync(`${folder}${name}`);
  const digest = hash(original);
  assert(!hashes.has(name) || hashes.get(name) === digest);
  hashes.set(name, digest);
  return original;
}

async function tickJob(jobId: string, allowRefusal = false) {
  let timer: ReturnType<typeof setTimeout>;
  const completion = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Dispatcher exceeded the 90-second observation bound.')), 90000);
    finished.set(jobId, resolve);
  });
  try {
    await dispatchTick();
    await completion;
    const job = (await query('SELECT operation,status,error,payload FROM jobs WHERE id=$1', [jobId])).rows[0];
    if (!allowRefusal) assert.equal(job.status, 'succeeded', JSON.stringify(job));
    return job;
  } finally {
    clearTimeout(timer!);
    finished.delete(jobId);
  }
}

async function drainJobs(allowRefusal = false) {
  const jobs = [];
  for (let index = 0; index < 30; index++) {
    const queued = (await query(`SELECT id FROM jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1`)).rows[0];
    if (!queued) return jobs;
    jobs.push(await tickJob(queued.id, allowRefusal));
  }
  throw new Error('Dispatcher exceeded the 30-job bounded walk.');
}

async function makeCase(name: string) {
  return intakeHttp('POST', '/api/v1/source-cases', '/api/v1/source-cases', sourceCase,
    { requestKey: randomUUID(), name }, 201);
}

function fileForm(name: string, content: Uint8Array, fields: Record<string, string>) {
  const form = new FormData();
  form.set('file', new File([content as BlobPart], name, { type: 'application/geo+json' }));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

async function retain(caseId: string, revision: number, name: string, content: Uint8Array) {
  const route = `/api/v1/ingestion/cases/${caseId}/sources`;
  const profile = await intakeHttp('POST', route, '/api/v1/ingestion/cases/{caseId}/sources',
    AnySourceProfileSchema, fileForm(name, content, { format: 'geojson', requestKey: randomUUID(),
      expectedWorkspaceRevision: String(revision) }), 201) as SourceProfile;
  await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/intake/items`,
    '/api/v1/ingestion/cases/{caseId}/intake/items', IntakeItemSchema,
    { requestKey: randomUUID(), sourceId: profile.source.sourceId }, 201);
  return profile;
}

async function manifest(caseId: string) {
  return intakeHttp('GET', `/api/v1/ingestion/cases/${caseId}/intake`,
    '/api/v1/ingestion/cases/{caseId}/intake', IntakeManifestSchema);
}

async function packageRead(packageId: string): Promise<ImportPackage> {
  return intakeHttp('GET', `/api/v1/import-packages/${packageId}`,
    '/api/v1/import-packages/{packageId}', importPackage) as Promise<ImportPackage>;
}

async function layout(caseId: string, retained: SourceProfile, height: Record<string, string> = {}) {
  const profile = await intakeHttp('GET',
    `/api/v1/ingestion/cases/${caseId}/sources/${retained.source.sourceId}/profile`,
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/profile', AnySourceProfileSchema) as SourceProfile;
  const plan = { version: profile.version, mode: 'manual_mapping', source: profile.source, caseId,
    workspaceRevision: profile.workspaceRevision, workspaceFingerprint: profile.workspaceFingerprint,
    ...height, operations: [
      { target: 'building.sourceKey', sourcePath: '/features/*/properties/doitt_id',
        conversionId: 'literal_identifier@1' },
      { target: 'building.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_polygon@1' },
    ] };
  const destination = { kind: 'new_area', namespace: `kn1-${profile.source.sourceId}`, name: 'KN1 test_only' };
  const authored = await intakeHttp('POST',
    `/api/v1/ingestion/cases/${caseId}/sources/${profile.source.sourceId}/recipes`,
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/recipes', AnyMappingReceiptSchema,
    { requestKey: randomUUID(), expectedRecipeRevision: 0, plan, destination }, 201) as MappingReceipt;
  const approved = await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/recipes/${authored.id}/approve`,
    '/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}/approve', AnyMappingReceiptSchema,
    { requestKey: randomUUID(), expectedRecipeRevision: authored.revision }, 200) as MappingReceipt;
  return { plan, authored, approved };
}

async function legacyBytes(caseId: string, saved: Awaited<ReturnType<typeof layout>>) {
  const history = await intakeHttp('GET', `/api/v1/ingestion/cases/${caseId}/recipes/${saved.authored.id}`,
    '/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}', z.array(AnyMappingReceiptSchema));
  const stored = history[1] as MappingReceipt;
  assert.equal(JSON.stringify(stored), JSON.stringify(MappingReceiptSchema.parse(stored)));
  assert.equal(fingerprint({ plan: MappingPlanSchema.parse(stored.plan), destination: stored.destination }),
    stored.planHash);
  assert.deepEqual(stored.plan, saved.plan);
  assert.deepEqual(stored.approval, saved.approved.approval);
  results.legacyStoredPlan = { recipeId: stored.id, planHash: stored.planHash, parsedBytesEqual: true,
    approvalUnchanged: true, historicCA0BytesAvailable: false,
    qualification: 'New persisted plan on the same CA0 doitt_id/geometry path, not recovered historical bytes.' };
}

async function dropFive() {
  const { caseId } = await makeCase('KN1 five NYC layers test_only');
  const dropped = performance.now();
  const retained: SourceProfile[] = [];
  let revision = 0;
  for (const layer of layers) {
    const profile = await retain(caseId, revision, layer.name, bytes(layer.name));
    retained.push(profile);
    revision = profile.workspaceRevision;
  }
  await drainJobs();
  const before = await manifest(caseId);
  assert.equal(before.items.length, 5);
  assert(before.items.every(item => item.placement === 'needs_answer'));
  const saved = await layout(caseId, retained[0]);
  await legacyBytes(caseId, saved);
  await drainJobs();
  const after = await manifest(caseId);
  const item = after.items.find(value => value.sourceId === retained[0].source.sourceId)!;
  const pkg = await packageRead(item.plan!.packageId!);
  assert.equal(pkg.features.length, 1661);
  assert(pkg.features.every(feature => feature.height.value === null));
  const page = await intakeHttp('GET', `/api/v1/ingestion/cases/${caseId}/targets`,
    '/api/v1/ingestion/cases/{caseId}/targets', IntakeTargetPageSchema);
  assert.equal(page.counts.ready, 1661);
  results.batch = { caseId, retained: 5, drafted: 1, prepared: 1, readyBuildingTargets: page.counts.ready,
    dropToOnePreparedMs: Math.round(performance.now() - dropped), fiveDraftsMs: null,
    height: 'unknown: the pack does not document building height unit/meaning',
    layers: layers.map((layer, index) => ({ ...layer, kindIsHarnessOfficerChoice: true,
      state: after.items.find(value => value.sourceId === retained[index].source.sourceId)!.state })) };
  await kindRefusals(caseId, retained);
  await recordBuildings(caseId, page);
  return { caseId, retained, pkg };
}

async function kindRefusals(caseId: string, profiles: SourceProfile[]) {
  const refusals = [];
  for (let index = 1; index < profiles.length; index++) {
    const profile = profiles[index];
    const kind = layers[index].kind;
    const error = await rejectedHttp(
      `/api/v1/ingestion/cases/${caseId}/sources/${profile.source.sourceId}/recipes`,
      { requestKey: randomUUID(), expectedRecipeRevision: 0, plan: {
        version: profile.version, mode: 'manual_mapping', source: profile.source, caseId,
        workspaceRevision: profile.workspaceRevision, workspaceFingerprint: profile.workspaceFingerprint,
        kind, operations: [
          { target: 'feature.sourceKey', sourcePath: '/features/*/id', conversionId: 'literal_identifier@1' },
          { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' },
        ],
      }, destination: { kind: 'new_area', namespace: 'kn1-blocked', name: 'KN1 blocked layout' } }, 422);
    refusals.push({ file: layers[index].name, kind, error });
  }
  results.kindStopRule = { stop: 'b', refusals, changedUnownedFiles: false };
}

async function recordBuildings(caseId: string, page: z.infer<typeof IntakeTargetPageSchema>) {
  const named = page.packages[0];
  const pressed = performance.now();
  const confirmation = await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/confirmations`,
    '/api/v1/ingestion/cases/{caseId}/confirmations', IntakeConfirmationSchema,
    { requestKey: randomUUID(), acknowledgement: 'KN1 test_only: physical exteriors; no rights or height claims.',
      packages: [{ packageId: named.packageId, revision: named.revision,
        reviewFingerprint: named.reviewFingerprint }],
      targets: page.items.slice(0, 3).map(target => target.targetId) });
  const commitJob = (await query(`SELECT id FROM jobs WHERE operation='intake-run'
    AND payload->>'confirmationId'=$1 AND payload->>'phase'='commit'`, [confirmation.confirmationId])).rows[0];
  assert(commitJob);
  await tickJob(commitJob.id);
  assert.equal((await packageRead(named.packageId)).state, 'COMMITTED');
  const lastRecordMs = Math.round(performance.now() - pressed);
  await drainJobs();
  const final = await intakeHttp('GET',
    `/api/v1/ingestion/cases/${caseId}/confirmations/${confirmation.confirmationId}`,
    '/api/v1/ingestion/cases/{caseId}/confirmations/{confirmationId}', IntakeConfirmationSchema);
  assert.equal(final.counts.recorded, 1661);
  assert.equal(final.counts.carded, 3);
  results.buildingConfirmation = { id: final.confirmationId, counts: final.counts,
    pressToLastRecordMs: lastRecordMs,
    pressToLastCardMs: Math.round(performance.now() - pressed), extraOfficerWrites: 0 };
}

function fixtureBytes() {
  return Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { doitt_id: 'fixture-feet', height_ft: '30' }, geometry: {
      type: 'Polygon', coordinates: [[[-74, 40], [-73.9999, 40], [-73.9999, 40.0001], [-74, 40]]],
    } },
  ] }));
}

function comparable(feature: PhysicalFeature) {
  const { evidence: _evidence, ...height } = feature.height;
  return { kind: feature.kind, sourceKey: feature.sourceKey, name: feature.name, properties: feature.properties,
    height, geometry: feature.geometry, geographicGeometry: feature.geographicGeometry,
    sourceGeometry: feature.sourceGeometry, sourceReference: feature.sourceReference,
    geometryRole: feature.geometryRole, semantics: feature.semantics, areaM2: feature.areaM2,
    worldStatus: feature.worldStatus, representation: feature.representation };
}

async function heightParity() {
  const { caseId } = await makeCase('KN1 labelled height fixture, not operational data');
  const original = fixtureBytes();
  const profile = await retain(caseId, 0, 'kn1-height-fixture.geojson', original);
  await drainJobs();
  const height = { heightField: 'height_ft', heightUnit: 'ft', heightMeaning: 'Fixture height above ground' };
  await layout(caseId, profile, height);
  await drainJobs();
  const item = (await manifest(caseId)).items[0];
  const drafted = await packageRead(item.plan!.packageId!);
  const direct = await intakeHttp('POST', '/api/v1/import-packages', '/api/v1/import-packages', importPackage,
    fileForm('kn1-height-fixture.geojson', original, { format: 'geojson', namespace: 'kn1-direct-fixture',
      name: 'KN1 labelled fixture direct', mapping: JSON.stringify({ kind: 'building', geometryRole: 'unknown',
        idField: 'doitt_id', ...height }) }), 201) as ImportPackage;
  assert.deepEqual(comparable(drafted.features[0]), comparable(direct.features[0]));
  assert.equal(drafted.features[0].height.value, 30 * 0.3048);
  assert.equal(drafted.features[0].height.state, 'source_supported');
  assert.equal(drafted.features[0].height.method, 'native_parse');
  results.heightFixture = { labelledFixture: true, equalFeaturesApartFromPathProvenance: true,
    height: comparable(drafted.features[0]).height, sourceKey: drafted.features[0].sourceKey,
    intakePackage: drafted.id, directPackage: direct.id };
}

async function anchorControl(caseId: string, profile: SourceProfile, direct: ImportPackage) {
  // Explicit setup control: kind drafting is blocked. This is not evidence of five automatic intake drafts.
  await transaction(async client => {
    await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [caseId]);
    await client.query(`UPDATE usp_intake_items SET plan_ref=$2 WHERE source_id=$1 AND case_id=$3`,
      [profile.source.sourceId, { packageId: direct.id }, caseId]);
    assert.equal(await createIntakeTargetsTx(client, caseId, profile.source.sourceId, direct,
      profile.source.sourceId), 0);
    assert.equal(await createIntakeTargetsTx(client, caseId, profile.source.sourceId, direct,
      profile.source.sourceId), 0);
  });
  const count = (await query(`SELECT count(*)::int count FROM jobs WHERE case_id=$1 AND operation='intake-run'
    AND payload->>'phase'='prepare' AND payload->>'packageId'=$2`, [caseId, direct.id])).rows[0].count;
  assert.equal(count, 1);
  await drainJobs();
}

async function zeroTargetControl(caseId: string, profile: SourceProfile, areaId: string) {
  const direct = await intakeHttp('POST', '/api/v1/import-packages', '/api/v1/import-packages', importPackage,
    fileForm('hydrography.geojson', bytes('hydrography.geojson'), { format: 'geojson', areaId,
      namespace: 'kn1-water-control', name: 'KN1 hydrography seam control test_only',
      mapping: JSON.stringify({ kind: 'public_land' }) }), 201) as ImportPackage;
  await anchorControl(caseId, profile, direct);
  const page = await intakeHttp('GET', `/api/v1/ingestion/cases/${caseId}/targets`,
    '/api/v1/ingestion/cases/{caseId}/targets', IntakeTargetPageSchema);
  const named = page.packages.find(pkg => pkg.packageId === direct.id)!;
  assert(named.reviewFingerprint);
  assert(Object.values(named.counts).every(count => count === 0));
  const { caseId: otherCase } = await makeCase('KN1 other case negative control');
  const input = { requestKey: randomUUID(), acknowledgement: 'KN1 control: context only; no building or rights.',
    packages: [{ packageId: named.packageId, revision: named.revision,
      reviewFingerprint: named.reviewFingerprint }], targets: [] };
  const denied = await rejectedHttp(`/api/v1/ingestion/cases/${otherCase}/confirmations`, input, 409);
  assert.equal(denied.code, 'INTAKE_CONFIRMATION_STALE');
  const confirmation = await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/confirmations`,
    '/api/v1/ingestion/cases/{caseId}/confirmations', IntakeConfirmationSchema, input);
  await drainJobs();
  const recorded = await packageRead(direct.id);
  assert.equal(recorded.state, 'COMMITTED');
  assert(recorded.features.every(feature => feature.revision > 0 && feature.kind === 'public_land'));
  results.zeroTargets = { setupControlOnly: true, automaticIntakeDraftQualified: false,
    packageId: direct.id, confirmationId: confirmation.confirmationId, counts: named.counts,
    prepared: true, recorded: true, otherCaseRefused: denied,
    qualification: 'Direct HTTP import; item membership and target creation installed in throwaway SQL setup.' };
}

async function main() {
  ownedBox();
  try {
    observeJobs();
    await query(sql('bootstrap.postgis'));
    await migrate();
    await query(sql('ingestion.intake.targets'));
    console.log(JSON.stringify({ completed: 'migrations' }));
    await standIns();
    await startHttp();
    const batch = await dropFive();
    await zeroTargetControl(batch.caseId, batch.retained[1], batch.pkg.areaId);
    await heightParity();
    results.scope = 'Partial KN1: kind blocked by two unowned compatibility consumers; no five-draft claim.';
  } catch (error: any) {
    failures.push({ code: error.code, message: error.message, stack: error.stack?.split('\n') });
    process.exitCode = 1;
  } finally {
    results.http = await stopHttp();
    closeStorageClient();
    server.closeIdleConnections();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await closePool();
    for (const [name, expected] of hashes) assert.equal(hash(readFileSync(`${folder}${name}`)), expected);
    console.log(JSON.stringify({ task: 'KN1', results, failures, hashes: Object.fromEntries(hashes),
      originalHashesUnchanged: true, providers: 0, gpu: false,
      network: 'Loopback SQL/storage/product Python; PROJ_NETWORK=OFF; gateway disabled' }));
  }
}

main().catch(error => {
  console.log(JSON.stringify({ failed: true, code: error.code, message: error.message }));
  process.exitCode = 1;
});
