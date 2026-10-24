import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { closeStorageClient } from '../../../../packages/server/src/infrastructure/storage';

const python = 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const objects = new Map<string, Buffer>();
export const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function geometry(operation: string, data: unknown) {
  assert(['normalize', 'check', 'inspect-gis', 'profile'].includes(operation));
  const methods: Record<string, string> = {
    normalize: 'geo.area:normalize_area', check: 'geo.area:check_area',
    'inspect-gis': 'geo.gis_inspection:inspect_gis', profile: 'geo.officer:resolve_profile_request',
  };
  const [module, method] = methods[operation].split(':');
  const code = 'import sys,json;sys.path.insert(0,"services/geo");'
    + `from ${module} import ${method};print(json.dumps(${method}(json.load(sys.stdin))))`;
  const result = spawnSync(python, ['-B', '-c', code], { input: JSON.stringify(data), encoding: 'utf8',
    timeout: 60000, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' } });
  if (result.status !== 0) throw new Error(`Product Python ${operation} refused: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

async function serve(request: IncomingMessage, response: ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const value of request) chunks.push(Buffer.from(value));
  const bytes = Buffer.concat(chunks);
  const path = request.url!.split('?')[0];
  if (path.startsWith('/internal/area/')) {
    const result = geometry(path.split('/').at(-1)!, JSON.parse(bytes.toString()));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(result));
    return;
  }
  if (request.method === 'PUT') {
    assert(!objects.has(path), 'Retained bytes are immutable.');
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
  if (request.method === 'DELETE') {
    objects.delete(path);
    response.writeHead(204);
  } else response.writeHead(404);
  response.end();
}

const server = createServer((request, response) => {
  serve(request, response).catch(error => {
    response.writeHead(422, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ detail: error.message }));
  });
});

export async function startControls() {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}`;
  Object.assign(process.env, { S3_ENDPOINT: endpoint, S3_ACCESS_KEY: randomBytes(12).toString('hex'),
    S3_SECRET_KEY: randomBytes(24).toString('hex'), S3_BUCKET: 'lp1-memory-originals', GEO_URL: endpoint,
    GEO_SERVICE_TOKEN: randomBytes(24).toString('hex') });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.hostname, '127.0.0.1', 'Only loopback requests permitted.');
    return originalFetch(input, init);
  };
}

export async function stopControls() {
  closeStorageClient();
  server.closeIdleConnections();
  if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
}
