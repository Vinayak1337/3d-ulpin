import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { DISPATCH_HEAD_OF_LINE_MS, DISPATCH_LANES, DISPATCH_OPERATIONS, DISPATCH_SCRATCH_FLOOR_MIB,
  DispatchReservations, dispatchScratchBudgetMiB, dispatchScratchMiB } from './dispatch-lanes';

const GiB = 1024 ** 3;
/** A job created `seconds` after a fixed start, with the payload the tick read. */
const job = (id: string, operation: string, seconds = 0, payload?: unknown) =>
  ({ id, operation, created_at: new Date(Date.UTC(2026, 9, 21) + seconds * 1000), payload });
/** A streamed table read of a workbook of `gib` GiB, which XW1 copies into scratch with 1 GiB more. */
const workbook = (id: string, gib: number, seconds = 0) => job(id, 'streaming-vector', seconds,
  { sourceBytes: gib * GiB, tabular: { selection: { format: 'xlsx' } } });
const at = (seconds: number) => Date.UTC(2026, 9, 22) + seconds * 1000;
const memory = 1_000_000;

test('table detection and workbooks reserve scratch; pinned CSV, GIS and stored-window reads reserve none', () => {
  assert.equal(dispatchScratchMiB(workbook('w', 3)), 4096);
  assert.equal(dispatchScratchMiB(job('csv', 'streaming-vector', 0,
    { sourceBytes: 3 * GiB, tabular: { selection: { format: 'csv' } } })), 0);
  assert.equal(dispatchScratchMiB(job('gis', 'streaming-vector', 0, { sourceBytes: 3 * GiB })), 0);
  assert.equal(dispatchScratchMiB(job('map', 'chunk-mapping')), 0);
  // A table-profile payload names no size, so a workbook takes the table lane's default: 7 GiB and 1 GiB more.
  const request = (format: string) => ({ request: { selection: { format } } });
  assert.equal(dispatchScratchMiB(job('t', 'table-profile', 0, request('xlsx'))), DISPATCH_LANES.table.scratchMiB);
  assert.equal(DISPATCH_LANES.table.scratchMiB, 8192);
  assert.equal(dispatchScratchMiB(job('t', 'table-profile', 0, request('csv'))), 8192);
  assert.equal(dispatchScratchMiB(job('t', 'table-profile', 0,
    { ...request('csv'), sourceBytes: 2 * GiB })), 3072);
  assert.equal(dispatchScratchMiB(job('t', 'table-profile')), 8192);
  assert.equal(dispatchScratchMiB(job('ocr', 'document-extraction')), 17);
});

test('every operation the processor runs, and any it is sent unnamed, reserves no scratch', () => {
  const processor = Object.entries(DISPATCH_OPERATIONS).filter(([, row]) => row.processor);
  assert.ok(processor.length >= 5);
  for (const [operation] of processor) assert.equal(dispatchScratchMiB(job('p', operation)), 0, operation);
  assert.equal(dispatchScratchMiB(job('odd', 'mystery-operation')), 0);
  const held = new DispatchReservations();
  const elsewhere = [job('chip', 'spatial-inference'), job('build', 'build'), job('odd', 'mystery-operation')];
  assert.ok(held.admit(workbook('w', 3), memory, elsewhere, at(0), 4096));
});

test('parallel reader operations remain selectable but the heap budget still refuses their second start', () => {
  for (const operation of ['streaming-vector', 'streamed-profile', 'chunk-mapping', 'intake-large',
    'intake-native-derivative']) {
    const held = new DispatchReservations();
    assert.ok(held.admit(job('first', operation), memory, [], at(0), Infinity, 511));
    assert.deepEqual(held.unavailableOperations(), []);
    assert.equal(held.admit(job('second', operation, 1), memory, [], at(0), Infinity, 511), false);
    assert.deepEqual(held.refusedJobIds(), ['second']);
    held.release('first');
    assert.ok(held.admit(job('second', operation, 1), memory, [], at(1), Infinity, 511));
  }
});

test('two workbooks over the scratch budget start one after the other', () => {
  const held = new DispatchReservations();
  assert.ok(held.admit(workbook('first', 3), memory, [], at(0), 6000));
  assert.equal(held.admit(workbook('second', 3, 1), memory, [], at(0), 6000), false);
  assert.deepEqual(held.refusedJobIds(), ['second']);
  // A job that writes no scratch is never refused for it.
  assert.ok(held.admit(job('map', 'chunk-mapping', 2), memory, [], at(0), 6000));
  held.release('first');
  assert.ok(held.admit(workbook('second', 3, 1), memory, [], at(1), 6000));
  assert.deepEqual(held.refusedJobIds(), []);
});

test('a workbook over the whole scratch budget runs alone among the jobs that write scratch', () => {
  const held = new DispatchReservations();
  assert.ok(held.admit(job('ocr', 'document-extraction'), memory, [], at(0), 1000));
  assert.equal(held.admit(workbook('huge', 5, 1), memory, [], at(0), 1000), false);
  held.release('ocr');
  assert.ok(held.admit(workbook('huge', 5, 1), memory, [], at(1), 1000));
  assert.equal(held.admit(job('ocr-2', 'document-extraction', 2), memory, [], at(1), 1000), false);
  assert.ok(held.admit(job('map', 'chunk-mapping', 3), memory, [], at(1), 1000));
});

test('a workbook refused for scratch stops newer jobs after the head-of-line wait, then starts when it fits', () => {
  const held = new DispatchReservations();
  const scratch = 6000, wait = DISPATCH_HEAD_OF_LINE_MS / 1000;
  assert.ok(held.admit(workbook('running', 3, 0), memory, [], at(0), scratch));
  assert.equal(held.admit(workbook('big', 3, 10), memory, [], at(100), scratch), false);
  assert.ok(held.admit(job('map-1', 'chunk-mapping', 20), memory, [], at(100), scratch));
  assert.equal(held.admit(job('map-2', 'chunk-mapping', 30), memory, [], at(101 + wait), scratch), false);
  assert.ok(held.admit(job('probe', 'inspect', 40), memory, [], at(101 + wait), scratch));
  held.release('running');
  assert.ok(held.admit(workbook('big', 3, 10), memory, [], at(102 + wait), scratch));
  assert.ok(held.admit(job('map-2', 'chunk-mapping', 30), memory, [], at(102 + wait), scratch));
});

test('the scratch budget is the root\'s free space less the floor, read from the OCR scratch or the temp folder',
  async () => {
    const saved = process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
    const read: string[] = [];
    const disk = async (path: string) => { read.push(path); return { bavail: 10 * 1024 ** 2, bsize: 1024 }; };
    try {
      delete process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
      assert.equal(await dispatchScratchBudgetMiB(disk), 10_240 - DISPATCH_SCRATCH_FLOOR_MIB);
      process.env.ULPIN_DOCUMENT_OCR_SCRATCH = 'X:/private-scratch';
      assert.equal(await dispatchScratchBudgetMiB(disk), 8192);
      assert.deepEqual(read, [tmpdir(), 'X:/private-scratch']);
    } finally {
      if (saved === undefined) delete process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
      else process.env.ULPIN_DOCUMENT_OCR_SCRATCH = saved;
    }
  });

test('a scratch root that cannot be read logs one line and blocks nothing that tick', async () => {
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (...line: unknown[]) => { warned.push(line.map(String).join(' ')); };
  let budget: number;
  try {
    budget = await dispatchScratchBudgetMiB(async () => {
      throw Object.assign(new Error('SECRET_MARKER_TEXT at X:/private'), { code: 'ENOENT' });
    });
  } finally {
    console.warn = warn;
  }
  assert.equal(budget, Infinity);
  assert.deepEqual(warned, ["The dispatcher could not read the scratch root's free space (ENOENT); scratch is not " +
    'limited this tick.']);
  const held = new DispatchReservations();
  assert.ok(held.admit(workbook('first', 3), memory, [], at(0), budget));
  assert.ok(held.admit(workbook('second', 3, 1), memory, [], at(0), budget));
});
