import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@ulpin/api-client';
import type { AreaDisplayWindow, AreaWindowFeature } from '../../api/queries';
import {
  WINDOW_SETTLE_MS, WindowReader, isAreaLimit, viewBounds, windowLine, windowScene, type Bounds,
} from './areaWindow';

function feature(identifier: string, kind: AreaWindowFeature['kind'] = 'building', heightM: number | null = null) {
  return {
    id: `id-${identifier}`, identifier, kind, heightM, heightState: heightM === null ? 'unknown' : 'source_supported',
    polygons: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]],
  } as AreaWindowFeature;
}

describe('window mode', () => {
  it('turns on for an AREA_LIMIT answer and not otherwise', () => {
    const limit = { error: { code: 'AREA_LIMIT', message: 'Choose an area with at most 10,000 display features.' } };
    expect(isAreaLimit(new ApiError(422, '/api/v1/areas/a/context', limit))).toBe(true);
    const other = { error: { code: 'MEMBERSHIP_FRAME' } };
    expect(isAreaLimit(new ApiError(422, '/api/v1/areas/a/context', other))).toBe(false);
    expect(isAreaLimit(new ApiError(503, '/api/v1/areas/a/canonical', limit))).toBe(false);
    expect(isAreaLimit(new Error('AREA_LIMIT'))).toBe(false);
    expect(isAreaLimit(null)).toBe(false);
  });

  it('says how many are drawn when the budget or the view cuts the area, and the total when all are', () => {
    const drawn = [feature('a'), feature('b')];
    expect(windowLine(drawn, 41_809)).toBe('Showing 2 of 41,809 buildings; move closer to see the rest.');
    expect(windowLine(drawn, 2)).toBe('2 buildings');
    expect(windowLine([feature('a'), feature('r', 'road')], 2)).toBe('2 features');
  });

  it('extrudes a stated height, keeps an unstated one flat and draws other kinds as base', () => {
    const { footprints, base } = windowScene([feature('a', 'building', 12), feature('b'), feature('r', 'road')]);
    expect(footprints.map((input) => [input.id, input.heightM])).toEqual([['id-a', 12], ['id-b', null]]);
    expect(base.map((input) => [input.id, input.kind])).toEqual([['id-r', 'road']]);
  });

  it('clips the view to the area extent and gives no window outside it', () => {
    const view: [number, number][] = [[-50, -50], [50, -50], [60, 80], [-60, 80]];
    expect(viewBounds(view, [0, 0, 1000, 1000])).toEqual([0, 0, 60, 80]);
    expect(viewBounds(view, [500, 500, 1000, 1000])).toBeNull();
  });
});

describe('window reads', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const page = (features: AreaWindowFeature[], next: string | null) =>
    ({ areaId: 'a', areaRevision: 1, features, next }) as AreaDisplayWindow;

  it('reads once the camera settles and pages by next up to the budget', async () => {
    const read = vi.fn(async (_: Bounds, after: string | undefined, limit: number) =>
      after ? page([feature('c')].slice(0, limit), 'd') : page([feature('a'), feature('b')], 'b'));
    const published: string[][] = [];
    const reader = new WindowReader(() => [0, 0, 10, 10], read,
      (features) => published.push(features.map((item) => item.identifier)), vi.fn(), 3);
    reader.viewChanged();
    reader.viewChanged();
    await vi.advanceTimersByTimeAsync(WINDOW_SETTLE_MS - 1);
    expect(read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(read.mock.calls.map(([, after, limit]) => [after, limit])).toEqual([[undefined, 3], ['b', 1]]);
    expect(published).toEqual([['a', 'b'], ['a', 'b', 'c']]);
    reader.viewChanged();
    await vi.advanceTimersByTimeAsync(WINDOW_SETTLE_MS);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('aborts a read the camera has moved on from and never publishes it', async () => {
    let view: Bounds = [0, 0, 10, 10];
    const signals: AbortSignal[] = [];
    const read = vi.fn((bounds: Bounds, _after: string | undefined, _limit: number, signal: AbortSignal) => {
      signals.push(signal);
      if (bounds[0] === 0) return new Promise<AreaDisplayWindow>(() => {});
      return Promise.resolve(page([feature('far')], null));
    });
    const published: string[][] = [];
    const reader = new WindowReader(() => view, read,
      (features) => published.push(features.map((item) => item.identifier)), vi.fn());
    reader.viewChanged();
    await vi.advanceTimersByTimeAsync(WINDOW_SETTLE_MS);
    view = [500, 500, 600, 600];
    reader.viewChanged();
    await vi.advanceTimersByTimeAsync(WINDOW_SETTLE_MS);
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    expect(published).toEqual([['far']]);
    reader.dispose();
    expect(signals[1]?.aborted).toBe(true);
  });
});
