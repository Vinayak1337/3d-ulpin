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
import { closePool, migrate, pool, query } from '../../../../packages/server/src/infrastructure/db';
import { settings } from '../../../../packages/server/src/infrastructure/config';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { closeStorageClient } from '../../../../packages/server/src/infrastructure/storage';
import { fingerprint } from '../../../../packages/server/src/modules/cases/domain';
import { dispatchTick } from '../../../../packages/server/src/modules/cases/processing';
import { intakeHttp, rejectedHttp, packageReviewOutcome, startHttp, stopHttp } from './http';

const folder = 'E:/BhuAayam-data/datasets/nyc-10013/files/';
const python = 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const objects = new Map<string, Buffer>();
const hashes = new Map<string, string>();
const results: Record<string, unknown> = {};
const finished = new Map<string, (jobId: string) => void>();
const completionTimes = new Map<string, number>();
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
  const nonce = process.env.ULPIN_KN2_NONCE;
  assert.match(nonce ?? '', /^[a-f0-9]{16}$/);
  const container = process.env.ULPIN_KN2_CONTAINER!;
  assert.equal(container, `ulpin-kn2-tmp-${nonce}`);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'kn2_control');
  assert.equal(url.password, '');
  assert.equal(url.pathname, `/kn2_${nonce}`);
  assert.equal(process.env.ULPIN_MODEL_GATEWAY_ENABLED, '0');
  for (const [key, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'KN2']]) {
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
          for (const jobId of committing) {
            completionTimes.set(jobId, performance.now());
            finished.get('*')?.(jobId);
          }
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
  process.env.S3_BUCKET = 'kn2-memory-originals';
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

async function tickJob(expectedJobId?: string, allowRefusal = false) {
  // The dispatcher owns ordering (including target priority). Observe its actual completed job.
  // Completion is committed before the worker releases its single slot; yield once for that release.
  await new Promise<void>(resolve => setImmediate(resolve));
  let timer: ReturnType<typeof setTimeout>;
  const completion = new Promise<string>((resolve, reject) => {
    timer = setTimeout(async () => {
      results.timeoutJobs = (await query('SELECT id,operation,status,error,payload FROM jobs ORDER BY created_at,id')).rows;
      reject(new Error('Dispatcher exceeded the 90-second observation bound.'));
    }, 90000);
    finished.set('*', resolve);
  });
  try {
    await dispatchTick();
    const jobId = await completion;
    if (expectedJobId) assert.equal(jobId, expectedJobId, 'A command-specific observation must name the dispatched job.');
    const job = (await query<{ id: string; operation: string; status: string; error: unknown; payload: unknown }>(
      'SELECT id,operation,status,error,payload FROM jobs WHERE id=$1', [jobId])).rows[0];
    if (!allowRefusal) assert.equal(job.status, 'succeeded', JSON.stringify(job));
    return { ...job, observedMs: performance.now() };
  } finally {
    clearTimeout(timer!);
    finished.delete('*');
  }
}

async function drainJobs() {
  const jobs = [];
  for (let index = 0; index < 30; index++) {
    const queued = (await query(`SELECT id FROM jobs WHERE status IN ('queued','running') ORDER BY created_at,id LIMIT 1`)).rows[0];
    if (!queued) return jobs;
    jobs.push(await tickJob());
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

async function layout(caseId: string, retained: SourceProfile, height: Record<string, string> = {},
  kind?: string, explicitDestination = false) {
  const profile = await intakeHttp('GET',
    `/api/v1/ingestion/cases/${caseId}/sources/${retained.source.sourceId}/profile`,
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/profile', AnySourceProfileSchema) as SourceProfile;
  const plan = { version: profile.version, mode: 'manual_mapping', source: profile.source, caseId,
    workspaceRevision: profile.workspaceRevision, workspaceFingerprint: profile.workspaceFingerprint,
    ...height, ...(kind === undefined ? {} : { kind }), operations: [
      { target: kind === undefined ? 'building.sourceKey' : 'feature.sourceKey',
        sourcePath: kind === undefined || kind === 'building' ? '/features/*/properties/doitt_id' : '/features/*/id',
        conversionId: 'literal_identifier@1' },
      { target: kind === undefined ? 'building.geometry' : 'feature.geometry', sourcePath: '/features/*/geometry',
        conversionId: kind === undefined ? 'geojson_polygon@1' : 'geojson_geometry@1' },
    ] };
  const destination = { kind: 'new_area', namespace: `kn2-${profile.source.sourceId}`, name: 'KN2 test_only' };
  const authored = await intakeHttp('POST',
    `/api/v1/ingestion/cases/${caseId}/sources/${profile.source.sourceId}/recipes`,
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/recipes', AnyMappingReceiptSchema,
    { requestKey: randomUUID(), expectedRecipeRevision: 0, plan,
      ...(explicitDestination ? { destination } : {}) }, 201) as MappingReceipt;
  if (explicitDestination) assert.deepEqual(authored.destination, destination);
  assert.equal(fingerprint({ plan: authored.plan, destination: authored.destination }), authored.planHash);
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
  const { caseId } = await makeCase('KN2 five NYC layers test_only');
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
  // The first layer places this unbound case. Every subsequent omitted destination uses its site area.
  const layouts = [await layout(caseId, retained[0], {}, layers[0].kind)];
  await drainJobs();
  for (let index = 1; index < retained.length; index++)
    layouts.push(await layout(caseId, retained[index], {}, layers[index].kind));
  await drainJobs();
  const draftedJobs = (await query("SELECT id FROM jobs WHERE case_id=$1 AND operation='intake-draft'",
    [caseId])).rows;
  const fiveDraftsMs = Math.round(Math.max(...draftedJobs.map(job => completionTimes.get(job.id)!)) - dropped);
  const after = await manifest(caseId);
  const drafted = [];
  for (const item of after.items) {
    assert(item.plan?.packageId, JSON.stringify(item));
    drafted.push(await packageRead(item.plan.packageId));
  }
  const item = after.items.find(value => value.sourceId === retained[0].source.sourceId)!;
  const pkg = drafted.find(value => value.id === item.plan!.packageId)!;
  assert.equal(new Set(drafted.map(value => value.areaId)).size, 1);
  assert.equal(pkg.features.length, 1661);
  assert(pkg.features.every(feature => feature.height.value === null));
  const page = await intakeHttp('GET', `/api/v1/ingestion/cases/${caseId}/targets`,
    '/api/v1/ingestion/cases/{caseId}/targets', IntakeTargetPageSchema);
  assert.equal(page.counts.ready, 1661);
  assert.equal(page.packages.length, 5);
  assert(page.packages.every(value => value.reviewFingerprint));
  results.batch = { caseId, retained: 5, drafted: 5, prepared: 5, readyBuildingTargets: page.counts.ready,
    oneArea: pkg.areaId, dropToFiveDraftsMs: fiveDraftsMs,
    dropToFivePreparedMs: Math.round(performance.now() - dropped),
    layouts: layouts.map(value => ({ plan: value.authored.plan, destination: value.authored.destination,
      planHash: value.authored.planHash, authoredWithoutDestination: true })),
    zeroBuildingPackages: page.packages.filter(value => value.counts.ready === 0),
    height: 'unknown: the pack does not document building height unit/meaning',
    layers: layers.map((layer, index) => ({ ...layer, kindIsHarnessOfficerChoice: true,
      state: after.items.find(value => value.sourceId === retained[index].source.sourceId)!.state })) };
  await recordAll(caseId, page);
}

async function recordAll(caseId: string, page: z.infer<typeof IntakeTargetPageSchema>) {
  const ordered = [...page.packages].sort((a, b) => b.counts.ready - a.counts.ready);
  const acknowledgement = 'KN2 test_only: physical features only; no rights or height claims.';
  const pressed = performance.now();
  const confirmation = await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/confirmations`,
    '/api/v1/ingestion/cases/{caseId}/confirmations', IntakeConfirmationSchema,
    { requestKey: randomUUID(), acknowledgement,
      packages: ordered.map(named => ({ packageId: named.packageId, revision: named.revision,
        reviewFingerprint: named.reviewFingerprint })),
      targets: page.items.slice(0, 3).map(target => target.targetId) });
  const commitJob = (await query(`SELECT id FROM jobs WHERE operation='intake-run'
    AND payload->>'confirmationId'=$1 AND payload->>'phase'='commit'`, [confirmation.confirmationId])).rows[0];
  assert(commitJob);
  const initial = await tickJob(commitJob.id, true);
  const separately = [];
  const blocked = [];
  let lastRecordAt = performance.now();
  if (initial.status !== 'succeeded') {
    assert.equal(initial.error, 'STALE_REVISION', JSON.stringify(initial));
    const stopped = [];
    for (const named of ordered) {
      const pkg = await packageRead(named.packageId);
      if (pkg.state !== 'COMMITTED') stopped.push(pkg);
    }
    assert(stopped.length > 0);
    // Jobs retain the refusal code only. One public negative command captures the normalizer's words.
    const words = await rejectedHttp(`/api/v1/import-packages/${stopped[0].id}/commit`,
      { expectedRevision: stopped[0].revision, acknowledgement }, 409);
    assert.equal(words.message, 'Area neighbours changed; review the proposed update again.');
    results.lp1 = { gap: 'LP1: preparing all five does not refresh the area-neighbour pin after a sibling commit.',
      initialCommit: initial, refusal: words, negativeControlOnly: true,
      recovery: 'Review and confirm each remaining package individually over HTTP.' };
    await drainJobs();
    for (const named of ordered) {
      const pkg = await packageRead(named.packageId);
      if (pkg.state === 'COMMITTED') continue;
      const review = await packageReviewOutcome(`/api/v1/import-packages/${pkg.id}/review`,
        { expectedRevision: pkg.revision }, importPackage);
      if (review.refusal) {
        blocked.push({ packageId: pkg.id, features: pkg.features.length, refusal: review.refusal });
        continue;
      }
      const current = await intakeHttp('GET', `/api/v1/ingestion/cases/${caseId}/targets`,
        '/api/v1/ingestion/cases/{caseId}/targets', IntakeTargetPageSchema);
      const pin = current.packages.find(value => value.packageId === pkg.id)!;
      const remaining = await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/confirmations`,
        '/api/v1/ingestion/cases/{caseId}/confirmations', IntakeConfirmationSchema,
        { requestKey: randomUUID(), acknowledgement, packages: [{ packageId: pin.packageId,
          revision: pin.revision, reviewFingerprint: pin.reviewFingerprint }], targets: [] });
      const job = (await query(`SELECT id FROM jobs WHERE operation='intake-run'
        AND payload->>'confirmationId'=$1 AND payload->>'phase'='commit'`, [remaining.confirmationId])).rows[0];
      await tickJob(job.id);
      lastRecordAt = performance.now();
      separately.push({ packageId: pkg.id, confirmationId: remaining.confirmationId });
    }
  }
  const packages = [];
  for (const named of ordered) {
    const recorded = await packageRead(named.packageId);
    if (recorded.state === 'COMMITTED') assert(recorded.features.every(feature => feature.revision > 0));
    else assert(blocked.some(value => value.packageId === recorded.id));
    packages.push({ packageId: recorded.id, state: recorded.state, features: recorded.features.length });
  }
  await drainJobs();
  const cardJobs = (await query(`SELECT id FROM jobs WHERE payload->>'confirmationId'=$1
    AND operation='intake-run' AND payload->>'phase'='target'`, [confirmation.confirmationId])).rows;
  const lastCardMs = Math.round(Math.max(...cardJobs.map(job => completionTimes.get(job.id)!)) - pressed);
  const final = await intakeHttp('GET',
    `/api/v1/ingestion/cases/${caseId}/confirmations/${confirmation.confirmationId}`,
    '/api/v1/ingestion/cases/{caseId}/confirmations/{confirmationId}', IntakeConfirmationSchema);
  assert.equal(final.counts.recorded, 1661);
  assert.equal(final.counts.carded, 3);
  results.confirmations = { id: final.confirmationId, counts: final.counts, initialCommitStatus: initial.status,
    allFiveRecorded: blocked.length === 0, packages, areaLimitRefusals: blocked,
    remainingPackagesConfirmedIndividually: separately,
    pressToLastRecordMs: blocked.length ? null : Math.round(lastRecordAt - pressed),
    pressToLastSuccessfulRecordMs: Math.round(lastRecordAt - pressed), pressToLastCardMs: lastCardMs,
    extraOfficerReviewWrites: separately.length + blocked.length, extraOfficerConfirmationWrites: separately.length };
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
  const { caseId } = await makeCase('KN2 labelled height fixture, not operational data');
  const original = fixtureBytes();
  const profile = await retain(caseId, 0, 'kn2-height-fixture.geojson', original);
  await drainJobs();
  const height = { heightField: 'height_ft', heightUnit: 'ft', heightMeaning: 'Fixture height above ground' };
  const saved = await layout(caseId, profile, height, undefined, true);
  await legacyBytes(caseId, saved);
  await drainJobs();
  const item = (await manifest(caseId)).items[0];
  const drafted = await packageRead(item.plan!.packageId!);
  const direct = await intakeHttp('POST', '/api/v1/import-packages', '/api/v1/import-packages', importPackage,
    fileForm('kn2-height-fixture.geojson', original, { format: 'geojson', namespace: 'kn2-direct-fixture',
      name: 'KN2 labelled fixture direct', mapping: JSON.stringify({ kind: 'building', geometryRole: 'unknown',
        idField: 'doitt_id', ...height }) }), 201) as ImportPackage;
  assert.deepEqual(comparable(drafted.features[0]), comparable(direct.features[0]));
  assert.equal(drafted.features[0].height.value, 30 * 0.3048);
  assert.equal(drafted.features[0].height.state, 'source_supported');
  assert.equal(drafted.features[0].height.method, 'native_parse');
  results.heightFixture = { labelledFixture: true, equalFeaturesApartFromPathProvenance: true,
    height: comparable(drafted.features[0]).height, sourceKey: drafted.features[0].sourceKey,
    intakePackage: drafted.id, directPackage: direct.id };
}


async function lineControl() {
  const { caseId } = await makeCase('KN2 labelled line fixture, not operational data');
  const original = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'fixture-road-line', properties: {}, geometry: {
      type: 'LineString', coordinates: [[-74, 40], [-73.9999, 40.0001]],
    } },
  ] }));
  const profile = await retain(caseId, 0, 'kn2-line-fixture.geojson', original);
  await drainJobs();
  const waiting = (await manifest(caseId)).items[0];
  assert.equal(waiting.placement, 'needs_answer');
  assert(waiting.limitReason?.includes('An officer states what each feature is and which field identifies it.'));
  const refused = await rejectedHttp(`/api/v1/ingestion/cases/${caseId}/sources/${profile.source.sourceId}/recipes`,
    { requestKey: randomUUID(), expectedRecipeRevision: 0, plan: { version: profile.version,
      mode: 'manual_mapping', source: profile.source, caseId, workspaceRevision: profile.workspaceRevision,
      workspaceFingerprint: profile.workspaceFingerprint, kind: 'building', operations: [
        { target: 'feature.sourceKey', sourcePath: '/features/*/id', conversionId: 'literal_identifier@1' },
        { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' },
      ] } }, 422);
  assert.equal(refused.code, 'MAPPING_GEOMETRY_KIND');
  assert(refused.message.includes('building') && refused.message.includes('LineString'));
  const saved = await layout(caseId, profile, {}, 'road');
  await drainJobs();
  const item = (await manifest(caseId)).items[0];
  const drafted = await packageRead(item.plan!.packageId!);
  assert.equal(drafted.features[0].kind, 'road');
  const sourceGeometry = drafted.features[0].sourceGeometry;
  assert(sourceGeometry && 'type' in sourceGeometry);
  assert.equal(sourceGeometry.type, 'LineString');
  assert.equal(drafted.features[0].geometryRole, 'unknown');
  results.lineFixture = { labelledFixture: true, waitingReason: waiting.limitReason, buildingLineRefused: refused,
    roadLineAuthoredApprovedAndDrafted: true, kind: saved.authored.plan.kind, packageId: drafted.id,
    geometryRole: drafted.features[0].geometryRole, destination: saved.authored.destination };
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
    await dropFive();
    await heightParity();
    await lineControl();
    const allRecorded = (results.confirmations as { allFiveRecorded: boolean }).allFiveRecorded;
    results.scope = 'Five officer-stated layouts authored without a destination; no SQL item, package or target scaffolding. '
      + (allRecorded ? 'All five packages recorded.'
        : 'Recording all five remains blocked by LP1 neighbour pins and the area-wide 2000-feature review cap.');
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
    console.log(JSON.stringify({ task: 'KN2', results, failures, hashes: Object.fromEntries(hashes),
      originalHashesUnchanged: true, providers: 0, gpu: false,
      network: 'Loopback SQL/storage/product Python; PROJ_NETWORK=OFF; gateway disabled' }));
  }
}

main().catch(error => {
  console.log(JSON.stringify({ failed: true, code: error.code, message: error.message }));
  process.exitCode = 1;
});
