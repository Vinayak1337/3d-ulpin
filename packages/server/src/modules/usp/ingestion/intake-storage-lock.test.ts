import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { Readable } from 'node:stream';
import { isDeepStrictEqual } from 'node:util';
import { SourceRangeReferenceSchema } from '@ulpin/contracts';
import { STREAMING_VECTOR_LIMITS as limits } from '@ulpin/contracts/usp';
import { sha256 } from '../../../infrastructure/storage';
import { readStreamingFeatures, sourceFeaturePosition, sourceRecord } from './streaming-vector-reader';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { assertPartPrefixSealCheck, partStageTimer } from './proved-area-part';
import { prefixSealCheckKey } from './streamed-mapping';

const hash = 'a'.repeat(64), id = 'test_only';
const baseline = process.env.S91M_SCOPE_BASE ?? process.env.S548C_SCOPE_BASE ?? process.env.S548B_SCOPE_BASE;
const directory = 'packages/server/src/modules/usp/ingestion/';
function source(name: string) {
  return readFileSync(baseline ? `${baseline}/before-${name}.ts` : `${directory}${name}.ts`, 'utf8')
    .replace(/\r\n/g, '\n');
}
function body(text: string, name: string) {
  const marker = text.includes(`async function ${name}`) ? `async function ${name}` : `function ${name}`;
  const start = text.indexOf(marker), end = text.indexOf('\n}\n', start) + 3;
  assert.ok(start >= 0 && end > start);
  return text.slice(start, end);
}
function load(text: string, deps: Record<string, unknown>, tail: string) {
  const js = ts.transpileModule(text, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
  } }).outputText.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
  return new Function(...Object.keys(deps), js + tail)(...Object.values(deps));
}

/** Cut admission and raw proof bodies are real; layout loaders, processor and persistence are doubles.
 * Immutable I/O and processor waits can be delayed; scopes record statements from first lock to release. */
async function scopeFixture(kind: 'cut' | 'compare', changed?: string, open = false, slowNormalize = false,
  utility = false) {
  const statements: string[] = [], scopes: { statements: string[]; ms: number }[] = [];
  const reads: boolean[] = [], visited: number[] = [], writes: unknown[] = [], processorLocks: boolean[] = [];
  let locked = false, firstLock = -1, lockAt = 0, mutated = false, comparePins = 0, normalizedDone = false;
  const chunks = kind === 'cut' ? 20 : 16, recordsPerChunk = kind === 'cut' ? 100 : 1;
  const feature = JSON.parse(readFileSync('fixtures/google-uttam/00-all-google-detections.geojson', 'utf8'))
    .features[0];
  const rawBytes = Buffer.from(JSON.stringify(feature));
  const retained = { id, case_id: id, revision: 1, sha256: hash, bytes: rawBytes.length,
    profile: 'large-original-v1', inspection: { largeOriginal: {}, streamedMapReceipt: {
      rawJobId: id, readerVersion: limits.version, collectionMetadata: {} } } };
  const plan = { version: 'streamed-mapping/1', rawJobId: id, operations: [],
    source: { sourceId: id, sourceRevision: 1, sourceSha256: hash } };
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
    if (sql.startsWith('SELECT r.body->>')) return { rows: [{ plan_hash: hash, sealed_hash: hash }] };
    if (sql.startsWith('SELECT m.*')) return { rows: [{ source_id: id, source_revision: 1,
      state: open ? 'running' : 'completed',
      raw_parts: chunks, raw_records: chunks * recordsPerChunk, raw_state: 'completed', raw_unknown: false,
      records: chunks * recordsPerChunk, sealed_chunks: open ? null : chunks, next_publish_index: chunks,
      unknown_remainder: open, seal_check: { changed: false, mappingJobId: id,
        key: prefixSealCheckKey(hash, hash, id), conflicts: [] },
      payload: { sourceSha256: hash, planHash: hash, route: 'approved_recipe', rawJobId: id } }] };
    if (sql.startsWith('SELECT result_sha256')) {
      const raw = sql.includes('usp_streaming_vector_slots');
      return { rows: mutated && changed === 'rawUnpublished' && raw ? [] : [{ result_sha256:
        mutated && (changed === 'slot' || (changed === 'rawSlot' && raw)) ? 'b' : hash }] };
    }
    if (sql.startsWith('SELECT state,unknown_remainder,sealed_chunks')) return { rows: [{ state: 'completed',
      sealed_chunks: chunks, unknown_remainder: mutated && changed === 'rawClosure' }] };
    if (sql.startsWith('SELECT * FROM usp_streaming_vector_slots')) return { rows: Array.from(
      { length: (values[3] ?? values[2] + 1) - values[2] }, (_, offset) => slot(values[2] + offset)) };
    if (sql.startsWith('SELECT body FROM usp_mapping_recipes')) return { rows: [{ body: {
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
    if (changed && !['rawSlot', 'rawClosure', 'rawUnpublished'].includes(changed)) mutated = true;
    if (changed === 'closure') state.store.profile.generation++;
  };
  const attemptFence = async () => {
    await query('SELECT * FROM usp_job_attempts FOR UPDATE');
    if (mutated && changed === 'attempt') conflict('test_only expired attempt');
  };
  const proof = load(kind === 'cut' ? source('proved-area-part') : '', {
    Readable, isDeepStrictEqual, SourceRangeReferenceSchema,
    limits, AppError, conflict, notFound, sha256, transaction,
    fingerprint: (value: unknown) => value === plan ? hash : fingerprint(value),
    readStreamingFeatures, sourceFeaturePosition, sourceRecord,
    localOperatorSubject: () => id, isRetainedMapOriginal: () => true,
    streamingContextTx: async () => ({ source: retained, latest: true }),
    StreamedMappingReceiptSchema: { parse: () => ({ state: 'approved', plan, planHash: hash,
      approval: { planHash: hash, subject: id } }) },
    StreamedMapOriginalReceiptSchema: { parse: (value: unknown) => value },
    loadSealedStreamedProfileTx: async () => ({ profile: {} }),
    compileStreamedMapping: () => normalizedDone && changed === 'normalizationMapping' ? { changed: true } : {},
    assertStreamedIssuerEvidence: () => {},
    StreamingVectorService: class { async chunk(_case: string, _source: string, _job: string, index: number) {
      await storage();
      return { current: true, sourceComplete: true, unknownRemainder: false,
        slot: { resultSha256: hash }, payload: { records: Array.from({ length: recordsPerChunk }, (_, ordinal) => ({
          featureIndex: index * recordsPerChunk + ordinal, disposition: 'accepted', feature,
          byteStart: 0, byteEnd: rawBytes.length, rawSha256: sha256(rawBytes) })) } };
    } },
  }, `;return { provedPartOperationKey: typeof provedPartOperationKey === 'undefined'
    ? undefined : provedPartOperationKey, prepareProvedAreaPartTx: typeof prepareProvedAreaPartTx === 'undefined'
    ? undefined : prepareProvedAreaPartTx, readProvedAreaPart: typeof readProvedAreaPart === 'undefined'
    ? undefined : readProvedAreaPart };`);
  const areaText = readFileSync(baseline ? `${baseline}/before-areas.ts`
    : 'packages/server/src/modules/areas/areas.ts', 'utf8').replace(/\r\n/g, '\n');
  const prepareHelpers = baseline ? '' : ['provedPartAdapter', 'provedImportPin', 'normalizeProvedPart',
    'resolveImportUtilityProfiles', 'prepareProvedAreaImport'].map(name => body(areaText, name)).join('\n');
  const imports = load(('const preparedProvedImports = new WeakMap();\n' + prepareHelpers
    + body(areaText, 'ingestProvedAreaPart'))
      .replaceAll('await import("../usp/ingestion/proved-area-part")', 'proof'), {
    proof, partStageTimer, sha256, conflict, AppError, fingerprint, transaction,
    areaGeo: async (operation: string, data: any) => {
      assert.equal(operation, 'profile');
      processorLocks.push(locked);
      if (slowNormalize) await new Promise(resolve => setTimeout(resolve, 5250));
      return { profiles: data.features.map((feature: any) => ({ sourceKey: feature.sourceKey,
        utilityProfile: feature.utilityProfile })) };
    },
    assertProvedPartBounds: (features: unknown[], ranges: Map<number, unknown>) => {
      assert.equal(features.length, chunks * recordsPerChunk);
      for (let index = 0; index < features.length; index++) {
        assert.deepEqual(features[index], feature);
        assert.deepEqual(ranges.get(index), { format: 'geojson', featureIndex: index,
          byteStart: 0, byteEnd: rawBytes.length, rawSha256: sha256(rawBytes), readerVersion: limits.version });
      }
    },
    importAreaDestination: async () => changed === 'normalizationDestination'
      ? { revision: normalizedDone ? 2 : 1 } : undefined,
    normalizeAreaImport: async (_input: unknown, data: any, _area: unknown, positions: number[]) => {
      assert.deepEqual(positions, Array.from({ length: data.features.length }, (_, index) => index + 1));
      processorLocks.push(locked);
      if (changed === 'normalizationFailure') throw new AppError(503, 'AREA_PROCESSING', 'test_only outage');
      if (slowNormalize && !utility) await new Promise(resolve => setTimeout(resolve, 5250));
      return { features: utility ? data.features.map((feature: any, index: number) => ({ ...feature,
        kind: 'utility', sourceKey: `test_only:${index}`, utilityProfile: {} })) : data.features };
    },
    remapProvedPartIndexes: () => {}, gisQuarantine: () => undefined,
    persistPreparedAreaImport: async (_adapter: unknown, prepared: any) => {
      if (utility) assert.equal(prepared.utilityProfilesResolved, true, 'never profile again under the case lock');
      await query('INSERT INTO import_packages');
      return { features: prepared.normalized.features };
    },
  }, `;return { ingestProvedAreaPart, prepareProvedAreaImport: typeof prepareProvedAreaImport === 'undefined'
    ? undefined : prepareProvedAreaImport };`);
  const draft = load(source('intake-part-draft'), {
    AppError, conflict, notFound, fingerprint, partStageTimer, assertPartPrefixSealCheck,
    ChunkMappingService: class { async chunk(_case: string, _source: string, _job: string, index: number) {
      await storage();
      return { current: true, slot: { resultSha256: hash }, payload: {
        records: Array.from({ length: recordsPerChunk }, (_, ordinal) => ({
          featureIndex: index * recordsPerChunk + ordinal, disposition: 'observed', sourceKey: { state: 'known' },
          geometryRef: { rawJobId: id, chunkIndex: index } })),
      } };
    } },
    intakeCaseTx: async () => { await query('SELECT id FROM cases FOR UPDATE'); },
    intakeSourceTx: async () => {
      await query('SELECT * FROM sources FOR SHARE');
      return { source: {} };
    },
    isRetainedMapOriginal: () => true, unfinishedIntakePackagesTx: async () => 0,
    ingestProvedAreaPart: imports.ingestProvedAreaPart,
    publishIntakePartTx: async () => { await query('INSERT INTO usp_intake_parts'); },
    createIntakeTargetsTx: async () => { await query('INSERT INTO usp_intake_targets'); },
  }, `;return { draftIntakePartTx, readObservedIntakeCut: typeof readObservedIntakeCut === 'undefined'
    ? undefined : readObservedIntakeCut };`);
  const text = source('intake-large-worker');
  const worker = load(body(text, 'pinned') + body(text, kind === 'cut' ? 'draftCut' : 'comparePrefix'), {
    ...draft, AppError, conflict, fingerprint, partStageTimer, transaction,
    prepareProvedAreaImport: async (input: any, witness: any) => {
      const prepared = await imports.prepareProvedAreaImport(input, witness);
      normalizedDone = true;
      if (changed === 'normalizationInput') input.destination = { ...input.destination, name: 'changed' };
      if (changed === 'normalizationProof') witness.part.positions[0]++;
      return changed === 'normalizationToken' ? { ...prepared } : prepared;
    },
    readProvedAreaPart: async (input: any) => {
      const witness = await proof.readProvedAreaPart(changed === 'witness' ? { ...input, cutIndex: 99 } : input);
      if (['rawSlot', 'rawClosure', 'rawUnpublished'].includes(changed ?? '')) mutated = true;
      if (changed === 'receipt') retained.inspection.streamedMapReceipt.collectionMetadata = { changed: true };
      if (changed === 'bytes') input.features[0].rawBytes = Buffer.from('changed');
      if (changed === 'proof') witness.part.positions[0]++;
      if (changed === 'coverage') witness.slots.pop();
      return witness;
    },
    assertIntakeDraftTx: async (_client: unknown, _input: unknown, lockCase = true) => {
      if (kind === 'cut') assert.equal(lockCase, true, 'case UPDATE must precede the cut job fence');
      if (kind === 'compare' && !baseline)
        assert.equal(lockCase, ++comparePins === 2 + 2 * Math.ceil(chunks / 8),
          'only the final seal publication needs case UPDATE; read pins take KEY SHARE first');
      await query(`SELECT id FROM cases FOR ${lockCase ? 'UPDATE' : 'KEY SHARE'}`);
      await query('SELECT * FROM sources FOR SHARE');
      if (mutated && changed === 'source') conflict('test_only source changed');
    },
    assertUspJobAttemptTx: attemptFence, largeStateKey: async () => state,
    intakeLargeCutKey: () => hash, INTAKE_UNFINISHED_PACKAGE_LIMIT: 8,
    rawFeatures: async () => {
      await storage(); // The source-range boundary also remains outside the cut transaction.
      return Array.from({ length: chunks * recordsPerChunk }, (_, index) => ({ featureIndex: index,
        rawChunkIndex: Math.floor(index / recordsPerChunk), rawBytes: Buffer.from(rawBytes) }));
    },
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
      part: { sourceId: id, sourceRevision: 1, sourceSha256: hash, layoutHash: hash,
        readerVersion: limits.version, destination: { namespace: id, name: id } } }, { index: 0 }, false);
    else await worker(input, {});
  } catch (failure) { error = failure; }
  return { scopes, reads, visited, writes, processorLocks, error };
}

test('a 2000-feature cut does not hold its case row during a slow normalizer', async () => {
  const result = await scopeFixture('cut', undefined, true, true);
  assert.equal(result.error, undefined);
  const longest = Math.max(...result.scopes.map(scope => scope.ms));
  console.info(JSON.stringify({ scope: 'cut-normalizer', features: 2000, processorDelayMs: 5250,
    baseline: Boolean(baseline), longestLockedMs: longest, processorCallsUnderLock: result.processorLocks }));
  if (baseline) assert.ok(longest > 5000, 'baseline reproduces the five-second lock hold');
  else {
    assert.ok(longest < 1000, 'all locked transactions finish within one second');
    assert.deepEqual(result.processorLocks, [false]);
  }
});

test('utility profiles for a 2000-feature cut also resolve before case publication',
  { skip: Boolean(baseline) }, async () => {
    const result = await scopeFixture('cut', undefined, true, true, true);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.processorLocks, [false, false]);
    const longest = Math.max(...result.scopes.map(scope => scope.ms));
    assert.ok(longest < 1000);
    console.info(JSON.stringify({ scope: 'cut-utility-profile', features: 2000, processorDelayMs: 5250,
      longestLockedMs: longest, processorCallsUnderLock: result.processorLocks }));
  });

test('an open mapping cut keeps its locked scope free of storage and mapping job SHARE', async () => {
  const result = await scopeFixture('cut', undefined, true);
  assert.equal(result.error, undefined);
  assert.equal(result.reads.filter(Boolean).length, 0);
  const cut = result.scopes.at(-1)!;
  assert.equal(cut.statements[0], 'SELECT id FROM cases FOR UPDATE');
  assert(!cut.statements.some(sql => sql.includes('FOR SHARE OF m,j')));
  console.info(JSON.stringify({ scope: 'open-cut', lockedMs: cut.ms, storageCallsUnderLock: 0 }));
});

for (const kind of ['cut', 'compare'] as const) {
  const name = kind === 'cut' ? 'mapped verification and raw proof' : 'raw comparison';
  test(`${kind} ${name} reads outside locked scopes`, async () => {
    const result = await scopeFixture(kind);
    assert.equal(result.error, undefined);
    assert.equal(result.reads.length, kind === 'cut' ? 41 : 16);
    assert.ok(result.writes.length > 0);
    if (kind === 'compare') assert.deepEqual(result.visited, Array.from({ length: 16 }, (_, index) => index));
    console.info(JSON.stringify({ scope: kind, baseline: Boolean(baseline),
      lockedMs: result.scopes.reduce((sum, scope) => sum + scope.ms, 0),
      scopes: result.scopes, storageCallsUnderLock: result.reads.filter(Boolean).length }));
  });
  for (const changed of kind === 'cut'
    ? ['slot', 'source', 'attempt', 'rawSlot', 'rawClosure', 'rawUnpublished', 'witness', 'receipt', 'bytes',
      'proof', 'coverage', 'normalizationDestination', 'normalizationMapping', 'normalizationInput',
      'normalizationProof', 'normalizationToken', 'normalizationFailure'] : ['slot', 'closure', 'source', 'attempt']) {
    test(`${kind} refuses ${changed} changes across its pre-read`, { skip: Boolean(baseline) }, async () => {
      const result = await scopeFixture(kind, changed);
      assert.ok(result.error instanceof AppError);
      assert.equal(result.writes.length, 0, 'no package or prefix seal can be published after a changed fence');
    });
  }
}
