import { afterEach, expect, it, vi } from 'vitest';
import { initialStream } from './events';
import { openTableStream } from './useTableStream';

// A stand-in for the browser's EventSource: it records each opened path and lets the test fire its error.
class FakeSource {
  static readonly CLOSED = 2;
  static opened: FakeSource[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSource.opened.push(this);
  }

  addEventListener() {}

  close() {
    this.readyState = FakeSource.CLOSED;
  }
}

function opened() {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeSource);
  FakeSource.opened = [];
  const refs = { current: { current: initialStream() }, cursor: { current: '0' },
    selected: { current: { rawJobId: '', mappingJobId: '' } }, resumes: { current: 0 } };
  const effects = { publish: vi.fn(), fallback: vi.fn(), reopen: vi.fn() };
  const close = openTableStream('case', 'source', refs, effects);
  return { refs, effects, close, source: FakeSource.opened[0]! };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('a refused replay re-reads the table now and reopens at the head after a capped wait', async () => {
  const run = opened();
  expect(run.source.url).toBe('/api/v1/ingestion/cases/case/events?cursor=0');
  run.source.readyState = FakeSource.CLOSED;
  run.source.onerror!();
  expect(run.effects.publish).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: '', refresh: 1 }));
  expect(run.effects.fallback).toHaveBeenLastCalledWith(true);
  await vi.advanceTimersByTimeAsync(999);
  expect(run.effects.reopen).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(run.effects.reopen).toHaveBeenCalledOnce();
  openTableStream('case', 'source', run.refs, run.effects);
  expect(FakeSource.opened[1]!.url).toBe('/api/v1/ingestion/cases/case/events');
});

it('a connection the browser is still retrying neither re-reads nor reopens by itself', async () => {
  const run = opened();
  run.source.onerror!();
  expect(run.effects.fallback).toHaveBeenLastCalledWith(true);
  expect(run.effects.publish).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10000);
  expect(run.effects.reopen).not.toHaveBeenCalled();
  run.close();
});
