import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import test from 'node:test';
import type { Request } from 'express';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { readUspBody, USP_JSON_LIMIT } from '../apps/api/src/modules/evidence/evidence.http';
import { evidenceSchemas } from '../apps/api/src/modules/evidence/evidence.schemas';
import { localOperatorSubject, localRequestContext } from '@ulpin/server/modules/usp/principal';
import { assertLocalUsp } from '@ulpin/server/modules/usp/snapshots';

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

function withSubject<T>(subject: string | undefined, run: () => T): T {
  const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  if (subject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = subject;
  try { return run(); }
  finally {
    if (previous === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous;
  }
}

const processSubject = `local-os-uid/${process.getuid ? process.getuid() : userInfo().username}`;
const configurationError = (error: unknown) => error instanceof AppError
  && error.status === 503 && error.code === 'LOCAL_OPERATOR_CONFIGURATION'
  && error.message.includes('ULPIN_LOCAL_OPERATOR_SUBJECT');

test('local context uses configured OS process provenance and preserves the local wire mode', () => {
  withSubject(processSubject, () => {
    const id = randomUUID(), context = localRequestContext(id);
    assert.equal(localOperatorSubject(), processSubject);
    assert.equal(context.requestId, id);
    assert.equal(context.principal.subject, processSubject);
    assert.equal(context.principal.mode, 'local_demo');
    assert.doesNotThrow(() => assertLocalUsp(context));
    assert.throws(() => assertLocalUsp({ ...context, principal: {
      ...context.principal, subject: 'local-demo-operator',
    } }), (error: unknown) => error instanceof AppError && error.code === 'USP_LOCAL_ONLY');
    assert.throws(() => assertLocalUsp({ ...context, principal: {
      ...context.principal, mode: 'india_private',
    } }), (error: unknown) => error instanceof AppError && error.code === 'USP_LOCAL_ONLY');
  });
});

test('missing, malformed and retired operator configuration fails closed before context creation', () => {
  const context = withSubject(processSubject, () => localRequestContext(randomUUID()));
  for (const value of [undefined, '', ' ', ` ${processSubject}`, `${processSubject}\n`, `${processSubject}\tsuffix`,
    'x'.repeat(257), 'local-demo-operator']) {
    withSubject(value, () => {
      assert.throws(() => localOperatorSubject(), configurationError);
      assert.throws(() => localRequestContext(randomUUID()), configurationError);
      assert.throws(() => assertLocalUsp(context), configurationError);
    });
  }
});
