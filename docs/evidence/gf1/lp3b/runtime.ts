import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { IntakeItemSchema, IntakeManifestSchema, LargeUploadStatusSchema,
  type LargeUploadStatus } from '../../../../packages/contracts/src/usp';
import { sourceCase } from '../../../../apps/api/src/modules/intake/wire-schemas';
import { closePool, migrate, query } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { sha256 } from '../../../../packages/server/src/infrastructure/storage';
import { dispatchTick } from '../../../../packages/server/src/modules/cases/processing';
import { intakeHttp, startHttp, stopHttp } from '../kn2/http';
import { openStream } from '../aq1/streams';
import { originalStored, startStorage, stopStorage } from './storage';

type Input = { name: string; path: string; bytes: number; sha256: string;
  issuer: string; originalUrl: string; acquiredAt: string; permissionReference: string };
const da6 = JSON.parse(readFileSync('docs/evidence/gf1/da6/result.json', 'utf8')).assets[0];
const niagara = JSON.parse(readFileSync('docs/evidence/gf1/da1/result.json', 'utf8')).assets
  .find((value: any) => value.issuer === 'City of Niagara Falls');
const inputs: Input[] = [
  { name: 'DA6', path: da6.retainedPath, bytes: da6.bytes, sha256: da6.sha256,
    issuer: da6.issuer, originalUrl: da6.originalUrl,
    acquiredAt: new Date(da6.acquiredAtIst).toISOString(),
    permissionReference: 'Licence unstated; permission unconfirmed' },
  { name: 'Niagara', path: niagara.path, bytes: niagara.bytes, sha256: niagara.sha256,
    issuer: niagara.issuer, originalUrl: niagara.originalUrl,
    acquiredAt: new Date(niagara.acquiredAtIst).toISOString(), permissionReference: niagara.licence.textUrl },
];
const results: unknown[] = [];
const failures: unknown[] = [];
const streams: Awaited<ReturnType<typeof openStream>>[] = [];
const partCalls: unknown[] = [];

function assertOwnBox() {
  const nonce = process.env.ULPIN_LP3B_NONCE!;
  assert.match(nonce, /^[a-f0-9]{16}$/);
  const container = process.env.ULPIN_LP3B_CONTAINER!;
  assert.equal(container, `ulpin-lp3b-tmp-${nonce}`);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'lp3b_control');
  assert.equal(url.password, '');
  assert.equal(url.pathname, `/lp3b_${nonce}`);
  assert.equal(process.env.ULPIN_MODEL_GATEWAY_ENABLED, '0');
  for (const [key, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'LP3b']]) {
    assert.equal(execFileSync('docker', ['inspect', '--format',
      `{{ index .Config.Labels "${key}" }}`, container], { encoding: 'utf8' }).trim(), value);
  }
}

async function part(upload: LargeUploadStatus, number: number, bytes: Buffer) {
  const route = `/api/v1/ingestion/cases/${upload.caseId}/uploads/${upload.id}/parts/${number}`;
  const response = await fetch(`http://127.0.0.1:${process.env.API_PORT}${route}`, { method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Request-Key': randomUUID(),
      'X-Upload-Revision': String(upload.revision), 'X-Case-Revision': String(upload.currentCaseRevision),
      'X-Part-Sha256': sha256(bytes) }, body: bytes });
  const body = await response.json();
  partCalls.push({ method: 'PUT', part: number, bytes: bytes.length, status: response.status });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  return LargeUploadStatusSchema.parse(body);
}

async function retain(input: Input, bytes: Buffer) {
  const { caseId } = await intakeHttp('POST', '/api/v1/source-cases', '/api/v1/source-cases', sourceCase,
    { requestKey: randomUUID(), name: `LP3b ${input.name} HTTP boundary test_only` }, 201);
  let upload = await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/uploads`,
    '/api/v1/ingestion/cases/{caseId}/uploads', LargeUploadStatusSchema, {
      requestKey: randomUUID(), expectedCaseRevision: 0, filename: input.path.split('/').at(-1),
      mediaType: 'application/octet-stream', bytes: input.bytes, sha256: input.sha256,
      provenance: { issuer: input.issuer, originalUrl: input.originalUrl, acquiredAt: input.acquiredAt,
        permissionReference: input.permissionReference, limitations: ['Foreign test_only; no operational claim.'] },
    }, 201);
  for (let number = 1; number <= upload.partCount; number++) {
    const start = (number - 1) * upload.partBytes;
    upload = await part(upload, number, bytes.subarray(start, Math.min(input.bytes, start + upload.partBytes)));
  }
  upload = await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/uploads/${upload.id}/finalize`,
    '/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}/finalize', LargeUploadStatusSchema, {
      requestKey: randomUUID(), expectedRevision: upload.revision, expectedCaseRevision: upload.currentCaseRevision,
      sha256: input.sha256,
    }, 200);
  assert.equal(upload.state, 'retained');
  assert.equal(upload.verifiedSha256, input.sha256);
  assert(upload.source);
  assert(originalStored(upload.source.sourceId, input.sha256, input.bytes));
  return { caseId, sourceId: upload.source.sourceId, upload };
}

async function walk(input: Input) {
  const bytes = readFileSync(input.path);
  assert.equal(bytes.length, input.bytes);
  assert.equal(sha256(bytes), input.sha256);
  const batch = await retain(input, bytes);
  const stream = await openStream(batch.caseId);
  streams.push(stream);
  const started = performance.now();
  const item = await intakeHttp('POST', `/api/v1/ingestion/cases/${batch.caseId}/intake/items`,
    '/api/v1/ingestion/cases/{caseId}/intake/items', IntakeItemSchema,
    { requestKey: randomUUID(), sourceId: batch.sourceId }, 201);
  const registeredMs = Math.round(performance.now() - started);
  await stream.wait(() => stream.events.some(event => event.change.kind === 'intake.item'));
  const dispatched = await dispatchTick();
  const manifest = await intakeHttp('GET', `/api/v1/ingestion/cases/${batch.caseId}/intake`,
    '/api/v1/ingestion/cases/{caseId}/intake', IntakeManifestSchema);
  const jobs = (await query('SELECT operation,status FROM jobs WHERE source_id=$1', [batch.sourceId])).rows;
  const packages = Number((await query('SELECT count(*)::int n FROM import_packages WHERE case_id=$1',
    [batch.caseId])).rows[0].n);
  assert.equal(packages, 0);
  assert.equal(jobs.length, 0);
  assert.equal(manifest.items[0].plan, null);
  assert.equal(manifest.items[0].state, 'probed');
  results.push({ input: input.name, bytes: input.bytes, sha256: input.sha256, upload: batch.upload,
    registerToRowMs: registeredMs, register201: item, manifestAfterDispatcher: manifest,
    dispatched, jobs, packages, events: stream.events,
    stop: 'No intake-large job is activated: authority yield/resume seam is outside the owned registration hunk.',
    projectedCrsRefusalReached: false });
  await stream.close();
  assert.equal(sha256(readFileSync(input.path)), input.sha256);
}

async function main() {
  assertOwnBox();
  let http: unknown;
  try {
    await query(sql('bootstrap.postgis'));
    await migrate();
    await query(sql('ingestion.intake.targets'));
    await startStorage();
    await startHttp();
    for (const input of inputs) await walk(input);
  } catch (error: any) {
    failures.push({ code: error.code, message: error.message, stack: error.stack?.split('\n') });
    process.exitCode = 1;
  } finally {
    for (const stream of streams) await stream.close();
    http = await stopHttp();
    await stopStorage();
    await closePool();
    console.log(JSON.stringify({ task: 'LP3b', results, http, partCalls, failures, providerCalls: 0,
      originalHashesUnchanged: inputs.every(input => sha256(readFileSync(input.path)) === input.sha256),
      qualification: 'Actual HTTP upload/register boundary; in-memory loopback S3 control; '
        + 'no automatic runtime pass.' }));
  }
}

main().catch(error => {
  console.log(JSON.stringify({ failure: error.message }));
  process.exitCode = 1;
});
