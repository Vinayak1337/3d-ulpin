import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import { closePool, migrate, query } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { closeStorageClient } from '../../../../packages/server/src/infrastructure/storage';
import { ingestArea, reviewPackage, commitPackage }
  from '../../../../packages/server/src/modules/areas/areas';
import { captureRegistrySnapshot, resolveRegistryTarget }
  from '../../../../packages/server/src/modules/usp/snapshots';
import { localRequestContext } from '../../../../packages/server/src/modules/usp/principal';
import { createPacketPlan, confirmPacketPlan, executePacketPlan }
  from '../../../../packages/server/src/modules/usp/packets/plan-service';
import { generatePropertyCard } from '../../../../packages/server/src/modules/usp/packets/card-service';
import { verifyPropertyCard } from '../../../../packages/server/src/modules/usp/packets/card-verification';
import { createPacket0, readExactPart, readPacket0 } from '../../../../packages/server/src/modules/usp/packet0';
import { featurePropertiesExtract } from '../../../../packages/server/src/modules/usp/packets/feature-extract';
import type { ImportPackage } from '../../../../packages/contracts/src';
import type { RequestContext } from '../../../../packages/contracts/src/usp';
import { isPdfPlan } from '../../../../packages/server/src/modules/usp/packets/plan-store';
import { compareNycPostgres } from './nyc-postgres-equivalence';

const inputs = [{ root: 'E:/BhuAayam-data/datasets/nyc-10013/files/', format: 'geojson' as const,
  name: 'buildings-original.geojson', idField: 'doitt_id',
  sha256: '107561166456f2c3aa4d6c6510c46e3b9a7c9eb91824762fbf7ba47b0d05ac8e' }];
const python = 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const objects = new Map<string, Buffer>();
const steps: unknown[] = [];
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
let server: Server;

function ownedBox() {
  const nonce = process.env.ULPIN_LP2_NONCE!;
  const container = process.env.ULPIN_LP2_CONTAINER!;
  assert.match(nonce, /^[a-f0-9]{16}$/);
  assert.equal(container, `ulpin-lp2-tmp-${nonce}`);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'lp2_control');
  assert.equal(url.pathname, `/lp2_${nonce}`);
  assert.equal(url.password, '');
  assert.equal(process.env.ULPIN_MODEL_GATEWAY_ENABLED, '0');
  for (const [key, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'LP2']]) {
    assert.equal(execFileSync('docker', ['inspect', '--format',
      `{{ index .Config.Labels "${key}" }}`, container], { encoding: 'utf8' }).trim(), value);
  }
}

function geometry(operation: string, data: unknown) {
  const methods: Record<string, string> = { normalize: 'normalize_area', check: 'check_area' };
  assert(methods[operation]);
  const code = 'import sys,json;sys.path.insert(0,"services/geo");'
    + `from geo.area import ${methods[operation]};print(json.dumps(${methods[operation]}(json.load(sys.stdin))))`;
  const result = spawnSync(python, ['-B', '-c', code], { input: JSON.stringify(data), encoding: 'utf8',
    timeout: 60000, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' } });
  if (result.status !== 0) throw new Error(result.stderr.trim());
  return JSON.parse(result.stdout);
}

async function serve(request: IncomingMessage, response: ServerResponse) {
  try {
    const chunks: Buffer[] = [];
    for await (const value of request) chunks.push(Buffer.from(value));
    const bytes = Buffer.concat(chunks);
    const path = request.url!.split('?')[0];
    if (path.startsWith('/internal/area/')) {
      const result = geometry(path.split('/').at(-1)!, JSON.parse(bytes.toString()));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(result));
    } else if (request.method === 'PUT') {
      assert(!objects.has(path), 'Original map is immutable.');
      objects.set(path, bytes);
      response.writeHead(200, { ETag: `"${hash(bytes)}"` });
      response.end();
    } else if (request.method === 'GET' && objects.has(path)) {
      const object = objects.get(path)!;
      const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
      if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]) + 1;
        assert(start >= 0 && end <= object.length);
        response.writeHead(206, { 'Content-Length': end - start,
          'Content-Range': `bytes ${start}-${end - 1}/${object.length}` });
        response.end(object.subarray(start, end));
      } else {
        response.writeHead(200, { 'Content-Length': object.length, ETag: `"${hash(object)}"` });
        response.end(object);
      }
    } else if (request.method === 'HEAD' && objects.has(path)) {
      response.writeHead(200, { 'Content-Length': objects.get(path)!.length,
        ETag: `"${hash(objects.get(path)!)}"` });
      response.end();
    } else {
      response.writeHead(404);
      response.end();
    }
  } catch (error: any) {
    response.writeHead(422, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ detail: error.message }));
  }
}

async function standIns() {
  server = createServer((request, response) => { void serve(request, response); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}`;
  process.env.S3_ENDPOINT = endpoint;
  process.env.S3_ACCESS_KEY = randomBytes(12).toString('hex');
  process.env.S3_SECRET_KEY = randomBytes(24).toString('hex');
  process.env.S3_BUCKET = 'lp2-memory-originals';
  process.env.GEO_URL = endpoint;
  process.env.GEO_SERVICE_TOKEN = randomBytes(24).toString('hex');
  const fetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.hostname, '127.0.0.1');
    return fetch(input, init);
  };
}

async function measured<T>(format: string, step: string, work: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    const value = await work();
    steps.push({ format, step, state: 'passed', ms: Math.round(performance.now() - start) });
    return value;
  } catch (error: any) {
    steps.push({ format, step, state: 'refused', code: error.code, status: error.status,
      message: error.message, stack: error.stack?.split('\n').slice(0, 8),
      ms: Math.round(performance.now() - start) });
    throw error;
  }
}

async function recordedFeature(feature: { id: string; sourceRevisionId: string; sourceKey: string }) {
  const row = (await query(`SELECT r.id,r.revision,r.body FROM registry_records r
    JOIN physical_features f ON f.record_id=r.id WHERE f.id=$1`, [feature.id])).rows[0];
  assert.equal(row.revision, 1);
  assert.deepEqual(row.body.evidence,
    [{ sourceId: feature.sourceRevisionId, locator: `feature ${feature.sourceKey}` }]);
  return row;
}

async function executeAndCard(ctx: RequestContext, plan: Awaited<ReturnType<typeof createPacketPlan>>, format: string) {
  assert(!isPdfPlan(plan));
  const confirmation = await measured(format, 'confirm', () => confirmPacketPlan(ctx, {
    planId: plan.planId, version: plan.version, planSha256: plan.planSha256, reviewed: true,
    guard: { mode: 'update', requestKey: randomUUID(), expectedVersion: plan.version,
      expectedManifestId: plan.input.scope.manifestId },
  }));
  const execution = await measured(format, 'execute', () => executePacketPlan(ctx, {
    planId: plan.planId, version: plan.version, confirmationId: confirmation.confirmationId,
    guard: { mode: 'create', requestKey: randomUUID() },
  }));
  assert.equal(execution.packet.status, 'complete');
  const packet = await readPacket0(ctx, execution.packet.packetId);
  const card = await measured(format, 'card', () => generatePropertyCard(ctx, {
    planId: plan.planId, planVersion: plan.version, cardId: null,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    guard: { mode: 'create', requestKey: randomUUID() },
  }));
  const { report } = await measured(format, 'verification', () => verifyPropertyCard(ctx, {
    cardId: card.cardId, revision: 1,
  }));
  assert.equal(report.result, 'consistent');
  const nycByteComparison = format === 'geojson' ? await measured(format, 'legacy byte comparison',
    () => compareNycPostgres(ctx, plan, card, packet.bytes)) : undefined;
  return { ...(nycByteComparison ? { nycByteComparison } : {}),
    citation: card.facts.find(fact => fact.key === 'source_citation')?.value,
    packetSha256: hash(packet.bytes), verification: report.result,
    geometry: card.facts.find(fact => fact.key === 'geometry')?.state,
    measurements: card.facts.find(fact => fact.key === 'measurements')?.state,
    rights: card.facts.find(fact => fact.key === 'rights')?.state };
}

async function takeToCard(ctx: RequestContext, pkg: ImportPackage, feature: ImportPackage['features'][number],
  bytes: Buffer) {
  const record = await measured('geojson', 'record', () => recordedFeature(feature));
  const pin = { ref: { namespace: 'registry_record' as const, id: record.id }, revision: 1 };
  const snapshot = await measured('geojson', 'snapshot', () =>
    captureRegistrySnapshot(ctx, pkg.areaId, { kind: 'targets', pins: [pin] }));
  const resolved = await resolveRegistryTarget(ctx, snapshot.scope, pin);
  assert(resolved.state === 'available');
  const plan = await measured('geojson', 'range plan', () => createPacketPlan(ctx, { input: {
    target: pin, scope: snapshot.scope, purpose: 'record_evidence', format: 'text',
    recipe: 'pack0-exact-text-csv/1', expiresAt: new Date(Date.now() + 3600000).toISOString(),
    entries: [{ pointer: resolved.data.evidence[0], required: true,
      inclusionReason: 'Officer-reviewed publisher exterior', review: { kind: 'direct', reviewed: true } }],
  }, guard: { mode: 'create', requestKey: randomUUID() } }));
  assert.equal(plan.entries[0].state, 'included');
  const excerpt = await readExactPart(ctx, snapshot.scope, resolved.data.evidence[0]);
  assert.equal(excerpt.state, 'available');
  if (excerpt.state === 'available')
    assert.equal(excerpt.data.text, featurePropertiesExtract(bytes, feature.sourceFeatureIndex!));
  const card = await executeAndCard(ctx, plan, 'geojson');
  const direct = await measured('geojson', 'direct packet', () => createPacket0(ctx, {
    target: pin, scope: snapshot.scope, format: 'text', evidence: [resolved.data.evidence[0]],
    guard: { mode: 'create', requestKey: randomUUID() },
  }));
  const directBytes = await readPacket0(ctx, direct.packetId);
  assert.equal(hash(directBytes.bytes), card.packetSha256);
  return { key: feature.sourceKey, index: feature.sourceFeatureIndex, range: feature.sourceReference!.sourceRange,
    planSha256: plan.planSha256, directPacketIdentical: true, ...card };
}

async function walk(input: typeof inputs[number]) {
  const bytes = readFileSync(input.root + input.name);
  assert.equal(hash(bytes), input.sha256);
  const pkg = await measured(input.format, 'import', () => ingestArea({ bytes, filename: input.name,
    format: input.format, namespace: 'LP2-geojson', name: 'NYC buildings test_only',
    mapping: { kind: 'building', idField: input.idField } }));
  assert.equal(pkg.features.length, 1661);
  assert(pkg.features.every(feature => feature.sourceReference?.sourceRange));
  const reviewed = await measured(input.format, 'review', () => reviewPackage(pkg.id, pkg.revision));
  const committed = await measured(input.format, 'commit', () => commitPackage(reviewed.id, reviewed.revision,
    'Test-only publisher exteriors; geometry, measurements and rights unassessed.'));
  assert.equal(committed.state, 'COMMITTED');
  const ctx = localRequestContext(randomUUID());
  const results = [];
  for (const index of [0, 1620, 1661]) {
    const feature = pkg.features.find(item => item.sourceFeatureIndex === index)!;
    assert(feature);
    results.push(await takeToCard(ctx, pkg, feature, bytes));
  }
  const original = JSON.parse(bytes.toString());
  const reordered = Buffer.from(JSON.stringify({ features: original.features, type: original.type,
    ...(original.crs ? { crs: original.crs } : {}) }));
  const fallback = await measured('geojson', 'unframed import fallback', () => ingestArea({ bytes: reordered,
    filename: 'nyc-ordering-control.geojson', format: 'geojson', namespace: 'LP2-ordering-control',
    name: 'NYC field-order syntax control test_only', mapping: { kind: 'building', idField: input.idField } }));
  assert.equal(fallback.features.length, 1661);
  assert(fallback.features.every(feature => feature.sourceReference?.sourceRange === undefined));
  return { features: pkg.features.length, quarantine: 1, rangeAndWholeCards: results,
    unframedImport: { features: fallback.features.length, sourceRanges: 0,
      qualification: 'In-memory field-order syntax control from real NYC facts; not a publisher original' } };
}

async function main() {
  ownedBox();
  const results: unknown[] = [];
  try {
    await query(sql('bootstrap.postgis'));
    await migrate();
    await standIns();
    for (const input of inputs) {
      try {
        results.push(await walk(input));
      } catch (error: any) {
        results.push({ format: input.format, refused: error.code, message: error.message });
        process.exitCode = 1;
      }
      assert.equal(hash(readFileSync(input.root + input.name)), input.sha256);
    }
  } finally {
    closeStorageClient();
    if (server) {
      server.closeIdleConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    await closePool();
    console.log(JSON.stringify({ task: 'LP2', steps, results, providers: 0, originalsUnchanged: true,
      objectStore: 'CAR-pattern loopback in-memory S3 protocol control; real range responses, not MinIO throughput' }));
  }
}

main().catch(error => {
  console.log(JSON.stringify({ failed: true, code: error.code, message: error.message }));
  process.exitCode = 1;
});
