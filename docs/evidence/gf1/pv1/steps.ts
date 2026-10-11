import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { LARGE_ORIGINAL_LIMITS, LargeUploadStatusSchema, AnyStreamingStatusSchema, StreamedProfileStatusSchema,
  StreamedMappingReceiptSchema, type LargeUploadCreate, type LargeUploadStatus, type StreamedProfileGeneration,
  type StreamedMappingPlan } from '../../../../packages/contracts/src/usp';
import { z as apiZod } from '../../../../apps/api/node_modules/zod/index.js';
import { sourceCase, caseDetail } from '../../../../apps/api/src/modules/intake/wire-schemas';
import { closePool, migrate, pool, query } from '../../../../packages/server/src/infrastructure/db';
import { settings } from '../../../../packages/server/src/infrastructure/config';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { ensureBucket, closeStorageClient } from '../../../../packages/server/src/infrastructure/storage';
import { fingerprint } from '../../../../packages/server/src/modules/cases/domain';
import { dispatchTick } from '../../../../packages/server/src/modules/cases/processing';
import { intakeHttp, rejectedHttp, startHttp, stopHttp } from '../kn2/http';

const da6 = JSON.parse(readFileSync('docs/evidence/gf1/da6/result.json', 'utf8'));
const asset = da6.assets[0];
const original = readFileSync(asset.retainedPath);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
assert.equal(original.length, 43263076);
assert.equal(hash(original), asset.sha256);
const results: Record<string, any> = {};
const failures: unknown[] = [];
const partCalls: { method: string; route: string; status: number }[] = [];
let completion: ((id: string) => void) | undefined;

function ownedBox() {
  const nonce = process.env.ULPIN_PV1_NONCE!;
  assert.match(nonce, /^[a-f0-9]{16}$/);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'pv1_control');
  assert.equal(url.password, '');
  assert.equal(url.pathname, `/pv1_${nonce}`);
  assert.equal(process.env.S3_BUCKET, `pv1-${nonce}`);
  assert.equal(process.env.ULPIN_MODEL_GATEWAY_ENABLED, '0');
  for (const [kind, container] of [['db', process.env.ULPIN_PV1_DB!], ['store', process.env.ULPIN_PV1_STORE!]]) {
    assert.equal(container, `ulpin-pv1-${kind}-${nonce}`);
    for (const [key, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'PV1']])
      assert.equal(execFileSync('docker', ['inspect', '--format',
        `{{ index .Config.Labels "${key}" }}`, container], { encoding: 'utf8' }).trim(), value);
  }
}
function localFetch() {
  const fetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.hostname, '127.0.0.1', 'Non-loopback fetch forbidden.');
    return fetch(input, init);
  };
}
function observeJobs() {
  (globalThis as unknown as { ulpinPool: Pool }).ulpinPool = new Pool({
    connectionString: settings.databaseUrl, max: 8, connectionTimeoutMillis: 10000 });
  pool().on('connect', client => {
    const originalQuery = client.query.bind(client);
    const committing = new Set<string>();
    client.query = ((...args: any[]) => {
      if (typeof args.at(-1) === 'function') return (originalQuery as any)(...args);
      const [text, values = []] = args;
      return (originalQuery as any)(...args).then((value: unknown) => {
        if (typeof text === 'string' && text.startsWith('UPDATE jobs SET status=')
          && (text.includes("'succeeded'") || text.includes("'failed'") || ['failed', 'stale'].includes(values[1])))
          committing.add(String(values[0]));
        if (text === 'COMMIT') {
          for (const id of committing) completion?.(id);
          committing.clear();
        }
        if (text === 'ROLLBACK') committing.clear();
        return value;
      });
    }) as typeof client.query;
  });
}
async function tick(expectedId: string) {
  await new Promise<void>(resolve => setImmediate(resolve));
  let timer: ReturnType<typeof setTimeout>;
  const finished = new Promise<string>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Queued worker exceeded 12-minute observation bound.')), 720000);
    completion = resolve;
  });
  try {
    await dispatchTick();
    const id = await finished;
    assert.equal(id, expectedId);
    const job = (await query('SELECT id,status,error FROM jobs WHERE id=$1', [id])).rows[0];
    assert.equal(job.status, 'succeeded', JSON.stringify(job));
    return job;
  } finally {
    clearTimeout(timer!);
    completion = undefined;
  }
}
async function uploadPart(caseId: string, status: LargeUploadStatus, index: number) {
  const bytes = original.subarray(index * status.partBytes, Math.min((index + 1) * status.partBytes, original.length));
  const pattern = '/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}/parts/{partNumber}';
  const published = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8'));
  const wire = published.paths[pattern].put.responses['200'].content['application/json'].schema;
  const resolved = wire.$ref ? published.components.schemas[wire.$ref.split('/').at(-1)] : wire;
  assert.deepEqual(resolved, apiZod.toJSONSchema(LargeUploadStatusSchema, { target: 'openapi-3.0' }));
  const endpoint = `http://127.0.0.1:${process.env.API_PORT}`;
  const route = `/api/v1/ingestion/cases/${caseId}/uploads/${status.id}/parts/${index + 1}`;
  const response = await fetch(endpoint + route, { method: 'PUT', body: bytes, headers: {
    'Content-Type': 'application/octet-stream', 'x-request-key': randomUUID(),
    'x-upload-revision': String(status.revision), 'x-case-revision': String(status.currentCaseRevision),
    'x-part-sha256': hash(bytes),
  } });
  const value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  partCalls.push({ method: 'PUT', route: pattern, status: response.status });
  return LargeUploadStatusSchema.parse(value);
}
async function upload(provenance: LargeUploadCreate['provenance'], label: string) {
  const { caseId } = await intakeHttp('POST', '/api/v1/source-cases', '/api/v1/source-cases', sourceCase,
    { requestKey: randomUUID(), name: `PV1 ${label} DA6 test_only` }, 201);
  const route = `/api/v1/ingestion/cases/${caseId}/uploads`;
  let status = await intakeHttp('POST', route, '/api/v1/ingestion/cases/{caseId}/uploads', LargeUploadStatusSchema,
    { requestKey: randomUUID(), expectedCaseRevision: 0, filename: asset.file, mediaType: 'application/octet-stream',
      bytes: original.length, sha256: asset.sha256, provenance }, 201);
  for (let index = 0; index < status.partCount; index++) status = await uploadPart(caseId, status, index);
  assert.equal(status.receivedBytes, original.length);
  status = await intakeHttp('POST', `${route}/${status.id}/finalize`,
    '/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}/finalize', LargeUploadStatusSchema,
    { requestKey: randomUUID(), expectedRevision: status.revision, expectedCaseRevision: status.currentCaseRevision,
      sha256: asset.sha256 }, 200);
  assert.equal(status.state, 'retained');
  const detail = await intakeHttp('GET', `/api/v1/cases/${caseId}`, '/api/v1/cases/{caseId}', caseDetail);
  const source = detail.sources.find(source => source.id === status.source!.sourceId)!;
  assert(source.inspection && 'largeOriginal' in source.inspection && source.inspection.largeOriginal);
  const stored = source.inspection.largeOriginal;
  const expected = 'origin' in provenance ? { ...provenance, state: 'not_stated' }
    : { ...provenance, state: 'caller_declared' };
  assert.equal(JSON.stringify(stored.provenance), JSON.stringify(expected));
  results[label] = { caseId, uploadId: status.id, sourceId: source.id, parts: status.partCount,
    bytes: source.bytes, sha256: source.sha256, storedEvidence: stored, uploadState: status.state };
  console.log(JSON.stringify({ completed: `${label} upload/read`, bytes: source.bytes, parts: status.partCount }));
  return { caseId, sourceId: source.id, revision: detail.case.revision, sourceRevision: source.revision };
}
async function readAndProfile(context: Awaited<ReturnType<typeof upload>>, label: string) {
  const route = `/api/v1/ingestion/cases/${context.caseId}/sources/${context.sourceId}`;
  const request = { requestKey: randomUUID(), expectedCaseRevision: context.revision,
    expectedSourceRevision: context.sourceRevision, sourceSha256: asset.sha256 };
  const raw = await intakeHttp('POST', `${route}/streaming-vector`,
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streaming-vector', AnyStreamingStatusSchema,
    { ...request, framing: 'feature-collection' });
  await tick(raw.jobId);
  const sealed = await intakeHttp('GET', `${route}/streaming-vector/jobs/${raw.jobId}`,
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streaming-vector/jobs/{jobId}', AnyStreamingStatusSchema);
  assert.equal(sealed.unknownRemainder, false);
  assert.equal(sealed.records, 48686);
  const queued = await intakeHttp('POST', `${route}/streamed-profile`,
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile', StreamedProfileStatusSchema,
    { ...request, requestKey: randomUUID(), rawJobId: raw.jobId });
  await tick(queued.jobId);
  const profile = await intakeHttp('GET', `${route}/streamed-profile/jobs/${queued.jobId}`,
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile/jobs/{jobId}', StreamedProfileStatusSchema);
  assert.equal(profile.status, 'sealed');
  assert(profile.latest);
  assert.equal(profile.latest.recordsSeen, 48686);
  assert.equal(profile.latest.unknownRemainder, false);
  results[label].reader = { jobId: sealed.jobId, status: sealed.status, records: sealed.records,
    accepted: sealed.accepted, quarantined: sealed.quarantined, chunks: sealed.sealedChunks,
    unknownRemainder: sealed.unknownRemainder };
  results[label].profile = { jobId: profile.jobId, status: profile.status, generation: profile.latest.generation,
    accepted: profile.latest.accepted, quarantined: profile.latest.quarantined, paths: profile.latest.paths.length,
    unknownRemainder: profile.latest.unknownRemainder, reference: profile.latest.reference };
  console.log(JSON.stringify({ completed: `${label} reader/profile sealed`, records: sealed.records }));
  return profile.latest;
}
function plan(context: Awaited<ReturnType<typeof upload>>, profile: StreamedProfileGeneration): StreamedMappingPlan {
  return { version: 'streamed-mapping/1', mode: 'streamed_mapping', scope: 'accepted_source_features',
    basis: 'officer_stated', source: profile.source, caseId: context.caseId, caseRevision: context.revision,
    rawJobId: profile.rawJobId, profileJobId: profile.jobId, profileGeneration: profile.generation,
    profileHash: profile.generationHash, semanticEvidence: [], operations: [
      { target: 'building.sourceKey', sourcePath: '/features/*/properties/doitt_id',
        conversionId: 'literal_identifier@1' },
      { target: 'building.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_polygon@1' },
    ] };
}
async function authorAndApprove(context: Awaited<ReturnType<typeof upload>>,
  profile: StreamedProfileGeneration, label: string) {
  const route = `/api/v1/ingestion/cases/${context.caseId}/sources/${context.sourceId}`
    + `/streamed-profile/jobs/${profile.jobId}/recipes`;
  const chosen = plan(context, profile);
  const authored = await intakeHttp('POST', route,
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile/jobs/{jobId}/recipes',
    StreamedMappingReceiptSchema, { requestKey: randomUUID(), expectedRecipeRevision: 0, plan: chosen }, 201);
  assert.equal(authored.state, 'proposed');
  assert.equal(authored.approval, null);
  const approved = await intakeHttp('POST', `${route}/${authored.id}/approve`,
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile/jobs/{jobId}/recipes/{recipeId}/approve',
    StreamedMappingReceiptSchema, { requestKey: randomUUID(), expectedRecipeRevision: authored.revision }, 200);
  assert.equal(approved.state, 'approved');
  assert.equal(approved.plan.basis, 'officer_stated');
  assert.deepEqual(approved.plan.semanticEvidence, []);
  assert.equal(approved.planHash, fingerprint(chosen));
  results[label].layout = { recipeId: approved.id, state: approved.state, basis: approved.plan.basis,
    semanticEvidence: approved.plan.semanticEvidence, planHash: approved.planHash, approval: approved.approval,
    operations: approved.plan.operations, noMappingOrPackageRequested: true };
  if (label === 'unstated') await negativeLayout(route, approved.revision, chosen);
  console.log(JSON.stringify({ completed: `${label} officer layout authored/approved` }));
}
async function negativeLayout(route: string, revision: number, chosen: StreamedMappingPlan) {
  const { basis: _basis, ...absent } = chosen;
  const withoutCitations = await rejectedHttp(route, { requestKey: randomUUID(),
    expectedRecipeRevision: revision, plan: absent }, 422);
  assert.equal(withoutCitations.code, 'INVALID_INPUT');
  assert(withoutCitations.message.includes('Each operation needs matching issuer meaning evidence'));
  const cited = { ...absent, semanticEvidence: absent.operations.map(operation => ({ target: operation.target,
    sourcePath: operation.sourcePath, issuer: asset.issuer, evidenceUrl: asset.originalUrl,
    meaning: operation.target === 'building.sourceKey' ? 'building_source_identity' : 'building_footprint' })) };
  const originRefusal = await rejectedHttp(route, { requestKey: randomUUID(),
    expectedRecipeRevision: revision, plan: cited }, 422);
  assert.equal(originRefusal.code, 'STREAMED_MAPPING_PROVENANCE');
  assert.equal(originRefusal.message, "This layout cites the publisher, and this file's origin is not stated. "
    + "State the layout as the officer's own.");
  results.unstated.negative = { absentBasisEmptyCitations: withoutCitations, publisherCitedOrigin: originRefusal };
}
function hashProof() {
  const stored = JSON.parse(readFileSync('docs/evidence/gf1/pv1/stored-receipt-before.json', 'utf8'));
  const parsed = StreamedMappingReceiptSchema.parse(stored.receipt);
  assert.equal(JSON.stringify(parsed), JSON.stringify(stored.receipt));
  assert.equal(parsed.planHash, fingerprint(parsed.plan));
  assert(!Object.hasOwn(parsed.plan, 'basis'));
  return { before: stored.receipt.planHash, after: fingerprint(parsed.plan), bytesUnchanged: true };
}
async function walk() {
  const acquiredAt = new Date().toISOString();
  const unstated = await upload({ origin: 'not_stated', acquiredAt }, 'unstated');
  await authorAndApprove(unstated, await readAndProfile(unstated, 'unstated'), 'unstated');
  const cited = await upload({ issuer: asset.issuer, originalUrl: asset.originalUrl,
    acquiredAt: new Date(asset.acquiredAtIst).toISOString(),
    permissionReference: asset.licence.portalMetadataUrl, limitations: ['Foreign test_only; permission unconfirmed.'] },
  'cited');
  await authorAndApprove(cited, await readAndProfile(cited, 'cited'), 'cited');
  results.planHash = hashProof();
  const counts = (await query(`SELECT (SELECT count(*)::int FROM usp_model_calls) providers,
    (SELECT count(*)::int FROM import_packages) packages, (SELECT count(*)::int FROM physical_features) records,
    (SELECT count(*)::int FROM jobs WHERE operation='chunk-mapping') "mappingJobs"`)).rows[0];
  assert.deepEqual(counts, { providers: 0, packages: 0, records: 0, mappingJobs: 0 });
  results.counts = counts;
}
async function main() {
  ownedBox();
  try {
    observeJobs();
    localFetch();
    await query(sql('bootstrap.postgis'));
    await migrate();
    await ensureBucket();
    await startHttp();
    await walk();
  } catch (error: any) {
    failures.push({ code: error.code, message: error.message, stack: error.stack?.split('\n').slice(0, 8) });
    process.exitCode = 1;
  } finally {
    results.http = [...await stopHttp(), ...partCalls];
    closeStorageClient();
    await closePool();
    assert.equal(hash(readFileSync(asset.retainedPath)), asset.sha256);
    console.log(JSON.stringify({ task: 'PV1', results, failures, originalHashUnchanged: true,
      input: { path: asset.retainedPath, bytes: original.length, sha256: asset.sha256 }, providers: 0,
      starts: 'Reader and profile started manually by existing HTTP requests, not automatic intake.',
      network: 'Loopback HTTP/PostGIS/MinIO only; gateway disabled; no mapping or packages.' }));
  }
}
main().catch(error => {
  console.log(JSON.stringify({ failed: true, code: error.code, message: error.message }));
  process.exitCode = 1;
});
