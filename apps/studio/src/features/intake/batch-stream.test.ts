import { ApiError } from '@ulpin/api-client';
import { afterEach, expect, it, vi } from 'vitest';
import { createCaseSubscriptions } from './case-subscription';
import { readCaseStream, takeFrames, type CaseFrame } from './stream-reader';

function harness() {
  vi.useFakeTimers();
  const streams: { path: string; signal: AbortSignal; opened: () => void; frame: (value: CaseFrame) => void;
    fail: (error: unknown) => void }[] = [];
  let open = 0;
  let maximum = 0;
  const read: typeof readCaseStream = (path, signal, opened, frame) => new Promise((resolve, reject) => {
    open++;
    maximum = Math.max(maximum, open);
    let active = true;
    const close = () => {
      if (active) open--;
      active = false;
    };
    streams.push({ path, signal, opened, frame, fail: error => { close(); reject(error); } });
    signal.addEventListener('abort', () => { close(); resolve(); }, { once: true });
  });
  const subscriptions = createCaseSubscriptions(read);
  const consumer = () => ({ refresh: vi.fn(), unsettled: () => true, status: vi.fn() });
  return { streams, subscriptions, consumer, maximum: () => maximum, open: () => open };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('two consumers open one stream, resync reconnects at head, and only the last leave closes it', async () => {
  const run = harness();
  const tray = run.consumer();
  const cards = run.consumer();
  const leaveTray = run.subscriptions.subscribe('case', tray);
  const leaveCards = run.subscriptions.subscribe('case', cards);
  expect(run.streams).toHaveLength(1);
  run.streams[0]!.opened();
  run.streams[0]!.frame({ kind: 'resync', id: '', data: { kind: 'resync', headCursor: '71' } });
  expect(tray.refresh).toHaveBeenCalledTimes(1);
  expect(cards.refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(run.streams[1]!.path).toBe('/api/v1/ingestion/cases/case/events?cursor=71');
  leaveTray();
  expect(run.open()).toBe(1);
  leaveCards();
  expect(run.open()).toBe(0);
  await vi.advanceTimersByTimeAsync(10000);
  expect(run.streams).toHaveLength(2);
  expect(run.maximum()).toBe(1);
});

it('an immediate effect remount waits for the old transport cancellation before reopening', async () => {
  const finishes: (() => void)[] = [];
  let readers = 0;
  let maximum = 0;
  const read: typeof readCaseStream = () => new Promise(resolve => {
    readers++;
    maximum = Math.max(maximum, readers);
    finishes.push(() => { readers--; resolve(); });
  });
  const subscriptions = createCaseSubscriptions(read);
  const consumer = { refresh: vi.fn(), unsettled: () => true, status: vi.fn() };
  subscriptions.subscribe('case', consumer)();
  const leave = subscriptions.subscribe('case', consumer);
  expect(finishes).toHaveLength(1);
  finishes[0]!();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(finishes).toHaveLength(2);
  expect(maximum).toBe(1);
  leave();
  finishes[1]!();
});

it('errors retry from head and two failed reconnects show a banner; success clears the streak', async () => {
  const run = harness();
  const tray = run.consumer();
  const leave = run.subscriptions.subscribe('case', tray);
  run.streams[0]!.fail(new Error('lost'));
  await vi.advanceTimersByTimeAsync(5000);
  run.streams[1]!.fail(new Error('lost'));
  await vi.advanceTimersByTimeAsync(5000);
  expect(tray.status).not.toHaveBeenCalledWith(expect.objectContaining({ disconnected: true }));
  run.streams[2]!.fail(new Error('lost'));
  await vi.advanceTimersByTimeAsync(5000);
  expect(tray.status).toHaveBeenLastCalledWith({ disconnected: true, error: '' });
  expect(run.streams[3]!.path).toBe('/api/v1/ingestion/cases/case/events');
  run.streams[3]!.opened();
  expect(tray.status).toHaveBeenLastCalledWith({ disconnected: false, error: '' });
  leave();
});

it('429 words are displayed as supplied, and even a waiting question keeps bounded reads while refused', async () => {
  const run = harness();
  const tray = { ...run.consumer(), unsettled: () => false };
  const leave = run.subscriptions.subscribe('case', tray);
  const words = 'The bounded local event reader allowance is occupied.';
  run.streams[0]!.fail(new ApiError(429, '', { error: { code: 'INGESTION_STREAM_LIMIT', message: words } }));
  await vi.advanceTimersByTimeAsync(4999);
  expect(tray.refresh).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(tray.status).toHaveBeenLastCalledWith({ disconnected: true, error: words });
  expect(tray.refresh).toHaveBeenCalledTimes(1);
  leave();
});

it('reads on recipe/item/target notifications, deduplicates frames and bounds quiet fallback', async () => {
  const run = harness();
  const tray = run.consumer();
  const leave = run.subscriptions.subscribe('case', tray);
  for (const [index, kind] of ['recipe.changed', 'intake.item', 'intake.target'].entries()) {
    const frame = { kind: 'ingestion.change', id: String(index + 11),
      data: { kind: 'change', sequence: String(index + 1), change: { kind } } };
    run.streams[0]!.frame(frame);
    run.streams[0]!.frame(frame);
  }
  expect(tray.refresh).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(5000);
  expect(tray.refresh).toHaveBeenCalledTimes(4);
  leave();
});

it('parses complete SSE frames and preserves a chunk boundary; refused HTTP reads retain exact error words', async () => {
  const parsed = takeFrames(': heartbeat\n\nevent: ready\nid: 12\ndata: {"kind":"ready"}\n\nevent: resync\n');
  expect(parsed.frames).toEqual([{ kind: 'ready', id: '12', data: { kind: 'ready' } }]);
  expect(parsed.remaining).toBe('event: resync\n');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'Reader occupied.' } }, { status: 429 })));
  await expect(readCaseStream('/events', new AbortController().signal, vi.fn(), vi.fn()))
    .rejects.toMatchObject({ status: 429, message: 'Reader occupied.' });
});
