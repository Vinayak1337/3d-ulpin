import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createServer, request as httpRequest, type IncomingMessage } from 'node:http';
import type { Request, Response as ExpressResponse } from 'express';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { assertLocalRequest } from '@ulpin/server/modules/usp/principal';
import { setRuntimeLoopbackPort } from '@ulpin/server/infrastructure/loopback-host';
import { apiAllowedOrigins, assertLocalHttpRequest } from '../src/common/request-context';
import { readBoundedBytes } from '../src/common/body';
import { sendWebResponse } from '../src/common/response';

test('received bytes reject a chunked body without Content-Length', async () => {
  const stream = Readable.from([Buffer.from('abc'), Buffer.from('def')]) as IncomingMessage;
  stream.headers = {};
  await assert.rejects(readBoundedBytes(stream, 5), (error: unknown) =>
    error instanceof AppError && error.status === 413 && error.code === 'FILE_SIZE');
  stream.destroy();
});

test('oversized chunked request receives 413 and its connection closes', async () => {
  const server = createServer(async (request, response) => {
    try {
      await readBoundedBytes(request, 5);
      response.end('accepted');
    } catch {
      response.writeHead(413, { Connection: 'close' });
      response.end('too large');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const outcome = await new Promise<{ status: number; body: string; closed: boolean }>((resolve, reject) => {
      const client = httpRequest({ host: '127.0.0.1', port: address.port, method: 'POST', headers: {
        'Transfer-Encoding': 'chunked',
      } }, response => {
        const parts: Buffer[] = [];
        response.on('data', part => parts.push(Buffer.from(part)));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(parts).toString(),
          closed: response.headers.connection === 'close' }));
      });
      client.setTimeout(2000, () => client.destroy(new Error('Timed out waiting for 413.')));
      client.on('error', reject);
      client.write('abc');
      client.end('def');
    });
    assert.deepEqual(outcome, { status: 413, body: 'too large', closed: true });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('API and canonical guards accept the same bound port and reject unsafe origins', () => {
  const request = (host: string, origin?: string) => ({ headers: { host, origin } }) as Request;
  const approved = apiAllowedOrigins({ API_ALLOWED_ORIGINS: 'http://localhost:5173' });
  setRuntimeLoopbackPort(3188);
  try {
    assertLocalHttpRequest(request('127.0.0.1:3188', 'http://localhost:5173'), 3188, approved);
    assert.doesNotThrow(() => assertLocalRequest(new Request('http://127.0.0.1:3188/api/v1/health', {
      headers: { host: '127.0.0.1:3188', origin: 'http://localhost:5173' },
    })));
    assert.throws(() => assertLocalHttpRequest(request('example.com:3188'), 3188, approved),
      (error: unknown) => error instanceof AppError && error.code === 'HOST_DENIED');
    assert.throws(() => assertLocalHttpRequest(request('127.0.0.1:3188', 'http://evil.test:5173'), 3188, approved),
      (error: unknown) => error instanceof AppError && error.code === 'ORIGIN_DENIED');
    assert.throws(() => apiAllowedOrigins({ API_ALLOWED_ORIGINS: 'http://2130706433:5173' }));
  } finally {
    setRuntimeLoopbackPort(undefined);
  }
});

test('binary bridge retains explicit status and private download headers', async () => {
  class Sink extends EventEmitter {
    statusCode = 200;
    headers = new Map<string, string>();
    chunks: Buffer[] = [];
    ended = false;
    status(code: number) { this.statusCode = code; return this; }
    setHeader(name: string, value: string) { this.headers.set(name.toLowerCase(), value); return this; }
    hasHeader(name: string) { return this.headers.has(name.toLowerCase()); }
    write(value: Buffer) { this.chunks.push(value); return true; }
    end() { this.ended = true; return this; }
    destroy() { this.ended = true; return this; }
  }
  const sink = new Sink();
  const bytes = Uint8Array.from([0, 1, 255]);
  const web = new Response(bytes, { status: 206, headers: {
    'Content-Disposition': 'attachment; filename="original.bin"',
    'Cache-Control': 'private, max-age=60',
    'X-Content-SHA256': 'abc123',
  } });
  await sendWebResponse(sink as unknown as ExpressResponse, web);
  assert.equal(sink.statusCode, 206);
  assert.equal(sink.headers.get('content-disposition'), 'attachment; filename="original.bin"');
  assert.equal(sink.headers.get('cache-control'), 'private, max-age=60');
  assert.equal(sink.headers.get('x-content-sha256'), 'abc123');
  assert.deepEqual(Buffer.concat(sink.chunks), Buffer.from(bytes));
  assert.equal(sink.ended, true);
});
