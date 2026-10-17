import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { closeStorageClient } from '../../../../packages/server/src/infrastructure/storage';

// Same immutable in-memory object store and product Python boundary as KN2; no domain state is scaffolded.
const objects = new Map<string, Buffer>();
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const python = 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const server = createServer((request, response) => {
  serve(request, response).catch(error => {
    response.writeHead(422, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ detail: error.message }));
  });
});

export function assertOwnBox() {
  const nonce = process.env.ULPIN_LQ1B_NONCE;
  assert.match(nonce ?? '', /^[a-f0-9]{16}$/);
  const container = process.env.ULPIN_LQ1B_CONTAINER!;
  assert.equal(container, `ulpin-lq1b-tmp-${nonce}`);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'lq1b_control');
  assert.equal(url.password, '');
  assert.equal(url.pathname, `/lq1b_${nonce}`);
  assert.equal(process.env.ULPIN_MODEL_GATEWAY_ENABLED, '0');
  for (const [key, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'LQ1B']])
    assert.equal(execFileSync('docker', ['inspect', '--format',
      `{{ index .Config.Labels "${key}" }}`, container], { encoding: 'utf8' }).trim(), value);
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

export async function startSandbox() {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}`;
  process.env.S3_ENDPOINT = endpoint;
  process.env.S3_ACCESS_KEY = randomBytes(12).toString('hex');
  process.env.S3_SECRET_KEY = randomBytes(24).toString('hex');
  process.env.S3_BUCKET = 'lq1b-memory-originals';
  process.env.GEO_URL = endpoint;
  process.env.GEO_SERVICE_TOKEN = randomBytes(24).toString('hex');
  const fetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.hostname, '127.0.0.1', 'Non-loopback fetch is forbidden.');
    return fetch(input, init);
  };
}

export async function stopSandbox() {
  closeStorageClient();
  server.closeIdleConnections();
  if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
}
