import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { closeStorageClient, sha256 } from '../../../../packages/server/src/infrastructure/storage';

// Transport control only: no source, package, reader, mapping or job row is injected.
// Geometry runs the product's own services/geo Python; the box has no geo container.
const python = 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const objects = new Map<string, { bytes: Buffer; metadata: Record<string, string> }>();
let server: ReturnType<typeof createServer>;

function decodedBody(request: IncomingMessage, bytes: Buffer): Buffer {
  if (!String(request.headers['content-encoding']).includes('aws-chunked')) return bytes;
  const chunks: Buffer[] = [];
  let position = 0;
  while (position < bytes.length) {
    const edge = bytes.indexOf('\r\n', position);
    assert(edge >= position, 'An AWS transport chunk needs its length line.');
    const size = Number.parseInt(bytes.subarray(position, edge).toString().split(';')[0], 16);
    assert(Number.isSafeInteger(size) && size >= 0);
    if (size === 0) break;
    position = edge + 2;
    assert(position + size + 2 <= bytes.length);
    chunks.push(bytes.subarray(position, position + size));
    position += size + 2;
  }
  const decoded = Buffer.concat(chunks);
  assert.equal(decoded.length, Number(request.headers['x-amz-decoded-content-length']));
  return decoded;
}

function put(request: IncomingMessage, response: ServerResponse, path: string, bytes: Buffer) {
  if (request.headers['if-none-match'] === '*' && objects.has(path)) {
    response.writeHead(412, { 'Content-Type': 'application/xml' });
    response.end('<Error><Code>PreconditionFailed</Code></Error>');
    return;
  }
  const metadata = Object.fromEntries(Object.entries(request.headers)
    .filter(([name]) => name.startsWith('x-amz-meta-')).map(([name, value]) => [name, String(value)]));
  const decoded = decodedBody(request, bytes);
  if (objects.has(path)) assert(metadata['x-amz-meta-upload-tombstone'] && decoded.length === 0);
  objects.set(path, { bytes: decoded, metadata });
  response.writeHead(200, { ETag: `"${sha256(decoded)}"` });
  response.end();
}

function get(request: IncomingMessage, response: ServerResponse, path: string) {
  const object = objects.get(path);
  if (!object) {
    response.writeHead(404);
    response.end();
    return;
  }
  const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
  const bytes = object.bytes;
  const body = range ? bytes.subarray(Number(range[1]), Number(range[2]) + 1) : bytes;
  response.writeHead(range ? 206 : 200, { ...object.metadata, 'Content-Length': body.length,
    ETag: `"${sha256(bytes)}"`, ...(range
      ? { 'Content-Range': `bytes ${range[1]}-${Number(range[1]) + body.length - 1}/${bytes.length}` } : {}) });
  response.end(request.method === 'HEAD' ? undefined : body);
}

const geometryCalls: Record<string, number> = {};
class Refusal extends Error {}

// The product's own routes (services/geo/geo/api.py), and its refusal: a 422 carrying the error's text.
const operations: Record<string, [string, string]> = { 'inspect-gis': ['geo.gis_inspection', 'inspect_gis'],
  normalize: ['geo.area', 'normalize_area'], check: ['geo.area', 'check_area'],
  'resolve-geojson-crs': ['geo.area', 'resolve_geojson_crs'] };
const refused = 3;

function geometry(operation: string, data: Buffer): Promise<string> {
  assert(Object.hasOwn(operations, operation), `Unexpected geo operation ${operation}.`);
  geometryCalls[operation] = (geometryCalls[operation] ?? 0) + 1;
  const [module, method] = operations[operation];
  const code = 'import sys,json;sys.path.insert(0,"services/geo");from geo.validation import InputError;'
    + `from ${module} import ${method}\ntry:print(json.dumps(${method}(json.load(sys.stdin))))\n`
    + `except (InputError,KeyError,TypeError,ValueError) as error:print(error);sys.exit(${refused})`;
  const child = spawn(python, ['-B', '-c', code], { windowsHide: true,
    env: { ...process.env, PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' } });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  child.stdout.on('data', value => out.push(value));
  child.stderr.on('data', value => err.push(value));
  child.stdin.end(data);
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', status => status === 0 ? resolve(Buffer.concat(out).toString())
      : reject(status === refused ? new Refusal(Buffer.concat(out).toString().trim())
        : new Error(`Product Python ${operation} failed: ${Buffer.concat(err).toString().trim()}`)));
  });
}

async function geo(response: ServerResponse, operation: string, bytes: Buffer) {
  try {
    const body = await geometry(operation, bytes);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(body);
  } catch (error: any) {
    response.writeHead(error instanceof Refusal ? 422 : 500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ detail: error.message }));
  }
}

async function serve(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url!, 'http://127.0.0.1');
  if (request.method === 'GET' && url.searchParams.has('versioning')) {
    response.writeHead(200, { 'Content-Type': 'application/xml' });
    response.end('<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>');
    return;
  }
  const chunks: Buffer[] = [];
  for await (const value of request) chunks.push(Buffer.from(value));
  if (url.pathname.startsWith('/internal/area/')) {
    assert.equal(request.headers.authorization, `Bearer ${process.env.GEO_SERVICE_TOKEN}`);
    await geo(response, url.pathname.split('/').at(-1)!, Buffer.concat(chunks));
  } else if (request.method === 'PUT') put(request, response, url.pathname, Buffer.concat(chunks));
  else get(request, response, url.pathname);
}

export async function startStorage() {
  server = createServer((request, response) => {
    serve(request, response).catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  process.env.S3_ENDPOINT = `http://127.0.0.1:${address.port}`;
  process.env.S3_ACCESS_KEY = randomBytes(12).toString('hex');
  process.env.S3_SECRET_KEY = randomBytes(24).toString('hex');
  process.env.S3_BUCKET = 'st1c-memory-originals';
  process.env.GEO_URL = process.env.S3_ENDPOINT;
  process.env.GEO_SERVICE_TOKEN = randomBytes(24).toString('hex');
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.hostname, '127.0.0.1', 'Non-loopback HTTP is forbidden.');
    return nativeFetch(input, init);
  };
}

export async function stopStorage() {
  closeStorageClient();
  if (!server) return;
  server.closeIdleConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

export function geometryCallCounts() {
  return { ...geometryCalls };
}

export function originalStored(sourceId: string, hash: string, bytes: number) {
  const object = objects.get(`/st1c-memory-originals/large-originals/${sourceId}/${hash}`);
  return !!object && object.bytes.length === bytes && sha256(object.bytes) === hash;
}

/** The reader's set-aside records by the code each record carries in its chunk object (the slot rows keep none). */
export function setAsideCodes(rawJobId: string) {
  const counts: Record<string, number> = {};
  for (const [path, object] of objects) {
    if (!path.startsWith(`/st1c-memory-originals/streaming-vectors/${rawJobId}/`)) continue;
    for (const record of JSON.parse(object.bytes.toString()).records) {
      if (record.disposition !== 'quarantined') continue;
      counts[record.issueCode] = (counts[record.issueCode] ?? 0) + 1;
    }
  }
  return Object.entries(counts).map(([code, records]) => ({ code, records }));
}
