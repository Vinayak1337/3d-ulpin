import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

import type { NestExpressApplication } from '../../../../apps/api/node_modules/@nestjs/platform-express';
import type { NextFunction, Request, Response } from '../../../../apps/api/node_modules/@types/express';
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
  const address = app.getHttpServer().address();
  assert(address && typeof address !== 'string');
  port = address.port;
  setRuntimeLoopbackPort(port);
  process.env.API_PORT = String(port);
  endpoint = `http://127.0.0.1:${port}`;
}

export async function stopHttp() {
  if (app) await app.close();
  return calls;
}

/** Actual route values are parsed by the same canonical schema the published operation uses. */
export async function intakeHttp<T>(method: 'GET' | 'POST', route: string,
  pattern: string, schema: { parse: (value: unknown) => T }, input?: unknown,
  expectedStatus = method === 'POST' ? 202 : 200): Promise<T> {
  const operation = published.paths[pattern][method.toLowerCase()];
  const responseSchema = operation.responses[String(expectedStatus)].content['application/json'].schema;
  const resolved = responseSchema.$ref
    ? published.components.schemas[responseSchema.$ref.split('/').at(-1)] : responseSchema;
  assert.deepEqual(resolved, runtimeZod.toJSONSchema(schema, { target: 'openapi-3.0' }));
  const body = input instanceof FormData ? { body: input }
    : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) };
  const response = await fetch(`${endpoint}${route}`, { method, ...(input === undefined ? {} : body) });
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
  calls.push({ method: 'POST', route, status: response.status });
  return value.error;
}
