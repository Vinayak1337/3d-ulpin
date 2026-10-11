import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { ImportPackagesController } from '../../../../apps/api/src/modules/intake/import-packages.controller';
import { AreaSourcesController } from '../../../../apps/api/src/modules/intake/area-sources.controller';
import { ApiExceptionFilter } from '../../../../apps/api/src/common/api-exception.filter';
import { importPackage, areaContext } from '../../../../apps/api/src/modules/intake/wire-schemas';
import { closePool, migrate, query } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { closeStorageClient, readObject } from '../../../../packages/server/src/infrastructure/storage';
import { AreaIntakeService } from '../../../../packages/server/src/modules/areas/area-intake-service';
import type { ImportPackage, AreaContext } from '../../../../packages/contracts/src';

const requireApi = createRequire(new URL('../../../../apps/api/package.json', import.meta.url));
requireApi('reflect-metadata');
const { Module } = requireApi('@nestjs/common');
const { NestFactory } = requireApi('@nestjs/core');

const path = 'E:/BhuAayam-data/datasets/map-formats/niagara-falls/'
  + 'Niagara_Falls_Condominiums_7254610803234545967.geojson';
const originalHash = 'dece86e3bc85a2529fbca07cf31e4c0f4e74275ed10b9989684f18191f2e002c';
const objects = new Map<string, Buffer>();
const steps: unknown[] = [];
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
let normalized: any;

function ownedBox() {
  const nonce = process.env.ULPIN_CR1_NONCE!;
  assert.match(nonce, /^[a-f0-9]{16}$/);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'cr1_control');
  assert.equal(url.pathname, `/cr1_${nonce}`);
  assert.equal(url.password, '');
  for (const [kind, container] of [['db', process.env.ULPIN_CR1_DB!], ['geo', process.env.ULPIN_CR1_GEO!]]) {
    assert.equal(container, `ulpin-cr1-${kind}-${nonce}`);
    for (const [key, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'CR1']]) {
      assert.equal(execFileSync('docker', ['inspect', '--format',
        `{{ index .Config.Labels "${key}" }}`, container], { encoding: 'utf8' }).trim(), value);
    }
  }
}

async function store(request: IncomingMessage, response: ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const value of request) chunks.push(Buffer.from(value));
  const bytes = Buffer.concat(chunks);
  const key = request.url!.split('?')[0];
  if (request.method === 'PUT') {
    assert(!objects.has(key), 'Original bytes are immutable.');
    objects.set(key, bytes);
    response.writeHead(200, { ETag: `"${hash(bytes)}"` });
    response.end();
  } else if (['GET', 'HEAD'].includes(request.method!) && objects.has(key)) {
    const object = objects.get(key)!;
    response.writeHead(200, { 'Content-Length': object.length, ETag: `"${hash(object)}"` });
    response.end(request.method === 'HEAD' ? undefined : object);
  } else {
    response.writeHead(404);
    response.end();
  }
}

async function standInStore() {
  const server = createServer((request, response) => { void store(request, response); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  process.env.S3_ENDPOINT = `http://127.0.0.1:${address.port}`;
  process.env.S3_ACCESS_KEY = randomBytes(12).toString('hex');
  process.env.S3_SECRET_KEY = randomBytes(24).toString('hex');
  process.env.S3_BUCKET = 'cr1-memory-originals';
  return server;
}

function localFetch() {
  const fetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.hostname, '127.0.0.1', 'No external HTTP requests from the runtime.');
    const response = await fetch(input, init);
    if (url.pathname === '/internal/area/normalize' && response.ok) normalized = await response.clone().json();
    return response;
  };
}

async function api<T>(endpoint: string, route: string, init?: RequestInit): Promise<T> {
  const response = await fetch(endpoint + route, init);
  const body = await response.json();
  steps.push({ route, method: init?.method ?? 'GET', status: response.status });
  if (!response.ok) throw Object.assign(new Error(body.message ?? body.detail), { code: body.code });
  return body as T;
}

async function walk(endpoint: string) {
  const bytes = readFileSync(path);
  assert.equal(hash(bytes), originalHash);
  const source = JSON.parse(bytes.toString('utf8'));
  const form = new FormData();
  form.set('file', new File([bytes], path.split('/').at(-1)!, { type: 'application/geo+json' }));
  form.set('format', 'geojson');
  form.set('namespace', 'CR1-Niagara-test-only');
  form.set('name', 'Niagara condominium parcels test_only');
  form.set('mapping', JSON.stringify({ kind: 'parcel', idField: 'OBJECTID' }));
  const pkg = await api<ImportPackage>(endpoint, '/import-packages', { method: 'POST', body: form });
  importPackage.parse(pkg);
  const post = (input: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input) });
  const reviewed = await api<ImportPackage>(endpoint, `/import-packages/${pkg.id}/review`,
    post({ expectedRevision: pkg.revision }));
  importPackage.parse(reviewed);
  const committed = await api<ImportPackage>(endpoint, `/import-packages/${pkg.id}/commit`,
    post({ expectedRevision: reviewed.revision,
      acknowledgement: 'Test-only publisher condominium parcels; geometry, measurements and rights unassessed.' }));
  importPackage.parse(committed);
  assert.equal(committed.state, 'COMMITTED');
  const context = await api<AreaContext>(endpoint, `/areas/${pkg.areaId}/context`);
  areaContext.parse(context);
  return evidence(pkg, context, source, bytes);
}

async function evidence(pkg: ImportPackage, context: AreaContext, source: any, bytes: Buffer) {
  assert.equal(context.features.length, 155);
  assert(context.features.every(feature => feature.kind === 'parcel' && feature.revision === 1));
  assert.deepEqual(context.area.reference, normalized.reference);
  assert.deepEqual(context.area.geographicExtent, normalized.geographicExtent);
  const stored = (await query('SELECT body FROM import_packages WHERE id=$1', [pkg.id])).rows[0].body;
  assert.deepEqual(stored.warnings, normalized.warnings);
  const original = (await query('SELECT sha256,object_key FROM sources WHERE id=$1',
    [pkg.sourceRevisionIds[0]])).rows[0];
  const retained = await readObject(original.object_key);
  assert.deepEqual(Buffer.from(retained), bytes);
  assert.equal(original.sha256, originalHash);
  assert.equal(hash(readFileSync(path)), originalHash);
  const multipart = unchangedGeometry(context, source);
  const count = (await query(`SELECT count(*)::int n FROM physical_features
    WHERE area_id=$1 AND body->>'kind'='parcel' AND revision>0`, [pkg.areaId])).rows[0].n;
  const registry = (await query(`SELECT count(*)::int n FROM registry_records r
    JOIN physical_features f ON f.record_id=r.id WHERE f.area_id=$1 AND r.revision>0`, [pkg.areaId])).rows[0].n;
  assert.equal(count, 155);
  return { state: stored.state, recordedParcels: count, issuedRegistryRecords: registry,
    recordMeaning: 'Reviewed physical parcel records, not issued building/unit registry records.',
    reference: context.area.reference,
    geometryFrame: 'Stored local geometry equals the normalizer output in the area reference; '
      + 'geographic geometry is separate.',
    sourceCrs: context.area.reference!.sourceCrs, warnings: stored.warnings,
    geographicExtent: context.area.geographicExtent, original: { bytes: bytes.length, sha256: hash(retained),
      bytesIdentical: true, externalOriginalUnchanged: true }, multipart, disposition: normalized.disposition,
    choices: 'Harness chooses kind parcel and identifier OBJECTID; integer identifiers are read as their digits.',
    cards: 'Not attempted: parcels have records, not building/unit property cards.' };
}

function unchangedGeometry(context: AreaContext, source: any) {
  for (const feature of context.features) {
    const candidate = normalized.features.find((item: any) => item.sourceKey === feature.sourceKey);
    assert.deepEqual(feature.geometry, candidate.geometry);
    assert.deepEqual(feature.geographicGeometry, candidate.geographicGeometry);
    assert.deepEqual(feature.sourceGeometry, candidate.sourceGeometry);
  }
  return source.features.filter((row: any) => row.geometry.type === 'MultiPolygon').map((row: any) => {
    const feature = context.features.find(item => item.sourceKey === String(row.properties.OBJECTID))!;
    assert.equal(feature.geometry.type, 'MultiPolygon');
    assert.equal(feature.geographicGeometry.type, 'MultiPolygon');
    return { sourceKey: feature.sourceKey, sourceParts: row.geometry.coordinates.length,
      localParts: (feature.geometry.coordinates as unknown[]).length,
      geographicParts: (feature.geographicGeometry.coordinates as unknown[]).length };
  });
}

async function main() {
  ownedBox();
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  let storeServer: Awaited<ReturnType<typeof standInStore>> | undefined;
  let result: unknown;
  try {
    await query(sql('bootstrap.postgis'));
    await migrate();
    storeServer = await standInStore();
    localFetch();
    class RuntimeModule {}
    Module({ controllers: [ImportPackagesController, AreaSourcesController],
      providers: [AreaIntakeService] })(RuntimeModule);
    app = await NestFactory.create(RuntimeModule, { logger: false, bodyParser: false, abortOnError: false });
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0, '127.0.0.1');
    result = await walk((await app.getUrl()) + '/api/v1');
  } catch (error: any) {
    result = { failed: true, code: error.code, message: error.message, stack: error.stack?.split('\n').slice(0, 8) };
    process.exitCode = 1;
  } finally {
    if (app) await app.close();
    closeStorageClient();
    if (storeServer) {
      storeServer.closeIdleConnections();
      await new Promise<void>(resolve => storeServer!.close(() => resolve()));
    }
    await closePool();
    console.log(JSON.stringify({ task: 'CR1', steps, result, providers: 0,
      storage: 'Nonce-scoped in-memory S3 HTTP stand-in as in CB1; no production object-store qualification.' }));
  }
}

void main();
