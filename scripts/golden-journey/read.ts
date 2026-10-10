import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { committed, r1 } from './inputs';

export type State = 'pass' | 'fail' | 'blocked' | 'skipped';
export type Step = { id: string; title: string; state: State; ms: number; expected: unknown;
  observed: unknown; evidence: unknown[]; promptId: string };
export type Outcome = { state?: State; observed: unknown };
export type Read = { route: string[]; params: Record<string, string | number>; query: Record<string, string | number>;
  status: number; code: string | null; bodySha256: string; body: unknown };
type Operation = { parameters?: { name: string; in: string; required?: boolean }[] };
type Contract = { paths: Record<string, { get?: Operation; post?: Operation }> };
export const contract = committed<Contract>('docs/api/openapi.json');

export function object(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected a JSON object');
  return value as Record<string, unknown>;
}
export function list(value: unknown): unknown[] {
  assert(Array.isArray(value), 'Expected a JSON array');
  return value;
}
export function text(value: unknown): string {
  assert(typeof value === 'string' && value.length > 0, 'Expected nonempty text');
  return value;
}

export class Reader {
  readonly reads: Read[] = [];
  private readonly cache = new Map<string, Read>();

  async get(route: string, params: Read['params'] = {}, query: Read['query'] = {}, probe = false): Promise<Read> {
    const operation = contract.paths[route];
    assert(operation && (operation.get || probe), 'GET route is not in the published contract');
    for (const parameter of operation.get?.parameters ?? []) {
      if (parameter.required) assert(parameter.name in (parameter.in === 'path' ? params : query),
        `Missing ${parameter.name}`);
    }
    const path = route.replace(/\{([^}]+)\}/g, (_, name: string) => encodeURIComponent(String(params[name])));
    assert(!path.includes('undefined'), 'Missing path pin');
    const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
    const url = `${r1.api}${path}${search.size ? '?' + search : ''}`;
    let result = this.cache.get(url);
    if (!result) {
      const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30000) });
      const bytes = await response.text();
      const body: unknown = JSON.parse(bytes);
      const envelope = Array.isArray(body) ? {} : object(body);
      const error = envelope.error;
      const wrapped = error && typeof error === 'object' ? object(error) : {};
      const code = envelope.code ?? wrapped.code;
      result = { route: route.split('/').filter(Boolean), params, query, status: response.status,
        code: typeof code === 'string' ? code : null,
        bodySha256: createHash('sha256').update(bytes).digest('hex'), body };
      this.cache.set(url, result);
    }
    this.reads.push(result);
    return result;
  }
}

export function ok(read: Read): unknown {
  assert.equal(read.status, 200, `HTTP ${read.status} ${read.code ?? 'no code'}`);
  return read.body;
}
export function refs(reads: Read[]): unknown[] {
  const groups = new Map<string, Read[]>();
  for (const read of reads) {
    const key = JSON.stringify([read.route, read.query]);
    groups.set(key, [...(groups.get(key) ?? []), read]);
  }
  return [...groups.values()].map(groupedRefs);
}

function groupedRefs(reads: Read[]): unknown {
  const first = reads[0];
  const shared = Object.fromEntries(Object.entries(first.params).filter(([key, value]) =>
    reads.every(read => read.params[key] === value)));
  return { route: first.route, params: shared, query: first.query,
    reads: reads.map(read => ({ params: Object.fromEntries(Object.entries(read.params).filter(([key]) =>
      !(key in shared))), status: read.status, code: read.code, bodySha256: read.bodySha256 })) };
}

export async function check(reader: Reader, id: string, title: string, promptId: string,
  expected: unknown, work: () => Promise<Outcome>): Promise<Step> {
  const started = performance.now();
  const first = reader.reads.length;
  let outcome: Outcome;
  try {
    outcome = await work();
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown check failure';
    outcome = { state: 'fail', observed: { reasonLines: reason.match(/.{1,90}/g) ?? [] } };
  }
  return { id, title, state: outcome.state ?? 'pass', ms: Math.round(performance.now() - started), expected,
    observed: outcome.observed, evidence: refs(reader.reads.slice(first)), promptId };
}

export function values(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(values);
  if (!value || typeof value !== 'object') return [];
  const node = object(value);
  if ('value' in node && 'state' in node && 'citations' in node) return [node, ...values(node.value)];
  return Object.values(node).flatMap(values);
}
export function valueCounts(value: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of values(value)) {
    const state = text(item.state);
    counts[state] = (counts[state] ?? 0) + 1;
    if (['reviewed', 'source_supported'].includes(state)) {
      assert(list(item.citations).length > 0, `${state} value has no citation`);
    }
    if (state === 'unknown') assert.equal(item.value, null, 'Unknown became a value');
  }
  assert(Object.keys(counts).length > 0, 'No canonical values read');
  return counts;
}
export function knownK6(read: Read): boolean {
  // R2 snapshot + STATUS K6 register/ledger refusal, not an allowlist for arbitrary failures.
  return read.status === 409 && ['STALE_REVISION', 'REGISTRY_SOURCE_UNAVAILABLE'].includes(read.code ?? '');
}
