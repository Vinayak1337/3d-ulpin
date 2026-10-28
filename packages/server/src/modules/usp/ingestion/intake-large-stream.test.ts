import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import type { StreamedMappingPlan, StreamedProfileGeneration, StreamingVectorRecord } from '@ulpin/contracts/usp';
import { fingerprint } from '../../cases/domain';
import { sha256 } from '../../../infrastructure/storage';
import { transaction } from '../../../infrastructure/db';
import { ingestionBinding } from './events';
import { normalizeMappedChunk } from './chunk-mapping-normalizer';
import { advanceStreamedInventory, emptyInventory } from './streamed-profile-inventory';
import { pairMappedFeatures } from './intake-package-cuts';
import { sourceRecord } from './streaming-vector-reader';
import { checkIntakeLargeChunk } from './intake-large-worker';

const id = '54000000-0000-4000-8000-000000000001', hash = 'a'.repeat(64);

async function fixture(count: number) {
  const original = await readFile('fixtures/google-uttam/00-all-google-detections.geojson');
  const features = JSON.parse(original.toString()).features;
  let offset = 0;
  // test_only scheduling copies of public outlines, not operational features or invented source facts.
  const raw: StreamingVectorRecord[] = Array.from({ length: count }, (_, index) => {
    const feature = features[index % features.length], bytes = Buffer.from(JSON.stringify(feature));
    const record = sourceRecord({ index, start: offset, end: offset + bytes.length, raw: bytes,
      feature, valueIssueCode: null });
    offset += bytes.length;
    return record;
  });
  const profile: StreamedProfileGeneration = { ...advanceStreamedInventory(emptyInventory(), raw).inventory,
    version: 'streamed-profile/1', jobId: id, rawJobId: id,
    source: { sourceId: id, familyId: id, sourceRevision: 1, sourceSha256: hash, schemaFingerprint: hash },
    readerSha256: hash, profilerSha256: hash, generation: 1, generationHash: hash, previousHash: null,
    coverage: 'sealed', rawChunkIndex: null, rawResultSha256: null, unknownRemainder: false,
    quarantineLocators: [], reference: { sourceCrs: null, evidence: null, globalPlacement: 'not_qualified' } };
  const plan: StreamedMappingPlan = { version: 'streamed-mapping/1', mode: 'streamed_mapping',
    scope: 'accepted_source_features', caseId: id, caseRevision: 1, source: profile.source,
    rawJobId: id, profileJobId: id, profileGeneration: 1, profileHash: hash, kind: 'building',
    basis: 'officer_stated', semanticEvidence: [], operations: [
      { target: 'feature.sourceKey', sourcePath: '/features/*/geometry', conversionId: 'feature_position@1' },
      { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' },
    ] };
  return { raw, profile, plan, original };
}

async function loaded(name: string, controls: Record<string, any>, transform: (text: string) => string) {
  const globals = globalThis as typeof globalThis & { firstPartTest?: unknown };
  const previous = globals.firstPartTest;
  globals.firstPartTest = controls;
  const folder = await mkdtemp(join(tmpdir(), 'intake-first-part-'));
  const path = fileURLToPath(new URL(`./${name}.ts`, import.meta.url));
  let source = transform(await readFile(path, 'utf8'));
  source = source.replaceAll("'@ulpin/contracts/usp'",
    JSON.stringify(fileURLToPath(import.meta.resolve('@ulpin/contracts/usp'))));
  source = source.replaceAll("'@ulpin/contracts'",
    JSON.stringify(fileURLToPath(import.meta.resolve('@ulpin/contracts'))));
  source = source.replace(/(['"])(\.\.?\/[^'"]+)\1/g,
    (_match, _quote: string, specifier: string) => JSON.stringify(resolve(dirname(path), specifier)));
  const target = join(folder, `${name}.ts`);
  await writeFile(target, 'const controls = globalThis.firstPartTest;\n' + source);
  return { module: await import(pathToFileURL(target).href), close: async () => {
    globals.firstPartTest = previous;
    for (const file of await readdir(folder)) await rm(join(folder, file));
    await rmdir(folder);
  } };
}

function replaceFunction(source: string, name: string, next: string, replacement: string) {
  const start = source.indexOf(`async function ${name}(`), end = source.indexOf(next, start);
  assert(start >= 0 && end > start);
  return source.slice(0, start) + replacement + '\n\n' + source.slice(end);
}

test('publication boundaries do not close packages or EOF; resumed cuts keep ordered hashes', async () => {
  const { raw, plan, profile, original } = await fixture(2100);
  const chunks = Array.from({ length: 21 }, (_, index) => raw.slice(index * 100, (index + 1) * 100));
  const controls: Record<string, any> = { fold: {}, cuts: [], ends: 0 };
  controls.pair = async (_input: unknown, fold: { after: number }, index: number) => {
    controls.reads.push(index);
    const mapped = normalizeMappedChunk(chunks[index], plan, profile, id, index, []).records;
    return pairMappedFeatures(chunks[index], mapped, { ...fold, conflicts: new Set(), kind: 'building' });
  };
  controls.more = async () => false;
  controls.cut = async (_input: unknown, _attempt: unknown, fold: Record<string, any>, cut: any, end: boolean) => {
    if (cut) {
      controls.cuts.push({ index: cut.index, hash: fingerprint(cut) });
      fold.after = cut.features.at(-1).raw.featureIndex;
      fold.parts++;
    }
    if (end) controls.ends++;
    return end ? 'end' : 'more';
  };
  const worker = await loaded('intake-large-worker', controls, source => {
    source = replaceFunction(source, 'foldContext', 'async function sourceName',
      'const foldContext = async () => controls.fold;');
    source = replaceFunction(source, 'pairedChunk', '/** The cut\'s original bytes',
      'const pairedChunk = controls.pair;');
    source = replaceFunction(source, 'draftCut', 'function heartbeat(', 'const draftCut = controls.cut;');
    source = replaceFunction(source, 'moreMapped', '/** Fold published pairs',
      'const moreMapped = (...args) => controls.more(...args);');
    return source + '\nexport {draft};\n';
  });
  try {
    const reset = () => { controls.fold = { firstChunk: 0, chunks: 21, complete: true, metadata: {},
      parts: 0, after: -1, frame: null, started: Date.now(), pending: [] };
      controls.cuts = []; controls.ends = 0; controls.reads = []; };
    const resume = () => { controls.fold.firstChunk = Math.floor((controls.fold.after + 1) / 100); };
    reset();
    await worker.module.draft({}, {});
    resume();
    await worker.module.draft({}, {});
    const whole = structuredClone(controls.cuts);
    assert.equal(controls.ends, 1);
    reset();
    controls.fold.complete = false;
    for (const through of [1, 10]) {
      controls.fold.chunks = through;
      await worker.module.draft({}, {});
      assert.equal(controls.cuts.length, 0, 'an unfinished 100/1000-feature suffix is not a package');
      assert.equal(controls.ends, 0, 'a publication boundary never seals intake');
    }
    controls.fold.chunks = 21;
    await worker.module.draft({}, {});
    assert.equal(controls.cuts.length, 1, 'the first natural cut drafts while mapping is still running');
    assert.equal(controls.ends, 0);
    resume();
    controls.fold.complete = true;
    await worker.module.draft({}, {});
    assert.deepEqual(controls.cuts, whole);
    assert.equal(controls.ends, 1);
    reset();
    Object.assign(controls.fold, { chunks: 1, complete: false });
    controls.more = async () => { controls.fold.chunks++; return controls.fold.chunks <= 21; };
    await worker.module.draft({}, {});
    assert.deepEqual(controls.reads, Array.from({ length: 21 }, (_, index) => index),
      'a live fold reads each newly published chunk once, not every previous unfinished suffix');
    assert.deepEqual(controls.cuts, whole.slice(0, 1));
    assert.deepEqual(await readFile('fixtures/google-uttam/00-all-google-detections.geojson'), original);
  } finally { await worker.close(); }
});

test('raw preflight holds both late duplicates and keeps the first used-field failure before mapping finishes',
  async () => {
    const { raw, plan, profile } = await fixture(201);
    const records = raw.map((record, index) => {
      const feature = { ...(record.feature as object), id: index === 200 ? 0 : index };
      return { ...record, feature };
    });
    const keyed = { ...plan, operations: [{ target: 'feature.sourceKey' as const,
      sourcePath: '/features/*/id', conversionId: 'literal_integer_identifier@1' as const }, plan.operations[1]] };
    const inventory = { ...profile, ...advanceStreamedInventory(emptyInventory(), records).inventory };
    const check = { plan: keyed, profile: inventory, readerJobId: id, keys: new Map(), conflicts: new Set<number>() };
    checkIntakeLargeChunk(check, records.slice(0, 100), 0);
    assert.equal(check.conflicts.size, 0);
    checkIntakeLargeChunk(check, records.slice(100, 200), 1);
    checkIntakeLargeChunk(check, records.slice(200), 2);
    assert.deepEqual([...check.conflicts], [0, 200], 'the first occurrence cannot escape in an early cut');
    const broken = { ...records[200], feature: { ...(records[200].feature as object), id: null } };
    checkIntakeLargeChunk(check, [broken], 2);
    assert.deepEqual((check as typeof check & { failure: unknown }).failure,
      { sourcePath: '/features/*/id', recordOrdinal: 201 });
  });

test('the first and each later ready mapping group queue intake in their fenced publication transaction', async t => {
  const subject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'test_only';
  t.after(() => {
    if (subject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = subject;
  });
  const { raw, plan, profile } = await fixture(2);
  const state = { state: 'running', next_publish_index: 0, records: 0 };
  const events: string[] = [], objects = new Map<string, Buffer>(), wakes: number[] = [];
  let ready = 0, inTransaction = false;
  const slot = (index: number) => ({ chunk_index: index, object_key: 'test_only', chunkIndex: index,
    firstFeatureIndex: index, lastFeatureIndex: index, resultSha256: hash, ref: { key: 'test_only' } });
  const controls = { sha256, putOriginal: async (key: string, bytes: Buffer) => { objects.set(key, bytes); },
    readObject: async (key: string) => objects.get(key),
    raw: async (_input: unknown, row: ReturnType<typeof slot>) => ({ slot: row,
      payload: { records: [raw[row.chunk_index]] } }),
    authority: async () => ({ profile, approved: { receipt: { plan } }, ctx: { binding: ingestionBinding(id) } }),
    event: async () => { assert(inTransaction); events.push('published'); }, wake: async () => {
      assert(inTransaction);
      assert.equal(events.at(-1), 'published');
      assert.equal(state.state, 'running');
      wakes.push(state.next_publish_index);
    } };
  const worker = await loaded('chunk-mapping-worker', controls, source => source
    .replace("import {putOriginal,readObject,sha256} from '../../../infrastructure/storage';",
      'const {putOriginal,readObject,sha256} = controls;')
    .replace("import {assertChunkMappingInputTx} from './chunk-mapping';",
      'const assertChunkMappingInputTx = controls.authority;')
    .replace("import {appendCaseIngestionTx} from './events';", 'const appendCaseIngestionTx = controls.event;')
    .replace("import {queueIntakeLargeTx} from './intake-large';", 'const queueIntakeLargeTx = controls.wake;')
    .replace("import {readPinnedRawChunk} from './streamed-profile-worker';",
      'const readPinnedRawChunk = controls.raw;')
    + '\nexport {publishReadyMappingTx};\n');
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown }, previous = globals.ulpinPool;
  const query = async (sql: string, values: any[] = []) => {
    let row: unknown;
    if (sql === 'BEGIN') inTransaction = true;
    else if (sql === 'COMMIT' || sql === 'ROLLBACK') inTransaction = false;
    else if (sql.startsWith('SELECT status FROM jobs')) row = { status: 'running' };
    else if (sql.includes('FROM usp_job_attempts')) row = { state: 'active', fence: 1, owner: 'test_only',
      input_sha256: hash, lease_until: new Date(Date.now() + 180000) };
    else if (sql.includes('FROM usp_job_metadata')) row = { logical_state: 'running', input_sha256: hash };
    else if (sql.includes('FROM usp_chunk_mapping_imports')) row = state;
    else if (sql.includes('FROM usp_streaming_vector_slots') && values[2] < ready) row = slot(values[2]);
    else if (sql.startsWith('UPDATE usp_chunk_mapping_imports')) {
      state.next_publish_index++;
      state.records += values[1];
    }
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  };
  globals.ulpinPool = { connect: async () => ({ query, release() {} }) };
  try {
    for (const index of [0, 1]) {
      ready = index + 1;
      await transaction(async client => worker.module.publishReadyMappingTx(client,
        { jobId: id, rawJobId: id, sourceId: id, sourceRevision: 1, sourceSha256: hash,
          converterSha256: hash, recipeRevision: 1, caseId: id, subject: 'test_only' },
        { jobId: id, number: 1, fence: 1, owner: 'test_only', inputSha256: hash },
        await controls.authority(), slot(index), index));
    }
    assert.deepEqual(wakes, [1, 2]);
    assert.equal(objects.size, 2);
  } finally { globals.ulpinPool = previous; await worker.close(); }
});
