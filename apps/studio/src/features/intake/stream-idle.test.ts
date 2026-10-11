import { afterEach, expect, it, vi } from 'vitest';
import { CASE_STREAM_IDLE_MS, readCaseStream } from './stream-reader';

function stream() {
  vi.useFakeTimers();
  let push: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal('fetch', async (_path: string, options: RequestInit) => new Response(new ReadableStream({
    start(controller) {
      push = controller;
      options.signal!.addEventListener('abort', () => controller.error(options.signal!.reason), { once: true });
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const opened = vi.fn();
  const finished = readCaseStream('/events', new AbortController().signal, opened, vi.fn())
    .then(() => 'ended', error => error.message);
  return { finished, opened, heartbeat: () => push.enqueue(new TextEncoder().encode(': keep-alive\n\n')) };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('three missing server keep-alives cancel the actual fetch reader, not only a status banner', async () => {
  const run = stream();
  await vi.advanceTimersByTimeAsync(CASE_STREAM_IDLE_MS - 1);
  expect(run.opened).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(await run.finished).toBe('Live batch updates stopped answering.');
});

it('comment keep-alive bytes reset liveness even without a domain event', async () => {
  const run = stream();
  await vi.advanceTimersByTimeAsync(20000);
  run.heartbeat();
  await vi.advanceTimersByTimeAsync(20000);
  run.heartbeat();
  await vi.advanceTimersByTimeAsync(30000);
  expect(await run.finished).toBe('Live batch updates stopped answering.');
});
