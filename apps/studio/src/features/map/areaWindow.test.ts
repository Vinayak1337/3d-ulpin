import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@ulpin/api-client';
import type { SceneEngine } from '@ulpin/scene';
import { queryKeys, type AreaDisplaySummary, type AreaDisplayWindow, type AreaWindowFeature } from '../../api/queries';
import {
  WINDOW_EMPTY, WINDOW_SETTLE_MS, WindowReader, isAreaLimit, showWindow, useAreaWindow, viewBounds, windowEmpty,
  windowLine, windowScene, type Bounds,
} from './areaWindow';
import { WindowedArea, WindowedInspector } from './WindowedArea';

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

// Shape-only summaries: the counts and boxes below are structural placeholders, not records.
const summary = (featureCount: number, extent: Bounds | null) =>
  ({ areaId: 'a', areaRevision: 0, featureCount, extent }) as AreaDisplaySummary;

/** The markup of a tree with the area list and, when given, the area's summary already read. */
function render(element: ReactElement, read?: AreaDisplaySummary) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.areas, []);
  if (read) client.setQueryData(queryKeys.areaDisplaySummary('a'), read);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(MemoryRouter, null, element)));
}

// The scale and north readout's box, by its module class.
const READOUT = /class="_readout_/;

function WindowProbe({ active }: { active: boolean }) {
  const { empty, line, error } = useAreaWindow('a', null, active);
  return `${empty} ${line} ${error}`;
}

describe('nothing to draw', () => {
  it('is said for no feature counted or no extent, and not for a summary not yet read', () => {
    expect(windowEmpty(undefined)).toBe(false);
    expect(windowEmpty(summary(0, [0, 0, 10, 10]))).toBe(true);
    expect(windowEmpty(summary(5, null))).toBe(true);
    expect(windowEmpty(summary(5, [0, 0, 10, 10]))).toBe(false);
  });

  it('puts one sentence where the map would be, with no banner, line or readout', () => {
    for (const read of [summary(0, null), summary(0, [0, 0, 10, 10]), summary(5, null)]) {
      const markup = render(createElement(WindowedArea, { areaId: 'a' }), read);
      expect(markup).toContain(WINDOW_EMPTY);
      expect(markup).not.toContain('could not be read');
      expect(markup).not.toContain('role="status"');
      expect(markup).not.toMatch(READOUT);
    }
    const drawable = render(createElement(WindowedArea, { areaId: 'a' }), summary(5, [0, 0, 10, 10]));
    expect(drawable).not.toContain(WINDOW_EMPTY);
    expect(drawable).toMatch(READOUT);
  });

  it('leaves an area under the limit as it was: no summary read, nothing said', () => {
    expect(render(createElement(WindowProbe, { active: false }), summary(0, null))).toBe('false null null');
    expect(render(createElement(WindowProbe, { active: true }), summary(0, null))).toBe('true null null');
  });
});

describe('a picked footprint', () => {
  const inspector = (kind: AreaWindowFeature['kind']) =>
    render(createElement(WindowedInspector, { feature: feature('B-1', kind), areaName: 'Area', onClose() {} }));

  it('offers a building its register by id', () => {
    const markup = inspector('building');
    expect(markup).toContain('href="/studio/properties/id-B-1/register"');
    expect(markup).toContain('>Open register</a>');
    expect(markup).toContain('B-1');
  });

  it('offers no register for a feature that is not a building', () => {
    expect(inspector('road')).not.toContain('/register');
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

  it('fits the whole extent, never only centres on it, then reads the settled view', async () => {
    const engine = { fitPlanBox: vi.fn(), panTo: vi.fn() };
    const read = vi.fn(async () => page([], null));
    const reader = new WindowReader(() => [0, 0, 10, 10], read, vi.fn(), vi.fn());
    showWindow(engine as unknown as SceneEngine, [-2000, 500, 3000, 2500], reader);
    expect(engine.fitPlanBox).toHaveBeenCalledWith(-2000, 500, 3000, 2500);
    expect(engine.panTo).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(WINDOW_SETTLE_MS);
    expect(read).toHaveBeenCalledOnce();
    reader.dispose();
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
