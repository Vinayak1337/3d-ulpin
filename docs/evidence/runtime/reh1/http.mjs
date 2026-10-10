import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { save, safe } from './audit.mjs';

export const base = 'http://127.0.0.1:21016';
export const scratch = 'E:/BhuAayam-data/task-data/reh1';
export const exchanges = [];
let session = '';

export function setSession(name) {
  assert(/^[a-z][a-z0-9-]*$/.test(name));
  assert.equal(exchanges.length, 0);
  session = `${name}-`;
}

const nativeFetch = globalThis.fetch.bind(globalThis);
const idsOf = value => {
  const selected = {};
  for (const [key, item] of Object.entries(value?.data ?? value ?? {})) {
    if (/^(id|.*Id|revision|version|state|status|caseRevision)$/.test(key) && typeof item !== 'object') {
      selected[key] = item;
    }
  }
  return selected;
};

export function compact(value) {
  if (typeof value === 'string') return value.length > 90 ? value.match(/.{1,90}/g) : value;
  if (Array.isArray(value)) return value.map(compact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compact(item)]));
}

export function retain(name, value) {
  mkdirSync(scratch, { recursive: true });
  writeFileSync(`${scratch}/${name}.json`, JSON.stringify(value) + '\n', { flag: 'wx' });
}

async function formSummary(form) {
  const fields = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') {
      fields[key] = key === 'metadata' ? JSON.parse(value) : value;
    } else {
      const bytes = Buffer.from(await value.arrayBuffer());
      fields[key] = { filename: value.name, bytes: bytes.length,
        sourceSha256: createHash('sha256').update(bytes).digest('hex') };
    }
  }
  return fields;
}

export async function capturedFetch(input, init) {
  const request = new Request(input, init);
  const url = new URL(request.url);
  assert.equal(url.origin, base, 'Any non-rehearsal address is refused before fetch');
  assert(url.pathname.startsWith('/api/v1/'), 'Only product API routes are permitted');
  const index = session + String(exchanges.length + 1).padStart(3, '0');
  const type = request.headers.get('content-type') ?? '';
  let body = null;
  if (request.method !== 'GET') {
    body = type.includes('multipart/form-data') ? await formSummary(await request.clone().formData())
      : JSON.parse(await request.clone().text());
  }
  const requestKey = body?.requestKey ?? body?.guard?.requestKey ?? body?.metadata?.requestKey ?? null;
  retain(`${index}-request`, { method: request.method, route: url.pathname + url.search, body, requestKey });
  const started = performance.now();
  const response = await nativeFetch(request, { redirect: 'error', signal: AbortSignal.timeout(120000) });
  const isJson = response.headers.get('content-type')?.includes('json');
  const answer = isJson ? await response.clone().json() : { bytes: (await response.clone().arrayBuffer()).byteLength };
  retain(`${index}-response`, { status: response.status, body: answer });
  const receipt = { index, method: request.method, route: url.pathname + url.search, status: response.status,
    seconds: Number(((performance.now() - started) / 1000).toFixed(3)), requestKey,
    idempotencyHeader: request.headers.get('Idempotency-Key'), ids: idsOf(answer),
    code: answer?.error?.code ?? answer?.code ?? null, rawPrefix: `${scratch}/${index}` };
  exchanges.push(receipt);
  const evidence = { ...receipt, request: body };
  if (!response.ok) evidence.answer = answer;
  save(`http-${index}.json`, compact(JSON.parse(safe(JSON.stringify(evidence)))));
  console.log(`${index} ${request.method} ${url.pathname}: ${response.status} ${receipt.code ?? ''}`);
  return response;
}

export async function send(route, body, headers = {}) {
  const response = await capturedFetch(base + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body instanceof FormData ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined || body instanceof FormData ? body : JSON.stringify(body),
  });
  const answer = await response.json();
  if (!response.ok) throw new Error(`STOP HTTP ${response.status} ${answer?.error?.code ?? answer?.code}`);
  return answer;
}

export function installCapture() {
  globalThis.fetch = capturedFetch;
}
