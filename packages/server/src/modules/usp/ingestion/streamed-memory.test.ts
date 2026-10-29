import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { AnyStreamedMappingPlanSchema, IntakeLayoutMemorySchema, StreamedMappingReceiptSchema,
  type StreamedProfileGeneration } from '@ulpin/contracts/usp';
import { fingerprint } from '../../cases/domain';
import { AppError } from '../../../infrastructure/errors';
import { localOperatorSubject } from '../principal';
import { probeOriginal } from './intake-probe';
import { IntakeService } from './intake-service';
import { readingOf } from './intake-reading';
import { streamedLayoutMemory, streamedLayoutMemoryTx } from './streamed-memory';
import { streamedGenerationHash } from './streamed-profile';
import { advanceStreamedInventory, emptyInventory } from './streamed-profile-inventory';
import { sourceRecord } from './streaming-vector-reader';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'test_only-layout-memory';
const id = (n: number) => `46000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = 'a'.repeat(64), at = '2026-10-25T00:00:00.000Z';
const caseId = id(1), itemId = id(2), sourceId = id(3), jobId = id(4), rawJobId = id(5);
// test_only layout protocol: no operational records or expected publisher meanings.
const keyPath = '/features/*/properties/OBJECTID', namePath = '/features/*/properties/NAME';
const paths = [{ path: keyPath, types: ['number'], integers: 3 }, { path: namePath, types: ['string'] },
  { path: '/features/*/geometry', types: ['object'] }].map(path => ({ ...path,
  values: 3, explicitNull: 0, absent: 0, unknown: 0 }));
function profile(source = sourceId, job = jobId, prefix = false): StreamedProfileGeneration {
  const body = { version: 'streamed-profile/1', jobId: job, rawJobId,
    source: { sourceId: source, familyId: source, sourceRevision: 1, sourceSha256: hash, schemaFingerprint: hash },
    readerSha256: hash, profilerSha256: hash, generation: 0, generationHash: hash, previousHash: null,
    coverage: prefix ? 'provisional' : 'sealed', rawChunkIndex: prefix ? 0 : null,
    rawResultSha256: prefix ? hash : null, recordsSeen: 3, accepted: 3, quarantined: 0,
    unknownRemainder: prefix, paths, geometryTypes: ['Polygon'], quarantineLocators: [],
    reference: { sourceCrs: 'EPSG:4326', evidence: 'test_only', unit: 'degree',
      globalPlacement: 'not_qualified' } } as StreamedProfileGeneration;
  body.generationHash = streamedGenerationHash(body);
  body.source.schemaFingerprint = body.generationHash;
  return body;
}
function receipt(inventory: StreamedProfileGeneration) {
  const prefix = inventory.coverage === 'provisional';
  const plan = AnyStreamedMappingPlanSchema.parse({
    version: prefix ? 'streamed-prefix-mapping/1' : 'streamed-mapping/1',
    scope: prefix ? 'observed_prefix_and_later_compatible_features' : 'accepted_source_features',
    mode: 'streamed_mapping', source: inventory.source, caseId, caseRevision: 1, rawJobId,
    profileJobId: inventory.jobId, profileGeneration: inventory.generation, profileHash: inventory.generationHash,
    ...(prefix ? { prefix: { throughRawChunkIndex: 0, rawResultSha256: hash, recordsSeen: 3, accepted: 3 } } : {}),
    kind: 'parcel', basis: 'officer_stated', semanticEvidence: [], operations: [
      { target: 'feature.sourceKey', sourcePath: keyPath, conversionId: 'literal_integer_identifier@1' },
      { target: 'feature.name', sourcePath: namePath, conversionId: 'literal_text@1' },
      { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' }] });
  const planHash = fingerprint(plan);
  return StreamedMappingReceiptSchema.parse({ id: id(9), revision: 2, state: 'approved', plan, planHash,
    authoredBy: localOperatorSubject(), authoredAt: at, approval: { subject: localOperatorSubject(), at, planHash,
      provenance: 'server_configured_local_operator' } });
}
async function fixture(prefix = false, priorPrefix = prefix) {
  const bytes = Buffer.from('{"type":"FeatureCollection","features":[]}');
  const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, 'test_only.geojson');
  const current = profile(sourceId, jobId, prefix), old = profile(id(6), id(7), priorPrefix);
  const source = { id: sourceId, case_id: caseId, family_id: sourceId, revision: 1, name: 'second.geojson',
    profile: 'large-original-v1', bytes: 20_000_000, sha256: hash, object_key: 'never-read', status: 'received',
    inspection: { largeOriginal: { uploadId: sourceId, operatorSubject: localOperatorSubject(), objectEtag: 'test_only',
      verifiedSha256: hash, verifiedBytes: 20_000_000, conversion: 'unsupported',
      bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed', provenance: { issuer: 'test_only',
        originalUrl: 'https://example.invalid/test_only', acquiredAt: at, permissionReference: 'test_only',
        limitations: [], state: 'caller_declared' } } } };
  const item = { item_id: itemId, source_id: sourceId, case_id: caseId, parent_item_id: null, member_path: null,
    family: 'vector', format: 'geojson', size_bytes: source.bytes, size_class: 'L', wave: 1, state: 'probed',
    placement: 'needs_answer', card, card_sha256: fingerprint(card), probe_version: card.version,
    plan_ref: prefix ? { layoutProfile: { generation: 0, generationHash: current.generationHash,
      coverage: 'provisional', recordsSeen: 3, accepted: 3 } } : {}, streamed_profile_job_id: jobId,
    parts_planned: null, parts_done: 1, records_seen: 3, pinned_by_officer: false, created_at: at, updated_at: at };
  const input = { version: 'streamed-profile/1', jobId, caseId, caseRevision: 1, sourceId, sourceRevision: 1,
    sourceFamilyId: sourceId, sourceSha256: hash, rawJobId, rawInputFingerprint: hash, readerSha256: hash,
    profilerSha256: hash, subject: localOperatorSubject(), accessBinding: hash, inputFingerprint: hash };
  const row = { body: receipt(old) as any, inventory: old, body_sha256: fingerprint(old),
    reading_source: { ...structuredClone(source), id: id(6), name: 'first.geojson' } };
  const rows = [row], statements: string[] = [], loads: string[] = [];
  const stored: Record<string, unknown> = {};
  const client = { release() {}, query: async (sql: string, values: unknown[] = []) => {
    statements.push(sql);
    assert.match(sql, /^(SELECT|BEGIN|COMMIT|ROLLBACK)/, 'no writes, approvals or queued work');
    if (sql.includes('LIMIT 65')) return { rows: [] };
    if (sql.startsWith('SELECT i.*') || sql.includes('FROM usp_intake_items i')) return { rows: [{ ...item,
      name: source.name, streamed_profile_job_id: sql.includes("i.card->>'format'='geojson'")
        && item.card.format !== 'geojson' ? null : jobId }] };
    if (sql.includes('SELECT r.body')) {
      assert.match(sql, /LIMIT 50/);
      assert.match(sql, /approval'->>'at' DESC/);
      assert.equal(values[0], localOperatorSubject());
      return { rows };
    }
    if (sql.includes('FROM cases')) return { rows: [{ id: caseId, revision: 1, archived: false }] };
    if (sql.includes('FROM usp_streamed_profile_imports p')) return { rows: [{ payload: input,
      sealed_generation: 0, hash: current.generationHash }] };
    if (sql.startsWith('SELECT s.inspection')) return { rows: [stored] };
    if (sql.includes('FROM sources')) return { rows: [source] };
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    assert.fail(sql);
  } } as unknown as PoolClient;
  const load = async (mode: string, _client: PoolClient, job: string, generation: number, digest: string) => {
    loads.push(mode);
    assert.equal(job, jobId);
    assert.equal(generation, current.generation);
    assert.equal(digest, current.generationHash);
    return { input: input as any, profile: current };
  };
  const deps = { transaction: async <T>(action: (c: PoolClient) => Promise<T>) => action(client),
    sealed: load.bind(null, 'sealed'), prefix: load.bind(null, 'prefix') };
  const read = () => streamedLayoutMemory(caseId, itemId, deps);
  return { read, deps, client, current, old, row, rows, item, source, input, stored, statements, loads };
}

test('sealed and prefix memory fills a second large file and its reading, without copying approval', async () => {
  for (const prefix of [false, true]) for (const priorPrefix of [false, true]) {
    const f = await fixture(prefix, priorPrefix), original = JSON.stringify(f.source);
    f.row.body.state = 'proposed';
    assert.equal((await f.read()).memory, null);
    f.row.body.state = 'approved';
    const answer = await f.read();
    assert.deepEqual(IntakeLayoutMemorySchema.parse(answer), answer);
    assert.deepEqual(answer.memory, { kind: 'parcel', operations: f.row.body.plan.operations.map(
      ({ target, sourcePath }: any) => ({ target, sourcePath })),
    recipeId: id(9), name: 'first.geojson', approvedAt: at });
    assert.equal(answer.words,
      'Filled in from the layout you approved for first.geojson on 25 October 2026; '
      + 'check it and approve. Fields used: OBJECTID, NAME, geometry.');
    assert.doesNotMatch(answer.words, /T\d\d:|Z\b|\/features\/\*/);
    assert.equal(IntakeLayoutMemorySchema.safeParse({ ...answer,
      memory: { ...answer.memory, approval: f.row.body.approval } }).success, false);
    const service = new IntakeService({ transaction: f.deps.transaction,
      layoutMemory: (client, c, i) => streamedLayoutMemoryTx(client, c, i, f.deps) });
    const reading = await service.reading(caseId, itemId);
    assert.equal(reading.fields.find(field => field.field === keyPath)?.basis, 'memory');
    assert.equal(reading.fields.find(field => field.field === namePath)?.basis, 'memory');
    assert.match(reading.fields.find(field => field.field === keyPath)!.words, /OBJECTID identifies each parcel/);
    assert.match(reading.fields.find(field => field.field === namePath)!.words, /NAME holds the parcel name/);
    assert.doesNotMatch(reading.fields.map(field => field.words).join(' '), /[Bb]uilding|\/features\/\*/);
    assert.equal(reading.drawing.as, answer.memory?.kind);
    assert.equal(reading.drawing.basis, 'memory');
    assert.ok(reading.question);
    assert.ok(f.loads.every(mode => mode === (prefix ? 'prefix' : 'sealed')));
    assert.doesNotMatch(JSON.stringify(answer), /approval|conversionId|semanticEvidence/);
    assert.ok(f.statements.every(sql => sql.startsWith('SELECT')));
    assert.equal(JSON.stringify(f.source), original, 'the retained original is unchanged');
  }
});

test('a converter-recorded receipt is never offered as an officer layout memory', async () => {
  const f = await fixture();
  f.row.body.plan.basis = 'converter_recorded';
  f.row.body.plan.semanticEvidence = [];
  f.row.body.plan.converterPin = { method: 'converter:citygml-ground-outline@1', derivativeSha256: hash,
    derivativeBytes: f.source.bytes, originalSourceId: id(20), originalSourceRevision: 1, originalSha256: hash };
  f.row.body.planHash = fingerprint(f.row.body.plan);
  f.row.body.approval = { subject: null, at, planHash: f.row.body.planHash, provenance: 'converter_recorded' };
  assert.equal(StreamedMappingReceiptSchema.safeParse(f.row.body).success, true);
  assert.equal((await f.read()).memory, null);
});

test('missing and changed key types name the field; incompatible geometry has no memory', async () => {
  for (const change of ['missing', 'string', 'incomplete', 'geometry']) {
    const f = await fixture();
    f.current.paths = f.current.paths.filter(path => change !== 'missing' || path.path !== keyPath)
      .map(path => change === 'string' && path.path === keyPath ? { ...path, types: ['string'] } : path);
    if (change === 'incomplete') f.current.paths = f.current.paths.map(path => path.path === keyPath
      ? { ...path, values: 2, integers: 2, absent: 1 } : path);
    if (change === 'geometry') f.current.geometryTypes = ['LineString'];
    const answer = await f.read();
    assert.equal(answer.memory, null);
    assert.ok(answer.words.includes(change === 'geometry' ? 'shapes' : 'OBJECTID'));
    assert.doesNotMatch(answer.words, /\/features\/\*/);
  }
});

test('large line and sequence items get the same memory in the answer and reading card', async () => {
  for (const format of ['ndjson', 'geojson-seq']) {
    const f = await fixture(true);
    f.item.card.format = format;
    f.item.format = format;
    const answer = await f.read();
    assert.equal(answer.memory?.kind, 'parcel');
    const service = new IntakeService({ transaction: f.deps.transaction,
      layoutMemory: (client, c, i) => streamedLayoutMemoryTx(client, c, i, f.deps) });
    const reading = await service.reading(caseId, itemId);
    assert.equal(reading.fields.find(field => field.field === keyPath)?.basis, 'memory');
    assert.equal(reading.fields.find(field => field.field === namePath)?.basis, 'memory');
    assert.ok(f.loads.length >= 2, 'the card reads memory even without a collection-only manifest marker');
  }
});

test('memory read refusals leave the card and stored profile intact; unexpected errors still throw', async () => {
  const f = await fixture();
  const profile = { paths: f.current.paths.map(({ path, types, values, explicitNull, absent }) => ({
    path, types, values, explicitNull, absent, literalIdEligible: false, literalTextEligible: false })) };
  f.stored.profile = profile;
  const expected = readingOf({ ...f.item, name: f.source.name, plan_ref: null }, f.item.card, { profile });
  const read = (error: Error) => new IntakeService({ transaction: f.deps.transaction,
    layoutMemory: async () => { throw error; } }).reading(caseId, itemId);
  for (const status of [403, 404, 409, 422]) {
    const card = await read(new AppError(status, 'TEST_ONLY_MEMORY_UNAVAILABLE', 'Inventory unavailable.'));
    assert.deepEqual(card, expected);
    assert.ok(card.fields.length > 0, 'the earlier stored profile is retained');
    assert.ok(card.fields.every(field => field.basis !== 'memory'));
  }
  for (const error of [new AppError(500, 'TEST_ONLY_MEMORY_FAILED', 'Unexpected failure.'), new Error('Unexpected')]) {
    await assert.rejects(read(error), error);
  }
});

test('remembered kind names are written directly for key and name fields', async () => {
  const f = await fixture(), { memory } = await f.read();
  assert.ok(memory);
  for (const kind of ['building', 'parcel', 'road', 'public_land', 'utility'] as const) {
    const card = readingOf({ ...f.item, plan_ref: null }, f.item.card, { layoutMemory: { ...memory, kind } });
    const noun = kind === 'public_land' ? 'public land' : kind;
    assert.ok(card.fields.find(field => field.field === keyPath)!.words.includes(`OBJECTID identifies each ${noun}`));
    assert.ok(card.fields.find(field => field.field === namePath)!.words.includes(`NAME holds the ${noun} name`));
  }
});

test('subjects, access, approval state, revision pins and inventory hashes gate memory', async () => {
  for (const change of ['subject', 'access', 'proposed', 'same', 'hash']) {
    const f = await fixture();
    if (change === 'subject') f.row.body.approval.subject = 'test_only-other';
    if (change === 'access') f.row.reading_source.inspection.largeOriginal.operatorSubject = 'test_only-other';
    if (change === 'proposed') f.row.body.state = 'proposed';
    if (change === 'same') f.row.body = receipt(f.current);
    if (change === 'hash') f.row.body_sha256 = hash;
    const answer = await f.read();
    assert.equal(answer.memory, null, change);
    assert.match(answer.words, /No earlier layout/);
  }
  const f = await fixture();
  f.rows.unshift({ ...f.row, body: { ...f.row.body, state: 'proposed' } });
  assert.ok((await f.read()).memory, 'the first usable recent recipe wins');
  f.row.body.state = 'executed';
  assert.ok((await f.read()).memory, 'executed recipes retain their local approval');
  f.item.plan_ref = { layoutProfile: { generation: 0, generationHash: hash, coverage: 'sealed',
    recordsSeen: 3, accepted: 3 } };
  await assert.rejects(f.read(), { status: 409 });
  const stale = await fixture();
  stale.input.sourceRevision++;
  await assert.rejects(stale.read(), { status: 409 });
  const bounded = await fixture();
  const proposed = { ...bounded.row, body: { ...bounded.row.body, state: 'proposed' } };
  bounded.rows.unshift(...Array.from({ length: 50 }, () => proposed));
  assert.equal((await bounded.read()).memory, null, 'only the newest fifty may be considered');
});

test('real NYC inventory matches its used field; a road file missing that field does not', async () => {
  const f = await fixture();
  const inventory = (path: string) => {
    const collection = JSON.parse(readFileSync(path, 'utf8'));
    const records = collection.features.map((feature: any, index: number) => {
      const raw = Buffer.from(JSON.stringify(feature));
      return sourceRecord({ index, start: index * raw.length, end: (index + 1) * raw.length,
        raw, feature, valueIssueCode: null });
    });
    return advanceStreamedInventory(emptyInventory(), records).inventory;
  };
  Object.assign(f.old, inventory('fixtures/real-nyc/original.geojson'));
  f.old.generationHash = streamedGenerationHash(f.old);
  f.old.source.schemaFingerprint = f.old.generationHash;
  f.row.body = receipt(f.old);
  f.row.body.plan.operations = [
    { target: 'feature.sourceKey', sourcePath: '/features/*/properties/bin', conversionId: 'literal_identifier@1' },
    { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' }];
  f.row.body.planHash = fingerprint(f.row.body.plan);
  f.row.body.approval.planHash = f.row.body.planHash;
  f.row.body_sha256 = fingerprint(f.old);
  Object.assign(f.current, inventory('fixtures/real-nyc/original.geojson'));
  assert.ok((await f.read()).memory);
  Object.assign(f.current, inventory('fixtures/uttam-nagar/uttam-nagar-road-centrelines.geojson'));
  const answer = await f.read();
  assert.equal(answer.memory, null);
  assert.match(answer.words, /used bin, which is missing here/);
  assert.doesNotMatch(answer.words, /\/features\/\*/);
});

test('route refuses query fields and non-large items, and publishes a strict memory-only contract', async t => {
  const api = '../../../../../../apps/api/';
  const requireApi = createRequire(new URL(`${api}package.json`, import.meta.url));
  requireApi('reflect-metadata');
  const { IngestionController } = await import(`${api}src/modules/ingestion/ingestion.controller`);
  const controller = new IngestionController({} as any);
  assert.throws(() => controller.intakeLayoutMemory(caseId, itemId,
    { originalUrl: '/layout-memory?answer=yes' } as any), { status: 422, code: 'INTAKE_LAYOUT_MEMORY_QUERY' });
  const f = await fixture();
  f.source.profile = 'geojson-manual-v1';
  Object.assign(f.source.inspection, { actor: localOperatorSubject() });
  const globals = globalThis as unknown as { ulpinPool: unknown }, prior = globals.ulpinPool;
  globals.ulpinPool = { connect: async () => f.client };
  t.after(() => { globals.ulpinPool = prior; });
  await assert.rejects(controller.intakeLayoutMemory(caseId, itemId,
    { originalUrl: '/layout-memory' } as any), { status: 422, code: 'INTAKE_LAYOUT_MEMORY_ITEM' });
  assert.equal(IntakeLayoutMemorySchema.safeParse({ memory: null, words: 'None.', approval: {} }).success, false);
  const { NestFactory } = requireApi('@nestjs/core');
  const { AppModule } = await import(`${api}src/app.module`);
  const { createApiDocument } = await import(`${api}src/openapi`);
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false, abortOnError: false });
  try {
    const path = '/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/layout-memory';
    const operation: any = createApiDocument(app).paths[path]?.get;
    assert.equal(operation.operationId, 'GET_api_v1_ingestion_cases_caseId_intake_items_itemId_layout_memory');
    assert.equal(operation['x-runtime-verified'], false);
    assert.ok(operation.responses['200']);
    assert.ok(operation.parameters.every((param: any) => param.in === 'path'));
  } finally { await app.close(); }
});
