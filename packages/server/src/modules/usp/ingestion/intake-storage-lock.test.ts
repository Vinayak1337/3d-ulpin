import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { partStageTimer } from './proved-area-part';

const hash = 'a'.repeat(64), id = 'test_only';
const baseline = process.env.S548B_SCOPE_BASE;
const directory = 'packages/server/src/modules/usp/ingestion/';
function source(name: string) {
  return readFileSync(baseline ? `${baseline}/before-${name}.ts` : `${directory}${name}.ts`, 'utf8')
    .replace(/\r\n/g, '\n');
}
function body(text: string, name: string) {
  const start = text.indexOf(`async function ${name}`), end = text.indexOf('\n}\n', start) + 3;
  assert.ok(start >= 0 && end > start);
  return text.slice(start, end);
}
function load(text: string, deps: Record<string, unknown>, tail: string) {
  const js = ts.transpileModule(text, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
  } }).outputText.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
  return new Function(...Object.keys(deps), js + tail)(...Object.values(deps));
}

/** Admission/comparison bodies are real; processor/persistence boundaries are doubles, not a full-cut proof.
 * Only immutable I/O is delayed; scopes record statements from first lock to release. */
async function scopeFixture(kind: 'cut' | 'compare', changed?: string) {
  const statements: string[] = [], scopes: { statements: string[]; ms: number }[] = [];
  const reads: boolean[] = [], visited: number[] = [], writes: unknown[] = [];
  let locked = false, firstLock = -1, lockAt = 0, mutated = false;
  const chunks = kind === 'cut' ? 20 : 16, recordsPerChunk = kind === 'cut' ? 100 : 1;
  const feature = JSON.parse(readFileSync('fixtures/google-uttam/00-all-google-detections.geojson', 'utf8'))
    .features[0];
  const state = { store: { reader: { job_id: id, sealed_chunks: chunks }, profile: { generation: 1 },
    recipe: { id }, mapping: { job_id: id }, unreviewed: 0 } };
  const slot = (index: number) => ({ chunk_index: index, result_sha256: mutated && changed === 'slot' ? 'b' : hash,
    object_key: id, object_sha256: hash, bytes: 1 });
  const query = async (sql: string, values: any[] = []): Promise<any> => {
    statements.push(sql.replace(/\s+/g, ' ').trim());
    if (!locked && /pg_advisory_xact_lock|FOR (?:KEY SHARE|SHARE|UPDATE)/.test(sql)) {
      locked = true;
      firstLock = statements.length - 1;
      lockAt = performance.now();
    }
    if (sql.startsWith('SELECT case_id')) return { rows: [{ case_id: id }] };
    if (sql.startsWith('SELECT * FROM usp_intake_items')) return { rows: [{ source_id: id, case_id: id }] };
    if (sql.startsWith('SELECT m.*')) return { rows: [{ source_id: id, source_revision: 1, state: 'completed',
      raw_parts: chunks, raw_records: chunks * recordsPerChunk, raw_state: 'completed', raw_unknown: false,
      records: chunks * recordsPerChunk, sealed_chunks: chunks, next_publish_index: chunks, unknown_remainder: false,
      payload: { sourceSha256: hash, planHash: hash, route: 'approved_recipe', rawJobId: id } }] };
    if (sql.startsWith('SELECT result_sha256')) return { rows: [slot(values[1])] };
    if (sql.startsWith('SELECT * FROM usp_streaming_vector_slots')) return { rows: [slot(values[2])] };
    if (sql.startsWith('SELECT body')) return { rows: [{ body: {
      plan: { version: 'streamed-mapping/1', rawJobId: id }, planHash: hash } }] };
    if (/^INSERT|^UPDATE/.test(sql)) writes.push(values[1] ?? sql);
    return { rows: [] };
  };
  const client = { query };
  const transaction = async (work: Function) => {
    assert.equal(locked, false);
    await query('BEGIN');
    try {
      const result = await work(client);
      await query('COMMIT');
      return result;
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    } finally {
      if (locked) scopes.push({ statements: statements.slice(firstLock), ms: performance.now() - lockAt });
      locked = false;
    }
  };
  const storage = async () => {
    reads.push(locked);
    if (!baseline) assert.equal(locked, false, 'no storage between the first lock and commit');
    statements.push('SLOW_STORAGE');
    await new Promise(resolve => setTimeout(resolve, 5));
    if (changed) mutated = true;
    if (changed === 'closure') state.store.profile.generation++;
  };
  const attemptFence = async () => {
    await query('SELECT * FROM usp_job_attempts FOR UPDATE');
    if (mutated && changed === 'attempt') conflict('test_only expired attempt');
  };
  const draft = load(source('intake-part-draft'), { AppError, conflict, notFound, fingerprint, partStageTimer,
    ChunkMappingService: class { async chunk(_case: string, _source: string, _job: string, index: number) {
      await storage();
      return { current: true, slot: { resultSha256: hash }, payload: {
        records: Array.from({ length: recordsPerChunk }, (_, ordinal) => ({
          featureIndex: index * recordsPerChunk + ordinal, disposition: 'observed', sourceKey: { state: 'known' },
          geometryRef: { rawJobId: id, chunkIndex: index } })),
      } };
    } },
    intakeSourceTx: async () => {
      await query('SELECT * FROM sources FOR SHARE');
      return { source: {} };
    },
    isRetainedMapOriginal: () => true, unfinishedIntakePackagesTx: async () => 0,
    ingestProvedAreaPart: async () => {
      await query('INSERT INTO import_packages');
      return { features: [feature] };
    },
    publishIntakePartTx: async () => { await query('INSERT INTO usp_intake_parts'); },
    createIntakeTargetsTx: async () => { await query('INSERT INTO usp_intake_targets'); },
  }, `;return { draftIntakePartTx, readObservedIntakeCut: typeof readObservedIntakeCut === 'undefined'
    ? undefined : readObservedIntakeCut };`);
  const text = source('intake-large-worker');
  const worker = load(body(text, 'pinned') + body(text, kind === 'cut' ? 'draftCut' : 'comparePrefix'), {
    ...draft, AppError, conflict, fingerprint, partStageTimer, transaction,
    assertIntakeDraftTx: async () => {
      await query('SELECT id FROM cases FOR KEY SHARE');
      await query('SELECT * FROM sources FOR SHARE');
      if (mutated && changed === 'source') conflict('test_only source changed');
    },
    assertUspJobAttemptTx: attemptFence, largeStateKey: async () => state,
    intakeLargeCutKey: () => hash, INTAKE_UNFINISHED_PACKAGE_LIMIT: 8,
    rawFeatures: async () => Array.from({ length: chunks * recordsPerChunk }, (_, index) => ({ featureIndex: index,
      rawChunkIndex: Math.floor(index / recordsPerChunk), rawBytes: Buffer.from(JSON.stringify(feature)) })),
    heldThrough: () => ({}), cellPlanTx: async () => {}, console: { info: () => {} },
    StreamedMappingReceiptSchema: { parse: (value: unknown) => value },
    loadSealedStreamedProfileTx: async () => ({ profile: {} }),
    loadPrefixSealTx: async () => ({ generationHash: hash }), prefixSealCheckKey: () => hash,
    prefixLayoutMatchesSealed: () => true, heartbeat: () => async () => {},
    readPinnedRawChunk: async (_input: unknown, row: { chunk_index: number }) => {
      await storage();
      return { payload: { records: [row.chunk_index] } };
    },
    checkIntakeLargeChunk: (_prepared: unknown, records: number[]) => { visited.push(...records); },
  }, `;return ${kind === 'cut' ? 'draftCut' : 'comparePrefix'};`);
  let error: unknown;
  try {
    const input = { caseId: id, sourceId: id, sourceRevision: 1, itemId: id };
    if (kind === 'cut') await worker(input, {}, { cutKey: hash, mappingJobId: id, readerJobId: id,
      part: { sourceId: id, sourceRevision: 1, sourceSha256: hash, layoutHash: hash } }, { index: 0 }, false);
    else await worker(input, {});
  } catch (failure) { error = failure; }
  return { scopes, reads, visited, writes, error };
}

for (const kind of ['cut', 'compare'] as const) {
  test(`${kind} ${kind === 'cut' ? 'mapped verification' : 'raw comparison'} reads outside locked scopes`, async () => {
    const result = await scopeFixture(kind);
    assert.equal(result.error, undefined);
    assert.equal(result.reads.length, kind === 'cut' ? 20 : 16);
    assert.ok(result.writes.length > 0);
    if (kind === 'compare') assert.deepEqual(result.visited, Array.from({ length: 16 }, (_, index) => index));
    console.info(JSON.stringify({ scope: kind, baseline: Boolean(baseline),
      lockedMs: result.scopes.reduce((sum, scope) => sum + scope.ms, 0),
      scopes: result.scopes, storageCallsUnderLock: result.reads.filter(Boolean).length }));
  });
  for (const changed of kind === 'cut' ? ['slot', 'source', 'attempt'] : ['slot', 'closure', 'source', 'attempt']) {
    test(`${kind} refuses ${changed} changes during its pre-read`, { skip: Boolean(baseline) }, async () => {
      const result = await scopeFixture(kind, changed);
      assert.ok(result.error instanceof AppError);
      assert.equal(result.writes.length, 0, 'no package or prefix seal can be published after a changed fence');
    });
  }
}
