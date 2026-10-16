import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// kn2/http.ts's schema-checked calls, aimed at the API process the walk starts and restarts.
const require = createRequire(new URL('../../../../apps/api/package.json', import.meta.url));
const { z: runtimeZod } = require('zod');
const published = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8'));
const calls: { method: string; route: string; status: number; at: string }[] = [];
const reads = new Map<string, number>();
const endpoint = () => `http://127.0.0.1:${process.env.API_PORT}`;

/** Actual route values are parsed by the same canonical schema the published operation uses. */
export async function intakeHttp<T>(method: 'GET' | 'POST', route: string,
  pattern: string, schema: { parse: (value: unknown) => T }, input?: unknown,
  expectedStatus = method === 'POST' ? 202 : 200): Promise<T> {
  const operation = published.paths[pattern][method.toLowerCase()];
  const responseSchema = operation.responses[String(expectedStatus)].content['application/json'].schema;
  const resolved = responseSchema.$ref
    ? published.components.schemas[responseSchema.$ref.split('/').at(-1)] : responseSchema;
  assert.deepEqual(resolved, runtimeZod.toJSONSchema(schema, { target: 'openapi-3.0' }));
  const body = { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) };
  const response = await fetch(`${endpoint()}${route}`, { method, ...(input === undefined ? {} : body) });
  const value = await response.json();
  if (method === 'GET' && response.status === 200) reads.set(pattern, (reads.get(pattern) ?? 0) + 1);
  else calls.push({ method, route: pattern, status: response.status, at: new Date().toISOString() });
  assert.equal(response.status, expectedStatus, JSON.stringify(value));
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  return schema.parse(value);
}

export function httpCalls() {
  return { calls, reads: Object.fromEntries(reads) };
}

/** e1b/http.ts: the card's own link answers with its PDF and a consistent, unexpired verification. */
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
