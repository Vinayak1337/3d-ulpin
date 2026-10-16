import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { STREAMING_VECTOR_LIMITS as limits } from '@ulpin/contracts/usp';
import { intakeLargeFailureReason, intakeLargeHoldsReason, intakeLargeNumbers, intakeLargePhase,
  intakeLargePartRefusal, INTAKE_LARGE_LAYOUT_QUESTION, writeIntakeLargeReadTx, type IntakeLargeRows
} from './intake-large';
import { writeIntakeLargeTx, type IntakeLargeState } from './intake-ledger';
import { queueIntakeDraftTx } from './intake-draft';
import type { IntakeSourceRow } from './intake-context';
import type { IntakeCard } from '@ulpin/contracts/usp';
import { claimUspJobAttempt } from '../jobs';
import { AppError } from '../../../infrastructure/errors';

const caseId = '10000000-0000-4000-8000-000000000001';
const itemId = '10000000-0000-4000-8000-000000000002';
process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'intake-large-protocol';

function rows(): IntakeLargeRows {
  return { reader: null, profile: null, mapping: null, receiptVerified: false,
    recipeState: null, publishedPackages: 0, foldComplete: false };
}
function sealedRows(): IntakeLargeRows {
  return { ...rows(), reader: { state: 'completed', issue_code: null, records: 4500,
    next_publish_index: 45, sealed_chunks: 45, unknown_remainder: false },
  profile: { state: 'sealed', sealed_generation: 45, issue_code: null }, receiptVerified: true };
}

test('the existing job authority refuses completed-job wake-up and a fourth lifetime claim', async () => {
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
  const previous = globals.ulpinPool;
  let writes = 0;
  try {
    for (const state of ['succeeded', 'queued']) {
      const connection = { release: () => {}, query: async (sql: string) => {
        if (sql.startsWith('SELECT * FROM jobs')) return { rows: [{ id: itemId, status: 'queued' }] };
        if (sql.startsWith('SELECT * FROM usp_job_metadata')) return { rows: [{ logical_state: state }] };
        if (sql.startsWith('SELECT * FROM usp_job_attempts')) return { rows: [{ number: 3, fence: 3,
          state: 'accepted', lease_until: new Date(0) }] };
        if (!['BEGIN', 'ROLLBACK'].includes(sql)) writes++;
        return { rows: [] };
      } };
      globals.ulpinPool = { connect: async () => connection };
      await assert.rejects(() => claimUspJobAttempt(itemId, 'intake-large-protocol'), (error: unknown) => {
        assert(error instanceof AppError);
        if (state === 'succeeded') assert.equal(error.status, 409);
        else assert.equal(error.code, 'USP_JOB_ATTEMPTS');
        return true;
      });
    }
    assert.equal(writes, 0);
  } finally {
    if (previous === undefined) delete globals.ulpinPool;
    else globals.ulpinPool = previous;
  }
});

test('stored rows classify start, read, question, proposed layout, map, draft and end', () => {
  const state = rows();
  assert.equal(intakeLargePhase(state), 'start');
  state.reader = { state: 'running', issue_code: null, records: 100,
    next_publish_index: 1, sealed_chunks: null, unknown_remainder: true };
  assert.equal(intakeLargePhase(state), 'read');
  Object.assign(state, sealedRows());
  assert.equal(intakeLargePhase(state), 'question');
  assert.equal(INTAKE_LARGE_LAYOUT_QUESTION, 'No approved layout matches this file. '
    + 'An officer states what each feature is and which field identifies it.');
  state.recipeState = 'proposed';
  assert.equal(intakeLargePhase(state), 'layout');
  state.recipeState = 'approved';
  assert.equal(intakeLargePhase(state), 'map');
  state.mapping = { ...state.reader! };
  assert.equal(intakeLargePhase(state), 'draft');
  state.foldComplete = true;
  assert.equal(intakeLargePhase(state), 'end');
  assert.equal(intakeLargePhase(JSON.parse(JSON.stringify(state))), 'end');
});

test('no receipt, open profile or incomplete mapping never grants drafting', () => {
  const state = sealedRows();
  state.recipeState = 'approved';
  state.mapping = { ...state.reader! };
  state.receiptVerified = false;
  assert.equal(intakeLargePhase(state), 'read');
  state.receiptVerified = true;
  state.reader!.next_publish_index = 44;
  assert.equal(intakeLargePhase(state), 'read');
  state.reader!.next_publish_index = 45;
  state.profile!.sealed_generation = 44;
  assert.equal(intakeLargePhase(state), 'read');
  state.profile!.sealed_generation = 45;
  state.profile!.state = 'running';
  assert.equal(intakeLargePhase(state), 'read');
  state.profile!.state = 'sealed';
  for (const change of [{ unknown_remainder: true }, { sealed_chunks: null },
    { next_publish_index: 44 }, { records: 4499 }]) {
    state.mapping = { ...state.reader!, ...change };
    assert.equal(intakeLargePhase(state), 'map');
  }
});

test('a terminal reader, profile or mapping is a refusal even beside completed rows', () => {
  for (const name of ['reader', 'profile', 'mapping'] as const) {
    const state = sealedRows();
    state.recipeState = 'approved';
    state.mapping = { ...state.reader! };
    state[name]!.state = 'failed';
    assert.equal(intakeLargePhase(state), 'failure');
    state[name]!.state = 'stale';
    assert.equal(intakeLargePhase(state), 'failure');
  }
});

test('phase counters mean raw parts, mapped parts and finally package cuts, not attempts', () => {
  const state = sealedRows();
  assert.deepEqual(intakeLargeNumbers('read', state), { partsPlanned: null, partsDone: 45, recordsSeen: 4500 });
  state.mapping = { ...state.reader!, state: 'running', next_publish_index: 12 };
  assert.deepEqual(intakeLargeNumbers('map', state), { partsPlanned: 45, partsDone: 12, recordsSeen: 4500 });
  assert.deepEqual(intakeLargeNumbers('failure', state), { partsPlanned: 45, partsDone: 12, recordsSeen: 4500 });
  state.publishedPackages = 2;
  assert.deepEqual(intakeLargeNumbers('draft', state), { partsPlanned: null, partsDone: 2, recordsSeen: 4500 });
  state.publishedPackages = 3;
  assert.deepEqual(intakeLargeNumbers('end', state), { partsPlanned: 3, partsDone: 3, recordsSeen: 4500 });
});

test('CRS, size and feature ceiling refusals use literal metadata and the existing limits', () => {
  const words = 'The file\'s crs member declares {"type":"name","properties":{"name":"EPSG:99999"}}; its name is not a '
    + 'recognized coordinate reference system.';
  assert.equal(intakeLargeFailureReason('STREAMING_SOURCE_CRS', 1, words), 'The file\'s crs member declares '
    + '{"type":"name","properties":{"name":"EPSG:99999"}}; its name is not a recognized coordinate reference system; '
    + 'nothing was prepared from it.');
  assert.equal(intakeLargeFailureReason('STREAMING_SOURCE_CRS', 1),
    'The coordinate system this file declares could not be resolved; nothing was prepared from it.');
  assert.equal(intakeLargeFailureReason('STREAMING_SOURCE_BUDGET', 129 * 1024 ** 2),
    `This file is 129 MiB. A map file is read in parts up to ${limits.sourceBytes / 1024 ** 2} MiB for now; `
    + 'nothing was prepared from it.');
  assert.equal(intakeLargeFailureReason('STREAMING_INDEX', 1),
    `This file has more than ${limits.chunks * limits.chunkFeatures} features, `
    + 'the most a map file may have for now; nothing was prepared from it.');
});

test('known terminal failures and an unenumerated infrastructure failure never expose codes or hashes', () => {
  const codes = ['GEOJSON_JSON', 'GEOJSON_CONTAINER', 'GEOJSON_SEQUENCE', 'GEOJSON_METADATA',
    'GEOJSON_METADATA_BUDGET', 'GEOJSON_NESTING_BUDGET', 'GEOJSON_UNIT_BUDGET', 'STREAMING_CHUNK_BUDGET',
    'STREAMING_EMPTY_SOURCE', 'STREAMING_REPLAY_MISMATCH', 'STREAMING_FEATURE_INDEX', 'STREAMING_SOURCE_INTEGRITY',
    'SOURCE_INTEGRITY', 'STREAMING_CHUNK_INTEGRITY', 'STORAGE_TIMEOUT', 'STREAMING_CONTEXT_STALE',
    'STREAMING_ATTEMPTS_EXHAUSTED', 'STREAMING_WORKER_ERROR', 'AREA_PROCESSOR_OPERATION', 'STREAMED_PROFILE_BODY_BUDGET',
    'STREAMED_PROFILE_PATH_BUDGET', 'STREAMED_PROFILE_GEOMETRY_BUDGET', 'STREAMED_PROFILE_QUARANTINE_BUDGET',
    'STREAMED_PROFILE_COUNTS', 'STREAMED_PROFILE_INTEGRITY', 'STREAMED_PROFILE_CONTEXT_STALE',
    'STREAMED_PROFILE_ATTEMPTS', 'STREAMED_PROFILE_SOURCE_WAIT', 'STREAMED_PROFILE_WORKER_ERROR', 'RAW_STREAM_FAILED',
    'MAPPING_CHUNK_BUDGET', 'MAPPING_CONTEXT_STALE', 'MAPPING_ATTEMPTS_EXHAUSTED', 'MAPPING_SOURCE_WAIT',
    'MAPPING_WORKER_ERROR', 'STREAMED_MAPPING_GEOMETRY', 'STREAMED_MAPPING_PATH', 'STREAMED_MAPPING_FIELD',
    'STREAMED_MAPPING_OPERATION', 'STREAMED_MAPPING_COVERAGE', 'STREAMED_MAPPING_PROVENANCE',
    'STREAMED_MAPPING_SEMANTICS', 'DB_UNKNOWN_FAILURE', '__proto__', 'toString'];
  for (const code of codes) {
    const sentence = intakeLargeFailureReason(code, 1);
    assert(!sentence.includes(code));
    assert.doesNotMatch(sentence, /[A-Z]+_[A-Z_]+|[a-f0-9]{64}|job|worker/);
    assert(sentence.endsWith('; nothing was prepared from it.'));
  }
});

test('an identifier written with a decimal point rests the row at its part in plain words', () => {
  const sentence = intakeLargePartRefusal(new AppError(422, 'PART_INTEGER_IDENTIFIER', 'Not read.'));
  assert.equal(sentence, 'The identifier field holds a value written with a decimal point. '
    + 'This file must write whole-number identifiers as digits only; nothing more was prepared from it.');
  assert.doesNotMatch(sentence!, /[A-Z]+_[A-Z_]+|job|worker/);
  for (const code of ['PART_CUT_BOUND', 'STALE_REVISION', '__proto__', 'toString'])
    assert.equal(intakeLargePartRefusal(new AppError(409, code, 'Changed.')), null);
});

test('the map service refusing a part for what the file holds rests the row at once in its words', () => {
  const words = 'Feature 7 has a position of 4 numbers; a position takes two coordinates and may add a height, '
    + 'and a fourth (M) value is unsupported and will not be dropped.';
  const sentence = intakeLargePartRefusal(new AppError(422, 'AREA_PROCESSING', words));
  assert.equal(sentence, `A part of this file could not be read as a map: ${words.slice(0, -1)}; `
    + 'nothing more was prepared from it.');
  assert.doesNotMatch(sentence!, /[A-Z]+_[A-Z_]+|job|worker/);
  assert.equal(intakeLargePartRefusal(new AppError(422, 'GIS_ALL_GEOMETRIES_REJECTED', 'No geometries.')),
    'No feature in a part of this file has an outline that can be read; nothing more was prepared from it.');
});

test('a fault of the map service is retried: an unavailable service, a timeout or an unknown error', () => {
  const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  for (const error of [new AppError(503, 'AREA_PROCESSING', 'The area processor could not complete this operation.'),
    timeout, new TypeError('fetch failed'), new AppError(413, 'AREA_RESULT_LIMIT', 'Too large.'), 'text'])
    assert.equal(intakeLargePartRefusal(error), null);
});

test('hold summaries use only nonzero clauses and no illustrative count', () => {
  const counts = { recordsRead: 10, accepted: 10, packages: 1, readerRejected: 0, duplicates: 0, oversized: 0 };
  assert.equal(intakeLargeHoldsReason(counts), null);
  assert.equal(intakeLargeHoldsReason({ ...counts, accepted: 9, readerRejected: 1 }),
    '10 records read; 9 in 1 packages. 1 not accepted by the reader.');
  assert.equal(intakeLargeHoldsReason({ ...counts, accepted: 8, duplicates: 2 }),
    '10 records read; 8 in 1 packages. 2 share an identifier with another record and are held.');
  assert.equal(intakeLargeHoldsReason({ ...counts, accepted: 9, oversized: 1 }),
    '10 records read; 9 in 1 packages. 1 are larger than a package can hold and are held.');
  assert.equal(intakeLargeHoldsReason({ ...counts, accepted: 6, readerRejected: 1, duplicates: 2, oversized: 1 }),
    '10 records read; 6 in 1 packages. 1 not accepted by the reader. '
    + '2 share an identifier with another record and are held. 1 are larger than a package can hold and are held.');
});

function ledger(initial: IntakeLargeState) {
  let row = { ...initial };
  let events = 0;
  const client = { query: async (sql: string, values: unknown[]) => {
    if (sql.startsWith('SELECT * FROM usp_intake_items')) return { rows: [{ item_id: itemId,
      source_id: itemId, case_id: caseId, parent_item_id: null, family: 'vector', state: row.state,
      plan_ref: row.planRef, card: { format: 'geojson' } }] };
    if (sql.startsWith('SELECT state,placement')) return { rows: [{ state: row.state, placement: row.placement,
      plan_ref: row.planRef, records_seen: row.recordsSeen, limit_reason: row.limitReason }] };
    if (sql.startsWith('SELECT parts_planned')) return { rows: [{ parts_planned: row.partsPlanned,
      parts_done: row.partsDone }] };
    if (sql.startsWith('UPDATE usp_intake_items SET parts_planned')) {
      row.partsPlanned = values[2] as number | null;
      row.partsDone = values[3] as number;
    } else if (sql.startsWith('UPDATE usp_intake_items SET state')) row = { ...row,
      state: values[2] as IntakeLargeState['state'], placement: values[3] as IntakeLargeState['placement'],
      planRef: values[4] as IntakeLargeState['planRef'], recordsSeen: values[5] as number,
      limitReason: values[6] as string | null };
    else if (sql.startsWith('SELECT item_id AS')) return { rows: [{ itemId, state: row.state,
      family: 'vector', format: 'geojson', sizeClass: 'M', wave: 1, pinnedByOfficer: false }] };
    else if (sql.startsWith('SELECT revision')) return { rows: [{ revision: 1 }] };
    else if (sql.startsWith('UPDATE usp_outbox_streams')) return { rows: [{ sequence: String(++events) }] };
    else if (!sql.startsWith('INSERT INTO usp_outbox')) throw new Error(sql);
    return { rows: [] };
  } } as unknown as PoolClient;
  return { client, state: () => row, events: () => events };
}

test('a retained large GeoJSON above the reader ceiling rests with its size in officer words', async () => {
  const initial: IntakeLargeState = { state: 'probed', placement: 'undecided', planRef: null,
    recordsSeen: 0, limitReason: null, partsDone: 0, partsPlanned: null };
  const fixture = ledger(initial);
  const source: IntakeSourceRow = { id: itemId, case_id: caseId, family_id: itemId, revision: 1,
    name: 'Protocol control', profile: 'large-original-v1', bytes: 129 * 1024 ** 2,
    sha256: 'a'.repeat(64), object_key: 'protocol-control', status: 'needs_input', inspection: {} };
  const card = { family: 'vector', format: 'geojson' } as IntakeCard;
  assert.equal(await queueIntakeDraftTx(fixture.client, source, card), null);
  assert.equal(fixture.state().placement, 'not_understood');
  assert.equal(fixture.state().limitReason, intakeLargeFailureReason('STREAMING_SOURCE_BUDGET', Number(source.bytes)));
  assert.equal(fixture.events(), 1);
  assert.equal(await queueIntakeDraftTx(fixture.client, source, card), null);
  assert.equal(fixture.events(), 1);
});

test('counter and state publication emits one event; replay and counter-only changes stay bounded', async () => {
  const initial: IntakeLargeState = { state: 'reading', placement: 'undecided', planRef: null,
    recordsSeen: 0, limitReason: null, partsDone: 0, partsPlanned: null };
  const fixture = ledger(initial);
  const next = { ...initial, partsDone: 1, recordsSeen: 100 };
  await writeIntakeLargeTx(fixture.client, caseId, itemId, next);
  assert.deepEqual(fixture.state(), next);
  assert.equal(fixture.events(), 1);
  await writeIntakeLargeTx(fixture.client, caseId, itemId, next);
  assert.equal(fixture.events(), 1);
  await writeIntakeLargeTx(fixture.client, caseId, itemId, { ...next, partsPlanned: 45 });
  assert.equal(fixture.events(), 2);
  await writeIntakeLargeTx(fixture.client, caseId, itemId, { ...next, partsPlanned: 45,
    state: 'failed_part', placement: 'not_understood', limitReason: intakeLargeFailureReason('GEOJSON_JSON', 1) });
  assert.equal(fixture.events(), 3);
  assert.equal(fixture.state().placement, 'not_understood');
});

/** The stored rows a reading item's state key reads, over the ledger fixture's own row and events. */
function readingStore(initial: IntakeLargeState, reader: Record<string, unknown>) {
  const fixture = ledger(initial);
  const write = fixture.client.query as unknown as (sql: string, values: unknown[]) => Promise<unknown>;
  const client = { query: async (sql: string, values: unknown[]) => {
    const one = (row: unknown) => ({ rows: [row] });
    if (sql.startsWith('SELECT item_id,case_id')) return one({ item_id: itemId, case_id: caseId,
      state: fixture.state().state, placement: fixture.state().placement, card: { format: 'geojson' },
      plan_ref: null });
    if (sql.startsWith('SELECT id,revision,bytes')) return one({ id: itemId, revision: 1, bytes: 26660992,
      profile: 'large-original-v1', sha256: 'a'.repeat(64), object_key: 'protocol', inspection: {} });
    if (sql.includes('FROM usp_streaming_vector_imports')) return one(reader);
    if (sql.includes('FROM usp_streamed_profile_imports')) return one({ job_id: itemId, state: 'running',
      issue_code: null, sealed_generation: null });
    if (sql.startsWith('SELECT id,revision,state FROM usp_mapping_recipes')) return { rows: [] };
    if (sql.includes('count(*)')) return one({ n: 0 });
    return write(sql, values);
  } } as unknown as PoolClient;
  return { ...fixture, client };
}

test('a reader publishing parts shows its stored counts on the row; a stopped or failed reader writes nothing', async () => {
  const initial: IntakeLargeState = { state: 'reading', placement: 'undecided', planRef: null,
    recordsSeen: 300, limitReason: null, partsDone: 3, partsPlanned: null };
  const running = { job_id: itemId, state: 'running', issue_code: null, next_publish_index: 423, records: 42247,
    quarantined: 438, sealed_chunks: null, unknown_remainder: true };
  const reading = readingStore(initial, running);
  await writeIntakeLargeReadTx(reading.client, itemId);
  assert.deepEqual(reading.state(), { ...initial, recordsSeen: 42247, partsDone: 423 });
  assert.equal(reading.events(), 1);
  await writeIntakeLargeReadTx(reading.client, itemId);
  assert.equal(reading.events(), 1, 'unchanged counts publish nothing');
  const failed = readingStore(initial, { ...running, state: 'failed', issue_code: 'AREA_PROCESSOR_OPERATION' });
  await writeIntakeLargeReadTx(failed.client, itemId);
  assert.deepEqual(failed.state(), initial, 'the step writes the failure with its words');
  const rested = readingStore({ ...initial, state: 'failed_part', placement: 'not_understood' }, running);
  await writeIntakeLargeReadTx(rested.client, itemId);
  assert.equal(rested.events(), 0);
});
