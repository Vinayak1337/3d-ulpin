import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver, environmentManager, type QueryObserverOptions } from '@tanstack/react-query';
import { areaCanonicalQuery, areaContextQuery } from './queries';

const FIVE_SECONDS = 5000;

/** A stand-in API whose every answer waits until the test releases it. */
function slowApi() {
  const pending: Array<() => void> = [];
  const fetch = vi.fn(() => new Promise<Response>((resolve) => {
    pending.push(() => resolve(new Response('{}', { headers: { 'content-type': 'application/json' } })));
  }));
  return { fetch, release: () => pending.splice(0).forEach((answer) => answer()) };
}

const reads: Array<[string, (areaId: string, live: boolean) => QueryObserverOptions]> = [
  ['context', areaContextQuery],
  ['canonical', areaCanonicalQuery],
];

describe.each(reads)('the live area %s read', (_name, query) => {
  let client: QueryClient;
  beforeEach(() => {
    // Tests run in Node, where React Query schedules no timers; the Studio runs in a browser.
    environmentManager.setIsServer(() => false);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => {
    client.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    environmentManager.setIsServer(() => true);
  });

  it('is read again every five seconds, and not while the previous read still runs', async () => {
    const api = slowApi();
    vi.stubGlobal('fetch', api.fetch);
    const stop = new QueryObserver(client, query('area-1', true)).subscribe(() => undefined);

    await vi.advanceTimersByTimeAsync(3 * FIVE_SECONDS);
    expect(api.fetch).toHaveBeenCalledTimes(1);

    api.release();
    await vi.advanceTimersByTimeAsync(FIVE_SECONDS - 1);
    expect(api.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.fetch).toHaveBeenCalledTimes(2);
    stop();
  });

  it('is not read again when the area is not live', async () => {
    const api = slowApi();
    vi.stubGlobal('fetch', api.fetch);
    const stop = new QueryObserver(client, query('area-1', false)).subscribe(() => undefined);
    api.release();
    await vi.advanceTimersByTimeAsync(3 * FIVE_SECONDS);
    expect(api.fetch).toHaveBeenCalledTimes(1);
    stop();
  });
});
