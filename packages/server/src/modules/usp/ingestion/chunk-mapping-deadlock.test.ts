import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Two-client lock model, not PostgreSQL: no SQLSTATE or historical culprit is claimed.
const root = 'packages/server/src/modules/usp/ingestion/';
const source = (name: string) => process.env.S13S_BASE
  ? execFileSync('git', ['show', `${process.env.S13S_BASE}:${root}${name}.ts`], { encoding: 'utf8' })
  : readFileSync(`${root}${name}.ts`, 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const compile = (body: string) => ts.transpileModule(body, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replaceAll('export ', '');
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** SHARE conflicts with the source write and job UPDATE; an upgrade retains its prior SHARE. */
function locks() {
  type Wait = { owner: string; resource: string; write: boolean; done: () => void; blockers: string[] };
  const held = new Map<string, Map<string, boolean>>(), waiting: Wait[] = [];
  const blockers = (owner: string, resource: string, write: boolean) =>
    [...(held.get(resource) ?? [])].filter(([who, exclusive]) => who !== owner && (write || exclusive))
      .map(([who]) => who);
  const grant = (owner: string, resource: string, write: boolean) => {
    if (!held.has(resource)) held.set(resource, new Map());
    held.get(resource)!.set(owner, write || !!held.get(resource)!.get(owner));
  };
  return {
    async take(owner: string, resource: string, write: boolean) {
      const blocked = blockers(owner, resource, write);
      if (!blocked.length) return grant(owner, resource, write);
      if (waiting.some(wait => blocked.includes(wait.owner) && wait.blockers.includes(owner)))
        throw new Error('Lock-order cycle in model: source SHARE -> raw job; raw job UPDATE -> source write');
      await new Promise<void>(done => waiting.push({ owner, resource, write, done, blockers: blocked }));
    },
    release(owner: string) {
      for (const owners of held.values()) owners.delete(owner);
      for (const wait of [...waiting]) {
        wait.blockers = blockers(wait.owner, wait.resource, wait.write);
        if (wait.blockers.length) continue;
        grant(wait.owner, wait.resource, wait.write);
        waiting.splice(waiting.indexOf(wait), 1);
        wait.done();
      }
    },
  };
}

test('raw receipt publication and mapping validation have no source/job lock cycle', async () => {
  const raw = source('streaming-vector-worker'), mapping = source('chunk-mapping');
  const helperStart = raw.indexOf('export async function assertStreamingPublicationInputTx');
  const helper = helperStart < 0 ? '' : raw.slice(helperStart, raw.indexOf('/** CR1', helperStart));
  const acceptance = raw.slice(raw.lastIndexOf('    await acceptUspJobAttempt(attempt,'));
  const hook = acceptance.slice(acceptance.indexOf('},client=>') + 2, acceptance.indexOf(',async client=>'));
  assert.match(hook, /^client=>assertStreaming/);
  const publicationPin = new AsyncFunction('input', 'assertStreamingInputTx',
    compile(helper) + `return (${hook});`);
  const contextStart = mapping.indexOf('async function rawContextTx');
  const context = mapping.slice(contextStart, mapping.indexOf('async function manualProfileTx', contextStart));
  const mappingPin = new AsyncFunction('client', 'assertStreamingInputTx', 'AnyStreamingInputSchema',
    'fingerprint', 'notFound', 'conflict', compile(context) + "return rawContextTx(client,'raw');");
  const lock = locks(), rawJobHeld = deferred(), mappingBegan = deferred(), trace: string[] = [];
  // Symbolic test_only rows describe locks, not source data or a fabricated survey input.
  const input = { caseId: 'case', sourceId: 'source' };
  function client(owner: string) {
    return { query: async (sql: string) => {
      trace.push(`${owner}: ${sql}`);
      if (sql.includes('FROM sources') && sql.includes('FOR ')) {
        if (owner === 'mapping') mappingBegan.resolve();
        await lock.take(owner, 'source', sql.includes('UPDATE'));
      }
      if (sql.includes('FROM jobs') && sql.includes('FOR ')) {
        await lock.take(owner, 'raw-job', sql.includes('UPDATE'));
        if (owner === 'raw') { rawJobHeld.resolve(); await mappingBegan.promise; }
      }
      if (sql.startsWith('UPDATE sources')) await lock.take(owner, 'source', true);
      return { rows: [{ payload: input, input_fingerprint: 'test_only' }] };
    } };
  }
  const assertInput = async (db: ReturnType<typeof client>) => {
    await db.query('SELECT id FROM cases WHERE id=$1 FOR SHARE');
    await db.query('SELECT * FROM sources WHERE case_id=$1 AND id=$2 FOR SHARE');
    return { current: {}, source: {} };
  };
  const publisher = (async () => {
    const db = client('raw');
    try {
      await (await publicationPin(input, assertInput))(db);
      // acceptUspJobAttempt takes the job UPDATE after its production beforeLocks callback.
      await db.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE');
      await db.query('UPDATE sources SET inspection=$2 WHERE id=$1');
    } finally { lock.release('raw'); }
  })();
  const reader = (async () => {
    await rawJobHeld.promise;
    try {
      await mappingPin(client('mapping'), assertInput, { parse: (value: unknown) => value },
        () => 'test_only', assert.fail, assert.fail);
    } finally { lock.release('mapping'); }
  })();
  const outcomes = await Promise.allSettled([publisher, reader]);
  assert.deepEqual(outcomes.map(outcome => outcome.status), ['fulfilled', 'fulfilled'],
    JSON.stringify({ outcomes: outcomes.map(o => o.status === 'rejected' ? String(o.reason) : o.status), trace }));
  assert.ok(trace.some(sql => sql.includes('FOR UPDATE') && sql.includes('FROM sources')),
    'the receipt takes its existing source UPDATE before its job, without a late upgrade');
});

test('mapped historical reads take case/source before either raw or mapping job SHARE', () => {
  const mapping = source('chunk-mapping');
  const historical = mapping.slice(mapping.indexOf('export async function chunkMappingReadContextTx'),
    mapping.indexOf('export function chunkMappingSlot'));
  const recapture = mapping.slice(mapping.indexOf('    const fresh=await transaction'));
  for (const block of [historical, recapture]) {
    assert.ok(block.indexOf('await lockStreamingRowsTx') >= 0);
    assert.ok(block.indexOf('await lockStreamingRowsTx') < block.indexOf('const job='));
  }
});
