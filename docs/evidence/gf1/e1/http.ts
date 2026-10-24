import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import type { z } from '../../../../apps/api/node_modules/zod/index.js';
import { AppModule } from '../../../../apps/api/src/app.module';
import { ApiExceptionFilter } from '../../../../apps/api/src/common/api-exception.filter';
import { guardLocalRequest } from '../../../../apps/api/src/common/request-context';
import { setRuntimeLoopbackPort } from '../../../../packages/server/src/infrastructure/loopback-host';

const require = createRequire(new URL('../../../../apps/api/package.json', import.meta.url));
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { z: runtimeZod } = require('zod');
const published = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8'));
const calls: { method: string; route: string; status: number }[] = [];
let app: NestExpressApplication;
let endpoint: string;

export async function startHttp() {
  let port = 0;
  app = await NestFactory.create(AppModule, { logger: false, bodyParser: false, abortOnError: false });
  app.getHttpAdapter().getInstance().set('trust proxy', false);
  app.use((request: Request, response: Response, next: NextFunction) =>
    guardLocalRequest(request, response, next, port, []));
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0, '127.0.0.1');
  port = app.getHttpServer().address().port;
  setRuntimeLoopbackPort(port);
  process.env.API_PORT = String(port);
  endpoint = `http://127.0.0.1:${port}`;
}

export async function stopHttp() {
  if (app) await app.close();
  return calls;
}

/** Actual route values are parsed by the same canonical schema the published operation uses. */
export async function intakeHttp<T extends z.ZodType>(method: 'GET' | 'POST', route: string,
  pattern: string, schema: T, input?: unknown, expectedStatus = method === 'POST' ? 202 : 200): Promise<z.infer<T>> {
  const operation = published.paths[pattern][method.toLowerCase()];
  const reference = operation.responses[String(expectedStatus)].content['application/json'].schema.$ref;
  assert.deepEqual(published.components.schemas[reference.split('/').at(-1)],
    runtimeZod.toJSONSchema(schema, { target: 'openapi-3.0' }));
  const response = await fetch(`${endpoint}${route}`, { method,
    ...(input === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }) });
  const value = await response.json();
  calls.push({ method, route: pattern, status: response.status });
  assert.equal(response.status, expectedStatus, JSON.stringify(value));
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  return schema.parse(value);
}

export async function rejectedHttp(route: string, input: unknown, expectedStatus: number) {
  const response = await fetch(`${endpoint}${route}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const value = await response.json() as { error: { code: string; message: string } };
  assert.equal(response.status, expectedStatus, JSON.stringify(value));
  assert(value.error.code && value.error.message);
  return value.error;
}

/** The URL printed in the actual PDF resolves and its own verification endpoint reports consistency. */
export async function verifyCardLink(url: string) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /pdf/);
  assert((await response.arrayBuffer()).byteLength > 0);
  const verification = await fetch(`${url}/verification`);
  assert.equal(verification.status, 200);
  const value = await verification.json() as { data: { result: string; lifecycle: { expired: boolean } } };
  assert.equal(value.data.result, 'consistent');
  assert.equal(value.data.lifecycle.expired, false);
  return 'consistent';
}
