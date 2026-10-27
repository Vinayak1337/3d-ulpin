import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { closeStorageClient, sha256 } from '../../../../packages/server/src/infrastructure/storage';

// Transport control only: no source, package, reader, mapping or job row is injected.
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

async function serve(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url!, 'http://127.0.0.1');
  if (request.method === 'GET' && url.searchParams.has('versioning')) {
    response.writeHead(200, { 'Content-Type': 'application/xml' });
    response.end('<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>');
    return;
  }
  const chunks: Buffer[] = [];
  for await (const value of request) chunks.push(Buffer.from(value));
  if (request.method === 'PUT') put(request, response, url.pathname, Buffer.concat(chunks));
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
  process.env.S3_BUCKET = 'lp3b-memory-originals';
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

export function originalStored(sourceId: string, hash: string, bytes: number) {
  const object = objects.get(`/lp3b-memory-originals/large-originals/${sourceId}/${hash}`);
  return !!object && object.bytes.length === bytes && sha256(object.bytes) === hash;
}
