import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { IntakePlanResultSchema } from '@ulpin/contracts/usp';
import { queueIntakePlanTx, settleIntakePlanTx } from './intake-plan';
import { IntakeService } from './intake-service';
import { admitPlanResult } from './intake-plan-processor';
import { fingerprint } from '../../cases/domain';
import { ingestionBinding } from './events';
import type { IntakeSourceRow } from './intake-context';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'pb1-test-only';
const caseId = '10000000-0000-4000-8000-000000000001';
const sourceId = '10000000-0000-4000-8000-000000000002';
const hash = 'a'.repeat(64);
const ready = { available: true, reason: null, modelSha256: hash };

// test_only: literal panel_result shape, not a real plan or evaluation truth.
const result = { schemaVersion: 'raster-plan-candidates/1', state: 'candidate', panel: 'test-only-panel',
  level: { state: 'unknown', value: null },
  sourceCitation: { sourceId, sourceSha256: hash, locator: { kind: 'region', page: 1,
    x: 0, y: 0, width: 20, height: 20, unit: 'pt' } },
  ocrObservations: [{ literal: 'KITCHEN', bboxPt: [2, 2, 8, 8], method: 'test_only',
    tile: 0, item: 0, state: 'candidate' }],
  model: { sha256: hash }, scale: { state: 'no_scale', metresPerPoint: null, pairs: [],
    reason: 'no_verified_dimension_line_endpoints' },
  rooms: [{ state: 'candidate', level: { state: 'unknown', value: null },
    className: 'kitchen', literalClass: 'kitchen',
    geometryPagePixels: { type: 'Polygon', coordinates: [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]] },
    metric: null, containedOcrLiterals: [{ literal: 'KITCHEN', bboxPt: [2, 2, 8, 8], method: 'test_only',
      tile: 0, item: 0, state: 'candidate' }] }], gaps: ['no_scale', 'level_association_unknown'] };

function protocol(format = 'png', modelInstalled = true) {
  const binding = ingestionBinding(caseId);
  const source: IntakeSourceRow = { id: sourceId, case_id: caseId, family_id: sourceId, revision: 1,
    name: 'test_only', profile: 'png-reference-v2', bytes: 10, sha256: hash, object_key: 'test-only',
    status: 'needs_input', inspection: { actor: binding.subject } };
  const item = { item_id: sourceId, case_id: caseId, source_id: sourceId, parent_item_id: null,
    card: { format, family: 'image' }, plan_ref: null };
  let projection: any = { state: 'read', placement: 'undecided', plan_ref: null, records_seen: 0,
    limit_reason: 'test_only' };
  const jobs: any[] = [];
  const statements: string[] = [];
  const operations = new Map<string, { payload_hash: string; result: unknown }>();
  const client = { query: async (sql: string, values: any[] = []) => {
    statements.push(sql);
    let rows: any[] = [];
    if (sql.includes('FROM usp_intake_items i') || sql.startsWith('SELECT * FROM usp_intake_items')) rows = [item];
    else if (sql.startsWith('SELECT * FROM sources')) rows = [source];
    else if (sql.startsWith('SELECT payload_hash,result FROM operations'))
      rows = operations.has(values[1]) ? [operations.get(values[1])] : [];
    else if (sql.startsWith('INSERT INTO operations'))
      operations.set(values[1], { payload_hash: values[2], result: values[3] });
    else if (sql.startsWith('SELECT id,revision,archived FROM cases'))
      rows = [{ id: caseId, revision: 0, archived: false }];
    else if (sql.startsWith('SELECT * FROM jobs')) rows = jobs.filter(job => job.id === values[0]);
    else if (sql.startsWith('SELECT state,placement,plan_ref')) rows = [projection];
    else if (sql.startsWith('SELECT item_id AS')) rows = [{ itemId: sourceId, state: 'read', family: 'image',
      format, sizeClass: 'S', wave: 1, pinnedByOfficer: false }];
    else if (sql.startsWith('SELECT revision FROM cases')) rows = [{ revision: 0 }];
    else if (sql.startsWith('UPDATE usp_outbox_streams')) rows = [{ sequence: '1' }];
    else if (sql.startsWith('INSERT INTO jobs')) jobs.push({ id: values[0], case_id: values[1],
      source_id: values[2], operation: 'intake-plan', case_revision: values[3], input_fingerprint: values[4],
      payload: values[5], status: 'queued' });
    else if (sql.startsWith('UPDATE usp_intake_items SET state=')) {
      projection = { state: values[2], placement: values[3], plan_ref: values[4], records_seen: values[5],
        limit_reason: values[6] };
      item.plan_ref = values[4];
    } else if (!/^(SELECT pg_advisory|SELECT \* FROM usp_job_metadata|INSERT INTO usp_|SELECT revision,archived)/
      .test(sql))
      throw new Error(`Unexpected test SQL: ${sql}`);
    return { rows, rowCount: rows.length };
  } } as unknown as PoolClient;
  const service = new IntakeService({ transaction: (async (work: (client: PoolClient) => Promise<unknown>) =>
    work(client)) as never, planModel: async () => modelInstalled ? ready
      : { available: false, reason: "The plan reader's model is not installed in this build.", modelSha256: null },
  planOcrPages: async () => new Map() });
  return { client, source, item, jobs, statements, service, projection: () => projection };
}

test('the officer press replays a request and coalesces different request keys for the same page', async () => {
  const fixture = protocol();
  const request = { requestKey: caseId, page: 1 };
  const first = await fixture.service.readPlan(caseId, sourceId, request);
  assert.deepEqual(await fixture.service.readPlan(caseId, sourceId, request), first);
  assert.deepEqual(await fixture.service.readPlan(caseId, sourceId, { ...request, requestKey: sourceId }), first);
  await assert.rejects(fixture.service.readPlan(caseId, sourceId, { ...request, page: 2 }), /request key/);
  assert.equal(fixture.jobs.length, 1);
  assert.equal(fixture.jobs[0].input_fingerprint, fingerprint(fixture.jobs[0].payload));
});

test('the service explains an absent model and refuses the officer press without enqueuing', async () => {
  const fixture = protocol('png', false);
  assert.deepEqual(await fixture.service.planOffer(caseId, sourceId), { available: false, modelSha256: null,
    reason: "The plan reader's model is not installed in this build.", pages: [1] });
  await assert.rejects(fixture.service.readPlan(caseId, sourceId, { requestKey: caseId, page: 1 }),
    /The plan reader's model is not installed in this build\./);
  assert.equal(fixture.jobs.length, 0);
});

test('one queued candidate-only job per item and page, including repeated presses', async () => {
  const fixture = protocol();
  const first = await queueIntakePlanTx(fixture.client, fixture.source, fixture.item, 1, ready, null);
  assert.deepEqual(await queueIntakePlanTx(fixture.client, fixture.source, fixture.item, 1, ready, null), first);
  assert.equal(fixture.jobs.length, 1);
  assert.equal(fixture.jobs[0].operation, 'intake-plan');
  assert.equal(fixture.projection().placement, 'undecided');
  assert(!fixture.statements.some(sql => /INSERT INTO (registry|buildings|spaces)/.test(sql)));
});

test('non-image items and missing models refuse with words, never enqueue', async () => {
  const other = protocol('csv');
  await assert.rejects(queueIntakePlanTx(other.client, other.source, other.item, 1, ready, null),
    /Choose a JPEG or PNG plan image/);
  const absent = protocol();
  await assert.rejects(queueIntakePlanTx(absent.client, absent.source, absent.item, 1,
    { available: false, reason: "The plan reader's model is not installed in this build.", modelSha256: null }, null),
  /The plan reader's model is not installed in this build\./);
  assert.equal(other.jobs.length + absent.jobs.length, 0);
});

test('PDF pages require a completed source-bound OCR reading and get distinct jobs', async () => {
  const fixture = protocol('pdf');
  await assert.rejects(queueIntakePlanTx(fixture.client, fixture.source, fixture.item, 1, ready, null),
    /Read the words on this PDF page/);
  const ocr = { jobId: caseId, sha256: hash };
  const first = await queueIntakePlanTx(fixture.client, fixture.source, fixture.item, 1, ready, ocr);
  const second = await queueIntakePlanTx(fixture.client, fixture.source, fixture.item, 2, ready, ocr);
  assert.notEqual(first.jobId, second.jobId);
  assert.equal(fixture.jobs.length, 2);
});

test('panel_result output is stored on the item, with no metric geometry when scale is unknown', async () => {
  const fixture = protocol();
  const queued = await queueIntakePlanTx(fixture.client, fixture.source, fixture.item, 1, ready, null);
  await settleIntakePlanTx(fixture.client, caseId, sourceId, queued.jobId, IntakePlanResultSchema.parse(result));
  const kept = fixture.projection().plan_ref.planReadings[0];
  assert.deepEqual(kept.result.rooms[0].containedOcrLiterals, result.rooms[0].containedOcrLiterals);
  assert.equal(kept.result.scale.state, 'no_scale');
  assert.equal(kept.result.rooms[0].metric, null);
  assert.equal(kept.status, 'completed');
  assert.equal(fixture.projection().records_seen, 0);
  assert(!IntakePlanResultSchema.safeParse({ ...result, rooms: [{ ...result.rooms[0],
    metric: { areaM2: 1 } }] }).success);
  const metric = { geometry: result.rooms[0].geometryPagePixels, areaM2: 1, unit: 'm', frame: 'test_only',
    state: 'candidate' };
  assert(!IntakePlanResultSchema.safeParse({ ...result, rooms: [{ ...result.rooms[0], metric }] }).success);
  assert(!IntakePlanResultSchema.safeParse({ ...result, level: { state: 'reviewed', value: 1 } }).success);
  assert(!IntakePlanResultSchema.safeParse({ ...result,
    rooms: [{ ...result.rooms[0], state: 'reviewed' }] }).success);
});

test('neither guessed scales nor contained labels missing from page OCR are admitted', () => {
  const metric = { geometry: result.rooms[0].geometryPagePixels, areaM2: 1, unit: 'm',
    frame: 'test_only', state: 'candidate' };
  assert(!IntakePlanResultSchema.safeParse({ ...result,
    scale: { state: 'candidate', metresPerPoint: 1, pairs: [{}, {}] },
    rooms: [{ ...result.rooms[0], metric }] }).success);
  assert(!IntakePlanResultSchema.safeParse({ ...result, ocrObservations: [] }).success);
});

test('processor output must cite the queued original, page and pinned model', async () => {
  const fixture = protocol();
  await queueIntakePlanTx(fixture.client, fixture.source, fixture.item, 1, ready, null);
  const input = fixture.jobs[0].payload;
  assert.equal(admitPlanResult(input, result).rooms.length, 1);
  assert.throws(() => admitPlanResult(input, { ...result, model: { sha256: 'b'.repeat(64) } }), /queued source/);
  assert.throws(() => admitPlanResult(input, { ...result, sourceCitation: { ...result.sourceCitation,
    sourceSha256: 'b'.repeat(64) } }), /queued source/);
  assert.throws(() => admitPlanResult(input, { ...result, sourceCitation: { ...result.sourceCitation,
    locator: { ...result.sourceCitation.locator, page: 2 } } }), /queued source/);
});

test('a different original access context cannot queue a plan reading', async () => {
  const fixture = protocol();
  fixture.source.inspection = { actor: 'another-test-only-context' };
  await assert.rejects(fixture.service.readPlan(caseId, sourceId, { requestKey: caseId, page: 1 }),
    /another local context/);
  assert.equal(fixture.jobs.length, 0);
});

test('a result cannot replace another selected page or an unqueued item reading', async () => {
  const fixture = protocol();
  const parsed = IntakePlanResultSchema.parse(result);
  await assert.rejects(settleIntakePlanTx(fixture.client, caseId, sourceId, caseId, parsed), /queued page/);
  const queued = await queueIntakePlanTx(fixture.client, fixture.source, fixture.item, 1, ready, null);
  await assert.rejects(settleIntakePlanTx(fixture.client, caseId, sourceId, queued.jobId, { ...parsed,
    sourceCitation: { ...parsed.sourceCitation, locator: { ...parsed.sourceCitation.locator, page: 2 } } }),
  /queued page/);
});
