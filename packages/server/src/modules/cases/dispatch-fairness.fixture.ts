import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DispatchReservations, dispatchCost, dispatchHeapBudgetMiB, type DispatchJob } from './dispatch-lanes';
import { dispatchFixtureSelection, type SelectionFixtureJob } from './dispatch-selection.fixture';

/** Reconstruct only the pre-change ready order; the fixture still executes the SQL window functions. */
function beforeSelection(sql: string): string {
  return sql.replace(/        jobs.operation='intake-large' AND i.item_id[\s\S]*? AS first_part,\n/, '')
    .replace(/        AND NOT \(jobs.operation='intake-large'[^\n]+\n/, '')
    .replace("FROM ready\n        WHERE operation<>'intake-large' OR file_rank=1)", 'FROM ready)')
    .replace("lane='probe' DESC,first_part DESC,batch_rank", "lane='probe' DESC,batch_rank")
    .replace("item_waiting DESC NULLS LAST,\n      CASE WHEN operation='intake-large' THEN created_at"
      + ' ELSE item_created_at END', 'item_waiting DESC NULLS LAST,item_created_at');
}

type Work = SelectionFixtureJob & { step: number; seconds: number; publishAt: number; total: number };
const epoch = Date.UTC(2026, 9, 24);
const date = (seconds: number) => new Date(epoch + seconds * 1000);

/** Hypothetical service times, not a job-table trace. Only workload shape comes from the run-5 report.
 * Short orchestration steps cost 1 s; one Niagara fold costs 60 s; each cell's mapping handoff costs 8 s.
 * First publication is step 6. The remaining 20 Niagara parts each require one more 1 s fold here. */
function work(): Work[] {
  const item = (id: string, created: number, total: number): Work => ({ id: `${id}-0`, source_id: id,
    case_id: id, operation: 'intake-large', created_at: date(created), itemCreated: epoch,
    recipeState: 'approved', step: 0, seconds: 1, publishAt: 6, total });
  const rows = Array.from({ length: 24 }, (_, index) => item(`cell-${index}`, 0, 7));
  rows.push(item('first-file', 1, 26));
  for (const operation of ['point-batch', 'raster-window']) rows.push({ ...item(operation, 0, 1),
    operation, seconds: 12 });
  return rows;
}

function advance(row: Work, now: number): Work | undefined {
  const step = row.step + 1;
  if (step === row.total) return undefined;
  let seconds = 1;
  if (row.source_id === 'first-file' && step === 5) seconds = 60;
  if (row.source_id.startsWith('cell-') && step === 4) seconds = 8;
  return { ...row, id: `${row.source_id}-${step}`, step, seconds, created_at: date(now),
    parts: step >= row.publishAt ? 1 : 0 };
}

type Replay = { reservations: DispatchReservations; waiting: Work[]; running: { row: Work; end: number }[];
  now: number; longestWait: number; firstQueue: number; firstRun: number | null; peakMiB: number };
const budget = 8192, heap = dispatchHeapBudgetMiB(4096);

function finishReady(state: Replay) {
  const { running, reservations, waiting, now } = state;
  for (const active of [...running]) {
    if (active.end > now) continue;
    running.splice(running.indexOf(active), 1);
    reservations.release(active.row.id);
    const next = advance(active.row, now);
    if (next) waiting.push(next);
    if (active.row.operation === 'intake-large' && active.row.source_id === 'first-file' && active.row.step === 5) {
      waiting.push({ ...active.row, id: 'first-intake-run', operation: 'intake-run', created_at: date(now),
        seconds: 1, total: 6 });
    }
  }
}

function admitReady(sql: string, parameters: unknown[], before: boolean, state: Replay) {
  const { reservations, waiting, running, now } = state;
  const ready = waiting.filter(row => row.created_at.getTime() <= date(now).getTime());
  const values = [...parameters];
  values[4] = reservations.unavailableLanes([]);
  values[6] = before ? [] : reservations.unavailableLargeItems();
  // The old query uses six parameters and its lane ceiling was two. All other budget rules are unchanged.
  if (before) values.length = 6;
  for (const selected of dispatchFixtureSelection(sql, values, ready)) {
    const row = ready.find(row => row.id === selected.id)!;
    const job: DispatchJob = { ...row, payload: before ? undefined : { itemId: row.source_id } };
    if (before && dispatchCost(row.operation).lane === 'vector'
      && running.filter(active => dispatchCost(active.row.operation).lane === 'vector').length >= 2) continue;
    if (!reservations.admit(job, budget, [], now * 1000, Infinity, heap)) continue;
    waiting.splice(waiting.indexOf(row), 1);
    const wait = now - (row.created_at.getTime() - epoch) / 1000;
    if (row.operation === 'intake-large') {
      state.longestWait = Math.max(state.longestWait, wait);
      if (row.source_id === 'first-file' && row.step < 6) state.firstQueue += wait;
    }
    if (row.id === 'first-intake-run') state.firstRun = now;
    running.push({ row, end: now + row.seconds });
    state.peakMiB = Math.max(state.peakMiB,
      running.reduce((sum, active) => sum + dispatchCost(active.row.operation).mib, 0));
  }
}

/** Event-driven, no wall-clock waits or runtime: actual selection and admission on every completion/enqueue. */
function replay(sql: string, parameters: unknown[], before: boolean) {
  const state: Replay = { reservations: new DispatchReservations(), waiting: work(), running: [], now: 0,
    longestWait: 0, firstQueue: 0, firstRun: null, peakMiB: 0 };
  while (state.waiting.length || state.running.length) {
    finishReady(state);
    admitReady(sql, parameters, before, state);
    const events = [...state.running.map(active => active.end), ...state.waiting
      .map(row => (row.created_at.getTime() - epoch) / 1000).filter(time => time > state.now)];
    if (!events.length && state.waiting.length) throw new Error('Replay made no progress');
    if (events.length) state.now = Math.min(...events);
    if (state.now > 3600) throw new Error('Replay exceeded its one-hour simulated bound');
  }
  return { firstIntakeRunAdmissionSeconds: state.firstRun, firstFileQueueSeconds: state.firstQueue,
    longestIntakeLargeWaitSeconds: state.longestWait, peakReservedMiB: state.peakMiB, budgetMiB: budget,
    heapBudgetMiB: heap };
}

export function dispatchFairnessReplay(sql: string, values: unknown[]) {
  const before = beforeSelection(sql);
  // Normalized ready-query SHA-256 at fe77d595; fail closed if the reconstruction drifts.
  assert.equal(createHash('sha256').update(before.replace(/\s+/g, ' ').trim()).digest('hex'),
    '41f288f278690d4a6ac42488cffdfd226c3b36ebe17ef4eb3a5f6626068b6796');
  return { before: replay(before, values, true), after: replay(sql, values, false) };
}
