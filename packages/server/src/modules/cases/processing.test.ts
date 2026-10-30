import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Client } from 'pg';
import { AppError } from '../../infrastructure/errors';
import { DISPATCH_HEAD_OF_LINE_MS, DISPATCH_LANES, DISPATCH_OPERATIONS,
  DispatchReservations, dispatchCost } from './dispatch-lanes';
import { dispatchTick, dispatchWakeVersion, waitForDispatch } from './processing';
import { dispatchFixtureSelection, type SelectionFixtureJob } from './dispatch-selection.fixture';
import { dispatchFairnessReplay } from './dispatch-fairness.fixture';

type Sent = { sql: string; values: unknown[] };
/** Runs `run` on a pool that answers each statement with `answer`'s rows. */
async function withPool<T>(answer: (sql: string, values: unknown[]) => object[] | Promise<object[]>,
  run: (sent: Sent[]) => Promise<T>): Promise<T> {
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
  const previous = globals.ulpinPool;
  const sent: Sent[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    sent.push({ sql, values });
    const rows = await answer(sql, values);
    return { rows, rowCount: rows.length };
  };
  globals.ulpinPool = { query, connect: async () => ({ query, release: () => {} }) };
  try {
    return await run(sent);
  } finally {
    if (previous === undefined) delete globals.ulpinPool;
    else globals.ulpinPool = previous;
  }
}

/** The selection dispatchTick sends and its lane columns, captured from a pool that holds no jobs. */
async function selection(): Promise<Sent> {
  const sent = await withPool(() => [], async sent => {
    assert.equal(await dispatchTick(), 0);
    return sent;
  });
  // Read occupied lanes before selection, then admit kept surfaces' parts (SB1).
  assert.equal(sent.length, 3);
  assert.match(sent[0].sql.replace(/\s+/g, ' '),
    /AND NOT operation=ANY\(\$1::text\[\]\) AND \(status='running' OR \(status='queued' AND dispatched_at IS NOT NULL/);
  const inProcess = sent[0].values[0] as string[];
  assert.ok(inProcess.includes('point-batch') && !inProcess.includes('spatial-inference'));
  assert.match(sent[2].sql, /FROM usp_intake_items i\s+WHERE i.plan_ref->>'version'=\$1/);
  return sent[1];
}

test("the dispatcher keeps file fairness between batches and item order within a batch", async () => {
  const { sql, values } = await selection();
  const flat = sql.replace(/\s+/g, ' ');
  assert.match(flat,
    /PARTITION BY COALESCE\(lanes.lane,'other'\), COALESCE\(jobs.source_id::text,jobs.case_id::text\)/);
  assert.match(flat, /LEFT JOIN unnest\(\$1::text\[\],\$2::text\[\]\) AS lanes\(operation,lane\)/);
  assert.match(flat, /WHERE jobs.status IN \('queued','running'\) AND jobs.operation NOT LIKE 'usp:%'/);
  assert.match(flat, /NOT jobs.id::text=ANY\(\$3::text\[\]\) AND NOT jobs.operation=ANY\(\$4::text\[\]\)/);
  assert.match(flat, /NOT EXISTS \(SELECT 1 FROM usp_job_attempts a WHERE a.job_id=jobs.id/);
  assert.match(flat, /a.state='active' AND a.lease_until>now\(\)/);
  assert.match(flat, /jobs.dispatched_at IS NOT NULL AND NOT jobs.operation=ANY\(\$6::text\[\]\)/);
  assert.match(flat, /OR NOT COALESCE\(lanes.lane,'other'\)=ANY\(\$5::text\[\]\)/);
  assert.match(flat, /LEFT JOIN usp_intake_items i ON i.source_id=jobs.source_id AND i.case_id=jobs.case_id/);
  assert.match(flat, /i.parent_item_id IS NULL/);
  assert.match(flat, /min\(fifo_rank\) OVER \( PARTITION BY COALESCE\(intake_case_id::text,id::text\),lane='probe'\)/);
  assert.match(flat, /ORDER BY lane='probe' DESC,refusal_head DESC,/);
  assert.match(flat,
    /CASE WHEN refusal_head THEN created_at END,first_part DESC,map_mapping DESC,batch_rank,item_wave/);
  assert.match(flat, /i.placement='needs_answer' OR i.plan_ref->>'recipeState'='approved'/);
  assert.match(flat, /item_waiting DESC NULLS LAST, CASE WHEN operation='intake-large' THEN created_at/);
  assert.match(flat, /ELSE item_created_at END,created_at,id LIMIT 12$/);
  const [operations, lanes, held, unavailable] = values as [string[], string[], string[], string[]];
  assert.deepEqual(held, []);
  assert.deepEqual(unavailable, []);
  assert.equal(lanes[operations.indexOf('point-batch')], 'point');
  assert.equal(lanes[operations.indexOf('spatial-inference')], 'gpu');
});

const intakeJob = (id: string, itemCreated: number, created: number): SelectionFixtureJob =>
  ({ id, operation: 'intake-draft', source_id: id, case_id: 'batch-control', created_at: new Date(created),
    itemCreated });

async function offlinePicked(jobs: SelectionFixtureJob[]): Promise<string[]> {
  const { sql, values } = await selection();
  return dispatchFixtureSelection(sql, values, jobs).map(row => String(row.id));
}

test('a member keeps item FIFO ahead of more than twelve younger sibling layers, before LIMIT', async () => {
  const siblings = Array.from({ length: 15 }, (_, index) => intakeJob(`layer-${index}`, index + 1, index));
  assert.deepEqual(await offlinePicked([...siblings, intakeJob('member', 0, 100)]),
    ['member', ...siblings.slice(0, 11).map(row => row.id)]);
});

for (const waiting of [{ placement: 'needs_answer' }, { recipeState: 'approved' }]) {
  test(`a later item's ${Object.values(waiting)[0]} layout work goes ahead of older siblings`, async () => {
    const older = intakeJob('layer', 0, 0);
    const waitingItem = { ...intakeJob('answer', 100, 100), ...waiting };
    assert.deepEqual(await offlinePicked([older, waitingItem]), ['answer', 'layer']);
  });
}

test('officer-pinned waves order a batch, without moving it ahead of an older unrelated batch', async () => {
  const rows = [intakeJob('ordinary', 0, 10),
    { ...intakeJob('wave-2', 2, 11), pinned: true, wave: 2 },
    { ...intakeJob('wave-1', 3, 12), pinned: true, wave: 1 },
    { ...intakeJob('wave-4', 4, 13), pinned: true, wave: 4 },
    { ...intakeJob('other-batch', 0, 0), case_id: 'older-batch' }];
  assert.deepEqual(await offlinePicked(rows), ['other-batch', 'ordinary', 'wave-1', 'wave-2', 'wave-4']);
});

test('non-batch work retains G22 file fairness and probe precedence offline', async () => {
  const rows = Array.from({ length: 15 }, (_, index) => ({ ...intakeJob(`part-${index}`, 0, index),
    source_id: 'same-file', operation: 'point-batch', itemCreated: undefined }));
  rows.push({ ...intakeJob('table', 0, 20), operation: 'chunk-mapping', itemCreated: undefined });
  rows.push({ ...intakeJob('probe', 0, 30), operation: 'inspect', itemCreated: undefined });
  assert.deepEqual(await offlinePicked(rows), ['probe', 'part-0', 'table',
    ...rows.slice(1, 10).map(row => row.id)]);
});

test('211 bulk parts linked to batch items still cannot hide that batch\'s table profile', async () => {
  const rows = Array.from({ length: 211 }, (_, index) => ({ ...intakeJob(`part-${index}`, 0, index),
    source_id: 'same-file', operation: 'point-batch' }));
  rows.push({ ...intakeJob('table', 100, 300), operation: 'table-profile' });
  assert.deepEqual(await offlinePicked(rows), ['part-0', 'table', ...rows.slice(1, 11).map(row => row.id)]);
});

test('a first map part precedes further steps, even in an older batch and lower wave', async () => {
  const mapped = { ...intakeJob('mapped', 0, 0), operation: 'intake-large', parts: 1, wave: 1 };
  const first = { ...intakeJob('first', 10, 10), operation: 'intake-large', case_id: 'newer', wave: 4 };
  assert.deepEqual(await offlinePicked([mapped, first]), ['first', 'mapped']);
  const probe = { ...intakeJob('probe', 20, 20), operation: 'inspect' };
  assert.deepEqual(await offlinePicked([mapped, first, probe]), ['probe', 'first', 'mapped']);
  // Placement may be reset for a question; a retained published part remains the witness.
  assert.deepEqual(await offlinePicked([{ ...mapped, placement: 'needs_answer' }, first]), ['first', 'mapped']);
});

test('large steps rotate by enqueue time instead of inheriting a sibling batch position', async () => {
  const older = { ...intakeJob('older', 0, 10), operation: 'intake-large' };
  const next = { ...intakeJob('next', 100, 5), operation: 'intake-large' };
  assert.deepEqual(await offlinePicked([older, next]), ['next', 'older']);
  // The officer's per-batch wave still wins inside the same first-part priority class.
  assert.deepEqual(await offlinePicked([{ ...older, wave: 1 }, { ...next, wave: 2 }]), ['older', 'next']);
});

test('one item cannot fill the ready window or hold another item behind its state keys', async () => {
  const { sql, values } = await selection();
  const keys = Array.from({ length: 20 }, (_, index) => ({ ...intakeJob(`key-${index}`, 0, index),
    operation: 'intake-large', source_id: 'busy-item' }));
  const other = { ...intakeJob('other', 100, 100), operation: 'intake-large' };
  assert.deepEqual(dispatchFixtureSelection(sql, values, [...keys, other]).map(row => row.id), ['key-0', 'other']);
  values[6] = ['busy-item'];
  assert.deepEqual(dispatchFixtureSelection(sql, values, [...keys, other]).map(row => row.id), ['other']);
  const held = new DispatchReservations();
  const large = (id: string, itemId: string) => ({ ...job(id, 'intake-large'), payload: { itemId } });
  assert.ok(held.admit(large('key-0', 'busy-item'), 8192, [], at(0)));
  assert.equal(held.admit(large('key-1', 'busy-item'), 8192, [], at(0)), false);
  assert.ok(held.admit(large('other', 'other'), 8192, [], at(0)));
  assert.deepEqual(held.unavailableLargeItems(), ['busy-item', 'other']);
  held.release('key-0');
  assert.ok(held.admit(large('key-1', 'busy-item'), 8192, [], at(1)));
});

/** S9.5d run 3: two table files' mappings, then a converted layer's, one drop and one wave. */
const tableMapping = (id: string, created: number): SelectionFixtureJob =>
  ({ ...intakeJob(id, created, created), operation: 'chunk-mapping', case_id: 'drop', family: 'table' });
const layerMapping: SelectionFixtureJob = { ...tableMapping('layer', 10), family: 'vector' };
const mappingRun = [tableMapping('table-1', 0), tableMapping('table-2', 1)];

test('a map file\'s first mapping is selected ahead of older table mappings, and flags what waits', async () => {
  const { sql, values } = await selection();
  const rows = dispatchFixtureSelection(sql, values, [...mappingRun, layerMapping]);
  assert.deepEqual(rows.map(row => [row.id, Boolean(row.map_mapping)]),
    [['layer', true], ['table-1', false], ['table-2', false]]);
  assert.ok(rows.every(row => row.map_waiting && row.table_waiting));
  const planned = { ...layerMapping, family: 'model3d', parts: 1, partState: 'planned' };
  assert.deepEqual(await offlinePicked([...mappingRun, planned]), ['layer', 'table-1', 'table-2']);
  // A retry after its first part is published, or an old job with no item, is a table mapping as before.
  assert.deepEqual(await offlinePicked([...mappingRun, { ...layerMapping, parts: 1 }]),
    ['table-1', 'table-2', 'layer']);
  const itemless = dispatchFixtureSelection(sql, values, [...mappingRun, { ...layerMapping, itemCreated: undefined }]);
  assert.ok(itemless.every(row => !row.map_mapping && !row.map_waiting && row.table_waiting));
});

const big = 100000;
const mapMapping = (id: string) => ({ ...job(id, 'chunk-mapping'), mapMapping: true });

test('two table mappings running and a map mapping queued: the map mapping takes the next table slot', () => {
  const held = new DispatchReservations();
  held.keepTableLaneWaiting(false, true);
  assert.ok(held.admit(job('table-1', 'chunk-mapping'), big, [], at(0)));
  assert.ok(held.admit(job('table-2', 'chunk-mapping'), big, [], at(0)));
  held.keepTableLaneWaiting(true, true);
  assert.equal(held.admit(mapMapping('layer'), big, [], at(1)), false);
  held.release('table-1');
  assert.equal(held.admit(job('table-3', 'chunk-mapping'), big, [], at(2)), false, 'the freed slot is kept');
  assert.deepEqual(held.refusedJobIds(), [], 'a kept slot is not a memory refusal');
  assert.ok(held.admit(mapMapping('layer'), big, [], at(2)));
  assert.deepEqual(held.unavailableLanes([]), ['table']);
});

test('a map mapping refused for memory still keeps its table slot, and no lane gains a slot', () => {
  const held = new DispatchReservations();
  held.keepTableLaneWaiting(true, true);
  assert.ok(held.admit(job('table-1', 'chunk-mapping'), 300, [], at(0)));
  assert.equal(held.admit(mapMapping('layer'), 300, [], at(0)), false);
  assert.deepEqual(held.refusedJobIds(), ['layer']);
  assert.equal(held.admit(job('table-2', 'table-profile'), big, [], at(0)), false);
  held.keepTableLaneWaiting(false, true);
  assert.ok(held.admit(job('table-2', 'table-profile'), big, [], at(0)));
  assert.equal(held.admit(mapMapping('layer-2'), big, [], at(0)), false);
});

test('with no map mapping waiting two table mappings run together, as do jobs from before the flag', () => {
  const held = new DispatchReservations();
  held.keepTableLaneWaiting(false, true);
  assert.ok(held.admit(job('table-1', 'chunk-mapping'), big, [], at(0)));
  assert.ok(held.admit(job('table-2', 'chunk-mapping'), big, [], at(0)));
  const unflagged = new DispatchReservations();
  assert.ok(unflagged.admit(job('old-1', 'chunk-mapping'), big, [], at(0)));
  assert.ok(unflagged.admit(job('old-2', 'intake-table-geojson'), big, [], at(0)));
  assert.equal(unflagged.admit(job('old-3', 'chunk-mapping'), big, [], at(0)), false);
});

test('a long run of map mappings still lets a table mapping run', () => {
  const held = new DispatchReservations();
  held.keepTableLaneWaiting(true, true);
  assert.ok(held.admit(mapMapping('layer-0'), big, [], at(0)));
  assert.equal(held.admit(mapMapping('layer-1'), big, [], at(0)), false, 'a table waits');
  assert.ok(held.admit(job('table', 'chunk-mapping'), big, [], at(0)));
  for (let index = 1; index < 6; index++) {
    held.release(`layer-${index - 1}`);
    assert.ok(held.admit(mapMapping(`layer-${index}`), big, [], at(index)));
  }
  held.release('table');
  assert.equal(held.admit(mapMapping('layer-6'), big, [], at(6)), false);
  assert.ok(held.admit(job('table-next', 'chunk-mapping'), big, [], at(6)));
  held.release('table-next');
  held.keepTableLaneWaiting(true, false);
  assert.ok(held.admit(mapMapping('layer-6'), big, [], at(7)), 'with no table waiting maps use the whole lane');
});

test('dispatchTick tells admission what waits for the table lane and which job is a map mapping', async t => {
  const waiting = t.mock.method(DispatchReservations.prototype, 'keepTableLaneWaiting');
  const admitted = t.mock.method(DispatchReservations.prototype, 'admit', () => false);
  await withPool((sql, values) => sql.includes('AS file_rank')
    ? dispatchFixtureSelection(sql, values, [...mappingRun, layerMapping]) : [], () => dispatchTick());
  assert.deepEqual(waiting.mock.calls.map(call => call.arguments), [[true, true]]);
  assert.deepEqual(admitted.mock.calls.map(call => {
    const offered = call.arguments[0] as { id: string; mapMapping?: boolean };
    return [offered.id, offered.mapMapping];
  }), [['layer', true], ['table-1', false], ['table-2', false]]);
});

test('the raised vector ceiling still admits only the steps that fit total memory and the Node heap', () => {
  for (const [memory, heap, count] of [[8192, 3072, 6], [1536, 3072, 3], [8192, 1024, 2]]) {
    const held = new DispatchReservations();
    const results = Array.from({ length: 7 }, (_, index) => held.admit({ ...job(`step-${index}`, 'intake-large'),
      payload: { itemId: `item-${index}` } }, memory, [], at(0), Infinity, heap));
    assert.equal(results.filter(Boolean).length, count);
    assert.ok(count * dispatchCost('intake-large').mib <= Math.min(memory, heap));
  }
});

test('run-5-shaped offline replay reports before and after queueing without changing job answers', async () => {
  const { sql, values } = await selection();
  const result = dispatchFairnessReplay(sql, values);
  console.info('S5.38 replay', JSON.stringify(result));
  assert.ok(result.after.firstIntakeRunAdmissionSeconds! < result.before.firstIntakeRunAdmissionSeconds!);
  assert.ok(result.after.firstFileQueueSeconds < 60);
  assert.ok(result.after.firstIntakeRunAdmissionSeconds! <= 112);
  assert.ok(result.after.longestIntakeLargeWaitSeconds <= 24);
  assert.ok(result.after.peakReservedMiB <= result.after.heapBudgetMiB);
});

const reachEpoch = Date.UTC(2026, 9, 24);
const reachJob = (id: string, created: number, parts = 0, operation = 'intake-large') => ({
  id, source_id: id, case_id: id, operation, created_at: new Date(reachEpoch + created),
  itemCreated: reachEpoch + created, parts, payload: { itemId: id },
});

/** Refuse each job for memory, then leave the dispatcher idle without forgetting refusal age. */
function refuseReady(rows: ReturnType<typeof reachJob>[]) {
  const held = new DispatchReservations();
  const holder = reachJob('holder', 0, 1, 'intake-plan');
  assert.ok(held.admit(holder, 1, [], reachEpoch));
  for (const row of rows) assert.equal(held.admit(row, 1, [], reachEpoch), false);
  held.release(holder.id);
  return held;
}

test('a memory-refused continuation stays reachable behind twelve younger first parts', async () => {
  const { sql, values } = await selection();
  const continuation = reachJob('continuation', 1, 1);
  const rows = [continuation, ...Array.from({ length: 12 }, (_, n) => reachJob(`first-${n}`, n + 2))];
  const ticks = [120001, 180001, 3600000].map(ms => {
    const held = refuseReady([continuation]);
    values[7] = held.refusedJobIds();
    const selected = dispatchFixtureSelection(sql, values, rows);
    held.keepRefused(rows.map(row => row.id), selected.map(row => String(row.id)));
    const admitted = selected.filter(row => held.admit(rows.find(original => original.id === row.id)!,
      500, [], reachEpoch + ms, Infinity, 3072));
    assert.equal(selected[0].id, continuation.id);
    assert.deepEqual(admitted.map(row => row.id), [continuation.id]);
    return { ms, admitted: admitted.map(row => row.id) };
  });
  console.info('S5.43 reachability', JSON.stringify(ticks));
});

test('every lane contributes its oldest refused job before the first-part window fills', async () => {
  const { sql, values } = await selection();
  const operations = Object.keys(DISPATCH_LANES).map(lane => Object.keys(DISPATCH_OPERATIONS)
    .find(operation => dispatchCost(operation).lane === lane)!);
  const heads = operations.map((operation, index) => reachJob(`head-${index}`, index + 1, 1, operation));
  const held = refuseReady(heads);
  values[7] = held.refusedJobIds();
  const rows = [...heads, ...Array.from({ length: 24 }, (_, index) => reachJob(`first-${index}`, index + 100))];
  const selected = dispatchFixtureSelection(sql, values, rows);
  assert.equal(selected[0].operation, 'inspect', 'probes still go first');
  assert.deepEqual(new Set(selected.map(row => row.id)), new Set(heads.map(row => row.id)));
  held.keepRefused(rows.map(row => row.id), selected.map(row => String(row.id)));
  assert.ok(selected.some(row => held.admit(rows.find(original => original.id === row.id)!,
    1, [], reachEpoch + 180001)));
});

test('a refused state key is selected without letting one item fill the window', async () => {
  const { sql, values } = await selection();
  const keys = Array.from({ length: 20 }, (_, index) => ({ ...reachJob(`key-${index}`, index + 1, 1),
    source_id: 'same-item', payload: { itemId: 'same-item' } }));
  const held = refuseReady([keys[19]]);
  values[7] = held.refusedJobIds();
  const rows = [...keys, ...Array.from({ length: 24 }, (_, index) => reachJob(`first-${index}`, index + 100))];
  const selected = dispatchFixtureSelection(sql, values, rows);
  assert.equal(selected[0].id, 'key-19');
  assert.equal(selected.filter(row => row.source_id === 'same-item').length, 1);
  assert.equal(selected.length, 12);
});

test('an idle dispatcher admits within one cycle across mixed ready and refused job orders', async () => {
  const { sql, values } = await selection();
  const operations = Object.keys(DISPATCH_OPERATIONS);
  // Deterministic mixed-operation controls; no runtime or hypothetical timing measurements.
  for (let mix = 0; mix < 96; mix++) {
    const rows = Array.from({ length: 13 + mix % 19 }, (_, index) => reachJob(`mix-${mix}-${index}`,
      index + 1, index % 2, operations[(mix * 7 + index * 11) % operations.length]));
    const held = refuseReady(rows.filter((_, index) => (index + mix) % 3 === 0));
    values[7] = held.refusedJobIds();
    const selected = dispatchFixtureSelection(sql, values, mix % 2 ? [...rows].reverse() : rows);
    held.keepRefused(rows.map(row => row.id), selected.map(row => String(row.id)));
    assert.deepEqual(held.heldJobIds(), []);
    assert.ok(selected.some(row => held.admit(rows.find(original => original.id === row.id)!,
      1, [], reachEpoch + 3600000, 0, 1)), `no admission for mix ${mix}`);
  }
});

for (const filter of ['held job', 'busy operation', 'full lane', 'busy item', 'not queued'] as const) {
  test(`a ${filter} refusal cannot strand ready work and keeps its age when eligible again`, async () => {
    const { sql, values } = await selection();
    const older = reachJob('older', 1, 1);
    const first = reachJob('first', 2);
    const held = refuseReady([older]);
    values[7] = held.refusedJobIds();
    if (filter === 'held job') values[2] = [older.id];
    if (filter === 'busy operation') {
      older.operation = 'private-mvt';
      values[3] = [older.operation];
    }
    if (filter === 'full lane') {
      older.operation = 'raster-window';
      values[4] = ['raster'];
    }
    if (filter === 'busy item') values[6] = [older.id];
    const rows = [{ ...older, status: filter === 'not queued' ? 'succeeded' : 'queued' }, first];
    const selected = dispatchFixtureSelection(sql, values, rows);
    assert.deepEqual(selected.map(row => row.id), [first.id]);
    held.keepRefused(filter === 'not queued' ? [first.id] : rows.map(row => row.id), [first.id]);
    assert.ok(held.admit(first, 1, [], reachEpoch + 180001));
    held.release(first.id);
    if (filter === 'not queued') return;
    assert.deepEqual(held.refusedJobIds(), [older.id]);
    // Once ready again, the original refusal age still protects it from a younger first part.
    held.keepRefused(rows.map(row => row.id), rows.map(row => row.id));
    assert.equal(held.admit(first, 1, [], reachEpoch + 180002), false);
    assert.ok(held.admit(older, 1, [], reachEpoch + 180002));
  });
}

test('dispatchTick carries refusal priority and the selected blocker set into admission', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: reachEpoch });
  const holder = reachJob('holder', 0, 1, 'packet-pdf');
  const refused = reachJob('refused', 1, 1, 'private-mvt');
  let ready = [holder, refused];
  const finishHolder = deferred<void>(), finishRefused = deferred<void>();
  const started: string[] = [];
  const budget = process.env.DISPATCH_MEMORY_MIB;
  process.env.DISPATCH_MEMORY_MIB = '1000';
  try {
    await withPool((sql, values) => {
      if (sql.includes('AS file_rank')) return dispatchFixtureSelection(sql, values, ready);
      if (sql.includes("status IN ('queued','running')")) {
        return ready.filter(row => (values[0] as string[]).includes(row.id));
      }
      return [];
    }, async sent => {
      const runners = { packetPdf: async () => finishHolder.promise, privateMvt: async (id: string) => {
        started.push(id);
        await finishRefused.promise;
      } };
      await dispatchTick(runners);
      assert.deepEqual(started, []);
      finishHolder.resolve();
      await settle();
      ready = [refused, ...Array.from({ length: 12 }, (_, n) => reachJob(`first-${n}`, n + 2))];
      process.env.DISPATCH_MEMORY_MIB = '500';
      t.mock.timers.tick(180001);
      await dispatchTick(runners);
      const selected = sent.filter(statement => statement.sql.includes('AS file_rank')).at(-1)!;
      assert.deepEqual(selected.values[7], [refused.id]);
      assert.deepEqual(started, [refused.id]);
    });
  } finally {
    finishHolder.resolve();
    finishRefused.resolve();
    await settle();
    if (budget === undefined) delete process.env.DISPATCH_MEMORY_MIB;
    else process.env.DISPATCH_MEMORY_MIB = budget;
  }
});

test('every operation the dispatcher names has a lane', () => {
  const source = readFileSync(new URL('./processing.ts', import.meta.url), 'utf8');
  const named = new Set([...source.matchAll(/operation\s*===?\s*["']([a-z0-9-]+)["']/g)].map(match => match[1]));
  assert.ok(named.size > 20);
  for (const operation of named) assert.ok(Object.hasOwn(DISPATCH_OPERATIONS, operation), operation);
});

/** The lines dispatchTick warns when its packet-pdf worker throws `thrown`. */
async function warnedFor(thrown: unknown): Promise<string[]> {
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
  const previous = globals.ulpinPool;
  const warned: string[] = [];
  const warn = console.warn;
  // Only the job selection holds the packet; the surface admission finds no kept part.
  globals.ulpinPool = { query: async (sql: string) => sql.includes('FROM jobs')
    ? { rows: [{ id: 'pdf-1', operation: 'packet-pdf' }], rowCount: 1 } : { rows: [], rowCount: 0 } };
  console.warn = (...line: unknown[]) => { warned.push(line.map(String).join(' ')); };
  try {
    let finished!: () => void;
    const settled = new Promise<void>(resolve => { finished = resolve; });
    assert.equal(await dispatchTick({ packetPdf: async () => {
      setImmediate(finished);
      throw thrown;
    } }), 1);
    await settled;
  } finally {
    console.warn = warn;
    if (previous === undefined) delete globals.ulpinPool;
    else globals.ulpinPool = previous;
  }
  assert.ok(warned.every(line => !line.includes('SECRET_MARKER_TEXT')));
  return warned;
}

test('a background worker\'s error is kept in the log by its code, never its message', async () => {
  const line = (code: string) => `The packet-pdf worker dispatched from job pdf-1 ended with error code ${code}`;
  assert.deepEqual(await warnedFor(new AppError(409, 'STALE_REVISION', 'SECRET_MARKER_TEXT')),
    [line('STALE_REVISION')]);
  assert.deepEqual(await warnedFor(Object.assign(new Error('SECRET_MARKER_TEXT'), { code: '23514' })), [line('23514')]);
  assert.deepEqual(await warnedFor(new Error('SECRET_MARKER_TEXT in /data/plan.pdf')), [line('Error')]);
  assert.deepEqual(await warnedFor('SECRET_MARKER_TEXT'), [line('unknown')]);
});

/** A job created `seconds` after a fixed start, as the tick reads it. */
const job = (id: string, operation: string, seconds = 0) =>
  ({ id, operation, created_at: new Date(Date.UTC(2026, 9, 21) + seconds * 1000) });
const at = (seconds: number) => Date.UTC(2026, 9, 22) + seconds * 1000;

test('a 1 GiB raster part and a 954 MiB page image on a 1.5 GiB budget start one after the other', () => {
  const held = new DispatchReservations();
  assert.ok(held.admit(job('raster', 'raster-window'), 1536, [], at(0)));
  assert.equal(held.admit(job('page', 'intake-page-image'), 1536, [], at(0)), false);
  held.release('raster');
  assert.ok(held.admit(job('page', 'intake-page-image'), 1536, [], at(1)));
});

test('a job over the whole budget runs alone, and nothing joins it', () => {
  const held = new DispatchReservations();
  assert.ok(held.admit(job('probe', 'inspect'), 512, [], at(0)));
  assert.equal(held.admit(job('raster', 'raster-window'), 512, [], at(0)), false);
  held.release('probe');
  assert.ok(held.admit(job('raster', 'raster-window'), 512, [], at(1)));
  assert.equal(held.admit(job('probe', 'inspect'), 512, [], at(1)), false);
});

test('the gpu lane never runs two jobs at once, counting a job the processor holds', () => {
  const held = new DispatchReservations();
  const big = 1_000_000;
  assert.ok(held.admit(job('chip', 'spatial-inference'), big, [], at(0)));
  assert.equal(held.admit(job('dataset', 'dataset-spatial-inference'), big, [], at(0)), false);
  assert.ok(held.admit(job('table', 'chunk-mapping'), big, [], at(0)));
  held.release('chip');
  const processor = [job('elsewhere', 'spatial-inference')];
  assert.equal(held.admit(job('dataset', 'dataset-spatial-inference'), big, processor, at(1)), false);
  assert.ok(held.admit(job('dataset', 'dataset-spatial-inference'), big, [], at(2)));
  // A job both held here and read from the processor's rows is counted once.
  held.release('table');
  assert.ok(held.admit(job('raster', 'raster-window'), 2000, [job('dataset', 'dataset-spatial-inference')], at(3)));
});

test('an operation no lane names is other, never dropped', () => {
  assert.deepEqual(dispatchCost('mystery-operation'), { lane: 'other', mib: 512 });
  assert.ok(new DispatchReservations().admit(job('odd', 'mystery-operation'), 1, [], at(0)));
});

test('a big job refused for memory stops newer jobs after the head-of-line wait, then starts when the rest drains',
  () => {
    const held = new DispatchReservations();
    const budget = 1100;
    const wait = DISPATCH_HEAD_OF_LINE_MS / 1000;
    assert.ok(held.admit(job('small-1', 'kml-native', 0), budget, [], at(0)));
    assert.equal(held.admit(job('big', 'raster-window', 10), budget, [], at(100)), false);
    assert.ok(held.admit(job('small-2', 'geoparquet-native', 20), budget, [], at(100)));
    held.release('small-1');
    assert.ok(held.admit(job('small-3', 'kml-native', 150), budget, [], at(100 + wait)));
    assert.equal(held.admit(job('big', 'raster-window', 10), budget, [], at(100 + wait)), false);
    assert.equal(held.admit(job('small-4', 'geoparquet-native', 200), budget, [], at(101 + wait)), false);
    assert.ok(held.admit(job('probe', 'inspect', 210), budget, [], at(101 + wait)));
    assert.equal(held.admit(job('big', 'raster-window', 10), budget, [], at(102 + wait)), false);
    for (const id of ['small-2', 'small-3', 'probe']) held.release(id);
    assert.equal(held.admit(job('small-4', 'geoparquet-native', 200), budget, [], at(103 + wait)), false);
    assert.ok(held.admit(job('big', 'raster-window', 10), budget, [], at(103 + wait)));
    assert.deepEqual(held.refusedJobIds(), []);
    held.release('big');
    assert.ok(held.admit(job('small-4', 'geoparquet-native', 200), budget, [], at(104 + wait)));
  });

test('a refused job that no longer waits blocks nothing', () => {
  const held = new DispatchReservations();
  assert.ok(held.admit(job('small-1', 'kml-native', 0), 1100, [], at(0)));
  assert.equal(held.admit(job('big', 'raster-window', 10), 1100, [], at(0)), false);
  held.keepRefused([]);
  assert.ok(held.admit(job('small-2', 'geoparquet-native', 20), 1100, [], at(1000)));
});

type Tick = { rows: object[]; budget: string; packetPdf?: (jobId: string) => Promise<void>; elsewhere?: object[];
  document?: (jobId: string) => Promise<void>; privateMvt?: (jobId: string) => Promise<void>;
  intakeRun?: (jobId: string) => Promise<void>; intakeRunNext?: () => Promise<void>;
  selected?: (selection: Sent) => void };
/** One dispatcher tick with fake jobs and DISPATCH_MEMORY_MIB at `budget`; returns the jobs sent to the processor. */
async function tickWith({ rows, budget, packetPdf = async () => {}, elsewhere = [],
  document, privateMvt, intakeRun, intakeRunNext, selected }: Tick): Promise<string[]> {
  const saved = ['DISPATCH_MEMORY_MIB', 'GEO_URL', 'GEO_SERVICE_TOKEN'].map(name => [name, process.env[name]] as const);
  const fetching = globalThis.fetch;
  const sentToProcessor: string[] = [];
  Object.assign(process.env, { DISPATCH_MEMORY_MIB: budget, GEO_URL: 'http://processor.test',
    GEO_SERVICE_TOKEN: 'test-only' });
  globalThis.fetch = async (_url, init) => {
    sentToProcessor.push(JSON.parse(String(init?.body)).jobId);
    throw new Error('no processor in this test');
  };
  try {
    await withPool(sql => sql.includes('AS file_rank') ? rows
      : sql.includes('dispatched_at IS NOT NULL') ? elsewhere : [], async sent => {
      assert.equal(await dispatchTick({ packetPdf, document, privateMvt, intakeRun, intakeRunNext }), rows.length);
      selected?.(sent[1]);
      await Promise.resolve();
      await Promise.resolve();
    });
    return sentToProcessor;
  } finally {
    globalThis.fetch = fetching;
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const pdf = { ...job('pdf-1', 'packet-pdf'), attempts: 0 };
const odd = { ...job('odd-1', 'mystery-operation', 5), attempts: 0, dispatched_at: null };

test('a single queued job starts on the first tick, even over the budget', async () => {
  const started: string[] = [];
  const packetPdf = async (jobId: string) => { started.push(jobId); };
  await tickWith({ rows: [pdf], budget: '1', packetPdf });
  await settle();
  assert.deepEqual(started, ['pdf-1']);
  await tickWith({ rows: [pdf], budget: '1', packetPdf });
  await settle();
  assert.deepEqual(started, ['pdf-1', 'pdf-1']);
});

test('a job that does not fit waits until the running job ends, and an unknown operation then runs', async () => {
  let finish!: () => void;
  const running = new Promise<void>(resolve => { finish = resolve; });
  assert.deepEqual(await tickWith({ rows: [pdf, odd], budget: '1000', packetPdf: () => running }), []);
  finish();
  await settle();
  assert.deepEqual(await tickWith({ rows: [odd], budget: '1000' }), ['odd-1']);
});

test('an inference job the processor runs keeps a second one from being sent until it has succeeded', async () => {
  const second = { ...job('chip-2', 'dataset-spatial-inference', 5), attempts: 0, dispatched_at: null };
  const elsewhere = [job('chip-1', 'spatial-inference')];
  assert.deepEqual(await tickWith({ rows: [second], budget: '100000', elsewhere }), []);
  assert.deepEqual(await tickWith({ rows: [second], budget: '100000' }), ['chip-2']);
});

test('a busy singleton and its queued followers leave the twelve-row ready window until it finishes', async () => {
  let finish!: () => void;
  const running = new Promise<void>(resolve => { finish = resolve; });
  try {
    await tickWith({ rows: [pdf], budget: '100000', packetPdf: () => running });
    await tickWith({ rows: [odd], budget: '100000', selected: ({ values }) => {
      assert.deepEqual(values[2], ['pdf-1']);
      assert.deepEqual(values[3], ['packet-pdf']);
    } });
  } finally {
    finish();
    await settle();
  }
  await tickWith({ rows: [], budget: '100000', selected: ({ values }) => {
    assert.deepEqual(values[2], []);
    assert.deepEqual(values[3], []);
  } });
});

for (const [operation, runner] of [['document-extraction', 'document'], ['private-mvt', 'privateMvt']] as const) {
  test(`${operation} keeps its reservation but does not delay the next dispatcher tick`, async () => {
    let finish!: () => void;
    const running = new Promise<void>(resolve => { finish = resolve; });
    const first = { ...job('background-1', operation), attempts: 0 };
    const second = { ...job('background-2', operation, 1), attempts: 0 };
    const started: string[] = [];
    let began!: () => void;
    const begun = new Promise<void>(resolve => { began = resolve; });
    const run = (id: string) => { started.push(id); began(); return running; };
    const tick = tickWith({ rows: [first], budget: '1000', [runner]: run });
    try {
      await begun;
      const returned = await Promise.race([tick.then(() => true), settle().then(() => false)]);
      assert.equal(returned, true, 'dispatch must return before the background job completes');
      assert.deepEqual(started, ['background-1']);
      assert.deepEqual(await tickWith({ rows: [second, odd], budget: '1000', [runner]: run,
        selected: ({ values }) => {
          assert.deepEqual(values[2], ['background-1']);
          assert.deepEqual(values[3], [], 'non-singleton work must retain lane admission');
        } }), []);
      assert.deepEqual(started, ['background-1'], 'the held memory still bounds admission');
    } finally {
      finish();
      await tick;
      await settle();
    }
    assert.deepEqual(await tickWith({ rows: [odd], budget: '1000' }), ['odd-1']);
  });
}

test('different packages of one file review in parallel, retain admission, and release their own slots', async () => {
  const rows = [0, 1, 2].map(index => ({ ...job(`review-${index}`, 'intake-run', index),
    case_id: 'same-case', source_id: 'same-file', payload: { phase: 'prepare', packageId: `package-${index}` } }));
  const started: string[] = [];
  const finishes = new Map<string, () => void>();
  const intakeRun = (id: string) => new Promise<void>(resolve => {
    started.push(id);
    finishes.set(id, resolve);
  });
  const tick = async (selected = rows, elsewhere: ReturnType<typeof job>[] = [], budget = '100000') => {
    let selection!: Sent;
    await tickWith({ rows: selected, budget, elsewhere, intakeRun, selected: sent => { selection = sent; } });
    return selection;
  };
  try {
    await tick();
    assert.deepEqual(started, ['review-0', 'review-1'], 'link concurrency is two, not one or three');
    const selection = await tick();
    assert.deepEqual(selection.values[2], ['review-0', 'review-1']);
    assert.deepEqual(selection.values[3], [], 'a held review must not hide all intake-run jobs');
    assert.deepEqual(started, ['review-0', 'review-1'], 'a second tick cannot start a held job twice');
    finishes.get('review-0')!();
    await settle();
    await tick([rows[1], rows[2]]);
    assert.deepEqual(started, ['review-0', 'review-1', 'review-2']);
  } finally {
    for (const finish of finishes.values()) finish();
    await settle();
  }
  const selection = await tick([]);
  assert.deepEqual(selection.values[2], [], 'every reservation is released');
  try {
    await tick(rows, [job('evidence', 'intake-evidence')]);
    assert.equal(started.length, 4, 'another link job consumes one slot');
  } finally {
    for (const finish of finishes.values()) finish();
    await settle();
  }
  try {
    await tick(rows, [], '256');
    assert.equal(started.length, 5, 'the memory budget still admits only one review');
  } finally {
    for (const finish of finishes.values()) finish();
    await settle();
  }
});

test('ordered intake work drains reviews, keeps its serial selector, and cannot race the prepare pool', async () => {
  let release!: () => void, releaseOrdered!: () => void;
  const running = new Promise<void>(resolve => { release = resolve; });
  const orderedRunning = new Promise<void>(resolve => { releaseOrdered = resolve; });
  const review = { ...job('review', 'intake-run'), payload: { phase: 'prepare' } };
  const target = { ...job('target', 'intake-run'), payload: { phase: 'target' } };
  let reviews = 0, ordered = 0;
  const tick = async (rows: object[]) => {
    let selection!: Sent;
    await tickWith({ rows, budget: '100000', intakeRun: async () => { reviews++; await running; },
      intakeRunNext: async () => { ordered++; await orderedRunning; }, selected: sent => { selection = sent; } });
    return selection;
  };
  try {
    await tick([review]);
    await tick([target, { ...review, id: 'later' }]);
    assert.deepEqual([reviews, ordered], [1, 0], 'ordered work waits and no new review starts');
    release();
    await settle();
    await tick([review, target, { ...target, id: 'other-target' }]);
    assert.deepEqual([reviews, ordered], [1, 1], 'only the existing ordered selector starts');
    const selection = await tick([{ ...review, id: 'later' }]);
    assert.equal(reviews, 1, 'the ordered chain holds off preparations until it settles');
    assert.deepEqual(selection.values[3], ['intake-run'], 'busy ordered work leaves the ready window');
  } finally {
    release();
    releaseOrdered();
    await settle();
  }
});

// The selection's meaning needs PostgreSQL; temporary tables shadow any real ones for this session only.
const database = process.env.ULPIN_DISPATCH_TEST_DATABASE_URL;
/** The ids the selection picks from the jobs `fill` adds to a temporary table. */
async function picked(fill: (add: (id: string, operation: string, source: string | null, minutes: number,
  status?: string, due?: number, dispatched?: boolean) => Promise<unknown>) => Promise<void>,
  attempts: { jobId: string; state: string; seconds: number }[] = [], fullLanes: string[] = []): Promise<string[]> {
  const { sql, values } = await selection();
  values[4] = fullLanes;
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    await client.query(`CREATE TEMPORARY TABLE jobs (id text PRIMARY KEY, operation text NOT NULL,
      status text NOT NULL, next_attempt_at timestamptz NOT NULL, created_at timestamptz NOT NULL, source_id text,
      case_id text NOT NULL, dispatched_at timestamptz)`);
    await client.query(`CREATE TEMPORARY TABLE usp_intake_items (source_id text,case_id text,parent_item_id text,
      created_at timestamptz NOT NULL,pinned_by_officer boolean NOT NULL,wave integer NOT NULL,
      placement text,plan_ref jsonb,item_id text,family text NOT NULL DEFAULT 'unknown')`);
    await client.query("CREATE TEMPORARY TABLE usp_intake_parts (item_id text,state text NOT NULL DEFAULT 'published')");
    await client.query(`CREATE TEMPORARY TABLE usp_job_attempts
      (job_id text NOT NULL, state text NOT NULL, lease_until timestamptz NOT NULL)`);
    await fill((id, operation, source, minutes, status = 'queued', due = 0, dispatched = false) => client.query(
      `INSERT INTO jobs VALUES($1,$2,$3,now()+make_interval(mins=>$5),now()-make_interval(mins=>$4),$6,'case-1',
        CASE WHEN $7::boolean THEN now() ELSE NULL END)`,
      [id, operation, status, minutes, due, source, dispatched]));
    for (const attempt of attempts) await client.query(
      'INSERT INTO usp_job_attempts VALUES($1,$2,now()+make_interval(secs=>$3))',
      [attempt.jobId, attempt.state, attempt.seconds]);
    return (await client.query(sql, values)).rows.map(job => job.id);
  } finally {
    await client.end();
  }
}

test('211 parts of one point cloud cannot hold back a table, and a probe goes first', { skip: !database }, async () => {
  const ids = await picked(async add => {
    for (let index = 0; index < 211; index++) await add(`laz-${index}`, 'point-batch', 'laz', 300 - index);
    await add('other-0', 'point-batch', 'laz-2', 50);
    await add('other-1', 'point-batch', 'laz-2', 40);
    await add('vector', 'streaming-vector', 'laz', 400);
    await add('odd', 'mystery-operation', null, 30);
    await add('table', 'chunk-mapping', 'csv', 1);
    await add('probe', 'inspect', 'new', 0);
    await add('done', 'point-batch', 'laz', 500, 'succeeded');
    await add('later', 'point-batch', 'laz', 500, 'queued', 3);
    await add('usp-step', 'usp:packet', 'laz', 500);
  });
  assert.deepEqual(ids, ['probe', 'vector', 'laz-0', 'other-0', 'odd', 'table', 'laz-1', 'other-1', 'laz-2', 'laz-3',
    'laz-4', 'laz-5']);
});

test('ready selection skips busy workers and live leases, but expired and fenced jobs stay eligible',
  { skip: !database }, async () => {
    let finish!: () => void;
    const running = new Promise<void>(resolve => { finish = resolve; });
    try {
      await tickWith({ rows: [pdf], budget: '100000', packetPdf: () => running });
      const ids = await picked(async add => {
        for (let index = 0; index < 20; index++) await add(`pdf-${index}`, 'packet-pdf', `source-${index}`, 100);
        await add('live', 'streaming-vector', 'raw', 5, 'running');
        await add('expired', 'streaming-vector', 'raw-2', 4, 'running');
        await add('fenced', 'streaming-vector', 'raw-3', 3, 'running');
        await add('table', 'chunk-mapping', 'csv', 2);
      }, [
        { jobId: 'live', state: 'active', seconds: 180 },
        { jobId: 'expired', state: 'active', seconds: -1 },
        { jobId: 'fenced', state: 'fenced', seconds: 180 },
      ]);
      assert.deepEqual(ids, ['expired', 'fenced', 'table']);
    } finally {
      finish();
      await settle();
    }
  });

test('a lone file still offers twelve jobs when nothing else waits', { skip: !database }, async () => {
  const ids = await picked(async add => {
    for (let index = 0; index < 15; index++) await add(`chip-${index}`, 'spatial-inference', 'tif', 100 - index);
  });
  assert.deepEqual(ids, Array.from({ length: 12 }, (_, index) => `chip-${index}`));
});

test('full-lane followers cannot hide short jobs or block processor polls', { skip: !database }, async () => {
  const ids = await picked(async add => {
    for (let index = 0; index < 20; index++) await add(`vector-${index}`, 'kml-native', `source-${index}`, 100);
    await add('poll', 'projected-vector', 'sent', 101, 'running', 0, true);
    await add('short', 'intake-run', 'batch', 1);
  }, [], ['vector']);
  assert.deepEqual(ids, ['poll', 'short']);
});

test('four occupied stream slots leave vector and link jobs selectable without increasing their capacity', () => {
  const held = new DispatchReservations();
  const big = 100000;
  assert.ok(held.admit(job('raw', 'streaming-vector'), big, [], at(0)));
  assert.ok(held.admit(job('profile', 'streamed-profile'), big, [], at(0)));
  assert.deepEqual(held.unavailableLanes([]), []);
  assert.ok(held.admit(job('raw-2', 'streaming-vector'), big, [], at(0)));
  assert.ok(held.admit(job('profile-2', 'streamed-profile'), big, [], at(0)));
  assert.deepEqual(held.unavailableLanes([]), ['stream']);
  assert.equal(held.admit(job('raw-3', 'streaming-vector'), big, [], at(233)), false);
  assert.ok(held.admit(job('conductor', 'intake-large'), big, [], at(233)));
  assert.ok(held.admit(job('short', 'intake-run'), big, [], at(233)));
  held.release('raw');
  assert.deepEqual(held.unavailableLanes([]), []);
  assert.ok(held.admit(job('raw-3', 'streaming-vector'), big, [], at(234)));
});

test('a full vector lane cannot spend all twelve ready rows ahead of a short document job on fakes', async () => {
  // Processor holdings fill the lane without consuming the local heap needed by the document.
  const holders = Array.from({ length: DISPATCH_LANES.vector.concurrency },
    (_, index) => job(`tile-${index}`, 'projected-vector'));
  const ready = Array.from({ length: 20 }, (_, index) => job(`vector-${index}`, 'projected-vector'));
  ready.push(pdf);
  const started: string[] = [];
  // Fake only row selection, using the real tick's excluded-lane parameter before its LIMIT 12.
  await withPool((sql, values) => {
    if (!sql.includes('AS file_rank')) return sql.includes('dispatched_at IS NOT NULL') ? holders : [];
    const full = (values[4] ?? []) as string[];
    return ready.filter(row => !full.includes(dispatchCost(row.operation).lane)).slice(0, 12);
  }, async () => {
    assert.equal(await dispatchTick({ packetPdf: async id => { started.push(id); } }), 1);
    assert.deepEqual(started, ['pdf-1']);
    await settle();
  });
});

test('durable processor holdings close a lane once, even during its local transport reservation', () => {
  const held = new DispatchReservations();
  const first = job('first', 'projected-vector');
  assert.ok(held.admit(first, 100000, [], at(0)));
  assert.deepEqual(held.unavailableLanes([first]), []);
  const outside = [first, ...Array.from({ length: DISPATCH_LANES.vector.concurrency - 1 },
    (_, index) => job(`outside-${index}`, 'projected-vector'))];
  assert.deepEqual(held.unavailableLanes(outside), ['vector']);
});

async function withProcessorFetch(fetching: typeof fetch, run: () => Promise<void>) {
  const savedFetch = globalThis.fetch;
  const saved = ['GEO_URL', 'GEO_SERVICE_TOKEN'].map(name => [name, process.env[name]] as const);
  Object.assign(process.env, { GEO_URL: 'http://processor.invalid', GEO_SERVICE_TOKEN: 'protocol' });
  globalThis.fetch = fetching;
  try {
    await run();
  } finally {
    globalThis.fetch = savedFetch;
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

type StalledProcessor = { begun: Promise<void>; finish: () => void; calls: () => number };
async function withStalledProcessor(run: (processor: StalledProcessor) => Promise<void>) {
  let finish!: () => void;
  let calls = 0;
  const blocked = new Promise<Response>((_resolve, reject) => {
    finish = () => reject(new Error('fake transport stopped'));
  });
  let began!: () => void;
  const begun = new Promise<void>(resolve => { began = resolve; });
  const fetching = () => {
    calls++;
    began();
    return blocked;
  };
  await withProcessorFetch(fetching, () => run({ begun, finish, calls: () => calls }));
}

for (const dispatched of [false, true]) {
  test(`a stalled processor ${dispatched ? 'poll' : 'submission'} cannot delay a short job or start twice`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: at(0) });
    await withStalledProcessor(async processor => {
      const row = { ...odd, dispatched_at: dispatched ? new Date(at(0)) : null };
      let rows: object[] = [row];
      await withPool(sql => sql.includes('AS file_rank') ? rows : [], async sent => {
        const tick = dispatchTick();
        try {
          await processor.begun;
          assert.equal(await Promise.race([tick.then(() => true), settle().then(() => false)]), true);
          t.mock.timers.tick(233000);
          rows = [row, pdf];
          const started: string[] = [];
          await dispatchTick({ packetPdf: async id => { started.push(id); } });
          assert.deepEqual(started, ['pdf-1'], 'short work starts before the long transport returns');
          assert.equal(processor.calls(), 1, 'no duplicate submission or poll while in flight');
          const selections = sent.filter(statement => statement.sql.includes('AS file_rank'));
          assert.ok((selections[1].values[2] as string[]).includes(row.id));
        } finally {
          processor.finish();
          await tick;
          await settle();
        }
      });
    });
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function submissionSnapshotFixture() {
  const submission = deferred<Response>();
  const snapshot = deferred<object[]>();
  const snapshotBegan = deferred<void>();
  const row = { ...odd, created_at: new Date() };
  const state = { blockSnapshot: false, active: false, rows: [row] as object[] };
  const fetching: typeof fetch = async (_url, init) => init?.method === 'POST' ? submission.promise
    : new Response(JSON.stringify({ jobId: row.id, status: 'queued' }));
  const answer = (sql: string) => {
    if (sql.includes('AS file_rank')) return state.rows;
    if (sql.startsWith('UPDATE jobs SET status=$2')) state.active = true;
    if (!sql.includes('dispatched_at IS NOT NULL')) return [];
    if (!state.blockSnapshot) return state.active ? [row] : [];
    snapshotBegan.resolve();
    return snapshot.promise;
  };
  return { submission, snapshot, snapshotBegan, row, state, fetching, answer };
}

test('submission resources remain reserved across a stale durable snapshot, then transfer without a capacity gap',
  async () => {
    const fixture = submissionSnapshotFixture();
    const { state, row } = fixture;
    const budget = process.env.DISPATCH_MEMORY_MIB;
    process.env.DISPATCH_MEMORY_MIB = '1000';
    const started: string[] = [];
    const packetPdf = async (id: string) => { started.push(id); };
    try {
      await withProcessorFetch(fixture.fetching, () => withPool(fixture.answer, async sent => {
        await dispatchTick();
        state.blockSnapshot = true;
        state.rows = [pdf];
        const tick = dispatchTick({ packetPdf });
        await fixture.snapshotBegan.promise;
        fixture.submission.resolve(new Response(JSON.stringify({ jobId: row.id, status: 'queued' })));
        await settle();
        fixture.snapshot.resolve([]);
        await tick;
        const selected = sent.filter(statement => statement.sql.includes('AS file_rank')).at(-1)!;
        assert.ok((selected.values[2] as string[]).includes(row.id), 'old snapshot cannot release the local hold');
        assert.deepEqual(started, []);
        state.blockSnapshot = false;
        await dispatchTick({ packetPdf });
        assert.deepEqual(started, [], 'fresh durable holding still consumes memory');
        state.active = false;
        await dispatchTick({ packetPdf });
        assert.deepEqual(started, ['pdf-1']);
        await settle();
      }));
    } finally {
      if (budget === undefined) delete process.env.DISPATCH_MEMORY_MIB;
      else process.env.DISPATCH_MEMORY_MIB = budget;
    }
  });

test('completion wakes selection before the 750 ms poll and a completion during a tick is not lost', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: at(0) });
  let finish!: () => void;
  const running = new Promise<void>(resolve => { finish = resolve; });
  try {
    await tickWith({ rows: [pdf], budget: '100000', packetPdf: () => running });
    const version = dispatchWakeVersion();
    let woke = false;
    const waiting = waitForDispatch(version).then(() => { woke = true; });
    await Promise.resolve();
    assert.equal(woke, false);
    finish();
    await settle();
    await waiting;
    assert.equal(Date.now(), at(0), 'no poll interval elapsed');
    await waitForDispatch(version);
  } finally {
    finish();
    await settle();
  }
});

test('a nonterminal processor poll does not wake a busy loop', async () => {
  const row = { ...odd, created_at: new Date(), dispatched_at: new Date() };
  const reply = async () => new Response(JSON.stringify({ jobId: row.id, status: 'running' }));
  await withProcessorFetch(reply, async () => {
    const version = dispatchWakeVersion();
    await withPool(sql => sql.includes('AS file_rank') ? [row] : [], async () => {
      await dispatchTick();
      await settle();
    });
    assert.equal(dispatchWakeVersion(), version);
  });
});

test('a stalled surface admission neither delays ready work nor overlaps another pass', async () => {
  const admission = deferred<object[]>();
  const began = deferred<void>();
  let passes = 0;
  const started: string[] = [];
  await withPool(sql => {
    if (sql.includes('AS file_rank')) return [pdf];
    if (!sql.includes('FROM usp_intake_items i')) return [];
    passes++;
    began.resolve();
    return admission.promise;
  }, async () => {
    const packetPdf = async (id: string) => { started.push(id); };
    const first = dispatchTick({ packetPdf });
    try {
      await began.promise;
      assert.equal(await Promise.race([first.then(() => true), settle().then(() => false)]), true);
      await dispatchTick({ packetPdf });
      assert.equal(passes, 1, 'the blocked pass retains exclusive ownership');
      assert.deepEqual(started, ['pdf-1', 'pdf-1']);
    } finally {
      admission.resolve([]);
      await first;
      await settle();
    }
    await dispatchTick({ packetPdf });
    assert.equal(passes, 2, 'a settled pass permits the next admission');
    await settle();
  });
});

test('idle dispatch still waits for the fallback poll', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let woke = false;
  const waiting = waitForDispatch(dispatchWakeVersion()).then(() => { woke = true; });
  t.mock.timers.tick(749);
  await Promise.resolve();
  assert.equal(woke, false);
  t.mock.timers.tick(1);
  await waiting;
});
