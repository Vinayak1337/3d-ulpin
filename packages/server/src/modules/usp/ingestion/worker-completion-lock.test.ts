import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AppError, conflict } from '../../../infrastructure/errors';
import { sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const formats = ['ifc', 'citygml', 'document'] as const;

/** Execute the production completion block with a statement-recording client and delayed immutable storage. */
export function completionBlock(format: typeof formats[number], source?: string) {
  source ??= readFileSync(new URL(`./${format}-worker.ts`, import.meta.url), 'utf8');
  const acceptance = source.indexOf('    await acceptUspJobAttempt(');
  const start = format === 'document' ? source.lastIndexOf('    await authorize();await putOriginal', acceptance)
    : source.lastIndexOf('    await current();controller.signal.throwIfAborted();', acceptance);
  const closing = format === 'document' ? '    async function authorizePins' : '  }catch(error)';
  const end = source.indexOf(closing, acceptance);
  assert.ok(start >= 0 && acceptance > start && end > acceptance, 'production completion boundaries exist');
  return source.slice(start, end);
}

export async function completionFixture(format: typeof formats[number], source?: string,
  options: { revoke?: boolean; corrupt?: boolean; enforceOutside?: boolean } = {}) {
  const statements: string[] = [], holds: number[] = [], reads: { locked: boolean; ms: number }[] = [];
  let locked = false, revoked = false, accepted = false;
  const bytes = Buffer.from('test_only'), hash = sha256(bytes), jobId = 'test_only';
  const result = { artifact: { key: 'test_only', bytes: bytes.length, sha256: hash }, summary: {} };
  const input = { caseId: 'test_only', sourceId: 'test_only', subject: 'test_only', sourceRevision: 1 };
  const asset = { assetId: `${format}:${jobId}`, version: 1, sha256: hash };
  const controller = new AbortController();
  const client = { query: async (sql: string) => { statements.push(sql); return { rows: [], rowCount: 0 }; } };
  const beforeLocks = async () => {
    if (format !== 'document') await client.query('SELECT pg_advisory_xact_lock(hashtext($1))');
    await client.query(`SELECT id FROM cases WHERE id=$1 FOR ${format === 'document' ? 'UPDATE' : 'SHARE'}`);
    if (revoked) conflict('test_only source fence changed during storage');
  };
  const slow = async () => {
    if (options.enforceOutside !== false) assert.equal(locked, false, 'storage cannot hold a locked transaction');
    const start = performance.now(), held = locked;
    statements.push('SLOW_STORAGE');
    await new Promise(resolve => setTimeout(resolve, 20));
    reads.push({ locked: held, ms: performance.now() - start });
    revoked ||= Boolean(options.revoke);
  };
  const readResult = async () => { await slow(); return result; };
  const readArtifact = async () => { await slow(); return options.corrupt ? Buffer.from('changed') : bytes; };
  const transaction = async (work: () => Promise<void>) => {
    assert.equal(locked, false);
    await client.query('BEGIN');
    locked = true;
    const start = performance.now();
    try { await work(); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { holds.push(performance.now() - start); locked = false; }
  };
  const dependencies: Record<string, unknown> = {
    AppError, conflict, sha256, fingerprint, bytes, hash, jobId, result, input, asset, controller,
    owned: { inputSha256: hash }, attempt: { inputSha256: hash }, deadline: { deadlineAt: Infinity },
    assertIFCTools: () => {}, dependencies: { tools: () => {} },
    native: { status: 'extracted' }, model: { status: 'test_only' },
    beforeLocks, authorizePins: beforeLocks,
    current: () => transaction(beforeLocks), authorize: () => transaction(beforeLocks),
    putOriginal: slow, documentResultKey: () => 'test_only', readDocumentResult: readResult,
    readIFCResult: readResult, boundedIFCObject: readArtifact, assertIFCJobRow: () => {},
    readCityGMLResult: readResult, boundedCityGMLObject: readArtifact, assertCityGMLJobRow: () => {},
    assertUspJobAttemptTx: async () => { await client.query('SELECT * FROM usp_job_attempts FOR UPDATE'); },
    appendCaseIngestionTx: async () => { await client.query('INSERT INTO usp_outbox'); },
    settleIntakeIfcTx: async () => {}, settleIntakeNativeReaderTx: async () => {}, settleBatchPdfTx: async () => {},
    acceptUspJobAttempt: async (_attempt: unknown, _asset: unknown, validate: Function,
      lock: Function, commit: Function) => transaction(async () => {
      await lock(client);
      await client.query('SELECT * FROM jobs FOR UPDATE');
      await validate(client, { operation: 'document-extraction', payload: input, input_fingerprint: hash }, asset);
      await commit(client);
      accepted = true;
    }),
  };
  const block = completionBlock(format, source);
  const run = new AsyncFunction('context', `const {${Object.keys(dependencies).join(',')}} = context;\n${block}`);
  let error: unknown;
  try { await run(dependencies); } catch (failure) { error = failure; }
  return { statements, holds, reads, accepted, error };
}

export async function toolScopeFixture(format: 'ifc' | 'citygml', source?: string, enforceOutside = true) {
  source ??= readFileSync(new URL(`./${format}-worker.ts`, import.meta.url), 'utf8');
  const lockStart = source.indexOf('  const beforeLocks=');
  const currentStart = source.indexOf('  const current=');
  const block = source.slice(lockStart, source.indexOf('  try{', lockStart))
    + source.slice(currentStart, source.indexOf('  let stopped=', currentStart));
  const statements: string[] = [], holds: number[] = [], checks: boolean[] = [];
  let locked = false;
  const client = { query: async (sql: string) => { statements.push(sql); } };
  const tools = () => {
    checks.push(locked);
    if (enforceOutside) assert.equal(locked, false, 'environment hashing cannot hold a case lock');
    statements.push('HASH_ENVIRONMENT');
    const start = performance.now();
    while (performance.now() - start < 20) { /* Bounded synchronous inventory hashing double. */ }
  };
  const assertInput = async () => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))');
    await client.query('SELECT id FROM cases WHERE id=$1 FOR SHARE');
  };
  const context = { input: {}, deadline: { deadlineAt: Infinity }, owned: {}, dependencies: { tools },
    assertIFCTools: tools, assertIFCInputTx: assertInput, assertCityGMLInputTx: assertInput,
    assertUspJobAttemptTx: async () => { await client.query('SELECT * FROM usp_job_attempts FOR UPDATE'); },
    transaction: async (work: Function) => {
      await client.query('BEGIN');
      locked = true;
      const start = performance.now();
      try { await work(client); await client.query('COMMIT'); }
      finally { holds.push(performance.now() - start); locked = false; }
    },
  };
  const run = new AsyncFunction('context', `const {${Object.keys(context).join(',')}} = context;\n`
    + block.replace(':PoolClient', '') + '\nawait current();');
  await run(context);
  return { statements, holds, checks };
}

for (const format of ['ifc', 'citygml'] as const) {
  test(`${format} lease/source checks hash the environment before BEGIN`, async () => {
    const result = await toolScopeFixture(format);
    assert.deepEqual(result.checks, [false]);
    assert.ok(result.statements.indexOf('HASH_ENVIRONMENT') < result.statements.indexOf('BEGIN'));
  });
}

for (const format of formats) {
  test(`${format} completion verifies immutable storage before taking publication locks`, async () => {
    const result = await completionFixture(format);
    assert.equal(result.error, undefined);
    assert.equal(result.accepted, true);
    assert.ok(result.reads.length > 0);
    assert.ok(result.reads.every(read => !read.locked));
    assert.ok(result.statements.lastIndexOf('SLOW_STORAGE') < result.statements.lastIndexOf('BEGIN'));
  });
  test(`${format} completion rechecks the source fence after slow verification`, async () => {
    const result = await completionFixture(format, undefined, { revoke: true });
    assert.equal(result.accepted, false);
    assert.ok(result.error instanceof AppError);
    assert.ok(result.statements.includes('ROLLBACK'));
  });
  if (format !== 'document') test(`${format} completion refuses a changed staged artifact`, async () => {
    const result = await completionFixture(format, undefined, { corrupt: true });
    assert.equal(result.accepted, false);
    assert.ok(result.error instanceof AppError && result.error.code.endsWith('_ARTIFACT_INTEGRITY'));
    assert.equal(result.holds.length, 1, 'corrupt storage never starts the publication transaction');
  });
}
