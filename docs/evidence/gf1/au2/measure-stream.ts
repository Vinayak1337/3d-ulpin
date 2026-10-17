import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import { closePool, migrate, query } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { closeStorageClient, sha256 } from '../../../../packages/server/src/infrastructure/storage';
import { createSourceCase } from '../../../../packages/server/src/modules/cases/source-cases';
import { ManualIngestionService } from '../../../../packages/server/src/modules/usp/ingestion/service';
import { StreamingVectorService } from '../../../../packages/server/src/modules/usp/ingestion/streaming-vector';
import { runStreamingVectorJob } from '../../../../packages/server/src/modules/usp/ingestion/streaming-vector-worker';

const originalPath = 'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson';
const expectedHash = '107561166456f2c3aa4d6c6510c46e3b9a7c9eb91824762fbf7ba47b0d05ac8e';
const objects = new Map<string, Buffer>();

function assertOwned() {
  const nonce = process.env.ULPIN_AU2_NONCE;
  assert.match(nonce ?? '', /^[a-f0-9]{16}$/);
  const container = process.env.ULPIN_AU2_CONTAINER!;
  assert.equal(container, `ulpin-au2-tmp-${nonce}`);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, `/au2_${nonce}`);
  assert.equal(url.username, 'au2_control');
  assert.equal(url.password, '');
  for (const [key, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'AU2']]) {
    const actual = execFileSync('docker', ['inspect', '--format',
      `{{ index .Config.Labels "${key}" }}`, container], { encoding: 'utf8' }).trim();
    assert.equal(actual, value);
  }
}

function inspect(data: unknown) {
  const code = 'import sys,json;sys.path.insert(0,"services/geo");'
    + 'from geo.gis_inspection import inspect_gis;print(json.dumps(inspect_gis(json.load(sys.stdin))))';
  const result = spawnSync('E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe', ['-B', '-c', code], {
    input: JSON.stringify(data), encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (result.status !== 0) throw new Error(`Existing inspection refused: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

// CAR's memory-only object-store control: no production storage or transport performance claim.
async function serve(request: IncomingMessage, response: ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  const path = request.url!.split('?')[0];
  if (path === '/internal/area/inspect-gis') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(inspect(JSON.parse(bytes.toString()))));
    return;
  }
  if (request.method === 'PUT') {
    assert(!objects.has(path), 'Original is immutable.');
    objects.set(path, bytes);
    response.writeHead(200, { ETag: `"${sha256(bytes)}"` });
    response.end();
    return;
  }
  const original = objects.get(path);
  if (original && ['GET', 'HEAD'].includes(request.method!)) {
    response.writeHead(200, { 'Content-Length': original.length, ETag: `"${sha256(original)}"` });
    response.end(request.method === 'HEAD' ? undefined : original);
    return;
  }
  response.writeHead(404);
  response.end();
}

async function measure() {
  const bytes = readFileSync(originalPath);
  assert.equal(sha256(bytes), expectedHash);
  const { caseId } = await createSourceCase({ requestKey: randomUUID(), name: 'NYC test_only reader measurement' });
  const retained = await new ManualIngestionService().retain(caseId, {
    requestKey: randomUUID(), expectedWorkspaceRevision: 0, format: 'geojson',
  }, { name: 'buildings-original.geojson', bytes });
  const service = new StreamingVectorService();
  const queued = await service.enqueue(caseId, retained.source.sourceId, {
    requestKey: randomUUID(), expectedCaseRevision: retained.workspaceRevision,
    expectedSourceRevision: retained.source.sourceRevision, sourceSha256: retained.source.sourceSha256,
    framing: 'feature-collection',
  });
  const started = performance.now();
  await runStreamingVectorJob(queued.jobId);
  const seconds = (performance.now() - started) / 1000;
  const status = await service.status(caseId, retained.source.sourceId, queued.jobId);
  assert.equal(status.status, 'completed_with_rejections');
  assert.equal(status.records, 1662);
  const slots = (await query(`SELECT chunk_index,status,published,first_feature_index,last_feature_index,
    records,accepted,quarantined,bytes FROM usp_streaming_vector_slots WHERE job_id=$1 ORDER BY chunk_index`,
  [queued.jobId])).rows;
  const difficult = await service.chunk(caseId, retained.source.sourceId, queued.jobId, 13);
  const rejected = difficult.payload!.records.filter(record => record.disposition === 'quarantined');
  assert.equal(rejected[0].featureIndex, 1322);
  assert.equal(rejected[0].issueCode, 'SELF_INTERSECTION');
  assert.equal(sha256(readFileSync(originalPath)), expectedHash);
  return { originalPath, sha256: expectedHash, bytes: bytes.length, entryPoint: 'runStreamingVectorJob',
    transport: 'CAR memory-only S3 HTTP control; real PostgreSQL/PostGIS; product topology check',
    seconds: Number(seconds.toFixed(3)), featuresPerSecond: Math.round(status.records / seconds),
    parts: slots.length, records: status.records, accepted: status.accepted, quarantined: status.quarantined,
    slots, rejected, packages: Number((await query('SELECT count(*)::int n FROM import_packages')).rows[0].n),
    mappedSlots: Number((await query('SELECT count(*)::int n FROM usp_chunk_mapping_slots')).rows[0].n),
    unknownRemainder: status.unknownRemainder, originalUnchanged: true };
}

async function main() {
  assertOwned();
  const server = createServer((request, response) => {
    serve(request, response).catch(error => {
      response.writeHead(422, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ detail: error.message }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}`;
  process.env.S3_ENDPOINT = endpoint;
  process.env.S3_ACCESS_KEY = randomBytes(12).toString('hex');
  process.env.S3_SECRET_KEY = randomBytes(24).toString('hex');
  process.env.S3_BUCKET = 'au2-memory-originals';
  process.env.GEO_URL = endpoint;
  process.env.GEO_SERVICE_TOKEN = randomBytes(24).toString('hex');
  try {
    await query(sql('bootstrap.postgis'));
    await migrate();
    console.log(JSON.stringify(await measure()));
  } finally {
    closeStorageClient();
    await closePool();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
