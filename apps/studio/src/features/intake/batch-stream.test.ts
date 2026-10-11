import { afterEach, expect, it, vi } from 'vitest';
import { startBatchUpdates } from './useBatchStream';

class Stream {
  static instances: Stream[] = [];
  closed = false;
  onopen = () => {};
  onerror = () => {};
  handlers = new Map<string, (event: unknown) => void>();
  constructor(readonly url: string) { Stream.instances.push(this); }
  close() { this.closed = true; }
  addEventListener(kind: string, handler: (event: unknown) => void) { this.handlers.set(kind, handler); }
  emit(kind: string, data: unknown, id = '') {
    this.handlers.get(kind)?.({ type: kind, data: JSON.stringify(data), lastEventId: id });
  }
}

function begin(unsettled = false) {
  vi.useFakeTimers();
  Stream.instances = [];
  vi.stubGlobal('EventSource', Stream);
  vi.stubGlobal('window', { setInterval, clearInterval });
  const refetch = vi.fn();
  const disconnected = vi.fn();
  const stop = startBatchUpdates('case', () => ({ unsettled, refetch }), disconnected);
  return { refetch, disconnected, stop };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('resync reads once and automatically reconnects at its head without a disconnected banner', () => {
  const run = begin();
  const stream = Stream.instances[0]!;
  expect(stream.url).toBe('/api/v1/ingestion/cases/case/events');
  stream.emit('resync', { kind: 'resync', headCursor: '71' });
  expect(run.refetch).toHaveBeenCalledTimes(1);
  expect(stream.closed).toBe(true);
  vi.advanceTimersByTime(5000);
  expect(Stream.instances[1]!.url).toBe('/api/v1/ingestion/cases/case/events?cursor=71');
  expect(run.disconnected).not.toHaveBeenCalledWith(true);
  run.stop();
  vi.advanceTimersByTime(10000);
  expect(Stream.instances).toHaveLength(2);
});

it('errors reconnect from head; only two failed reconnects show a banner, success clears it', () => {
  const run = begin();
  Stream.instances[0]!.onerror();
  expect(Stream.instances[0]!.closed).toBe(true);
  vi.advanceTimersByTime(5000);
  Stream.instances[1]!.onerror();
  expect(run.disconnected).not.toHaveBeenCalledWith(true);
  vi.advanceTimersByTime(5000);
  Stream.instances[2]!.onerror();
  expect(run.disconnected).toHaveBeenLastCalledWith(true);
  vi.advanceTimersByTime(5000);
  expect(Stream.instances[3]!.url).toBe('/api/v1/ingestion/cases/case/events');
  Stream.instances[3]!.onopen();
  expect(run.disconnected).toHaveBeenLastCalledWith(false);
  run.stop();
});

it('reads on recipe/item/target notifications, deduplicates frames, and bounds quiet fallback', () => {
  const run = begin(true);
  const stream = Stream.instances[0]!;
  stream.emit('ready', { kind: 'ready' }, '10');
  for (const [index, kind] of ['recipe.changed', 'intake.item', 'intake.target'].entries()) {
    const frame = { kind: 'change', sequence: String(index + 1), change: { kind } };
    stream.emit('ingestion.change', frame, String(index + 11));
    stream.emit('ingestion.change', frame, String(index + 11));
  }
  expect(run.refetch).toHaveBeenCalledTimes(4);
  vi.advanceTimersByTime(4999);
  expect(run.refetch).toHaveBeenCalledTimes(4);
  vi.advanceTimersByTime(1);
  expect(run.refetch).toHaveBeenCalledTimes(5);
  run.stop();
});
