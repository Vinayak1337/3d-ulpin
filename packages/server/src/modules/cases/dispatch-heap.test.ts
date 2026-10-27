import assert from 'node:assert/strict';
import { totalmem } from 'node:os';
import test from 'node:test';
import { getHeapStatistics } from 'node:v8';
import { DISPATCH_HEAP_RESERVE_MIB, DispatchReservations, dispatchCost, dispatchHeapBudgetMiB,
  dispatchMemoryBudgetMiB } from './dispatch-lanes';

const job = (id: string, operation: string) => ({ id, operation, created_at: new Date(Date.UTC(2026, 9, 24)) });
const heap = dispatchHeapBudgetMiB(4288);
const machine = dispatchMemoryBudgetMiB(undefined);

test('heap budget leaves the named reserve; the default machine budget remains half of RAM', () => {
  assert.equal(DISPATCH_HEAP_RESERVE_MIB, 1024);
  assert.equal(heap, 3264);
  assert.equal(dispatchHeapBudgetMiB(), getHeapStatistics().heap_size_limit / 1024 ** 2 - 1024);
  assert.equal(dispatchHeapBudgetMiB(512), -512);
  assert.equal(machine, Math.floor(totalmem() / 2 / 1024 ** 2));
  assert.equal(dispatchMemoryBudgetMiB(9000), 9000);
});

test('a 4288 MiB heap stops in-process holds without reducing the unstated machine budget for processors', () => {
  const held = new DispatchReservations();
  const operations = ['raster-window', 'raster-window', 'streamed-profile', 'point-batch', 'intake-draft'];
  const reserved = operations.reduce((total, operation) => total + dispatchCost(operation).mib, 0);
  assert.equal(reserved, 3200);
  assert.ok(reserved <= heap && reserved + dispatchCost('intake-draft').mib > heap);
  for (const [index, operation] of operations.entries()) {
    assert.ok(held.admit(job(String(index), operation), machine, [], 0, Infinity, heap));
  }
  assert.equal(held.admit(job('blocked', 'intake-draft'), machine, [], 0, Infinity, heap), false);
  assert.deepEqual(held.refusedJobIds(), ['blocked']);
  assert.ok(held.admit(job('inspect', 'inspect'), machine, [], 0, Infinity, heap));
  assert.ok(held.admit(job('build', 'build'), machine, [], 0, Infinity, heap));
  held.release('4');
  assert.ok(held.admit(job('blocked', 'intake-draft'), machine, [], 1, Infinity, heap));
  assert.deepEqual(held.refusedJobIds(), []);
});

test('only this process\'s own in-process holds consume its heap budget', () => {
  const held = new DispatchReservations();
  const elsewhere = [job('outside-local-operation', 'ifc-native'), job('outside-processor', 'inspect')];
  assert.ok(held.admit(job('processor', 'build'), 10_000, elsewhere, 0, Infinity, 1024));
  assert.ok(held.admit(job('local-vector', 'kml-native'), 10_000, elsewhere, 0, Infinity, 1024));
  assert.ok(held.admit(job('local-point', 'point-batch'), 10_000, elsewhere, 0, Infinity, 1024));
  assert.equal(held.admit(job('blocked', 'intake-draft'), 10_000, elsewhere, 0, Infinity, 1024), false);
});

test('an oversized in-process job runs alone among local jobs even when processor jobs are held', () => {
  const held = new DispatchReservations();
  const elsewhere = [job('outside', 'raster-window')];
  assert.ok(held.admit(job('processor', 'inspect'), 10_000, elsewhere, 0, Infinity, 1024));
  assert.ok(dispatchCost('intake-plan').mib > 1024);
  assert.ok(held.admit(job('oversized', 'intake-plan'), 10_000, elsewhere, 0, Infinity, 1024));
  assert.equal(held.admit(job('blocked', 'intake-draft'), 10_000, elsewhere, 0, Infinity, 1024), false);
  held.release('oversized');
  assert.ok(held.admit(job('blocked', 'intake-draft'), 10_000, elsewhere, 1, Infinity, 1024));
});

test('unnamed operations run in the processor and consume no local heap reservation', () => {
  const held = new DispatchReservations();
  assert.ok(held.admit(job('unnamed', 'mystery-operation'), 10_000, [], 0, Infinity, 0));
  assert.ok(held.admit(job('local', 'intake-plan'), 10_000, [], 0, Infinity, 0));
  assert.ok(held.admit(job('processor', 'build'), 10_000, [], 0, Infinity, 0));
  assert.equal(held.admit(job('second-local', 'intake-draft'), 10_000, [], 0, Infinity, 0), false);
});

test('machine memory still limits both processor and in-process jobs, regardless of heap space', () => {
  const held = new DispatchReservations();
  assert.ok(held.admit(job('processor', 'build'), 600, [], 0, Infinity, 10_000));
  assert.equal(held.admit(job('local', 'point-batch'), 600, [], 0, Infinity, 10_000), false);
  assert.equal(held.admit(job('processor-2', 'build'), 600, [], 0, Infinity, 10_000), false);
  assert.equal(held.admit(job('local', 'point-batch'), 600, [job('outside', 'build')], 0, Infinity, 10_000),
    false);
});

test('omitting the heap budget preserves admission and never raises lane concurrency', () => {
  const held = new DispatchReservations();
  assert.ok(held.admit(job('plan', 'intake-plan'), 10_000, [], 0));
  assert.ok(held.admit(job('raster-1', 'raster-window'), 10_000, [], 0));
  assert.ok(held.admit(job('raster-2', 'raster-window'), 10_000, [], 0));
  assert.equal(held.admit(job('raster-3', 'raster-window'), 10_000, [], 0, Infinity, 10_000), false);
});
