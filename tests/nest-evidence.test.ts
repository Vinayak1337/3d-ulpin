import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { Request } from 'express';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { readUspBody, USP_JSON_LIMIT } from '../apps/api/src/modules/evidence/evidence.http';
import { evidenceSchemas } from '../apps/api/src/modules/evidence/evidence.schemas';

function bodyStream(bytes: Buffer): Request {
  const stream = Readable.from([bytes]) as unknown as Request;
  stream.headers = {};
  return stream;
}

test('USP transport rejects an oversized chunked body before JSON parsing', async () => {
  const request = bodyStream(Buffer.alloc(USP_JSON_LIMIT + 1, 32));
  await assert.rejects(readUspBody(request, evidenceSchemas.snapshots.request),
    (error: unknown) => error instanceof AppError && error.status === 413 && error.code === 'USP_BODY_LIMIT');
  request.destroy();
});

test('USP transport distinguishes missing and malformed JSON', async () => {
  await assert.rejects(readUspBody(bodyStream(Buffer.alloc(0)), evidenceSchemas.snapshots.request),
    (error: unknown) => error instanceof AppError && error.code === 'USP_BODY_REQUIRED');
  await assert.rejects(readUspBody(bodyStream(Buffer.from('{')), evidenceSchemas.snapshots.request),
    (error: unknown) => error instanceof AppError && error.code === 'USP_INVALID_JSON');
});
