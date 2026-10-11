import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { Pool } from 'pg';
import type { AreaContext, ImportPackage } from '../../../../packages/contracts/src';
import { AnyMappingReceiptSchema, AnySourceProfileSchema, IntakeConfirmationSchema, IntakeItemSchema,
  IntakeManifestSchema, IntakeTargetPageSchema, type MappingReceipt, type SourceProfile }
  from '../../../../packages/contracts/src/usp';
import { importPackage, sourceCase, areaContext } from '../../../../apps/api/src/modules/intake/wire-schemas';
import { closePool, migrate, pool, query } from '../../../../packages/server/src/infrastructure/db';
import { settings } from '../../../../packages/server/src/infrastructure/config';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { closeStorageClient, readObject } from '../../../../packages/server/src/infrastructure/storage';
import { dispatchTick } from '../../../../packages/server/src/modules/cases/processing';
import { intakeHttp, rejectedHttp, startHttp, stopHttp } from '../kn2/http';

const inputs = {
  da5: 'E:/BhuAayam-data/datasets/map-formats/niagara-falls/Niagara_Falls_Condominiums_7254610803234545967.geojson',
  nyc: 'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson',
  da4: 'E:/BhuAayam-data/datasets/nyc-second-area/nyc-office-of-technology-and-innovation/'
    + '5zhs-2jue-box-w74.003-s40.732-e73.992-n40.740.geojson',
};
const originals = Object.fromEntries(Object.entries(inputs).map(([name, path]) => [name, readFileSync(path)]));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const hashes = Object.fromEntries(Object.entries(originals).map(([name, bytes]) => [name, hash(bytes)]));
const objects = new Map<string, Buffer>();
const results: Record<string, any> = {};
const failures: unknown[] = [];
let completed: ((id: string) => void) | undefined;
const server = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const path = request.url!.split('?')[0];
    if (request.method === 'PUT') {
      assert(!objects.has(path), 'Originals are immutable.');
      const bytes = Buffer.concat(chunks);
      objects.set(path, bytes);
      response.writeHead(200, { ETag: `"${hash(bytes)}"` });
      response.end();
    } else if (['GET', 'HEAD'].includes(request.method!) && objects.has(path)) {
      const bytes = objects.get(path)!;
      const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
      const body = range ? bytes.subarray(Number(range[1]), Number(range[2]) + 1) : bytes;
      response.writeHead(range ? 206 : 200, { 'Content-Length': body.length, ETag: `"${hash(bytes)}"`,
        ...(range ? { 'Content-Range': `bytes ${range[1]}-${Number(range[1]) + body.length - 1}/${bytes.length}` }
          : {}) });
      response.end(request.method === 'HEAD' ? undefined : body);
    } else if (request.method === 'DELETE') {
      objects.delete(path);
      response.writeHead(204);
      response.end();
    } else {
      response.writeHead(404);
      response.end();
    }
  } catch (error: any) {
    response.writeHead(500);
    response.end(error.message);
  }
});

function ownedBox() {
  const nonce = process.env.ULPIN_GN1_NONCE!;
  assert.match(nonce, /^[a-f0-9]{16}$/);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'gn1_control');
  assert.equal(url.pathname, `/gn1_${nonce}`);
  assert.equal(url.password, '');
  assert.equal(process.env.ULPIN_MODEL_GATEWAY_ENABLED, '0');
  for (const [kind, container] of [['db', process.env.ULPIN_GN1_DB!], ['geo', process.env.ULPIN_GN1_GEO!]]) {
    assert.equal(container, `ulpin-gn1-${kind}-${nonce}`);
    for (const [key, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'GN1']])
      assert.equal(execFileSync('docker', ['inspect', '--format',
        `{{ index .Config.Labels "${key}" }}`, container], { encoding: 'utf8' }).trim(), value);
  }
}

function observeJobs() {
  (globalThis as unknown as { ulpinPool: Pool }).ulpinPool = new Pool({
    connectionString: settings.databaseUrl, max: 8, connectionTimeoutMillis: 10000 });
  pool().on('connect', client => {
    const original = client.query.bind(client);
    const committing = new Set<string>();
    client.query = ((...args: any[]) => {
      if (typeof args.at(-1) === 'function') return (original as any)(...args);
      const [text, values = []] = args;
      return (original as any)(...args).then((result: unknown) => {
        if (typeof text === 'string' && text.startsWith('UPDATE jobs SET status=')
          && (text.includes("'succeeded'") || text.includes("'failed'") || ['failed', 'stale'].includes(values[1])))
          committing.add(String(values[0]));
        if (text === 'COMMIT') {
          for (const id of committing) completed?.(id);
          committing.clear();
        }
        if (text === 'ROLLBACK') committing.clear();
        return result;
      });
    }) as typeof client.query;
  });
}

async function standIns() {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  process.env.S3_ENDPOINT = `http://127.0.0.1:${address.port}`;
  process.env.S3_ACCESS_KEY = randomBytes(12).toString('hex');
  process.env.S3_SECRET_KEY = randomBytes(24).toString('hex');
  process.env.S3_BUCKET = 'gn1-memory-originals';
  const fetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.hostname, '127.0.0.1', 'No non-loopback fetch.');
    return fetch(input, init);
  };
}

async function tick(allowRefusal = false) {
  await new Promise<void>(resolve => setImmediate(resolve));
  let timer: ReturnType<typeof setTimeout>;
  const finished = new Promise<string>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Dispatcher exceeded its 90-second bound.')), 90000);
    completed = resolve;
  });
  try {
    await dispatchTick();
    const id = await finished;
    const job = (await query('SELECT id,operation,status,error FROM jobs WHERE id=$1', [id])).rows[0];
    if (!allowRefusal) assert.equal(job.status, 'succeeded', JSON.stringify(job));
    return job;
  } finally {
    clearTimeout(timer!);
    completed = undefined;
  }
}
async function drain(allowRefusal = false) {
  const jobs = [];
  for (let index = 0; index < 20; index++) {
    if (!(await query("SELECT id FROM jobs WHERE status IN ('queued','running') LIMIT 1")).rowCount) return jobs;
    jobs.push(await tick(allowRefusal));
  }
  throw new Error('Dispatcher exceeded its 20-job bounded walk.');
}
async function retain(key: keyof typeof inputs, label: string) {
  const { caseId } = await intakeHttp('POST', '/api/v1/source-cases', '/api/v1/source-cases', sourceCase,
    { requestKey: randomUUID(), name: `GN1 ${label} test_only` }, 201);
  const form = new FormData();
  form.set('file', new File([originals[key]], inputs[key].split('/').at(-1)!, { type: 'application/geo+json' }));
  form.set('format', 'geojson');
  form.set('requestKey', randomUUID());
  form.set('expectedWorkspaceRevision', '0');
  const profile = await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/sources`,
    '/api/v1/ingestion/cases/{caseId}/sources', AnySourceProfileSchema, form, 201) as SourceProfile;
  await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/intake/items`,
    '/api/v1/ingestion/cases/{caseId}/intake/items', IntakeItemSchema,
    { requestKey: randomUUID(), sourceId: profile.source.sourceId }, 201);
  const stored = (await query('SELECT object_key,inspection FROM sources WHERE id=$1',
    [profile.source.sourceId])).rows[0];
  assert.deepEqual(Buffer.from(await readObject(stored.object_key)), originals[key]);
  return { caseId, profile, storedInspection: stored.inspection.gis };
}
async function manifest(caseId: string) {
  return intakeHttp('GET', `/api/v1/ingestion/cases/${caseId}/intake`,
    '/api/v1/ingestion/cases/{caseId}/intake', IntakeManifestSchema);
}
function plan(profile: SourceProfile, kind: 'parcel' | 'building') {
  return { version: profile.version, mode: 'manual_mapping', source: profile.source, caseId: profile.caseId,
    workspaceRevision: profile.workspaceRevision, workspaceFingerprint: profile.workspaceFingerprint, kind,
    operations: [
      { target: 'feature.sourceKey',
        sourcePath: `/features/*/properties/${kind === 'parcel' ? 'OBJECTID' : 'doitt_id'}`,
        conversionId: kind === 'parcel' ? 'literal_integer_identifier@1' : 'literal_identifier@1' },
      { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' },
    ] };
}
async function author(profile: SourceProfile, kind: 'parcel' | 'building') {
  return intakeHttp('POST', `/api/v1/ingestion/cases/${profile.caseId}/sources/${profile.source.sourceId}/recipes`,
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/recipes', AnyMappingReceiptSchema,
    { requestKey: randomUUID(), expectedRecipeRevision: 0, plan: plan(profile, kind) }, 201) as Promise<MappingReceipt>;
}
async function approve(profile: SourceProfile, receipt: MappingReceipt) {
  return intakeHttp('POST', `/api/v1/ingestion/cases/${profile.caseId}/recipes/${receipt.id}/approve`,
    '/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}/approve', AnyMappingReceiptSchema,
    { requestKey: randomUUID(), expectedRecipeRevision: receipt.revision }, 200) as Promise<MappingReceipt>;
}
async function packageRead(id: string) {
  return intakeHttp('GET', `/api/v1/import-packages/${id}`, '/api/v1/import-packages/{packageId}',
    importPackage) as Promise<ImportPackage>;
}
async function record(profile: SourceProfile, expected: number) {
  const page = await intakeHttp('GET', `/api/v1/ingestion/cases/${profile.caseId}/targets`,
    '/api/v1/ingestion/cases/{caseId}/targets', IntakeTargetPageSchema);
  assert.equal(page.packages.length, 1);
  const confirmation = await intakeHttp('POST', `/api/v1/ingestion/cases/${profile.caseId}/confirmations`,
    '/api/v1/ingestion/cases/{caseId}/confirmations', IntakeConfirmationSchema,
    { requestKey: randomUUID(),
      acknowledgement: 'GN1 foreign test_only physical records; rights and heights unassessed.',
      packages: page.packages.map(pkg => ({ packageId: pkg.packageId, revision: pkg.revision,
        reviewFingerprint: pkg.reviewFingerprint })), targets: [] });
  await drain();
  const pkg = await packageRead(page.packages[0].packageId);
  assert.equal(pkg.state, 'COMMITTED');
  const context = await intakeHttp('GET', `/api/v1/areas/${pkg.areaId}/context`,
    '/api/v1/areas/{areaId}/context', areaContext) as AreaContext;
  assert.equal(context.features.length, expected);
  assert(context.features.every(feature => feature.revision === 1));
  const count = (await query('SELECT count(*)::int n FROM physical_features WHERE area_id=$1 AND revision>0',
    [pkg.areaId])).rows[0].n;
  assert.equal(count, expected);
  return { pkg, context, confirmation, physicalRecords: count, readyBuildingTargets: page.counts.ready };
}

function parcelGeometry(context: AreaContext) {
  const source = JSON.parse(originals.da5.toString());
  const keys = source.features.map((feature: any) => String(feature.properties.OBJECTID));
  assert.deepEqual(context.features.map(feature => feature.sourceKey).sort(), keys.sort());
  assert.equal(context.area.reference!.sourceCrs, 'EPSG:2958');
  assert.deepEqual(context.area.geographicExtent,
    [-79.16101883167528, 43.040644980164004, -79.04074191660973, 43.14004728100516]);
  return source.features.filter((feature: any) => feature.geometry.type === 'MultiPolygon').map((row: any) => {
    const feature = context.features.find(feature => feature.sourceKey === String(row.properties.OBJECTID))!;
    assert.equal(feature.geometry.type, 'MultiPolygon');
    assert.equal(feature.geographicGeometry.type, 'MultiPolygon');
    assert.deepEqual(feature.sourceGeometry, row.geometry);
    const localParts = (feature.geometry.coordinates as unknown[]).length;
    const geographicParts = (feature.geographicGeometry.coordinates as unknown[]).length;
    assert.equal(localParts, 2);
    assert.equal(geographicParts, 2);
    return { sourceKey: feature.sourceKey, sourceParts: row.geometry.coordinates.length, localParts, geographicParts };
  });
}

async function da5() {
  const dropped = await retain('da5', 'projected condominium parcels');
  assert.equal(dropped.profile.crs.value, 'EPSG:2958');
  assert.equal(dropped.profile.crs.unit, 'metre');
  const id = dropped.profile.paths.find(path => path.path.endsWith('/OBJECTID'))!;
  assert.equal(id.integerIdEligible, true);
  assert.equal(id.literalIdEligible, false);
  await drain();
  const before = (await manifest(dropped.caseId)).items[0];
  results.da5Initial = before;
  assert.equal(before.placement, 'needs_answer');
  const authored = await author(dropped.profile, 'parcel');
  assert.equal(authored.destination!.namespace, `file:${hashes.da5}`);
  await approve(dropped.profile, authored);
  await drain();
  const item = (await manifest(dropped.caseId)).items[0];
  assert.equal(item.state, 'read');
  assert.equal(item.plan!.origin, 'officer');
  const recorded = await record(dropped.profile, 155);
  assert.equal(recorded.readyBuildingTargets, 0);
  assert(recorded.pkg.features.every(feature => feature.kind === 'parcel'));
  assert(recorded.pkg.warnings.some(warning => warning.includes('EPSG:2958')));
  const multipart = parcelGeometry(recorded.context);
  results.da5 = { caseId: dropped.caseId, source: dropped.profile.source, crs: dropped.profile.crs,
    crsUnitInInspection: dropped.storedInspection.crsUnit, integerEligibility: true,
    all155KeysAsSourceDigits: true, kindOfficerStated: 'parcel', recipeId: authored.id,
    preparedPackage: recorded.pkg.id, areaId: recorded.pkg.areaId, state: recorded.pkg.state,
    physicalRecords: recorded.physicalRecords, readyBuildingTargets: recorded.readyBuildingTargets,
    reference: recorded.context.area.reference,
    geographicExtent: recorded.context.area.geographicExtent, multipart, warnings: recorded.pkg.warnings,
    confirmationId: recorded.confirmation.confirmationId,
    cardMeaning: 'Physical parcel records only, not issued building/unit cards.' };
  console.log(JSON.stringify({ completed: 'DA5 projected parcels', count: recorded.physicalRecords }));
}

async function memoryProposal(second: SourceProfile, authored: MappingReceipt) {
  const item = (await manifest(second.caseId)).items[0];
  assert.equal(item.plan!.origin, 'memory');
  assert.equal(item.plan!.recipeState, 'proposed');
  assert(!item.plan!.packageId);
  const receipt = (await query('SELECT body FROM usp_mapping_recipes WHERE id=$1',
    [item.plan!.recipeId])).rows[0].body as MappingReceipt;
  assert(!receipt.approval);
  assert.deepEqual(receipt.plan.operations, authored.plan.operations);
  assert.deepEqual(receipt.plan.source, second.source);
  assert.notEqual(receipt.plan.source.sourceId, authored.plan.source.sourceId);
  return { item, receipt };
}

async function nycAndDa4() {
  const first = await retain('nyc', 'first NYC buildings');
  await drain();
  const authored = await author(first.profile, 'building');
  const approved = await approve(first.profile, authored);
  await drain();
  const firstRecorded = await record(first.profile, 1661);
  const second = await retain('da4', 'second NYC buildings with seven extra columns');
  assert.notEqual(first.profile.source.schemaFingerprint, second.profile.source.schemaFingerprint);
  for (const old of first.profile.paths) assert(second.profile.paths.some(path =>
    path.path === old.path && JSON.stringify(path.types) === JSON.stringify(old.types)));
  await drain();
  const { item: proposalItem, receipt } = await memoryProposal(second.profile, authored);
  await approve(second.profile, receipt);
  await drain();
  const secondRecorded = await record(second.profile, 1417);
  assert(secondRecorded.context.features.every(feature =>
    feature.kind === 'building' && feature.height.value === null));
  const before = JSON.parse(readFileSync('docs/evidence/gf1/gn1/before.json', 'utf8'));
  for (const [index, profile] of [[1, first.profile], [2, second.profile]] as const) {
    assert.equal(profile.source.schemaFingerprint, before.records[index].schemaFingerprint);
    assert.equal(JSON.stringify(profile.crs), JSON.stringify(before.records[index].crs));
  }
  results.nycDa4 = { first: { caseId: first.caseId, source: first.profile.source,
    recipeId: authored.id, approval: approved.approval, areaId: firstRecorded.pkg.areaId,
    areaName: firstRecorded.context.area.name, physicalRecords: 1661, rawFeatures: first.profile.featureCount },
    second: { caseId: second.caseId, source: second.profile.source, areaId: secondRecorded.pkg.areaId,
      rawFeatures: second.profile.featureCount, physicalRecords: 1417,
      readyBuildingTargets: secondRecorded.readyBuildingTargets },
    extraColumns: second.profile.paths.length - first.profile.paths.length,
    differentFingerprints: true, origin: proposalItem.plan!.origin, proposedBeforeOfficerApproval: true,
    newSourcePins: true, operationsAndStatedKindUnchanged: true, approvalNotInherited: true,
    laterExplicitOfficerApproval: true, oldCrsObjectsAndFingerprintsUnchanged: true };
  console.log(JSON.stringify({ completed: 'NYC -> DA4 contained profile memory', count: 1417 }));
}
async function counts() {
  return (await query(`SELECT (SELECT count(*)::int FROM map_areas) areas,
    (SELECT count(*)::int FROM import_packages) packages,
    (SELECT count(*)::int FROM physical_features WHERE revision>0) records`)).rows[0];
}
function duplicateWaiting(item: Awaited<ReturnType<typeof manifest>>['items'][number],
  refusal: { code: string; message: string }) {
  if (refusal.code === 'SOURCE_ALREADY_IN_AREA') {
    assert.equal(item.state, 'planned');
    assert.equal(item.placement, 'needs_answer');
    assert.equal(refusal.message, `This file is already the source of the area “${results.nycDa4.first.areaName}”. `
      + 'Open that area; nothing new is prepared from a second copy.');
    assert.equal(item.limitReason, refusal.message);
    return true;
  }
  assert.equal(refusal.code, 'STALE_REVISION');
  assert.equal(refusal.message, 'This destination already exists; pin its current area and reference explicitly.');
  assert.equal(item.limitReason, null);
  return false;
}

async function duplicate() {
  const before = await counts();
  const second = await retain('nyc', 'second copy of first NYC file');
  const jobs = await drain(true);
  const failure = jobs.find(job => ['SOURCE_ALREADY_IN_AREA', 'STALE_REVISION'].includes(job.error));
  assert(failure, JSON.stringify(jobs));
  const item = (await manifest(second.caseId)).items[0];
  assert(!item.plan);
  const route = `/api/v1/ingestion/cases/${second.caseId}/sources/${second.profile.source.sourceId}/recipes`;
  const refusal = await rejectedHttp(route,
    { requestKey: randomUUID(), expectedRecipeRevision: 0, plan: plan(second.profile, 'building') }, 409);
  assert.equal(refusal.code, failure.error);
  const g4 = duplicateWaiting(item, refusal);
  const after = await counts();
  assert.deepEqual(after, before);
  results.duplicate = { caseId: second.caseId, refusal: { status: 409, ...refusal },
    row: { state: item.state, placement: item.placement, limitReason: item.limitReason },
    before, after, newAreas: 0, newPackages: 0, newPhysicalRecords: 0, waitingReasonEqualsRefusal: g4,
    jobStatus: failure.status, noRecipePrepared: true, g4,
    ...(!g4 ? { blockedBy: 'service.ts author destination call is read-only and supplies no source hash. '
      + 'The destination guard cannot prove this file owns file:<sha256> without that pin.' } : {}) };
  console.log(JSON.stringify({ completed: 'NYC duplicate copy', newRecords: 0, g4 }));
}

async function main() {
  ownedBox();
  try {
    observeJobs();
    await query(sql('bootstrap.postgis'));
    await migrate();
    await query(sql('ingestion.intake.targets'));
    await standIns();
    await startHttp();
    await da5();
    await nycAndDa4();
    await duplicate();
    assert.equal((await query('SELECT count(*)::int n FROM usp_model_calls')).rows[0].n, 0);
    results.g1 = true;
    results.g2 = true;
    results.g3 = true;
    results.g4 = results.duplicate.g4;
  } catch (error: any) {
    failures.push({ code: error.code, message: error.message, stack: error.stack?.split('\n') });
    process.exitCode = 1;
  } finally {
    results.http = await stopHttp();
    closeStorageClient();
    server.closeIdleConnections();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await closePool();
    for (const [key, path] of Object.entries(inputs)) assert.equal(hash(readFileSync(path)), hashes[key]);
    console.log(JSON.stringify({ task: 'GN1', results, failures, inputs, hashes,
      originalHashesUnchanged: true, providers: 0, gpu: false,
      storage: 'KN2/CR1 in-memory S3 HTTP stand-in; not production object-store qualification.',
      network: 'Loopback HTTP/SQL, actual built geo service; PROJ_NETWORK=OFF; gateway disabled.' }));
  }
}
main().catch(error => {
  console.log(JSON.stringify({ failed: true, code: error.code, message: error.message }));
  process.exitCode = 1;
});
