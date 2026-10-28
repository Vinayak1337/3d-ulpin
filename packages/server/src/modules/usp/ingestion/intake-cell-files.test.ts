import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { S3Client } from '@aws-sdk/client-s3';
import type { Pool, PoolClient } from 'pg';
import { CellDerivativeLineageSchema, CellFeatureRangeSchema } from '@ulpin/contracts/usp';
import { featureCell, featureExtent } from './intake-package-extent';
import { CellFileCollector, cellFileChunks, cellFileWords, cellReceiptWaitWords, retainCellFiles,
  type CellFileDependencies } from './intake-cell-files';
import { intakeReaderRoute } from './intake-draft';
import { cellFileRefs, withCellFiles } from './intake-ledger';
import { cellDerivativeWords } from './intake-text';
import { putOriginalStream } from '../../../infrastructure/storage';
import { settings } from '../../../infrastructure/config';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';
import { transaction } from '../../../infrastructure/db';
import { AppError } from '../../../infrastructure/errors';
import { LargeOriginalService } from './large-original';
import { memoryPool, memoryStorage, withPool } from './large-original-memory.test-fixture';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'cell-receipt-protocol';
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const square = (x: number, y: number, side = 0.0001) => ({ type: 'Feature', properties: {}, geometry: {
  type: 'Polygon', coordinates: [[[x, y], [x + side, y], [x + side, y + side], [x, y + side], [x, y]]] } });
const extent = (x: number, y: number, side?: number) =>
  featureExtent(square(x, y, side), { kind: 'degree' })!;

// Generated protocol controls, test_only; these are not registry records or operational geography.
function control(secondLongitude = -64.001) {
  const features = [square(-64, 45), square(secondLongitude, 45.001)];
  const raw = [Buffer.from(JSON.stringify(features[0]).replace('"properties":{}',
    '"properties": { "note" : "caf\\u00e9", "literal":1e0 }')),
  Buffer.from(JSON.stringify(features[1]))];
  const prefix = Buffer.from('{"type":"FeatureCollection","features":[');
  const original = Buffer.concat([prefix, raw[0], Buffer.from(',\n'), raw[1], Buffer.from(']}')]);
  const ranges = raw.map((bytes, featureIndex) => ({ featureIndex,
    byteStart: prefix.length + (featureIndex ? raw[0].length + 2 : 0),
    byteEnd: prefix.length + (featureIndex ? raw[0].length + 2 : 0) + bytes.length, rawSha256: hash(bytes) }));
  const collector = new CellFileCollector({});
  ranges.forEach((range, index) => collector.add(features[index], range));
  return { raw, original, ranges, collector };
}

async function collect(chunks: AsyncIterable<Uint8Array>) {
  const result: Buffer[] = [];
  for await (const chunk of chunks) result.push(Buffer.from(chunk));
  return Buffer.concat(result);
}

test('cell edges belong east/north, including metric and degree grids, zones and the equator', () => {
  const metric = (x: number, y = 3100000) =>
    featureExtent(square(x, y, 1), { kind: 'utm', epsg: 32643 })!;
  assert.match(featureCell(metric(719999.999), 0).key, /-e17-/);
  assert.match(featureCell(metric(720000), 1).key, /-e18-/);
  assert.match(featureCell(metric(720000, 3119999.999), 1).key, /-n77-/);
  assert.match(featureCell(metric(720000, 3120000), 1).key, /-n78-/);
  assert.match(featureCell(extent(-74.250000001, 40.6), 1).key, /-l211-/);
  assert.match(featureCell(extent(-74.25, 40.6), 1).key, /-l212-/);
  assert.match(featureCell(extent(-74, 40.749999999), 1).key, /-b261/);
  assert.match(featureCell(extent(-74, 40.75), 1).key, /-b262/);
  assert.match(featureCell(extent(5.9998, 28), 2).key, /^utm-32631-/);
  assert.match(featureCell(extent(6, 28), 3).key, /^utm-32632-/);
  assert.match(featureCell(extent(5.99995, 28), 4).key, /-feature-4$/);
  assert.match(featureCell(extent(77, -0.00005), 5).key, /-feature-5$/);
  assert.match(featureCell(extent(179.9998, 28), 6).key, /^utm-32660-/);
  assert.match(featureCell(extent(-180, 28), 7).key, /^utm-32601-/);
  assert.match(featureCell(extent(77, 28, 0.4), 8).key, /-feature-8$/);
});

test('child features keep exact parent bytes, including whitespace, escapes and numeric spelling', async () => {
  const { raw, original, collector } = control();
  const crs = { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::4326' } };
  const child = await collect(cellFileChunks([...collector.cells.values()][0], { crs },
    async (start, end) => original.subarray(start, end)));
  assert.deepEqual(JSON.parse(child.toString()).crs, crs);
  for (const bytes of raw) assert(child.includes(bytes));
  assert.equal(child.includes(Buffer.from('"literal":1e0')), true);
  const withoutCrs = await collect(cellFileChunks([...collector.cells.values()][0], {},
    async (start, end) => original.subarray(start, end)));
  assert.equal(Object.hasOwn(JSON.parse(withoutCrs.toString()), 'crs'), false);
  await assert.rejects(collect(cellFileChunks([...collector.cells.values()][0], {},
    async (start, end) => Buffer.alloc(end - start))), { code: 'CELL_FEATURE_INTEGRITY' });
});

test('GeoJSON-lines byte ranges feed the same cell writer without changing feature bytes or the original', async () => {
  const { raw } = control();
  const original = Buffer.concat([raw[0], Buffer.from('\r\n\n'), raw[1], Buffer.from('\n')]);
  const before = hash(original), collector = new CellFileCollector({});
  const read = await readStreamingFeatures(Readable.from([original]), 'geojson-lines', async item => {
    const record = sourceRecord(item);
    assert.equal(record.disposition, 'accepted');
    collector.add(record.feature as Record<string, unknown>, { featureIndex: record.featureIndex,
      byteStart: record.byteStart, byteEnd: record.byteEnd, rawSha256: record.rawSha256 });
  });
  assert.equal(read.features, 2);
  assert.equal(read.blankLines, 1);
  assert.equal(collector.cells.size, 1);
  const child = await collect(cellFileChunks([...collector.cells.values()][0], {},
    async (start, end) => original.subarray(start, end)));
  for (const bytes of raw) assert.ok(child.includes(bytes));
  assert.deepEqual(JSON.parse(child.toString()).features, raw.map(bytes => JSON.parse(bytes.toString())));
  assert.equal(hash(original), before);
});

test('the cell cap keeps exact overflow counts and says why; no outside features means no cell file', async () => {
  const collector = new CellFileCollector({}, 1);
  const range = { featureIndex: 0, byteStart: 0, byteEnd: 1, rawSha256: hash('x') };
  collector.add(square(-64, 45), range);
  collector.add(square(-60, 45), { ...range, featureIndex: 1 });
  collector.add(square(-60, 45), { ...range, featureIndex: 2 });
  assert.equal(collector.cells.size, 1);
  assert.equal(collector.heldFeatures, 2);
  assert.equal(collector.heldCells.size, 1);
  assert.match(cellFileWords(7, { features: 1, files: 1, held: 2, heldCells: 1, cap: 1, children: [] }),
    /7 features.*own area.*1 feature.*1 cell file.*each.*own item.*2 features.*1.*cell.*limit.*1/s);
  assert.equal(await retainCellFiles({} as never, new CellFileCollector({}), {}, {} as never)
    .then(result => result.files), 0);
});

test('a cell above the unchanged derived receipt ceiling stays held with byte-limit words, not a failed job',
  async () => {
    const { collector } = control();
    const cell = [...collector.cells.values()][0];
    cell.ranges[1].byteEnd = cell.ranges[1].byteStart + 128 * 1024 * 1024;
    const result = await retainCellFiles(parent, collector, {}, {} as never);
    assert.deepEqual([result.files, result.features, result.held, result.largeCells], [0, 0, 2, 1]);
    assert.match(cellFileWords(0, result), /2 features in 1 cells.*128 MiB.*receipt limit/);
    assert.doesNotMatch(cellFileWords(0, result), /cell-file limit/);
  });

type KeptSource = { id: string; sha256: string; lineage: unknown };

function memoryReceipt(sources: Map<string, KeptSource>, files: Buffer[]) {
  let chunks: Buffer[] = [], activeCase = '', finalized = 0;
  const large = {
    create: async (caseId: string) => {
      activeCase = caseId;
      chunks = [];
      return { id: randomUUID(), revision: 1, currentCaseRevision: 1 };
    },
    claimPart: async () => ({}),
    receivePart: async (_claim: unknown, bytes: Uint8Array) => {
      chunks.push(Buffer.from(bytes));
      return { id: 'receipt', revision: 2, currentCaseRevision: 1 };
    },
    finalize: async (_case: string, _id: string, input: { sha256: string }, lineage: unknown) => {
      const bytes = Buffer.concat(chunks);
      assert.equal(hash(bytes), input.sha256);
      const source = { id: randomUUID(), sha256: input.sha256, lineage };
      sources.set(activeCase, source);
      files.push(bytes);
      finalized++;
      return { source: { sourceId: source.id } };
    },
    failPart: async () => {}, abort: async () => {},
  };
  return { large, finals: () => finalized };
}

function dependencies(original: Buffer) {
  const sources = new Map<string, KeptSource>();
  const cases = new Map<string, string>();
  const files: Buffer[] = [], sidecars: Buffer[] = [], registered: { caseId: string; input: any }[] = [];
  const { large, finals } = memoryReceipt(sources, files);
  const client = { query: async (sql: string, values: any[]) => {
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.startsWith('SELECT revision FROM cases')) return { rows: [{ revision: 1 }] };
    if (sql.startsWith('SELECT created_at FROM sources')) return { rows: [{ created_at: new Date() }] };
    if (sql.includes("inspection->'cellDerivative'")) {
      const source = sources.get(values[0]);
      return { rows: source ? [source] : [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } } as unknown as PoolClient;
  const deps = {
    transaction: async (work: (value: PoolClient) => Promise<unknown>) => work(client),
    read: async (start: number, end: number) => original.subarray(start, end),
    createCase: async (input: { requestKey: string }) => {
      if (!cases.has(input.requestKey)) cases.set(input.requestKey, randomUUID());
      return { caseId: cases.get(input.requestKey)! };
    },
    putSidecar: async (_ref: unknown, body: AsyncIterable<Uint8Array>) => { sidecars.push(await collect(body)); },
    // The batch lists an enrolled source as its own top-level item, whose id is the source id.
    register: async (caseId: string, input: any) => {
      registered.push({ caseId, input });
      return { itemId: input.sourceId };
    },
    beat: async () => {},
    large,
  } as unknown as CellFileDependencies;
  return { deps, files, sidecars, registered, cases, sources, finals };
}

const parent = { id: randomUUID(), revision: 3, sha256: hash('parent'), name: 'parent.geojson',
  case_id: randomUUID(), itemId: randomUUID() };

test('lineage parses, records every parent range in the hashed sidecar, and replay keeps only one child', async () => {
  const { original, collector, ranges } = control();
  const { deps, files, sidecars, registered, cases, sources, finals } = dependencies(original);
  const result = await retainCellFiles(parent, collector, {}, deps);
  assert.deepEqual([result.files, result.features, result.held], [1, 2, 0]);
  const lineage = CellDerivativeLineageSchema.parse([...sources.values()][0].lineage);
  assert.deepEqual([lineage.parentSourceId, lineage.parentSourceRevision, lineage.parentSha256],
    [parent.id, 3, parent.sha256]);
  assert.match(cellDerivativeWords(lineage)!, new RegExp(`Derived from parent.geojson, cell ${lineage.cellKey}`));
  assert.match(cellDerivativeWords(lineage)!, /every card needs officer confirmation/);
  assert.equal(lineage.members.sha256, hash(sidecars[0]));
  assert.equal(lineage.members.bytes, sidecars[0].length);
  assert.deepEqual(sidecars[0].toString().trim().split('\n').map(line =>
    CellFeatureRangeSchema.parse(JSON.parse(line))), ranges);
  assert.notEqual(registered[0].caseId, parent.case_id);
  assert.equal(registered[0].caseId, [...cases.values()][0]);
  assert.equal(files.length, 1);
  assert.deepEqual(await retainCellFiles(parent, collector, {}, deps), result);
  assert.equal(finals(), 1);
  assert.equal(registered[0].input.requestKey, registered[1].input.requestKey);
  assert.equal(CellDerivativeLineageSchema.safeParse({ ...lineage, parentSha256: 'bad' }).success, false);
});

test('range sidecars use the existing immutable stream writer without widening its key scope', async () => {
  const { original, collector } = control();
  const { deps } = dependencies(original);
  let written = 0;
  for (const [name, value] of [['s3Endpoint', 'http://127.0.0.1:1'], ['s3Region', 'us-east-1'],
    ['s3Bucket', 'cell-test-only'], ['s3AccessKey', 'cell-test-only'], ['s3SecretKey', 'cell-test-only']] as const)
    mock.getter(settings, name, () => value);
  mock.method(S3Client.prototype, 'send', async (command: any) => {
    if (command.constructor.name === 'GetBucketVersioningCommand') return { $metadata: { httpStatusCode: 200 } };
    assert.equal(command.constructor.name, 'PutObjectCommand');
    assert.match(command.input.Key, /^large-originals\/[a-f0-9-]{36}\/[a-f0-9]{64}$/);
    assert.equal(command.input.IfNoneMatch, '*');
    const bytes = await collect(command.input.Body);
    assert.equal(bytes.length, command.input.ContentLength);
    assert.equal(hash(bytes), command.input.Metadata.sha256);
    written++;
    return {};
  });
  deps.putSidecar = async (ref, chunks) => {
    await putOriginalStream(ref.key, Readable.from(chunks), ref.bytes, 'application/x-ndjson', ref.sha256,
      AbortSignal.timeout(1000));
  };
  try {
    await retainCellFiles(parent, collector, {}, deps);
    assert.equal(written, 1);
  } finally {
    mock.restoreAll();
  }
});

test('different cells enrol in different unassigned cases, never in the already site-bound parent case', async () => {
  const { original, collector } = control(-60);
  const { deps, registered, cases, finals } = dependencies(original);
  assert.equal((await retainCellFiles(parent, collector, {}, deps)).files, 2);
  assert.equal(cases.size, 2);
  assert.equal(new Set(registered.map(entry => entry.caseId)).size, 2);
  assert(registered.every(entry => entry.caseId !== parent.case_id));
  await retainCellFiles(parent, collector, {}, deps);
  assert.equal(finals(), 2);
  assert.equal(cases.size, 2);
});

test('a stop after finalize is found by lineage on retry, even without a completed enrolment', async () => {
  const { original, collector } = control();
  const { deps, finals } = dependencies(original);
  let stopped = false;
  const register = deps.register;
  deps.register = async (caseId, input) => {
    if (!stopped) {
      stopped = true;
      throw new Error('Interrupted after retention');
    }
    return register(caseId, input);
  };
  await assert.rejects(retainCellFiles(parent, collector, {}, deps), /Interrupted after retention/);
  assert.equal((await retainCellFiles(parent, collector, {}, deps)).files, 1);
  assert.equal(finals(), 1);
});

for (const path of ['fixtures/real-nyc/original.geojson',
  'fixtures/google-uttam/00-all-google-detections.geojson']) {
  test(`real retained ranges keep exact original bytes through the cell receipt: ${path}`, async () => {
    const original = readFileSync(path), before = hash(original), collector = new CellFileCollector({});
    let taken = 0;
    const read = await readStreamingFeatures(Readable.from([original]), 'feature-collection', async item => {
      const record = sourceRecord(item);
      if (record.disposition !== 'accepted' || taken >= 5) return;
      collector.add(record.feature as Record<string, unknown>, { featureIndex: record.featureIndex,
        byteStart: record.byteStart, byteEnd: record.byteEnd, rawSha256: record.rawSha256 });
      taken++;
    });
    const { deps, files } = dependencies(original);
    const result = await retainCellFiles({ ...parent, sha256: before, name: path.split('/').at(-1)! },
      collector, read.metadata, deps);
    assert.equal(result.features, taken);
    assert.ok(taken > 0);
    for (const cell of collector.cells.values()) for (const range of cell.ranges)
      assert.ok(files.some(file => file.includes(original.subarray(range.byteStart, range.byteEnd))));
    const cell = [...collector.cells.values()][0];
    await assert.rejects(collect(cellFileChunks(cell, read.metadata,
      async (start, end) => Buffer.alloc(end - start))), { code: 'CELL_FEATURE_INTEGRITY' });
    assert.equal(hash(readFileSync(path)), before);
  });
}

test('quota holds cells with bounded words, then a later step keeps them without duplicate children', async () => {
  const { original, collector } = control(-60);
  const { deps, finals, cases } = dependencies(original);
  const create = deps.large.create;
  deps.large.create = async () => { throw new AppError(429, 'UPLOAD_QUOTA', 'Full.'); };
  const held = await retainCellFiles(parent, collector, {}, deps);
  assert.deepEqual([held.files, held.held, held.receiptWait?.cells], [0, 2, 2]);
  assert.ok(held.receiptWait!.retryAt! >= Date.now() + 1000);
  assert.match(cellFileWords(0, held), /Waiting for a free receipt.*automatically.*30 minutes/);
  assert.doesNotMatch(cellFileWords(0, held), /cell-file limit/);
  deps.large.create = create;
  const kept = await retainCellFiles(parent, collector, {}, deps);
  assert.deepEqual([kept.files, kept.held, kept.children.length, cases.size, finals()], [2, 0, 2, 2, 2]);
});

test('a receipt wait ends at the parent retention bound; other refusals still fail', async () => {
  const { original, collector } = control();
  const { deps } = dependencies(original);
  deps.transaction = (async work => work({ query: async (sql: string) => {
    if (sql.startsWith('SELECT created_at')) return { rows: [{ created_at: new Date(Date.now() - 1800001) }] };
    if (sql.startsWith('SELECT revision')) return { rows: [{ revision: 1 }] };
    return { rows: [] };
  } } as unknown as PoolClient)) as typeof transaction;
  deps.large.create = async () => { throw new AppError(429, 'UPLOAD_QUOTA', 'Full.'); };
  const result = await retainCellFiles(parent, collector, {}, deps);
  assert.equal(result.receiptWait!.retryAt, null);
  assert.match(cellFileWords(0, result), /allowance stayed full.*30-minute bound/);
  deps.large.create = async () => { throw new AppError(409, 'STALE_REVISION', 'Changed.'); };
  await assert.rejects(retainCellFiles(parent, collector, {}, deps), { code: 'STALE_REVISION' });
});

for (const phase of ['hash', 'sidecar', 'copy', 'parts', 'assembly'] as const) {
  test(`an upload create and part claim return within 1 s while a same-case cell waits on ${phase}`, async t => {
    const { original, collector } = control(), caseId = randomUUID();
    const { db, pool } = memoryPool(caseId), { storage } = memoryStorage();
    const locks = new Map<string, number>(), wake = new Set<() => void>();
    let connection = 0, release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { entered = resolve; });
    let paused = false;
    const slow = async () => {
      if (paused) return;
      paused = true;
      entered();
      await gate;
    };
    const lockedPool = { connect: async () => {
      const client = await pool.connect(), id = ++connection;
      return { release: () => client.release(), query: async (sql: string, values: any[] = []) => {
        const key = sql.includes('pg_advisory_xact_lock') ? values[0] ?? 'large-original-quota-v1'
          : sql.includes('FROM cases') && sql.includes('FOR UPDATE') ? `case:${values[0]}` : null;
        if (key) {
          while (locks.has(key) && locks.get(key) !== id) await new Promise<void>(resolve => wake.add(resolve));
          locks.set(key, id);
        }
        if (['COMMIT', 'ROLLBACK'].includes(sql)) {
          for (const [key, owner] of locks) if (owner === id) locks.delete(key);
          for (const resume of wake) resume();
          wake.clear();
        }
        if (sql.includes("inspection->'cellDerivative'")) return { rows: [...db.sources.values()]
          .filter(source => source.inspection?.cellDerivative).map(source => ({ id: source.id })) };
        return client.query(sql, values);
      } };
    } } as unknown as Pool;
    const put = storage.putPartObject, read = storage.readPartObject;
    storage.putPartObject = async (...args) => { if (phase === 'parts') await slow(); return put(...args); };
    storage.readPartObject = async (...args) => { if (phase === 'assembly') await slow(); return read(...args); };
    await withPool(lockedPool, async () => {
      const service = new LargeOriginalService(storage);
      const { deps } = dependencies(original);
      deps.transaction = transaction;
      deps.large = service;
      deps.beat = () => transaction(async client => {
        await client.query('SELECT id,revision FROM cases WHERE id=$1 FOR UPDATE', [caseId]);
      });
      deps.createCase = async () => ({ caseId });
      let reads = 0;
      deps.read = async (start, end) => {
        reads++;
        if (phase === 'hash' || phase === 'copy' && reads === 2) await slow();
        return original.subarray(start, end);
      };
      deps.putSidecar = async () => { if (phase === 'sidecar') await slow(); };
      const writing = retainCellFiles(parent, collector, {}, deps);
      await Promise.race([ready, writing.then(() => assert.fail('The slowed byte phase was not reached.'))]);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const request = (async () => {
        const started = performance.now();
        const receipt = await service.create(caseId, { requestKey: randomUUID(), expectedCaseRevision: 0,
          filename: 'test_only.bin', bytes: 1, sha256: hash('x'), mediaType: 'application/octet-stream',
          provenance: { origin: 'not_stated', acquiredAt: new Date().toISOString() } });
        await service.claimPart(caseId, receipt.id, { requestKey: randomUUID(), expectedRevision: receipt.revision,
          expectedCaseRevision: 0, partNumber: 1, sha256: hash('x') });
        t.diagnostic(`${phase}: create plus part claim ${Math.ceil(performance.now() - started)} ms`);
      })();
      try {
        assert.ok([...locks.keys()].every(key => key.startsWith('cell-derivative/1:')));
        await Promise.race([request, new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Create or part waited behind cell bytes for 1 s.')), 1000);
        })]);
      } finally {
        clearTimeout(timeout);
        release();
        await Promise.all([writing, request]);
      }
    });
  });
}

test('a quota-refused cell step completes, queues a later step, and that step writes the cell', async () => {
  const text = readFileSync(new URL('./intake-large-worker.ts', import.meta.url), 'utf8');
  const functions = ['complete', 'draftCut', 'step'].map(name => {
    const start = text.indexOf(`async function ${name}(`);
    return text.slice(start, text.indexOf('\n/**', start));
  });
  const { original, collector } = control(), { deps, finals } = dependencies(original);
  const create = deps.large.create;
  deps.large.create = async () => { throw new AppError(429, 'UPLOAD_QUOTA', 'Full.'); };
  const input = { sourceId: parent.id, caseId: parent.case_id, itemId: parent.itemId,
    jobId: randomUUID(), stateKey: 'first' };
  const state = { key: 'first', item: { state: 'preparing' }, source: {}, store: { unreviewed: 0 } };
  const jobs: { status: string; next?: string }[] = [{ status: 'running' }];
  let words = '', published = 0, ended = 0, marker: unknown;
  const client = { query: async (sql: string, values: any[]) => {
    if (sql.startsWith('UPDATE sources')) marker = JSON.parse(values[1]);
    else if (sql.startsWith('UPDATE jobs SET next_attempt_at')) jobs.at(-1)!.next = values[1];
    else if (!sql.startsWith('UPDATE jobs SET dispatched_at')) assert.fail(sql);
    return { rows: [] };
  } };
  const fold = () => ({ cutKey: 'cut', pending: [], held: {}, mappingJobId: randomUUID(),
    chunkReadMs: 0, chunkReads: 0 });
  const controls = {
    fingerprint: (value: unknown) => JSON.stringify(value), assertIntakeDraftTx: async () => {},
    pinned: async (_input: unknown, _attempt: unknown, work: any) => work(client, state),
    largeStateKey: async () => state, intakeLargeCutKey: () => 'cut',
    intakeLargeAtRest: () => ended > 0, retiredFileAreaWords: async () => null, intakeLargePhase: () => 'draft',
    intakeLargeRows: () => ({}), INTAKE_UNFINISHED_PACKAGE_LIMIT: 8,
    partStageTimer: () => () => {}, heldThrough: () => ({}), countHeld: () => ({ heldOutside: 2 }),
    deriveCellFiles: () => retainCellFiles(parent, collector, {}, deps),
    readIntakeDraftTx: async () => ({ state: 'preparing' }),
    writeIntakeDraftTx: async (_client: unknown, _case: unknown, _item: unknown, draft: any) => {
      words = draft.limitReason;
    }, cellReceiptWaitWords, cellPlanTx: async () => {}, writeEndTx: async () => { ended++; },
    publishTx: async () => { published++; }, console: { info: () => {} },
    acceptUspJobAttempt: async (_attempt: unknown, _ref: unknown, validate: any, before: any, after: any) => {
      await before(client);
      await validate(client, { payload: input });
      jobs.at(-1)!.status = 'succeeded';
      await after(client);
    },
    queueIntakeLargeTx: async () => {
      if (ended) return null;
      assert.deepEqual(marker, { jobId: input.jobId });
      jobs.push({ status: 'queued' });
      return randomUUID();
    },
  };
  const js = ts.transpileModule(functions.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = new Function(...Object.keys(controls), 'draft',
    `${js}; return { step, draftCut };`)(...Object.values(controls), async (...args: unknown[]) => {
    const current = fold();
    await loaded.draftCut(...args, current, undefined, true);
    return (current as { retryAt?: number }).retryAt;
  });
  await loaded.step(input, {});
  assert.deepEqual(jobs.map(job => job.status), ['succeeded', 'queued']);
  assert.ok(Date.parse(jobs[1].next!) > Date.now());
  assert.match(words, /Waiting for a free receipt/);
  assert.deepEqual([published, ended, finals()], [0, 0, 0]);
  deps.large.create = create;
  state.key = 'next';
  jobs[1].status = 'running';
  input.stateKey = 'next';
  await loaded.step(input, {});
  assert.deepEqual(jobs.map(job => job.status), ['succeeded', 'succeeded']);
  assert.deepEqual([ended, finals()], [1, 1]);
});

test('a cell derivative takes the existing streamed GeoJSON route even if it is small', () => {
  assert.equal(intakeReaderRoute({ format: 'geojson', counts: { features: 1 } } as never,
    { bytes: 300, inspection: { cellDerivative: { version: 'cell-derivative/1' } } }), 'streamed_geojson');
});

test('CN1: each retained cell names its own case, source and item, and a replay stores none twice', async () => {
  const { original, collector } = control(-60);
  const { deps, registered, cases, sources } = dependencies(original);
  const result = await retainCellFiles(parent, collector, {}, deps);
  assert.equal(result.children.length, 2);
  assert.deepEqual(result.children.map(child => child.cellKey), [...collector.cells.keys()]);
  for (const child of result.children) {
    assert.notEqual(child.caseId, parent.case_id);
    assert.equal(sources.get(child.caseId)?.id, child.sourceId);
    assert.equal(child.itemId, child.sourceId);
    assert(registered.some(entry => entry.caseId === child.caseId && entry.input.sourceId === child.sourceId));
  }
  assert.equal(new Set(result.children.map(child => child.caseId)).size, cases.size);
  const plan = { recipeId: parent.id, recipeRevision: 1, recipeState: 'approved', origin: 'officer', packageId: null };
  const stored = withCellFiles(plan, result.children);
  assert.deepEqual(cellFileRefs(stored), result.children);
  const replay = await retainCellFiles(parent, collector, {}, deps);
  assert.deepEqual(replay.children, result.children);
  // The end result is replaced, never appended: a replay, or the same cell twice, keeps one entry per cell.
  assert.deepEqual(withCellFiles(stored, replay.children), stored);
  assert.equal(cellFileRefs(withCellFiles(plan, [...result.children, ...replay.children])).length, 2);
  assert.equal(withCellFiles(plan, []), plan);
  assert.equal(withCellFiles(null, undefined), null);
});

test('CN1: an enrolment that names no batch item is refused rather than linked to nothing', async () => {
  const { original, collector } = control();
  const { deps } = dependencies(original);
  deps.register = async () => undefined;
  await assert.rejects(retainCellFiles(parent, collector, {}, deps), /enrolled without its batch item/);
});
