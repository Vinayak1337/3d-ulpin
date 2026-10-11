// HTTP audit over an owned database and private in-memory S3 control, with unchanged product Python.
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import { startHttp, stopHttp } from '../e1/http';
import { closePool, migrate, query } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { closeStorageClient } from '../../../../packages/server/src/infrastructure/storage';
import { runRasterWindowJob } from '../../../../packages/server/src/modules/usp/ingestion/raster-window-worker';
import { runPointBatchJob } from '../../../../packages/server/src/modules/usp/ingestion/point-batch-worker';
import { IntakeItemSchema, IntakeManifestSchema, RasterRetainReceiptSchema, PointRetainReceiptSchema,
  RasterWindowStatusSchema, PointBatchStatusSchema } from '../../../../packages/contracts/src/usp';

const folder = 'E:/BhuAayam-data/datasets/nyc-10013/files/';
const python = 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const files = ['nyc-10013-ortho-2018.tif', 'nyc-10013-dem-2017.tif', 'nyc-10013-lidar-2017.laz'];
const profile = JSON.parse(readFileSync('scripts/demo-import/nyc-profile.json', 'utf8'));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const objects = new Map<string, Buffer>();
const calls: unknown[] = [];
const results: any = { qualification: 'Private S3 protocol control; product API, SQL and Python readers unchanged.' };
const execute = promisify(execFile);
let endpoint: string;
let caseId: string;

function ownedBox() {
  const nonce = process.env.ULPIN_AU3_NONCE!;
  assert.match(nonce, /^[a-f0-9]{16}$/);
  assert.equal(process.env.ULPIN_AU3_CONTAINER, `ulpin-au3-tmp-${nonce}`);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, `/au3_${nonce}`);
  assert.equal(process.env.ULPIN_MODEL_GATEWAY_ENABLED, '0');
  for (const [key, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'AU3']]) {
    assert.equal(execFileSync('docker', ['inspect', '--format',
      `{{ index .Config.Labels "${key}" }}`, process.env.ULPIN_AU3_CONTAINER!],
    { encoding: 'utf8' }).trim(), value);
  }
}

async function native(path: string, bytes: Buffer) {
  const raster = path === '/internal/raster/window';
  assert(raster || path === '/internal/point/batch');
  const module = raster ? 'raster_window' : 'point_batch';
  const method = raster ? 'read_raster_window' : 'read_point_batch';
  const code = 'import sys,json;sys.path.insert(0,"services/geo");'
    + `from geo.${module} import ${method};print(json.dumps(${method}(json.loads(sys.argv[1]))))`;
  const result = await execute(python, ['-B', '-c', code, bytes.toString()], {
    windowsHide: true, timeout: 100000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' },
  });
  return JSON.parse(result.stdout);
}

async function serve(request: IncomingMessage, response: ServerResponse) {
  const parts: Buffer[] = [];
  for await (const part of request) parts.push(Buffer.from(part));
  const bytes = Buffer.concat(parts);
  const path = request.url!.split('?')[0];
  if (path.startsWith('/internal/')) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(await native(path, bytes)));
    return;
  }
  if (request.method === 'PUT') {
    assert(!objects.has(path), 'Conditional originals/artifacts are immutable.');
    objects.set(path, bytes);
    response.writeHead(200, { ETag: `"${hash(bytes)}"` });
    response.end();
    return;
  }
  const object = objects.get(path);
  if (object && ['GET', 'HEAD'].includes(request.method!)) {
    const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
    const body = range ? object.subarray(Number(range[1]), Number(range[2]) + 1) : object;
    response.writeHead(range ? 206 : 200, { 'Content-Length': body.length, ETag: `"${hash(object)}"`,
      ...(range ? { 'Content-Range': `bytes ${range[1]}-${Number(range[1]) + body.length - 1}/${object.length}` }
        : {}) });
    response.end(request.method === 'HEAD' ? undefined : body);
    return;
  }
  response.writeHead(404);
  response.end();
}

const server = createServer((request, response) => {
  serve(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(422, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ detail: 'Audit transport failed; no source values logged.' }));
  });
});

async function standIns() {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  process.env.S3_ENDPOINT = url;
  process.env.S3_ACCESS_KEY = randomBytes(12).toString('hex');
  process.env.S3_SECRET_KEY = randomBytes(24).toString('hex');
  process.env.S3_BUCKET = 'au3-memory-originals';
  process.env.GEO_URL = url;
  process.env.GEO_SERVICE_TOKEN = randomBytes(24).toString('hex');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(target.hostname, '127.0.0.1', 'Only loopback network is permitted.');
    return originalFetch(input, init);
  };
}

async function http(method: string, route: string, input?: unknown, status = 200) {
  const form = input instanceof FormData;
  const response = await fetch(`${endpoint}${route}`, { method,
    ...(input === undefined ? {} : { headers: form ? {} : { 'Content-Type': 'application/json' },
      body: form ? input : JSON.stringify(input) }) });
  const value = await response.json();
  calls.push({ method, route, status: response.status });
  assert.equal(response.status, status, JSON.stringify(value));
  return value;
}

async function retain(name: string, revision: number) {
  const bytes = readFileSync(folder + name);
  const spec = profile.layers.find((layer: any) => layer.name === name);
  assert.equal(hash(bytes), spec.sha256);
  const manual = new FormData();
  manual.set('file', new File([bytes], name));
  manual.set('format', name.endsWith('.laz') ? 'laz' : 'geotiff');
  manual.set('requestKey', randomUUID());
  manual.set('expectedWorkspaceRevision', String(revision));
  const prefix = `/api/v1/ingestion/cases/${caseId}`;
  const refused = await http('POST', `${prefix}/sources`, manual, 422);
  assert.equal(refused.error.code, 'INVALID_INPUT');
  const form = new FormData();
  form.set('file', new File([bytes], name));
  form.set('requestKey', randomUUID());
  form.set('expectedCaseRevision', String(revision));
  form.set('lineage', JSON.stringify({ kind: name.endsWith('.laz') ? 'native_point_derivative'
    : 'native_grid_derivative', issuer: profile.issuer, originalUrl: spec.url, acquiredAt: null,
    permissionReference: null, geography: 'NYC ZCTA 10013; test_only', upstreamBytes: null,
    upstreamRetained: null, parentSha256: null, limitations: [spec.recipe], note: spec.verticalReference }));
  const kind = name.endsWith('.laz') ? 'points' : 'rasters';
  const raw = await http('POST', `${prefix}/${kind}`, form, 201);
  const receipt = kind === 'points' ? PointRetainReceiptSchema.parse(raw) : RasterRetainReceiptSchema.parse(raw);
  const item = IntakeItemSchema.parse(await http('POST', `${prefix}/intake/items`,
    { requestKey: randomUUID(), sourceId: receipt.sourceId }, 201));
  assert.equal(item.state, 'probed');
  assert.equal(item.placement, 'undecided');
  assert.equal(item.wave, 2);
  return { name, bytes: bytes.length, sha256: hash(bytes), manualRefusal: refused.error.code, receipt, item };
}

async function readOne(retained: any) {
  const { receipt, name } = retained;
  const point = name.endsWith('.laz');
  const worker = point ? runPointBatchJob : runRasterWindowJob;
  const suffix = point ? 'point-batches' : 'raster-windows';
  const prefix = `/api/v1/ingestion/cases/${caseId}/sources/${receipt.sourceId}/${suffix}`;
  // Retention itself queued part zero; probing did not. Execute that exact enrolled job first.
  const initialAt = performance.now();
  await worker(receipt.jobId);
  const parse = point ? PointBatchStatusSchema : RasterWindowStatusSchema;
  const initial = parse.parse(await http('GET', `${prefix}/jobs/${receipt.jobId}`));
  const revision = Number((await query('SELECT revision FROM cases WHERE id=$1', [caseId])).rows[0].revision);
  const selected = point ? { batch: { start: 0, count: 8192 } }
    : { window: { x: 0, y: 0, width: 256, height: 256 } };
  const next = await http('POST', prefix, { requestKey: randomUUID(), expectedCaseRevision: revision,
    expectedSourceRevision: receipt.sourceRevision, sourceSha256: receipt.sourceSha256, ...selected }, 202);
  const started = performance.now();
  await worker(next.jobId);
  const status = parse.parse(await http('GET', `${prefix}/jobs/${next.jobId}`));
  assert.equal(status.status, 'completed', JSON.stringify(status));
  const artifact = await fetch(`${endpoint}${prefix}/jobs/${next.jobId}/artifact`);
  assert.equal(artifact.status, 200);
  const bytes = new Uint8Array(await artifact.arrayBuffer());
  assert.equal(hash(bytes), status.result!.artifact.sha256);
  return { initialSeconds: (started - initialAt) / 1000, initialStatus: initial.status,
    requestedSeconds: (performance.now() - started) / 1000, status, verifiedArtifactBytes: bytes.length };
}

async function main() {
  ownedBox();
  try {
    await query(sql('bootstrap.postgis'));
    await migrate();
    await standIns();
    await startHttp();
    endpoint = `http://127.0.0.1:${process.env.API_PORT}`;
    const sourceCase = await http('POST', '/api/v1/source-cases',
      { requestKey: randomUUID(), name: 'AU3 NYC test_only retained surfaces' }, 201);
    caseId = sourceCase.caseId;
    const retained = [];
    for (const [index, name] of files.entries()) retained.push(await retain(name, index));
    results.caseId = caseId;
    results.afterProbe = retained;
    results.jobsAfterProbe = (await query('SELECT operation,count(*)::int count FROM jobs GROUP BY operation')).rows;
    results.readers = [];
    for (const item of retained) results.readers.push({ name: item.name, ...await readOne(item) });
    results.afterReading = IntakeManifestSchema.parse(await http('GET', `/api/v1/ingestion/cases/${caseId}/intake`));
    results.rows = (await query(`SELECT (SELECT count(*) FROM usp_intake_parts)::int intake_parts,
      (SELECT count(*) FROM physical_features)::int physical_features,
      (SELECT count(*) FROM registry_records)::int registry_records`)).rows[0];
    results.originalsUnchanged = retained.every(item => hash(readFileSync(folder + item.name)) === item.sha256);
    assert(results.originalsUnchanged);
  } catch (error: any) {
    results.failure = { message: error.message, code: error.code, stack: error.stack?.split('\n').slice(0, 8) };
    process.exitCode = 1;
  } finally {
    await stopHttp();
    closeStorageClient();
    server.closeIdleConnections();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await closePool();
    console.log(JSON.stringify({ task: 'AU3', results, calls, providers: 0, gpu: false }));
  }
}

main().catch(error => {
  console.log(JSON.stringify({ failure: error.message }));
  process.exitCode = 1;
});
